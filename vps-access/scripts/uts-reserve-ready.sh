#!/usr/bin/env bash
# uts-reserve-ready.sh -- READ-ONLY. Everything that decides whether the reserve
# grade can be pressed on a Stage 4 record set, and what pressing would cost:
# the verdict it stands on, whether the sealed window is intact, how many looks
# have already been spent, what it refuses on right now, and whether the stage 2
# set still holds the saved models the reserve pricing forecasts with. Presses
# nothing, writes nothing, spends no look.
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data
curl -sf --max-time 25 "$B/api/stagesets" -o /tmp/uts-rr-sets.json || { echo "the record-set list did not answer"; exit 1; }
IDS=$(python3 -c 'import json;print(" ".join(s["id"] for s in (json.load(open("/tmp/uts-rr-sets.json")).get("sets") or []) if s.get("stage")==4))')
if [ -z "$IDS" ]; then echo "no Stage 4 record set on this box"; exit 0; fi
for id in $IDS; do
  echo "== $id =="
  if ! curl -sf --max-time 90 "$B/api/funnel/set/$id/unread" -o /tmp/uts-rr-dry.json; then
    echo "  the dry read did not answer"; continue
  fi
  python3 - <<'PY'
import json, datetime
d = json.load(open('/tmp/uts-rr-dry.json'))
def day(ts):
    try: return datetime.datetime.utcfromtimestamp(int(ts)/1000).strftime('%Y-%m-%d')
    except Exception: return '?'
g = d.get('gate')
s = d.get('sealed') or {}
r = d.get('rules') or {}
print('  name       %s | %s' % (d.get('name'), d.get('unitName') or d.get('unit')))
print('  survivors  %s' % d.get('survivors'))
print('  rule       %s' % (d.get('ruleSentence') or '')[:160])
print('  verdict    %s' % (('%s stood, release %s' % (g['id'], g.get('release'))) if g else 'NONE STOOD -- the grade would refuse'))
if s.get('intact'):
    print('  sealed     intact on this unit from %s, %s chunks at the seal' % (day(s.get('fromTs')), s.get('chunks')))
else:
    print('  sealed     NOT INTACT -- %s' % s.get('why'))
looks = d.get('looks') or 0
print('  looks      %d already stamped; pressing would be look %d' % (looks, looks + 1))
print('  reads at   bar share %s%% | noise must lose at least %s%% | copies %s' % (r.get('barPct'), r.get('sanityPct'), r.get('copies')))
print('  refused    %s' % (d.get('refused') or 'nothing -- it would run'))
PY
done
echo "== the saved models the reserve pricing forecasts with =="
shopt -s nullglob
for f in "$D"/stagesets/s2-*.json; do
  id=$(basename "$f" .json)
  st="$D/batches/$id.rows"
  cnt=$(ls -1 "$st"/models* 2>/dev/null | wc -l)
  if [ "$cnt" -gt 0 ]; then
    echo "  $id: models rows present, $(du -shc "$st"/models* 2>/dev/null | tail -1 | cut -f1)"
  else
    echo "  $id: NO models rows -- the reserve grade cannot forecast without them"
  fi
done
echo "== the chain behind each Stage 4 set =="
python3 - <<'PY'
import json, glob, os
D = '/opt/ultimate-trading-system/data/stagesets'
for f in sorted(glob.glob(D + '/s4-*.json')):
    try: d = json.load(open(f))
    except Exception: continue
    p = (d.get('parent') or {}).get('id')
    par = None
    if p:
        try: par = json.load(open(os.path.join(D, p + '.json')))
        except Exception: par = None
    gp = ((par or {}).get('parent') or {}).get('id')
    print('  %s -> stage 3 %s -> stage 2 %s' % (os.path.basename(f)[:-5], p, gp))
PY
