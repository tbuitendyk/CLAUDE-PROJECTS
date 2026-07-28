#!/usr/bin/env bash
# classifier-bracket-run6-geometry-generality.sh -- Run 6: is the null result
# specific to daily-3d, or general?
#
# Runs 3 and 4 said neither layer has anything on daily-3d at a 161h exit:
# model-free 8/17 positive, gated 6/17, and the paired difference between them
# a coin flip (8 up / 9 down). This run takes the MODEL-FREE cell -- the
# simpler of the two, and the one whose failure makes the other moot -- and
# scores it across ALL FIVE chunk shapes on the same 17 assets.
#
#     declared: always gate, d1.0x, t161h   (identical to Run 4)
#     permuted: geometry only               (5 branches x 17 assets = 85 units)
#
# This is a DIAGNOSTIC on a negative, not a candidate hunt, and the reading
# rule is fixed before firing precisely so it cannot become one:
#   * every geometry in the 6-11 band  -> the bracket layer is null generally,
#     not just on daily-3d. The branch is dead and the hunt moves elsewhere.
#   * one geometry >= 12/17            -> a LEAD, not a result. Five geometries
#     is five looks; the winner would owe a fresh declared test of its own on
#     data it has not been chosen from, before it is worth another minute.
#   * one geometry <= 5/17             -> equally a lead, in the short
#     direction, and equally owes its own test.
# Nothing here earns a paper book, whatever it prints.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/bracketlab \
  -H "Content-Type: application/json" \
  -d '{
    "universe": ["ZECUSDT","XLMUSDT","XRPUSDT","UNIUSDT","ETHUSDT","SOLUSDT","AVAXUSDT","DOTUSDT",
                 "BCHUSDT","DOGEUSDT","LINKUSDT","ADAUSDT","BNBUSDT","LTCUSDT","TRXUSDT","ATOMUSDT","ETCUSDT"],
    "sizes": {"singles": true, "doubles": false, "triples": false},
    "allLoaded": true,
    "permute": {"geometry": true, "decision": false, "band": false, "weekdays": false},
    "set": {"geometry": "daily-3d", "decision": "argmax", "band": "auto", "weekdaysOnly": false},
    "declared": {"gate": "always", "dMult": 1.0, "tHours": 161, "quorumRatio": 0.25},
    "promoteK": 50,
    "minTrades": 10
  }'
echo
