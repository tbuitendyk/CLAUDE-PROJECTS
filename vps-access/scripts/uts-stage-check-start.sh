#!/usr/bin/env bash
# uts-stage-check-start.sh -- WRITES: starts the stage-engine check, on the
# owner's explicit one-time order (GO NOW! 2026-09-26: "deploy the code, run the
# stage testing"). The owner presses this check as a rule; this is the exception
# they made, for this deploy. Asks the service's own door, the one its button
# presses: two fabricated coins through all three stages, everything it made
# deleted at the end. It refuses while anything heavy is running.
set -uo pipefail
curl -sS --max-time 60 -X POST http://127.0.0.1:8094/api/stage-gate -H 'Content-Type: application/json' -d '{}' | python3 -c '
import json, sys
r = sys.stdin.read()
try: d = json.loads(r)
except Exception: print(r[:400]); sys.exit(0)
print("error:", d["error"]) if d.get("error") else print("state:", d.get("state"), "· run:", json.dumps(d.get("run")))'
