#!/usr/bin/env bash
# READ-ONLY. What the owner's stage 2 table is currently cut down to: the
# filters saved on the set, the ticks, and what the survivors look like.
set -euo pipefail
cd /opt/ultimate-trading-system
node -e '
const stages = require("./lib/stages");
const fs = require("fs");
const dir = "data/stagesets";
const f = fs.readdirSync(dir).filter((x) => /^s2-.*\.json$/.test(x)).sort()[0];
const doc = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8"));
console.log(doc.name + "  " + doc.id);
console.log("saved filters : " + JSON.stringify(doc.filters || null));
console.log("saved sort    : " + JSON.stringify(doc.sort || null));
console.log("ticked        : " + (Array.isArray(doc.picked) ? doc.picked.length : 0));
const t = stages.stage2Table(doc.id, 0, 100000, doc.filters || null);
console.log("table shows   : " + t.total + " of " + t.of);
const carried = stages.stage3UnitsFor(doc, 0).records;
console.log("carry takes   : " + carried.length);
const pct = (r) => (r.pairs ? (r.beatMoney / r.pairs) * 100 : null);
const shapes = {}, coins = new Set();
for (const r of carried) { shapes[r.geometry] = (shapes[r.geometry] || 0) + 1; for (const c of [r.ctx1, r.ctx2]) if (c) coins.add(c); }
console.log("shapes        : " + Object.entries(shapes).sort().map(([k, v]) => k + " " + v).join("  "));
console.log("coins alongside: " + coins.size + " of 16");
const p = carried.map(pct).filter((x) => x != null).sort((a, b) => b - a);
if (p.length) console.log("beat share    : best " + p[0].toFixed(0) + "%  median " + p[Math.floor(p.length / 2)].toFixed(0) + "%  worst " + p[p.length - 1].toFixed(0) + "%");
const money = carried.map((r) => r.money).filter((x) => x != null).sort((a, b) => b - a);
if (money.length) console.log("tuning-slice $: best " + money[0].toFixed(2) + "  median " + money[Math.floor(money.length / 2)].toFixed(2) + "  worst " + money[money.length - 1].toFixed(2));
// how many the whole set has at each bar, so a wider cut can be sized
const all = stages.stage2Table(doc.id, 0, 100000, null).rows;
const ap = all.map((r) => (r.pairs ? (r.beatMoney / r.pairs) * 100 : -1));
for (const bar of [100, 95, 90, 85, 80, 75, 70]) console.log("  whole set at >=" + bar + "% : " + ap.filter((x) => x >= bar).length);
'
