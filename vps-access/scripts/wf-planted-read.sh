#!/usr/bin/env bash
# wf-planted-read.sh -- read the planted calibration's log (read-only).
set -uo pipefail
LOG=/opt/general-classifier/data/wf-planted.log
if pgrep -f walkforward-planted-check >/dev/null; then echo "STATUS: still running"; else echo "STATUS: not running"; fi
tail -25 "$LOG" 2>/dev/null || echo "no log yet"
