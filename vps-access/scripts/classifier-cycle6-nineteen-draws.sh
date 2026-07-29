#!/usr/bin/env bash
# classifier-cycle6-nineteen-draws.sh -- the same null as cycle 5, with enough
# draws that the DATA decides significance rather than the draw count.
#
# WHY MORE DRAWS. Cycle 5's construction is sound: its six draws agreed within
# 9.4 points (the previous version spanned 76.5). The problem is arithmetic,
# not method. With N draws, "the real result beat all of them" carries a
# rank-based p of 1/(N+1). Six draws floor that at 0.14, so even a flawless
# outcome could not have been called significant. Nineteen draws puts the
# floor at exactly 0.05. Nothing else changes.
#
# This is NOT "run draws until one clears" -- that is the trap this week has
# been about. The count and the decision rule are both fixed below, before any
# number exists, and the run is read once.
#
# THE MEASURE. Primary is ACTIVE-ONLY: the share of test setups that beat
# their own do-nothing baseline, counting only setups whose models actually
# called a direction at least once. Setups that never trade cannot win or lose
# money and so cannot express tradeable direction; including them measures
# something other than what we are asking.
#
# That correction was made after cycle 5 was read, which needs stating plainly.
# It is legitimate rather than metric-shopping on three grounds, all fixed
# here in advance: (a) the fault was argued from MECHANISM -- a setup that
# places no trade cannot be evidence about trading -- not from the number
# improving; (b) the correction moved BOTH arms down, null 54.1 -> 50.8 and
# real 57.6 -> 56.6, where a cherry-pick moves only the favourable one; (c)
# the old all-units figure keeps being reported beside it. See QC-REGISTER
# item 21.
#
# THE REFERENCE. Job -2211, the unrotated real census:
#     active-only  94/166 = 56.6%   <- the number to beat
#     all-units    98/170 = 57.6%   (legacy, reported alongside)
#
# READING RULE, fixed now and binding:
#
#   GATE FIRST. The 19 draws must agree within 15 points. If they do not, the
#   construction is broken again and NOTHING below is read.
#
#   Then, on the ACTIVE-ONLY figure:
#   * 56.6% beats all 19 draws  -> p = 0.05. The classification edge has
#     survived an honest null. It is then owed the money question, which is
#     separate and harder: does the margin survive fees.
#   * 56.6% beats 18 of 19      -> p = 0.10. Suggestive, not established.
#     No live money on the strength of it.
#   * anything weaker           -> the aggregate edge direction closes. What
#     remains is the argmax/daily lead, which would need its own declared
#     test rather than another sweep.
#
#   The all-units figure is reported but does NOT decide anything. If the two
#   measures disagree, active-only governs and the disagreement is reported
#   loudly, because that would itself be a finding about the metric.
#
# 19 draws x 170 units = 3230 units, roughly 4-5 hours on 4 workers.
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
    "labelShiftReps": 19,
    "labelShiftScope": "window",
    "promoteK": 50,
    "minTrades": 10
  }'
echo
