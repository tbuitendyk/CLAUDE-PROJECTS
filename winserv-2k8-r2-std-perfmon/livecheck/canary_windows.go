//go:build windows

package main

// The CPU canary. Instead of sleeping and checking whether we woke up late
// (which only catches multi-second freezes), we do a FIXED amount of
// arithmetic and time it. Two numbers come out:
//
//   steal    = wall now / wall when unobstructed. 2.0 means the same work took
//              twice as long, i.e. we got half the CPU we asked for.
//   on-cpu   = how much of that wall time we were actually executing, from the
//              thread's own cycle counter. Near 1.0 while steal is high means
//              the core ran us the whole time but ran slow; well below 1.0
//              means something took the core away — on a VM that is the
//              hypervisor (CPU ready / co-stop), which no in-guest CPU% shows.

import (
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32dll             = syscall.NewLazyDLL("kernel32.dll")
	procQueryThreadCycles   = kernel32dll.NewProc("QueryThreadCycleTime")
	procGetCurrentThreadHnd = kernel32dll.NewProc("GetCurrentThread")
	procGetThreadTimes      = kernel32dll.NewProc("GetThreadTimes")
)

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
}

func currentThread() uintptr {
	h, _, _ := procGetCurrentThreadHnd.Call()
	return h
}

// threadCycles returns this thread's executed cycle count. Falls back to
// GetThreadTimes (100ns kernel+user, ~15ms granularity) when the cycle
// counter is unavailable.
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

// calibrate sizes the workload to ~25ms and records the best (least obstructed)
// wall time seen, plus the cycle rate observed while running flat out.
func calibrate() calibration {
	runtime.LockOSThread()

	iters := 200000
	for attempts := 0; attempts < 30; attempts++ {
		start := time.Now()
		sink = spin(iters)
		d := time.Since(start)
		if d >= 20*time.Millisecond {
			break
		}
		if d <= 0 {
			iters *= 8
			continue
		}
		factor := float64(25*time.Millisecond) / float64(d)
		if factor < 1.5 {
			factor = 1.5
		}
		if factor > 40 {
			factor = 40
		}
		iters = int(float64(iters) * factor)
	}

	best := time.Duration(1) << 62
	var bestCycles uint64
	for i := 0; i < 15; i++ {
		c0, haveCycles := threadCycles()
		start := time.Now()
		sink = spin(iters)
		d := time.Since(start)
		c1, _ := threadCycles()
		if d < best {
			best = d
			if haveCycles && c1 > c0 {
				bestCycles = c1 - c0
			}
		}
	}

	cal := calibration{iters: iters, baseline: best}
	if bestCycles > 0 && best > 0 {
		cal.cyclesPerSec = float64(bestCycles) / best.Seconds()
	}
	return cal
}

// run executes one canary pass, returning wall time and the time actually
// spent executing on a core.
func (c calibration) run() (wall time.Duration, onCPU time.Duration) {
	if c.cyclesPerSec > 0 {
		c0, ok0 := threadCycles()
		start := time.Now()
		sink = spin(c.iters)
		wall = time.Since(start)
		c1, ok1 := threadCycles()
		if ok0 && ok1 && c1 > c0 {
			onCPU = time.Duration(float64(c1-c0) / c.cyclesPerSec * float64(time.Second))
		}
		return wall, onCPU
	}

	t0 := threadCPU100ns()
	start := time.Now()
	sink = spin(c.iters)
	wall = time.Since(start)
	onCPU = time.Duration(threadCPU100ns()-t0) * 100
	return wall, onCPU
}
