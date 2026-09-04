#!/usr/bin/env bash
# READ-ONLY. How many dial pairs are still worth gridding on the owner's real
# board, and what one pair costs with every kept scrambled copy read beside it.
set -euo pipefail
cd /opt/ultimate-trading-system
node -e '
const fs=require("fs"),path=require("path");
const stages=require("/opt/ultimate-trading-system/lib/stages");
const F=require("/opt/ultimate-trading-system/lib/funnel");
const S4=require("/opt/ultimate-trading-system/lib/funnelset");
const D="/opt/ultimate-trading-system/data/stagesets";
(async () => {
  const f=fs.readdirSync(D).find((x)=>x.startsWith("s4-")&&x.endsWith(".json"));
  const doc=JSON.parse(fs.readFileSync(path.join(D,f),"utf8"));
  const pid=(doc.parent||{}).id;
  const out=await stages.funnelSetRows(doc.id,{});
  console.log("set: "+doc.name);
  for (const [label, rule] of [["the rule the OWNER built", doc.userRule], ["nothing fixed yet", {ranges:{},allowed:{},floors:{}}]]) {
    const t0=Date.now();
    const read=await stages.funnelRead(pid,{step:1,unit:doc.unit,rule});
    const rows=read.survivors;
    console.log("\n== under "+label+": "+rows.toLocaleString()+" settings survive  (board read "+(Date.now()-t0)+"ms)");
  }
  // the survivors under the owner-built rule, and the pairs still griddable
  const r2=await stages.funnelRead(pid,{step:3,unit:doc.unit,rule:doc.userRule,dialA:"agreeBar",dialB:"agreePct"});
  const k=(doc.check||{}).k||0;
  console.log("kept scrambled copies: "+k);
  const g=r2.reading||{};
  console.log("one pair, real grid + "+(g.checkGrids||[]).length+" check grids: squares "+(g.squares||0));
  // time one whole pair the way the list would
  const t1=Date.now();
  const again=await stages.funnelRead(pid,{step:3,unit:doc.unit,rule:doc.userRule,dialA:"tHours",dialB:"dMult"});
  console.log("one pair, timed on a warm board: "+(Date.now()-t1)+"ms");
  console.log("survivors under the owner rule: "+again.survivors.toLocaleString());
})().catch((e)=>{console.log("FAILED "+e.message); process.exit(1);});
'
