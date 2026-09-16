#!/usr/bin/env bash
# uts-hr-outliers.sh -- READ-ONLY. For every held set and reserve set: the stop
# and sizing choices frozen on it, the tuned block it carries, and its three
# biggest and three smallest survivors by money with their trade counts.
set -uo pipefail
D=/opt/ultimate-trading-system/data/stagesets
python3 - "$D" <<'PY'
import json, os, sys
D = sys.argv[1]
rows = []
for f in os.listdir(D):
    if not f.endswith('.json') or not f.startswith('s4-'): continue
    try: d = json.load(open(os.path.join(D, f)))
    except Exception: continue
    if d.get('kind') in ('held','reserve') or (d.get('stopChoices') or {}): rows.append(d)
rows.sort(key=lambda d: str(d.get('createdAt') or ''))
def m(v): return 'none' if not isinstance(v,(int,float)) else f'{v:,.2f}'
for d in rows:
    b = d.get('block') or {}
    ch = d.get('stopChoices') or {}
    print('='*96)
    print(f"{(d.get('kind') or 'rule').upper():8s} {d.get('id')}  {str(d.get('name'))[:70]}")
    if ch:
        for k, c in ch.items():
            sz = c.get('sizing') or {}
            print(f"   CHOICE on '{k}': stop={c.get('stopPct')} stopSaid={'stopPct' in c} sizing={'ON ladder='+str(len(sz.get('ladder') or []))+' clip='+str(sz.get('clipUsd')) if sz.get('on') else 'off'} why={str(c.get('why'))[:40]} at={str(c.get('at'))[:10]}")
    else:
        print("   no stop or sizing choice on this set")
    t = b.get('tuned')
    if t:
        print(f"   TUNED block: window={t.get('window')} of={t.get('of')} withATuning={t.get('withATuning')} priced={t.get('priced')} clip={t.get('clipUsd')} why={t.get('why')}")
        for r in (t.get('rows') or []):
            print(f"      {r.get('label')}: plain={m(r.get('plainUsd'))} flat={m(r.get('flatUsd'))} tuned={m(r.get('tunedUsd'))} trades={r.get('trades')} stopped={r.get('stopped')} differs={r.get('differs')}")
    elif b:
        print("   no tuned block on this set")
    sv = (b.get('survivors') or {}).get('rows') or []
    good = sorted([x for x in sv if isinstance(x.get('money'),(int,float))], key=lambda x: x['money'])
    if good:
        for tag, lst in (('LOWEST', good[:3]), ('HIGHEST', good[-3:])):
            for x in lst:
                print(f"   {tag:7s} {x.get('label')}: money={m(x.get('money'))} trades={x.get('trades')} vsLong={m(x.get('vsLong'))}")
PY
