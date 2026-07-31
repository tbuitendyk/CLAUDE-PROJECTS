#!/usr/bin/env bash
# wf-planted-stop.sh -- stop a running planted calibration, printing
# diagnostics FIRST so a wedged run leaves a post-mortem trail:
# how long it ran, how much CPU it was using, and how much it ever logged.
# (The 2026-07-31 WFS42 run sat with an empty log; without etimes/pcpu the
# difference between "slow" and "stuck" was invisible from outside.)
set -uo pipefail
LOG=/opt/general-classifier/data/wf-planted.log
PIDS=$(pgrep -f walkforward-planted-check || true)
if [ -z "$PIDS" ]; then
  echo "nothing running"
else
  echo "process(es) before kill:"
  ps -o pid,etimes,pcpu,rss,args -p $PIDS || true
  pkill -f walkforward-planted-check || true
  sleep 1
  if pgrep -f walkforward-planted-check >/dev/null; then
    pkill -9 -f walkforward-planted-check || true
    echo "killed (needed -9)"
  else
    echo "killed"
  fi
fi
if [ -f "$LOG" ]; then
  echo "log: $(stat -c '%s bytes, modified %y' "$LOG")"
else
  echo "log: absent"
fi
