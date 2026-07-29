#!/usr/bin/env bash
# classifier-cycle8-money-null.sh -- the money version of the test cycle 6
# passed. Does the edge survive fees?
#
# WHY THIS IS THE RIGHT NEXT TEST. Cycle 6 showed the system predicts
# direction 1.61 points better than noise (36.09% against 34.48% across 19
# scrambles), and cycle 7 verified the real half reproduces exactly. But
# accuracy scores a wrong call identically whether the market went nowhere or
# hard the other way, and money does not. A system can be right more often
# than noise and still lose, if the times it is wrong cost more than the times
# it is right earn. On roughly 20,000 trades, fees alone are a large number.
#
# So: identical design, identical 19 scrambles, one question changed —
# NET MONEY on the held-back slice instead of accuracy.
#
# The money is out-of-sample by construction: the setup is chosen on the
# SEARCH window and scored once on the held-back slice. It is recorded for
# every unit and never money-ranked. Reading money off the money-ranked
# leaderboard is the selection fault that invalidated the very first screen
# (job -2158) — rank by money, read money off the top, and you have measured
# the ranking rather than the market.
#
# READING RULE, fixed before firing:
#
#   GATE FIRST. The 19 scrambles must agree with each other — total net money
#   across the census within a 2:1 ratio of spread to median magnitude. Wider
#   means the money measure is as unstable as the headcount was, and NOTHING
#   below is read.
#
#   Then, on total net P&L across the census, real against the 19 scrambles:
#   * above all 19 -> the edge survives fees at p = 0.05. THEN, and only then,
#     the question becomes position sizing and a live test at minimum stake.
#   * above 18 of 19 -> p = 0.10. Suggestive. No live money.
#   * anything weaker -> the edge does not pay. Cycle 6's accuracy result
#     stands as a true statement about prediction that does not convert into
#     money, which is a clean and useful answer.
#
#   Also reported, deciding nothing: median unit P&L, share of units with
#   positive money, and the always-long / buy-and-hold controls on the same
#   slice — because "beat doing nothing" is a separate question from "beat
#   noise" and both must be answered before anyone says the word live.
#
# EXPECTATION, recorded before the numbers exist so it cannot be adjusted
# afterwards: 1.61 points of directional accuracy is thin, and I think there
# is a real chance this does not survive fees.
#
# 19 scrambles x 170 units = 3230 units, ~5 hours on 4 workers.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/require-previous-audit.sh"

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
    "labelShiftReps": 19,
    "labelShiftScope": "window",
    "promoteK": 50,
    "minTrades": 10,
    "label": "L8 money null",
    "description": "The money version of the test cycle 6 passed. Cycle 6 showed the system predicts direction 1.61 points better than noise; this asks whether that survives fees, which is a different and harder question — accuracy scores a wrong call the same whether the market went nowhere or hard the other way, and money does not. Identical design and identical 19 scrambles, judged on NET P&L on the held-back slice instead of accuracy. Money is out-of-sample by construction (setup chosen on the search window, scored once on the holdout) and recorded for every unit, never money-ranked. Reading rule fixed before firing: above all 19 scrambles = survives fees at p=0.05 and the next question is a live test at minimum stake; 18 of 19 = suggestive, no live money; weaker = the edge does not pay, and cycle 6 stands as a true statement about prediction that does not convert into money."
  }'
echo
