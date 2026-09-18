#!/usr/bin/env bash
# READ-ONLY. What `confirm` actually IS on the rows of the six stage 3 sets
# that carry it: which row files hold the column, how many rows, and -- the
# question D1 turns on -- how many DISTINCT values it takes. A set whose rows
# are all `off` can have the column dropped and nothing changes. A set holding
# both `off` and `sized` rows priced DIFFERENT TRADES under one dial, and
# dropping it would collide two rows into one. Reads only; writes nothing.
set -uo pipefail
node -e '
const fs=require("fs"),path=require("path"),rl=require("readline");
const D="/opt/ultimate-trading-system/data";
const SETS=["s3-mu0ud8sd-4","s3-mu0vq8jl-5","s3-mu0yp5zl-6","s3-mu0z1opj-7","s3-mu0zlurh-8","s3-mu1ikjw9-9"];
const rows=path.join(D,"stagesets","rows");
let dirs=[];try{dirs=fs.readdirSync(rows)}catch(e){console.log("no rows dir at "+rows);}
console.log("row stores present: "+dirs.length);
(async()=>{
for(const id of SETS){
  const mine=dirs.filter(f=>f.startsWith(id));
  if(!mine.length){console.log("\n"+id+": no row files found");continue}
  console.log("\n== "+id+" ==");
  for(const f of mine.sort()){
    const fp=path.join(rows,f);
    let st;try{st=fs.statSync(fp)}catch(e){continue}
    if(!st.isFile()||!/\.jsonl$|\.ndjson$|\.rows$/.test(f)){ if(!/\.meta\.json$/.test(f)) console.log("   (skip "+f+" "+st.size+"b)"); continue }
    let cols=null,n=0;const seen=new Map();let ci=-1;
    const r=rl.createInterface({input:fs.createReadStream(fp),crlfDelay:Infinity});
    for await(const line of r){
      if(!line)continue;
      if(line[0]==="{"){try{const h=JSON.parse(line);if(h.cols){cols=h.cols;ci=cols.indexOf("confirm")}}catch(e){}continue}
      n++;
      if(ci>=0){try{const a=JSON.parse(line);const v=String(a[ci]);seen.set(v,(seen.get(v)||0)+1)}catch(e){}}
      if(n>4000000)break;
    }
    console.log("   "+f+"  "+(st.size/1048576).toFixed(1)+" MB  rows "+n
      +"  confirm column: "+(ci>=0?"YES at "+ci:"no")
      +(seen.size?("  values "+[...seen.entries()].map(([k,c])=>k+"="+c).join(", ")):""));
  }
}
})();
'
