#!/usr/bin/env bash
# uts-held-by-rule.sh -- READ-ONLY. How many of the held setting names use each
# way of weighing, and how many carry the one-voice threshold in their name.
# One file read; changes nothing.
set -uo pipefail
python3 - /opt/ultimate-trading-system/data <<'PY'
import json, glob, os, sys, collections
for f in sorted(glob.glob(os.path.join(sys.argv[1], 'stagesets', 's3-*.json'))):
    d = json.load(open(f))
    labs = (d.get('plan') or {}).get('settingLabels') or []
    print('==', d.get('id'), len(labs), 'held setting names')
    byrule = collections.Counter(L.split(' ')[0] for L in labs)
    for k, n in byrule.most_common():
        print('   %-12s %7d' % (k, n))
    withvoice = sum(1 for L in labs if '+voice' in L)
    print('   %-12s %7d   <- carry the one-voice threshold in the name' % ('+voice', withvoice))
    print('   %-12s %7d   <- do not' % ('(without)', len(labs) - withvoice))
PY
