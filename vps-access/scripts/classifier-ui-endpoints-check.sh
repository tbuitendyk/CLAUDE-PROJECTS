#!/usr/bin/env bash
# Post-deploy check of the three new owner-facing endpoints: functioning and
# well-formed, including the hostile-path refusals.
set -euo pipefail
python3 <<'EOF'
import json, urllib.request, urllib.error
B="http://127.0.0.1:8093"
def get(u):
    with urllib.request.urlopen(u, timeout=30) as r: return json.load(r)
def post(u, body):
    req=urllib.request.Request(u, json.dumps(body).encode(), {'Content-Type':'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)
def expect_fail(u):
    try:
        urllib.request.urlopen(u, timeout=15); return False
    except urllib.error.HTTPError as e:
        return e.code in (400, 404)

s=get(f"{B}/api/bracketlab/verdict-sources")["sources"]
print(f"verdict-sources: {len(s)} runs; sample:", s[:2])
L13="bracketlab-20260730-0627-l13-reproduce-and-keep-l9"
d=get(f"{B}/api/batch/{L13}")
row=next(r for r in d["edgeCensus"] if r.get("modelFile") and r["trade"]=="UNIUSDT" and r["geometry"]=="daily-4d" and r["decision"]=="directional")
fname=row["modelFile"].split("/")[-1]
ins=get(f"{B}/api/bracketlab/{L13}/inspect?file={fname}&quorum=4")
print(f"inspect: {len(ins['members'])} members, pairwise {len(ins['pairwise'])}x{len(ins['pairwise'][0])}, committee hold trades {ins['committee']['holdTrades']}/{ins['committee']['holdPeriods']}")
print(f"  member 1 solo hold acc: {ins['members'][0]['hold']['testAcc']:.3f}  active {ins['members'][0]['activeHold']:.2f}  with-trade {ins['members'][0]['withTradeHold']}")
print("hostile path refused:", expect_fail(f"{B}/api/bracketlab/{L13}/inspect?file=..%2F..%2Fbatches%2Fx.json"))
v=post(f"{B}/api/bracketlab/null-verdict", {"realId": L13, "nullId": "bracketlab-20260729-0811-l8-money-null", "trade": "UNIUSDT", "geometry": "daily-4d", "decision": "directional"})
print(f"verdict: perSetup beats {v['perSetup']['beats']}/{v['perSetup']['n']} pass={v['perSetup']['passes']}; selection beats {v['selection']['beats']}/{v['selection']['n']} pass={v['selection']['passes']}; sanity neg {100*v['sanity']['negativeShare']:.0f}% ok={v['sanity']['ok']}")
EOF
