#!/usr/bin/env bash
# classifier-bracket-smoke.sh -- end-to-end health check for the Bracket lab:
# fires a TINY sweep (2 assets, singles only, cached data — 6 slim trainings
# plus promotions), waits for completion, prints perf + the leaderboard.
# Cheap (~2 min) but exercises combos, training, the OCO simulator, the
# execution sweep, promotion and persistence. Refuses to run if a batch is
# already running (409 from the service).
set -euo pipefail
python3 <<'EOF'
import json, time, urllib.request

body = {
    "universe": ["DOTUSDT", "AVAXUSDT"],
    "sizes": {"singles": True, "doubles": False, "triples": False},
    "allLoaded": True,
    "permute": {"geometry": False, "decision": False, "band": False, "weekdays": False},
    "set": {"geometry": "daily-3d", "decision": "argmax", "band": "auto", "weekdaysOnly": False},
    "promoteK": 2,
    "minTrades": 5,
}
req = urllib.request.Request("http://127.0.0.1:8093/api/bracketlab",
                             data=json.dumps(body).encode(),
                             headers={"Content-Type": "application/json"})
try:
    resp = json.load(urllib.request.urlopen(req))
except urllib.error.HTTPError as e:
    print("start refused:", e.code, e.read().decode())
    raise SystemExit(1)
bid = resp["batchId"]
print("started", bid)
for _ in range(120):
    time.sleep(5)
    d = json.load(urllib.request.urlopen(f"http://127.0.0.1:8093/api/batch/{bid}"))
    p = d.get("perf") or {}
    print(f"  {d['status']} phase={p.get('phase')} units {p.get('unitsDone')}/{p.get('unitsTotal')} "
          f"runs {p.get('runsDone')}/{p.get('runsTotal')} rate={round(p.get('ratePerMin') or 0,1)}/min")
    if d["status"] != "running":
        break
print("final:", d["status"], "failures:", len(d.get("failures") or []))
for f in (d.get("failures") or [])[:3]:
    print("  FAIL", f["key"], f["error"])
for i, l in enumerate(d.get("leaders") or [], 1):
    print(f"  {i}. [{l['stage']}] {l['trade']} {l['geometry']} band±{round(l['bandPct'],2)}% "
          f"q{l['quorum']}/{l['members']} {l['gate']} d{l['dMult']}x t{l['tHours']}h "
          f"net {l['pnl']:+.2f} ({l['wins']}/{l['trades']}t) stops={l['stops']} ambig={l['ambiguous']}")
EOF
