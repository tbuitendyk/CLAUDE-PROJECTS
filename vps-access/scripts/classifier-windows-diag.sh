#!/usr/bin/env bash
# classifier-windows-diag.sh -- READ-ONLY: print the window layout, month
# span and ranking basis of the discovery board and the confirm runs, so
# leakage between SELECTION and VERDICT can be checked from the artifacts
# rather than assumed.
set -uo pipefail
node -e '
const fs=require("fs"),path=require("path");
const dir="/opt/general-classifier/data/batches";
const ids=["bracketlab-20260805-193433-real",
           "bracketlab-20260807-022033-triples-confirm-a-ltc-xrp-bch",
           "bracketlab-20260807-085851-triples-confirm-c-ltc-sharpen"];
for (const id of ids) {
  const p=path.join(dir,id+".json");
  if(!fs.existsSync(p)){console.log(id,"MISSING");continue;}
  const d=JSON.parse(fs.readFileSync(p,"utf8"));
  const q=d.params||{};
  console.log("\n== "+id);
  console.log("  windowLayout:", q.windowLayout, "| holdout flag:", q.holdout, "| months:", q.startMonth||"(all)", "..", q.endMonth||"(all)", "| allLoaded:", q.allLoaded);
  console.log("  declared:", JSON.stringify(q.declared), "| labelShiftReps:", q.labelShiftReps, "| feePerLeg:", q.feePerLeg);
  const r=(d.replication||[]).find(x=>x.nullDealSeed==null&&x.trade==="LTCUSDT");
  if(r&&r.holdout) console.log("  LTC row windows:", JSON.stringify(r.windowStamps||r.holdout.windowStamps||"(none on row)"));
  const L=(d.leaders||[])[0];
  if(L) console.log("  leader[0] stamps:", JSON.stringify(L.windowStamps||"(none)"));
  if(d.windows) console.log("  doc.windows:", JSON.stringify(d.windows));
}
'
