#!/usr/bin/env bash
# READ-ONLY. What order the units actually sit in across the store's blocks.
# The fill assumed one unit at a time, in order, and the store says otherwise.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts node --max-old-space-size=2048 -e '
const rowstore = require("./lib/rowstore");
const id = "s3-mte0oajo-1";
const blocks = rowstore.blocksOf(id, "records") || [];
const runs = [];           // [unit, firstBlock, lastBlock, rows]
let cur = null;
let mixed = 0;
for (let bi = 0; bi < blocks.length; bi++) {
  const us = new Set();
  let n = 0;
  for (const x of rowstore.readBlocks(id, "records", [bi])) { us.add(x.row.u); n++; }
  if (us.size > 1) mixed++;
  const u = us.size === 1 ? [...us][0] : "MIXED:" + [...us].sort((a,b)=>a-b).join("+");
  if (cur && cur.u === u) { cur.last = bi; cur.rows += n; }
  else { cur = { u, first: bi, last: bi, rows: n }; runs.push(cur); }
}
console.log("blocks:", blocks.length, " blocks holding more than one unit:", mixed);
console.log("stretches of consecutive blocks, one line each:");
for (const r of runs) console.log("  unit", String(r.u).padStart(8), "blocks", String(r.first).padStart(5), "-", String(r.last).padStart(5), " rows", r.rows.toLocaleString());
console.log();
const seen = new Map();
for (const r of runs) seen.set(r.u, (seen.get(r.u)||0)+1);
const repeats = [...seen.entries()].filter(([,c])=>c>1);
console.log("units appearing in more than one stretch:", repeats.length ? repeats.map(([u,c])=>u+" x"+c).join(", ") : "none");
' 2>&1 | tail -40
