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
    if any(l.get("bestEdge") for l in (d.get("leaders") or [])):
        doc = d
        break
if doc is None:
    print("no doc carries edge-selected rung data (bestEdge)")
    raise SystemExit(0)

p, perf = doc["params"], doc.get("perf") or {}
plan = doc.get("plan") or {}
leaders = [l for l in doc.get("leaders") or [] if l.get("bestEdge")]
print(f"=== {doc['id']} status={doc['status']} {round((perf.get('elapsedMs') or 0)/60000,1)}min")
print(f"planned units: {plan.get('units')}   rows visible on the board: {len(leaders)}")
if plan.get("units") and len(leaders) < plan["units"]:
    print(f"*** COVERAGE WARNING: the board is money-ranked and capped, so these {len(leaders)} rows")
    print(f"*** are the P&L winners of {plan['units']} units, NOT a census. Treat percentages below")
    print("*** as describing profitable units only — an edge screen needs every unit, not these.")
print()

def tail(k, n):
    return sum(comb(n, i) for i in range(k, n + 1)) / (2 ** n) if n else None

groups = defaultdict(list)
for l in leaders:
    groups[(l["geometry"], l["decision"])].append(l)

print(f"{'geometry':<11s} {'decision':<12s} {'n':>3s} {'hold edge>0':>12s} {'p':>7s} {'med hold edge':>14s} {'med search':>11s}")
for k in sorted(groups):
    rows = groups[k]
    hold = [l["bestEdge"].get("holdoutMetrics") for l in rows]
    hold = [h for h in hold if h]
    if not hold:
        print(f"{k[0]:<11s} {k[1]:<12s} {len(rows):>3d} {'no holdout':>12s}")
        continue
    pos = sum(1 for h in hold if h["edge"] > 0)
    med = sorted(h["edge"] for h in hold)[len(hold) // 2]
    meds = sorted(l["bestEdge"]["metrics"]["edge"] for l in rows)[len(rows) // 2]
    pv = tail(pos, len(hold))
    print(f"{k[0]:<11s} {k[1]:<12s} {len(rows):>3d} {pos:>5d}/{len(hold):<6d} {pv:>7.4f} {100*med:>13.2f}% {100*meds:>10.2f}%")

allh = [l["bestEdge"].get("holdoutMetrics") for l in leaders]
allh = [h for h in allh if h]
if allh:
    pos = sum(1 for h in allh if h["edge"] > 0)
    print()
    print(f"POOLED holdout edge > 0: {pos}/{len(allh)}  binomial p = {tail(pos, len(allh)):.4f}")
    print("search-window edge is selected-for by construction and is NOT evidence;")
    print("only the holdout column answers the question this screen was fired to ask.")
EOF
