#!/usr/bin/env bash
# classifier-trailing-smoke.sh -- smallest run that produces a TRAILING
# candidate, so minute confirmation can be exercised on the case it exists for.
#
# One asset, one branch. Trailing multiplies the promoted menu by 12.3x, so
# this is deliberately a single unit: the point is a candidate to confirm, not
# a search.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/bracketlab \
  -H "Content-Type: application/json" \
  -d '{
    "universe": ["DOTUSDT"],
    "sizes": {"singles": true, "doubles": false, "triples": false},
    "allLoaded": true,
    "permute": {"geometry": false, "decision": false, "band": false, "weekdays": false},
    "set": {"geometry": "daily-3d", "decision": "argmax", "band": "auto", "weekdaysOnly": false},
    "trailing": true,
    "promoteK": 1,
    "minTrades": 10
  }'
echo
