#!/usr/bin/env bash
# READ-ONLY. What each stage 3 set on the box says its units hold after the
# per-unit fold (3.52.0): the plan's unitSettings and pricings, the fold
# stamp and the record count, read off the set documents. It NEVER reads a
# set's tables or the Funnel: that read is what starts the fold, and the
# owner drives the interface (owner order, 2026-09-04: "I DRIVE THE
# INTERFACE. ALWAYS"). Nothing written.
set -uo pipefail
B=http://127.0.0.1:8094
S=${1:-s3-mtl42g1m-3}
echo "== engine =="; curl -sS -m 20 "$B/api/version" 2>/dev/null | head -c 200; echo
echo "== every stage 3 set: what its units hold =="
curl -sS -m 25 "$B/api/stagesets" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const d=JSON.parse(r);const sets=(d.sets||d||[]).filter(s=>s.stage===3);for(const s of sets){const p=s.plan||{};console.log("  ",s.name,s.id,"status",s.status,"engine",s.engineVersion||(s.params||{}).engineVersion||"-");console.log("     settings",p.settings,"units",p.units,"pricings",p.pricings==null?"(not yet stamped)":p.pricings,"folded",JSON.stringify(p.foldedPerUnit||null));if(Array.isArray(p.unitSettings))console.log("     unitSettings",JSON.stringify(p.unitSettings));console.log("     counts",JSON.stringify(s.counts||null),"tallyError",s.tallyError||null);}})'
