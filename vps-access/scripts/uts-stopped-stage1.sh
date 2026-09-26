#!/usr/bin/env bash
# uts-stopped-stage1.sh -- READ-ONLY. How many stage 1 record sets does the
# 3.269.0 repair (stopped stage 1 sets renamed to paused) still have to act on?
# It acts on a stage 1 set whose document says cancelled and whose plan lists
# its units. Zero means the repair has served every set on the box (RULE TEN).
# Loads none of the service's code, asks it nothing, writes nothing.
set -uo pipefail
exec nice -n 19 python3 - /opt/ultimate-trading-system/data/stagesets <<'PY'
import json, glob, os, sys, collections
st = collections.Counter(); todo = []
for p in glob.glob(os.path.join(sys.argv[1], '*.json')):
    try: d = json.load(open(p))
    except Exception: continue
    if not isinstance(d, dict) or d.get('stage') != 1: continue
    st[d.get('status')] += 1
    ul = ((d.get('plan') or {}).get('unitList')) or []
    if d.get('status') == 'cancelled' and len(ul): todo.append(f"{d.get('id')} {d.get('name')!r}")
print('stage 1 sets by status: ' + ', '.join(f'{k}: {v}' for k, v in sorted(st.items(), key=lambda x: str(x[0]))))
print(f'sets the repair would still act on: {len(todo)}')
for t in todo: print('  ' + t)
PY
