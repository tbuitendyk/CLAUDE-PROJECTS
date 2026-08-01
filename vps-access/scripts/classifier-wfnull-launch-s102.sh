#!/usr/bin/env bash
# classifier-wfnull-launch-s102.sh -- WF-NULL seed 102: the second draw of
# the luck-count distribution (NR3 of the s101 launcher; audit
# audit-walkforward-20260731-215808-wfnull-s101.md §9). Identical to seed
# 101 in every setting except the rotation seed — one variable.
#
# DECLARED READ for the two-seed comparison, stated before this run:
#   The real board's R1+R2 count (7) must exceed TWICE the larger null
#   count across seeds 101 and 102 to be called distinguishable from luck
#   [factor GUESSED]. Seed 101's null count was 5, so the bar is already
#   at >=11 unless seed 102 comes in under 3 — i.e. the likely verdict is
#   "these counting rules cannot separate the real board from luck", and
#   the consequence, declared now, is: no third seed; the work shifts to
#   the sharper paired instrument (same setup, same folds, real votes vs
#   rotated votes, per-setup difference distribution), designed and
#   declared in its own launcher. Counts only; nothing here selects.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/require-previous-audit.sh"
B="http://127.0.0.1:8093"
BODY='{
  "universe": ["ETHUSDT","BNBUSDT","XRPUSDT","ADAUSDT","SOLUSDT","DOGEUSDT",
               "LTCUSDT","LINKUSDT","DOTUSDT","AVAXUSDT","TRXUSDT","XLMUSDT",
               "ETCUSDT","ATOMUSDT","BCHUSDT","UNIUSDT","ZECUSDT"],
  "permute": { "geometry": true, "decision": true },
  "minTradesSlice": 5,
  "feePerLeg": 0.125,
  "nullShiftSeed": 102,
  "label": "wfnull-s102",
  "description": "WF-NULL seed 102: second luck draw (NR3); declared two-seed read in classifier-wfnull-launch-s102.sh; counts only, selects nothing"
}'
echo "firing WF-NULL seed 102 (136 setups, rotated votes)..."
curl -sS --max-time 30 -X POST "$B/api/walkforward" \
  -H 'Content-Type: application/json' -d "$BODY"
echo
