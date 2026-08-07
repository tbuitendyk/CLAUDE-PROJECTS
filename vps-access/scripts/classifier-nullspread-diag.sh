#!/usr/bin/env bash
# classifier-nullspread-diag.sh -- READ-ONLY. Tests the adversarial audit's
# decisive claim: that the null distribution is too NARROW, making every arm
# look extreme. Computes, per ordering, the true mean/sd of the 19 null skills
# and the real arm's z against them. A correctly-calibrated null should place
# real arms mostly INSIDE its spread; symmetric extremes on sibling arms of the
# same window are the signature of an under-dispersed null.
set -uo pipefail
node -e '
const fs=require("fs");
const d=JSON.parse(fs.readFileSync("/opt/general-classifier/data/batches/bracketlab-20260807-085851-triples-confirm-c-ltc-sharpen.json","utf8"));
const key=(r)=>[r.trade,r.ctx1,r.ctx2].join("+");
const skill=(r)=>{const h=r.holdout;if(!h||h.pnl==null)return null;const l=h.holds?h.holds.alwaysLong:null;return l==null?null:h.pnl-l;};
const idx={};
for(const r of (d.replication||[])){const e=(idx[key(r)]||={real:null,nulls:{}});
  if(r.nullDealSeed==null){if(!e.real)e.real=r;} else if(!e.nulls[r.nullDealSeed])e.nulls[r.nullDealSeed]=r;}
console.log("ordering                    real$   nullMean   nullSd    z     beat   rawReal");
const zs=[];
for(const [k,v] of Object.entries(idx)){
  if(!v.real)continue;
  const rs=skill(v.real); const ns=Object.values(v.nulls).map(skill).filter(x=>x!=null);
  if(!ns.length)continue;
  const m=ns.reduce((a,b)=>a+b,0)/ns.length;
  const sd=Math.sqrt(ns.reduce((a,b)=>a+(b-m)*(b-m),0)/(ns.length-1));
  const z=(rs-m)/sd; zs.push([k,z]);
  const beat=ns.filter(x=>rs>x).length;
  console.log(k.padEnd(26), rs.toFixed(2).padStart(8), m.toFixed(2).padStart(9), sd.toFixed(2).padStart(8),
    z.toFixed(2).padStart(7), (beat+"/"+ns.length).padStart(7), (v.real.holdout.pnl).toFixed(2).padStart(9));
}
console.log("\nSYMMETRY CHECK (an information-removal null should not place sibling arms at equal-and-opposite extremes):");
zs.sort((a,b)=>b[1]-a[1]);
console.log("  max z", zs[0][0], zs[0][1].toFixed(2), "| min z", zs[zs.length-1][0], zs[zs.length-1][1].toFixed(2),
  "| sum", zs.reduce((a,b)=>a+b[1],0).toFixed(2));
const f=Math.max(Math.abs(zs[0][1]),Math.abs(zs[zs.length-1][1]));
console.log("  if null sd is understated by factor F, all |z| divide by F. F needed to bring every arm inside |z|<2:", (f/2).toFixed(2));
console.log("  candidate z at F=2.59 (sqrt of 161h/4d-period overlap):", (zs.find(x=>x[0].startsWith("LTCUSDT"))[1]/2.59).toFixed(2));
'
