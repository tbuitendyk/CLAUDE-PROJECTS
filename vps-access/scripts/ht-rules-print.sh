#!/usr/bin/env bash
# ht-rules-print.sh -- read-only: print the four reading rules exactly as
# stamped into the History Tuning run at launch, plus the hold numbers.
set -uo pipefail
cd /opt/general-classifier
python3 - <<'EOF'
import json, glob
d = json.load(open(sorted(glob.glob('data/batches/historytuning-*.json'))[-1]))
rr = (d.get('params') or {}).get('readingRules') or {}
for k, v in rr.items():
    print(f"[{k}] ({v.get('label')}): {v.get('text')}")
EOF
