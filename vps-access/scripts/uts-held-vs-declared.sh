#!/usr/bin/env bash
# uts-held-vs-declared.sh -- READ-ONLY. The set holds 329,280 setting names and
# its block declares 524,832, yet 262,416 are reported missing — which means
# 66,864 held names are not in the declared list at all. This prints what those
# names LOOK like, beside names that are declared, so the difference can be
# seen rather than guessed. Reads two files; changes nothing.
set -uo pipefail
D=/opt/ultimate-trading-system/data

python3 - "$D" <<'PY'
import json, glob, os, sys, collections
D = sys.argv[1]
for f in sorted(glob.glob(os.path.join(D, 'stagesets', 's3-*.json'))):
    d = json.load(open(f))
    labs = (d.get('plan') or {}).get('settingLabels') or []
    print('==', d.get('id'), '--', len(labs), 'setting names held')
    print()
    print('-- the saved params the declared list is enumerated from --')
    p = d.get('params') or {}
    for k in sorted(p):
        v = p[k]
        s = json.dumps(v)
        print('   %-16s %s' % (k, s if len(s) < 150 else s[:150] + ' ...'))
    print()
    print('-- twenty held names, spread across the list --')
    step = max(1, len(labs) // 20)
    for i in range(0, len(labs), step):
        print('   [%6d] %s' % (i, labs[i]))
    print()
    # the agreement half is after the last ' · '
    print('-- every distinct FIRST WORD of the agreement half, with counts --')
    c = collections.Counter()
    for L in labs:
        parts = L.split(' · ')
        c[parts[-1].split(' ')[0] if len(parts) > 1 else '(no agreement half)'] += 1
    for k, n in c.most_common(20):
        print('   %-14s %d' % (k, n))
    print()
    print('-- every distinct shape of the agreement half (words replaced by their kind) --')
    import re
    shapes = collections.Counter()
    for L in labs:
        parts = L.split(' · ')
        a = parts[-1] if len(parts) > 1 else ''
        shapes[re.sub(r'\d+', 'N', a)] += 1
    for k, n in shapes.most_common(25):
        print('   %-42s %d' % (k, n))
    print()
PY
