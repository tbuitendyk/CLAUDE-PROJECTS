#!/usr/bin/env bash
# uts-copy-readings-clear.sh -- WRITES. On every Stage 4 record set saved under
# a new name, takes off what it carried over from the set it was saved from
# (release 3.251.4, owner 2026-09-25: "why did the code leave the old 'work out
# the held-back ride' section populated with previous data ... FIX THAT ON
# HELD AND RESERVE"): the readings on Held and Reserve whose id is not the
# copy's own (the other units, what was dropped, the ride), the held-back row
# looks on the Funnel dated at or before the save, and a first-read stamp dated
# at or before the save -- which becomes the copy's own first read, if it has
# one, or goes. Every look still counts on the copy through the sets saved from
# the same original. Each file is kept beside itself first
# (<id>.json.before-3.251.4), written to a temporary file, read back, and moved
# into place. Nothing else on the set is touched.
set -uo pipefail
D=/opt/ultimate-trading-system/data/stagesets
sudo -u uts python3 - "$D" <<'PY'
import json, glob, os, sys, shutil
D = sys.argv[1]
docs = {}
for f in sorted(glob.glob(os.path.join(D, 's4-*.json'))):
    if f.endswith('-tunescans.json') or f.endswith('-capture.json'): continue
    try: docs[f] = json.load(open(f))
    except Exception: continue
judges = [d for d in docs.values() if d.get('kind') in ('held', 'reserve')]
n = 0
for f, d in docs.items():
    if d.get('kind') in ('held', 'reserve'): continue
    cf = d.get('copiedFrom') or {}
    at = str(cf.get('at') or '')
    if not cf or not at: continue
    me = str(d.get('id')) + '-'
    took = []
    rd = d.get('readings') or {}
    for st in list(rd.keys()):
        r = rd.get(st) or {}
        for k in ('others', 'dropped', 'ride'):
            xs = r.get(k) or []
            keep = [x for x in xs if str((x or {}).get('id') or '').startswith(me)]
            if len(keep) != len(xs): took.append(f"{st}.{k} {len(xs) - len(keep)}")
            r[k] = keep
        if not any(r.get(k) for k in ('others', 'dropped', 'ride')): del rd[st]
    if 'readings' in d:
        if rd: d['readings'] = rd
        else: del d['readings']
    hb = d.get('heldBackLooks')
    if isinstance(hb, list):
        keep = [x for x in hb if str((x or {}).get('at') or '') > at]
        if len(keep) != len(hb): took.append(f"funnel looks {len(hb) - len(keep)}")
        if keep: d['heldBackLooks'] = keep
        else: del d['heldBackLooks']
    for stamp, st in (('heldBackReadAt', 'held'), ('reserveReadAt', 'reserve')):
        v = d.get(stamp)
        if v and str(v) <= at:
            own = sorted(str((j.get('block') or {}).get('at') or '') for j in judges if j.get('kind') == st and (j.get('from') or {}).get('id') == d.get('id') and (j.get('block') or {}).get('at'))
            if own: d[stamp] = own[0]; took.append(f"{stamp} -> own first read {own[0][:16]}")
            else: del d[stamp]; took.append(f"{stamp} off")
    if not took: continue
    shutil.copy2(f, f + '.before-3.251.4')
    tmp = f + '.tmp-3.251.4'
    with open(tmp, 'w') as out: json.dump(d, out)
    back = json.load(open(tmp))
    assert back.get('id') == d.get('id') and back.get('survivors') == d.get('survivors')
    os.replace(tmp, f)
    n += 1
    print(f"{d.get('id')} | took off: {'; '.join(took)} | {d.get('name')}")
print(f'== {n} set(s) changed')
PY
