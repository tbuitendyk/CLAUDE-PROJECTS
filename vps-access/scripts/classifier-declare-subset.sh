#!/usr/bin/env bash
# classifier-declare-subset.sh -- rank cycle 9's assets by their SEARCH-window
# edge, so a subset can be declared BEFORE the evaluation data is seen.
#
# The owner's question: several assets showed good edges and reasonable trade
# counts — do we pursue them, or were they lucky?
#
# We cannot pursue the ones that looked best on the HELD-BACK slice: picking
# winners after seeing the answer is the selection fault, and the null proves
# it bites — individual scrambled setups also post strong-looking numbers.
#
# But the aggregate test can DILUTE a real concentrated effect. If the edge
# lives in three assets and is absent in fourteen, pooling all seventeen
# understates it. That objection is legitimate.
#
# The resolution is separation, not refusal. Rank on the SEARCH window (which
# is not the evaluation data), freeze the list, and evaluate on cycle 11's
# held-back slice — an entirely earlier period. Selection data: 2025-09
# onward. Evaluation data: 2025-01 to 2025-06. No overlap.
#
# This must be committed while cycle 11 is still RUNNING, so the git timestamp
# proves the list predates the numbers it will be judged on.
set -euo pipefail
python3 <<'EOF'
import json, urllib.request
from statistics import median
def get(u):
    with urllib.request.urlopen(u, timeout=30) as r: return json.load(r)
B="http://127.0.0.1:8093"
d=get(f"{B}/api/batch/bracketlab-20260729-1300-l9-real-arm-with-money")
rows=[r for r in (d.get("edgeCensus") or []) if not r.get("shiftFrac")]
by={}
for r in rows:
    by.setdefault(r["trade"], []).append(r)
print("RANKING — cycle 9 assets by SEARCH-window edge (NOT the held-back slice)")
print("What it measures: how well each asset's setups predicted on the window")
print("  used to choose settings. Ranking here is legitimate because this is")
print("  not the data the declared subset will be judged on.")
print()
print("  KEY  asset      = the coin traded against USDT")
print("       n          = its setups in the census")
print("       med search = median search-window edge, accuracy points")
print("       med trades = median trades on the held-back slice")
print()
print(f"{'asset':<10s} {'n':>3s} {'med search':>11s} {'med trades':>11s}")
rank=[]
for sym, g in by.items():
    ms=median(r["searchEdge"] for r in g if r.get("searchEdge") is not None)
    mt=median((r.get("holdTrades") or 0) for r in g)
    rank.append((ms, sym, len(g), mt))
rank.sort(reverse=True)
for ms, sym, n, mt in rank:
    print(f"{sym:<10s} {n:>3d} {100*ms:>10.2f}% {mt:>11.0f}")
print()
print("TOP 5 BY SEARCH-WINDOW EDGE (the declared subset):")
print("  " + ", ".join(s for _, s, _, _ in rank[:5]))
EOF
