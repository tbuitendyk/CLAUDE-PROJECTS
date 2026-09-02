#!/usr/bin/env bash
# READ-ONLY. The gate question asked PER COIN and per coin-and-shape instead of
# on the blend: for each unit and each gate value, the mean real test money,
# the mean of each kept figure, and how many of the ten kept copies the real
# beats. Straight from the records. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts node -e '
const rowstore = require("./lib/rowstore");
const S = "s3-mte0oajo-1"; const K = 10; const t0 = Date.now();
const acc = new Map();   // key -> { n, pnl, nt[K], ntN[K] }
const add = (key, r) => { let a = acc.get(key); if (!a) { a = { n: 0, pnl: 0, nt: new Float64Array(K), ntN: new Int32Array(K) }; acc.set(key, a); }
  a.n++; a.pnl += r.pnl; const t = r.noiseTest || []; for (let d = 0; d < K; d++) if (t[d] != null) { a.nt[d] += t[d]; a.ntN[d]++; } };
for (const b of (rowstore.blocksOf(S, "records") || []).map((_, i) => i)) for (const x of rowstore.readBlocks(S, "records", [b])) {
  const r = x.row; add(`unit|${r.trade} ${r.geometry}|${r.gate}`, r); add(`coin|${r.trade}|${r.gate}`, r); }
const line = (label, a) => { const m = Array.from(a.nt, (v, d) => a.ntN[d] ? v / a.ntN[d] : null); const real = a.pnl / a.n;
  const beats = m.filter((v) => v != null && real > v).length;
  return `${label.padEnd(30)} ${String(a.n).padStart(7)} ${real.toFixed(2).padStart(9)}   check ${Math.min(...m).toFixed(2).padStart(8)}..${Math.max(...m).toFixed(2).padEnd(8)} beats ${beats} of ${K}${beats === K ? "  <== beats every copy" : ""}`; };
console.log("PER COIN (all shapes together)"); console.log("coin / gate".padEnd(30), "records".padStart(7), "avg test".padStart(9));
for (const [k, a] of [...acc.entries()].filter(([k]) => k.startsWith("coin|")).sort()) console.log(line(k.slice(5).replace("|", " / "), a));
console.log(); console.log("PER COIN AND SHAPE (one unit)");
for (const [k, a] of [...acc.entries()].filter(([k]) => k.startsWith("unit|")).sort()) console.log(line(k.slice(5).replace("|", " / "), a));
console.log("elapsed", ((Date.now() - t0) / 1000) | 0, "s");
' 2>&1 | tail -60
