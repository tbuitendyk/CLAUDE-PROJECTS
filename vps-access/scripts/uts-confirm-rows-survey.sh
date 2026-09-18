#!/usr/bin/env bash
# READ-ONLY. What `confirm` actually IS on the rows of the six stage 3 sets
# that carry it. Rows live in data/batches/<runId>.rows/<collection>.jsonl[.gz]
# (lib/rowstore.js). The question D1 turns on: how many DISTINCT values does the
# column take? All `off` and the column can be dropped with nothing changing.
# Both `off` and `sized` and those rows priced DIFFERENT TRADES under one dial,
# so dropping it would collide two rows into one. Reads only; writes nothing.
set -uo pipefail
node -e '
const fs=require("fs"),path=require("path"),zlib=require("zlib"),rl=require("readline");
const D="/opt/ultimate-trading-system/data/batches";
const SETS=["s3-mu0ud8sd-4","s3-mu0vq8jl-5","s3-mu0yp5zl-6","s3-mu0z1opj-7","s3-mu0zlurh-8","s3-mu1ikjw9-9"];
(async()=>{
let all=[];try{all=fs.readdirSync(D)}catch(e){console.log("no "+D);return}
console.log("stores in data/batches: "+all.length);
let grand=0, mixed=[];
for(const id of SETS){
  const dir=path.join(D,id+".rows");
  if(!fs.existsSync(dir)){console.log("\n"+id+": no row store");continue}
  console.log("\n== "+id+" ==");
  for(const f of fs.readdirSync(dir).sort()){
    if(/\.meta\.json$/.test(f))continue;
    const fp=path.join(dir,f);
    const st=fs.statSync(fp); if(!st.isFile())continue;
    let cols=null,ci=-1,n=0;const seen=new Map();
    const raw=fs.createReadStream(fp);
    const stream=f.endsWith(".gz")?raw.pipe(zlib.createGunzip()):raw;
    try{
      const r=rl.createInterface({input:stream,crlfDelay:Infinity});
      for await(const line of r){
        if(!line)continue;
        if(line[0]==="{"){try{const h=JSON.parse(line);if(h.cols){cols=h.cols;ci=cols.indexOf("confirm")}}catch(e){}continue}
        n++;
        if(ci>=0){try{const a=JSON.parse(line);const v=String(a[ci]);seen.set(v,(seen.get(v)||0)+1)}catch(e){}}
      }
    }catch(e){console.log("   "+f+"  could not be read: "+e.message);continue}
    grand+=n;
    const vals=[...seen.entries()].sort((a,b)=>b[1]-a[1]);
    if(vals.length>1)mixed.push(id+"/"+f+" -> "+vals.map(([k,c])=>k+"="+c).join(", "));
    console.log("   "+f.padEnd(34)+(st.size/1048576).toFixed(1).padStart(7)+" MB  rows "+String(n).padStart(8)
      +"  confirm "+(ci>=0?("col "+ci):"absent")
      +(vals.length?("  ["+vals.map(([k,c])=>k+"="+c).join(", ")+"]"):""));
  }
}
console.log("\n=== TOTAL rows across the six: "+grand.toLocaleString()+" ===");
console.log(mixed.length?("MIXED confirm values (dropping the dial would collide rows):\n  "+mixed.join("\n  "))
 :"NO file holds more than one confirm value -- the column can be dropped without colliding anything.");
})();
'
