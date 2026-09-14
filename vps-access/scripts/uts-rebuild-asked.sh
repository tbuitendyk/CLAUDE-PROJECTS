#!/usr/bin/env bash
# uts-rebuild-asked.sh -- READ-ONLY. What the running (or last) rebuild of the
# test history numbers on a stage 3 set was asked for: which board (a coin and
# shape, or every one), how many coins and shapes it is pricing, how far it is.
# The page names the board in the request (3.134.0+) and the run's status
# carries it back, so this is the request as the engine saw it, not as a page
# says it sent it. Then the set's own coin-and-shape keys, so a key the page
# could have sent can be compared with what the tables hold.
#   usage: uts-rebuild-asked.sh <stage 3 set id>
set -uo pipefail
ID="${1:-}"
[ -n "$ID" ] || { echo "usage: uts-rebuild-asked.sh <stage 3 set id>"; exit 1; }
echo "== the rebuild status the engine reports for $ID =="
curl -sS -m 20 "http://127.0.0.1:8094/api/funnel/$ID/rebuild" | python3 -c '
import sys,json
try: d=json.load(sys.stdin)
except Exception as e: print("  (no readable answer:", e, ")"); sys.exit(0)
for k in ("running","unit","units","done","of","error","token"):
    print(f"  {k:8}: {d.get(k)!r}")
'
echo
echo "== the coin-and-shape keys the set's tables hold =="
cd /opt/ultimate-trading-system || exit 1
sudo -u uts node -e '
const stages = require("./lib/stages");
const id = process.argv[1];
const t = stages.readTally(id);
if (!t) { console.log("  no tables"); process.exit(0); }
const units = stages.unitsOfSet ? stages.unitsOfSet(t, id) : [];
console.log("  units:", units.length);
for (const u of units) console.log("   ", JSON.stringify(u.key), "-", u.name);
' "$ID" 2>&1 | head -40
