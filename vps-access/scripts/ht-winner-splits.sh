#!/usr/bin/env bash
# ht-winner-splits.sh -- read-only: per-split test AND hold dollars for the
# HT winner (none|r8m1) and the reference (none|never) — the combining-rule
# audit check, plus trade counts so window thinness is visible.
set -uo pipefail
cd /opt/general-classifier
python3 - <<'EOF'
import json, glob
d = json.load(open(sorted(glob.glob('data/batches/historytuning-*.json'))[-1]))
rows = [r for r in (d.get('htRows') or []) if not r.get('refused') and not r.get('skipped')]
for key in ('none|r8m1', 'none|never', '36mo|never'):
    age, ret = key.split('|')
    print(key)
    for r in sorted([x for x in rows if x['ageKey']==age and x['retuneKey']==ret], key=lambda x: ('early','middle','late').index(x['split'])):
        print(f"  {r['split']:6s} test {r['testPnl']:+9.2f}  hold {r['holdPnl']:+9.2f}  trades {r['trades']:4d}  effDays {r['effectiveDays']}  retunes {r['retunes']}")
EOF
