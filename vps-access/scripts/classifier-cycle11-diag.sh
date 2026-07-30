#!/usr/bin/env bash
# classifier-cycle11-diag.sh -- step 7(b) weakness hunt on cycle 11.
# The declared primary (total net $) beat 0/19 while the MEDIAN setup beat
# 13/19. That gap can only come from a few extreme units, so this asks whether
# the primary metric is being decided by outliers — a finding about the
# instrument for the NEXT test, NOT a licence to re-read this verdict.
# Also evaluates the 5-asset subset declared before this run's numbers existed.
set -euo pipefail
python3 << 'EOF'
import json, urllib.request
from statistics import median
def get(u):
    with urllib.request.urlopen(u, timeout=30) as r: return json.load(r)
B="http://127.0.0.1:8093"
d=get(f"{B}/api/batch/bracketlab-20260729-2054-l11-walkforward-redo")
rows=[r for r in (d.get("edgeCensus") or []) if r.get("holdPnl") is not None]
real=[r for r in rows if not r.get("shiftFrac")]
scr=[r for r in rows if r.get("shiftFrac")]

print("=== IS THE REAL ARM'S TOTAL DRIVEN BY A FEW UNITS? ===")
p=sorted((r["holdPnl"], r["trade"], r["geometry"], r["decision"]) for r in real)
tot=sum(x[0] for x in p)
print(f"real total ${tot:,.2f} over {len(p)} setups")
for k in (1,3,5,10):
    worst=sum(x[0] for x in p[:k])
    print(f"  worst {k:>2d} setups: ${worst:>10,.2f}  = {100*worst/tot:5.1f}% of the total")
print("  the 5 worst:")
for v,t,g,dc in p[:5]:
    print(f"    ${v:>9,.2f}  {t:<9s} {g:<10s} {dc}")
print(f"  median setup ${median(x[0] for x in p):,.2f}")
print(f"  setups worse than -$100: {sum(1 for x in p if x[0] < -100)}")

print()
print("=== SAME CHECK ON THE SCRAMBLES (is this normal for this window?) ===")
draws=sorted({r["shiftFrac"] for r in scr})
shares=[]
for dd in draws:
    g=sorted(r["holdPnl"] for r in scr if r["shiftFrac"]==dd)
    t=sum(g)
    if t: shares.append(100*sum(g[:5])/t)
print(f"  scramble 'worst 5 as % of total': median {median(shares):.1f}%  range {min(shares):.1f}%-{max(shares):.1f}%")

print()
print("=== THE DECLARED 5-ASSET SUBSET, evaluated once ===")
SUB={"TRXUSDT","LTCUSDT","BNBUSDT","XLMUSDT","XRPUSDT"}
rs=[r for r in real if r["trade"] in SUB]
rnet=sum(r["holdPnl"] for r in rs)
nets=[]
for dd in draws:
    g=[r for r in scr if r["shiftFrac"]==dd and r["trade"] in SUB]
    nets.append(sum(r["holdPnl"] for r in g))
beats=sum(1 for v in nets if rnet>v)
print(f"  subset real net  ${rnet:,.2f} over {len(rs)} setups")
print(f"  subset scrambles median ${median(nets):,.2f}  best ${max(nets):,.2f}  worst ${min(nets):,.2f}")
print(f"  beats {beats}/{len(nets)}")
print()
print("=== FOR CONTEXT: how punishing was this window vs cycle 9's? ===")
allscr=[sum(r["holdPnl"] for r in scr if r["shiftFrac"]==dd) for dd in draws]
print(f"  cycle 11 scrambles: median ${median(allscr):,.0f}  (all 19 negative)")
print(f"  cycle 8  scrambles: median $-2,268     (18/19 negative)")
print("  -> trading anything in this earlier window cost roughly 2x more.")

EOF
