#!/usr/bin/env bash
# READ-ONLY. Did the D1 migration do what it said on the owner's four sets?
# Walks every block of each one and reports: how many blocks, how many rows,
# which confirm values survive, how many blocks are empty, and whether the
# sidecar's row count agrees with a real walk of the file. Also names what is
# left in data/batches that should not be (a beside store, an aside store).
set -uo pipefail
node -e '
const fs=require("fs"),path=require("path"),zlib=require("zlib");
const ROOT="/opt/ultimate-trading-system";
const D=path.join(ROOT,"data/batches"), S=path.join(ROOT,"data/stagesets");
const FOUR=["s3-mu0ud8sd-4","s3-mu0vq8jl-5","s3-mu0yp5zl-6","s3-mu0z1opj-7"];
const WANT={ "s3-mu0ud8sd-4":{blocks:3,rows:1}, "s3-mu0vq8jl-5":{blocks:39,rows:6708},
             "s3-mu0yp5zl-6":{blocks:3,rows:1}, "s3-mu0z1opj-7":{blocks:45,rows:15} };
let bad=0;
for(const id of FOUR){
  const dir=path.join(D,id+".rows");
  const gz=path.join(dir,"records.jsonl.gz");
  const m=JSON.parse(fs.readFileSync(gz+".meta.json","utf8"));
  const fd=fs.openSync(gz,"r");
  let walked=0, empty=0; const vals=new Map();
  for(let i=0;i<m.blocks.length;i++){
    const b=m.blocks[i];
    const buf=Buffer.alloc(b.bytes); fs.readSync(fd,buf,0,b.bytes,b.at);
    let text; try{text=zlib.gunzipSync(buf).toString("utf8")}catch(e){console.log("  "+id+" block "+i+" UNREADABLE");bad++;continue}
    let cols=null,n=0;
    for(const line of text.split("\n")){
      if(!line)continue;
      if(line[0]==="{"){try{cols=JSON.parse(line).cols}catch(e){}continue}
      if(!cols)continue;
      let a; try{a=JSON.parse(line)}catch(e){continue}
      n++; const ci=cols.indexOf("confirm");
      const v=ci>=0?String(a[ci]):"(no column)";
      vals.set(v,(vals.get(v)||0)+1);
    }
    walked+=n; if(n===0)empty++;
  }
  fs.closeSync(fd);
  const want=WANT[id];
  const doc=JSON.parse(fs.readFileSync(path.join(S,id+".json"),"utf8"));
  const sibs=fs.readdirSync(S).filter((f)=>f.startsWith(id+"-"));
  const ok = m.blocks.length===want.blocks && walked===want.rows && m.rows===walked
    && vals.size===1 && vals.has("off") && doc.params.permuteConfirm===false;
  if(!ok)bad++;
  console.log((ok?"ok  ":"BAD ")+id+"  "+JSON.stringify(doc.name));
  console.log("      blocks "+m.blocks.length+" (want "+want.blocks+")   rows walked "+walked+" (want "+want.rows+")   sidecar says "+m.rows);
  console.log("      empty blocks "+empty+"   confirm values: "+[...vals.entries()].map(([k,c])=>k+"="+c).join(", "));
  console.log("      document permuteConfirm="+JSON.stringify(doc.params.permuteConfirm)+" confirm="+JSON.stringify(doc.params.confirm));
  console.log("      siblings left: "+(sibs.length?sibs.join(", "):"none (totals and agreement table were thrown away)"));
}
console.log("\n== anything left standing that should not be ==");
const leftovers=fs.readdirSync(D).filter((f)=>/\.d1beside\.rows$|\.rows\.d1old$/.test(f));
console.log("  "+(leftovers.length?leftovers.join(", "):"nothing"));
console.log("\n== every store in data/batches now ==");
for(const f of fs.readdirSync(D).sort()) {
  let sz=0; try{ for(const g of fs.readdirSync(path.join(D,f))) sz+=fs.statSync(path.join(D,f,g)).size; }catch(e){}
  console.log("  "+f.padEnd(34)+(sz/1048576).toFixed(1).padStart(8)+" MB");
}
console.log(bad?("\n"+bad+" SET(S) NOT AS EXPECTED"):"\nall four are as expected");
'
