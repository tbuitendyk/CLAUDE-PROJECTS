set -euo pipefail
python3 <<'EOF'
import json, urllib.request
from collections import Counter
def get(u):
    with urllib.request.urlopen(u, timeout=30) as r: return json.load(r)
B="http://127.0.0.1:8093"
for lab,j in [("L9 ","bracketlab-20260729-1300-l9-real-arm-with-money"),
              ("L11","bracketlab-20260729-2054-l11-walkforward-redo")]:
    d=get(f"{B}/api/batch/{j}")
    p=d.get("params") or {}
    rows=d.get("edgeCensus") or []
    tp=Counter(r.get("testPeriods") for r in rows if r.get("testPeriods"))
    print(f"{lab} allLoaded={p.get('allLoaded')} startMonth={p.get('startMonth')} endMonth={p.get('endMonth')}")
    print(f"     search-window sizes seen: {dict(sorted(tp.items(), key=lambda x:-x[1])[:6])}")
EOF
