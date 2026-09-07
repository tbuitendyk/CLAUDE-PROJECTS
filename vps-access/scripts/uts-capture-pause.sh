#!/usr/bin/env bash
# uts-capture-pause.sh -- THE REAL CAPTURE. Pauses the stage 3 run going on
# this box (S3 #1c), which is running 3.81.0 code that keeps no checkpoint of
# its own, by writing that checkpoint out of the paused frame through Node's
# debugger and then asking the run to stop.
#
# Run uts-capture-dry.sh FIRST. Its `sees` line is what says the frame can
# reach every name this needs; without that this is a guess.
#
# After it: the set reads `paused`, its checkpoint is beside it, and the
# owner can deploy 3.82.0 and press start stage 3 with the paused entry
# chosen. RULE TEN: this script, its partner and the tool go the day that has
# been done.
set -uo pipefail
APP=/opt/ultimate-trading-system
SRC=$HOME/deploy-uts
TOOL=/tmp/uts-capture-stage3.js
SET=s3-mtqr9ps2-3
CP="$APP/data/stagesets/checkpoints/$SET.json"

PID=$(systemctl show ultimate-trading-system -p MainPID --value)
SVCUSER=$(systemctl show ultimate-trading-system -p User --value)
echo "== before =="
echo "   pid=$PID user=$SVCUSER"
RUNNING=$(curl -sf --max-time 20 http://127.0.0.1:8094/api/stagesets | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(r).running||""))}catch(e){process.stdout.write("")}})')
echo "   the box says running: '${RUNNING:-nothing}'"
if [ "$RUNNING" != "$SET" ]; then
  echo "   THAT IS NOT $SET -- nothing done"; exit 1
fi
if [ -e "$CP" ]; then echo "   a checkpoint is ALREADY there: $CP -- nothing done"; exit 1; fi

echo "== the tool, out of the branch again (git show only) =="
git -C "$SRC" fetch -q origin ultimate-trading-system || exit 1
git -C "$SRC" show origin/ultimate-trading-system:ultimate-trading-system/tools/capture-stage3.js > "$TOOL" || exit 1
chmod 0644 "$TOOL"
echo "   $(wc -l < "$TOOL") lines from $(git -C "$SRC" log --oneline -1 origin/ultimate-trading-system)"
node --check "$TOOL" || exit 1

echo "== CAPTURE -- writes the checkpoint, then asks the run to stop =="
if command -v sudo >/dev/null 2>&1; then
  sudo -u "$SVCUSER" node "$TOOL" --pid "$PID" --app-dir "$APP" --set "$SET" --wait-minutes 4 --close-inspector
else
  runuser -u "$SVCUSER" -- node "$TOOL" --pid "$PID" --app-dir "$APP" --set "$SET" --wait-minutes 4 --close-inspector
fi
RC=$?
echo "   capture exit $RC"

# THE MARK MATTERS AS MUCH AS THE CHECKPOINT. A stopped 3.81 run says
# `cancelled`, and a start-again on 3.82.0 takes paused, interrupted or a
# failure -- not cancelled. The tool marks it as part of the capture; if that
# one step did not take, the state is on disk and unreachable, so it is tried
# once more here rather than left for someone to notice.
STATUS=$(node -e 'try{console.log(require("'"$APP"'/data/stagesets/'"$SET"'.json").status)}catch(e){console.log("unreadable")}')
if [ "$STATUS" = "cancelled" ] && [ -e "$CP" ]; then
  echo "== the set is still 'cancelled' with its checkpoint there -- marking it paused =="
  sleep 3
  if command -v sudo >/dev/null 2>&1; then
    sudo -u "$SVCUSER" node -e "require('$TOOL').markPaused({ appDir: '$APP' }, '$SET').then((s) => console.log('   now ' + s)).catch((e) => { console.log('   still not marked: ' + e.message); process.exit(1); })"
  else
    runuser -u "$SVCUSER" -- node -e "require('$TOOL').markPaused({ appDir: '$APP' }, '$SET').then((s) => console.log('   now ' + s)).catch((e) => { console.log('   still not marked: ' + e.message); process.exit(1); })"
  fi
fi

echo "== after =="
echo "   service: $(systemctl show ultimate-trading-system -p ActiveState --value), pid now $(systemctl show ultimate-trading-system -p MainPID --value) (was $PID)"
echo "   debug port still open: $(ss -ltn 2>/dev/null | grep -c '127.0.0.1:9229')"
if [ -e "$CP" ]; then
  echo "   checkpoint: $(stat -c '%s bytes, owner %U, %y' "$CP")"
  node -e '
    const c = require("'"$CP"'");
    console.log("   v=" + c.v + " id=" + c.id + " release=" + c.release + " writtenBy=" + c.writtenBy);
    console.log("   parts " + c.partsDone + " of " + c.partsTotal + " · units listed " + c.units.length
      + " · agreements " + Object.keys(c.agreedMap).length + " · units with comparisons " + Object.keys(c.controlsMap).length);
    console.log("   settings priced " + c.pricedSettings + " · rows " + c.storeRows + " in " + c.storeBlocks + " blocks · atPart " + c.atPart);
  '
else
  echo "   NO CHECKPOINT WAS WRITTEN"
fi
echo "== the set =="
node -e '
  const d = require("'"$APP"'/data/stagesets/'"$SET"'.json");
  console.log("   " + d.name + " is " + d.status + (d.pausedBy ? " (" + d.pausedBy + ")" : ""));
  console.log("   " + (d.progress || "")); 
  console.log("   finishedAt " + d.finishedAt + " · error " + JSON.stringify(d.error) + " · failures " + (d.failures || []).length);
'
echo "== the service still answers =="
curl -sf --max-time 20 http://127.0.0.1:8094/api/stagesets | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const d=JSON.parse(r);const row=(d.sets||[]).find(x=>x.id==="'"$SET"'");console.log("   running now: "+(d.running||"nothing"));console.log("   the list row: status="+(row&&row.status)+" checkpoint="+(row&&row.checkpoint)+" continued="+(row&&row.continued));});'
echo "== the records store, as it was left =="
du -sh "$APP/data/batches/$SET.rows" 2>/dev/null
ls -la "$APP/data/batches/$SET.rows" 2>/dev/null | tail -4
