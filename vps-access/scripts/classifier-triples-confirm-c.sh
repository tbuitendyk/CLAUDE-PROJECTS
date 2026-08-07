#!/usr/bin/env bash
# classifier-triples-confirm-c.sh -- CONFIRM run C: sharpen the sole
# surviving lead (LTC+XRP+BCH, run A pass 9/9 at p-floor 0.10) with 19
# null draws on the identical structure. Declared BEFORE launch:
#  R1: the LTC-led triple's declared-cell HOLD skill must beat ALL 19
#      draws (p-floor 1/20 = 0.05, DERIVED). Raw money printed beside.
#  Extending a pass with more draws is one-directional: it can demote,
#  never rescue — that is why this is legitimate after seeing run A.
#  If real lands mid-pack: run A's 9/9 is recorded as a luck draw and
#  the lead is PARKED (not retired) pending fresh period or mechanism.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/bracketlab \
  -H "Content-Type: application/json" \
  -d '{
    "universe": ["LTCUSDT","XRPUSDT","BCHUSDT"],
    "sizes": {"singles": false, "doubles": false, "triples": true},
    "allLoaded": true,
    "permute": {"geometry": false, "decision": false, "band": false, "weekdays": false},
    "set": {"geometry": "daily-4d", "decision": "argmax", "band": "auto", "weekdaysOnly": false},
    "declared": {"entry": "market", "tHours": 161, "quorumContexts": 1},
    "windowLayout": "split70",
    "labelShiftReps": 19,
    "promoteK": 50,
    "minTrades": 10,
    "label": "triples-confirm-c-ltc-sharpen"
  }'
echo
