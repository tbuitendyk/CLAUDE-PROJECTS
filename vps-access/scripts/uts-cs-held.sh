#!/usr/bin/env bash
# uts-cs-held.sh -- READ-ONLY. The held sets read from the cs tune copies: what
# each froze on its tunings block (the ladder, clips a trade, the money with the
# sizing) against its plain reading, so Held's table can be compared with what
# Greenlight prints. Nothing written.
set -uo pipefail
D=/opt/ultimate-trading-system/data/stagesets
sudo -u uts python3 - "$D" <<'PY'
import json, os, sys
D = sys.argv[1]
for i in ['s4-mugey0kk-37', 's4-mugfize6-39', 's4-mugfki2h-40']:
    f = os.path.join(D, i + '.json')
    if not os.path.exists(f): print('\n==', i, 'gone'); continue
    d = json.load(open(f))
    b = d.get('block') or {}
    t = b.get('tuned') or {}
    rows = t.get('rows') or []
    print(f"\n== {i} | {d.get('name')} | from {(d.get('from') or {}).get('id')} | block at {str(b.get('at'))[:19]} release {b.get('release')}")
    print(f"   tuned: window {t.get('window')} of {t.get('of')} withATuning {t.get('withATuning')} withAStop {t.get('withAStop')} priced {t.get('priced')} why {t.get('why')!r}")
    lads = {}
    for r in rows:
        k = json.dumps(((r.get('sizing') or {}).get('ladder')))
        lads[k] = lads.get(k, 0) + 1
    for k, n in lads.items(): print(f"   ladder x{n}: {k}")
    tot = lambda key: round(sum((r.get(key) or 0) for r in rows), 2)
    cp = [r.get('clipsPerTrade') for r in rows if r.get('clipsPerTrade') is not None]
    print(f"   sums over {len(rows)} rows: plain {tot('plainUsd')} flat {tot('flatUsd')} stop {tot('stopUsd')} with the sizing {tot('tunedUsd')} | clips a trade avg {round(sum(cp)/len(cp),3) if cp else None} | trades {tot('trades')} priced {tot('priced')}")
    for r in rows[:4]:
        print(f"   {r.get('label')[:60]} | trades {r.get('trades')} priced {r.get('priced')} plain {r.get('plainUsd')} tuned {r.get('tunedUsd')} clips {r.get('clipsPerTrade')}")
    sv = (b.get('survivors') or {}).get('rows') or []
    print(f"   survivors table rows {len(sv)}; first: {[(x.get('label')[:40], x.get('trades'), x.get('money')) for x in sv[:2]]}")
PY
