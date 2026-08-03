#!/usr/bin/env bash
# classifier-132-smoke.sh -- post-deploy smoke for the 1.32.0 release:
# health, engine version, the new endpoints answer, retired layouts refuse,
# and the page files carry the new cache stamps. Read-only except for two
# validation POSTs that must REFUSE (they prove the loud-refusal paths).
set -uo pipefail
B="http://127.0.0.1:8093"
echo "healthz: $(curl -sS --max-time 10 $B/api/healthz)"
echo "engine:  $(node -e "console.log(require('/opt/general-classifier/package.json').version)")"
echo "data-state symbols: $(curl -sS --max-time 10 $B/api/data-state | python3 -c 'import sys,json; print(len(json.load(sys.stdin).get("symbols",[])))')" 
echo "-- retired layout must refuse:"
curl -sS --max-time 10 -X POST $B/api/bracketlab -H 'Content-Type: application/json' \
  -d '{"universe":["DOTUSDT"],"sizes":{"singles":true},"windowLayout":"interlaced"}' | head -c 300; echo
echo "-- absent layout must refuse:"
curl -sS --max-time 10 -X POST $B/api/bracketlab -H 'Content-Type: application/json' \
  -d '{"universe":["DOTUSDT"],"sizes":{"singles":true}}' | head -c 300; echo
echo "-- HT null draw on unknown run must refuse:"
curl -sS --max-time 10 -X POST $B/api/historytuning/null -H 'Content-Type: application/json' \
  -d '{"replayOf":"historytuning-nope","nullShiftSeed":5}' | head -c 200; echo
echo "-- page stamps:"
grep -o 'app.js?v=[0-9]*\|style.css?v=[0-9]*' /opt/general-classifier/public/index.html | sort -u
ls /opt/general-classifier/public/help-bracket.html >/dev/null && echo "help-bracket.html present"
