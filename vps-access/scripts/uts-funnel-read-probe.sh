#!/usr/bin/env bash
# uts-funnel-read-probe.sh -- READ-ONLY in intent: the Funnel's own first read
# of a stage 3 set, as the page makes it, so what the page will be shown can be
# read here first. Since 3.139.0 the engine brings a third-shape numbers file
# to the fourth on that read (beside, verified, swapped), which is the point:
# this makes the move happen now rather than when the owner next looks.
#   usage: uts-funnel-read-probe.sh <stage 3 set id> [unit key or 'all']
set -uo pipefail
ID="${1:-}"; UNIT="${2:-all}"
[ -n "$ID" ] || { echo "usage: uts-funnel-read-probe.sh <stage 3 set id> [unit|all]"; exit 1; }
curl -sS -m 120 -X POST "http://127.0.0.1:8094/api/funnel/$ID/read" -H 'Content-Type: application/json' \
  -d "{\"step\":1,\"rule\":{\"ranges\":{},\"allowed\":{},\"floors\":{}},\"unit\":\"$UNIT\",\"closing\":{\"key\":\"rule\"}}" | python3 -c '
import sys,json
try: d=json.load(sys.stdin)
except Exception as e: print("  (no readable answer:", e, ")"); sys.exit(0)
if d.get("error"): print("  error:", d["error"]); sys.exit(0)
print("  unit      :", d.get("unit"), "-", d.get("unitName"))
print("  richOn    :", json.dumps(d.get("richOn")))
print("  richSet   :", json.dumps(d.get("richSet")))
print("  rebuilt   :", d.get("rebuilt"))
'
echo "== the numbers file now =="
ls -la /opt/ultimate-trading-system/data/stagesets/"$ID".funnelrich.json* 2>/dev/null
python3 -c '
import json,sys
p="/opt/ultimate-trading-system/data/stagesets/'"$ID"'.funnelrich.json"
d=json.load(open(p))
print("  v:", d.get("v"), " release:", d.get("release"), " savedAt:", d.get("savedAt"), " migratedAt:", d.get("migratedAt"), " migratedFrom:", d.get("migratedFrom"))
print("  unitsTotal:", d.get("unitsTotal"), " unitsDone:", d.get("unitsDone"), " settings:", len(d.get("settings",{})))
'
