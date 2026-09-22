#!/usr/bin/env bash
# WHY A COIN AND SHAPE MADE NOTHING FOR WHOLE PARTS OF ITS TEST WINDOW (owner,
# 2026-09-22: "look at why they supposedly never traded and tell me if the data
# is accurate or corrupt"). For every coin and shape whose four comparisons on
# Worth walking? came back unreadable: the window the run recorded, the parent
# set's votes across it, the field pair's speaking days across it, and Table
# 3.B's own rows with the gate's counts. Reads only; nothing is written.
set -uo pipefail
ID="${1:-}"; [ -n "$ID" ] || { echo "usage: uts-rankhold-zero.sh <stage 3 set id>"; exit 1; }
cd /opt/ultimate-trading-system || exit 1
curl -sS --max-time 30 "http://127.0.0.1:8094/api/funnel/$ID/rankhold?atLeast=&onHowMany=4&fewestRanked=30&fewestChunks=40" > /tmp/uts-rh3.json
node --max-old-space-size=1500 -e '
const fs = require("fs");
const stages = require("./lib/stages"); const rowstore = require("./lib/rowstore"); const FG = require("./lib/fieldgate");
const id = process.argv[1];
const d = JSON.parse(fs.readFileSync("/tmp/uts-rh3.json", "utf8"));
if (!d.result) { console.log("no reading in hand:", JSON.stringify(d).slice(0, 160)); process.exit(0); }
const zero = d.result.units.filter((u) => u.bar.why === "no boundary on this coin and shape could be read");
const doc = stages.getSet(id); const p = doc.params || {};
console.log(`set ${doc.name}: quorum by ${p.agreeRule} (permuted: ${p.agreePermuteRule || "-"}), field ${p.fieldId || "none"}, pairs named ${Object.keys(p.fieldPairs || {}).length}`);
const shape = stages.relaunchShapeOf(doc);
const keyOf = (r) => `${r.trade}|${r.ctx1 || ""}|${r.ctx2 || ""}|${r.geometry}`;
const day = (ts) => new Date(ts).toISOString().slice(0, 10);
const coins = stages.stage3Coins(id, { offset: 0, limit: 5000 });
const rowsAll = (coins && coins.rows) || [];
for (const u of zero) {
  const rec = shape.records.find((r) => keyOf(r) === u.unit);
  console.log(`\n== ${u.name}`);
  if (!rec) { console.log("   no record for this unit in the launch shape"); continue; }
  const w = ((doc.windows || {}).units || {})[u.unit];
  const t = w && w.test;
  if (t) console.log(`   recorded test window: ${t.chunks} chunks, ${t.fromTs ? day(t.fromTs) : "?"} to ${t.toTs ? day(t.toTs) : "?"}`); else console.log("   no window recorded for this unit; keys on the record:", Object.keys(w || {}).join(","));
  // the parent votes this unit was priced from
  const votes = rowstore.readBlocks(shape.parent.id, "votes", Array.from({ length: rec.blocks.votes[1] - rec.blocks.votes[0] }, (_, i) => rec.blocks.votes[0] + i)).map((x) => x.row).filter((r) => r.u === rec.u);
  const test = votes.filter((v) => v.w === 0).sort((a, b) => a.ts - b.ts);
  const n = test.length, c1 = Math.floor(n / 3), c2 = Math.floor((2 * n) / 3);
  const flat = (x) => (Array.isArray(x) ? x.flatMap(flat) : [x]);
  const spoke = (v) => flat(v.m).some((x) => x != null && Number.isFinite(Number(x)) && Number(x) !== 0);
  if (test[0]) console.log(`   a vote row: keys ${Object.keys(test[0]).join(",")}; m = ${JSON.stringify(test[0].m).slice(0, 100)}; a last-third row m = ${JSON.stringify((test[n - 1] || {}).m).slice(0, 100)}`);
  const part = (from, to) => { const s = test.slice(from, to); return `${s.length} periods ${s.length ? day(s[0].ts) + " to " + day(s[s.length - 1].ts) : ""}, ${s.filter(spoke).length} with any member vote`; };
  console.log(`   parent votes on test: ${n} periods (members ${rec.specs.length})`);
  console.log(`      first third:  ${part(0, c1)}`);
  console.log(`      second third: ${part(c1, c2)}`);
  console.log(`      last third:   ${part(c2, n)}`);
  // the field pair
  let fp = null; try { fp = stages.fieldPayloadFor(doc, rec); } catch (e) { console.log("   field: " + e.message); }
  if (fp) {
    const days = Array.isArray(fp.days) ? fp.days : (FG.daysFromColumns ? FG.daysFromColumns(fp.days) : []); const speaking = days.filter((x) => x && x.speaking && x.sign);
    if (!Array.isArray(fp.days)) console.log(`   field days come as columns: ${Object.keys(fp.days || {}).join(",")}`);
    const inThird = (from, to) => { if (!test.length) return "-"; const a = test[from] ? test[from].ts : null, b = test[Math.max(from, to - 1)] ? test[Math.max(from, to - 1)].ts : null; return speaking.filter((x) => x.ts >= a && x.ts <= b).length; };
    console.log(`   field pair ${fp.key}: ${days.length} days, ${speaking.length} speaking with a sign, ${days.length ? day(days[0].ts) + " to " + day(days[days.length - 1].ts) : ""}, full at ${fp.fullAt ? day(fp.fullAt) : "?"}`);
    console.log(`      speaking days inside the test thirds: ${inThird(0, c1)} / ${inThird(c1, c2)} / ${inThird(c2, n)}`);
  } else console.log("   field: none for this unit");
  // Table 3.B rows for this unit
  const mine = rowsAll.filter((r) => keyOf(r) === u.unit);
  console.log(`   Table 3.B rows: ${mine.length}`);
  for (const r of mine.slice(0, 10)) {
    const f = r.fieldTotals || {};
    console.log(`      ${String(r.label || r.setting || "").slice(0, 44).padEnd(44)} test $${r.avgTest == null ? "-" : Number(r.avgTest).toFixed(2)} trades/rec ${r.avgTestTrades == null ? "-" : Number(r.avgTestTrades).toFixed(1)}  placed ${f.placed ?? "-"} blocked by sign ${f.blockedSign ?? "-"} by minimum ${f.blockedMin ?? "-"} silent ${f.silent ?? "-"}`);
  }
}
' "$ID"
