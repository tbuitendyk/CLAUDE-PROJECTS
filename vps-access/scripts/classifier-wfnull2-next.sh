#!/usr/bin/env bash
# classifier-wfnull2-next.sh -- fire the NEXT missing rebuilt null run
# (QC 66 deal construction, engine 1.31+), seeds 101..104 in order.
# One script instead of four launchers: each call fires the lowest seed
# that has no completed-or-running wfnull2 job yet, so the heartbeat loop
# can just call this after each audit until all four exist.
#
# DECLARED READ (unchanged from classifier-wfnull-launch-s103.sh, now on
# the clean construction): no single seed carries a verdict; when all
# four exist, the four-arm paired read applies the pre-declared line —
# real must exceed max(luck-vs-rest counts) + their spread. The old
# rotation-built runs (wfnull-s101..104) are SUPERSEDED (register 66)
# and excluded from comparison by the engine.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/require-previous-audit.sh"
B="http://127.0.0.1:8093"
NEXT=$(curl -sS --max-time 20 "$B/api/batches" | python3 -c "
import sys, json
bs = json.load(sys.stdin)['batches']
have = {s for s in (101,102,103,104)
        if any(f'-wfnull2-s{s}' in str(b['id']) and b['status'] in ('running','done') for b in bs)}
todo = [s for s in (101,102,103,104) if s not in have]
print(todo[0] if todo else '')
")
if [ -z "$NEXT" ]; then
  echo "all four rebuilt null runs exist — nothing to fire; run classifier-wf4arm-read.sh"
  exit 0
fi
BODY=$(cat <<EOF
{
  "universe": ["ETHUSDT","BNBUSDT","XRPUSDT","ADAUSDT","SOLUSDT","DOGEUSDT",
               "LTCUSDT","LINKUSDT","DOTUSDT","AVAXUSDT","TRXUSDT","XLMUSDT",
               "ETCUSDT","ATOMUSDT","BCHUSDT","UNIUSDT","ZECUSDT"],
  "permute": { "geometry": true, "decision": true },
  "minTradesSlice": 5,
  "feePerLeg": 0.125,
  "nullShiftSeed": $NEXT,
  "label": "wfnull2-s$NEXT",
  "description": "rebuilt null run seed $NEXT (vote mix dealt onto random days, register 66); no verdict alone; selects nothing"
}
EOF
)
echo "firing rebuilt null run, seed $NEXT..."
curl -sS --max-time 30 -X POST "$B/api/walkforward" -H 'Content-Type: application/json' -d "$BODY"
echo
