#!/usr/bin/env bash
# uts-table3c-state.sh -- READ-ONLY. For every stage 3 set: the filter saved on
# the set for Table 3.C, and whether the table's rows are stored beside it (in
# today's shape, and against which totalling). Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts timeout 60 node -e '
const fs = require("fs"); const path = require("path");
const s = require("./lib/stages");
const src = fs.readFileSync("lib/stages.js", "utf8");
const want = Number((/const UNITS_V = (\d+);/.exec(src) || [])[1]);
for (const x of s.listSets().filter((y) => y.stage === 3 && !y.exam)) {
  const d = s.getSet(x.id); if (!d) continue;
  const f = path.join("data/stagesets", `${d.id}.units.json`);
  let rows = "no rows stored";
  if (fs.existsSync(f)) {
    try { const t = JSON.parse(fs.readFileSync(f, "utf8")); rows = `rows stored: ${(t.units || []).length} coins and shapes, shape ${t.v}${t.v !== want ? " (older)" : ""}, built ${String(t.builtAt).slice(0, 16)} from the totalling of ${String(t.tallyBuiltAt).slice(0, 16)}`; } catch (e) { rows = "rows unreadable: " + e.message; }
  }
  const flt = d.unitFilter && Object.keys(d.unitFilter).length ? JSON.stringify(d.unitFilter) : "no filter";
  console.log(`${d.name} | filter: ${flt.slice(0, 300)} | ${rows}`);
}' 2>&1 | tail -c 6000
