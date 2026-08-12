#!/usr/bin/env bash
# pilot-preview-check.sh -- READ-ONLY: compute the decision preview on the deployed
# classifier and print it (the plan for the upcoming entry). No orders, no state.
set -uo pipefail
cd /opt/general-classifier || { echo "no app"; exit 1; }
PILOT_SOCKS=127.0.0.1:1080 node -e '
const ps=require("./lib/pilotsignal");
(async()=>{ const p=await ps.computePreview(Date.now());
  console.log(JSON.stringify(p,null,2)); })().catch(e=>{console.error("FAIL",e&&e.message);process.exit(1);});
'
