#!/usr/bin/env bash
# READ-ONLY. Reads ACTUAL ROWS out of the store the rehearsal is writing, so
# whether records are being made is something seen, not something claimed.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts node -e '
const rowstore = require("./lib/rowstore");
const S = "s3-mte0oajo-1__keptfill";
const blocks = rowstore.blocksOf(S, "records") || [];
if (!blocks.length) { console.log("nothing written yet"); process.exit(0); }
const rows = blocks.reduce((a,b)=>a+(b.rows||0),0);
console.log("blocks written so far :", blocks.length);
console.log("rows written so far   :", rows.toLocaleString());
console.log();
// hunt for rows that actually carry figures, newest blocks first
let shown = 0, withFigures = 0, without = 0;
for (let bi = blocks.length - 1; bi >= 0 && shown < 3; bi--) {
  for (const x of rowstore.readBlocks(S, "records", [bi])) {
    const t = x.row.noiseTest;
    if (!Array.isArray(t)) { without++; continue; }
    withFigures++;
    if (shown >= 3) continue;
    shown++;
    console.log("RECORD", shown, "-", String(x.row.label).slice(0, 58));
    console.log("   coin                :", x.row.trade, x.row.geometry);
    console.log("   its REAL test money :", x.row.pnl);
    console.log("   its 10 null figures :", JSON.stringify(t));
    console.log("   its 10 held figures :", JSON.stringify(x.row.noiseHold));
    const nums = t.filter(v => v != null);
    const beat = nums.filter(v => x.row.pnl > v).length;
    console.log("   beat                :", beat, "of", nums.length, "of them");
    console.log();
  }
  if (bi < blocks.length - 6) break;
}
console.log("in the blocks looked at: ", withFigures.toLocaleString(), "rows carry figures,", without.toLocaleString(), "carry none (units this rehearsal is not pricing)");
' 2>&1 | tail -30
