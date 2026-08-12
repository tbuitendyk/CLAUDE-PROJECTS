#!/usr/bin/env bash
# live-parity-check.sh -- START the golden parity gate (IMPLEMENTATION-PLAN 2.3)
# DETACHED on the VPS: it retrains the committee per chunk x 2 engines, minutes
# of compute, and only prints at the end, so it runs under nohup writing
# data/parity-report.txt; read the verdict with live-parity-result.sh.
# Read-only over the cache; ships nothing.
#
# Default 12 chunks for a fast first PASS/FAIL; a fuller 40-chunk sweep is the
# pre-cutover confirmation (env PARITY_CHUNKS, but the runner forwards no env,
# so the number is set here). Always starts FRESH (kills any prior run) so a
# stale/orphaned run cannot mask the current code.
set -uo pipefail
APP=/opt/general-classifier
CHUNKS="${PARITY_CHUNKS:-12}"
[ -f "$APP/live-parity.js" ] || { echo "live-parity.js not deployed yet"; exit 2; }
REPORT="$APP/data/parity-report.txt"
pkill -f "node live-parity.js" 2>/dev/null || true
sleep 1
cd "$APP"
: > "$REPORT"
nohup bash -c "PARITY_CHUNKS=$CHUNKS node live-parity.js >> '$REPORT' 2>&1; echo EXIT=\$? >> '$REPORT'" >/dev/null 2>&1 &
echo "parity run STARTED (detached, $CHUNKS chunks); result -> live-parity-result.sh"
