#!/usr/bin/env bash
# READ-ONLY. Every run the old sweep machinery left on this box, with the gate
# list it swept -- to size what carries the always gate on disk. Nothing is written.
set -uo pipefail
curl -sS -m 60 "http://127.0.0.1:8094/api/batches" | node -e '
let raw=""; process.stdin.on("data",(c)=>raw+=c).on("end",()=>{
  let d; try { d=JSON.parse(raw); } catch (e) { console.log("NOT JSON:", raw.slice(0,200)); return; }
  const list=Array.isArray(d)?d:(d.batches||d.runs||[]);
  console.log("runs on disk:", list.length);
  const byKind={};
  for (const b of list) { const k=b.kind||"?"; byKind[k]=(byKind[k]||0)+1; }
  console.log("by kind:", JSON.stringify(byKind));
  for (const b of list.slice(0,40)) {
    const g=(b.params&&b.params.gates)||null;
    console.log((b.id||"").padEnd(26),(b.kind||"").padEnd(14),(b.status||"").padEnd(9),(b.createdAt||"").slice(0,10),"gates:",g?JSON.stringify(g):"-");
  }
});'
