#!/usr/bin/env bash
# uts-rows-squash-status.sh -- READ-ONLY. How far the one-off row conversion has
# got: whether it is still going, what the disk looks like, the size of each
# file in the run's store, and the tail of the log. Changes nothing.
set -uo pipefail
LOG=/var/log/uts-rows-squash.log
PIDF=/var/run/uts-rows-squash.pid
D=/opt/ultimate-trading-system/data/batches

if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then
  PID=$(cat "$PIDF")
  echo "STILL GOING (pid $PID)"
  # HOW FAR THROUGH, EXACTLY. The kernel knows where each open file is being
  # read from, so this is the real position rather than a guess from the size of
  # what has come out the other end.
  for FD in /proc/$PID/fd/*; do
    TGT=$(readlink "$FD" 2>/dev/null) || continue
    case "$TGT" in *.jsonl)
      POS=$(awk '/^pos:/{print $2}' "/proc/$PID/fdinfo/$(basename "$FD")" 2>/dev/null)
      SZ=$(stat -c%s "$TGT" 2>/dev/null)
      [ -n "$POS" ] && [ -n "$SZ" ] && [ "$SZ" -gt 0 ] &&         awk -v p="$POS" -v s="$SZ" -v f="$(basename "$TGT")"           'BEGIN{printf "  reading %s: %.2f of %.2f GB, %.1f%%
", f, p/1073741824, s/1073741824, 100*p/s}'
      ;;
    esac
  done
  # and how long it has been at it, so a rate can be worked out
  ST=$(stat -c%Y /var/log/uts-rows-squash.log 2>/dev/null)
  BEGIN=$(awk '/started at|started /{print}' /var/log/uts-rows-squash.log 2>/dev/null | head -1)
  echo "  started: ${BEGIN:-?}"
  ps -o etime=,pcpu= -p "$PID" 2>/dev/null | sed 's/^/  running for:/'
  : "$ST"
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
