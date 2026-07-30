set -euo pipefail
python3 <<'EOF'
import json, urllib.request
def get(u):
    with urllib.request.urlopen(u, timeout=30) as r: return json.load(r)
B="http://127.0.0.1:8093"
d=get(f"{B}/api/batch/bracketlab-20260729-2054-l11-walkforward-redo")
rows=[r for r in (d.get("edgeCensus") or []) if not r.get("shiftFrac") and r.get("holdPnl") is not None]
rows.sort(key=lambda r: r["holdPnl"])
print("TABLE — CAN A STOPPED-OUT TRADE LOSE THIS MUCH?")
print("What it measures: for the worst setups, the average loss per trade against")
print("  the widest loss a stop should permit. Each trade is $100 of stock, so a")
print("  stop at X% of price should cap the loss near $X plus fees.")
print()
print("  KEY  band    = the +/-% counting as 'no move' for this setup")
print("       max stop= band x 1.5 (the widest stop distance on the menu), in $")
print("       $/trade = actual average loss per trade")
print("       ratio   = $/trade divided by max stop. Above ~1.3 (fees+slippage)")
print("                 means trades lost MORE than the stop should allow")
print()
print(f"{'coin':<9s} {'shape':<10s} {'net $':>10s} {'trades':>7s} {'$/trade':>8s} {'band%':>6s} {'maxstop$':>9s} {'ratio':>6s}")
bad=0
for r in rows[:8]:
    tr=r.get("holdTrades") or 0
    if not tr: continue
    per=r["holdPnl"]/tr
    band=r["bandPct"]
    maxstop=band*1.5           # widest dMult on the menu, as % of price
    ratio=abs(per)/maxstop if maxstop else 0
    flag="  <-- EXCEEDS STOP" if ratio>1.3 else ""
    if ratio>1.3: bad+=1
    print(f"{r['trade']:<9s} {r['geometry']:<10s} {r['holdPnl']:>10.2f} {tr:>7d} {per:>8.3f} "
          f"{band:>6.2f} {maxstop:>9.2f} {ratio:>6.2f}{flag}")
print()
print(f"setups whose per-trade loss exceeds the widest stop: {bad}/8 shown")
print()
print("NOTE: 'always' gate cells have no stop-loss protection on the losing side")
print("  in the same way, and market-entry cells have NO rails at all — so a")
print("  large per-trade loss may be legitimate for those. Checking which cell")
print("  each of these actually used is the next step, not this table's job.")
EOF
