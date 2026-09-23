#!/usr/bin/env bash
# uts-table3c-kept.sh -- READ-ONLY. The coins and shapes the saved Table 3.C
# filter keeps on a stage 3 set today, applied to its stored rows through the
# service's own filter code, beside what each Stage 4 set cut from it recorded
# the filter kept. Changes nothing.   usage: uts-table3c-kept.sh [stage 3 set id]
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
S3="${1:-s3-muc74wb6-25}"
sudo -u uts timeout 60 node -e '
const fs = require("fs"); const path = require("path");
const s = require("./lib/stages"); const UT = require("./lib/unittable");
const id = process.argv[1];
const d = s.getSet(id);
const t = JSON.parse(fs.readFileSync(path.join("data/stagesets", `${id}.units.json`), "utf8"));
const kept = UT.applyFilter(t.units, UT.cleanFilter(d.unitFilter || {}));
console.log(`${d.name}: filter ${JSON.stringify(d.unitFilter)} keeps ${kept.length} of ${t.units.length} today: ${kept.map((r) => r.name).join("; ")}`);
for (const x of s.listFunnelSets().filter((y) => (y.parent || {}).id === id && !y.exam && (y.kind || "funnel") === "funnel" && !y.derived)) {
  const names = (x.keptUnits || []).map((k) => (t.units.find((r) => r.unit === k) || {}).name || k);
  console.log(`- ${String(x.name).slice(0, 60)}: recorded at its cut: ${names.join("; ") || "every coin and shape"}`);
}' "$S3" 2>&1 | tail -c 4000
