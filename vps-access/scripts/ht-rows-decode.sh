#!/usr/bin/env bash
# ht-rows-decode.sh -- read-only: decode the HT doc's htRows the way the UI
# does — how many rows survive the refused/skipped/excluded sinks, and what
# a surviving row actually carries.
set -uo pipefail
cd /opt/general-classifier
python3 - <<'EOF'
import json, glob
f = sorted(glob.glob('data/batches/historytuning-*.json'))[-1]
d = json.load(open(f))
rows = d.get('htRows') or []
print(f"htRows={len(rows)} excludedArms={d.get('excludedArms')}")
ref = [r for r in rows if r.get('refused')]
skp = [r for r in rows if r.get('skipped')]
print(f"refused={len(ref)} skipped={len(skp)} clean={len(rows)-len(ref)-len(skp)}")
for r in ref[:3]: print("  REFUSED:", json.dumps(r)[:200])
for r in skp[:3]: print("  SKIPPED:", json.dumps(r)[:200])
clean = [r for r in rows if not r.get('refused') and not r.get('skipped')]
for r in clean[:3]: print("  ROW:", json.dumps(r)[:260])
# what the UI aggregates on:
keys = set()
for r in clean: keys.add(f"{r.get('ageKey')}|{r.get('retuneKey')}")
print(f"distinct dial pairs among clean rows: {len(keys)}; sample: {sorted(keys)[:5]}")
print("fields of first clean row:", sorted((clean[0] if clean else {}).keys()))
EOF
