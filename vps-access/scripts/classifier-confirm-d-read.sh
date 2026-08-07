#!/usr/bin/env bash
# classifier-confirm-d-read.sh -- READ-ONLY reader for run D (corrected null,
# engine 1.42.0). Computes the rule stamped before launch: the LTC-led triple
# must beat ALL 19 draws (p-floor 0.05). Prints raw money beside skill, and
# the per-arm z so the corrected null's dispersion can be compared with the
# defective one (run C: candidate z +3.30, siblings -4.04 and -1.40).
set -uo pipefail
node -e '
const fs=require("fs");
const dir="/opt/general-classifier/data/batches";
const f=fs.readdirSync(dir).filter(x=>x.includes("confirm-d")&&x.endsWith(".json")).sort().pop();
const d=JSON.parse(fs.readFileSync(dir+"/"+f,"utf8"));
console.log("doc:",d.id,d.status,"| engine:",(d.params||{}).engineVersion||d.engineVersion||"(see release)","| rows:",(d.replication||[]).length);
const key=(r)=>[r.trade,r.ctx1,r.ctx2].join("+");
const skill=(r)=>{const h=r.holdout;if(!h||h.pnl==null)return null;const l=h.holds?h.holds.alwaysLong:null;return l==null?null:h.pnl-l;};
const idx={};
for(const r of (d.replication||[])){const e=(idx[key(r)]||={real:null,nulls:{}});
  if(r.nullDealSeed==null){if(!e.real)e.real=r;} else if(!e.nulls[r.nullDealSeed])e.nulls[r.nullDealSeed]=r;}
console.log("\nordering                    real$   nullMean   nullSd    z     beat   rawReal  verdict");
for(const [k,v] of Object.entries(idx)){
  if(!v.real)continue;
  const rs=skill(v.real); const ns=Object.values(v.nulls).map(skill).filter(x=>x!=null);
  if(!ns.length)continue;
  const m=ns.reduce((a,b)=>a+b,0)/ns.length;
  const sd=Math.sqrt(ns.reduce((a,b)=>a+(b-m)*(b-m),0)/(ns.length-1));
  const beat=ns.filter(x=>rs>x).length;
  const pass=beat===ns.length;
  console.log(k.padEnd(26), rs.toFixed(2).padStart(8), m.toFixed(2).padStart(9), sd.toFixed(2).padStart(8),
    ((rs-m)/sd).toFixed(2).padStart(7), (beat+"/"+ns.length).padStart(7), v.real.holdout.pnl.toFixed(2).padStart(9),
    "  "+(k.startsWith("LTCUSDT")?(pass?"PASS":"FAIL")+" (candidate, p-floor 0.05)":(pass?"pass":"fail")+" (sibling, context)"));
}
'
