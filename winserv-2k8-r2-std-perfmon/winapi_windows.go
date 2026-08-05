//go:build windows

package main

// Thin wrappers over the Win32 calls we need. Everything here is present and
// stable on NT 6.1 (Server 2008 R2): GetSystemTimes / GlobalMemoryStatusEx /
// QueryFullProcessImageNameW are Vista+, psapi's EnumProcesses and
// GetProcessMemoryInfo go back to NT 4.

import (
	"fmt"
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	psapi    = syscall.NewLazyDLL("psapi.dll")

	procGetSystemTimes            = kernel32.NewProc("GetSystemTimes")
	procGlobalMemoryStatusEx      = kernel32.NewProc("GlobalMemoryStatusEx")
	procOpenProcess               = kernel32.NewProc("OpenProcess")
	procCloseHandle               = kernel32.NewProc("CloseHandle")
	procGetProcessTimes           = kernel32.NewProc("GetProcessTimes")
	procGetProcessIoCounters      = kernel32.NewProc("GetProcessIoCounters")
	procQueryFullProcessImageName = kernel32.NewProc("QueryFullProcessImageNameW")
	procEnumProcesses             = psapi.NewProc("EnumProcesses")
	procGetProcessMemoryInfo      = psapi.NewProc("GetProcessMemoryInfo")
)

func ft(t syscall.Filetime) uint64 { return uint64(t.HighDateTime)<<32 | uint64(t.LowDateTime) }

// ---- system-wide CPU ----

type sysTimes struct{ idle, kernel, user uint64 }

func getSystemTimes() (sysTimes, error) {
	var idle, kern, user syscall.Filetime
	r, _, err := procGetSystemTimes.Call(
		uintptr(unsafe.Pointer(&idle)),
		uintptr(unsafe.Pointer(&kern)),
		uintptr(unsafe.Pointer(&user)))
	if r == 0 {
		return sysTimes{}, err
	}
	return sysTimes{ft(idle), ft(kern), ft(user)}, nil
}

// cpuBusyPct: kernel time includes idle time, so busy = (kernel-idle)+user.
func cpuBusyPct(a, b sysTimes) float64 {
	total := float64((b.kernel - a.kernel) + (b.user - a.user))
	if total <= 0 {
		return 0
	}
	idle := float64(b.idle - a.idle)
	pct := (total - idle) / total * 100
	if pct < 0 {
		pct = 0
	}
	return pct
}

// ---- system-wide memory ----

type memStatus struct {
	Length, MemoryLoad                                 uint32
	TotalPhys, AvailPhys, TotalPageFile, AvailPageFile uint64
	TotalVirtual, AvailVirtual, AvailExtendedVirtual   uint64
}

func globalMemoryStatusEx() (memStatus, error) {
	var m memStatus
	m.Length = uint32(unsafe.Sizeof(m))
	r, _, err := procGlobalMemoryStatusEx.Call(uintptr(unsafe.Pointer(&m)))
	if r == 0 {
		return m, err
	}
	return m, nil
}

// ---- per-process sampling ----

type procSample struct {
	pid       uint32
	name      string
	cpuPct    float64 // share of ALL cores over the window, same scale as system busy%
	wsMB      float64 // working set right now
	ioMBs     float64 // read+write+other bytes/sec over the window
	faultsSec float64 // page faults/sec over the window (soft+hard)
}

type procPrev struct {
	cpu100ns uint64
	ioBytes  uint64
	faults   uint32
	name     string
}

type procTable struct {
	prev  map[uint32]procPrev
	last  time.Time
	cores float64
}

func newProcTable() *procTable {
	return &procTable{prev: map[uint32]procPrev{}, cores: float64(runtime.NumCPU())}
}

// sample walks every visible process and returns rate deltas since the
// previous call. Processes we cannot open (other users' processes when not
// elevated, protected processes) are silently skipped.
func (t *procTable) sample(now time.Time) []procSample {
	gapSec := now.Sub(t.last).Seconds()
	t.last = now

	pids, err := enumProcesses()
	if err != nil {
		return nil
	}

	var out []procSample
	next := make(map[uint32]procPrev, len(pids))
	for _, pid := range pids {
		if pid == 0 { // Idle pseudo-process
			continue
		}
		h, ok := openProc(pid)
		if !ok {
			continue
		}
		cpu, cpuOK := procCPU100ns(h)
		mem, _ := procMemCounters(h)
		io, _ := procIOBytes(h)

		p, seen := t.prev[pid]
		name := p.name
		if name == "" {
			name = procName(h, pid)
		}
		closeHandle(h)

		if !cpuOK {
			continue
		}
		next[pid] = procPrev{cpu100ns: cpu, ioBytes: io, faults: mem.pageFaultCount, name: name}
		if !seen || gapSec <= 0 {
			continue // first sighting: baseline only
		}
		out = append(out, procSample{
			pid:       pid,
			name:      name,
			cpuPct:    float64(cpu-p.cpu100ns) / 1e7 / gapSec * 100 / t.cores,
			wsMB:      float64(mem.workingSet) / (1 << 20),
			ioMBs:     float64(io-p.ioBytes) / gapSec / (1 << 20),
			faultsSec: float64(mem.pageFaultCount-p.faults) / gapSec,
		})
	}
	t.prev = next
	return out
}

func enumProcesses() ([]uint32, error) {
	pids := make([]uint32, 1024)
	for {
		var needed uint32
		r, _, err := procEnumProcesses.Call(
			uintptr(unsafe.Pointer(&pids[0])),
			uintptr(len(pids)*4),
			uintptr(unsafe.Pointer(&needed)))
		if r == 0 {
			return nil, err
		}
		n := int(needed / 4)
		if n < len(pids) {
			return pids[:n], nil
		}
		pids = make([]uint32, len(pids)*2)
	}
}

const (
	processQueryInformation        = 0x0400
	processVMRead                  = 0x0010
	processQueryLimitedInformation = 0x1000
)

// openProc tries for full query rights first (GetProcessMemoryInfo needs
// QUERY_INFORMATION|VM_READ on NT 6.1), falling back to limited rights which
// still allow times and IO counters.
func openProc(pid uint32) (syscall.Handle, bool) {
	h, _, _ := procOpenProcess.Call(processQueryInformation|processVMRead, 0, uintptr(pid))
	if h != 0 {
		return syscall.Handle(h), true
	}
	h, _, _ = procOpenProcess.Call(processQueryLimitedInformation, 0, uintptr(pid))
	return syscall.Handle(h), h != 0
}

func closeHandle(h syscall.Handle) { procCloseHandle.Call(uintptr(h)) }

func procCPU100ns(h syscall.Handle) (uint64, bool) {
	var c, e, k, u syscall.Filetime
	r, _, _ := procGetProcessTimes.Call(uintptr(h),
		uintptr(unsafe.Pointer(&c)), uintptr(unsafe.Pointer(&e)),
		uintptr(unsafe.Pointer(&k)), uintptr(unsafe.Pointer(&u)))
	if r == 0 {
		return 0, false
	}
	return ft(k) + ft(u), true
}

type ioCounters struct {
	ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes uint64
}

func procIOBytes(h syscall.Handle) (uint64, bool) {
	var io ioCounters
	r, _, _ := procGetProcessIoCounters.Call(uintptr(h), uintptr(unsafe.Pointer(&io)))
	if r == 0 {
		return 0, false
	}
	return io.ReadBytes + io.WriteBytes + io.OtherBytes, true
}

type processMemoryCounters struct {
	cb, pageFaultCount               uint32
	peakWorkingSet, workingSet       uintptr
	quotaPeakPaged, quotaPaged       uintptr
	quotaPeakNonPaged, quotaNonPaged uintptr
	pagefileUsage, peakPagefileUsage uintptr
}

func procMemCounters(h syscall.Handle) (processMemoryCounters, bool) {
	var m processMemoryCounters
	m.cb = uint32(unsafe.Sizeof(m))
	r, _, _ := procGetProcessMemoryInfo.Call(uintptr(h), uintptr(unsafe.Pointer(&m)), uintptr(m.cb))
	return m, r != 0
}

func procName(h syscall.Handle, pid uint32) string {
	if pid == 4 {
		return "System"
	}
	buf := make([]uint16, 512)
	size := uint32(len(buf))
	r, _, _ := procQueryFullProcessImageName.Call(uintptr(h), 0,
		uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)))
	if r == 0 {
		return fmt.Sprintf("pid-%d", pid)
	}
	full := syscall.UTF16ToString(buf[:size])
	for i := len(full) - 1; i >= 0; i-- {
		if full[i] == '\\' {
			return full[i+1:]
		}
	}
	return full
}
