#!/usr/bin/env bash
# READ-ONLY. The column list of the records collection of the four sets being
# migrated, and every collection each set actually has -- so the migration
# knows it is rewriting one collection and not silently leaving a second one
# describing rows that are gone. Writes nothing.
set -uo pipefail
node -e '
const fs=require("fs"),path=require("path");
const D="/opt/ultimate-trading-system/data/batches";
for(const id of ["s3-mu0ud8sd-4","s3-mu0vq8jl-5","s3-mu0yp5zl-6","s3-mu0z1opj-7"]){
  const dir=path.join(D,id+".rows");
  const files=fs.readdirSync(dir).sort();
  console.log("\n== "+id+" ==");
  console.log("  files: "+files.join(", "));
  const m=JSON.parse(fs.readFileSync(path.join(dir,"records.jsonl.gz.meta.json"),"utf8"));
  console.log("  cols ("+m.cols.length+"): "+m.cols.join(", "));
  console.log("  confirm at "+m.cols.indexOf("confirm")+"   blocks at "+m.cols.indexOf("blocks"));
}
'
