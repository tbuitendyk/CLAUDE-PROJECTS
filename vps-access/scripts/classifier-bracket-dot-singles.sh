#!/usr/bin/env bash
# classifier-bracket-dot-singles.sh -- re-fire the DOT singles full-permute
# Bracket lab sweep (the bracketlab-20260727-2236 configuration, verbatim)
# so the board carries the vs-control deltas. Fires and returns; watch with
# classifier-bracketlab-read.sh or the Bracket lab tab.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/bracketlab \
  -H "Content-Type: application/json" \
  -d '{
    "universe": ["DOTUSDT"],
    "sizes": {"singles": true, "doubles": false, "triples": false},
    "allLoaded": true,
    "permute": {"geometry": true, "decision": true, "band": true, "weekdays": true},
    "set": {"geometry": "daily-3d", "decision": "argmax", "band": "auto", "weekdaysOnly": false},
    "promoteK": 25,
    "minTrades": 10
  }'
echo
