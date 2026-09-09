//go:build windows

package main

// Minimal per-process CPU sampling, so every flagged second can name a
// culprit. Processes we cannot open are skipped — run elevated to see them all.

import (
	"fmt"
	"runtime"
	"syscall"
	"time"
	"unsafe"
)

var (
	psapiDLL                      = syscall.NewLazyDLL("psapi.dll")
	procEnumProcesses             = psapiDLL.NewProc("EnumProcesses")
	procOpenProcess               = kernel32dll.NewProc("OpenProcess")
	procCloseHandle               = kernel32dll.NewProc("CloseHandle")
	procGetProcessTimes           = kernel32dll.NewProc("GetProcessTimes")
	procQueryFullProcessImageName = kernel32dll.NewProc("QueryFullProcessImageNameW")
)

const (
	processQueryInformation        = 0x0400
	processQueryLimitedInformation = 0x1000
)

type procSample struct {
	pid    uint32
	name   string
	cpuPct float64
}

type procPrev struct {
	cpu100ns uint64
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

func (t *procTable) sample(now time.Time) []procSample {
	gap := now.Sub(t.last).Seconds()
	t.last = now

	pids, err := enumProcesses()
	if err != nil {
		return nil
	}
	var out []procSample
	next := make(map[uint32]procPrev, len(pids))
	for _, pid := range pids {
		if pid == 0 {
			continue
		}
		h, ok := openProc(pid)
		if !ok {
			continue
		}
		cpu, cpuOK := procCPU100ns(h)
		p, seen := t.prev[pid]
		name := p.name
		if name == "" {
			name = procName(h, pid)
		}
		closeHandle(h)
		if !cpuOK {
			continue
		}
		next[pid] = procPrev{cpu100ns: cpu, name: name}
		if !seen || gap <= 0 {
			continue
		}
		out = append(out, procSample{
			pid:    pid,
			name:   name,
			cpuPct: float64(cpu-p.cpu100ns) / 1e7 / gap * 100 / t.cores,
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
			uintptr(unsafe.Pointer(&pids[0])), uintptr(len(pids)*4), uintptr(unsafe.Pointer(&needed)))
		if r == 0 {
			return nil, err
		}
		if n := int(needed / 4); n < len(pids) {
			return pids[:n], nil
		}
		pids = make([]uint32, len(pids)*2)
	}
}

func openProc(pid uint32) (syscall.Handle, bool) {
	h, _, _ := procOpenProcess.Call(processQueryInformation, 0, uintptr(pid))
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
	return (uint64(k.HighDateTime)<<32 | uint64(k.LowDateTime)) +
		(uint64(u.HighDateTime)<<32 | uint64(u.LowDateTime)), true
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
