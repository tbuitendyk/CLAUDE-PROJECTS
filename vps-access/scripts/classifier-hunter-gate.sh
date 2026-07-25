#!/usr/bin/env bash
# H1 hunter-campaign gate reader: newest directional consensus screen,
# per pair: vote book net/trades/wins + the pre-registered gate verdict
# (net > $0 at the screen's recorded friction on >= 30 trades). Read-only.
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
    gate = v["pnl"] > 0 and v["trades"] >= 30
    gpt = (v["pnl"] + v["trades"] * trip) / v["trades"] if v["trades"] else None
    sup = pair.get("superVote")
    supstr = f" | q6 {sup['pnl']:+.2f} ({sup['trades']}t)" if sup else ""
    taus = []
    for r in d["runs"]:
        if r["trade"] == pair["trade"] and not r.get("shift") and r.get("metrics"):
            ch = r["metrics"].get("chosen", "")
            taus.append(ch.split("tau=")[-1] if "tau=" in ch else "?")
    print(f"{pair['trade']}: vote {v['pnl']:+.2f} ({v['wins']}/{v['trades']}t, gross/t {('$%.2f' % gpt) if gpt is not None else '—'}){supstr} | taus {','.join(taus)} | GATE {'PASS' if gate else 'no'}")
    if gate:
        passing.append(pair["trade"])
print()
print(f"gate passes: {len(passing)} of {len(s.get('pairs', []))} -> {', '.join(passing) if passing else 'none'}")
EOF
