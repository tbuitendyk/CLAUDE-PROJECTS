#!/usr/bin/env bash
# classifier-census-diag.sh -- how many census units are actually PARTICIPATING?
#
# "edge > 0" is a headcount over 170 units, and a unit whose committee never
# calls anything scores edge exactly 0: it is not a loss, it is an abstention
# counted as a loss. If abstentions are common then the headcount is diluted
# by units that contributed no information at all, the effective sample is far
# smaller than 170, and both the real result and the null are being measured
# against a population that is mostly silent.
#
# This asks the census directly instead of reasoning about it:
#   * how many rows sit at edge EXACTLY zero
#   * of those, how many made ZERO directional calls (never traded once)
#   * how the directional-call counts are distributed
# Reads the job pinned in reports/EDGE-JOB, else the newest with a census.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SELFILE="$HERE/reports/EDGE-JOB"
python3 <<'EOF'
import json, urllib.request, os
from collections import Counter

def get(u):
    with urllib.request.urlopen(u, timeout=30) as r:
        return json.load(r)

B = "http://127.0.0.1:8093"
want = ""
try:
    for line in open(os.environ.get("SELFILE", "")):
        line = line.strip()
        if line and not line.startswith("#"):
            want = line
            break
except Exception:
    pass

ids = [b["id"] for b in get(f"{B}/api/batches")["batches"] if b["id"].startswith("bracketlab-")]
doc = None
if want:
    doc = get(f"{B}/api/batch/{want}")
else:
    for i in ids:
        d = get(f"{B}/api/batch/{i}")
        if d.get("edgeCensus"):
            doc = d
            break
rows = (doc or {}).get("edgeCensus") or []
if not rows:
    print("no census rows"); raise SystemExit(0)

print(f"=== {doc['id']}  status={doc['status']}  census rows: {len(rows)}")
print(f"null construction: labelShiftScope={(doc.get('params') or {}).get('labelShiftScope') or 'series'}")
print()

have = [r for r in rows if r.get("holdEdge") is not None]
zero = [r for r in have if abs(r["holdEdge"]) < 1e-12]
pos  = [r for r in have if r["holdEdge"] > 1e-12]
neg  = [r for r in have if r["holdEdge"] < -1e-12]
print(f"rows with a holdout edge : {len(have)}")
print(f"  edge > 0               : {len(pos):>5d}  ({100*len(pos)/len(have):.1f}%)")
print(f"  edge EXACTLY 0         : {len(zero):>5d}  ({100*len(zero)/len(have):.1f}%)")
print(f"  edge < 0               : {len(neg):>5d}  ({100*len(neg)/len(have):.1f}%)")
print()

def calls(r):
    return r.get("holdDirCalls")
known = [r for r in have if calls(r) is not None]
silent = [r for r in known if calls(r) == 0]
print(f"rows reporting a directional-call count: {len(known)}")
if known:
    print(f"  NEVER traded (0 directional calls)   : {len(silent):>5d}  ({100*len(silent)/len(known):.1f}%)")
    zk = [r for r in zero if calls(r) is not None]
    zs = [r for r in zk if calls(r) == 0]
    if zk:
        print(f"  of the EXACTLY-ZERO-edge rows, silent: {len(zs):>5d}/{len(zk)}  ({100*len(zs)/len(zk):.1f}%)")
        print("     -> this is the number that says whether 'edge == 0' means")
        print("        'matched the baseline' or simply 'never played'.")
    ps = [r for r in pos if calls(r) is not None and calls(r) == 0]
    print(f"  silent rows that still scored edge > 0: {len(ps)}")
    buckets = Counter()
    for r in known:
        c = calls(r)
        buckets[0 if c == 0 else 1 if c <= 2 else 2 if c <= 5 else 3 if c <= 20 else 4] += 1
    names = {0: "0 calls", 1: "1-2", 2: "3-5", 3: "6-20", 4: "21+"}
    print("\n  directional calls per unit (holdout window):")
    for k in sorted(buckets):
        print(f"    {names[k]:>8s} : {buckets[k]:>5d}  ({100*buckets[k]/len(known):.1f}%)")

# DIRECTIONAL ACCURACY -- the metric that actually corresponds to money.
# "edge" scores all three answers including flat, so a unit that makes one
# directional call and 130 flat calls is graded almost entirely on its flat
# calls, which is baseline-like behaviour dressed as prediction. The question
# that matters for trading is narrower: WHEN IT COMMITTED, was it right?
dc = [r for r in rows if r.get("holdDirCalls") and r.get("holdDirHits") is not None]
if dc:
    tot_calls = sum(r["holdDirCalls"] for r in dc)
    tot_hits = sum(r["holdDirHits"] for r in dc)
    print()
    print("DIRECTIONAL ACCURACY (only the periods where a direction was called)")
    print(f"  units with >=1 directional call : {len(dc)}")
    print(f"  total directional calls         : {tot_calls}")
    print(f"  hits                            : {tot_hits}  ({100*tot_hits/tot_calls:.2f}%)")
    for floor in (1, 5, 10, 20):
        g = [r for r in dc if r["holdDirCalls"] >= floor]
        if not g: continue
        c = sum(r["holdDirCalls"] for r in g); h = sum(r["holdDirHits"] for r in g)
        rates = sorted(r["holdDirHits"] / r["holdDirCalls"] for r in g)
        med = rates[len(rates)//2]
        print(f"  units with >={floor:>2d} calls: {len(g):>4d}   pooled hit rate {100*h/c:>6.2f}%   median unit {100*med:>6.2f}%")
    draws = sorted({r.get("shiftFrac") for r in dc if r.get("shiftFrac") is not None})
    if draws:
        print()
        print("  per scramble (the spread is what says whether 36.09% is outside noise):")
        rates = []
        for d in draws:
            g = [r for r in dc if r.get("shiftFrac") == d]
            c = sum(r["holdDirCalls"] for r in g); h = sum(r["holdDirHits"] for r in g)
            if not c: continue
            rates.append(h / c)
            print(f"    shift {d:.3f}: {h:>6d}/{c:<7d} = {100*h/c:>6.2f}%")
        if len(rates) > 1:
            lo, hi = min(rates), max(rates)
            mean = sum(rates) / len(rates)
            var = sum((x - mean) ** 2 for x in rates) / (len(rates) - 1)
            sd = var ** 0.5
            print(f"    mean {100*mean:.2f}%  range {100*lo:.2f}%-{100*hi:.2f}%  sd {100*sd:.2f} pts")
            print(f"    real run (-2211) was 36.09% -> {(0.3609-mean)/sd:+.2f} sd from this null's mean")
    print("  NOTE: a 3-class problem, so 'chance' is not 50% — it depends on how")
    print("        often the market was flat. Compare against the null, never against 50.")

# Effective sample: units that actually expressed an opinion.
if known:
    active = len(known) - len(silent)
    print(f"\nEFFECTIVE SAMPLE: {active} of {len(known)} units actually traded in the holdout.")
    print("Every share quoted as 'x/170' is over the full set, silent units included.")
EOF
