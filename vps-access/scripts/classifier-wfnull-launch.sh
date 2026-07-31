#!/usr/bin/env bash
# classifier-wfnull-launch.sh -- WF-NULL seed 101: the walk-forward luck
# baseline (WF1 audit 9a). Same 136 setups, same fold machinery, same
# pick-and-score — but inside each fold every member's votes are rotated
# by one common offset, so they carry no information about the market
# while the committee's internal agreement pattern stays exactly real.
#
# PRECONDITIONS (hard): planted check on THIS engine passed all criteria
# INCLUDING N1-N4 (the null arm must have destroyed the planted coin's
# edge and been seed-deterministic); previous completed job audited
# (gate below).
#
# READING RULES — declared before any number exists:
#   NR1 what is read: BOARD-LEVEL COUNTS only. How many of 136 setups
#       pass R1+R2 (WF1's rules: positive median fold money, more winning
#       folds than half, total beats always-long), and how many pass S1
#       (the drift-adjusted key from audit 9b: median per-fold money
#       minus always-long > 0 AND more than half of folds beat
#       always-long). No per-setup verdict exists in a null doc.
#   NR2 the comparison: WF1 real counts (22 pass R1, 7 pass R1+R2). If
#       the null count is at least HALF the real count, the real board is
#       not distinguishable from luck on this draw [GUESSED threshold] —
#       consequence: more seeds, never a candidate verdict (gates judge
#       the INSTRUMENT).
#   NR3 one seed = ONE draw of the whole-board count (QC 57). At least
#       one more seed runs before any selection decision regardless of
#       outcome; more if the counts land near NR2's line.
#   NR4 nothing in a null doc is a finding about any coin. Its only
#       output is the luck floor under the real board.
#   HELD FIXED ON PURPOSE (QC 42): universe, shapes, decisions, fee
#       0.125, trade floor 5 — identical to WF1, because a null that
#       differs from its real arm in anything but the rotation compares
#       two populations (QC 5's lesson).
#
# EXPECTATION (loop step 4): same compute as WF1 -> ~5-6 hours.
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
  "nullShiftSeed": 101,
  "label": "wfnull-s101",
  "description": "WF-NULL seed 101: rotated-vote luck baseline for WF1; reading rules NR1-NR4 in classifier-wfnull-launch.sh; board-level counts only"
}'
echo "firing WF-NULL seed 101 (136 setups, rotated votes)..."
curl -sS --max-time 30 -X POST "$B/api/walkforward" \
  -H 'Content-Type: application/json' -d "$BODY"
echo
