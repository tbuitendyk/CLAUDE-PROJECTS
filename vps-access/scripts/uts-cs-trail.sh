#!/usr/bin/env bash
# uts-cs-trail.sh -- READ-ONLY. The original half-life set and every set saved
# from it, every held set read from any of them: when each was written, the
# conviction sizing each carries (ladder, when applied, why), and every
# conviction pricing kept on Tune for them (what it read, when, the numbers).
# Nothing written.
set -uo pipefail
D=/opt/ultimate-trading-system/data/stagesets
sudo -u uts python3 - "$D" <<'PY'
import json, glob, os, sys, datetime
D = sys.argv[1]
docs = {}
for f in glob.glob(os.path.join(D, 's4-*.json')):
    try: d = json.load(open(f))
    except Exception: continue
    d['_mtime'] = datetime.datetime.utcfromtimestamp(os.path.getmtime(f)).strftime('%H:%M:%S')
    docs[d.get('id')] = d
root = 's4-mufzcga2-32'
fam = [root] + [i for i, d in docs.items() if (d.get('copiedFrom') or {}).get('id') == root]
held = [i for i, d in docs.items() if d.get('kind') in ('held', 'reserve') and (d.get('from') or {}).get('id') in fam]
def sizing(d):
    out = {}
    for L, c in (d.get('stopChoices') or {}).items():
        sz = (c or {}).get('sizing')
        k = (json.dumps(sz.get('ladder')), str(sz.get('at'))[:19], (sz.get('why') or '')[:50]) if sz and sz.get('on') else ('none', '', '')
        out[k] = out.get(k, 0) + 1
    return out
for i in sorted(fam + held, key=lambda x: str(docs[x].get('createdAt'))):
    d = docs[i]
    print(f"\n== {i} | {d.get('kind') or 'funnel'} | created {str(d.get('createdAt'))[:19]} | last written {d['_mtime']} | {d.get('name')}")
    if d.get('copiedFrom'): print(f"   saved from {d['copiedFrom']['id']} at {str(d['copiedFrom'].get('at'))[:19]} (stops {d['copiedFrom'].get('stops')}, sizing {d['copiedFrom'].get('sizing')})")
    if d.get('from'): print(f"   read from {d['from'].get('id')}")
    for (lad, at, why), n in sorted(sizing(d).items(), key=lambda x: x[0][1]):
        print(f"   sizing x{n}: {lad} applied {at} why '{why}'")
    t = (d.get('block') or {}).get('tuned')
    if t: print(f"   reading froze: withATuning {t.get('withATuning')} of {t.get('of')}")
    f = os.path.join(D, f"{i}-tunescans.json")
    if os.path.exists(f):
        x = json.load(open(f))
        for aim, r in ((x.get('scans') or {}).get('conviction') or {}).items():
            tg = r.get('target') or {}
            print(f"   conviction pricing {str(r.get('finishedUtc') or '')[:19]} {r.get('status')} on {str(tg.get('survivor'))[:30]} windows {tg.get('windows')} ladder {json.dumps(r.get('ladder'))}")
PY
