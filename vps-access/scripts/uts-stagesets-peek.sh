#!/usr/bin/env bash
# uts-stagesets-peek.sh -- READ-ONLY: what stage record sets the box holds
# and whether one is being written right now. Fires nothing.
set -uo pipefail
curl -sS --max-time 20 http://127.0.0.1:8094/api/stagesets | python3 -c '
import json, sys
d = json.load(sys.stdin)
print("running:", d.get("running"))
for s in d.get("sets", []):
    pf = s.get("perf") or {}
    print(f"  {s[\"id\"]}  {s[\"name\"]}  stage {s[\"stage\"]}  {s[\"status\"]}  {s.get(\"progress\",\"\")}"
          f"  cycles {pf.get(\"cyclesDone\")}/{pf.get(\"cyclesTotal\")}  eta {pf.get(\"etaMs\")}")
'
