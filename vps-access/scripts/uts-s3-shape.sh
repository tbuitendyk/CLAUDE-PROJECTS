#!/usr/bin/env bash
# READ-ONLY. What a stage 3 set's board actually holds: how many settings, what
# each dial takes across them, and how many units.
set -euo pipefail
node -e '
const fs = require("fs");
const dir = "/opt/ultimate-trading-system/data/stagesets";
for (const f of fs.readdirSync(dir).filter((x) => /^s3-.*\.json$/.test(x)).sort()) {
  const d = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8"));
  const pl = d.plan || {}, p = d.params || {};
  console.log("== " + d.name + "  (" + d.id + ")  " + d.status);
  console.log("   units " + pl.units + "   settings " + pl.settings + "   pricings " + pl.pricings);
  console.log("   declaredSettings " + pl.declaredSettings + "   sameTradeFolded " + pl.sameTradeFolded);
  console.log("   nullN " + p.nullN + "   keepN " + p.keepN + "   carry " + p.carry + "   pick " + p.pick);
  const labels = pl.settingLabels || [];
  console.log("   setting names held: " + labels.length);
  for (const L of labels.slice(0, 8)) console.log("      " + L);
  const per = pl.unitSettings || [];
  console.log("   per-unit held: " + per.slice(0, 6).map((x) => x.u + ":" + x.held).join("  ") + (per.length > 6 ? "  ..." : ""));
  console.log("   controls kept: " + (d.controls && d.controls.units ? Object.keys(d.controls.units).length : 0));
  console.log("   boardNull: " + JSON.stringify(d.boardNull));
}
'
