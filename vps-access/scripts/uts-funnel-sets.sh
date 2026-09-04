#!/usr/bin/env bash
# READ-ONLY. Every Funnel set (stage 4) on the box: its name, which set and
# unit it was cut from, its rule, how many settings it kept, and when. Reads
# the set documents only; nothing started, nothing written.
set -uo pipefail
cd /opt/ultimate-trading-system
node -e '
const s=require("./lib/stages");
const list=s.listFunnelSets();
console.log(`Funnel sets on the box: ${list.length}`);
for (const d of list) {
  console.log(`  ${d.name} (${d.id}) cut ${String(d.createdAt).slice(0,16)} release ${d.release||"-"}`);
  console.log(`     from ${(d.parent||{}).name||"-"} | unit ${d.unitName||"all units together"} | target ${d.target==null?"-":d.target}`);
  console.log(`     kept ${JSON.stringify(d.counts||null)} | steps ${(d.steps||[]).length} | marks ${(d.marks||[]).length}`);
  console.log(`     rule: ${d.ruleSentence||"-"}`);
}
const s3=s.listSets().filter((x)=>x.stage===3).map((x)=>x.name).join(", ");
console.log(`stage 3 sets they could be cut from: ${s3}`);'
