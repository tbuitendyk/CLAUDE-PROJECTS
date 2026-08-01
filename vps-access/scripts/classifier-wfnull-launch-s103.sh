#!/usr/bin/env bash
# classifier-wfnull-launch-s103.sh -- WF-NULL seed 103: third luck draw.
# PURPOSE (declared): together with seed 104, this exists to DERIVE the
# paired-count threshold that PR3 currently GUESSES (2x). With four luck
# arms, each can be scored against the mean of the other three by the
# same paired formula (classifier-wfpaired-read.sh PR1/PR2), giving four
# luck-vs-rest counts. The derived line, declared now: the real board's
# real-vs-four-nulls count must exceed the MAXIMUM luck-vs-rest count by
# MORE than the spread (max minus min) of those four counts — i.e. sit
# outside the observed luck variation, not merely above its floor.
# [Structure derived from "outside observed luck variation"; the small
# sample of four is named as a limit, not hidden.]
# NO verdict is read from seed 103 alone; nothing selects.
# Identical to seeds 101/102 in every setting except the seed.
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
  "nullShiftSeed": 103,
  "label": "wfnull-s103",
  "description": "WF-NULL seed 103: third luck draw, for DERIVING the paired threshold (with s104) per classifier-wfnull-launch-s103.sh; no verdict alone; selects nothing"
}'
echo "firing WF-NULL seed 103 (136 setups, rotated votes)..."
curl -sS --max-time 30 -X POST "$B/api/walkforward" \
  -H 'Content-Type: application/json' -d "$BODY"
echo
