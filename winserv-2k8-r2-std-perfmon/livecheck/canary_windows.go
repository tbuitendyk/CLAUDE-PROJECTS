//go:build windows

package main

// The CPU canary. Instead of sleeping and checking whether we woke up late
// (which only catches multi-second freezes), we do a FIXED amount of
// arithmetic and time it. Two numbers come out:
//
//   steal    = time now / time when unobstructed. 2.0 means the same work took
//              twice as long, i.e. we got half the CPU we asked for.
//   on-cpu   = how much of that time we were actually executing, from the
//              thread's own cycle counter. Near 1.0 while steal is high means
//              the core ran us the whole time but ran slow; well below 1.0
//              means something took the core away — on a VM that is usually
//              the hypervisor (CPU ready / co-stop), which no in-guest CPU%
//              can show.
//
// Two hard-won requirements, both learned from the 2026-09-09 capture where
// this canary produced garbage (45.7M iterations "in 2.0ms" — 23 billion
// iterations/sec, and steal ratios of 2x-239x that meant nothing):
//
//  1. TIME WITH QueryPerformanceCounter, NOT time.Now(). Go's monotonic clock
//     on Windows reads the interrupt-time field, which only advances on the
//     scheduler tick (~15.6ms, ~1ms if something raised the timer resolution).
//     Timing a 25ms workload with a 15.6ms ruler produces nonsense, and the
//     calibration loop then chases its own quantization noise.
//  2. PIN THE THREAD TO ONE CORE. On a VM the per-core timestamp counters need
//     not be in sync, so a thread that migrates mid-measurement can read a
//     wildly wrong (even negative) delta.
//
// Calibration also refuses to accept an implausible result: if the measured
// rate is outside what silicon can do, the canary marks itself unreliable and
// main() suppresses its flags rather than reporting a phantom hypervisor
// problem.

import (
	"fmt"
	"runtime"
	"sort"
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32dll             = syscall.NewLazyDLL("kernel32.dll")
	procQueryThreadCycles   = kernel32dll.NewProc("QueryThreadCycleTime")
	procGetCurrentThreadHnd = kernel32dll.NewProc("GetCurrentThread")
	procGetThreadTimes      = kernel32dll.NewProc("GetThreadTimes")
	procQPC                 = kernel32dll.NewProc("QueryPerformanceCounter")
	procQPF                 = kernel32dll.NewProc("QueryPerformanceFrequency")
	procSetThreadAffinity   = kernel32dll.NewProc("SetThreadAffinityMask")
)

var qpcFreq float64 // ticks per second; 0 means QPC unusable

func initQPC() bool {
	var f int64
	r, _, _ := procQPF.Call(uintptr(unsafe.Pointer(&f)))
	if r == 0 || f <= 0 {
		return false
	}
	qpcFreq = float64(f)
	return true
}

func qpcNow() int64 {
	var c int64
	procQPC.Call(uintptr(unsafe.Pointer(&c)))
	return c
}

func qpcSince(start int64) time.Duration {
	d := qpcNow() - start
	if d < 0 || qpcFreq == 0 {
		return 0
	}
	return time.Duration(float64(d) / qpcFreq * float64(time.Second))
}

// pinThread nails the calling thread to one logical CPU so a migration cannot
// corrupt a timing. Returns false if the OS refused.
func pinThread(core int) bool {
	r, _, _ := procSetThreadAffinity.Call(currentThread(), uintptr(1)<<uint(core))
	return r != 0
}

// sink keeps the compiler from optimising the spin away.
var sink uint64

func spin(iters int) uint64 {
	var x uint64 = 88172645463325252
	for i := 0; i < iters; i++ {
		x ^= x << 13
		x ^= x >> 7
		x ^= x << 17
		x = x*6364136223846793005 + 1442695040888963407
	}
	return x
}

type calibration struct {
	iters        int
	baseline     time.Duration
	cyclesPerSec float64 // measured while unobstructed, to convert cycles -> on-cpu seconds
	opsPerSec    float64 // sanity figure, printed so a bad calibration is obvious
	spread       float64 // slowest/fastest calibration run; high means a noisy host
	reliable     bool
	why          string // populated when reliable is false
	pinnedCore   int
}

func currentThread() uintptr {
	h, _, _ := procGetCurrentThreadHnd.Call()
	return h
}

// threadCycles returns this thread's executed cycle count.
func threadCycles() (uint64, bool) {
	var c uint64
	r, _, _ := procQueryThreadCycles.Call(currentThread(), uintptr(unsafe.Pointer(&c)))
	if r == 0 {
		return 0, false
	}
	return c, true
}

func threadCPU100ns() uint64 {
	var c, e, k, u syscall.Filetime
	r, _, _ := procGetThreadTimes.Call(currentThread(),
		uintptr(unsafe.Pointer(&c)), uintptr(unsafe.Pointer(&e)),
		uintptr(unsafe.Pointer(&k)), uintptr(unsafe.Pointer(&u)))
	if r == 0 {
		return 0
	}
	return (uint64(k.HighDateTime)<<32 | uint64(k.LowDateTime)) +
		(uint64(u.HighDateTime)<<32 | uint64(u.LowDateTime))
}

const (
	calTarget    = 30 * time.Millisecond
	maxOpsPerSec = 2e10 // no real core does 20 G-iterations/sec; above this the clock lied
	minOpsPerSec = 1e5
	maxSpread    = 5.0 // p90/p10 on identical work; beyond this there is no stable baseline
)

// calibrate sizes the workload to ~30ms of real work and records the least
// obstructed time seen. Sizing uses the MINIMUM of many runs, which is the
// least-disturbed estimate, so it converges even when the box is already
// under heavy load — the failure mode that ruined the first field capture was
// exiting on a single disturbed measurement.
func calibrate() calibration {
	runtime.LockOSThread()
	cal := calibration{pinnedCore: runtime.NumCPU() - 1}
	if cal.pinnedCore < 0 {
		cal.pinnedCore = 0
	}
	pinThread(cal.pinnedCore)

	if !initQPC() {
		cal.why = "QueryPerformanceCounter unavailable — no usable high-resolution clock"
		return cal
	}

	iters := 1000000
	var best, worst time.Duration
	for round := 0; round < 15; round++ {
		best, worst = time.Duration(1)<<62, 0
		for i := 0; i < 9; i++ {
			t0 := qpcNow()
			sink = spin(iters)
			d := qpcSince(t0)
			if d < best {
				best = d
			}
			if d > worst {
				worst = d
			}
		}
		if best <= 0 {
			if iters > 1<<30 {
				break
			}
			iters *= 8
			continue
		}
		if best >= calTarget/2 && best <= calTarget*2 {
			break
		}
		scale := float64(calTarget) / float64(best)
		if scale < 0.1 {
			scale = 0.1
		}
		if scale > 20 {
			scale = 20
		}
		next := int(float64(iters) * scale)
		if next < 10000 {
			next = 10000
		}
		if next == iters {
			break
		}
		iters = next
	}

	// Baseline from a low PERCENTILE, not the raw minimum. On a noisy host the
	// minimum is an extreme-value estimator: one lucky run anchors every later
	// ratio to an outlier. That is how the 2026-09-09 control run reported a
	// steady "3.9x slowdown" on a box that was behaving normally — its
	// min-of-9 baseline (37.95ms) was below every single time the run then
	// measured (min 45.2ms, median 149.2ms).
	runs := make([]time.Duration, 0, 25)
	for i := 0; i < 25; i++ {
		t0 := qpcNow()
		sink = spin(iters)
		if d := qpcSince(t0); d > 0 {
			runs = append(runs, d)
		}
	}
	sort.Slice(runs, func(i, j int) bool { return runs[i] < runs[j] })
	cal.iters = iters
	if len(runs) >= 10 {
		cal.baseline = runs[len(runs)/10]                                  // p10
		cal.spread = float64(runs[len(runs)*9/10]) / float64(cal.baseline) // p90/p10
	} else {
		cal.baseline = best
		if best > 0 {
			cal.spread = float64(worst) / float64(best)
		}
	}
	if cal.baseline > 0 {
		cal.opsPerSec = float64(iters) / cal.baseline.Seconds()
	}

	// Cycle rate, measured on the fastest of a fresh batch (that run is the one
	// least likely to have been interrupted, so cycles/wall is the true rate).
	fastest := time.Duration(1) << 62
	var fastestCycles uint64
	for i := 0; i < 9; i++ {
		c0, ok0 := threadCycles()
		t0 := qpcNow()
		sink = spin(iters)
		d := qpcSince(t0)
		c1, ok1 := threadCycles()
		if d > 0 && d < fastest && ok0 && ok1 && c1 > c0 {
			fastest, fastestCycles = d, c1-c0
		}
	}
	if fastestCycles > 0 && fastest > 0 {
		cal.cyclesPerSec = float64(fastestCycles) / fastest.Seconds()
	}

	switch {
	case cal.baseline <= 0:
		cal.why = "calibration measured zero elapsed time — clock resolution too coarse"
	case cal.opsPerSec > maxOpsPerSec:
		cal.why = "measured rate is physically impossible — the timer is lying (tick-quantized or unstable TSC)"
	case cal.opsPerSec < minOpsPerSec:
		cal.why = "measured rate implausibly low — calibration was obstructed throughout"
	case cal.baseline < calTarget/4:
		cal.why = "workload too short to time reliably on this host"
	case cal.spread > maxSpread:
		// Identical work varying this much second to second means no single
		// number describes "full speed" here, so every ratio against it would
		// be noise dressed as a measurement.
		cal.why = fmt.Sprintf("identical work varied %.1fx across calibration runs — this host has no stable "+
			"full-speed baseline, so steal ratios would be meaningless (something is contending for the core, "+
			"or the host is throttling)", cal.spread)
	default:
		cal.reliable = true
	}
	return cal
}

// run executes one canary pass, returning elapsed time and the time actually
// spent executing on a core.
func (c calibration) run() (elapsed time.Duration, onCPU time.Duration) {
	if c.cyclesPerSec > 0 {
		c0, ok0 := threadCycles()
		t0 := qpcNow()
		sink = spin(c.iters)
		elapsed = qpcSince(t0)
		c1, ok1 := threadCycles()
		if ok0 && ok1 && c1 > c0 {
			onCPU = time.Duration(float64(c1-c0) / c.cyclesPerSec * float64(time.Second))
		}
		return elapsed, onCPU
	}

	t := threadCPU100ns()
	t0 := qpcNow()
	sink = spin(c.iters)
	elapsed = qpcSince(t0)
	onCPU = time.Duration(threadCPU100ns()-t) * 100
	return elapsed, onCPU
}
