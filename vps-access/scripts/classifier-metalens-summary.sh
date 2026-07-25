#!/usr/bin/env bash
# Compact summary of the newest meta-lens screen: per-pair verdict metrics,
# the stage-1 scoreboard and the stage-2 menu. Read-only; 8k-stdout safe.
set -euo pipefail

curl -s http://127.0.0.1:8093/api/batches > /tmp/ml-batches.json
ID=$(python3 -c '
import json
d = json.load(open("/tmp/ml-batches.json"))
ids = [b["id"] for b in d["batches"] if b["id"].startswith("metalens-")]
print(ids[0] if ids else "")')
if [ -z "$ID" ]; then echo "no metalens screens found"; exit 0; fi
curl -s "http://127.0.0.1:8093/api/batch/$ID" > /tmp/ml-doc.json

python3 <<'EOF'
import json
d = json.load(open("/tmp/ml-doc.json"))
p = d["params"]
print(f"{d['id']} status={d['status']} geometry={p['geometry']} band={p['dormantPct']} forceAll={p.get('forceAllOnZeroPass')} shifts={p['nullShifts']}")
s = d.get("summary") or {}
for pair in s.get("pairs", []):
    m = pair.get("metrics")
    print()
    if not m:
        print(f"{pair['trade']}: no completed real run")
        continue
    print(f"{pair['trade']}: passed={m['lensesPassed']}/8 committee={m.get('committeeSize')} forced={m.get('forcedAll')} frac={m['chosenFrac']}")
    print(f"  test: pnl={m['pnl']:+.2f} trades={m['trades']} wins={m['wins']} gross/trade={m['grossPerTrade'] if m['grossPerTrade'] is None else round(m['grossPerTrade'],2)} acc={m['accuracy']:.3f} edge={m['edge']:+.3f} band=+/-{m['bandPct']:.2f}%")
    det = (d.get("meta") or {}).get(pair["trade"])
    if det:
        rows = " | ".join(f"{r['key']} {('%.3f' % r['valAcc']) if r['valAcc'] is not None else 'ERR'}{'*' if r['passed'] else ''}" for r in det["stage1"])
        print(f"  stage1 (tail bc={det['stage1'][0]['bestConstant']:.3f}, * = passed): {rows}")
        if det["stage2"]["menu"]:
            menu = " | ".join(f"{row['frac']}: {row['pnl']:+.1f} ({row['trades']}t){' <-' if row['frac']==det['stage2']['chosenFrac'] else ''}" for row in det["stage2"]["menu"])
            print(f"  stage2 B-half menu: {menu}")
        print(f"  halves A={det['data']['halves']['A']} B={det['data']['halves']['B']} test={det['data']['test']}")
EOF
