#!/usr/bin/env bash
# classifier-confirm-fire.sh -- run MINUTE CONFIRMATION on the selected row of
# the newest bracketlab doc that has a selection.
#
# Picks a trailing candidate if one is on the board, since trailing is what
# actually needs confirming: a static-stop result barely depends on intra-bar
# order, a trailing one depends on it constantly.
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
pick = next((l for l in prom if l.get("trailMult") is not None), prom[0])
print(f"doc {doc['id']}")
print(f"selecting: {pick['trade']} {pick['geometry']} q{pick['quorum']}/{pick['members']} "
      f"{pick.get('entry','breakout')}/{pick['gate']} d{pick.get('dMult')} t{pick['tHours']}h "
      f"trail={pick.get('trailMult')} arm={pick.get('armMult')} -> {pick['pnl']:+.2f} "
      f"(trailAmb={pick.get('trailAmbiguous', 0)})")
post(f"{B}/api/bracketlab/{doc['id']}/select", {"key": pick["key"], "stage": "promoted"})
print(post(f"{B}/api/bracketlab/{doc['id']}/confirm"))
EOF
