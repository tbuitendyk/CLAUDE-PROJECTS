#!/usr/bin/env bash
# classifier-confirm-fire.sh -- run MINUTE CONFIRMATION on the selected row of
# the newest bracketlab doc that has a selection.
#
# Prefers the DECLARED cell when the run has one, since that is the hypothesis
# under test; a search winner is rarely the config anybody intends to trade.
# Falls back to the board's best row otherwise.
set -euo pipefail
python3 <<'EOF'
import json, urllib.request

def get(u):
    with urllib.request.urlopen(u, timeout=30) as r:
        return json.load(r)

def post(u, body=None):
    req = urllib.request.Request(u, data=json.dumps(body or {}).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

B = "http://127.0.0.1:8093"
ids = [b["id"] for b in get(f"{B}/api/batches")["batches"] if b["id"].startswith("bracketlab-")]
doc = None
for i in ids:
    d = get(f"{B}/api/batch/{i}")
    if d.get("leaders"):
        doc = d
        break
if not doc:
    print("no bracketlab doc with a board")
    raise SystemExit(0)

prom = [l for l in doc["leaders"] if l.get("stage") == "promoted"]
if not prom:
    print(f"{doc['id']}: no promoted rows to confirm")
    raise SystemExit(0)
# prefer a trailing cell; that is the one whose number rests on an assumption
pick = next((l for l in prom if l.get("declaredCell")), None)
target = "declared"
if pick is None:
    pick = next((l for l in prom if l.get("trailMult") is not None), prom[0])
    target = "best"
shown = dict(pick)
if target == "declared":
    shown.update(pick["declaredCell"])
print(f"doc {doc['id']}")
print(f"target: {target}")
print(f"selecting: {shown['trade']} {shown['geometry']} q{shown.get('quorum')}/{shown.get('members')} "
      f"{shown.get('entry','breakout')}/{shown.get('gate')} d{shown.get('dMult')} t{shown.get('tHours')}h "
      f"trail={shown.get('trailMult')} arm={shown.get('armMult')} -> {shown['pnl']:+.2f} "
      f"(trailAmb={shown.get('trailAmbiguous', 0)})")
post(f"{B}/api/bracketlab/{doc['id']}/select", {"key": pick["key"], "stage": "promoted"})
print(post(f"{B}/api/bracketlab/{doc['id']}/confirm", {"target": target}))
EOF
