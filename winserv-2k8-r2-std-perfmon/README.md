# winserv-2k8-r2-std-perfmon

A quick-and-dirty, self-contained monitoring binary for **Windows Server
2008 R2 Standard** (SP1, x64). It samples server resources every 5 minutes
and, when the box slows down, writes one simple log line with the date/time,
what went bad, and the likely culprit processes.

No installer, no runtime dependencies, no config files — one 1.6 MB
`perfmon.exe` you drop on the server.

## What it watches (per 5-minute window, defaults shown)

| Condition | Fires when | Culprits named |
|-----------|------------|----------------|
| `cpu`     | average CPU ≥ 90% | top processes by CPU% |
| `mem`     | available RAM < 256 MB or memory load ≥ 95% | top processes by working set |
| `disk`    | avg disk queue length ≥ 4 (`PhysicalDisk(_Total)`) | top processes by I/O rate |
| `paging`  | ≥ 500 pages/sec (hard paging / thrashing) | top by page faults + I/O rate |
| `STALL`   | its own sampling tick woke > 5 s late (scheduler starvation) | top processes by CPU% |

Log lines look like:

```
2026-08-05 14:35:02 EVENT cpu: 96.8% busy (threshold 90%) | top cpu: sqlservr.exe(1284) 61.2%, w3wp.exe(2340) 22.4%, ...
2026-08-05 14:45:02 CLEAR cpu: recovered after 10m0s
2026-08-05 20:35:02 HEARTBEAT cpu 12.3% | mem 41% used, 4813MB avail | diskq 0.12 | pages/s 3 | procs 87
```

`EVENT` = condition started, `STILL` = still bad (re-logged every 10 min),
`CLEAR` = recovered, `HEARTBEAT` = proof-of-life every 6 h. The log is
CRLF-terminated (2008 R2 notepad-friendly), written next to the exe as
`perfmon.log`, auto-rotated at 10 MB keeping one `.1` backup.

## Deploy

1. Copy `dist/perfmon.exe` (and optionally the two `.bat` files) into a
   directory on the server, e.g. `C:\perfmon\`.
2. Either just run `perfmon.exe` in a console (Ctrl+C stops it), or run
   `install-task.bat` **elevated** to register it as a boot-time scheduled
   task running as SYSTEM (recommended — elevated means every process is
   visible for culprit naming, and it survives reboots).
3. `uninstall-task.bat` (elevated) stops and removes the task.

Run it elevated if you can: without admin rights it still measures the
system-wide numbers, but can't open other users'/service processes, so
culprit lists may be incomplete.

## Tuning

Everything is a flag; `perfmon.exe -h` lists them all. The interesting ones:

```
perfmon.exe -interval 5m -cpu 90 -mem-avail-mb 256 -diskq 4 -pages 500 -top 3 -log C:\perfmon\perfmon.log
```

For a quick live test, shrink the window and watch the console:

```
perfmon.exe -interval 5s -heartbeat 30s -debug
```

`-diskq`: the classic rule of thumb is a sustained queue of ~2 per physical
spindle; default 4 assumes a small array — lower it to 2 for a single disk.

## Building

Cross-compiled from Linux/anything; **must use Go 1.20.x** (`go1.20.14` is
the final one) because Go ≥ 1.21 dropped Windows 7 / Server 2008 R2 (NT 6.1)
support — a 1.21+ binary simply won't start on the target.

```
GO=/path/to/go1.20.14/bin/go ./build.sh    # → dist/perfmon.exe
```

Pure stdlib — no module downloads needed. All OS access goes through Win32
calls that exist on NT 6.1: `GetSystemTimes`, `GlobalMemoryStatusEx`,
psapi's `EnumProcesses`/`GetProcessMemoryInfo`, `GetProcessTimes`,
`GetProcessIoCounters`, `QueryFullProcessImageNameW`, and PDH
(`PdhAddEnglishCounterW`, so it works on any OS display language).

## Troubleshooting

**The log goes silent ~3 days after every boot** (last heartbeat 66–72 h
after the `START` line, then nothing until the next reboot): that is Windows
Task Scheduler's default *ExecutionTimeLimit* of 72 hours killing the task.
`schtasks /Create` cannot disable it, so `install-task.bat` now patches the
task XML (`ExecutionTimeLimit` → `PT0S`, i.e. unlimited) via
`remove-task-time-limit.ps1` and re-registers. If you installed with an
older version of the script, just re-run the current `install-task.bat`
elevated — it recreates the task in place.

## Files

- `main.go` — flags, sampling loop, event state machine (fire/still/clear
  with hysteresis), culprit ranking
- `winapi_windows.go` — Win32 wrappers: system CPU/memory + per-process
  CPU/working-set/IO/page-fault deltas
- `pdh_windows.go` — PDH counters: disk queue length, pages/sec
- `logger.go` — CRLF log file with size rotation, mirrored to stdout
- `build.sh` — cross-compile (enforces Go 1.20.x)
- `install-task.bat` / `uninstall-task.bat` — boot-time scheduled task as SYSTEM
- `remove-task-time-limit.ps1` — task-XML patch that disables Task
  Scheduler's default 72 h kill (used by `install-task.bat`)
- `dist/perfmon.exe` — prebuilt binary (windows/amd64, go1.20.14)
