#!/usr/bin/env bash
# uts-walk-run-smoke.sh -- READ-ONLY apart from starting a walk, which stores
# nothing and touches no record. Starts one, polls it the way the screen does,
# and prints what the screen would be showing at each poll. Proves the run is
# in the background, across workers, with a live count.
set -uo pipefail
echo "== the press =="
curl -s -m 30 -X POST http://127.0.0.1:8094/api/coins/walk -H 'Content-Type: application/json' \
  -d '{"windowMonths":6,"warmUpMonths":12,"bands":[50,100,150,200],"sweetSpot":true,"scrambles":10,"floor":5}'
echo
echo "== the polls, one a second, the way the panel does =="
for i in $(seq 1 40); do
  sleep 1
  L=$(curl -s -m 20 http://127.0.0.1:8094/api/coins/walk | node -e '
let b="";process.stdin.on("data",(d)=>b+=d).on("end",()=>{
const s=JSON.parse(b);
if (s.running) { console.log(`walking · ${s.done} of ${s.of} · across ${s.workers} worker(s) · ${s.cpu&&s.cpu.busy!=null?Math.round(s.cpu.busy*100)+"% of "+s.cpu.cores+" cores busy":"busy unknown"}`); }
else if (s.none) console.log("nothing walked yet");
else if (s.error) console.log("ERROR: "+s.error);
else console.log(`DONE · ${(s.rows||[]).length} rows · beat all their copies ${(s.rows||[]).filter(r=>r.asGood===0).length} · took ${((s.finishedAt-s.startedAt)/1000).toFixed(1)}s`);
});')
  echo "  $L"
  case "$L" in DONE*|ERROR*) break;; esac
done
