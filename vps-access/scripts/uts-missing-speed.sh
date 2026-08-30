#!/usr/bin/env bash
# uts-missing-speed.sh -- READ-ONLY. How long the block question takes now, cold
# then warm. Asks four times; changes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data
for f in "$D"/stagesets/s3-*.json; do
  [ -f "$f" ] || continue
  ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$f")
  echo "== $ID =="
  for i in 1 2 3 4; do
    S=$(date +%s%N)
    OUT=$(curl -sf --max-time 540 "$B/api/stageset/$ID/missing")
    E=$(date +%s%N)
    printf "   ask %d: %6d ms   " "$i" "$(( (E-S)/1000000 ))"
    echo "$OUT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('held %s  declared %s  missing %s  surplus %s  band %s' % (
  format(d.get('held',0),','), format(d.get('declared',0),','), d.get('missing'), d.get('surplus'),
  (d.get('gate') or {}).get('band')))"
  done
done
ps -eo rss,args -C node 2>/dev/null | grep -- '--max-old-space' | awk '{printf "  service now at %.0f MB\n", $1/1024}'
