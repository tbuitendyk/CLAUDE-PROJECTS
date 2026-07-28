#!/usr/bin/env bash
# classifier-cycle2-edge-null.sh -- CYCLE 2: what does the edge statistic do
# when there is provably nothing to find?
#
# Cycle 1's census returned 98 of 170 units holdout-edge-positive, which is
# "p = 0.027" against a 50% null. That null was assumed, and assuming a null
# is the one thing this project has never allowed itself anywhere else. A
# committee whose calls tilt toward the modal class posts positive edge with
# no skill whatever; stand-asides could push it the other way. Nobody knows
# which without measuring.
#
# So: the identical census, with the OUTCOME side rotated against the features.
# Autocorrelation, class balance, band calibration and every downstream rule
# survive; any real feature-to-outcome relationship does not.
#
# READING RULE, fixed before firing:
#   * rotated lands near 85/170 -> the statistic is honest and cycle 1's 98 is
#     worth pursuing (though still owed a correction for correlated units).
#   * rotated lands near 98/170 -> the statistic is biased, cycle 1 measured
#     nothing, and every "edge" number so far goes in the bin.
#   * rotated lands far ABOVE 98 -> worse: the real data is UNDERperforming
#     noise, which would say the features are actively misleading.
# One rotation is one draw, not a distribution. It is enough to tell a broken
# statistic from a working one, which is the question on the table.
set -euo pipefail
curl -sS -X POST http://127.0.0.1:8093/api/bracketlab \
  -H "Content-Type: application/json" \
  -d '{
    "universe": ["ZECUSDT","XLMUSDT","XRPUSDT","UNIUSDT","ETHUSDT","SOLUSDT","AVAXUSDT","DOTUSDT",
                 "BCHUSDT","DOGEUSDT","LINKUSDT","ADAUSDT","BNBUSDT","LTCUSDT","TRXUSDT","ATOMUSDT","ETCUSDT"],
    "sizes": {"singles": true, "doubles": false, "triples": false},
    "allLoaded": true,
    "permute": {"geometry": true, "decision": true, "band": false, "weekdays": false},
    "set": {"geometry": "daily-3d", "decision": "argmax", "band": "auto", "weekdaysOnly": false},
    "holdout": true,
    "trailing": false,
    "edgeScreen": true,
    "labelShiftFrac": 0.5,
    "promoteK": 50,
    "minTrades": 10
  }'
echo
