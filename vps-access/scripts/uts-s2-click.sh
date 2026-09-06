#!/usr/bin/env bash
# READ-ONLY. Exactly what ONE click on a stage 2 column hands the top 300:
# that column descending, ties broken by carry position, which is what
# stage3UnitsFor does with a saved single-column sort.
set -euo pipefail
cd /opt/ultimate-trading-system
node -e '
const rowstore = require("./lib/rowstore");
const fs = require("fs");
const dir = "data/stagesets";
const f = fs.readdirSync(dir).filter((x) => /^s2-.*\.json$/.test(x)).sort()[0];
const d = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8"));
const rows = rowstore.readAll(d.id, "records");
const pct = (r) => (r.pairs ? r.beatMoney / r.pairs : -1);
const keys = { "beat its own null set - tuning-slice $": pct, "lead over null set - tuning-slice $": (r) => (r.leadMoney ?? -1e9), "tuning-slice $ - all members": (r) => (r.money ?? -1e9) };
for (const [name, key] of Object.entries(keys)) {
  const top = rows.slice().sort((a, b) => (key(b) - key(a)) || (a.carriedRank - b.carriedRank)).slice(0, 300);
  const s = {};
  for (const r of top) s[r.geometry] = (s[r.geometry] || 0) + 1;
  const p = top.map(pct);
  console.log("one click on " + name + " (ties by carry position)");
  console.log("   shapes: " + Object.entries(s).sort().map(([k, v]) => k + " " + v).join("  "));
  console.log("   coins alongside: " + new Set(top.flatMap((r) => [r.ctx1, r.ctx2].filter(Boolean))).size + " of 16");
  console.log("   beat share kept: best " + (Math.max(...p) * 100).toFixed(0) + "%  worst " + (Math.min(...p) * 100).toFixed(0) + "%");
}
'
