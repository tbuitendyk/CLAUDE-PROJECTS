#!/usr/bin/env bash
# READ-ONLY. For each stage 3 set: what its sealed window reads as (the bounds
# its parent's records carry) and what test window step 6 would work out from
# it. Pure reads through the box's own code -- no service call, nothing
# started, nothing written.
set -uo pipefail
cd /opt/ultimate-trading-system
node -e '
const s=require("./lib/stages");
for (const d of s.listSets().filter((x)=>x.stage===3)) {
  const doc=s.getSet(d.id);
  const sw=s.sealedWindowOf(doc);
  console.log(`${doc.name} ${doc.id}`);
  console.log(`   layout ${((doc.params||{}).windowLayout)||"-"} | sealed ${sw.sealed} | units ${(sw.units||[]).length} | missing ${sw.missing} | why ${sw.why||"-"}`);
  for (const u of (sw.units||[]).slice(0,6)) {
    const w=s.testWindowOfUnit(u);
    const r=u.reserve;
    console.log(`   ${s.unitNameOf(u).padEnd(26)} reserve ${r?`${r.chunks} chunks ${new Date(r.fromTs).toISOString().slice(0,10)}..${new Date(r.toTs).toISOString().slice(0,10)}`:"NONE"}`);
    console.log(`   ${"".padEnd(26)} test window ${w?`${new Date(w.fromTs).toISOString().slice(0,10)} to ${new Date(w.toTs).toISOString().slice(0,10)} (${Math.round(w.days)} days)`:"cannot be worked out"}`);
  }
  const ex=s.exposureOf(doc,(sw.units||[]),{holdHours:137});
  console.log(`   exposure: stake ${ex.stake} coins ${ex.coins} most at once ${ex.mostAtOnce} window ${ex.window?Math.round(ex.window.days)+" days":"NONE — "+ex.why}`);
}'
