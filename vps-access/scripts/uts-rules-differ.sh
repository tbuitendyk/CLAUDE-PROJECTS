#!/usr/bin/env bash
# uts-rules-differ.sh -- READ-ONLY. Do the five ways of agreeing actually
# produce DIFFERENT trades? Takes settings that are identical in every way
# except which rule they use, and lines them up side by side. Fires nothing.
set -uo pipefail
B=http://127.0.0.1:8094
curl -sf --max-time 25 "$B/api/stagesets" -o /tmp/uts-rd-sets.json || { echo "no answer"; exit 1; }
ID=$(python3 -c '
import json
s=[x for x in (json.load(open("/tmp/uts-rd-sets.json")).get("sets") or []) if str(x.get("stage"))=="3"]
print(s[0]["id"] if s else "")')
echo "stage 3 set: $ID"
# one exact corner of the block: one hold time, one gate, one decision, one entry
Q='decision=argmax&entry=breakout&gate=directional&tMin=17&tMax=17'
curl -sf --max-time 180 "$B/api/stageset/$ID/ranked?from=0&n=500&$Q" -o /tmp/uts-rd.json || { echo "no answer"; exit 1; }
python3 <<'PY'
import json, collections, re
d=json.load(open('/tmp/uts-rd.json'))
rows=d.get('rows') or []
print(f"  {d.get('total')} settings in this corner of the block; reading {len(rows)}")
# a setting's name is "<how it agrees> <the trade shape> . <decision band 24/5>"
# strip the agreement off the front and everything after the dot: what is left
# is the trade, identical across the five rules
def shape(r):
    head=r['label'].split(' · ')[0]
    return re.sub(r'^(count|conviction|voices|families|unusual)\s+\d+%(\s+\+both)?(\s+\+hold\d)?\s+','',head)
g=collections.defaultdict(dict)
for r in rows:
    key=(shape(r), r.get('agreePct'), bool(r.get('agreeBoth')), r.get('agreePersist') or 0)
    g[key][r['agreeRule']]=r
full=[k for k,v in g.items() if len(v)>=4]
print(f"  {len(full)} trades priced under four or more of the rules\n")
shown=0
for k in full:
    v=g[k]
    if shown>=4: break
    shown+=1
    print(f"  {k[0]}   share {k[1]}%{' +both' if k[2] else ''}{' +hold'+str(k[3]) if k[3] else ''}")
    print(f"      {'rule':<11} {'rung':>6} {'agreed':>8} {'trades':>8} {'held-back $':>13} {'beat':>10}")
    for rule in ('count','conviction','voices','families','unusual'):
        r=v.get(rule)
        if not r: continue
        ag=r.get('avgAgreed'); ru=r.get('avgRung')
        print(f"      {rule:<11} {('-' if ru is None else round(ru,1)):>6} "
              f"{('-' if ag is None else str(round(ag,1))+'%'):>8} "
              f"{('-' if r.get('avgTrades') is None else round(r['avgTrades'],1)):>8} "
              f"{('-' if r.get('avgHold') is None else round(r['avgHold'],2)):>13} "
              f"{str(r.get('beat'))+'/'+str(r.get('pairs')):>10}")
    print()
# how often do two rules give the SAME answer on the same trade?
pairs=collections.Counter(); same=collections.Counter()
for v in g.values():
    names=[n for n in ('count','conviction','voices','families','unusual') if n in v]
    for i in range(len(names)):
        for j in range(i+1,len(names)):
            a,b=v[names[i]],v[names[j]]
            key=f"{names[i]} vs {names[j]}"
            pairs[key]+=1
            if (a.get('avgTrades')==b.get('avgTrades') and a.get('avgHold')==b.get('avgHold')
                and a.get('beat')==b.get('beat')): same[key]+=1
print("  how often two rules price the SAME trade identically:")
for key,n in sorted(pairs.items()):
    print(f"    {key:<26} {same[key]:>5} of {n:>5}   {100*same[key]/n:5.1f}%")
PY
