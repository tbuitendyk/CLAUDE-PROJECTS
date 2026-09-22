#!/usr/bin/env bash
# WHAT THE STAGE 3 RECORDS SAY ABOUT ONE COIN AND SHAPE (owner, 2026-09-22:
# "tell me if there's any evidence in stage 3 data for funneling it"). The
# unit's own rows off the record blocks, its money by third off the rebuilt
# numbers, the four Worth walking? comparisons worked out again, what the top
# of the first two thirds' order made in the third, and the real money against
# the scrambled copies. Reads only; nothing is written.
# arg: <stage 3 set id>+<part of the unit's name>+<part>... e.g. s3-x+ZECUSDT+ETCUSDT+daily-1d
set -uo pipefail
ARG="${1:-}"; [ -n "$ARG" ] || { echo "usage: uts-unit-evidence.sh <set id>+<name part>+<name part>..."; exit 1; }
cd /opt/ultimate-trading-system || exit 1
node --max-old-space-size=1500 -e '
const stages = require("./lib/stages"); const rowstore = require("./lib/rowstore"); const RH = require("./lib/rankhold");
const [id, ...parts] = process.argv[1].split("+");
const doc = stages.getSet(id); const t = stages.readTally(id);
if (!t) { console.log("no totalled tables for", id); process.exit(0); }
const units = stages.unitsOfSet(t, id);
const hits = units.filter((u) => parts.every((p) => String(u.name).includes(p)));
if (hits.length !== 1) { console.log(`${hits.length} coins and shapes match ${parts.join(" ")}:`, hits.map((u) => u.name).join("; ")); process.exit(0); }
const u = hits[0];
const day = (ts) => new Date(ts).toISOString().slice(0, 10);
const w = (((doc.windows || {}).units) || {})[u.key]; const tw = w && w.test;
console.log(`set ${doc.name}\n== ${u.name}`);
if (tw) console.log(`   recorded test window: ${tw.chunks} chunks, ${tw.fromTs ? day(tw.fromTs) : "?"} to ${tw.toTs ? day(tw.toTs) : "?"}`);
// the rows, raw off the blocks, the way the board is loaded
const rows = [];
for (const bi of u.blocks) for (const x of rowstore.readBlocks(id, "records", [bi]) || []) { const r = x.row; if (r.trade === u.trade && r.geometry === u.geometry && (r.ctx1 || null) === u.ctx1 && (r.ctx2 || null) === u.ctx2) rows.push(r); }
const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const money = rows.map((r) => num(r.pnl)).filter((v) => v != null);
const sorted = [...money].sort((a, b) => a - b);
const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
const f2 = (v) => (v == null ? "-" : Number(v).toFixed(2));
const pct = (n, of) => (of ? (100 * n / of).toFixed(1) + "%" : "-");
console.log(`\n   rows ${rows.length}, with test money ${money.length}`);
console.log(`   test money: in the money ${money.filter((v) => v > 0).length} (${pct(money.filter((v) => v > 0).length, money.length)}), mean $${f2(mean(money))}, median $${f2(q(0.5))}, worst $${f2(sorted[0])}, best $${f2(sorted[sorted.length - 1])}, top 1% mean $${f2(mean(sorted.slice(Math.floor(0.99 * sorted.length))))}`);
const trades = rows.map((r) => num(r.trades)).filter((v) => v != null).sort((a, b) => a - b);
console.log(`   test trades per setting: median ${trades.length ? trades[Math.floor(trades.length / 2)] : "-"}, fewest ${trades[0] ?? "-"}, most ${trades[trades.length - 1] ?? "-"}, under 10 trades: ${trades.filter((v) => v < 10).length}`);
// the field gate, summed over the rows
const fp = { placed: 0, blockedSign: 0, blockedMin: 0, silent: 0, n: 0 };
for (const r of rows) { const k = r.fp; if (!k) continue; fp.n++; for (const f of ["placed", "blockedSign", "blockedMin", "silent"]) fp[f] += Number(k[f]) || 0; }
console.log(`   field gate over ${fp.n} rows that carry it: placed ${fp.placed}, blocked by sign ${fp.blockedSign}, by minimum ${fp.blockedMin}, silent ${fp.silent}`);
// the real money against the scrambled copies
const K = rows.length && Array.isArray(rows[0].noiseTest) ? rows[0].noiseTest.length : 0;
const copyMean = (list, d) => mean(list.map((r) => num(r.noiseTest && r.noiseTest[d])).filter((v) => v != null));
const beatsOf = (list) => { const real = mean(list.map((r) => num(r.pnl)).filter((v) => v != null)); const cs = Array.from({ length: K }, (_, d) => copyMean(list, d)); return { real, copies: cs, beats: cs.filter((c) => c != null && Math.round(real * 100) > Math.round(c * 100)).length }; };
if (K) {
  const all = beatsOf(rows);
  console.log(`\n   scrambled copies: ${K} per row. Whole board: real mean $${f2(all.real)} beats ${all.beats} of ${K} copies (copies mean ${all.copies.map(f2).join(", ")})`);
  const byMoney = [...rows].filter((r) => num(r.pnl) != null).sort((a, b) => num(b.pnl) - num(a.pnl));
  for (const n of [30, 100, 500]) { const b = beatsOf(byMoney.slice(0, n)); console.log(`   best ${n} by test money: real mean $${f2(b.real)} beats ${b.beats} of ${K} copies (copies: ${b.copies.map(f2).join(", ")})`); }
} else console.log("\n   no scrambled copies on these rows");
// the rebuilt numbers: money by third
const rich = stages.readFunnelRich(id);
const src = rich ? rich.unit(u.key) : null;
if (!src || !Object.keys(src).length) { console.log("\n   no rebuilt numbers for this coin and shape"); process.exit(0); }
const third = rows.map((r) => ({ label: r.label, pnl: num(r.pnl), noiseTest: r.noiseTest, t: (src[r.label] || {}).pnlThirds })).filter((r) => Array.isArray(r.t) && r.t.length >= 3 && r.t.slice(0, 3).every((v) => num(v) != null));
console.log(`\n   settings with money in all three thirds: ${third.length} of ${rows.length}`);
for (let i = 0; i < 3; i++) { const xs = third.map((r) => Number(r.t[i])); console.log(`   third ${i + 1}: in the money ${xs.filter((v) => v > 0).length} (${pct(xs.filter((v) => v > 0).length, xs.length)}), mean $${f2(mean(xs))}, best $${f2(Math.max(...xs))}`); }
console.log(`   in the money in all three thirds: ${third.filter((r) => r.t.slice(0, 3).every((v) => Number(v) > 0)).length}; losing in all three: ${third.filter((r) => r.t.slice(0, 3).every((v) => Number(v) < 0)).length}`);
const h = RH.holdOfUnit(third.map((r) => ({ pnlThirds: r.t })), tw && tw.chunks ? Math.floor(tw.chunks / 3) : null);
console.log(`   the four comparisons worked out again: ${(h.readings || []).map((x) => `${x.key} ${x.hold == null ? "-" : x.hold.toFixed(2)}`).join("   ")}`);
// what the top of the first two thirds order did in the third
const by12 = [...third].sort((a, b) => (Number(b.t[0]) + Number(b.t[1])) - (Number(a.t[0]) + Number(a.t[1])));
const allThird = third.map((r) => Number(r.t[2]));
console.log(`\n   ordered by the first two thirds, what the top made in the third (whole board third mean $${f2(mean(allThird))}, in the money ${pct(allThird.filter((v) => v > 0).length, allThird.length)}):`);
for (const n of [10, 30, 100, 300, 1000]) { const top = by12.slice(0, n); const x3 = top.map((r) => Number(r.t[2])); const whole = top.map((r) => r.pnl).filter((v) => v != null); console.log(`   top ${String(n).padStart(4)}: third mean $${f2(mean(x3))}, in the money ${pct(x3.filter((v) => v > 0).length, x3.length)}, whole test window mean $${f2(mean(whole))}`); }
const bottom = by12.slice(-100).map((r) => Number(r.t[2]));
console.log(`   bottom 100: third mean $${f2(mean(bottom))}, in the money ${pct(bottom.filter((v) => v > 0).length, bottom.length)}`);
console.log(`\n   the top 10 by the first two thirds:`);
for (const r of by12.slice(0, 10)) console.log(`     ${String(r.label).slice(0, 60).padEnd(60)} thirds $${f2(r.t[0])} / $${f2(r.t[1])} / $${f2(r.t[2])}   whole $${f2(r.pnl)}`);
' "$ARG"
