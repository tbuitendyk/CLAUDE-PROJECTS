package main

// Optional continuous record of every sample.
//
// The log file records only threshold crossings and 6-hourly heartbeats. That
// turned out to be too sparse: on 2026-09-16/17 users reported an afternoon
// and a morning of bad performance, and the log held four 5-minute events
// scattered across 20 hours — enough to prove the cause was disk latency, not
// enough to show how often it was spiking in between. This appends one row per
// sample so the whole profile is recoverable.

import (
	"encoding/csv"
	"fmt"
	"os"
	"strconv"
	"time"
)

type sampleWriter struct {
	f *os.File
	w *csv.Writer
}

func newSampleWriter(path string) (*sampleWriter, error) {
	st, statErr := os.Stat(path)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return nil, fmt.Errorf("open csv %s: %w", path, err)
	}
	sw := &sampleWriter{f: f, w: csv.NewWriter(f)}
	if statErr != nil || st.Size() == 0 {
		sw.w.Write([]string{"time", "gap_s", "cpu_pct", "max_core_pct", "max_core_idx",
			"mem_load_pct", "avail_mb", "cache_mb", "disk_queue", "disk_read_ms", "disk_write_ms",
			"pages_sec", "pages_input_sec", "probe_ms", "procs", "top_cpu", "top_io"})
		sw.w.Flush()
	}
	return sw, nil
}

func (s *sampleWriter) add(t time.Time, gap time.Duration, cpu float64, p pdhSample,
	memLoad uint32, availMB uint64, probeMs float64, procs int, topCPU, topIO string) {
	if s == nil {
		return
	}
	f := func(v float64) string { return strconv.FormatFloat(v, 'f', 3, 64) }
	s.w.Write([]string{
		t.Format("2006-01-02 15:04:05"),
		f(gap.Seconds()),
		f(cpu),
		f(p.maxCore),
		strconv.Itoa(p.maxCoreIdx),
		strconv.FormatUint(uint64(memLoad), 10),
		strconv.FormatUint(availMB, 10),
		f(p.cacheMB),
		f(p.diskQueue),
		f(p.diskReadMs),
		f(p.diskWrMs),
		f(p.pagesSec),
		f(p.pagesIn),
		f(probeMs),
		strconv.Itoa(procs),
		topCPU,
		topIO,
	})
	s.w.Flush()
}

func (s *sampleWriter) Close() {
	if s == nil {
		return
	}
	s.w.Flush()
	s.f.Close()
}
