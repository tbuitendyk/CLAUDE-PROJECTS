#!/usr/bin/env bash
# READ-ONLY. What keeping N scrambles per row would cost: disk free, the size of
# the stage 3 row store as it stands, the real width of one stored row, and how
# long the original run took. Starts nothing, writes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
echo "== disk =="
df -h /opt | tail -1
echo
echo "== stage 3 row store =="
ls -la data/batches/ 2>/dev/null | grep -i 's3-' | head
echo
sudo -u uts node -e '
const fs = require("fs");
const path = require("path");
const stages = require("./lib/stages");
const rowstore = require("./lib/rowstore");
const id = "s3-mte0oajo-1";
const doc = stages.readSet ? stages.readSet(id) : null;
const p = (doc && doc.params) || {};
console.log("set params: nullN =", p.nullN, " fee =", p.fee, " carry =", p.carry);
console.log("plan:", JSON.stringify((doc && doc.plan) || {}));
const perf = (doc && doc.perf) || {};
console.log("perf:", JSON.stringify(perf));
if (perf.elapsedMs) console.log("the run took", (perf.elapsedMs/3600000).toFixed(2), "hours");
const blocks = rowstore.blocksOf(id, "records") || [];
console.log("blocks:", blocks.length);
let bytes = 0; for (const b of blocks) bytes += b.bytes || 0;
console.log("row store on disk:", (bytes/1e9).toFixed(2), "GB gzipped");
const rows = blocks.reduce((a,b)=>a+(b.rows||0),0);
console.log("rows:", rows.toLocaleString());
// ONE ACTUAL ROW, so the width of a new column is measured and not guessed.
const one = rowstore.readBlocks(id, "records", [0]);
if (one && one.length) {
  const r = one[0].row;
  const line = JSON.stringify(r);
  console.log("one stored row is", line.length, "chars of JSON");
  console.log("its fields:", Object.keys(r).join(", "));
  console.log("pnl as stored:", JSON.stringify(r.pnl), " holdout:", JSON.stringify(r.holdout));
}
' 2>&1 | tail -25
