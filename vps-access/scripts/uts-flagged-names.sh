#!/usr/bin/env bash
# uts-flagged-names.sh -- READ-ONLY. The full name and coin and shape of every
# set the running release flags REBUILD REQUIRED, and of every set rebuilt in
# place. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts timeout 60 node -e '
const s = require("./lib/stages");
for (const x of s.listSets().filter((y) => !y.exam && y.stage >= 3)) {
  const d = s.getSet(x.id); const f = s.rebuildOf(d);
  if (!f && !d.rebuilt) continue;
  console.log(`${d.id} | ${d.name} | ${d.unitName || "-"} | ${f ? f.reasons.map((r) => r.key).join("+") : "rebuilt"}`);
}' 2>&1 | tail -c 5000
