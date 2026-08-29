#!/usr/bin/env bash
# uts-conviction-why.sh -- READ-ONLY. Why conviction rows show nothing in
# "share that agreed" and 0 of 1,000 against their null sets. Reads the
# answers file and a slice of the ranked table. Fires nothing, writes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data/stagesets
curl -sf --max-time 25 "$B/api/stagesets" -o /tmp/uts-cw-sets.json || { echo "no answer"; exit 1; }
ID=$(python3 -c '
import json
s=[x for x in (json.load(open("/tmp/uts-cw-sets.json")).get("sets") or []) if str(x.get("stage"))=="3"]
print(s[0]["id"] if s else "")')
echo "stage 3 set: $ID"
echo "== what the answers file holds =="
python3 -c "
import gzip,json,collections
m=json.load(gzip.open('$D/$ID-agreed.json.gz'))['map']
print('  entries:', len(m))
byrule=collections.defaultdict(list)
for k,v in m.items():
    parts=k.split('|')          # u | decision | rule | pct | both | persist
    byrule[parts[2]].append((k,v))
for rule in sorted(byrule):
    vals=[v['agreed'] for _,v in byrule[rule]]
    got=[x for x in vals if x is not None]
    print(f'  {rule:<11} {len(vals):>4} entries, {len(got):>4} with a value', end='')
    if got: print(f'   min {min(got):.1f}  max {max(got):.1f}')
    else: print('   -- EVERY ONE EMPTY')
print()
print('  three conviction entries in full:')
for k,v in byrule.get('conviction',[])[:3]:
    print('   ', k, v)
print()
print('  three count entries for comparison:')
for k,v in byrule.get('count',[])[:3]:
    print('   ', k, v)
"
echo
echo "== conviction rows: do they trade, and do they ever beat a null set? =="
curl -sf --max-time 180 "$B/api/stageset/$ID/ranked?from=0&n=200&rule=conviction" -o /tmp/uts-cw-c.json || echo "  (no answer)"
python3 -c "
import json
rows=json.load(open('/tmp/uts-cw-c.json')).get('rows') or []
traded=[r for r in rows if (r.get('avgTrades') or 0)>0]
quiet=[r for r in rows if not (r.get('avgTrades') or 0)]
print(f'  of the first {len(rows)} conviction rows: {len(traded)} traded, {len(quiet)} never traded')
for tag,grp in (('traded',traded),('never traded',quiet)):
    if not grp: continue
    r=grp[0]
    print(f'   a {tag} one: {r.get(\"label\")}')
    print(f'      trades {r.get(\"avgTrades\")}  beat {r.get(\"beat\")} of {r.get(\"pairs\")}  test \$ {r.get(\"avgTest\")}  held-back \$ {r.get(\"avgHold\")}')
print('  any conviction row anywhere with beat > 0? ', any((r.get('beat') or 0)>0 for r in rows))
"
