#!/usr/bin/env bash
# Read-only: print the board's #1 row (held-back sort) with both windows.
set -euo pipefail
python3 <<'EOF'
import json, urllib.request
def get(u):
    with urllib.request.urlopen(u, timeout=30) as r: return json.load(r)
B="http://127.0.0.1:8093"
d=get(f"{B}/api/batch/bracketlab-20260730-0627-l13-reproduce-and-keep-l9")
rows=[l for l in (d.get("leaders") or []) if l.get("stage")=="promoted"]
if not rows: print("no promoted rows"); raise SystemExit
l=rows[0]
h=l.get("holdout") or {}
hm=h.get("metrics") or {}
m=l.get("metrics") or {}
print(f"ROW #1 (held-back sort): {l['trade']}  {l['geometry']}  {l['decision']}  band ±{l['bandPct']:.2f}%")
print(f"  execution: quorum {l['quorum']}/{l['members']}  entry {l.get('entry','breakout')}  gate {l.get('gate')}  d {l.get('dMult')}x  t {l.get('tHours')}h")
print(f"  HELD-BACK : net ${h.get('pnl',0):,.2f}  {h.get('wins')}/{h.get('trades')} wins  acc {100*hm.get('testAcc',0):.1f}% (base {100*hm.get('majorityBaseline',0):.1f}%)  g/t ${h.get('grossPerTrade') or 0:.2f}  stops {h.get('stops')}")
print(f"  tuning    : net ${l.get('pnl',0):,.2f}  {l.get('wins')}/{l.get('trades')} wins  acc {100*m.get('testAcc',0):.1f}%")
print(f"  saved file: {next((r.get('modelFile') for r in d.get('edgeCensus',[]) if r['trade']==l['trade'] and r['geometry']==l['geometry'] and r['decision']==l['decision']), '?')}")
EOF
