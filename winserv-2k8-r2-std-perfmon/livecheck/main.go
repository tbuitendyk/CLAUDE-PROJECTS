//go:build windows

// livecheck — high-resolution live diagnostic probe for Windows Server 2008 R2.
//
// Run this DURING a slowdown. Where perfmon.exe samples four coarse counters
// every 5 minutes, livecheck samples every second and measures the things the
// Aug-Sep 2026 correlation study proved perfmon was blind to:
//
//   - CPU steal, via a fixed-work canary timed with QueryPerformanceCounter on
//     a pinned core (see canary_windows.go for why both are required)
//   - per-CORE cpu, not the all-core average that hides one pegged core
//   - disk LATENCY in ms, not queue length (queue stayed ~0 during every incident)
//   - SMB server file/session/work-queue state, for shared-DBF contention
//   - VMware Tools' host-view counters, if installed (balloon, swap, effective MHz)
//   - a timed file-access probe against the path users actually wait on
//   - its own loop lag and per-phase timings, so "the probe itself was starved"
//     is visible as data rather than inferred from missing rows
//
// Read-only; touches nothing but its own CSV. Safe to run alongside perfmon.exe.
package main

import (
	"encoding/csv"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	duration     = flag.Duration("for", 2*time.Minute, "how long to run (0 = until Ctrl+C)")
	interval     = flag.Duration("every", time.Second, "sample interval")
	probePath    = flag.String("probe", "", "file or directory to time file access against — point this at the FoxPro data directory or share (e.g. -probe C:\\Wipsystem)")
	probeTimeout = flag.Duration("probe-timeout", 5*time.Second, "give up on a file probe after this long instead of stalling the loop")
	csvPath      = flag.String("csv", "livecheck.csv", "write every sample to this CSV (empty to disable)")
	topN         = flag.Int("top", 3, "processes to name per sample")
	procEvery    = flag.Int("proc-every", 3, "walk the process table every Nth sample (higher = less load from this tool)")
	quiet        = flag.Bool("quiet", false, "only print flagged (bad) samples and the summary")
	noCanary     = flag.Bool("no-canary", false, "skip the CPU canary entirely (removes this tool's own CPU burn)")
)

// thresholds that turn into flags on a sample line
const (
	stealBad     = 1.5  // canary took >=1.5x its calibrated baseline
	deschedBad   = 0.75 // thread got <75% of elapsed time on-CPU
	probeBadMs   = 100.0
	diskBadMs    = 25.0
	corePeggedPc = 90.0
	lagBad       = 2.5 // sample arrived >=2.5x the requested interval late
)

type sample struct {
	t          time.Time
	gapMs      float64 // actual time since previous sample; the loop's own lag
	cpu        float64
	maxCore    float64
	maxCoreIdx int
	rdyQ       float64
	ctxSw      float64
	availMB    float64
	pages      float64
	rdMs       float64
	wrMs       float64
	diskQ      float64
	iops       float64
	files      float64
	sessions   float64
	shortages  float64
	smbQ       float64
	vmBalloon  float64
	vmSwapped  float64
	vmEffMHz   float64
	vmHostMHz  float64
	steal      float64
	cpuWall    float64
	probeMs    float64
	probeErr   string
	pdhMs      float64
	canaryMs   float64
	procMs     float64
	top        string
	flags      []string
}

func main() {
	flag.Parse()
	fmt.Printf("livecheck — live performance probe (%d logical CPUs)\n", runtime.NumCPU())

	pdh, err := newQuery()
	if err != nil {
		fmt.Fprintln(os.Stderr, "FATAL: cannot open PDH query:", err)
		os.Exit(1)
	}
	if missing := pdh.missing(); len(missing) > 0 {
		fmt.Printf("note: %d counter(s) unavailable on this box (skipped): %s\n",
			len(missing), strings.Join(missing, ", "))
	}
	if pdh.have("vm_balloon") || pdh.have("vm_eff_mhz") {
		fmt.Println("note: VMware Tools host-view counters ARE available — hypervisor pressure will show below")
	} else {
		fmt.Println("note: VMware Tools perfmon counters NOT present — no host-side visibility from inside the guest;")
		fmt.Println("      get CPU ready / datastore latency from vCenter for the same clock times instead")
	}

	var cal calibration
	if !*noCanary {
		fmt.Print("calibrating CPU canary... ")
		cal = calibrate()
		if cal.reliable {
			fmt.Printf("%d iterations = %.2fms (%.0f M-iter/s, spread %.1fx, pinned to core %d)\n",
				cal.iters, float64(cal.baseline.Nanoseconds())/1e6, cal.opsPerSec/1e6, cal.spread, cal.pinnedCore)
		} else {
			fmt.Println("UNRELIABLE")
			fmt.Printf("  !! %s\n", cal.why)
			fmt.Printf("  !! measured %d iterations in %.3fms (%.0f M-iter/s)\n",
				cal.iters, float64(cal.baseline.Nanoseconds())/1e6, cal.opsPerSec/1e6)
			fmt.Println("  !! CPU steal columns will be recorded but NOT flagged — do not read them as a hypervisor")
			fmt.Println("     problem. Every other measurement below is unaffected.")
		}
	}

	if *probePath != "" {
		if d, _, err := probeFS(*probePath, *probeTimeout); err != nil {
			fmt.Printf("WARNING: file probe \"%s\" failed: %v (continuing without it)\n", *probePath, err)
			*probePath = ""
		} else {
			fmt.Printf("file probe: %s responded in %.1fms\n", *probePath, float64(d.Nanoseconds())/1e6)
		}
	} else {
		fmt.Println("note: no -probe path given — pass the app's data directory to time what users actually wait on")
	}

	var w *csv.Writer
	if *csvPath != "" {
		f, err := os.Create(*csvPath)
		if err != nil {
			fmt.Fprintln(os.Stderr, "cannot create CSV:", err)
			os.Exit(1)
		}
		defer f.Close()
		w = csv.NewWriter(f)
		w.Write(csvHeader())
		defer w.Flush()
	}

	procs := newProcTable()
	procs.sample(time.Now())
	pdh.collect() // prime rate counters

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	tick := time.NewTicker(*interval)
	defer tick.Stop()

	deadline := time.Time{}
	if *duration > 0 {
		deadline = time.Now().Add(*duration)
		fmt.Printf("\nsampling every %s for %s — Ctrl+C to stop early\n\n", *interval, *duration)
	} else {
		fmt.Printf("\nsampling every %s until Ctrl+C\n\n", *interval)
	}

	var samples []sample
	printHeader()
	line, n := 0, 0
	prev := time.Now()
	lastTop := "(not sampled)"

loop:
	for {
		select {
		case <-sig:
			fmt.Println("\ninterrupted")
			break loop
		case <-tick.C:
		}
		now := time.Now()
		n++
		s := takeSample(now, prev, n, pdh, procs, cal, &lastTop)
		prev = now
		samples = append(samples, s)
		if !*quiet || len(s.flags) > 0 {
			if line%20 == 0 && line > 0 {
				printHeader()
			}
			fmt.Println(s.line())
			line++
		}
		if w != nil {
			w.Write(s.csvRow())
			w.Flush()
		}
		if !deadline.IsZero() && now.After(deadline) {
			break loop
		}
	}

	summarize(samples, cal)
	if *csvPath != "" {
		fmt.Printf("\nfull per-second data written to %s — send that file back for analysis.\n", *csvPath)
	}
}

func takeSample(now, prev time.Time, n int, pdh *query, procs *procTable, cal calibration, lastTop *string) sample {
	s := sample{t: now, gapMs: float64(now.Sub(prev).Nanoseconds()) / 1e6}

	t0 := time.Now()
	pdh.collect()
	s.pdhMs = msSince(t0)

	s.cpu = pdh.val("cpu_total")
	s.rdyQ = pdh.val("rdy_queue")
	s.ctxSw = pdh.val("ctx_switches")
	s.availMB = pdh.val("avail_mb")
	s.pages = pdh.val("pages_sec")
	s.rdMs = pdh.val("disk_read_sec") * 1000
	s.wrMs = pdh.val("disk_write_sec") * 1000
	s.diskQ = pdh.val("disk_queue")
	s.iops = pdh.val("disk_xfers")
	s.files = pdh.val("srv_files_open")
	s.sessions = pdh.val("srv_sessions")
	s.shortages = pdh.val("srv_shortages")
	s.smbQ = pdh.val("srv_work_queue")
	s.vmBalloon = pdh.val("vm_balloon")
	s.vmSwapped = pdh.val("vm_swapped")
	s.vmEffMHz = pdh.val("vm_eff_mhz")
	s.vmHostMHz = pdh.val("vm_host_mhz")
	s.maxCore, s.maxCoreIdx = pdh.maxCore()

	if !*noCanary && cal.baseline > 0 {
		t0 = time.Now()
		elapsed, onCPU := cal.run()
		s.canaryMs = msSince(t0)
		s.steal = float64(elapsed) / float64(cal.baseline)
		if elapsed > 0 {
			s.cpuWall = float64(onCPU) / float64(elapsed)
		}
	}

	if *probePath != "" {
		d, timedOut, err := probeFS(*probePath, *probeTimeout)
		s.probeMs = float64(d.Nanoseconds()) / 1e6
		if timedOut {
			s.probeErr = "timeout"
		} else if err != nil {
			s.probeErr = err.Error()
		}
	}

	// Walking the process table is by far this tool's own biggest cost, and at
	// sub-second gaps GetProcessTimes' 15.6ms granularity makes the resulting
	// percentages meaningless anyway — so do it every Nth sample only.
	if *procEvery > 0 && n%*procEvery == 0 {
		t0 = time.Now()
		ps := procs.sample(now)
		s.procMs = msSince(t0)
		*lastTop = topCPU(ps, *topN)
	}
	s.top = *lastTop

	// flags — what makes this second interesting
	if cal.reliable && s.steal >= stealBad {
		if s.cpuWall > 0 && s.cpuWall < deschedBad {
			s.flags = append(s.flags, fmt.Sprintf("CPU-STARVED(%.1fx,off-cpu)", s.steal))
		} else {
			s.flags = append(s.flags, fmt.Sprintf("CPU-SLOW(%.1fx,on-cpu)", s.steal))
		}
	}
	if s.probeMs >= probeBadMs {
		s.flags = append(s.flags, fmt.Sprintf("SLOW-FS(%.0fms)", s.probeMs))
	}
	if s.probeErr != "" {
		s.flags = append(s.flags, "FS-"+strings.ToUpper(s.probeErr))
	}
	if s.rdMs >= diskBadMs || s.wrMs >= diskBadMs {
		s.flags = append(s.flags, fmt.Sprintf("SLOW-DISK(r%.0f/w%.0fms)", s.rdMs, s.wrMs))
	}
	if s.maxCore >= corePeggedPc {
		s.flags = append(s.flags, fmt.Sprintf("CORE%d-PEGGED", s.maxCoreIdx))
	}
	if s.rdyQ > float64(2*runtime.NumCPU()) {
		s.flags = append(s.flags, fmt.Sprintf("RUN-QUEUE(%.0f)", s.rdyQ))
	}
	if s.shortages > 0 {
		s.flags = append(s.flags, "SMB-WORKITEM-SHORTAGE")
	}
	if s.vmBalloon > 0 || s.vmSwapped > 0 {
		s.flags = append(s.flags, "HOST-MEM-PRESSURE")
	}
	if s.gapMs >= lagBad*float64(interval.Milliseconds()) {
		s.flags = append(s.flags, fmt.Sprintf("LOOP-LAG(%.1fs)", s.gapMs/1000))
	}
	return s
}

func msSince(t time.Time) float64 { return float64(time.Since(t).Nanoseconds()) / 1e6 }

func printHeader() {
	fmt.Println("time      gap_s  cpu%  core%  rdyQ  freeMB  rd_ms  wr_ms  steal  on-cpu  probe_ms  | top cpu / flags")
	fmt.Println("--------  -----  ----  -----  ----  ------  -----  -----  -----  ------  --------  ------------------")
}

func (s sample) line() string {
	probe := "     -"
	if *probePath != "" {
		probe = fmt.Sprintf("%6.1f", s.probeMs)
	}
	steal, oncpu := "    -", "     -"
	if s.steal > 0 {
		steal = fmt.Sprintf("%4.1fx", s.steal)
		oncpu = fmt.Sprintf("%6.2f", s.cpuWall)
	}
	tail := s.top
	if len(s.flags) > 0 {
		tail = "<<< " + strings.Join(s.flags, " ") + " | " + s.top
	}
	return fmt.Sprintf("%s  %5.1f  %4.1f  %5.1f  %4.0f  %6.0f  %5.1f  %5.1f  %s  %s  %s  | %s",
		s.t.Format("15:04:05"), s.gapMs/1000, s.cpu, s.maxCore, s.rdyQ, s.availMB,
		s.rdMs, s.wrMs, steal, oncpu, probe, tail)
}

func csvHeader() []string {
	return []string{"time", "loop_gap_ms", "cpu_pct", "max_core_pct", "max_core_idx", "ready_queue", "ctx_switches_sec",
		"avail_mb", "pages_sec", "disk_read_ms", "disk_write_ms", "disk_queue", "disk_iops",
		"smb_files_open", "smb_sessions", "smb_work_item_shortages", "smb_work_queue",
		"vm_balloon_mb", "vm_swapped_mb", "vm_effective_mhz", "vm_host_mhz",
		"cpu_steal_ratio", "cpu_on_cpu_ratio", "probe_ms", "probe_err",
		"phase_pdh_ms", "phase_canary_ms", "phase_proc_ms", "top_cpu", "flags"}
}

func (s sample) csvRow() []string {
	f := func(v float64) string { return strconv.FormatFloat(v, 'f', 3, 64) }
	return []string{
		s.t.Format("2006-01-02 15:04:05"), f(s.gapMs), f(s.cpu), f(s.maxCore), strconv.Itoa(s.maxCoreIdx),
		f(s.rdyQ), f(s.ctxSw), f(s.availMB), f(s.pages),
		f(s.rdMs), f(s.wrMs), f(s.diskQ), f(s.iops),
		f(s.files), f(s.sessions), f(s.shortages), f(s.smbQ),
		f(s.vmBalloon), f(s.vmSwapped), f(s.vmEffMHz), f(s.vmHostMHz),
		f(s.steal), f(s.cpuWall), f(s.probeMs), s.probeErr,
		f(s.pdhMs), f(s.canaryMs), f(s.procMs), s.top, strings.Join(s.flags, ";"),
	}
}

func summarize(ss []sample, cal calibration) {
	if len(ss) == 0 {
		fmt.Println("\nno samples collected")
		return
	}
	fmt.Printf("\n================ SUMMARY over %d samples (%s - %s) ================\n",
		len(ss), ss[0].t.Format("15:04:05"), ss[len(ss)-1].t.Format("15:04:05"))

	stat := func(name string, get func(sample) float64, unit string) {
		v := make([]float64, 0, len(ss))
		for _, s := range ss {
			v = append(v, get(s))
		}
		sort.Float64s(v)
		p := func(q float64) float64 { return v[int(q*float64(len(v)-1))] }
		fmt.Printf("  %-22s min %8.2f  median %8.2f  p95 %8.2f  max %8.2f  %s\n",
			name, v[0], p(0.5), p(0.95), v[len(v)-1], unit)
	}

	stat("cpu (all cores)", func(s sample) float64 { return s.cpu }, "%")
	stat("cpu (busiest core)", func(s sample) float64 { return s.maxCore }, "%")
	stat("ready queue", func(s sample) float64 { return s.rdyQ }, "threads waiting")
	if cal.reliable {
		stat("CPU steal ratio", func(s sample) float64 { return s.steal }, "x baseline (1.0 = full speed)")
		stat("on-cpu ratio", func(s sample) float64 { return s.cpuWall }, "(1.0 = never descheduled)")
	}
	stat("disk read latency", func(s sample) float64 { return s.rdMs }, "ms")
	stat("disk write latency", func(s sample) float64 { return s.wrMs }, "ms")
	stat("disk iops", func(s sample) float64 { return s.iops }, "transfers/sec")
	if *probePath != "" {
		stat("file probe", func(s sample) float64 { return s.probeMs }, "ms  ("+*probePath+")")
	}
	stat("SMB files open", func(s sample) float64 { return s.files }, "")
	stat("loop lag", func(s sample) float64 { return s.gapMs / 1000 }, "s between samples (asked for "+interval.String()+")")

	if !cal.reliable && !*noCanary {
		fmt.Println("\n  !! CPU canary was UNRELIABLE on this host and its columns were not flagged:")
		fmt.Printf("     %s\n", cal.why)
	}

	counts := map[string]int{}
	for _, s := range ss {
		for _, fl := range s.flags {
			counts[strings.SplitN(fl, "(", 2)[0]]++
		}
	}
	fmt.Println()
	if len(counts) == 0 {
		fmt.Println("  VERDICT: no sample tripped any threshold. If users were slow during this run,")
		fmt.Println("  the bottleneck is not CPU, disk latency, or the probed path — look at the")
		fmt.Println("  application layer (locking, reports/printing) or the client side.")
	} else {
		fmt.Println("  FLAGGED CONDITIONS (how many samples each was true):")
		type kv struct {
			k string
			n int
		}
		var list []kv
		for k, n := range counts {
			list = append(list, kv{k, n})
		}
		sort.Slice(list, func(i, j int) bool { return list[i].n > list[j].n })
		for _, e := range list {
			fmt.Printf("    %-26s %4d / %d samples\n", e.k, e.n, len(ss))
		}
		fmt.Println()
		fmt.Println("  READING IT:")
		fmt.Println("    CPU-STARVED  = canary slow AND off-cpu -> the hypervisor is not scheduling this VM")
		fmt.Println("                   (VMware CPU ready / co-stop). Confirm in vCenter for these clock times.")
		fmt.Println("    CPU-SLOW     = canary slow but on-cpu  -> core itself is slow (frequency, cache/HT contention)")
		fmt.Println("    SLOW-FS      = the path users wait on is slow")
		fmt.Println("    SLOW-DISK    = real storage latency (queue length would have missed this)")
		fmt.Println("    CORE_-PEGGED = one core saturated; an all-core average would have hidden it")
		fmt.Println("    LOOP-LAG     = this probe could not even run on schedule — the box is badly overloaded,")
		fmt.Println("                   OR its own console/CSV writes blocked (check phase_* columns in the CSV)")
	}
	if cal.reliable {
		fmt.Printf("\n  (canary baseline: %d iterations in %.2fms, %.0f M-iter/s, core %d)\n",
			cal.iters, float64(cal.baseline.Nanoseconds())/1e6, cal.opsPerSec/1e6, cal.pinnedCore)
	}
}

func topCPU(ps []procSample, n int) string {
	sort.Slice(ps, func(i, j int) bool { return ps[i].cpuPct > ps[j].cpuPct })
	var parts []string
	for _, p := range ps {
		if len(parts) >= n || p.cpuPct <= 0.05 {
			break
		}
		parts = append(parts, fmt.Sprintf("%s %.1f%%", p.name, p.cpuPct))
	}
	if len(parts) == 0 {
		return "(all idle)"
	}
	return strings.Join(parts, ", ")
}

// probeFS times one realistic file operation against path: a directory listing
// if it is a directory, otherwise open + read one byte + close. It runs in its
// own goroutine so a hung path costs us the timeout, not the whole run — the
// first field capture lost 100 seconds in a single blocked pass.
func probeFS(path string, timeout time.Duration) (time.Duration, bool, error) {
	type result struct {
		d   time.Duration
		err error
	}
	ch := make(chan result, 1)
	go func() {
		start := time.Now()
		err := doProbe(path)
		ch <- result{time.Since(start), err}
	}()
	select {
	case r := <-ch:
		return r.d, false, r.err
	case <-time.After(timeout):
		return timeout, true, nil
	}
}

func doProbe(path string) error {
	st, err := os.Stat(path)
	if err != nil {
		return err
	}
	if st.IsDir() {
		f, err := os.Open(path)
		if err != nil {
			return err
		}
		_, err = f.Readdirnames(128)
		f.Close()
		if err == io.EOF {
			err = nil
		}
		return err
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	buf := make([]byte, 1)
	_, err = f.Read(buf)
	f.Close()
	if err == io.EOF {
		err = nil
	}
	return err
}
