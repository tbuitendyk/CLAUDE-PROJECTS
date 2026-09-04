#!/usr/bin/env bash
# READ-ONLY. Every step the walk recorded on each Stage 4 set, in order, so the
# ranges the OWNER chose before step 5 replaced them can be read back.
set -euo pipefail
cd /opt/ultimate-trading-system
node -e '
const fs=require("fs"),path=require("path");
const D="/opt/ultimate-trading-system/data/stagesets";
for (const f of fs.readdirSync(D)) {
  if (!f.startsWith("s4-") || !f.endsWith(".json")) continue;
  const d=JSON.parse(fs.readFileSync(path.join(D,f),"utf8"));
  console.log("=== "+f+"  "+JSON.stringify(d.name));
  console.log("  keys on the doc: "+Object.keys(d).join(", "));
  console.log("  rule: "+JSON.stringify(d.rule));
  console.log("  steps ("+(d.steps||[]).length+"):");
  for (const s of (d.steps||[])) console.log("    n"+s.n+"  "+JSON.stringify(s.what)+" -> "+JSON.stringify(s.chose)+(s.survivors==null?"":("  survivors "+s.survivors)));
  console.log("  backSteps ("+(d.backSteps||[]).length+"):");
  for (const b of (d.backSteps||[])) console.log("    "+b.from+" -> "+b.to+(b.why?("  "+b.why):""));
  console.log("  marks: "+JSON.stringify((d.marks||[]).map((m)=>m.key+(m.detail?(":"+m.detail):""))));
}
'
