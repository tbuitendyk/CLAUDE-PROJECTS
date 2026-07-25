#!/usr/bin/env bash
# SEARCH-BUDGET LEDGER — the honest denominator behind every p-value.
# Derived on demand from data/batches/*.json (server-side only; nothing here
# ever touches the public repo). Every screen ever run is already persisted
# there, so the ledger cannot drift from reality or be edited after the fact.
set -euo pipefail

python3 <<'EOF'
import json, glob, os

BATCH_DIR = "/opt/general-classifier/data/batches"
docs = []
for f in sorted(glob.glob(os.path.join(BATCH_DIR, "*.json"))):
    try:
        docs.append(json.load(open(f)))
    except Exception:
        pass

# Configs LOOKED AT, the multiple-comparisons currency: one look = one
# (pair x geometry x protocol x band-mode x decision) whose REAL results a
# human could have read. Null-shift reruns are calibration, not looks.
looks = set()
by_kind = {}
total_runs = 0
for d in docs:
    p = d.get("params", {})
    kind = d.get("kind") or "pair-screen"
    by_kind[kind] = by_kind.get(kind, 0) + 1
    total_runs += len(d.get("runs", []))
    pairs = {r.get("trade") for r in d.get("runs", []) if r.get("trade")}
    geom = p.get("geometry", "weekly-8d")
    band = "auto" if p.get("dormantPct") == "auto" else f"fixed{p.get('dormantPct')}"
    dec = p.get("decision", "argmax")
    for pair in pairs:
        looks.add((pair, geom, kind, band, dec))

# Pre-batch era (manual single runs before screens existed, from the project
# record): ZEC explorations, the v1 spec era. Constant, never re-counted.
MANUAL_ERA_LOOKS = 8

print(f"screens on record: {len(docs)}  (runs inside them: {total_runs})")
for k, v in sorted(by_kind.items()):
    print(f"  {k}: {v}")
print(f"distinct configs looked at (pair x geometry x protocol x band x decision): {len(looks)}")
print(f"+ manual-era looks (pre-screen constant): {MANUAL_ERA_LOOKS}")
print(f"LEDGER TOTAL: {len(looks) + MANUAL_ERA_LOOKS} looks")
print()
print("Rule of thumb: a candidate's standalone p-value must survive")
print("multiplication by this number before it means anything, unless its")
print("configuration was declared before the look that found it.")
print()
print("declared live books (forward tickets, counted separately):")
try:
    reg = json.load(open("/opt/general-classifier/data/books/registry.json"))
    n = reg.get("declaredCount", 0)
except Exception:
    n = 0
print(f"  engine books: {n}  + tracker (DOT/AVAX weekly) + doge book = {n + 2} total")
EOF
