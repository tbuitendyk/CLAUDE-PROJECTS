//go:build windows

package main

// A tolerant PDH counter table. Every counter is added best-effort: anything
// this box does not expose (VMware Tools counters on a physical box, SMB
// counters with the Server service disabled) is skipped and named at startup
// rather than killing the run. PdhAddEnglishCounterW is used so the counter
// paths work regardless of the OS display language.

import (
	"fmt"
	"runtime"
	"sort"
	"syscall"
	"unsafe"
)

var (
	pdhDLL                          = syscall.NewLazyDLL("pdh.dll")
	procPdhOpenQuery                = pdhDLL.NewProc("PdhOpenQueryW")
	procPdhAddEnglishCounter        = pdhDLL.NewProc("PdhAddEnglishCounterW")
	procPdhCollectQueryData         = pdhDLL.NewProc("PdhCollectQueryData")
	procPdhGetFormattedCounterValue = pdhDLL.NewProc("PdhGetFormattedCounterValue")
)

const pdhFmtDouble = 0x00000200

type pdhValue struct {
	CStatus uint32
	_       uint32
	Double  float64
}

type counter struct {
	key  string
	path string
	h    uintptr
	ok   bool
	val  float64
}

type query struct {
	q     uintptr
	ctrs  []*counter
	byKey map[string]*counter
	cores []*counter
}

func newQuery() (*query, error) {
	q := &query{byKey: map[string]*counter{}}
	if r, _, _ := procPdhOpenQuery.Call(0, 0, uintptr(unsafe.Pointer(&q.q))); r != 0 {
		return nil, fmt.Errorf("PdhOpenQuery returned 0x%x", r)
	}

	wanted := []struct{ key, path string }{
		{"cpu_total", `\Processor(_Total)\% Processor Time`},
		{"rdy_queue", `\System\Processor Queue Length`},
		{"ctx_switches", `\System\Context Switches/sec`},
		{"avail_mb", `\Memory\Available MBytes`},
		{"pages_sec", `\Memory\Pages/sec`},
		// latency, not queue length — queue stayed ~0 through every logged incident
		{"disk_read_sec", `\PhysicalDisk(_Total)\Avg. Disk sec/Read`},
		{"disk_write_sec", `\PhysicalDisk(_Total)\Avg. Disk sec/Write`},
		{"disk_queue", `\PhysicalDisk(_Total)\Avg. Disk Queue Length`},
		{"disk_xfers", `\PhysicalDisk(_Total)\Disk Transfers/sec`},
		// SMB serving — shared .DBF/.CDX contention lives here
		{"srv_files_open", `\Server\Files Open`},
		{"srv_sessions", `\Server\Server Sessions`},
		{"srv_shortages", `\Server\Work Item Shortages`},
		{"srv_work_queue", `\Server Work Queues(Blocking Queue)\Queue Length`},
		// VMware Tools host-view counters (absent unless Tools' perfmon component is installed)
		{"vm_balloon", `\VM Memory\Memory Ballooned`},
		{"vm_swapped", `\VM Memory\Memory Swapped`},
		{"vm_eff_mhz", `\VM Processor(_Total)\Effective VM Speed in MHz`},
		{"vm_host_mhz", `\VM Processor(_Total)\Host processor speed in MHz`},
	}
	for _, w := range wanted {
		q.add(w.key, w.path)
	}

	// per-core, so one pegged core cannot hide inside the all-core average
	for i := 0; i < runtime.NumCPU(); i++ {
		c := q.add(fmt.Sprintf("core_%d", i), fmt.Sprintf(`\Processor(%d)\%% Processor Time`, i))
		if c.ok {
			q.cores = append(q.cores, c)
		}
	}
	return q, nil
}

func (q *query) add(key, path string) *counter {
	c := &counter{key: key, path: path}
	q.ctrs = append(q.ctrs, c)
	q.byKey[key] = c
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return c
	}
	if r, _, _ := procPdhAddEnglishCounter.Call(q.q, uintptr(unsafe.Pointer(p)), 0, uintptr(unsafe.Pointer(&c.h))); r == 0 {
		c.ok = true
	}
	return c
}

func (q *query) collect() {
	if r, _, _ := procPdhCollectQueryData.Call(q.q); r != 0 {
		return
	}
	for _, c := range q.ctrs {
		if !c.ok {
			continue
		}
		var v pdhValue
		if r, _, _ := procPdhGetFormattedCounterValue.Call(c.h, pdhFmtDouble, 0, uintptr(unsafe.Pointer(&v))); r == 0 {
			c.val = v.Double
		}
	}
}

func (q *query) val(key string) float64 {
	if c, ok := q.byKey[key]; ok && c.ok {
		return c.val
	}
	return 0
}

func (q *query) have(key string) bool {
	c, ok := q.byKey[key]
	return ok && c.ok
}

func (q *query) maxCore() (float64, int) {
	best, idx := 0.0, -1
	for i, c := range q.cores {
		if c.val > best {
			best, idx = c.val, i
		}
	}
	return best, idx
}

// missing names the counters this box does not expose, so the operator knows
// what is absent instead of reading a silent zero as "healthy".
func (q *query) missing() []string {
	var out []string
	for _, c := range q.ctrs {
		if !c.ok {
			out = append(out, c.key)
		}
	}
	sort.Strings(out)
	return out
}
