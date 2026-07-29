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

# Effective sample: units that actually expressed an opinion.
if known:
    active = len(known) - len(silent)
    print(f"\nEFFECTIVE SAMPLE: {active} of {len(known)} units actually traded in the holdout.")
    print("Every share quoted as 'x/170' is over the full set, silent units included.")
EOF
