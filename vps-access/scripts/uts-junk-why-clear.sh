#!/usr/bin/env bash
# uts-junk-why-clear.sh -- WRITES. Clears the conviction sizing reason on every
# survivor of a Stage 4 record set where that reason is the sentence the save
# under a new name wrote itself (3.249.0 to 3.251.1), never one the owner typed.
# Owner order 2026-09-25: "DON'T WRITE CODE THAT OVERWRITES USER COMMENTS ...
# JUST DON'T!". The reason the owner typed at the save never reached the
# record, so the honest value is none. Each file is kept beside itself first
# (<id>.json.before-why-fix), written to a temporary file and moved into place.
set -uo pipefail
D=/opt/ultimate-trading-system/data/stagesets
sudo -u uts python3 - "$D" <<'PY'
import json, glob, os, sys, shutil
D = sys.argv[1]
tag = 'the numbers the conviction table on Tune was priced at, carried when '
for f in sorted(glob.glob(os.path.join(D, 's4-*.json'))):
    if f.endswith('-tunescans.json'): continue
    try: d = json.load(open(f))
    except Exception: continue
    n = 0
    for c in (d.get('stopChoices') or {}).values():
        sz = (c or {}).get('sizing')
        if sz and str(sz.get('why') or '').startswith(tag):
            sz['why'] = ''
            n += 1
    if not n: continue
    shutil.copy2(f, f + '.before-why-fix')
    tmp = f + '.tmp-why-fix'
    with open(tmp, 'w') as out: json.dump(d, out)
    json.load(open(tmp))
    os.replace(tmp, f)
    print(f"cleared {n} reason(s) on {d.get('id')} | {d.get('name')}")
print('== done')
PY
