#!/usr/bin/env bash
# bracket-fixture-check.sh -- read the newest bracketlab doc and PASS/FAIL it
# against the single-threaded fixture. Arg: doc id (default newest).
set -uo pipefail
ID="${1:-}"
if [ -z "$ID" ]; then
  ID=$(curl -s http://127.0.0.1:8093/api/batches | python3 -c '
import json,sys
b=json.load(sys.stdin)["batches"]
ids=[x["id"] for x in b if x["id"].startswith("bracketlab-")]
print(ids[0] if ids else "")')
fi
curl -s "http://127.0.0.1:8093/api/batch/$ID" > /tmp/fx.json
ID="$ID" python3 <<'PY'
import json, os
d = json.load(open('/tmp/fx.json'))
print(f"doc={d['id']} status={d['status']} workers={(d.get('perf') or {}).get('workers')} "
      f"elapsed={round((d.get('perf') or {}).get('elapsedMs',0)/60000,1)}min")
rep = d.get('replication') or []
scored = [r for r in rep if r.get('pnl') is not None]
withc  = [r for r in scored if r.get('vsControl') is not None]
pos    = sum(1 for r in scored if r['pnl'] > 0)
posc   = sum(1 for r in withc if r['vsControl'] > 0)
dot    = next((r for r in rep if r['trade'] == 'DOTUSDT' and not r.get('ctx1')), None)
print(f"  replication: {pos}/{len(scored)} positive dollars, {posc}/{len(withc)} positive vs control")
ok = True
if dot:
    print(f"  DOTUSDT declared cell: {dot['pnl']:+.2f} on {dot['trades']} trades ({dot['wins']} wins) vsCtl {dot.get('vsControl'):+.2f}")
    if abs(dot['pnl'] - 185.08) > 0.005: print("  FAIL: DOT pnl != +185.08"); ok = False
    if dot['trades'] != 235:            print("  FAIL: DOT trades != 235");   ok = False
    if dot['wins'] != 130:              print("  FAIL: DOT wins != 130");     ok = False
else:
    print("  FAIL: no DOTUSDT row"); ok = False
if pos != 7:  print(f"  FAIL: positive dollars {pos} != 7"); ok = False
if posc != 5: print(f"  FAIL: positive vs control {posc} != 5"); ok = False
print("VERDICT: PASS — parallel output matches the single-threaded fixture exactly" if ok
      else "VERDICT: FAIL — DO NOT TRUST THE PARALLEL BUILD")
PY
