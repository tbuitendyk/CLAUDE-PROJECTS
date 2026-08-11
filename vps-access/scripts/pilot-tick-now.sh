#!/usr/bin/env bash
# Manually run the tick once and show the refresh + produce output.
set -uo pipefail
echo "== running pilot-tick.sh =="
timeout 240 /usr/local/sbin/pilot-tick.sh 2>&1 | tail -30
echo "== F1 data coverage after refresh =="
for s in LTCUSDT XRPUSDT BCHUSDT; do
  latest=$(ls -1 /opt/general-classifier/data/cache/${s}-1h-2026-08-*.json 2>/dev/null | sort | tail -1)
  echo "  $s newest day-file: $(basename "${latest:-none}")"
done
