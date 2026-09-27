#!/usr/bin/env bash
# uts-weekdays-sets.sh -- READ-ONLY. Every record set whose document asked for
# 24/5 or permuted it, read straight off the set documents (never through the
# service, never loading the stage engine). Before 24/5 moved to stage 1 (task
# #114, 2026-09-27) it was a stage 3 box; a stage 3 set that ticked or permuted
# it holds 24/5 settings priced from members trained on every day.
set -uo pipefail
DIR=/opt/ultimate-trading-system/data/stagesets
python3 - "$DIR" <<'PY'
import json, os, sys
d = sys.argv[1]
n = 0; hits = []
for f in sorted(os.listdir(d)):
    if not f.endswith('.json') or f.count('.') != 1:
        continue
    try:
        doc = json.load(open(os.path.join(d, f)))
    except Exception:
        continue
    if not isinstance(doc, dict) or 'stage' not in doc:
        continue
    n += 1
    p = doc.get('params') or {}
    if p.get('weekdaysOnly') or p.get('permuteWeekdays'):
        hits.append(f"{doc.get('id')} | stage {doc.get('stage')} | {doc.get('name')} | weekdaysOnly {p.get('weekdaysOnly')} | permuteWeekdays {p.get('permuteWeekdays')}")
print(f"set documents read: {n}")
print(f"sets that asked for 24/5 or permuted it: {len(hits)}")
for h in hits: print('  ' + h)
PY
