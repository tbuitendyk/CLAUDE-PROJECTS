#!/usr/bin/env bash
# READ-ONLY. The Funnel's answers for XRPUSDT weekly-8d on the newest stage 3
# set, under the rule the owner built (gate = directional): step 1, step 2 on
# gate, step 2 on tHours. Prints only the shape of each answer. Nothing written.
set -uo pipefail
S=${1:-s3-mtl42g1m-3}; U="XRPUSDT|||weekly-8d"
B=http://127.0.0.1:8094
ask() { curl -sS -m 200 -H 'content-type: application/json' -d "$1" "$B/api/funnel/$S/read" | node -e '
let raw="";process.stdin.on("data",c=>raw+=c).on("end",()=>{const d=JSON.parse(raw);
 if(d.error){console.log("  ERROR",d.error);return;} if(d.waiting||d.totalling){console.log("  WAIT",d.waiting||JSON.stringify(d.totalling));return;}
 const r=d.reading||{};console.log("  step",d.step,"survive",d.survivors,"of",d.of,"why:",JSON.stringify(r.why||null),"dials:",(r.dials||[]).length,"groups:",(r.groups||[]).length,"shape:",r.shape||null,"rec:",JSON.stringify((r.rec||{}).recommend||null),"sentence:",JSON.stringify(d.ruleSentence||null).slice(0,120));});'; }
R='{"ranges":{},"allowed":{"gate":["directional"]},"floors":{}}'
echo "step 1 under the rule:"; ask "{\"step\":1,\"unit\":\"$U\",\"rule\":$R,\"target\":200,\"barPct\":75}"
echo "step 2, dial gate:";     ask "{\"step\":2,\"dial\":\"gate\",\"unit\":\"$U\",\"rule\":$R,\"target\":200,\"barPct\":75}"
echo "step 2, dial tHours:";   ask "{\"step\":2,\"dial\":\"tHours\",\"unit\":\"$U\",\"rule\":$R,\"target\":200,\"barPct\":75}"
echo "step 2, no dial:";       ask "{\"step\":2,\"unit\":\"$U\",\"rule\":$R,\"target\":200,\"barPct\":75}"
