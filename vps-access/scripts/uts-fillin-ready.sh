#!/usr/bin/env bash
# uts-fillin-ready.sh -- READ-ONLY. Would `fill in the missing settings` get
# past the two lines that killed it? Asks the service; starts nothing, writes
# nothing.
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data

echo "== release the box is serving =="
curl -sf --max-time 20 "$B/api/version" 2>/dev/null | head -c 300; echo

for f in "$D"/stagesets/s3-*.json; do
  [ -f "$f" ] || continue
  ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$f")
  echo
  echo "== $ID =="

  echo "-- the subtraction that would have hung it, on the real set --"
  S=$(date +%s%N)
  OUT=$(curl -sf --max-time 240 "$B/api/stageset/$ID/missing")
  E=$(date +%s%N)
  echo "   answered in $(( (E-S)/1000000 )) ms"
  echo "$OUT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for k in ('held','declared','missing','units','pricings','appends'):
    print('   %-10s %s' % (k, d.get(k)))
g=d.get('gate') or {}
print('   memory    %s  %s' % (g.get('band'), str(g.get('message'))[:110]))
"

  echo "-- how many rows the ranked table holds, which is what the setting number is read from --"
  curl -sf --max-time 240 "$B/api/stageset/$ID/ranked?from=0&n=1" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('   ranked rows', d.get('of'), ' (the next free setting number is one past the highest of these)')
r=(d.get('rows') or [{}])[0]
print('   first row si', r.get('si'), ' gate', r.get('gate'), ' entry', r.get('entry'))
"

  echo "-- and what the set records it holds --"
  python3 -c "
import json
d=json.load(open('$f'))
pl=d.get('plan') or {}
print('   setting names held', len(pl.get('settingLabels') or []))
print('   appends recorded  ', d.get('appends'))
"
  echo "-- the fill-in's own status right now --"
  curl -sf --max-time 20 "$B/api/stageset/$ID/fill-in/status" | sed 's/^/   /'
  echo
done

echo
echo "== memory on the box =="
free -m | sed 's/^/  /'
ps -o pid,etime,pcpu,rss,args -C node --sort=-rss 2>/dev/null | head -4
