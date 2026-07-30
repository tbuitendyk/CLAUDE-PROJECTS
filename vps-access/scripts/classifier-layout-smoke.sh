#!/usr/bin/env bash
# classifier-layout-smoke.sh -- end-to-end check of the phase-2 window
# layouts (owner's design, 2026-07-30). Fires a tiny 'both' job — every
# setup run twice, once per layout, one seed, shared band — then checks the
# invariants the design promises and prints the built-in comparison.
#
# Invariants checked on the finished doc:
#   * both arms present in the census, tagged with their layout + seed
#   * PER SETUP: potential trade periods identical between the arms
#     (holdPeriods and searchPeriods) — the owner's comparability invariant
#   * train-side purge recorded and non-zero on both arms
#   * /api/bracketlab/compare returns paired rows without refusing
set -uo pipefail
B="http://127.0.0.1:8093"

echo "== firing a tiny BOTH-layout job (2 assets, 1 geometry, 0 scrambles) =="
OUT=$(curl -sS -X POST "$B/api/bracketlab" -H "Content-Type: application/json" -d '{
  "universe": ["BTCUSDT","ETHUSDT"],
  "sizes": {"singles": true, "doubles": false, "triples": false},
  "allLoaded": true,
  "permute": {"geometry": false, "decision": false, "band": false, "weekdays": false},
  "set": {"geometry": "daily-3d", "decision": "argmax", "band": "auto", "weekdaysOnly": false},
  "holdout": true, "trailing": false, "edgeScreen": true,
  "windowLayout": "both", "interlaceSeed": 1, "sharedBand": true,
  "promoteK": 50, "minTrades": 1,
  "label": "layout-smoke",
  "description": "Phase-2 preflight: both window layouts on two assets. Checks the potential-trade-day invariant, arm tagging, train-side purge, and the comparison endpoint."
}')
echo "$OUT"
JOB=$(printf '%s' "$OUT" | python3 -c "import sys,json;print(json.load(sys.stdin).get('batchId',''))")
[ -n "$JOB" ] || { echo "LAYOUT SMOKE FAIL: no batchId — is a job already running?"; exit 1; }
echo "== waiting for $JOB =="
for i in $(seq 1 60); do
  sleep 15
  ST=$(curl -sS "$B/api/batch/$JOB" | python3 -c "import sys,json;print(json.load(sys.stdin).get('status',''))")
  [ "$ST" = "done" ] && break
  case "$ST" in failed|cancelled|error) echo "LAYOUT SMOKE FAIL: status=$ST"; exit 1 ;; esac
done

JOB="$JOB" python3 <<'EOF'
import json, urllib.request, os
B="http://127.0.0.1:8093"
def get(u):
    with urllib.request.urlopen(u, timeout=30) as r: return json.load(r)
def post(u, body):
    req=urllib.request.Request(u, json.dumps(body).encode(), {"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=30) as r: return json.load(r)
d=get(f"{B}/api/batch/{os.environ['JOB']}")
rows=[r for r in (d.get("edgeCensus") or []) if not r.get("shiftFrac")]
fails=[]
def chk(ok,msg):
    print(("  ok   " if ok else "  FAIL ")+msg)
    if not ok: fails.append(msg)
print(f"\ndoc {d['id']} status={d['status']} real census rows={len(rows)}")
chrono=[r for r in rows if r.get("windowLayout")=="chronological"]
inter=[r for r in rows if r.get("windowLayout")=="interlaced"]
chk(len(chrono)>0 and len(inter)>0, f"both arms present ({len(chrono)} chronological, {len(inter)} interlaced)")
chk(all(r.get("interlaceSeed")==1 for r in rows), "seed recorded on every row")
key=lambda r:(r["trade"],r["geometry"],r["decision"])
bi={key(r):r for r in inter}
pairs=[(a,bi[key(a)]) for a in chrono if key(a) in bi]
chk(len(pairs)==len(chrono), f"every setup paired across arms ({len(pairs)})")
chk(all(a.get("holdPeriods")==b.get("holdPeriods") for a,b in pairs),
    "OWNER'S INVARIANT: holdout potential periods identical per setup: " +
    ", ".join(f"{a['trade']} {a.get('holdPeriods')}={b.get('holdPeriods')}" for a,b in pairs))
chk(all(a.get("searchPeriods")==b.get("searchPeriods") for a,b in pairs),
    "OWNER'S INVARIANT: search potential periods identical per setup: " +
    ", ".join(f"{a['trade']} {a.get('searchPeriods')}={b.get('searchPeriods')}" for a,b in pairs))
chk(all(r.get("layoutPurged",0)>0 for r in rows), "train-side purge recorded and non-zero on every row")
cmp=post(f"{B}/api/bracketlab/compare", {"a": d["id"]})
chk(cmp.get("pairedCount",0)==len(pairs), f"compare endpoint pairs all setups ({cmp.get('pairedCount')})")
print("\n== the comparison itself (paired setups; money is $ per $100 book on the held-back window) ==")
for p in cmp.get("paired",[]):
    a,b=p["a"],p["b"]
    print(f"  {p['key']:45s} chrono ${a['holdPnl']:+8.2f} ({a['holdTrades']} trades)   interlaced ${b['holdPnl']:+8.2f} ({b['holdTrades']} trades)   delta ${p['dHoldPnl']:+8.2f}")
ov=cmp.get("survivorOverlap",{})
print(f"  survivor overlap: {ov.get('sharedCount')} of top-10 shared")
print()
print("LAYOUT SMOKE PASS" if not fails else f"LAYOUT SMOKE FAIL: {len(fails)} problem(s)")
raise SystemExit(0 if not fails else 1)
EOF
