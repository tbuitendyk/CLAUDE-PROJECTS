#!/usr/bin/env bash
# uts-check-set.sh -- READ-ONLY. Runs the shipped `check this set` over every
# stage 3 record set and prints what it found. Adds nothing, changes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data
for f in "$D"/stagesets/s3-*.json; do
  [ -f "$f" ] || continue
  ID=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$f")
  echo "== $ID =="
  curl -sf --max-time 540 "$B/api/stageset/$ID/check" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if d.get('error'): print('   could not run:', d['error']); raise SystemExit
print('   %s   %s records, %s settings, %s units' % (
  'SOUND' if d.get('ok') else 'NOT SOUND',
  format(d.get('rows',0), ','), format(d.get('settings',0), ','), d.get('units')))
for c in d.get('checks', []):
    print('   %-4s %-52s %s' % ('yes' if c['ok'] else 'NO', c['name'], c.get('detail','')))
b = d.get('block')
if b:
    if b.get('why'): print('   ---  against its own block: could not compare -', b['why'])
    else: print('   %-4s %-52s held %s, declared %s, extra %s, missing %s' % (
      'yes' if b['ok'] else 'NO', 'the set holds exactly what its block declares',
      format(b['held'],','), format(b['declared'],','), format(b['surplus'],','), format(b['missing'],',')))
"
done
