#!/usr/bin/env bash
# uts-paused-row.sh -- READ-ONLY. After the deploy: does the box still hold
# the paused stage 3 run, and does the release now serving offer it to be
# started again? Prints the release, the set's own document, and the row the
# screens read.
set -uo pipefail
APP=/opt/ultimate-trading-system
SET=s3-mtqr9ps2-3
echo "== the release now serving =="
grep -m1 '"version"' "$APP/package.json" | tr -d ' '
echo "   service since $(systemctl show ultimate-trading-system -p ActiveEnterTimestamp --value), pid $(systemctl show ultimate-trading-system -p MainPID --value)"
echo "== the set's own document =="
node -e '
  const d = require("'"$APP"'/data/stagesets/'"$SET"'.json");
  console.log("   " + d.name + " is " + d.status + (d.pausedBy ? " (" + d.pausedBy + ")" : ""));
  console.log("   " + (d.progress || "(no progress line)"));
'
echo "== its checkpoint is still there =="
ls -la "$APP/data/stagesets/checkpoints/" 2>&1 | tail -3
echo "== the row the screens read =="
curl -sf --max-time 25 http://127.0.0.1:8094/api/stagesets | node -e '
let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{
  const d=JSON.parse(r); const row=(d.sets||[]).find(x=>x.id==="'"$SET"'");
  console.log("   running: " + (d.running||"nothing"));
  if(!row){console.log("   THE SET IS NOT IN THE LIST");return}
  console.log("   " + row.name + ": status=" + row.status + " checkpoint=" + row.checkpoint + " continued=" + row.continued);
  console.log("   units " + (row.perf||{}).unitsDone + " of " + (row.perf||{}).unitsTotal + " · parts " + (row.perf||{}).partsDone + " of " + (row.perf||{}).partsTotal);
  const off=(d.sets||[]).filter(x=>x.stage===3&&x.checkpoint&&["paused","interrupted","error"].includes(x.status));
  console.log("   record sets the stage 3 box will offer to start again: " + (off.length? off.map(x=>x.name+" ("+x.status+")").join(", ") : "none"));
});'
