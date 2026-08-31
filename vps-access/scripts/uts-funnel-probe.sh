#!/usr/bin/env bash
# READ-ONLY. What EXACTLY makes a row of Table 3.B, counted rather than guessed.
# Reads the tally that is already built; starts nothing.
set -uo pipefail

cd /opt/ultimate-trading-system || exit 1
sudo -u uts node -e '
const stages = require("./lib/stages");
const id = "s3-mte0oajo-1";
const t = stages.readTally(id);
if (!t) { console.log("no tally"); process.exit(0); }

console.log("Table 3.A rows (ranked):", t.ranked.length.toLocaleString());
console.log("Table 3.B rows (coins) :", t.coins.length.toLocaleString());
console.log();

// what 3.B is grouped by
const settingPart = new Set();
const unit = new Set();
for (const c of t.coins) {
  settingPart.add(c.cellLabel);
  unit.add([c.trade, c.ctx1 || "", c.ctx2 || "", c.geometry].join("|"));
}
console.log("distinct values in the first column :", settingPart.size.toLocaleString());
console.log("distinct coin + chunk shape pairs   :", unit.size);
console.log("their product                       :", (settingPart.size * unit.size).toLocaleString());
console.log("actual rows                         :", t.coins.length.toLocaleString());
console.log("missing from the full grid          :", (settingPart.size * unit.size - t.coins.length).toLocaleString());
console.log();

// how many records each row averages, and what those records vary by
const byRows = new Map();
for (const c of t.coins) byRows.set(c.rows, (byRows.get(c.rows) || 0) + 1);
console.log("the rows column, how many rows carry each value:");
for (const [k, v] of [...byRows.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log("  rows =", k, "on", v.toLocaleString(), "of the rows");
}
console.log();

// and the pieces the second half of a setting name varies over
const dec = new Set(); const band = new Set(); const wk = new Set();
for (const r of t.ranked) { dec.add(r.decision); band.add(String(r.bandMode)); wk.add(String(r.weekdaysOnly)); }
console.log("decision values swept :", [...dec].join(", "));
console.log("band values swept     :", [...band].sort().join(", "));
console.log("24/5 values swept     :", [...wk].join(", "));
console.log("their product         :", dec.size * band.size * wk.size);
console.log();
console.log("first column x that product =", (settingPart.size * dec.size * band.size * wk.size).toLocaleString(),
  "  vs Table 3.A rows", t.ranked.length.toLocaleString());
' 2>&1 | tail -40
