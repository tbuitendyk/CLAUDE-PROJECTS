#!/usr/bin/env bash
# READ-ONLY. Every record set's release as the set itself stamps it -- the
# engineVersion at the top of its record -- read straight off disk through the
# engine's own getSet, grouped by first digit, with the Stage 4 sets' recorded
# parent release beside the parent's own stamp. Nothing written.
set -uo pipefail
cd /opt/ultimate-trading-system
node -e '
const s=require("./lib/stages");
const sets=s.listSets().map((x)=>s.getSet(x.id)).filter(Boolean);
const by={};
for (const d of sets) { const k=`stage ${d.stage} · first digit ${String(d.engineVersion||"none").split(".")[0]}`; (by[k]=by[k]||[]).push(`${d.name} (${d.engineVersion||"none"})`); }
for (const [k,v] of Object.entries(by).sort()) { console.log(`${k}: ${v.length}`); for (const n of v.slice(0,40)) console.log(`   ${n}`); }
console.log("stage 4 sets: recorded parent release vs the stamp on the parent itself");
for (const d of sets.filter((x)=>x.stage===4)) { const p=s.getSet((d.parent||{}).id)||{}; console.log(`   ${String(d.name).slice(0,60)}: recorded ${(d.parent||{}).release??"none"} · parent stamps ${p.engineVersion??"none"}`); }'
