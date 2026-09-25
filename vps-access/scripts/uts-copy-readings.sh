#!/usr/bin/env bash
# uts-copy-readings.sh -- READ-ONLY. Every Stage 4 record set saved under a new
# name, with what it carried over from the set it was saved from: the readings
# on Held and Reserve (the other units, what was dropped, the ride), the
# held-back row looks on the Funnel, and the first-read stamps. An entry is
# carried over when its id does not start with the copy's own id, a look or a
# stamp when it is dated at or before the save. Nothing written.
set -uo pipefail
D=/opt/ultimate-trading-system/data/stagesets
sudo -u uts python3 - "$D" <<'PY'
import json, glob, os, sys
D = sys.argv[1]
n = 0
for f in sorted(glob.glob(os.path.join(D, 's4-*.json'))):
    if f.endswith('-tunescans.json') or f.endswith('-capture.json'): continue
    try: d = json.load(open(f))
    except Exception: continue
    if d.get('kind') in ('held', 'reserve'): continue
    cf = d.get('copiedFrom') or {}
    me = str(d.get('id')) + '-'
    parts = []
    for st, r in (d.get('readings') or {}).items():
        for k in ('others', 'dropped', 'ride'):
            xs = (r or {}).get(k) or []
            inh = [x for x in xs if not str((x or {}).get('id') or '').startswith(me)]
            if xs: parts.append(f"{st}.{k} {len(inh)} carried/{len(xs)}")
    at = cf.get('at') or ''
    hb = d.get('heldBackLooks') or []
    hbi = [x for x in hb if at and str((x or {}).get('at') or '') <= at]
    if hb: parts.append(f"funnel looks {len(hbi)} carried/{len(hb)}")
    for s in ('heldBackReadAt', 'reserveReadAt'):
        v = d.get(s)
        if v: parts.append(f"{s} {'carried' if at and str(v) <= at else 'own'}")
    if not cf and not parts: continue
    n += 1
    print(f"{d.get('id')} | {'saved from ' + str(cf.get('id')) + ' at ' + str(at)[:16] if cf else 'original'} | {d.get('name')}")
    print('   ' + ('; '.join(parts) if parts else 'nothing carried, nothing of its own'))
print(f'== {n} set(s)')
PY
