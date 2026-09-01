#!/usr/bin/env bash
# READ-ONLY. What the kept-scramble fill actually left behind. Checks the things
# that could be WRONG, not just the happy path. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
echo "== leftovers =="
ls -d data/batches/*__keptfill.rows 2>/dev/null && echo "  ^^ a scratch store is still there" || echo "  no scratch store left behind (good)"
ls data/stagesets/*-tally* 2>/dev/null | head -3 || echo "  no totals file (good: they must rebuild)"
df -h /opt | tail -1
echo
sudo -u uts node -e '
const stages = require("./lib/stages");
const rowstore = require("./lib/rowstore");
const id = "s3-mte0oajo-1";
const doc = stages.getSet(id);
console.log("status   :", doc.status);
console.log("progress :", doc.progress);
console.log("keepN    :", (doc.params||{}).keepN);
console.log("boardNull:", JSON.stringify(doc.boardNull));
const blocks = rowstore.blocksOf(id, "records") || [];
const rows = blocks.reduce((a,b)=>a+(b.rows||0),0);
console.log("blocks   :", blocks.length, "(was 3658)");
console.log("rows     :", rows.toLocaleString(), "(was 5,248,320)");
let bytes = 0; for (const b of blocks) bytes += b.bytes||0;
console.log("on disk  :", (bytes/1e9).toFixed(3), "GB (was 0.133)");
// EVERY UNIT, not just the first: a fill that stopped part way would leave
// later units without the columns and the row count would still look right.
const spread = [0, Math.floor(blocks.length/4), Math.floor(blocks.length/2), Math.floor(3*blocks.length/4), blocks.length-1];
const seenUnits = new Set(); let bad = 0, withT = 0, withH = 0, checked = 0;
let sample = null;
for (const bi of spread) {
  for (const x of rowstore.readBlocks(id, "records", [bi])) {
    checked++; seenUnits.add(x.row.u);
    const t = x.row.noiseTest, h = x.row.noiseHold;
    if (Array.isArray(t) && t.length === 10) withT++; else bad++;
    if (Array.isArray(h) && h.length === 10) withH++;
    if (!sample && Array.isArray(t)) sample = x.row;
  }
}
console.log();
console.log("rows checked across 5 blocks spread through the store:", checked.toLocaleString());
console.log("units seen in them  :", [...seenUnits].sort((a,b)=>a-b).join(", "));
console.log("with 10 test figures:", withT.toLocaleString(), bad ? ("BAD: " + bad + " without") : "(all of them)");
console.log("with 10 held figures:", withH.toLocaleString());
if (sample) {
  console.log();
  console.log("one row:", sample.label.slice(0,60), "| coin", sample.trade);
  console.log("  real test money :", sample.pnl);
  console.log("  its 10 luck test:", JSON.stringify(sample.noiseTest));
  console.log("  real held money :", sample.holdout && sample.holdout.pnl);
  console.log("  its 10 luck held:", JSON.stringify(sample.noiseHold));
  const t = sample.noiseTest.filter(v=>v!=null);
  const flat = new Set(t).size === 1;
  console.log("  the ten differ from each other:", flat ? "NO - all identical, that would be wrong" : "yes");
}
' 2>&1 | tail -32
