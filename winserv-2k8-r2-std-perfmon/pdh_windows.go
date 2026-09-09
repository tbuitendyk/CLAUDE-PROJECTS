//go:build windows

package main

// PDH counters for what GetSystemTimes/GlobalMemoryStatusEx cannot tell us.
// Every counter is added best-effort: anything this box does not expose is
// skipped and named once at startup rather than killing the run, and a missing
// counter is never silently read as a healthy zero.
//
// PdhAddEnglishCounterW is Vista+, so this works on 2008 R2 regardless of the
// OS display language.

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

type pdhFmtCounterValue struct {
	CStatus uint32
	_       uint32
	Double  float64
}

type pdhCounter struct {
	key string
	h   uintptr
	ok  bool
	val float64
}

type pdhQuery struct {
	query uintptr
	ctrs  []*pdhCounter
	byKey map[string]*pdhCounter
	cores []*pdhCounter
}

// pdhSample is one collection's worth of readings.
type pdhSample struct {
	diskQueue  float64
	pagesSec   float64
	diskReadMs float64 // Avg. Disk sec/Read, converted to ms
	diskWrMs   float64 // Avg. Disk sec/Write, converted to ms
	maxCore    float64 // busiest single core
	maxCoreIdx int
	ok         bool
}

func newPdhQuery() (*pdhQuery, error) {
	q := &pdhQuery{byKey: map[string]*pdhCounter{}}
	if r, _, _ := procPdhOpenQuery.Call(0, 0, uintptr(unsafe.Pointer(&q.query))); r != 0 {
		return nil, fmt.Errorf("PdhOpenQuery: 0x%x", r)
	}

	q.add("disk_queue", `\PhysicalDisk(_Total)\Avg. Disk Queue Length`)
	q.add("pages_sec", `\Memory\Pages/sec`)
	// Latency, not just queue depth. The 2026-09-09 capture settled this: reads
	// hit 227ms while the queue never rose above 0.24, so a queue-length
	// threshold can sit through a slowdown users are shouting about.
	q.add("disk_read_sec", `\PhysicalDisk(_Total)\Avg. Disk sec/Read`)
	q.add("disk_write_sec", `\PhysicalDisk(_Total)\Avg. Disk sec/Write`)

	// Per-core, because one pegged core is only 1/N of the all-core average.
	for i := 0; i < runtime.NumCPU(); i++ {
		if c := q.add(fmt.Sprintf("core_%d", i), fmt.Sprintf(`\Processor(%d)\%% Processor Time`, i)); c.ok {
			q.cores = append(q.cores, c)
		}
	}

	// Rate counters need two collections; prime the first here so the main
	// loop's first collect already yields values.
	procPdhCollectQueryData.Call(q.query)
	return q, nil
}

func (q *pdhQuery) add(key, path string) *pdhCounter {
	c := &pdhCounter{key: key}
	q.ctrs = append(q.ctrs, c)
	q.byKey[key] = c
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return c
	}
	if r, _, _ := procPdhAddEnglishCounter.Call(q.query, uintptr(unsafe.Pointer(p)), 0, uintptr(unsafe.Pointer(&c.h))); r == 0 {
		c.ok = true
	}
	return c
}

func (q *pdhQuery) collect() pdhSample {
	if r, _, _ := procPdhCollectQueryData.Call(q.query); r != 0 {
		return pdhSample{maxCoreIdx: -1}
	}
	for _, c := range q.ctrs {
		if !c.ok {
			continue
		}
		var v pdhFmtCounterValue
		if r, _, _ := procPdhGetFormattedCounterValue.Call(c.h, pdhFmtDouble, 0, uintptr(unsafe.Pointer(&v))); r == 0 {
			c.val = v.Double
		}
	}
	s := pdhSample{
		diskQueue:  q.val("disk_queue"),
		pagesSec:   q.val("pages_sec"),
		diskReadMs: q.val("disk_read_sec") * 1000,
		diskWrMs:   q.val("disk_write_sec") * 1000,
		maxCoreIdx: -1,
		ok:         true,
	}
	for i, c := range q.cores {
		if c.val > s.maxCore {
			s.maxCore, s.maxCoreIdx = c.val, i
		}
	}
	return s
}

func (q *pdhQuery) val(key string) float64 {
	if c, ok := q.byKey[key]; ok && c.ok {
		return c.val
	}
	return 0
}

func (q *pdhQuery) have(key string) bool {
	c, ok := q.byKey[key]
	return ok && c.ok
}

// missing names the counters this box does not expose, so a zero is never
// mistaken for a healthy reading.
func (q *pdhQuery) missing() []string {
	var out []string
	for _, c := range q.ctrs {
		if !c.ok {
			out = append(out, c.key)
		}
	}
	sort.Strings(out)
	return out
}
