#!/usr/bin/env bash
# wf-smoke-launch.sh -- one-unit walk-forward preflight on the deployed
# engine: DOTUSDT, daily-3d, argmax. A preflight, not an experiment (the
# audit gate's -smoke carve-out applies): its job is to prove the fixed
# engine runs a real unit end to end — folds score, the board fills, the
# fold detail file lands — before the 17-coin sweep is fired.
#
# Every number this run prints is looked at only for "did the machinery
# work"; nothing in it selects anything.
set -uo pipefail
B="http://127.0.0.1:8093"
BODY='{
  "universe": ["DOTUSDT"],
  "permute": { "geometry": false, "decision": false },
  "set": { "geometry": "daily-3d", "decision": "argmax" },
  "minTradesSlice": 5,
  "feePerLeg": 0.125,
  "label": "smoke",
  "description": "engine-1.27.0 preflight: one unit end to end after the review fixes; not an experiment"
}'
echo "firing walk-forward smoke (1 unit: DOTUSDT daily-3d argmax)..."
curl -sS --max-time 30 -X POST "$B/api/walkforward" \
  -H 'Content-Type: application/json' -d "$BODY"
echo
