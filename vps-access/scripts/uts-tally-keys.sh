#!/usr/bin/env bash
# READ-ONLY. Is the per-coin table's key -- the label's first part plus the
# unit -- one row per setting per unit? And what a per-unit board would join
# on. Read from the totals file. Changes nothing.
set -uo pipefail
cd /opt/ultimate-trading-system || exit 1
sudo -u uts node -e '
const fs = require("fs"), zlib = require("zlib"); const stages = require("./lib/stages");
const t = stages.parseTally(zlib.gunzipSync(fs.readFileSync("data/stagesets/s3-mte0oajo-1-tally.json.gz")));
console.log("ranked:", t.ranked.length, " coin rows:", t.coins.length, " ratio:", (t.coins.length / t.ranked.length).toFixed(3));
const rowsDist = new Map(); for (const c of t.coins) rowsDist.set(c.rows, (rowsDist.get(c.rows) || 0) + 1);
console.log("records per coin row ->", JSON.stringify(Object.fromEntries([...rowsDist.entries()].sort((a, b) => a[0] - b[0]))));
const prefixes = new Map(); for (const r of t.ranked) { const p = String(r.label).split(" · ")[0]; prefixes.set(p, (prefixes.get(p) || 0) + 1); }
const dup = [...prefixes.values()].filter((n) => n > 1).length;
console.log("distinct label prefixes:", prefixes.size, " of", t.ranked.length, "settings; prefixes shared by more than one setting:", dup);
const suffixes = new Map(); for (const r of t.ranked) { const s = String(r.label).split(" · ")[1] || ""; suffixes.set(s, (suffixes.get(s) || 0) + 1); }
console.log("label suffixes:", JSON.stringify(Object.fromEntries([...suffixes.entries()].slice(0, 8))));
const units = new Map(); for (const c of t.coins) { const k = c.trade + " " + c.geometry; units.set(k, (units.get(k) || 0) + 1); }
console.log("coin rows per unit:", JSON.stringify(Object.fromEntries(units)));
console.log("a coin row:", JSON.stringify(t.coins[0]).slice(0, 400));
' 2>&1 | tail -12
