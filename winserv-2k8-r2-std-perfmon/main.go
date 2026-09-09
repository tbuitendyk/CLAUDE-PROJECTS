// perfmon — quick-and-dirty resource monitor for Windows Server 2008 R2 (x64).
//
// Samples CPU, memory, disk queue and paging at a fixed interval. When the box
// slows down it writes a timestamped log line naming the condition and the top
// offending processes. Must be built with Go 1.20.x — the last Go release
// whose binaries run on NT 6.1 (see build.sh).
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var (
	interval  = flag.Duration("interval", 5*time.Minute, "sampling interval (each sample averages over the whole window)")
	topN      = flag.Int("top", 3, "culprit processes to name per event")
	logPath   = flag.String("log", "", "log file path (default: perfmon.log next to the exe)")
	rotateMB  = flag.Int("rotate-mb", 10, "rotate log above this size in MB (keeps one .1 backup)")
	heartbeat = flag.Duration("heartbeat", 6*time.Hour, "interval for alive/status lines (0 disables)")
	cooldown  = flag.Duration("cooldown", 10*time.Minute, "minimum gap between repeat logs while a condition stays active")
	debug     = flag.Bool("debug", false, "print every sample to the console (not the log file)")

	// 60%, not 90%. On 2026-09-09 users were badly affected while this box
	// averaged 42-69% over 5-minute windows; a 90% threshold would have logged
	// nothing at all. A sustained 60% average on an 8-core server that normally
	// idles under 15% is already an incident.
	cpuPct      = flag.Float64("cpu", 60, "CPU busy % threshold (average over the sampling window)")
	cpuSamples  = flag.Int("cpu-samples", 1, "consecutive bad samples before a CPU event fires (also to clear)")
	coreThresh  = flag.Float64("core", 95, "busiest-single-core % threshold — catches one pegged core, which the all-core average divides by the core count (0 disables)")
	coreSamples = flag.Int("core-samples", 2, "consecutive bad samples before a pegged-core event fires")
	memAvailMB  = flag.Uint64("mem-avail-mb", 256, "available-RAM floor in MB")
	memLoadPct  = flag.Uint64("mem-load", 95, "memory-load % ceiling (GlobalMemoryStatusEx)")
	memSamples  = flag.Int("mem-samples", 1, "consecutive bad samples before a memory event fires")
	diskQThresh = flag.Float64("diskq", 4, "PhysicalDisk(_Total) avg disk queue length threshold (~2 per spindle is the classic rule)")
	diskSamples = flag.Int("disk-samples", 1, "consecutive bad samples before a disk event fires")
	// Latency is the metric that actually tracked user pain here; queue length
	// stayed near zero through a slowdown with 227ms reads.
	diskLatMs   = flag.Float64("disk-ms", 25, "PhysicalDisk(_Total) avg read/write latency threshold in ms (0 disables)")
	latSamples  = flag.Int("disk-ms-samples", 1, "consecutive bad samples before a disk-latency event fires")
	pagesThresh = flag.Float64("pages", 500, "Memory pages/sec threshold (hard paging)")
	pageSamples = flag.Int("page-samples", 1, "consecutive bad samples before a paging event fires")
	stallMs     = flag.Int("stall", 5000, "log a stall when our own tick is this many ms late — scheduler starvation (0 disables)")
	probePath   = flag.String("probe", "", "time file access to this directory or file every sample — point it at the app's data directory to measure what users actually wait on")
	probeMs     = flag.Float64("probe-ms", 250, "file-probe threshold in ms")
	probeSample = flag.Int("probe-samples", 1, "consecutive bad samples before a file-probe event fires")
)

// condition is a simple hysteresis state machine: `need` consecutive bad
// samples to fire, `need` consecutive good ones to clear, cooldown-limited
// re-logging while active.
type condition struct {
	name    string
	need    int
	badN    int
	goodN   int
	active  bool
	since   time.Time
	lastLog time.Time
}

func (c *condition) update(bad bool, now time.Time, cd time.Duration) (fire, relog, clear bool) {
	if bad {
		c.badN++
		c.goodN = 0
		if !c.active {
			if c.badN >= c.need {
				c.active = true
				c.since = now
				c.lastLog = now
				return true, false, false
			}
		} else if now.Sub(c.lastLog) >= cd {
			c.lastLog = now
			return false, true, false
		}
	} else {
		c.goodN++
		c.badN = 0
		if c.active && c.goodN >= c.need {
			c.active = false
			return false, false, true
		}
	}
	return false, false, false
}

func main() {
	flag.Parse()
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "perfmon:", err)
		os.Exit(1)
	}
}

func run() error {
	path := *logPath
	if path == "" {
		exe, err := os.Executable()
		if err != nil {
			return fmt.Errorf("cannot locate own exe for default log path: %w", err)
		}
		path = filepath.Join(filepath.Dir(exe), "perfmon.log")
	}
	lg, err := newLogger(path, *rotateMB)
	if err != nil {
		return err
	}
	defer lg.Close()

	lg.Printf("START perfmon pid %d | interval %s | cpu>=%.0f%%x%d core>=%.0f%%x%d mem<%dMB|load>=%d%%x%d diskq>=%.1fx%d disk>=%.0fmsx%d pages>=%.0fx%d stall>%dms probe=\"%s\">=%.0fms | log %s",
		os.Getpid(), *interval, *cpuPct, *cpuSamples, *coreThresh, *coreSamples,
		*memAvailMB, *memLoadPct, *memSamples,
		*diskQThresh, *diskSamples, *diskLatMs, *latSamples,
		*pagesThresh, *pageSamples, *stallMs, *probePath, *probeMs, path)

	cpuPrev, err := getSystemTimes()
	if err != nil {
		return fmt.Errorf("GetSystemTimes: %w", err)
	}
	procs := newProcTable()
	procs.sample(time.Now()) // establish per-process baselines

	pdh, pdhErr := newPdhQuery()
	if pdhErr != nil {
		lg.Printf("WARN disk/paging counters unavailable (%v) — continuing without them", pdhErr)
	} else if missing := pdh.missing(); len(missing) > 0 {
		lg.Printf("WARN %d counter(s) unavailable on this box, so they can never fire: %s",
			len(missing), strings.Join(missing, ", "))
	}

	if *probePath != "" {
		if d, err := probeFS(*probePath); err != nil {
			lg.Printf("WARN file probe \"%s\" failed (%v) — continuing without it", *probePath, err)
			*probePath = ""
		} else {
			lg.Printf("file probe \"%s\" responded in %.1fms", *probePath, float64(d.Nanoseconds())/1e6)
		}
	}

	condCPU := &condition{name: "cpu", need: *cpuSamples}
	condCore := &condition{name: "core", need: *coreSamples}
	condMem := &condition{name: "mem", need: *memSamples}
	condDisk := &condition{name: "disk", need: *diskSamples}
	condLat := &condition{name: "disk-latency", need: *latSamples}
	condPage := &condition{name: "paging", need: *pageSamples}
	condProbe := &condition{name: "file-probe", need: *probeSample}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)

	tick := time.NewTicker(*interval)
	defer tick.Stop()
	last := time.Now()
	lastBeat := time.Now()
	lastStall := time.Time{}

	for {
		select {
		case <-sig:
			lg.Printf("STOP interrupted")
			return nil
		case <-tick.C:
		}
		now := time.Now()
		gap := now.Sub(last)
		last = now

		// System-wide CPU.
		cpuNow, err := getSystemTimes()
		if err != nil {
			lg.Printf("WARN GetSystemTimes: %v", err)
			continue
		}
		busy := cpuBusyPct(cpuPrev, cpuNow)
		cpuPrev = cpuNow

		// Memory.
		mem, memErr := globalMemoryStatusEx()
		availMB := mem.AvailPhys / (1 << 20)

		// Per-process deltas (CPU%, working set, IO/s, faults/s).
		samples := procs.sample(now)

		// Disk queue/latency, paging and per-core CPU via PDH.
		var pdhS pdhSample
		pdhS.maxCoreIdx = -1
		if pdhErr == nil {
			pdhS = pdh.collect()
		}

		// Time one real file operation against the path users wait on.
		probeMsVal, probeOK := 0.0, false
		if *probePath != "" {
			if d, err := probeFS(*probePath); err == nil {
				probeMsVal, probeOK = float64(d.Nanoseconds())/1e6, true
			} else {
				lg.Printf("WARN file probe \"%s\" failed: %v", *probePath, err)
			}
		}

		if *debug {
			fmt.Printf("%s cpu %.1f%% (core%d %.0f%%) | avail %dMB load %d%% | diskq %.2f r%.1fms w%.1fms pages/s %.0f | probe %.1fms | procs %d | gap %s\n",
				now.Format("15:04:05"), busy, pdhS.maxCoreIdx, pdhS.maxCore, availMB, mem.MemoryLoad,
				pdhS.diskQueue, pdhS.diskReadMs, pdhS.diskWrMs, pdhS.pagesSec, probeMsVal,
				len(samples), gap.Round(time.Millisecond))
		}

		// Stall: our own 2s tick arrived late — something starved the scheduler.
		if *stallMs > 0 && gap > *interval+time.Duration(*stallMs)*time.Millisecond {
			if now.Sub(lastStall) >= *cooldown {
				lastStall = now
				lg.Printf("STALL sampling tick %s late (interval %s) | top cpu: %s",
					(gap - *interval).Round(time.Millisecond), *interval, topByCPU(samples, *topN))
			}
		}

		// CPU condition.
		logCond(lg, condCPU, busy >= *cpuPct, now, func() string {
			return fmt.Sprintf("%.1f%% busy (threshold %.0f%%) | top cpu: %s", busy, *cpuPct, topByCPU(samples, *topN))
		})

		// Memory condition.
		memBad := memErr == nil && (availMB < *memAvailMB || uint64(mem.MemoryLoad) >= *memLoadPct)
		logCond(lg, condMem, memBad, now, func() string {
			return fmt.Sprintf("%dMB avail, load %d%% (floor %dMB, ceiling %d%%) | top working-set: %s",
				availMB, mem.MemoryLoad, *memAvailMB, *memLoadPct, topByWS(samples, *topN))
		})

		// One pegged core: invisible in the all-core average, which divides it
		// by the core count (100% of one core reads as 12.5% on eight).
		logCond(lg, condCore, *coreThresh > 0 && pdhS.ok && pdhS.maxCore >= *coreThresh, now, func() string {
			return fmt.Sprintf("core %d at %.0f%% (threshold %.0f%%) while all-core average is %.1f%% | top cpu: %s",
				pdhS.maxCoreIdx, pdhS.maxCore, *coreThresh, busy, topByCPU(samples, *topN))
		})

		// Disk + paging conditions (only when PDH delivered a value this tick).
		logCond(lg, condDisk, pdhS.ok && pdhS.diskQueue >= *diskQThresh, now, func() string {
			return fmt.Sprintf("avg disk queue %.1f (threshold %.1f) | top io: %s", pdhS.diskQueue, *diskQThresh, topByIO(samples, *topN))
		})
		logCond(lg, condLat, *diskLatMs > 0 && pdhS.ok && (pdhS.diskReadMs >= *diskLatMs || pdhS.diskWrMs >= *diskLatMs), now, func() string {
			return fmt.Sprintf("read %.0fms write %.0fms (threshold %.0fms, queue only %.2f) | top io: %s",
				pdhS.diskReadMs, pdhS.diskWrMs, *diskLatMs, pdhS.diskQueue, topByIO(samples, *topN))
		})
		logCond(lg, condPage, pdhS.ok && pdhS.pagesSec >= *pagesThresh, now, func() string {
			return fmt.Sprintf("%.0f pages/sec (threshold %.0f) | top page-faults: %s | top io: %s",
				pdhS.pagesSec, *pagesThresh, topByFaults(samples, *topN), topByIO(samples, *topN))
		})

		// What users actually wait on.
		logCond(lg, condProbe, probeOK && probeMsVal >= *probeMs, now, func() string {
			return fmt.Sprintf("%s took %.0fms (threshold %.0fms) | cpu %.1f%%, diskq %.2f, read %.0fms | top io: %s | top cpu: %s",
				*probePath, probeMsVal, *probeMs, busy, pdhS.diskQueue, pdhS.diskReadMs,
				topByIO(samples, *topN), topByCPU(samples, *topN))
		})

		// Heartbeat.
		if *heartbeat > 0 && now.Sub(lastBeat) >= *heartbeat {
			lastBeat = now
			probeTxt := ""
			if probeOK {
				probeTxt = fmt.Sprintf(" | probe %.1fms", probeMsVal)
			}
			lg.Printf("HEARTBEAT cpu %.1f%% (busiest core %d at %.0f%%) | mem %d%% used, %dMB avail | diskq %.2f, read %.1fms, write %.1fms | pages/s %.0f%s | procs %d",
				busy, pdhS.maxCoreIdx, pdhS.maxCore, mem.MemoryLoad, availMB,
				pdhS.diskQueue, pdhS.diskReadMs, pdhS.diskWrMs, pdhS.pagesSec, probeTxt, len(samples))
		}
	}
}

// logCond runs the state machine for one condition and writes EVENT/STILL/CLEAR
// lines. detail is only evaluated when a line is actually written.
func logCond(lg *logger, c *condition, bad bool, now time.Time, detail func() string) {
	fire, relog, clear := c.update(bad, now, *cooldown)
	switch {
	case fire:
		lg.Printf("EVENT %s: %s", c.name, detail())
	case relog:
		lg.Printf("STILL %s: %s (active %s)", c.name, detail(), now.Sub(c.since).Round(time.Second))
	case clear:
		lg.Printf("CLEAR %s: recovered after %s", c.name, now.Sub(c.since).Round(time.Second))
	}
}

// ---- culprit ranking ----

func topBy(samples []procSample, n int, key func(procSample) float64, one func(procSample) string) string {
	s := make([]procSample, len(samples))
	copy(s, samples)
	sort.Slice(s, func(i, j int) bool { return key(s[i]) > key(s[j]) })
	var parts []string
	for _, p := range s {
		if len(parts) >= n || key(p) <= 0 {
			break
		}
		parts = append(parts, one(p))
	}
	if len(parts) == 0 {
		return "(none visible — run elevated to see all processes)"
	}
	return strings.Join(parts, ", ")
}

func topByCPU(s []procSample, n int) string {
	return topBy(s, n, func(p procSample) float64 { return p.cpuPct },
		func(p procSample) string { return fmt.Sprintf("%s(%d) %.1f%%", p.name, p.pid, p.cpuPct) })
}

func topByWS(s []procSample, n int) string {
	return topBy(s, n, func(p procSample) float64 { return p.wsMB },
		func(p procSample) string { return fmt.Sprintf("%s(%d) %.0fMB", p.name, p.pid, p.wsMB) })
}

func topByIO(s []procSample, n int) string {
	return topBy(s, n, func(p procSample) float64 { return p.ioMBs },
		func(p procSample) string { return fmt.Sprintf("%s(%d) %.1fMB/s", p.name, p.pid, p.ioMBs) })
}

func topByFaults(s []procSample, n int) string {
	return topBy(s, n, func(p procSample) float64 { return p.faultsSec },
		func(p procSample) string { return fmt.Sprintf("%s(%d) %.0f/s", p.name, p.pid, p.faultsSec) })
}

// probeFS times one realistic file operation: a directory listing if path is a
// directory, otherwise open + read one byte + close. This is the only measure
// here taken from the user's side of the problem rather than the server's.
func probeFS(path string) (time.Duration, error) {
	start := time.Now()
	st, err := os.Stat(path)
	if err != nil {
		return time.Since(start), err
	}
	if st.IsDir() {
		f, err := os.Open(path)
		if err != nil {
			return time.Since(start), err
		}
		_, err = f.Readdirnames(128)
		f.Close()
		if err == io.EOF {
			err = nil
		}
		return time.Since(start), err
	}
	f, err := os.Open(path)
	if err != nil {
		return time.Since(start), err
	}
	buf := make([]byte, 1)
	_, err = f.Read(buf)
	f.Close()
	if err == io.EOF {
		err = nil
	}
	return time.Since(start), err
}
