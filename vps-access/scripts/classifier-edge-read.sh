#!/usr/bin/env bash
# classifier-edge-read.sh -- read the EDGE screen off the newest bracketlab doc.
#
# Reports holdout edge at the edge-selected quorum rung, grouped by chunk shape
# and decision mode. States plainly how much of the run it can actually see:
# the leaderboard is money-ranked and capped, so if a screen's units did not
# all reach it, this is a P&L-selected sample and says so rather than
# pretending to be a census.
set -euo pipefail
python3 <<'EOF'
import json, urllib.request
from collections import defaultdict
from math import comb

def get(u):
    with urllib.request.urlopen(u, timeout=30) as r:
        return json.load(r)

B = "http://127.0.0.1:8093"
doc = None
for i in [b["id"] for b in get(f"{B}/api/batches")["batches"] if b["id"].startswith("bracketlab-")]:
    d = get(f"{B}/api/batch/{i}")
    if d.get("edgeCensus"):
        doc = d
        break
if doc is None:
    print("no doc carries an edge CENSUS. A screen read off the money-ranked")
    print("leaderboard selects on edge and is not evidence — re-run with edgeScreen.")
    raise SystemExit(0)

p, perf = doc["params"], doc.get("perf") or {}
plan = doc.get("plan") or {}
rows = doc.get("edgeCensus") or []
print(f"=== {doc['id']} status={doc['status']} {round((perf.get('elapsedMs') or 0)/60000,1)}min")
print(f"planned units: {plan.get('units')}   CENSUS rows: {len(rows)}")
if plan.get("units") and len(rows) < plan["units"]:
    print(f"note: {plan['units'] - len(rows)} unit(s) produced no census row (failed or too few chunks)")
print()

def tail(k, n):
    return sum(comb(n, i) for i in range(k, n + 1)) / (2 ** n) if n else None

# Multi-rotation runs carry a shiftFrac per row: report each draw separately,
# because the whole point is the spread.
draws = sorted({r.get("shiftFrac") for r in rows if r.get("shiftFrac") is not None})
if draws:
    print(f"NULL DISTRIBUTION — {len(draws)} rotation(s), {len(rows)} census rows total")
    print(f"{'shift':>7s} {'n':>4s} {'hold edge>0':>13s} {'share':>7s} {'med hold':>9s}")
    tot = []
    for d in draws:
        g = [r for r in rows if r.get("shiftFrac") == d and r.get("holdEdge") is not None]
        if not g:
            continue
        pos = sum(1 for r in g if r["holdEdge"] > 0)
        med = sorted(r["holdEdge"] for r in g)[len(g) // 2]
        tot.append(pos / len(g))
        print(f"{d:>7.3f} {len(g):>4d} {pos:>6d}/{len(g):<6d} {100*pos/len(g):>6.1f}% {100*med:>8.2f}%")
    if tot:
        lo, hi = min(tot), max(tot)
        mean = sum(tot) / len(tot)
        print(f"\nnull share: mean {100*mean:.1f}%  range {100*lo:.1f}%-{100*hi:.1f}%")
        print(f"cycle 1 (real outcomes) was 57.6% — {'ABOVE every draw' if 0.576 > hi else 'INSIDE the null spread'}")
    print()

groups = defaultdict(list)
for r in rows:
    groups[(r["geometry"], r["decision"])].append(r)

print(f"{'geometry':<11s} {'decision':<12s} {'n':>3s} {'hold edge>0':>13s} {'p':>7s} {'med hold':>9s} {'med search':>11s}")
for k in sorted(groups):
    g = [r for r in groups[k] if r.get("holdEdge") is not None]
    if not g:
        print(f"{k[0]:<11s} {k[1]:<12s} {len(groups[k]):>3d}   no holdout")
        continue
    pos = sum(1 for r in g if r["holdEdge"] > 0)
    med = sorted(r["holdEdge"] for r in g)[len(g) // 2]
    meds = sorted(r["searchEdge"] for r in g)[len(g) // 2]
    print(f"{k[0]:<11s} {k[1]:<12s} {len(g):>3d} {pos:>6d}/{len(g):<6d} {tail(pos, len(g)):>7.4f} "
          f"{100*med:>8.2f}% {100*meds:>10.2f}%")

allg = [r for r in rows if r.get("holdEdge") is not None]
if allg:
    pos = sum(1 for r in allg if r["holdEdge"] > 0)
    med = sorted(r["holdEdge"] for r in allg)[len(allg) // 2]
    print()
    print(f"POOLED holdout edge > 0: {pos}/{len(allg)}   binomial p = {tail(pos, len(allg)):.4f}   median {100*med:+.2f}%")
    print()
    print("Only the HOLDOUT column is evidence. Search-window edge is what the rung")
    print("was chosen on, so it is selected-for by construction. The pooled line mixes")
    print("chunk shapes and decision modes and correlated assets — read the groups.")
    best = max(groups, key=lambda k: sum(1 for r in groups[k] if (r.get("holdEdge") or 0) > 0) / max(1, len(groups[k])))
    print(f"strongest group: {best[0]}/{best[1]} — a LEAD needing its own declared test, not a result.")
EOF
