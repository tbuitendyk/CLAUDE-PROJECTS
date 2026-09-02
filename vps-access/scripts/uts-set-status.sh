#!/usr/bin/env bash
# READ-ONLY. What the tables of the stage 3 set answer right now -- ready,
# totalling (with the phase and the count), waiting, or failed -- the same ask
# Boards makes every few seconds. Asking is what starts a pending job (the
# strip of the always gate, then the totalling), exactly as opening the set
# on Boards would. Nothing else is written.
set -uo pipefail
S=s3-mte0oajo-1
curl -sS -m 60 "http://127.0.0.1:8094/api/stageset/$S/ranked?from=0&n=1" | node -e '
let raw=""; process.stdin.on("data",(c)=>raw+=c).on("end",()=>{
  let d; try { d=JSON.parse(raw); } catch (e) { console.log("NOT JSON:", raw.slice(0,300)); return; }
  if (d.totalling) { const t=d.totalling; console.log("WORKING:", t.phase || "totalling the tables", "-", t.done, "of", t.total, t.word || "parts"); return; }
  if (d.waiting) { console.log("WAITING:", d.waiting); return; }
  if (d.failed) { console.log("FAILED:", d.failed); return; }
  console.log("READY: total", d.total, "of", d.of, "rows:", (d.rows||[]).length);
});'
echo "== the set document, briefly =="
node -e '
const fs=require("fs"); const d=JSON.parse(fs.readFileSync("/opt/ultimate-trading-system/data/stagesets/s3-mte0oajo-1.json","utf8"));
console.log("gates stamp:", JSON.stringify(d.gates||null), " settings:", d.plan&&d.plan.settings, " rows:", d.counts&&d.counts.rows, " drops:", JSON.stringify((d.drops||[]).map(x=>({at:x.at,settings:x.settings,rows:x.rows,why:x.why}))), " tallyError:", d.tallyError||null);
' 2>&1 | head -3
