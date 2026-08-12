#!/usr/bin/env bash
# live-parity-check.sh -- START the golden parity gate (IMPLEMENTATION-PLAN 2.3)
# DETACHED on the VPS: the full run retrains the committee per chunk x 2 sides
# (~10+ min), far beyond the deploy-runner's connection tolerance, so it runs
# under nohup and writes data/parity-report.txt. Read the verdict with
# live-parity-result.sh. Read-only over the cache; ships nothing.
set -uo pipefail
APP=/opt/general-classifier
[ -f "$APP/live-parity.js" ] || { echo "live-parity.js not deployed yet"; exit 2; }
REPORT="$APP/data/parity-report.txt"
if pgrep -f "node live-parity.js" >/dev/null 2>&1; then
  echo "a parity run is ALREADY in progress; read it with live-parity-result.sh"
  exit 0
fi
cd "$APP"
: > "$REPORT"
nohup bash -c 'PARITY_CHUNKS='"${PARITY_CHUNKS:-40}"' node live-parity.js >> '"$REPORT"' 2>&1; echo "EXIT=$?" >> '"$REPORT"'' >/dev/null 2>&1 &
echo "parity run STARTED (detached, ~10-15 min for 40 chunks); result -> live-parity-result.sh"
