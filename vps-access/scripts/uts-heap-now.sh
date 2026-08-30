#!/usr/bin/env bash
# uts-heap-now.sh -- READ-ONLY. Is the bigger heap actually in force, and do the
# tables still serve under it? Asking for the ranked table parses the tally into
# the cache, which is the thing the heap was raised to hold.
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data
echo "== the running process =="
ps -eo pid,rss,args -C node 2>/dev/null | grep -- '--max-old-space-size' | sed 's/^/  /'
echo "== what systemd allows it =="
systemctl show ultimate-trading-system -p MemoryHigh -p MemoryMax -p MemoryCurrent --value | paste -sd' / ' - | sed 's/^/  high \/ max \/ now (bytes): /'
echo
for f in "$D"/stagesets/s3-*.json; do
  [ -f "$f" ] || continue
  ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$f")
  echo "== $ID =="
  echo "-- the tables, and how long they take to answer --"
  S=$(date +%s%N)
  curl -sf --max-time 540 "$B/api/stageset/$ID/ranked?from=0&n=1" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for k in ('totalling','waiting','failed'):
    if d.get(k): print('   %s: %s' % (k, str(d[k])[:150]))
if d.get('of') is not None: print('   rows in the table:', format(d['of'], ','))
"
  E=$(date +%s%N); echo "   answered in $(( (E-S)/1000000 )) ms"
  echo "-- and what the budget gate says now --"
  curl -sf --max-time 540 "$B/api/stageset/$ID/missing" | python3 -c "
import json,sys
d=json.load(sys.stdin)
g=d.get('gate') or {}
print('   held %s, declared %s, surplus %s, missing %s' % (
  format(d.get('held',0),','), format(d.get('declared',0),','), d.get('surplus'), format(d.get('missing',0),',')))
print('   memory band:', g.get('band'), '-', (g.get('message') or 'no warning'))
"
done
echo
echo "== the box, after =="
free -m | sed -n 2p | sed 's/^/  /'
ps -eo rss,args --sort=-rss 2>/dev/null | head -4 | awk 'NR>1{printf "  %6.0f MB  %s\n", $1/1024, substr($0,index($0,$2),60)}'
