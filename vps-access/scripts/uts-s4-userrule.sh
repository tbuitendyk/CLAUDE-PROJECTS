#!/usr/bin/env bash
# Recovers the rule the OWNER built on each Stage 4 set from the walk's own
# recorded steps and stamps it onto the record -- the one write this does, and
# the one the owner ordered. Prints what it recovered and what it keeps.
set -euo pipefail
cd /opt/ultimate-trading-system
node -e '
const fs=require("fs"),path=require("path");
const stages=require("/opt/ultimate-trading-system/lib/stages");
const D="/opt/ultimate-trading-system/data/stagesets";
(async () => {
for (const f of fs.readdirSync(D)) {
  if (!f.startsWith("s4-") || !f.endsWith(".json")) continue;
  const id=f.replace(/\.json$/,"");
  const before=JSON.parse(fs.readFileSync(path.join(D,f),"utf8"));
  console.log("=== "+JSON.stringify(before.name));
  console.log("  userRule on the record before: "+JSON.stringify(before.userRule||null));
  const out=await stages.funnelSetRows(id,{});
  if (!out || out.needsTally) { console.log("  no tables on its parent"); continue; }
  console.log("  recovered now: "+out.set.userStamped);
  console.log("  User Rule  : "+out.set.userSentence);
  console.log("  keeps      : "+out.set.userSurvivors+" of "+out.of);
  console.log("  Final Rule : "+out.set.ruleSentence);
  console.log("  keeps      : "+out.set.survivors+" of "+out.of+"   target "+out.set.target);
  const after=JSON.parse(fs.readFileSync(path.join(D,f),"utf8"));
  console.log("  userRule ON THE RECORD after: "+JSON.stringify(after.userRule));
  console.log("  rows sent  : "+out.rows.length+"   clipped "+out.clipped);
}
})().catch((e)=>{console.log("FAILED "+e.message); process.exit(1);});
'
