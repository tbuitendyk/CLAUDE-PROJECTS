#!/usr/bin/env bash
# uts-cs-scans.sh -- READ-ONLY. For the Stage 4 sets whose name holds "cs tune"
# and the set each was saved from: every conviction scan kept on Tune (the
# survivor or all, the windows, when, and the multipliers it priced), and the
# sizing on record with when and by whom it was applied. Nothing written.
set -uo pipefail
D=/opt/ultimate-trading-system/data/stagesets
sudo -u uts python3 - "$D" <<'PY'
import json, glob, os, sys
D = sys.argv[1]
docs = {}
for f in glob.glob(os.path.join(D, 's4-*.json')):
    try: d = json.load(open(f))
    except Exception: continue
    docs[d.get('id')] = d
want = [d for d in docs.values() if 'cs tune' in str(d.get('name')) and (d.get('kind') or 'funnel') == 'funnel']
ids = []
for d in want:
    ids.append(d['id'])
    if d.get('copiedFrom'): ids.append(d['copiedFrom']['id'])
for i in ids:
    d = docs.get(i) or {}
    print(f"\n== {i} | {d.get('name')}")
    ch = d.get('stopChoices') or {}
    ats = {}
    for L, c in ch.items():
        sz = (c or {}).get('sizing')
        if sz and sz.get('on'):
            k = (json.dumps(sz.get('ladder')), str(sz.get('at'))[:19], sz.get('why') or '')
            ats[k] = ats.get(k, 0) + 1
    for (lad, at, why), n in sorted(ats.items(), key=lambda x: x[0][1]):
        print(f"   sizing on record x{n}: {lad} applied {at} why '{why}'")
    f = os.path.join(D, f"{i}-tunescans.json")
    try: x = json.load(open(f))
    except Exception: print('   no scans kept'); continue
    conv = ((x.get('scans') or {}).get('conviction') or {})
    rows = []
    for aim, r in conv.items():
        rows.append((str(r.get('finishedUtc') or r.get('startedUtc') or ''), aim, r.get('status'), json.dumps(r.get('ladder')), (r.get('target') or {}).get('survivor')))
    for fin, aim, st, lad, sv in sorted(rows):
        print(f"   conviction scan {fin[:19]} {st} survivor {str(sv)[:40]} ladder {lad}")
PY
