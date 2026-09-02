#!/usr/bin/env bash
# READ-ONLY. An INDEPENDENT recount of what the Funnel's step 2 shows for
# `gate`, from the records on disk and not from any table: every row of the
# store, grouped by gate -- the real test money and each kept figure averaged
# directly -- plus a check that every setting carries the same units, which is
# what makes a row-level average the same weighting as the table's per-setting
# average. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts node -e '
const rowstore = require("./lib/rowstore");
const S = "s3-mte0oajo-1"; const K = 10; const t0 = Date.now();
const blocks = rowstore.blocksOf(S, "records") || [];
const gates = new Map();                       // gate -> { rows, labels:Set, pnl, nt[K], same[K] }
const perLabel = new Map();                    // label -> { n, mask }
const tradeIdx = new Map();
let rows = 0, noKept = 0;
for (let bi = 0; bi < blocks.length; bi++) {
  for (const x of rowstore.readBlocks(S, "records", [bi])) {
    const r = x.row; rows++;
    const g = String(r.gate);
    let a = gates.get(g);
    if (!a) { a = { rows: 0, labels: new Set(), pnl: 0, nt: new Float64Array(K), ntN: new Int32Array(K), same: new Int32Array(K) }; gates.set(g, a); }
    a.rows++; a.labels.add(r.label); a.pnl += r.pnl;
    const t = r.noiseTest;
    if (!Array.isArray(t)) noKept++;
    else for (let d = 0; d < K; d++) { if (t[d] != null) { a.nt[d] += t[d]; a.ntN[d]++; if (Math.round(t[d] * 100) === Math.round(r.pnl * 100)) a.same[d]++; } }
    if (!tradeIdx.has(r.trade)) tradeIdx.set(r.trade, tradeIdx.size);
    let p = perLabel.get(r.label);
    if (!p) { p = { n: 0, mask: 0 }; perLabel.set(r.label, p); }
    p.n++; p.mask |= (1 << tradeIdx.get(r.trade));
  }
  if (bi % 400 === 0) process.stderr.write(`block ${bi} of ${blocks.length}, ${rows} rows, ${((Date.now() - t0) / 1000) | 0}s\n`);
}
console.log("rows read:", rows, " blocks:", blocks.length, " rows with no kept figures:", noKept, " elapsed:", ((Date.now() - t0) / 1000) | 0, "s");
console.log("coins:", [...tradeIdx.keys()].join(", "));
// every setting carries the same units?
const shapes = new Map();
for (const p of perLabel.values()) { const k = p.n + "|" + p.mask.toString(2); shapes.set(k, (shapes.get(k) || 0) + 1); }
console.log("settings:", perLabel.size, " (records per setting | which coins) ->", JSON.stringify(Object.fromEntries(shapes)));
console.log();
console.log("gate".padEnd(13), "settings".padStart(9), "records".padStart(9), "avg test $".padStart(11), "  check per copy (mean of kept figure d over all records)      identical-to-real per copy");
for (const [g, a] of [...gates.entries()].sort()) {
  const means = Array.from(a.nt, (v, d) => a.ntN[d] ? v / a.ntN[d] : null);
  const lo = Math.min(...means), hi = Math.max(...means);
  console.log(g.padEnd(13), String(a.labels.size).padStart(9), String(a.rows).padStart(9), (a.pnl / a.rows).toFixed(3).padStart(11), " ", means.map((m) => m.toFixed(2)).join(" "), " lo..hi", lo.toFixed(2) + ".." + hi.toFixed(2), " | ", Array.from(a.same).join(" "));
}
' 2>&1 | tail -20
