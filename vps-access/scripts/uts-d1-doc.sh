#!/usr/bin/env bash
# READ-ONLY. What a stage 3 set DOCUMENT holds about `confirm`, so the D1
# migration knows what has to say something different once two thirds of the
# rows are gone (RULE NINE: a record says what it is, in today's words). Dumps
# the smallest of the four whole, and just the confirm-shaped parts of the big
# one. Writes nothing.
set -uo pipefail
node -e '
const fs=require("fs"),path=require("path");
const S="/opt/ultimate-trading-system/data/stagesets";
const small="s3-mu0ud8sd-4", big="s3-mu0vq8jl-5";
const d=JSON.parse(fs.readFileSync(path.join(S,small+".json"),"utf8"));
console.log("== "+small+" top-level keys ==");
console.log("  "+Object.keys(d).join(", "));
console.log("\n== its params ==");
console.log(JSON.stringify(d.params,null,1));
console.log("\n== records: "+(Array.isArray(d.records)?d.records.length:"not an array")+" ==");
if(Array.isArray(d.records)&&d.records.length){
  console.log(JSON.stringify(d.records[0],null,1).slice(0,2000));
}
console.log("\n== anything else naming confirm, anywhere in the doc ==");
const hits=[];
(function walk(o,p){
  if(o===null||typeof o!=="object")return;
  for(const k of Object.keys(o)){
    if(/confirm/i.test(k))hits.push(p+"."+k+" = "+JSON.stringify(o[k]).slice(0,120));
    walk(o[k],p+"."+k);
  }
})(d,"");
console.log(hits.length?"  "+hits.slice(0,40).join("\n  "):"  none");
const b=JSON.parse(fs.readFileSync(path.join(S,big+".json"),"utf8"));
console.log("\n== "+big+" params.permuteConfirm="+JSON.stringify(b.params&&b.params.permuteConfirm)
  +"  params.confirm="+JSON.stringify(b.params&&b.params.confirm)
  +"  records="+(Array.isArray(b.records)?b.records.length:"?")+" ==");
if(Array.isArray(b.records)&&b.records.length){
  const r=b.records[0];
  console.log("  a record: keys "+Object.keys(r).join(", "));
  console.log("  blocks on it: "+JSON.stringify(r.blocks));
}
console.log("\n== the four, side by side ==");
for(const id of ["s3-mu0ud8sd-4","s3-mu0vq8jl-5","s3-mu0yp5zl-6","s3-mu0z1opj-7"]){
  const x=JSON.parse(fs.readFileSync(path.join(S,id+".json"),"utf8"));
  console.log("  "+id+"  status="+x.status+"  release="+x.release+"  rows="+x.rows
    +"  permuteConfirm="+JSON.stringify(x.params&&x.params.permuteConfirm)
    +"  records="+(Array.isArray(x.records)?x.records.length:"?"));
}
'
