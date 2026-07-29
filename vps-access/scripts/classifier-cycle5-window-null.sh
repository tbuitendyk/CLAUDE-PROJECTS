#!/usr/bin/env bash
# classifier-cycle5-window-null.sh -- the null, rebuilt so its draws are
# scored against the same yardstick as the real run.
#
# WHY THIS EXISTS. Job -2303 ran six rotations of the previous null and they
# disagreed wildly: 14.7%, 27.6%, 25.3%, 48.2%, 91.2%, ~61%. Each draw is 170
# units, so one draw's sampling error is about 3.5 points. A 77-point spread
# is not noise, it is a fault in the construction.
#
# The fault: edge = accuracy - majorityBaseline, and the old rotation shifted
# outcomes across the WHOLE series before the train/search/holdout split was
# cut positionally. So every rotation handed the holdout window outcomes from
# a different stretch of history, and therefore a different baseline. Measured
# on BTC/ZEC daily-3d over 908 chunks, the holdout baseline ranged 0.265 to
# 0.419 across seven rotations while the real unrotated run sat at 0.353. A
# draw scored against a baseline nine points softer clears "edge > 0" far more
# easily with no change in skill whatsoever, so the pooled result was a
# mixture over baselines rather than a null.
#
# THE CHANGE. labelShiftScope "window" rotates INSIDE train, search and
# holdout separately. Each window keeps its own outcome multiset exactly, so
# the band (calibrated on train) is unchanged, every window's class balance is
# unchanged, and the majority baseline is identical in every draw AND equal to
# the real run's. Verified on those same 908 chunks: 0.353 in all seven.
# The feature-to-outcome pairing is still destroyed inside each window, which
# is the whole job of a null.
#
# Everything else is a deliberate byte-for-byte mirror of the census this is
# the null FOR (job -2211: 98/170 = 57.6%, median +3.08%). Same universe, same
# permutation, same holdout, same promoteK, same minTrades. A null that also
# changed the menu would answer a different question.
#
# READING RULE, fixed before firing and binding:
#
#   FIRST, the sanity gate. The six draws must agree with each other. If they
#   still span more than ~15 points, the construction is STILL wrong and the
#   comparison below is not read at all — the loop goes back to the
#   instrument, not to the market. (The reader prints this warning itself
#   above 25 points.)
#
#   Only if the draws are tight:
#   * 57.6% sits ABOVE every draw -> the classification edge survives its
#     first honest null. That does NOT make it tradeable: 3 points of holdout
#     accuracy has to clear fees, and that is a separate and harder question.
#   * 57.6% sits INSIDE the spread -> the edge direction closes. Cycle 1
#     measured the statistic's own tilt, not skill, and the weekly-8d books
#     need re-examining on the same grounds.
#   * 57.6% sits BELOW every draw -> the features are actively misleading and
#     that is its own finding, not a disappointment.
#
# Six rotations, 1020 units, ~90 minutes on 4 workers at 90% duty.
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
    "labelShiftReps": 6,
    "labelShiftScope": "window",
    "promoteK": 50,
    "minTrades": 10
  }'
echo
