#!/usr/bin/env bash
# READ-ONLY. Every record set the running release flags REBUILD REQUIRED, with
# its reasons, read through the service's own code; and a count of those it
# does not flag. Reads files only.
set -uo pipefail
cd /opt/ultimate-trading-system
timeout 120 node -e '
const s=require("./lib/stages");
console.log("release "+require("./package.json").version);
const all=s.listSets().filter((x)=>x.stage>=3&&!x.exam);
let n=0;
for (const row of all) { const d=s.getSet(row.id); const f=s.rebuildOf(d); if(!f) continue; n++;
  console.log(`- ${d.id} stage ${d.stage} ${d.kind||""} ${String(d.name||"").slice(0,60)} :: ${f.reasons.map((r)=>r.key).join(", ")}`); }
console.log(`flagged ${n} of ${all.length} stage 3 and Stage 4 sets`);'
