#!/usr/bin/env bash
# uts-cost-read.sh -- READ-ONLY. What it costs to trade, per held set and reserve
# set on the box: the fee the set was priced at, the round trip, the trades a
# setting, and what those trades cost against what the set made. Reads set files
# off disk; writes nothing.
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
    if d.get('kind') in ('held','reserve'): rows.append(d)
rows.sort(key=lambda d: str(d.get('createdAt') or ''))
NOTIONAL = 100.0
def m(v): return 'none' if not isinstance(v,(int,float)) else f'{v:,.2f}'
for d in rows:
    b = d.get('block') or {}
    h = b.get('read') or {}
    c = h.get('comparisons') or {}
    fee = ((b.get('fee') or {}).get('feePerLeg'))
    trades = h.get('trades'); real = h.get('real')
    print('=' * 100)
    print(f"{d.get('kind','?').upper():8s} {str(d.get('name'))[:72]}")
    if not isinstance(fee,(int,float)):
        print('   no fee on this block'); continue
    trip = 2 * fee * NOTIONAL
    print(f"   fee {100*fee:.4f}% a leg | round trip {100*2*fee:.4f}% = ${trip:.4f} on a ${int(NOTIONAL)} clip")
    if isinstance(trades,(int,float)):
        cost = trades * trip
        print(f"   {trades:.1f} trades a setting -> costs ${cost:,.2f} a setting")
        if isinstance(real,(int,float)):
            print(f"   the set made {m(real)} a setting, so before costs it made about {m(real + cost)}")
    for k in ('alwaysLong','alwaysShort','buyHold','shortHold'):
        v = c.get(k) or {}
        print(f"     {k:12s} lo {m(v.get('lo')):>12s}  hi {m(v.get('hi')):>12s}")
    al, ash = (c.get('alwaysLong') or {}), (c.get('alwaysShort') or {})
    for tag, a, s in (('at the worst hold', al.get('hi'), ash.get('lo')), ('at the best hold', al.get('lo'), ash.get('hi'))):
        if isinstance(a,(int,float)) and isinstance(s,(int,float)):
            print(f"     a coin flip {tag}: (long {m(a)} + short {m(s)}) / 2 = {m((a+s)/2)} a setting, over every chunk")
PY
