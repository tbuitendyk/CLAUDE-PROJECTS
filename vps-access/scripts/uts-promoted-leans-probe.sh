#!/usr/bin/env bash
# uts-promoted-leans-probe.sh -- READ-ONLY. Every promoted row on the box with
# the lean it carries, which row holds the lean for each coin and chunk shape
# under a walk chain (promotedLeans), which rows are passed over, and which
# units of the newest stage 2 set built from a walk set would price a lean at
# stage 3 today. Writes nothing, starts nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || { echo "no app dir"; exit 1; }
node -e '
const ws = require("./lib/walkset");
const coinsrun = require("./lib/coinsrun");
const stages = require("./lib/stages");
const L = (x) => (x == null ? "-" : x);
const lean = (l) => (l ? `rising ${L(l.rising)} falling ${L(l.falling)} yard ${l.yardstick == null ? "-" : Number(l.yardstick).toFixed(2)}` : "NO LEAN");
console.log("== every promoted row, per walk set ==");
for (const g of ws.promoted()) {
  console.log(`${g.name} (${g.id})`);
  for (const r of g.rows) {
    console.log(`  ${r.ticked ? "on " : "off"} ${r.coin.padEnd(9)} ${r.geometry.padEnd(9)} lb ${String(r.lookback).padStart(4)} band ${String(r.band).padStart(4)}  plateau ${r.plateau ? r.plateau.size + " of " + r.plateau.of : "-"}  ${lean(r.lean)}`);
  }
}
console.log("");
console.log("== what stage 3 reads for a walk chain: promotedLeans() ==");
const pl = ws.promotedLeans();
for (const [k, v] of Object.entries(pl.leans)) console.log(`  ${k.padEnd(19)} from ${v.from.key}  lb ${v.lookback} band ${v.band}  rising ${v.rising} falling ${v.falling} yard ${Number(v.yardstick).toFixed(2)}`);
console.log(`  ${Object.keys(pl.leans).length} coin-and-shape key(s) hold a lean; ${pl.passedOver.length} promoted row(s) passed over:`);
for (const r of pl.passedOver) console.log(`    ${r.coin} ${r.geometry} lb ${r.lookback} band ${r.band} (${r.setName})`);
console.log("");
console.log("== leansFrom(walk): the map the count and the launch read ==");
const lf = coinsrun.leansFrom("walk");
console.log(`  ${Object.keys(lf).length} key(s): ${Object.keys(lf).join(", ")}`);
console.log("");
console.log("== the newest stage 2 set from a walk set, unit by unit ==");
const sets = (stages.listSets ? stages.listSets() : []).filter((s) => s.stage === 2).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
const s2 = sets.find((s) => stages.coinsSourceOf(stages.getSet(s.id)) === "walk");
if (!s2) console.log("  no stage 2 set on this box took its units from a walk set");
else {
  const doc = stages.getSet(s2.id);
  const recs = stages.allRecords ? stages.allRecords(s2.id) : [];
  const leans = stages.confirmLeansFor(recs, stages.coinsSourceOf(doc));
  console.log(`  ${s2.name} (${s2.id}) source ${stages.coinsSourceOf(doc)}: ${recs.length} unit(s), ${Object.keys(leans).length} would price a lean`);
  for (const r of recs) {
    const k = `${r.trade}|${r.geometry}`;
    const l = leans[k];
    console.log(`  ${r.trade.padEnd(9)} ${r.geometry.padEnd(9)} extras ${(r.extras || []).length}  plateaus ${(r.plateaus || []).length}  ${l ? "LEAN from " + l.from.key : "no lean"}`);
  }
}
' 2>&1 | head -120
