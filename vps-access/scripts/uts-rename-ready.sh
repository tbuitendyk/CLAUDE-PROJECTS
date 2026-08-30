#!/usr/bin/env bash
# uts-rename-ready.sh -- READ-ONLY. Does the box see the settings that are
# behind, and does it now refuse to price before they are renamed? Asks two
# status endpoints; starts nothing.
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data
for f in "$D"/stagesets/s3-*.json; do
  [ -f "$f" ] || continue
  ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$f")
  echo "== $ID =="
  echo "-- how many names are behind --"
  curl -sf --max-time 30 "$B/api/stageset/$ID/rename-settings/status" | sed 's/^/   /'
  echo
  echo "-- and what the fill-in line is being told --"
  curl -sf --max-time 240 "$B/api/stageset/$ID/missing" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for k in ('held','declared','missing','behind','surplus','drops','units','pricings'):
    print('   %-10s %s' % (k, d.get(k)))
"
done
