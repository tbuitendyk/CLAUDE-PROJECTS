#!/usr/bin/env bash
# READ-ONLY. THE QUESTION THE D1 MIGRATION TURNS ON: if the rows whose
# `confirm` is not `off` are dropped, does any BLOCK come out empty?
#
# Block indexes are recorded in two places -- per unit on the set document
# (`blocks: [from,to)`, read by unitRows) and per coin in the totals -- so a
# block that disappears moves every index after it. The row store's writer
# cannot write an empty block at all: flush() with nothing buffered writes no
# block. So a set with an all-non-`off` block cannot be migrated this way and
# has to be refused by name rather than guessed at.
#
# Also reports, per set, what stands on it and what derived files it has, so
# the swap knows what to delete and rebuild. Reads only; writes nothing.
set -uo pipefail
node -e '
const fs=require("fs"),path=require("path"),zlib=require("zlib");
const ROOT="/opt/ultimate-trading-system";
const D=path.join(ROOT,"data/batches"), S=path.join(ROOT,"data/stagesets");
const FOUR=["s3-mu0ud8sd-4","s3-mu0vq8jl-5","s3-mu0yp5zl-6","s3-mu0z1opj-7"];
const GOING=["s3-mu0zlurh-8","s3-mu1ikjw9-9"];
const ALL=FOUR.concat(GOING);

for(const id of ALL){
  const dir=path.join(D,id+".rows");
  const meta=path.join(dir,"records.jsonl.gz.meta.json");
  let m=null; try{m=JSON.parse(fs.readFileSync(meta,"utf8"))}catch(e){}
  const gz=path.join(dir,"records.jsonl.gz");
  console.log("\n===== "+id+(FOUR.includes(id)?"   (MIGRATE)":"   (DELETE)"));
  if(!m||!Array.isArray(m.blocks)){console.log("  no block index in the sidecar: "+(m?("keys "+Object.keys(m).join(",")):"no sidecar"));continue}
  console.log("  blocks "+m.blocks.length+"   rows "+m.rows+"   cols "+(m.cols?m.cols.length:"?"));
  const fd=fs.openSync(gz,"r");
  let empties=[], kept=0, worst=null, checked=0;
  for(let i=0;i<m.blocks.length;i++){
    const b=m.blocks[i];
    const buf=Buffer.alloc(b.bytes); fs.readSync(fd,buf,0,b.bytes,b.at);
    let text; try{text=zlib.gunzipSync(buf).toString("utf8")}catch(e){console.log("  block "+i+" unreadable");continue}
    let cols=null, off=0, tot=0;
    for(const line of text.split("\n")){
      if(!line)continue;
      if(line[0]==="{"){try{cols=JSON.parse(line).cols}catch(e){}continue}
      if(!cols)continue;
      let a; try{a=JSON.parse(line)}catch(e){continue}
      tot++;
      const ci=cols.indexOf("confirm");
      const v=ci>=0?String(a[ci]):"off";
      if(v==="off"||v==="undefined"||v==="null")off++;
    }
    checked++; kept+=off;
    if(off===0)empties.push(i);
    if(!worst||off/Math.max(1,tot)<worst.share)worst={i,off,tot,share:off/Math.max(1,tot)};
  }
  fs.closeSync(fd);
  console.log("  blocks read "+checked+"   rows that would be KEPT "+kept+"   dropped "+(m.rows-kept));
  console.log("  blocks that would come out EMPTY: "+(empties.length?empties.length+"  -> "+empties.slice(0,20).join(","):"NONE"));
  if(worst)console.log("  thinnest block: #"+worst.i+"  "+worst.off+" of "+worst.tot+" kept");
}

console.log("\n===== derived files and what stands on these =====");
for(const id of ALL){
  const sibs=fs.readdirSync(S).filter((f)=>f.startsWith(id+"-")||f===id+".json");
  console.log("  "+id+": "+sibs.join(", "));
}
console.log("\n===== every set whose standsOn names one of the six =====");
for(const f of fs.readdirSync(S)){
  if(!f.endsWith(".json"))continue;
  let d=null; try{d=JSON.parse(fs.readFileSync(path.join(S,f),"utf8"))}catch(e){continue}
  const so=d.standsOn&&d.standsOn.id, par=(d.parent&&d.parent.id)||(d.params&&d.params.from)||null;
  for(const id of ALL){
    if(so===id)console.log("  "+f+"  name="+JSON.stringify(d.name)+"  standsOn "+id);
    else if(par===id)console.log("  "+f+"  name="+JSON.stringify(d.name)+"  parent "+id);
  }
}
'
