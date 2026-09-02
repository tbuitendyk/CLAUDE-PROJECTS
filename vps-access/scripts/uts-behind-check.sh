#!/usr/bin/env bash
# READ-ONLY. After 3.46.0: do the stage 1 and stage 2 sets on the box say they
# are behind on the tuning-slice money, and do their tables serve the new
# fields as nothing rather than zero? Nothing is written; nothing is filled.
set -uo pipefail
for S in s1-mtdy6tuq-1 s2-mtdyamtf-1; do
  STAGE=${S:1:1}
  curl -sS -m 60 "http://127.0.0.1:8094/api/stageset/$S/stage$STAGE?from=0&n=2" | node -e '
let raw=""; process.stdin.on("data",(c)=>raw+=c).on("end",()=>{ let d; try{d=JSON.parse(raw);}catch(e){console.log("NOT JSON",raw.slice(0,200));return;}
console.log(process.argv[1], "behind:", d.behind, " total:", d.total, " keys:", Object.keys(d).join(" "));
for (const r of d.rows||[]) console.log("   ", r.trade, r.geometry, "money", r.money, "beatMoney", r.beatMoney, "leadMoney", r.leadMoney, r.money3!==undefined?("money3 "+r.money3+" moneyAll "+r.moneyAll):"");
});' "$S"
done
echo "== release served"; curl -sS -m 10 http://127.0.0.1:8094/healthz | head -c 300; echo
