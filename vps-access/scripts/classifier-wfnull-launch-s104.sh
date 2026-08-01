#!/usr/bin/env bash
# classifier-wfnull-launch-s104.sh -- WF-NULL seed 104: fourth and final
# luck draw for the derived-threshold read (declared in the s103
# launcher; audits s101-s103). Identical to seeds 101-103 in every
# setting except the seed. NO verdict alone. After it lands, the
# four-arm paired read applies the pre-declared line: the real board's
# paired count must exceed the MAXIMUM of the four luck-vs-rest counts
# by MORE than their spread (max minus min). Then, and only then, a
# verdict — and either replication rules (declared separately) or the
# honest too-small-to-see conclusion.
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
  "nullShiftSeed": 104,
  "label": "wfnull-s104",
  "description": "WF-NULL seed 104: final luck draw for the derived threshold (declared in classifier-wfnull-launch-s103.sh); no verdict alone; selects nothing"
}'
echo "firing WF-NULL seed 104 (136 setups, rotated votes)..."
curl -sS --max-time 30 -X POST "$B/api/walkforward" \
  -H 'Content-Type: application/json' -d "$BODY"
echo
