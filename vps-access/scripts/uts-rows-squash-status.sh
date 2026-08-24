#!/usr/bin/env bash
# uts-rows-squash-status.sh -- READ-ONLY. How far the one-off row conversion has
# got: whether it is still going, what the disk looks like, the size of each
# file in the run's store, and the tail of the log. Changes nothing.
set -uo pipefail
LOG=/var/log/uts-rows-squash.log
D=/opt/ultimate-trading-system/data/batches

# FOUND BY NAME, NOT BY A RECORDED NUMBER. `setsid nohup node ... &` forks, so
# the shell's $! is setsid's pid and it exits at once -- a pid file written from
# it names a process that is already gone and whose number the kernel will hand
# to something else. Checked once against a recycled pid that was very much
# alive and doing something entirely different, which read as "still going" and
# would have read as "finished" the moment that stranger exited.
PID=$(pgrep -f 'uts-rows-squash\.js' | head -1)
if [ -n "${PID:-}" ]; then
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
  ps -o etime=,pcpu=,rss= -p "$PID" 2>/dev/null \
    | awk '{printf "  running for %s, %s%% of a processor, %.0f MB of memory\n", $1, $2, $3/1024}'
elif grep -q '^finished ' /var/log/uts-rows-squash.log 2>/dev/null; then
  echo "NOT RUNNING -- and the log says it finished"
elif grep -qE '^(FAILED|STOPPING SHORT|REFUSING)' /var/log/uts-rows-squash.log 2>/dev/null; then
  echo "NOT RUNNING -- and the log says it did NOT finish"
else
  echo "NOT RUNNING -- and the log says neither, so it was killed"
fi
df -h / | tail -1 | sed 's/^/disk  /'
RUN="$(ls -1 "$D" 2>/dev/null | grep -E '\.rows$' | head -1)"
if [ -n "$RUN" ]; then
  echo "-- $RUN --"
  ls -la "$D/$RUN" | awk 'NR>1 {printf "  %14s  %s\n", $5, $9}'
fi
echo "---- log tail ----"
tail -40 "$LOG" 2>/dev/null || echo "(no log)"
