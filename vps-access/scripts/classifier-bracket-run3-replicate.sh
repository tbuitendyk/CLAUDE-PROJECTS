#!/usr/bin/env bash
# classifier-bracket-run3-replicate.sh -- Run 3: replicate ONE declared
# execution config across all 17 single assets.
#
# The config below was derived MECHANICALLY from the bracketlab-20260728-0804
# doubles board (classifier-bracketlab-top.sh's recurrence tally), by taking
# the modal value of each knob counted over DISTINCT trade assets:
#     gate   active   5 assets / 24 rows
#     tHours 161h     5 assets / 18 rows
#     dMult  1.5x     4 assets /  9 rows   (most asset-diverse distance)
#     quorum 25%      5 assets / 19 rows
# and the branch every top row shared: daily-3d, auto band, argmax, 24/7.
#
# Nothing here is chosen after seeing a per-asset result -- that is the whole
# point. 17 assets x 1 branch = 17 units, one look apiece, so the read is a
# plain binomial with no search tax to subtract.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/bracketlab \
  -H "Content-Type: application/json" \
  -d '{
    "universe": ["ZECUSDT","XLMUSDT","XRPUSDT","UNIUSDT","ETHUSDT","SOLUSDT","AVAXUSDT","DOTUSDT",
                 "BCHUSDT","DOGEUSDT","LINKUSDT","ADAUSDT","BNBUSDT","LTCUSDT","TRXUSDT","ATOMUSDT","ETCUSDT"],
    "sizes": {"singles": true, "doubles": false, "triples": false},
    "allLoaded": true,
    "permute": {"geometry": false, "decision": false, "band": false, "weekdays": false},
    "set": {"geometry": "daily-3d", "decision": "argmax", "band": "auto", "weekdaysOnly": false},
    "declared": {"gate": "active", "dMult": 1.5, "tHours": 161, "quorumRatio": 0.25},
    "promoteK": 25,
    "minTrades": 10
  }'
echo
