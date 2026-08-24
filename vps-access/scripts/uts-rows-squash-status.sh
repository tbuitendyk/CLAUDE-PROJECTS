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
  # HOW FAR THROUGH. Asked of the file being WRITTEN, not the one being read:
  # the converter reads with an explicit offset, which is pread, and pread does
  # not move the file's own position -- so the kernel reports 0 for the source
  # for the whole run, and the first version of this printed that as progress.
  # The output file is appended sequentially, so its position is real.
  for FD in /proc/$PID/fd/*; do
    TGT=$(readlink "$FD" 2>/dev/null) || continue
    case "$TGT" in *.jsonl.gz)
      POS=$(awk '/^pos:/{print $2}' "/proc/$PID/fdinfo/$(basename "$FD")" 2>/dev/null)
      [ -n "${POS:-}" ] && awk -v p="$POS" -v f="$(basename "$TGT")" \
        'BEGIN{printf "  writing %s: %.2f GB so far\n", f, p/1073741824}'
      ;;
    esac
  done
  # ...and how many rows, which is the figure that says how near the end it is.
  awk '/^  [.][.][.]/{last=$0} END{if(last) print " " last}' "$LOG" 2>/dev/null
  # ELAPSED FROM THE LOG'S OWN STAMP. Not because ps was wrong -- it was right,
  # and it was called wrong by a session comparing it against its own sense of
  # how much time had passed, which is not a clock. Kept because the converter's
  # stamp can be checked against the log and needs no such comparison.
  ps -o pcpu=,rss= -p "$PID" 2>/dev/null \
    | awk '{printf "  %s%% of a processor, %.0f MB of memory\n", $1, $2/1024}'
  awk '/^ *started 20/{print $2; exit}' "$LOG" 2>/dev/null | while read -r T; do
    B=$(date -u -d "$T" +%s 2>/dev/null) || continue
    N=$(date -u +%s)
    awk -v e=$((N - B)) 'BEGIN{printf "  going for %dh %02dm %02ds (since %s)\n", e/3600, (e%3600)/60, e%60, "'"$T"'"}'
  done
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
