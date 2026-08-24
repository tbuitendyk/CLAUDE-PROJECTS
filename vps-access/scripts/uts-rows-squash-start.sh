#!/usr/bin/env bash
# uts-rows-squash-start.sh -- CHANGES THE INTERRUPTED SWEEP'S STORED ROWS.
# Owner-authorised, 2026-08-24: "i authorized WHATEVER one-off data
# pre-processing is required by you to make it possible for me to afterwards
# USE THE SYSTEM INTERFACE TO CONTINUE THE EXISTING RUN."
#
# WHAT IT CHANGES: the three row files of the one interrupted sweep are rewritten
# from plain text into the squashed block form the rows code writes today, and
# the plain originals are removed -- but only after the squashed copy has been
# read back and found to hold the same rows, with the same last row, byte for
# byte. No row is recomputed and no number is re-serialised; the exact bytes of
# every line are carried across. See uts-rows-squash.js for the reasoning.
#
# WHY: lib/rowstore.js picks a collection's format from which file already
# exists, and a plain one wins -- so without this the resumed run would go on
# appending plain text and add another fifty gigabytes to a box that just filled
# up. Nothing in the interface can do this, because the rule it is working
# around is the rule that protects a RUNNING job's record.
#
# It takes tens of minutes, which is longer than the endpoint will wait, so it
# runs detached and writes to a log. Watch it with uts-rows-squash-status.sh.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JS="$HERE/uts-rows-squash.js"
LOG=/var/log/uts-rows-squash.log
PIDF=/var/run/uts-rows-squash.pid

[ -f "$JS" ] || { echo "missing $JS"; exit 1; }

if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then
  echo "already running as pid $(cat "$PIDF") -- use uts-rows-squash-status.sh"
  exit 0
fi

# The service must not be part-way through writing these files. The run is
# marked interrupted, so it is not; this checks rather than trusts.
if pgrep -f 'ultimate-trading-system.*server.js' >/dev/null 2>&1; then
  echo "note: the trading service is up. That is fine -- the run it would be"
  echo "      writing is marked interrupted, and the converter refuses if the"
  echo "      run document says 'running'."
fi

: > "$LOG"
setsid nohup node "$JS" >>"$LOG" 2>&1 < /dev/null &
echo $! > "$PIDF"
sleep 5
echo "started as pid $(cat "$PIDF"); log: $LOG"
echo "---- first lines ----"
head -20 "$LOG" || true
