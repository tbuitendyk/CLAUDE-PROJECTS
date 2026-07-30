#!/usr/bin/env bash
# classifier-cycle13-reproduce-l9.sh -- reference check AFTER the L12 build.
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
    "label": "L13 reproduce and keep L9",
    "description": "L13: reproduce L9 exactly on the L12 build, and KEEP everything this time — models for all 170 setups, all 12 raw votes per period, per-member scores, both windows uncapped. Reading rule, declared before firing: directional accuracy 36.09% (7,187 of 19,913), net +$1,469.95, 98/170 beating baseline — EXACT match = engine sound after the L12 changes and L9 becomes a permanent dataset; ANY drift = stop, nothing else fires until the cause is found. Exactness across days is a fair bar: L7 reproduced L2 to every digit one day later. This is the reference check that was skipped before L10/L11, now run AFTER the code change instead of before it."
  }'
echo
