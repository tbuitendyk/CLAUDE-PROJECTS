#!/usr/bin/env bash
# classifier-latest-run.sh -- READ-ONLY: newest bracketlab doc, the settings
# that shape it, and its top board rows with full cells.
set -uo pipefail
node -e '
const fs = require("fs"), path = require("path");
const dir = "/opt/general-classifier/data/batches";
const f = fs.readdirSync(dir).filter((x) => x.startsWith("bracketlab-") && x.endsWith(".json")).sort().pop();
const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
const p = d.params;
console.log("doc:", d.id, d.status, "| elapsed", Math.round((d.perf.elapsedMs||0)/1000)+"s");
console.log("universe:", (p.universe||[]).join(","), "| trailing:", p.trailing, "| nulls:", p.labelShiftReps, "| layout:", p.windowLayout);
console.log("plan:", JSON.stringify(d.plan));
console.log("failures:", (d.failures||[]).length);
for (const l of (d.leaders||[]).slice(0,6)) {
  console.log(`  [${l.stage}${l.nullDealSeed!=null?" n"+l.nullDealSeed:""}] ${l.trade} ${l.geometry} q${l.quorum} ${l.gate||"-"}/${l.entry||"breakout"} d${l.dMult} t${l.tHours}h trail${l.trailMult??"-"} arm${l.armMult??"-"} test $${(l.pnl??0).toFixed(2)} hold $${l.holdout?l.holdout.pnl.toFixed(2):"-"}`);
}
'
