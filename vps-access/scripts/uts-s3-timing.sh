#!/usr/bin/env bash
# READ-ONLY. How long the stage 3 run actually took, and per pricing.
set -euo pipefail
node -e '
const fs = require("fs");
const dir = "/opt/ultimate-trading-system/data/stagesets";
for (const f of fs.readdirSync(dir).filter((x) => /^s[123]-.*\.json$/.test(x)).sort()) {
  const d = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8"));
  const pf = d.perf || {}, pl = d.plan || {};
  const ms = pf.elapsedMs || (d.finishedAt && d.createdAt ? Date.parse(d.finishedAt) - Date.parse(d.createdAt) : null);
  const h = ms == null ? "?" : (ms / 3600000).toFixed(2);
  console.log(`${d.name}  stage ${d.stage}  ${h} h   units ${pl.units}  settings ${pl.settings || "-"}  pricings ${pl.pricings || "-"}  cyclesTotal ${pf.cyclesTotal || "-"} (${pf.cyclesWord || ""})  workers ${pf.workers || "?"}`);
  if (ms && pf.cyclesTotal) console.log(`     ${(ms / pf.cyclesTotal).toFixed(1)} ms per ${pf.cyclesWord || "cycle"}`);
}
'
