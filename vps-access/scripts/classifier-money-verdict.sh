#!/usr/bin/env bash
# classifier-money-verdict.sh -- apply the declared rank test across TWO docs:
# the real arm and the null arm. Reads both, compares, prints the verdict.
#
# Two docs because the real census and the 19 scrambles are separate runs.
# Doing this by eye from two printouts is how job ids got misattributed once
# already; this makes the comparison reproducible.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export REALJOB="$(grep -v '^#' "$HERE/reports/MONEY-REAL-JOB" | head -1 | tr -d ' \r\n')"
export NULLJOB="$(grep -v '^#' "$HERE/reports/MONEY-NULL-JOB" | head -1 | tr -d ' \r\n')"
python3 <<'EOF'
import json, urllib.request, os
from statistics import median
def get(u):
    with urllib.request.urlopen(u, timeout=30) as r: return json.load(r)
B = "http://127.0.0.1:8093"
real_doc = get(f"{B}/api/batch/{os.environ['REALJOB']}")
null_doc = get(f"{B}/api/batch/{os.environ['NULLJOB']}")
# Split by SCRAMBLE TAG, not by document. Both arms now ride in one job (the
# r=0 real arm), so filtering on the doc alone would put the scrambles into
# the real arm and compare a set against itself. Filtering on shiftFrac is
# correct whether the arms came from one job or two.
R = [r for r in (real_doc.get("edgeCensus") or [])
     if r.get("holdPnl") is not None and r.get("shiftFrac") is None]
N = [r for r in (null_doc.get("edgeCensus") or [])
     if r.get("holdPnl") is not None and r.get("shiftFrac") is not None]
if not R or not N:
    print(f"real rows {len(R)}, scramble rows {len(N)} — need both. "
          "Check MONEY-REAL-JOB / MONEY-NULL-JOB.")
    raise SystemExit(1)
print(f"real arm : {real_doc['id']}  ({len(R)} priced setups)")
print(f"null arm : {null_doc['id']}  ({len(N)} priced setups)")
print()
def stats(g):
    net = sum(r["holdPnl"] for r in g)
    tr = sum(r["holdTrades"] or 0 for r in g)
    bh = sum(r["holdBuyHold"] for r in g if r.get("holdBuyHold") is not None)
    return {"net": net, "med": median(r["holdPnl"] for r in g),
            "win": sum(1 for r in g if r["holdPnl"] > 0)/len(g),
            "per": net/tr if tr else None, "trades": tr, "vshold": net - bh}
draws = sorted({r.get("shiftFrac") for r in N if r.get("shiftFrac") is not None})
ns = [stats([r for r in N if r.get("shiftFrac") == d]) for d in draws]
rs = stats(R)
print("TABLE — THE DECLARED RANK TEST, ON EVERY MONEY STATISTIC")
print("What it measures: where the real result falls among the 19 scrambled")
print("  worlds. Beating all 19 is p = 0.05, the strongest 19 draws allow.")
print()
print("  KEY  real      = the live-market census")
print("       best null = the luckiest of 19 scrambled worlds")
print("       beats     = how many of the 19 the real result exceeds")
print("       (net/median/vs-hold are DOLLARS; win% is a share of setups)")
print()
print(f"{'statistic':<16s} {'real':>12s} {'best null':>12s} {'worst null':>12s} {'beats':>8s}")
for key, label, fmt in [("net","net $","{:,.2f}"),("med","median $","{:,.2f}"),
                        ("win","win %","{:.1%}"),("per","$ / trade","{:.4f}"),
                        ("vshold","vs hold $","{:,.2f}")]:
    vals = [s[key] for s in ns if s[key] is not None]
    if rs[key] is None or not vals: continue
    beats = sum(1 for v in vals if rs[key] > v)
    print(f"{label:<16s} {fmt.format(rs[key]):>12s} {fmt.format(max(vals)):>12s} "
          f"{fmt.format(min(vals)):>12s} {str(beats)+'/'+str(len(vals)):>8s}")
print()
nets = [s["net"] for s in ns]
beats = sum(1 for v in nets if rs["net"] > v)
print(f"SANITY: scrambles losing money? {sum(1 for v in nets if v < 0)}/{len(nets)} negative"
      f"  -> {'PASS' if sum(1 for v in nets if v<0) >= len(nets)*0.8 else 'FAIL — a null that profits means the simulation is wrong'}")
print()
print("VERDICT, on the declared primary (total net $), per the rule fixed")
print("before this number existed:")
if beats == len(nets):
    print(f"  real beats ALL {len(nets)} scrambles -> p = {1/(len(nets)+1):.3f}")
    print("  THE EDGE PAYS AFTER FEES.")
    print(f"  margin over the luckiest scramble: ${rs['net']-max(nets):,.2f}")
elif beats == len(nets)-1:
    print(f"  beats {beats}/{len(nets)} -> p = 0.10. Suggestive. NO LIVE MONEY.")
else:
    print(f"  beats {beats}/{len(nets)} -> the edge does not pay.")
print()
print(f"  NOTE: 19 draws makes 0.05 the FLOOR — the best this design can say,")
print(f"  not evidence of a large effect. One holdout window, one period.")
EOF
