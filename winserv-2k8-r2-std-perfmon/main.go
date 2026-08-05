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

	cpuPct      = flag.Float64("cpu", 90, "CPU busy % threshold (average over the sampling window)")
	cpuSamples  = flag.Int("cpu-samples", 1, "consecutive bad samples before a CPU event fires (also to clear)")
	memAvailMB  = flag.Uint64("mem-avail-mb", 256, "available-RAM floor in MB")
	memLoadPct  = flag.Uint64("mem-load", 95, "memory-load % ceiling (GlobalMemoryStatusEx)")
	memSamples  = flag.Int("mem-samples", 1, "consecutive bad samples before a memory event fires")
	diskQThresh = flag.Float64("diskq", 4, "PhysicalDisk(_Total) avg disk queue length threshold (~2 per spindle is the classic rule)")
	diskSamples = flag.Int("disk-samples", 1, "consecutive bad samples before a disk event fires")
	pagesThresh = flag.Float64("pages", 500, "Memory pages/sec threshold (hard paging)")
	pageSamples = flag.Int("page-samples", 1, "consecutive bad samples before a paging event fires")
	stallMs     = flag.Int("stall", 5000, "log a stall when our own tick is this many ms late — scheduler starvation (0 disables)")
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

	lg.Printf("START perfmon pid %d | interval %s | cpu>=%.0f%%x%d mem<%dMB|load>=%d%%x%d diskq>=%.1fx%d pages>=%.0fx%d stall>%dms | log %s",
		os.Getpid(), *interval, *cpuPct, *cpuSamples, *memAvailMB, *memLoadPct, *memSamples,
		*diskQThresh, *diskSamples, *pagesThresh, *pageSamples, *stallMs, path)

	cpuPrev, err := getSystemTimes()
	if err != nil {
		return fmt.Errorf("GetSystemTimes: %w", err)
	}
	procs := newProcTable()
	procs.sample(time.Now()) // establish per-process baselines

	pdh, pdhErr := newPdhQuery()
	if pdhErr != nil {
		lg.Printf("WARN disk/paging counters unavailable (%v) — continuing without them", pdhErr)
	}

	condCPU := &condition{name: "cpu", need: *cpuSamples}
	condMem := &condition{name: "mem", need: *memSamples}
	condDisk := &condition{name: "disk", need: *diskSamples}
	condPage := &condition{name: "paging", need: *pageSamples}

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

		// Disk queue + pages/sec via PDH.
		diskQ, pagesSec, pdhOK := 0.0, 0.0, false
		if pdhErr == nil {
			diskQ, pagesSec, pdhOK = pdh.collect()
		}

		if *debug {
			fmt.Printf("%s cpu %.1f%% | avail %dMB load %d%% | diskq %.2f pages/s %.0f | procs %d | gap %s\n",
				now.Format("15:04:05"), busy, availMB, mem.MemoryLoad, diskQ, pagesSec, len(samples), gap.Round(time.Millisecond))
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

		// Disk + paging conditions (only when PDH delivered a value this tick).
		logCond(lg, condDisk, pdhOK && diskQ >= *diskQThresh, now, func() string {
			return fmt.Sprintf("avg disk queue %.1f (threshold %.1f) | top io: %s", diskQ, *diskQThresh, topByIO(samples, *topN))
		})
		logCond(lg, condPage, pdhOK && pagesSec >= *pagesThresh, now, func() string {
			return fmt.Sprintf("%.0f pages/sec (threshold %.0f) | top page-faults: %s | top io: %s",
				pagesSec, *pagesThresh, topByFaults(samples, *topN), topByIO(samples, *topN))
		})

		// Heartbeat.
		if *heartbeat > 0 && now.Sub(lastBeat) >= *heartbeat {
			lastBeat = now
			lg.Printf("HEARTBEAT cpu %.1f%% | mem %d%% used, %dMB avail | diskq %.2f | pages/s %.0f | procs %d",
				busy, mem.MemoryLoad, availMB, diskQ, pagesSec, len(samples))
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
