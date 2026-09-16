#!/usr/bin/env bash
# uts-hr-money.sh -- READ-ONLY. For every held set and reserve set on the box:
# the money its block recorded, the four comparisons it was read against, the
# survivor counts, and the window. Reads the set files off disk; writes nothing.
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
    if d.get('kind') not in ('held', 'reserve'): continue
    rows.append(d)
rows.sort(key=lambda d: str(d.get('createdAt') or ''))
def m(v):
    return 'none' if v is None else (f'{v:,.2f}' if isinstance(v,(int,float)) else str(v))
def day(ts):
    import datetime
    if not ts: return 'none'
    return datetime.datetime.utcfromtimestamp(ts/1000).strftime('%Y-%m-%d')
for d in rows:
    b = d.get('block') or {}
    h = b.get('read') or {}
    c = h.get('comparisons') or {}
    o = h.get('own') or {}
    cp = b.get('copies') or {}
    sn = b.get('sanity') or {}
    w = b.get('window') or {}
    v = b.get('verdict') or {}
    print('=' * 100)
    print(f"{d.get('kind','?').upper():8s} {d.get('id')}  {d.get('name')}")
    print(f"  stamped {str(b.get('at'))[:16]} release {b.get('release')}  verdict {'PASS' if v.get('pass') else 'FAIL'}  look {b.get('look')}")
    print(f"  MONEY a setting: {m(h.get('real'))}   over {h.get('of')} survivors, {m(h.get('trades'))} trades a setting, vs always long {m(h.get('vsLong'))}")
    print(f"  the four (lo..hi): " + '  '.join(
        f"{k}={m((c.get(k) or {}).get('lo'))}..{m((c.get(k) or {}).get('hi'))}" for k in ('alwaysLong','alwaysShort','buyHold','shortHold')))
    print(f"  best of four at worst hold: {m((c.get('best') or {}).get('hi'))}  beatsBest={c.get('beatsBest')}  comparison keys={len(c.get('keys') or [])}")
    print(f"  own-hold gate: {o.get('clearing')} of {o.get('survivors')} clear, bar {o.get('bar')}, {o.get('unknown')} with no figure -> pass={o.get('pass')}")
    print(f"  copies: real {m(cp.get('real'))} beats {cp.get('beats')} of {cp.get('copies')}, bar {cp.get('bar')} -> {cp.get('pass')}")
    print(f"  sanity: losing {cp and sn.get('board',{}).get('losing')} of {sn.get('board',{}).get('figures')} -> {sn.get('ok')}")
    if w: print(f"  window priced: {day(w.get('fromTs'))} .. {day(w.get('toTs'))}, {w.get('chunks')} chunks, data reached {day(w.get('seenToTs'))}")
    print(f"  forecasts: {b.get('forecasts')}")
    pr = b.get('priced') or []
    if pr:
        vals = sorted([x.get('money') for x in pr if isinstance(x.get('money'),(int,float))])
        if vals:
            n = len(vals)
            print(f"  per survivor money: min {m(vals[0])}  median {m(vals[n//2])}  max {m(vals[-1])}  positive {sum(1 for x in vals if x>0)} of {n}")
    sv = (b.get('survivors') or {}).get('rows') or []
    if sv:
        vals = sorted([x.get('money') for x in sv if isinstance(x.get('money'),(int,float))])
        n = len(vals)
        tr = [x.get('trades') for x in sv if isinstance(x.get('trades'),(int,float))]
        print(f"  block rows: {n} with money, min {m(vals[0] if vals else None)} median {m(vals[n//2] if vals else None)} max {m(vals[-1] if vals else None)}, positive {sum(1 for x in vals if x>0)}; trades min {min(tr) if tr else 'none'} max {max(tr) if tr else 'none'}")
PY
