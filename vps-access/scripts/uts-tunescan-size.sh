#!/usr/bin/env bash
# uts-tunescan-size.sh -- READ-ONLY. How big each kept Tune scan result is, and
# which of its fields make it so, for every set that keeps any. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts timeout 60 node -e '
const fs = require("fs"); const path = require("path");
const D = "data/stagesets";
for (const f of fs.readdirSync(D).filter((x) => x.endsWith("-tunescans.json"))) {
  const x = JSON.parse(fs.readFileSync(path.join(D, f), "utf8"));
  console.log(`${f}: ${(fs.statSync(path.join(D, f)).size / 1e6).toFixed(2)} MB`);
  for (const [tool, byKey] of Object.entries(x.scans || {})) {
    for (const [key, r] of Object.entries(byKey || {})) {
      const sizes = Object.entries(r || {}).map(([k, v]) => [k, JSON.stringify(v === undefined ? null : v).length]).sort((a, b) => b[1] - a[1]).slice(0, 5);
      console.log(`   ${tool} ${key}: ${(JSON.stringify(r).length / 1e6).toFixed(2)} MB · biggest fields ${sizes.map(([k, n]) => `${k} ${(n / 1e6).toFixed(2)} MB`).join(", ")}`);
    }
  }
}
'
