#!/usr/bin/env bash
# uts-squash-procprobe.sh -- READ-ONLY, throwaway. Settles whether the pid the
# start script recorded is the converter, and why the read-position lines in the
# status script print nothing.
set -uo pipefail
echo "date on the box: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
ps -eo pid,ppid,etime,pcpu,comm,args 2>/dev/null | grep -E 'uts-rows-squash|node' | grep -v grep | head -5
PID=$(pgrep -f 'uts-rows-squash\.js' | head -1)
echo "pgrep says: ${PID:-none}"
[ -n "${PID:-}" ] || exit 0
echo "ps -o etime for that pid: $(ps -o etime= -p "$PID" 2>/dev/null)"
echo "-- open files --"
ls -l /proc/$PID/fd 2>&1 | head -12
echo "-- fdinfo positions --"
for FD in /proc/$PID/fd/*; do
  TGT=$(readlink "$FD" 2>/dev/null) || continue
  echo "  fd $(basename "$FD") -> $TGT  pos=$(awk '/^pos:/{print $2}' "/proc/$PID/fdinfo/$(basename "$FD")" 2>/dev/null)"
done
