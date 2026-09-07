#!/usr/bin/env bash
# uts-capture-dry.sh -- the reconnaissance and the DRY RUN for the one-time
# capture of the stage 3 run going on this box (RULE TEN: this script and its
# partner go the day that run has been started again).
#
# It writes NOTHING and stops NOTHING. The one thing it changes about the
# running service is that Node's debug port is opened on 127.0.0.1:9229, and
# it is deliberately LEFT open so the real capture does not have to reopen it.
# The port is bound to loopback and closes on the next service restart, which
# is the deploy the owner is about to do.
#
# What it prints, in order: the service and the engine it is running, the tool
# fetched from the branch (git show only -- no checkout, nothing deployed),
# what the tool makes of the running code, and then the tool's own --dry-run,
# which breaks at the next part to land, reports where the run is AND which
# names the paused frame can see, and lets the run go.
set -uo pipefail
APP=/opt/ultimate-trading-system
SRC=$HOME/deploy-uts
TOOL=/tmp/uts-capture-stage3.js
SET=s3-mtqr9ps2-3

echo "== the service =="
PID=$(systemctl show ultimate-trading-system -p MainPID --value)
SVCUSER=$(systemctl show ultimate-trading-system -p User --value)
STATE=$(systemctl show ultimate-trading-system -p ActiveState --value)
echo "   pid=$PID user=$SVCUSER state=$STATE since=$(systemctl show ultimate-trading-system -p ActiveEnterTimestamp --value)"
echo "   node $(node --version 2>/dev/null || echo 'not on root PATH')"
echo "   debug port already open: $(ss -ltn 2>/dev/null | grep -c '127.0.0.1:9229')"
[ -n "$PID" ] && [ "$PID" != 0 ] || { echo "   NO MAIN PROCESS -- stopping"; exit 1; }

echo "== the engine it is running =="
grep -m1 '"version"' "$APP/package.json" | tr -d ' '
echo "   lib/stages.js sha256 $(sha256sum "$APP/lib/stages.js" | cut -c1-16)"

echo "== the tool, out of the branch (git show only: no checkout, no deploy) =="
if [ ! -d "$SRC/.git" ]; then
  git clone -q --branch ultimate-trading-system https://github.com/tbuitendyk/CLAUDE-PROJECTS.git "$SRC" || exit 1
fi
git -C "$SRC" fetch -q origin ultimate-trading-system || exit 1
git -C "$SRC" show origin/ultimate-trading-system:ultimate-trading-system/tools/capture-stage3.js > "$TOOL" || exit 1
chmod 0644 "$TOOL"
echo "   $(wc -l < "$TOOL") lines from $(git -C "$SRC" log --oneline -1 origin/ultimate-trading-system)"
node --check "$TOOL" && echo "   it parses"

echo "== what the tool makes of the code this process is running =="
node -e "console.log('   ' + JSON.stringify(require('$TOOL').locateCallback('$APP')))" || exit 1
node -e "
const t = require('$TOOL');
console.log('   names the real capture needs: ' + t.NEEDS.locals.join(', '));
" || exit 1

echo "== DRY RUN -- reads only; nothing written, the run is not stopped =="
echo "   running as $SVCUSER: node $TOOL --pid $PID --app-dir $APP --set $SET --wait-minutes 6 --dry-run"
if command -v sudo >/dev/null 2>&1; then
  sudo -u "$SVCUSER" node "$TOOL" --pid "$PID" --app-dir "$APP" --set "$SET" --wait-minutes 6 --dry-run
else
  runuser -u "$SVCUSER" -- node "$TOOL" --pid "$PID" --app-dir "$APP" --set "$SET" --wait-minutes 6 --dry-run
fi
echo "   dry run exit $?"

echo "== the run, after being let go =="
sleep 3
curl -sf --max-time 20 http://127.0.0.1:8094/api/stagesets | node -e '
let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{
  let d={};try{d=JSON.parse(r)}catch(e){console.log("   no answer from the service");return}
  const run=d.running; const row=(d.sets||[]).find(x=>x.id===run)||null;
  console.log("   running: "+(run||"nothing"));
  if(row) console.log("   "+row.name+" is "+row.status+" -- "+(row.progress||""));
});'
echo "== checkpoints folder (must still be absent or empty after a dry run) =="
ls -la "$APP/data/stagesets/checkpoints" 2>&1 | head -5
