#!/usr/bin/env bash
# uts-rows-squash-status.sh -- READ-ONLY. How far the one-off row conversion has
# got: whether it is still going, what the disk looks like, the size of each
# file in the run's store, and the tail of the log. Changes nothing.
set -uo pipefail
LOG=/var/log/uts-rows-squash.log
PIDF=/var/run/uts-rows-squash.pid
D=/opt/ultimate-trading-system/data/batches

if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then
  echo "STILL GOING (pid $(cat "$PIDF"))"
else
  echo "NOT RUNNING"
fi
df -h / | tail -1 | sed 's/^/disk  /'
RUN="$(ls -1 "$D" 2>/dev/null | grep -E '\.rows$' | head -1)"
if [ -n "$RUN" ]; then
  echo "-- $RUN --"
  ls -la "$D/$RUN" | awk 'NR>1 {printf "  %14s  %s\n", $5, $9}'
fi
echo "---- log tail ----"
tail -40 "$LOG" 2>/dev/null || echo "(no log)"
