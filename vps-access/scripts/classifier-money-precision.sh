#!/usr/bin/env bash
# classifier-money-precision.sh -- one-off: is the real arm genuinely tied with
# the worst scramble, or is that a rounding coincidence in the display? Two
# statistics printing the same value to 2dp is improbable enough to check
# rather than report.
set -euo pipefail
python3 <<'EOF'
import json, urllib.request
def get(u):
    with urllib.request.urlopen(u, timeout=30) as r: return json.load(r)
B="http://127.0.0.1:8093"
d=get(f"{B}/api/batch/bracketlab-20260729-1328-l10-walkforward-2025-06")
rows=[r for r in d["edgeCensus"] if r.get("holdPnl") is not None]
R=[r for r in rows if r.get("shiftFrac") is None]
N=[r for r in rows if r.get("shiftFrac") is not None]
print("real rows",len(R),"scramble rows",len(N),"total",len(rows))
rnet=sum(r["holdPnl"] for r in R)
print("real net  :",repr(rnet))
draws=sorted({r["shiftFrac"] for r in N})
nets=sorted(((dd,sum(r["holdPnl"] for r in N if r["shiftFrac"]==dd)) for dd in draws), key=lambda x:x[1])
print("three worst scrambles:")
for dd,v in nets[:3]: print(f"  shift {dd:.3f}: {v!r}")
print("three best scrambles:")
for dd,v in nets[-3:]: print(f"  shift {dd:.3f}: {v!r}")
ties=[f"{dd:.3f}" for dd,v in nets if abs(v-rnet)<1e-6]
print("identical to any scramble? ", ties or "NO — not a tie")
allv=sorted([v for _,v in nets]+[rnet])
print(f"real ranks {allv.index(rnet)+1} of 20 (1 = worst)")
EOF
