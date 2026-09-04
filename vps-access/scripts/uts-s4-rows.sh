#!/usr/bin/env bash
# READ-ONLY. Are the settings a Stage 4 set wrote down still on its parent's
# board? If not, the new Stage 4 table shows rows with no numbers, and the
# screen has to say so rather than look empty.
set -euo pipefail
cd /opt/ultimate-trading-system
node -e '
const fs=require("fs"),path=require("path"),zlib=require("zlib");
const D="/opt/ultimate-trading-system/data/stagesets";
for (const f of fs.readdirSync(D)) {
  if (!f.startsWith("s4-") || !f.endsWith(".json")) continue;
  const d=JSON.parse(fs.readFileSync(path.join(D,f),"utf8"));
  const pid=(d.parent||{}).id;
  console.log("=== "+f+"  parent "+pid+"  unit "+d.unit);
  let t=null;
  try { t=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(D,pid+"-tally.json.gz")))); }
  catch(e){ console.log("  no tally on disk: "+e.message); continue; }
  const ranked=new Set((t.ranked||[]).map((r)=>r.label));
  const want=(d.survivors||[]).map((s)=>s.label);
  const missing=want.filter((l)=>!ranked.has(l));
  console.log("  tally built "+t.builtAt+"  ranked rows "+(t.ranked||[]).length);
  console.log("  survivors "+want.length+"  not on the blended table: "+missing.length);
  if (missing.length) console.log("  first missing: "+JSON.stringify(missing.slice(0,3)));
  // and does the rule still give the same list, read on the blended table
  const one=(t.ranked||[]).find((r)=>r.label===want[0]);
  console.log("  a survivor row on the blend: "+JSON.stringify(one&&{label:one.label,avgTest:one.avgTest,avgHold:one.avgHold,avgTrades:one.avgTrades,beat:one.beat,pairs:one.pairs,avgLead:one.avgLead,members:one.members,maxDrawdown:one.maxDrawdown}));
  const rich=path.join(D,pid.replace(/[^A-Za-z0-9._-]+/g,"_")+".funnelrich.json");
  if (fs.existsSync(rich)) { const x=JSON.parse(fs.readFileSync(rich,"utf8")); const n=Object.keys(x.settings||{}).length;
    const held=want.filter((l)=>(x.settings||{})[l]).length;
    console.log("  rebuilt numbers on disk for "+n+" setting(s); "+held+" of the "+want.length+" survivors are among them (v"+x.v+", release "+x.release+")");
    const k=want.find((l)=>(x.settings||{})[l]);
    if (k) console.log("  one of them: "+JSON.stringify((x.settings||{})[k]).slice(0,300));
  } else console.log("  no rebuilt numbers beside this parent");
}
'
