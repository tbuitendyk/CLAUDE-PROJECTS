#!/usr/bin/env bash
# uts-coin-floors.sh -- READ-ONLY. Does each floor on the every-coin table
# actually remove rows? Asks the endpoint the page asks, one floor at a time,
# and prints how many rows survive each. Fires nothing, writes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
curl -sf --max-time 25 "$B/api/stagesets" -o /tmp/uts-cf-sets.json || { echo "no answer"; exit 1; }
ID=$(python3 -c '
import json
s=[x for x in (json.load(open("/tmp/uts-cf-sets.json")).get("sets") or []) if str(x.get("stage"))=="3"]
print(s[0]["id"] if s else "")')
[ -n "$ID" ] || { echo "no stage 3 set"; exit 1; }
echo "stage 3 set: $ID"
ask () { curl -sf --max-time 120 "$B/api/stageset/$ID/coins?limit=1&$1" ; }
for q in "" "minTest=1000000" "minHold=1000000" "minTrades=1000000" "minVsLong=1000000" "minShare=100" "minPairs=1000000000" "minAgreed=101"; do
  out=$(ask "$q")
  echo "$out" | python3 -c "
import json,sys
q='''$q''' or '(no floor)'
try: d=json.load(sys.stdin)
except Exception: print(f'  {q:<26} (no answer)'); raise SystemExit
print(f\"  {q:<26} total {d.get('total')}   removed {d.get('removed')}\")
"
done
echo
echo "== and a moderate floor on each, to see it bite in the middle =="
for q in "minTest=0" "minHold=0" "minAgreed=90"; do
  ask "$q" | python3 -c "
import json,sys
q='''$q'''
d=json.load(sys.stdin)
print(f\"  {q:<26} total {d.get('total')}   removed {d.get('removed')}\")
"
done
