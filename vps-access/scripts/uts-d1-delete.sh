#!/usr/bin/env bash
# DELETE #3b AND #3c, AND THE STAGE 4 SET STANDING ON #3c (owner order,
# 2026-09-18: "delete #3b and #3c ... GO NOW!", said after being told the
# Stage 4 set standing on #3c was part of the cost).
#
# Through the service's own delete door, which is the one the owner's own
# press uses. It REFUSES a set another set names as its parent, so the child
# goes first -- that order is the system's, not a choice made here. Every step
# is previewed first and the preview is printed, so what went is on the record.
#
# THIS DELETES RECORDS AND CANNOT BE UNDONE. It names exactly three ids and
# touches nothing else.
set -uo pipefail
B=http://127.0.0.1:8094
busy=$(curl -sS -m 20 "$B/api/stage-gate/status" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d={};try{d=JSON.parse(r)}catch(e){console.log("unknown");return}console.log(d.blockedBy||"none")})')
echo "box busy: $busy"
if [ "$busy" != "none" ]; then echo "REFUSING: something is going on the box"; exit 1; fi

show() { node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d;try{d=JSON.parse(r)}catch(e){console.log("   (no answer) "+r.slice(0,200));return}
  if(d.error){console.log("   ERROR "+d.error);return}
  if(d.preview){console.log(`   would go: ${JSON.stringify(d.name)}  stage ${d.stage}  ${Number(d.rows).toLocaleString()} rows  ${(d.bytes/1048576).toFixed(1)} MB`);return}
  console.log(`   DELETED ${JSON.stringify(d.name)}  ${Number(d.rows).toLocaleString()} rows  ${(d.bytes/1048576).toFixed(1)} MB`)})'; }

# the child first: the delete door refuses a set another set names as its parent
for id in s4-mu1unm6c-6 s3-mu0zlurh-8 s3-mu1ikjw9-9; do
  echo
  echo "===== $id"
  echo "-- what would go"
  curl -sS -m 120 -X POST "$B/api/stageset/$id/delete" -H 'content-type: application/json' -d '{}' | show
  echo "-- deleting"
  curl -sS -m 600 -X POST "$B/api/stageset/$id/delete" -H 'content-type: application/json' -d "{\"confirm\":\"$id\"}" | show
done

echo
echo "== the record sets on the box now =="
curl -sS -m 60 "$B/api/stagesets" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const d=JSON.parse(r);
  console.log("  "+d.sets.length+" set(s)");
  for(const s of d.sets.filter(x=>x.stage>=3))console.log("   stage "+s.stage+"  "+s.id+"  "+JSON.stringify(s.name))})'
