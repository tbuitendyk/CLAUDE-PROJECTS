#!/usr/bin/env bash
# READ-ONLY. The gate means recomputed from the records the way the table
# defines them: per setting, the mean of its per-coin means (each coin one
# vote); then the mean over the settings of each gate. Kept figures the same
# way, each rounded to cents per setting as the table does. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts node -e '
const rowstore = require("./lib/rowstore");
const S = "s3-mte0oajo-1"; const K = 10; const t0 = Date.now();
const per = new Map();     // label -> { gate, coins: Map(trade -> { n, pnl, nt[K], ntN[K] }) }
for (const b of (rowstore.blocksOf(S, "records") || []).map((_, i) => i)) for (const x of rowstore.readBlocks(S, "records", [b])) {
  const r = x.row; let s = per.get(r.label); if (!s) { s = { gate: r.gate, coins: new Map() }; per.set(r.label, s); }
  let c = s.coins.get(r.trade); if (!c) { c = { n: 0, pnl: 0, nt: new Float64Array(K), ntN: new Int32Array(K) }; s.coins.set(r.trade, c); }
  c.n++; c.pnl += r.pnl; const t = r.noiseTest || []; for (let d = 0; d < K; d++) if (t[d] != null) { c.nt[d] += t[d]; c.ntN[d]++; }
}
const byG = new Map();
for (const s of per.values()) {
  const cells = [...s.coins.values()];
  const avgTest = cells.reduce((a, c) => a + c.pnl / c.n, 0) / cells.length;
  const nt = Array.from({ length: K }, (_, d) => { let o = 0, seen = 0; for (const c of cells) if (c.ntN[d]) { o += c.nt[d] / c.ntN[d]; seen++; } return seen ? Math.round((o / seen) * 100) / 100 : null; });
  let g = byG.get(s.gate); if (!g) { g = { n: 0, s: 0, nt: new Float64Array(K) }; byG.set(s.gate, g); }
  g.n++; g.s += avgTest; for (let d = 0; d < K; d++) g.nt[d] += nt[d];
}
console.log("gate".padEnd(13), "settings".padStart(9), "avg test $".padStart(11), "  check per copy, per-coin weighting, cents per setting");
for (const [gate, g] of [...byG.entries()].sort()) { const m = Array.from(g.nt, (v) => v / g.n); console.log(String(gate).padEnd(13), String(g.n).padStart(9), (g.s / g.n).toFixed(3).padStart(11), " ", m.map((v) => v.toFixed(2)).join(" "), " lo..hi", Math.min(...m).toFixed(2) + ".." + Math.max(...m).toFixed(2)); }
console.log("elapsed", ((Date.now() - t0) / 1000) | 0, "s");
' 2>&1 | tail -8
