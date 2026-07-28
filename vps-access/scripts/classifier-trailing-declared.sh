#!/usr/bin/env bash
# classifier-trailing-declared.sh -- DECLARE a trailing cell on DOT so minute
# confirmation can be exercised on the case it exists for.
#
# The smoke sweep showed why this is needed: with trailing swept, the search
# winner on DOT was still a MARKET cell, so no trailing row reached the board
# and there was nothing to confirm. A declared cell is recorded regardless of
# whether it wins, which is the whole point of declaring one.
#
# Config is arbitrary and says nothing about merit — it exists to put a
# trailing trade with plenty of stop activity in front of the minute check.
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
    "declared": {"gate": "always", "dMult": 1.0, "tHours": 65, "trailMult": 1.0, "armMult": 0, "quorumRatio": 0.3333},
    "promoteK": 1,
    "minTrades": 10
  }'
echo
