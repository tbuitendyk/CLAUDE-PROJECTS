#!/usr/bin/env bash
# live-parity-check.sh -- run the golden parity gate (IMPLEMENTATION-PLAN 2.3)
# on the VPS, where the real candle cache lives: F1 through the GENERALIZED
# producer must reproduce pilotsignal byte-for-byte. Read-only over the cache;
# ships nothing, trades nothing.
set -uo pipefail
APP=/opt/general-classifier
[ -f "$APP/live-parity.js" ] || { echo "live-parity.js not deployed yet"; exit 2; }
cd "$APP"
PARITY_CHUNKS="${PARITY_CHUNKS:-40}" node live-parity.js
rc=$?
echo "(exit $rc; 0=parity proven, 1=DIVERGENCE — stop the release, 2=could not compare)"
exit $rc
