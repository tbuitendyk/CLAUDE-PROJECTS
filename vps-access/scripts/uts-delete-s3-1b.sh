#!/usr/bin/env bash
# uts-delete-s3-1b.sh [preview|confirm] -- deletes ONE record set, S3 #1b
# (s3-mtqf7tp2-2), through the service's own delete (owner order, 2026-09-28:
# "delete the old set"). It is the one set on the box that permuted 24/5 at
# stage 3, before 24/5 moved to stage 1 (3.285.0). The id is fixed here on
# purpose: this script can delete nothing else. `preview` (the default) asks
# the service what the delete would take and names any set that has it as a
# parent -- the service refuses to delete a parent. `confirm` deletes it.
set -uo pipefail
B=http://127.0.0.1:8094
ID=s3-mtqf7tp2-2
MODE="${1:-preview}"
echo "== the set, as the service lists it =="
curl -s --max-time 60 "$B/api/stagesets" > /tmp/uts-sets.json
python3 - "$ID" <<'PY'
import json, sys
d = json.load(open('/tmp/uts-sets.json'))
sets = d if isinstance(d, list) else d.get('sets', [])
me = [x for x in sets if x.get('id') == sys.argv[1]]
kids = [x for x in sets if (x.get('parent') or {}).get('id') == sys.argv[1]]
for x in me:
    p = x.get('params') or {}
    print(f"{x['id']} | {x.get('name')} | stage {x.get('stage')} | status {x.get('status')} | parent {(x.get('parent') or {}).get('id')} | 24/5 {p.get('weekdaysOnly')}")
if not me: print('not listed')
print(f"sets that name it as their parent: {len(kids)}")
for k in kids: print(f"  {k['id']} | {k.get('name')} | stage {k.get('stage')}")
PY
rm -f /tmp/uts-sets.json
if [ "$MODE" = "confirm" ]; then
  echo "== delete =="
  curl -s --max-time 120 -X POST -H 'Content-Type: application/json' -d "{\"confirm\":\"$ID\"}" "$B/api/stageset/$ID/delete"; echo
  echo "== still there? =="
  curl -s --max-time 60 "$B/api/stagesets" | python3 -c "import sys,json; d=json.load(sys.stdin); s=d if isinstance(d,list) else d.get('sets',[]); print('listed' if any(x.get('id')=='$ID' for x in s) else 'gone')"
  ls /opt/ultimate-trading-system/data/stagesets/ | grep -c "^$ID" | sed 's/^/files left named after it: /'
else
  echo "== what the delete would take (nothing is deleted) =="
  curl -s --max-time 60 -X POST -H 'Content-Type: application/json' -d '{}' "$B/api/stageset/$ID/delete"; echo
  ls /opt/ultimate-trading-system/data/stagesets/ | grep "^$ID" | head -20
fi
