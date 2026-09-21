#!/usr/bin/env bash
# uts-stop-run.sh -- WRITES: stops one running stage run, on the owner's explicit
# order ("kill any running job", 2026-09-21). Asks the service's own stop door,
# the same one the Stop button on Sweep presses; the set is marked as the
# service marks it. Restarts nothing, deletes nothing.
#   arg: <setId>
set -uo pipefail
ID="${1:-}"
[ -n "$ID" ] || { echo "usage: <setId>"; exit 0; }
echo "== stopping $ID =="
curl -sS --max-time 60 -X POST "http://127.0.0.1:8094/api/stageset/$ID/stop" -H 'Content-Type: application/json' -d '{}'; echo
sleep 3
echo "== the box now =="
curl -sS --max-time 20 http://127.0.0.1:8094/api/stagesets | python3 -c '
import json, sys
d = json.load(sys.stdin)
print("running:", d.get("running"))
for s in d.get("sets", [])[:3]:
    print("  %s  %s  %s  %s" % (s["id"], s["name"], s["status"], s.get("progress", "")))
'
