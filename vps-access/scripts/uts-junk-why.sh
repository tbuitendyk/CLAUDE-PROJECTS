#!/usr/bin/env bash
# uts-junk-why.sh -- READ-ONLY. Every Stage 4 record set whose conviction
# sizing reason on a survivor is the sentence the save under a new name wrote
# itself (3.249.0 to 3.251.1), not a reason the owner typed. Nothing written.
set -uo pipefail
D=/opt/ultimate-trading-system/data/stagesets
sudo -u uts python3 - "$D" <<'PY'
import json, glob, os, sys
D = sys.argv[1]
tag = 'the numbers the conviction table on Tune was priced at, carried when '
for f in sorted(glob.glob(os.path.join(D, 's4-*.json'))):
    if f.endswith('-tunescans.json'): continue
    try: d = json.load(open(f))
    except Exception: continue
    n = sum(1 for c in (d.get('stopChoices') or {}).values() if str(((c or {}).get('sizing') or {}).get('why') or '').startswith(tag))
    if n:
        src = (d.get('copiedFrom') or {}).get('id')
        print(f"{d.get('id')} | {d.get('kind') or 'funnel'} | {n} survivor(s) | saved from {src} | {d.get('name')}")
print('== done')
PY
