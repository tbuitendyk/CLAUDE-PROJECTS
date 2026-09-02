#!/usr/bin/env bash
# READ-ONLY. Where does the gap between the records and the tables come from?
# (1) the gate means recomputed from the totals FILE the Funnel reads;
# (2) three `always` rows of that file beside their own raw records;
# (3) is the setting index the table groups on one-to-one with the name?
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts node -e '
const fs = require("fs"), zlib = require("zlib");
const stages = require("./lib/stages"); const rowstore = require("./lib/rowstore");
const S = "s3-mte0oajo-1"; const t0 = Date.now();
const t = stages.parseTally(zlib.gunzipSync(fs.readFileSync("data/stagesets/" + S + "-tally.json.gz")));
console.log("tally v", t.v, " ranked rows:", t.ranked.length, " coin rows:", t.coins.length, " builtAt:", t.builtAt, " release:", t.release || t.engine || "-");
const byG = new Map();
for (const r of t.ranked) { const g = String(r.gate); let a = byG.get(g); if (!a) { a = { n: 0, s: 0, nt: new Float64Array(10), ntN: new Int32Array(10), coins: new Map() }; byG.set(g, a); }
  a.n++; a.s += r.avgTest; for (let d = 0; d < 10; d++) if (r.noiseTest && r.noiseTest[d] != null) { a.nt[d] += r.noiseTest[d]; a.ntN[d]++; }
  a.coins.set(r.coins, (a.coins.get(r.coins) || 0) + 1); }
console.log("== (1) from the totals file, per gate: rows, mean avgTest, mean noiseTest[0..2], coins per row ==");
for (const [g, a] of [...byG.entries()].sort()) console.log("  " + g.padEnd(12), a.n, (a.s / a.n).toFixed(3), Array.from(a.nt.slice(0, 3), (v, d) => (v / a.ntN[d]).toFixed(2)).join(" "), JSON.stringify(Object.fromEntries(a.coins)));
const picks = t.ranked.filter((r) => r.gate === "always").filter((_, i) => i % 60000 === 0).slice(0, 3);
console.log("== (2) three always rows of the file ==");
for (const r of picks) console.log("  si", r.si, "|", String(r.label).slice(0, 64), "| coins", r.coins, "avgTest", r.avgTest, "noiseTest", JSON.stringify(r.noiseTest), "avgTrades", r.avgTrades);
const want = new Map(picks.map((r) => [r.label, []]));
const siLabels = new Map(); let rows = 0;
const blocks = rowstore.blocksOf(S, "records") || [];
for (let bi = 0; bi < blocks.length; bi++) for (const x of rowstore.readBlocks(S, "records", [bi])) { const r = x.row; rows++;
  if (want.has(r.label)) want.get(r.label).push({ bi, si: r.si, trade: r.trade, geometry: r.geometry, pnl: r.pnl, nt: (r.noiseTest || []).slice(0, 3) });
  let s = siLabels.get(r.si); if (!s) { s = new Set(); siLabels.set(r.si, s); } s.add(r.label); }
console.log("== their raw records ==");
for (const [label, recs] of want) { const m = recs.reduce((a, c) => a + c.pnl, 0) / recs.length; console.log("  " + label.slice(0, 64) + " -> " + recs.length + " records, mean pnl " + m.toFixed(3)); for (const c of recs) console.log("     block", c.bi, "si", c.si, c.trade, c.geometry, "pnl", c.pnl.toFixed(3), "nt", JSON.stringify(c.nt)); }
console.log("== (3) setting index vs name over the whole store ==");
const dist = new Map(); for (const s of siLabels.values()) dist.set(s.size, (dist.get(s.size) || 0) + 1);
console.log("  distinct si:", siLabels.size, " labels per si ->", JSON.stringify(Object.fromEntries([...dist.entries()].sort((a, b) => a[0] - b[0]))), " rows", rows, " elapsed", ((Date.now() - t0) / 1000) | 0, "s");
' 2>&1 | tail -40
