#!/usr/bin/env bash
# uts-s4-comparisons.sh <s4-set-id> -- READ-ONLY. For one Stage 4 record set:
# the four things a rule has to beat, on the held-back window, at EVERY hold
# length its stage 3 parent kept for the set's coin and shape (the verdict
# reads the worst of them), beside how many of the set's survivors hold for
# each length. Two files read off disk; changes nothing.
set -uo pipefail
id="${1:?set id}"
D=/opt/ultimate-trading-system/data/stagesets
python3 - "$D" "$id" <<'PY'
import json, sys, re, os, collections
D, sid = sys.argv[1], sys.argv[2]
doc = json.load(open(os.path.join(D, sid + '.json')))
unit = doc.get('unit'); parent = (doc.get('parent') or {}).get('id')
print('SET', sid, '|', doc.get('name'), '| unit', unit, '| parent', parent)
labels = [s.get('label') or '' for s in (doc.get('survivors') or [])]
hist = collections.Counter()
for L in labels:
    m = re.search(r'\bt(\d+)h\b', L)
    hist[int(m.group(1)) if m else -1] += 1
print('survivors by hold length (hours: count):', ' '.join(f'{k}:{v}' for k, v in sorted(hist.items())))
try:
    p = json.load(open(os.path.join(D, parent + '.json')))
except Exception as e:
    print('parent unreadable:', e); sys.exit(0)
units = ((p.get('controls') or {}).get('units') or {})
mine = units.get(unit) or {}
print('the four on the held-back window, per hold length key the parent kept for this unit:')
print('  key            alwaysLong   alwaysShort   buyHold   shortHold   survivors at this length')
def keyhours(k):
    m = re.search(r'(\d+)', k); return int(m.group(1)) if m else 0
for k in sorted(mine.keys(), key=keyhours):
    r = mine[k] or {}
    f = lambda v: 'none' if v is None else f'{float(v):9.2f}'
    print(f'  {k:14} {f(r.get("alwaysLong"))} {f(r.get("alwaysShort"))} {f(r.get("buyHold"))} {f(r.get("shortHold"))}   {hist.get(keyhours(k), 0)}')
w = ((p.get('windows') or {}).get('units') or {}).get(unit) or {}
print('held-back window:', json.dumps(w.get('hold')))
PY
