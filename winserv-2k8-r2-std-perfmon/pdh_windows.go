//go:build windows

package main

// PDH counters for the two things GetSystemTimes/GlobalMemoryStatusEx can't
// tell us: disk queue depth and hard-paging rate. PdhAddEnglishCounterW is
// Vista+, so it works on 2008 R2 regardless of the OS display language.

import (
	"fmt"
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

type pdhQuery struct {
	query     uintptr
	diskQueue uintptr
	pagesSec  uintptr
}

func newPdhQuery() (*pdhQuery, error) {
	q := &pdhQuery{}
	if r, _, _ := procPdhOpenQuery.Call(0, 0, uintptr(unsafe.Pointer(&q.query))); r != 0 {
		return nil, fmt.Errorf("PdhOpenQuery: 0x%x", r)
	}
	var err error
	if q.diskQueue, err = q.add(`\PhysicalDisk(_Total)\Avg. Disk Queue Length`); err != nil {
		return nil, err
	}
	if q.pagesSec, err = q.add(`\Memory\Pages/sec`); err != nil {
		return nil, err
	}
	// Rate counters need two collections; prime the first here so the main
	// loop's first collect already yields values.
	procPdhCollectQueryData.Call(q.query)
	return q, nil
}

func (q *pdhQuery) add(path string) (uintptr, error) {
	p, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	var h uintptr
	if r, _, _ := procPdhAddEnglishCounter.Call(q.query, uintptr(unsafe.Pointer(p)), 0, uintptr(unsafe.Pointer(&h))); r != 0 {
		return 0, fmt.Errorf("PdhAddEnglishCounter(%s): 0x%x", path, r)
	}
	return h, nil
}

// collect returns (avg disk queue length, pages/sec, ok) for the elapsed window.
func (q *pdhQuery) collect() (float64, float64, bool) {
	if r, _, _ := procPdhCollectQueryData.Call(q.query); r != 0 {
		return 0, 0, false
	}
	dq, ok1 := q.value(q.diskQueue)
	ps, ok2 := q.value(q.pagesSec)
	return dq, ps, ok1 && ok2
}

func (q *pdhQuery) value(counter uintptr) (float64, bool) {
	var v pdhFmtCounterValue
	if r, _, _ := procPdhGetFormattedCounterValue.Call(counter, pdhFmtDouble, 0, uintptr(unsafe.Pointer(&v))); r != 0 {
		return 0, false
	}
	return v.Double, true
}
