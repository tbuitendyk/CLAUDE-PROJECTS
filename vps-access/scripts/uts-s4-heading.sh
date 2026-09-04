#!/usr/bin/env bash
# READ-ONLY. What the Stage 4 heading will be able to say about the real set on
# the box: every field the new heading reads, straight off the record.
set -euo pipefail
cd /opt/ultimate-trading-system
node -e '
const fs=require("fs"),path=require("path");
const D="/opt/ultimate-trading-system/data/stagesets";
const key=(u)=>`${u.trade}|${u.ctx1||""}|${u.ctx2||""}|${u.geometry}`;
for (const f of fs.readdirSync(D)) {
  if (!f.startsWith("s4-") || !f.endsWith(".json")) continue;
  const d=JSON.parse(fs.readFileSync(path.join(D,f),"utf8"));
  const s=d.sealed||{}; const us=Array.isArray(s.units)?s.units:[];
  const mine=d.unit?us.filter((u)=>key(u)===d.unit):us;
  const missing=mine.filter((u)=>!u||!u.reserve).length;
  console.log("=== "+f);
  console.log("  name          ", JSON.stringify(d.name));
  console.log("  parent        ", JSON.stringify((d.parent||{}).name), (d.parent||{}).id);
  console.log("  unit          ", JSON.stringify(d.unit), JSON.stringify(d.unitName));
  console.log("  counts        ", JSON.stringify(d.counts), "survivors listed:", (d.survivors||[]).length);
  console.log("  check         ", JSON.stringify(d.check));
  console.log("  closing       ", JSON.stringify(d.closing));
  console.log("  ruleSentence  ", JSON.stringify(String(d.ruleSentence||"").slice(0,200)));
  console.log("  steps/back    ", (d.steps||[]).length, (d.backSteps||[]).length, "marks:", (d.marks||[]).length);
  console.log("  warnings      ", JSON.stringify(d.warnings||[]));
  console.log("  release       ", JSON.stringify(d.release), "createdAt", d.createdAt, "nameEditedAt", d.nameEditedAt||null);
  console.log("  replayChecked ", JSON.stringify(d.replayChecked||null).slice(0,160));
  console.log("  sealed units  ", us.length, "matching this unit:", mine.length, "without a reserve:", missing);
  console.log("  -> heading would say:", mine.length&&!missing
    ? ("The sealed window is intact on "+(mine.length===1?"this unit":("all "+mine.length+" unit(s)"))+".")
    : ("No sealed window - "+(d.unit&&!mine.length?("its parent'"'"'s records name no unit "+d.unit):(s.why||"not recorded"))));
  const first=(d.survivors||[])[0];
  console.log("  first survivor", JSON.stringify(first));
}
'
