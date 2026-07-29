#!/usr/bin/env bash
# classifier-cycle9-real-money-arm.sh -- re-measure the REAL census on
# today's build, because a 0.24-point margin cannot absorb any drift.
#
# WHY THIS COMES BEFORE THE MONEY QUESTION. Cycle 6 put the real run 0.24
# points above the best of 19 scrambles. That entire result rests on one
# number -- 36.09% directional accuracy -- produced by job -2211 on code that
# has since had the null rewritten, the split helper refactored, the census
# extended, the draw cap raised and the job id changed. The suite and the
# determinism fixture pass, so it SHOULD reproduce. But "should" is exactly
# the assumption class that has cost this project four measurements already
# (QC-REGISTER item 2), and no margin this thin survives an unchecked one.
#
# Exact mirror of -2211: same universe, same permutation, same holdout, same
# promoteK, same minTrades, and NO scrambling -- this is the real arm.
#
# READING RULE, fixed before firing:
#   * directional accuracy within 0.1 points of 36.09%  -> reproduced. Cycle 6
#     stands as read and the money question is next.
#   * differs by more than 0.1 points -> cycle 6's comparison is void. Find
#     what changed before anything else happens. A moved real arm invalidates
#     the null comparison in either direction, including a favourable one.
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
    "promoteK": 50,
    "minTrades": 10,
    "label": "L9 real arm with money",
    "description": "The REAL census with money recorded, on the identical build as the cycle 8 null. Cycle 8 ran 19 scrambles carrying held-back P&L, but the money census was deployed at 08:10 and the last real run was 07:29 — so the null had money and the real arm did not, and there was nothing to compare against. This supplies the missing arm. Reading rule replaced BEFORE this number exists (see audit of -0811): the old spread-to-magnitude gate is meaningless for a statistic centred at zero by construction, so the rank test governs instead — real beats all 19 scrambles = the edge pays after fees at p=0.05; 18 of 19 = suggestive, no live money; weaker = the edge does not pay and cycle 6 stands as prediction that does not convert into money. Sanity check retained: the scrambles must LOSE money, and they do (median -$2,268, -0.053 per trade)."
  }'
echo
