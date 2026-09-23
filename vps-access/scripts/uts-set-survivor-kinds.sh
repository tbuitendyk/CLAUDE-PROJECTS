#!/usr/bin/env bash
# READ-ONLY. One Stage 4 record set's survivors counted by kind: how many
# enter at market and how many on breakout, how many with a trailing stop,
# and how many read the field -- taken from the settings the stage 3 set
# holds for them, not from their names. Reads files only.
set -uo pipefail
ID="${1:-}"
case "$ID" in ""|*[!A-Za-z0-9._-]*) echo "usage: uts-set-survivor-kinds.sh <set id>" >&2; exit 2 ;; esac
cd /opt/ultimate-trading-system
ID="$ID" timeout 240 node -e '
const s=require("./lib/stages");
(async()=>{
  const doc=s.getSet(process.env.ID); if(!doc){console.log("no such set");return;}
  const join=await s.funnelVerifyJoin(doc);
  const shape=s.relaunchShapeOf(join.parent);
  const want=new Set((doc.survivors||[]).map((x)=>x.label));
  const sts=shape.settings.filter((st)=>want.has(st.label));
  const k={market:0,breakout:0,other:0,trailing:0,field:0,noField:0};
  for(const st of sts){const e=st.entry||"breakout"; if(e==="market")k.market++; else if(e==="breakout")k.breakout++; else k.other++; if((st.trailMult??null)!=null)k.trailing++; if(st.field)k.field++; else k.noField++;}
  console.log(`${String(doc.name).slice(0,90)}: ${want.size} survivors, ${sts.length} settings found | market ${k.market} breakout ${k.breakout} other ${k.other} | trailing stop ${k.trailing} | read the field ${k.field}, do not ${k.noField}`);
})().catch((e)=>console.log("THREW: "+e.message));'
