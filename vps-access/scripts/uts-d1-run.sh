#!/usr/bin/env bash
# THE D1 MIGRATION, RUN ON THE BOX (owner order, 2026-09-18: "delete #3b and
# #3c, migrate the other four ... GO NOW!").
#
# Goes through the service's own two doors, the same ones the press on Boards
# uses -- so what happens here is exactly what happens when the owner presses
# it, and there is no second path into the records. Refuses to start if
# anything heavy is going. Each set is previewed, then done, then reported.
#
# This script migrates the FOUR. It deletes nothing.
set -uo pipefail
B=http://127.0.0.1:8094
busy=$(curl -sS -m 20 "$B/api/stage-gate/status" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d={};try{d=JSON.parse(r)}catch(e){console.log("unknown");return}console.log(d.blockedBy||"none")})')
echo "box busy: $busy"
if [ "$busy" != "none" ]; then echo "REFUSING: something is going on the box"; exit 1; fi

echo
echo "== what the box says still needs it =="
curl -sS -m 60 "$B/api/d1/needs" | node -e '
let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{
  const d=JSON.parse(r);
  for(const s of d.sets){
    console.log(`  ${s.id}  ${JSON.stringify(s.name)}`);
    console.log(`     blocks ${s.blocks}  rows ${s.rows}  keep ${s.keep}  drop ${s.drop}  would-be-empty blocks ${s.emptied}  can=${s.can}`);
    console.log(`     values: ${s.values.map(v=>v.value+"="+v.rows).join(", ")}`);
    if(!s.can)console.log(`     why not: ${s.why}`);
  }
  console.log(`  ${d.sets.length} set(s)`);
})'

for id in s3-mu0ud8sd-4 s3-mu0vq8jl-5 s3-mu0yp5zl-6 s3-mu0z1opj-7; do
  echo
  echo "===== $id"
  echo "-- preview (no id typed back, so nothing happens)"
  curl -sS -m 120 -X POST "$B/api/d1/migrate" -H 'content-type: application/json' -d "{\"id\":\"$id\"}" \
  | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const d=JSON.parse(r);
    if(d.error){console.log("   ERROR "+d.error);return}
    console.log(`   preview=${d.preview} ${JSON.stringify(d.name)} blocks ${d.blocks} rows ${d.rows} keep ${d.keep} drop ${d.drop} emptied ${d.emptied}`)})'
  echo "-- doing it"
  curl -sS -m 600 -X POST "$B/api/d1/migrate" -H 'content-type: application/json' -d "{\"id\":\"$id\",\"confirm\":\"$id\"}" \
  | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const d=JSON.parse(r);
    if(d.error){console.log("   ERROR "+d.error);return}
    console.log(`   migrated=${d.migrated} kept ${d.kept} dropped ${d.dropped} blocks ${d.blocks} emptied ${d.emptied} loosened ${d.loosened}`);
    console.log(`   derived: ${(d.derived||[]).join("; ")||"nothing"}`)})'
done

echo
echo "== what still needs it now =="
curl -sS -m 60 "$B/api/d1/needs" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const d=JSON.parse(r);
  console.log("  "+(d.sets.length?d.sets.map(s=>`${s.id} (${s.drop} to drop, can=${s.can})`).join("\n  "):"nothing"))})'
