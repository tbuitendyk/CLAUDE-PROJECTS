#!/usr/bin/env bash
# READ-ONLY. What the top 300 of the stage 2 table looks like under each
# candidate sort -- in particular whether the chunk shapes stay balanced.
set -euo pipefail
cd /opt/ultimate-trading-system
node -e '
const rowstore = require("./lib/rowstore");
const fs = require("fs");
const dir = "data/stagesets";
const f = fs.readdirSync(dir).filter((x) => /^s2-.*\.json$/.test(x)).sort()[0];
const d = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8"));
const rows = rowstore.readAll(d.id, "records");
console.log(d.name + ": " + rows.length + " records");
const shapes = {};
for (const r of rows) shapes[r.geometry] = (shapes[r.geometry] || 0) + 1;
console.log("all units by chunk shape: " + Object.entries(shapes).map(([k, v]) => k + " " + v).join("  "));
const pct = (r) => (r.pairs ? r.beatMoney / r.pairs : -1);
const sorts = {
  "beat its own null set - tuning-slice $, then lead": (a, b) => (pct(b) - pct(a)) || ((b.leadMoney ?? -1e9) - (a.leadMoney ?? -1e9)),
  "tuning-slice $ - all members":                      (a, b) => ((b.money ?? -1e9) - (a.money ?? -1e9)),
  "forecast score - all members (the default)":        (a, b) => ((b.scoreAll ?? -1e9) - (a.scoreAll ?? -1e9)),
};
for (const [name, cmp] of Object.entries(sorts)) {
  const top = rows.slice().sort(cmp).slice(0, 300);
  const s = {};
  for (const r of top) s[r.geometry] = (s[r.geometry] || 0) + 1;
  const coins = new Set(top.flatMap((r) => [r.ctx1, r.ctx2].filter(Boolean)));
  console.log("\ntop 300 by " + name);
  console.log("   shapes: " + Object.entries(s).sort().map(([k, v]) => k + " " + v).join("  "));
  console.log("   distinct coins read alongside: " + coins.size + " of 16");
  const pcts = top.map(pct).filter((x) => x >= 0);
  if (pcts.length) console.log("   beat-its-own-null-set share: best " + (pcts[0] * 100).toFixed(0) + "%  worst kept " + (Math.min(...pcts) * 100).toFixed(0) + "%");
}
const all = rows.map(pct).filter((x) => x >= 0).sort((a, b) => b - a);
if (all.length) console.log("\nwhole set, beat its own null set share: 100% on " + all.filter((x) => x >= 1).length + " units; >=95% on " + all.filter((x) => x >= 0.95).length + "; >=80% on " + all.filter((x) => x >= 0.8).length);
'
