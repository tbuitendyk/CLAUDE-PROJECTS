#!/usr/bin/env bash
# classifier-cycle3-null-band.sh -- CYCLE 3: put an error bar on the null.
#
# Cycle 1 (real outcomes)   98/170 holdout-edge-positive, median +3.08%
# Cycle 2 (one rotation)    46/170,                        median -0.83%
#
# The measured null is 27%, not the 50% that was assumed — the statistic runs
# NEGATIVE on noise, so it was penalising rather than flattering and cycle 1
# reads stronger than the naive binomial implied. But 46 is ONE draw. Without
# a spread there is no way to say whether 98 is far outside the null or merely
# outside one sample of it.
#
# Six rotations, evenly spaced, in a single job: 6 x 170 = 1020 promoted units.
# Expect roughly two and a half hours.
#
# READING RULE, fixed before firing:
#   * 98 sits far above every draw -> the classification edge is real, and the
#     next question becomes whether 3 points of accuracy is tradeable after
#     fees, which is a different and harder question.
#   * 98 sits inside the spread of draws -> cycle 1 measured nothing and the
#     edge direction closes.
#   * draws disagree wildly with each other -> the statistic is unstable and
#     needs fixing before it is used to decide anything.
# The correlated-units caveat applies to real and null alike: 17 assets across
# 10 branches are not 170 independent tests. Comparing like with like is what
# this design buys; it does not buy an honest p-value on its own.
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
    "labelShiftReps": 6,
    "promoteK": 50,
    "minTrades": 10
  }'
echo
