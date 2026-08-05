# winserv-2k8-r2-std-perfmon

A quick-and-dirty monitoring binary for **Windows Server 2008 R2 Standard**
(SP1, x64). It watches server resources in real time and, when the box slows
down, logs the event **and the culprit** (the process(es) responsible) to a
plain-text log for later review.

## Goal

- Continuously sample core resources (CPU, memory, disk, …) at a short interval.
- Detect "slow-down" conditions (e.g. sustained high CPU, memory exhaustion,
  long disk queues) using simple thresholds.
- On detection, write a timestamped log entry naming the top offending
  processes with their usage numbers.
- Single small binary, minimal footprint, no installer — drop it on the box
  and run it.

## Target-OS constraints (why choices here look dated)

Server 2008 R2 is NT 6.1 (Windows 7 era, x64 only). Notably:

- Go **1.20.x is the last Go release** that runs on / targets it (Go 1.21+
  requires Windows 10 / Server 2016).
- .NET Framework up to 4.8 is installable, but nothing newer (no .NET
  Core / modern .NET).
- The native Win32 APIs (PDH performance counters, `GetSystemTimes`,
  `GlobalMemoryStatusEx`, process enumeration) are all present and stable.

## Status

Scaffold only — implementation direction (toolchain, exact slow-down
definitions, run mode) being confirmed before code is written. See the
branch `CLAUDE.md` for the working-style rule that requires this.
