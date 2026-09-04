#!/usr/bin/env bash
# READ-ONLY. Does a Stage 4 set's rule still give back the settings it wrote
# down, read on its parent's own unit board? And how long does building that
# board take, since the new Stage 4 view pays for it once per open.
set -euo pipefail
cd /opt/ultimate-trading-system
node -e '
const fs=require("fs"),path=require("path");
const stages=require("/opt/ultimate-trading-system/lib/stages");
const D="/opt/ultimate-trading-system/data/stagesets";
(async () => {
for (const f of fs.readdirSync(D)) {
  if (!f.startsWith("s4-") || !f.endsWith(".json")) continue;
  const d=JSON.parse(fs.readFileSync(path.join(D,f),"utf8"));
  const pid=(d.parent||{}).id;
  console.log("=== "+f+"  parent "+pid+"  unit "+d.unit);
  const t0=Date.now();
  let out=null;
  try { out=await stages.funnelRead(pid,{step:1,unit:d.unit||"all",rule:d.rule,barPct:(d.check||{}).barPct}); }
  catch(e){ console.log("  read failed: "+e.message); continue; }
  const ms=Date.now()-t0;
  if (!out) { console.log("  no tables on the parent ("+ms+"ms)"); continue; }
  if (out.waiting||out.totalling) { console.log("  busy: "+JSON.stringify(out.waiting||out.totalling)); continue; }
  console.log("  board read in "+ms+"ms; the unit holds "+out.of+" settings");
  console.log("  the rule keeps "+out.survivors+" of them; the set wrote down "+(d.counts||{}).survivors);
  console.log("  -> "+(out.survivors===(d.counts||{}).survivors ? "SAME as the record" : "DIFFERENT from the record"));
  console.log("  rebuilt numbers on the parent: "+out.rebuilt);
  const rich=path.join(D,String(pid).replace(/[^A-Za-z0-9._-]+/g,"_")+".funnelrich.json");
  if (fs.existsSync(rich)) { const x=JSON.parse(fs.readFileSync(rich,"utf8"));
    const want=(d.survivors||[]).map((s)=>s.label);
    const held=want.filter((l)=>(x.settings||{})[l]).length;
    const k=want.find((l)=>(x.settings||{})[l]);
    console.log("  rebuilt for "+Object.keys(x.settings||{}).length+" setting(s); "+held+" of the "+want.length+" survivors are among them (v"+x.v+", release "+x.release+")");
    if (k) console.log("  one of them: "+JSON.stringify((x.settings||{})[k]).slice(0,400));
  } else console.log("  no rebuilt numbers beside this parent");
}
})().catch((e)=>{console.log("FAILED "+e.message); process.exit(1);});
'
