#!/usr/bin/env bash
# uts-by-bar.sh -- READ-ONLY. The answers file split by way of weighing AND by
# bar, against what the records actually hold. Fires nothing, writes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
D=/opt/ultimate-trading-system/data/stagesets
ID=$(python3 -c '
import json,urllib.request
d=json.load(urllib.request.urlopen("http://127.0.0.1:8094/api/stagesets"))
s=[x for x in (d.get("sets") or []) if str(x.get("stage"))=="3"]
print(s[0]["id"] if s else "")')
echo "stage 3 set: $ID"
python3 -c "
import gzip,json,collections
m=json.load(gzip.open('$D/$ID-agreed.json.gz'))['map']
print('  answers entries:', len(m))
g=collections.defaultdict(list)
for k,v in m.items():
    p=k.split('|')            # u | decision | rule | bar | pct | both | persist
    g[(p[2],p[3])].append(v)
print(f\"    {'rule':<11} {'bar':<5} {'entries':>8} {'with a value':>13}   range\")
for key in sorted(g):
    vals=[v['agreed'] for v in g[key]]
    got=[x for x in vals if x is not None]
    rng = f'{min(got):.1f} .. {max(got):.1f}' if got else '-- all empty'
    print(f'    {key[0]:<11} {key[1]:<5} {len(vals):>8} {len(got):>13}   {rng}')
"
echo
echo "== and what the RECORDS hold, from the ranked table =="
for q in "rule=count&bar=all%20of%20them" "rule=count&bar=its%20own%20history" "rule=conviction" "rule=voices" "rule=families"; do
  curl -sf --max-time 180 "$B/api/stageset/$ID/ranked?from=0&n=1&$q" | python3 -c "
import json,sys
d=json.load(sys.stdin)
sp=(d.get('spread') or {}).get('agreedMin')
r=(d.get('rows') or [None])[0]
tag='''$q'''.replace('%20',' ')
val = '-' if not sp else f\"{sp['min']:.1f} .. {sp['max']:.1f}  (n={sp['n']})\"
print(f\"  {tag:<34} rows {d.get('total'):>7}   share that agreed {val}\")
" 2>/dev/null || echo "  $q -- no answer"
done
