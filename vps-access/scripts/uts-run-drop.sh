#!/usr/bin/env bash
# uts-run-drop.sh -- WRITES. Starts the pass that drops the settings the block
# does not declare, on the owner's explicit order ("drop the 1,008 market
# duplicates GO NOW!" and "do what needs to be done to get the data migrated").
#
# What it kept is written BESIDE the records and counted before anything is
# replaced, so an interruption leaves the set exactly as it is.
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data
for f in "$D"/stagesets/s3-*.json; do
  [ -f "$f" ] || continue
  ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$f")
  echo "== $ID =="
  echo "-- before --"
  python3 -c "
import json
d=json.load(open('$f'))
print('   names held', len((d.get('plan') or {}).get('settingLabels') or []))
print('   drops     ', d.get('drops'))"
  echo "-- starting --"
  curl -sf --max-time 60 -X POST "$B/api/stageset/$ID/drop-undeclared" -H 'Content-Type: application/json' -d '{}' | sed 's/^/   /'
  echo
done
