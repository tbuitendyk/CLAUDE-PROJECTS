#!/usr/bin/env bash
# H1 hunter-campaign gate reader: newest directional consensus screen,
# per pair: vote book net/trades/wins + the gate verdict per VERDICTS.md
# amendment A1: net > $0 at recorded friction AND (>=30 trades, OR >=10
# trades with gross/trade >= $1.00 at a rate >= 7 trades/365 test days).
# Read-only.
set -euo pipefail

curl -s http://127.0.0.1:8093/api/batches > /tmp/h1-batches.json
ID=$(python3 -c '
import json
d = json.load(open("/tmp/h1-batches.json"))
ids = [b["id"] for b in d["batches"]
       if b["id"].startswith("consensus-") and (b.get("params") or {}).get("decision") == "directional"]
print(ids[0] if ids else "")')
if [ -z "$ID" ]; then echo "no directional consensus screens found"; exit 0; fi
curl -s "http://127.0.0.1:8093/api/batch/$ID" > /tmp/h1-doc.json

python3 <<'EOF'
import json
d = json.load(open("/tmp/h1-doc.json"))
p = d["params"]
trip = 2 * p.get("feePerLeg", 0.5)
print(f"{d['id']} status={d['status']} band=+/-{p['dormantPct']}% geometry={p['geometry']} fee/trip=${trip:.2f} runs={sum(1 for r in d['runs'] if r['status']!='pending')}/{len(d['runs'])}")
s = d.get("summary") or {}
passing = []
for pair in s.get("pairs", []):
    v = pair.get("vote")
    if not v:
        print(f"{pair['trade']}: no vote book")
        continue
    gpt = (v["pnl"] + v["trades"] * trip) / v["trades"] if v["trades"] else None
    # Test-window length in days: one scored period per step. daily-* steps
    # every 24h; weekly-8d steps every 7 days.
    step_days = 7 if p.get("geometry", "weekly-8d") == "weekly-8d" else 1
    test_days = (v.get("scored") or 0) * step_days
    rate = v["trades"] * 365 / test_days if test_days else 0
    lane_a = v["trades"] >= 30
    lane_b = v["trades"] >= 10 and gpt is not None and gpt >= 1.0 and rate >= 7
    gate = v["pnl"] > 0 and (lane_a or lane_b)
    lane = "a" if lane_a else ("b" if lane_b else "-")
    sup = pair.get("superVote")
    supstr = f" | q6 {sup['pnl']:+.2f} ({sup['trades']}t)" if sup else ""
    taus = []
    for r in d["runs"]:
        if r["trade"] == pair["trade"] and not r.get("shift") and r.get("metrics"):
            ch = r["metrics"].get("chosen", "")
            taus.append(ch.split("tau=")[-1] if "tau=" in ch else "?")
    ratestr = f", {rate:.1f}t/yr" if v["trades"] else ""
    print(f"{pair['trade']}: vote {v['pnl']:+.2f} ({v['wins']}/{v['trades']}t, gross/t {('$%.2f' % gpt) if gpt is not None else '—'}{ratestr}){supstr} | taus {','.join(taus)} | GATE {'PASS(' + lane + ')' if gate else 'no'}")
    if gate:
        passing.append(f"{pair['trade']}({lane})")
print()
print(f"gate passes: {len(passing)} of {len(s.get('pairs', []))} -> {', '.join(passing) if passing else 'none'}")
EOF
