#!/usr/bin/env bash
# READ-ONLY. Cuts near 300 that keep the owner's intent -- a real committee edge
# and real money -- without the two conditions that quietly select for shape.
set -euo pipefail
cd /opt/ultimate-trading-system
node -e '
const stages = require("./lib/stages");
const fs = require("fs");
const dir = "data/stagesets";
const f = fs.readdirSync(dir).filter((x) => /^s2-.*\.json$/.test(x)).sort()[0];
const doc = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8"));
const G = ["daily-1d","daily-2d","daily-3d","daily-4d","weekly-8d"];
const line = (label, filters) => {
  const rows = stages.stage2Table(doc.id, 0, 100000, filters).rows;
  const s = {}; for (const r of rows) s[r.geometry] = (s[r.geometry] || 0) + 1;
  const m = rows.map((r) => r.moneyAll).filter((x) => x != null).sort((a, b) => a - b);
  console.log(String(rows.length).padStart(4) + "   " + G.map((g) => String(s[g] || 0).padStart(3)).join(" ")
    + "   med $" + String(m.length ? m[Math.floor(m.length / 2)].toFixed(0) : "-").padStart(4) + "   " + label);
};
console.log("rows    1d  2d  3d  4d  8d   med $   cut");
line("YOUR CUT, all five", doc.filters || {});
console.log("");
console.log("-- without helped and without the dollar floors --");
for (const bar of ["90", "85", "80", "75", "70"]) line(`beat its own null set - tuning-slice $ >= ${bar}%, and beat its own null set >= 80%`, { beatMin: "80", beatMoneyMin: bar });
console.log("");
console.log("-- a money condition that is shape-neutral: any profit at all --");
for (const bar of ["90", "85", "80", "75"]) line(`beat ... tuning-slice $ >= ${bar}% and tuning-slice $ - all members >= 0`, { beatMoneyMin: bar, moneyAllMin: "0" });
console.log("");
console.log("-- the plainest cuts --");
for (const bar of ["85", "80", "75"]) line(`beat its own null set - tuning-slice $ >= ${bar}% alone`, { beatMoneyMin: bar });
'
