#!/usr/bin/env bash
# classifier-confirm-e-read.sh -- READ-ONLY reader for run E (committee-
# preserving null, engine 1.43.0). Prints the INSTRUMENT CHECK FIRST: null
# trade counts must now bracket the real arm's, not sit below it. Only if that
# holds does the stamped R1 verdict mean anything.
set -uo pipefail
node -e '
const fs=require("fs");
const dir="/opt/general-classifier/data/batches";
const f=fs.readdirSync(dir).filter(x=>x.includes("confirm-e")&&x.endsWith(".json")).sort().pop();
const d=JSON.parse(fs.readFileSync(dir+"/"+f,"utf8"));
console.log("doc:",d.id,d.status);
const key=(r)=>[r.trade,r.ctx1,r.ctx2].join("+");
const skill=(r)=>{const h=r.holdout;if(!h||h.pnl==null)return null;const l=h.holds?h.holds.alwaysLong:null;return l==null?null:h.pnl-l;};
const idx={};
for(const r of (d.replication||[])){const e=(idx[key(r)]||={real:null,nulls:[]});
  if(r.nullDealSeed==null){if(!e.real)e.real=r;} else e.nulls.push(r);}
console.log("\n== INSTRUMENT CHECK (QC 81): do null arms now trade as often as the arm they judge? ==");
let ok=true;
for(const [k,v] of Object.entries(idx)){
  if(!v.real||!v.real.holdout)continue;
  const rt=v.real.holdout.trades;
  const nt=v.nulls.map(r=>r.holdout&&r.holdout.trades).filter(x=>x!=null);
  if(!nt.length)continue;
  const lo=Math.min(...nt), hi=Math.max(...nt);
  const brackets = rt>=lo && rt<=hi;
  if(!brackets) ok=false;
  console.log("  "+k.padEnd(24),"real",String(rt).padStart(4),"| nulls",String(lo).padStart(4)+".."+String(hi).padStart(4),
    "|", brackets?"OK (real inside null range)":"STILL OUTSIDE — verdict void");
}
console.log("  overall:", ok?"PASS — the null is now a fair opponent on participation":"FAIL — do not read the verdict");
console.log("\n== R1 VERDICT (only meaningful if the check above passed) ==");
console.log("ordering                    real$   nullMean   nullSd    z     beat   rawReal  verdict");
for(const [k,v] of Object.entries(idx)){
  if(!v.real)continue;
  const rs=skill(v.real); const ns=v.nulls.map(skill).filter(x=>x!=null);
  if(!ns.length)continue;
  const m=ns.reduce((a,b)=>a+b,0)/ns.length;
  const sd=Math.sqrt(ns.reduce((a,b)=>a+(b-m)*(b-m),0)/(ns.length-1));
  const beat=ns.filter(x=>rs>x).length;
  console.log(k.padEnd(26), rs.toFixed(2).padStart(8), m.toFixed(2).padStart(9), sd.toFixed(2).padStart(8),
    ((rs-m)/sd).toFixed(2).padStart(7), (beat+"/"+ns.length).padStart(7), v.real.holdout.pnl.toFixed(2).padStart(9),
    "  "+(k.startsWith("LTCUSDT")?((beat===ns.length?"PASS":"FAIL")+" (candidate)"):((beat===ns.length?"pass":"fail")+" (sibling)")));
}
'
