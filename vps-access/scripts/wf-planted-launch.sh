#!/usr/bin/env bash
# wf-planted-launch.sh -- start the walk-forward planted calibration (QC 56)
# on the box, detached, so it survives the controller's container restarts.
# Read progress with wf-planted-read.sh. Refuses to double-start.
set -uo pipefail
LOG=/opt/general-classifier/data/wf-planted.log
if pgrep -f walkforward-planted-check >/dev/null; then echo "already running"; exit 0; fi
cd /opt/general-classifier
nohup node tools/walkforward-planted-check.js > "$LOG" 2>&1 &
echo "launched (pid $!), log $LOG"
