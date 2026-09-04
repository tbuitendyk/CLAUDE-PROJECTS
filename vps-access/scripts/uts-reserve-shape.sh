#!/usr/bin/env bash
# READ-ONLY. What a sealed-window record actually holds, field by field, and
# what type each value is. Pure read, nothing started, nothing written.
set -uo pipefail
cd /opt/ultimate-trading-system
node -e '
const s=require("./lib/stages");
const doc=s.getSet("s3-mtl42g1m-3");
const sw=s.sealedWindowOf(doc);
for (const u of (sw.units||[]).slice(0,3)) {
  const r=u.reserve;
  console.log(u.trade, u.geometry, "reserve:", JSON.stringify(r));
  if (r) for (const k of Object.keys(r)) console.log("   ", k, "=", JSON.stringify(r[k]), "type", typeof r[k]);
  console.log("   testWindowOfUnit:", JSON.stringify(s.testWindowOfUnit(u)));
}'
