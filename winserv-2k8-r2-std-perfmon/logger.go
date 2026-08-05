package main

import (
	"fmt"
	"os"
	"sync"
	"time"
)

// logger appends timestamped CRLF lines (2008 R2 notepad can't read bare LF)
// to a file, mirrors them to stdout, and rotates at a size cap keeping one
// .1 backup.
type logger struct {
	mu      sync.Mutex
	path    string
	f       *os.File
	size    int64
	maxSize int64
}

func newLogger(path string, maxMB int) (*logger, error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return nil, fmt.Errorf("open log %s: %w", path, err)
	}
	st, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	return &logger{path: path, f: f, size: st.Size(), maxSize: int64(maxMB) << 20}, nil
}

func (l *logger) Printf(format string, args ...any) {
	line := time.Now().Format("2006-01-02 15:04:05") + " " + fmt.Sprintf(format, args...)
	l.mu.Lock()
	defer l.mu.Unlock()
	fmt.Println(line)
	if l.f == nil {
		return
	}
	if l.maxSize > 0 && l.size > l.maxSize {
		l.rotate()
	}
	if n, err := l.f.WriteString(line + "\r\n"); err == nil {
		l.size += int64(n)
	}
}

func (l *logger) rotate() {
	l.f.Close()
	os.Remove(l.path + ".1")
	os.Rename(l.path, l.path+".1")
	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		l.f = nil // keep running, console-only
		return
	}
	l.f = f
	l.size = 0
}

func (l *logger) Close() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.f != nil {
		l.f.Close()
	}
}
