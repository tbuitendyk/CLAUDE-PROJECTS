#!/usr/bin/env bash
# classifier-replication-read.sh -- READ-ONLY: the newest declared-run's
# replication rows read per the owner's declared rule: real copies only
# (first-per-coin, real-failure guarded), counting HELD-BACK money and
# vs-always-long — the columns the rule names.
set -uo pipefail
node -e '
const fs = require("fs"), path = require("path");
const dir = "/opt/general-classifier/data/batches";
const f = fs.readdirSync(dir).filter((x) => x.startsWith("bracketlab-") && x.includes("declared") && x.endsWith(".json")).sort().pop();
const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
console.log("doc:", d.id, d.status);
const realFailed = new Set((d.failures || []).filter((x) => !/\|n\d+/.test(x.key || "")).map((x) => String(x.key || "").split("|")[0].split("+")[0]));
const seen = new Set(); const rows = [];
for (const r of (d.replication || [])) {
  if (r.nullDealSeed != null) continue;
  if (seen.has(r.trade) || realFailed.has(r.trade)) { if (!("nullDealSeed" in r) && seen.has(r.trade)) continue; if (realFailed.has(r.trade)) continue; }
  if (seen.has(r.trade)) continue;
  seen.add(r.trade); rows.push(r);
}
let holdPos = 0, holdVsLong = 0, holdScored = 0;
for (const r of rows) {
  const h = r.holdout;
  if (!h || h.pnl == null) { console.log(`  ${r.trade}: NO holdout row`); continue; }
  holdScored++;
  const long = h.holds ? h.holds.alwaysLong : null;
  const vs = long == null ? null : h.pnl - long;
  if (h.pnl > 0) holdPos++;
  if (vs != null && vs > 0) holdVsLong++;
  console.log(`  ${r.trade}: held-back $${h.pnl.toFixed(2)} (${h.trades}t)  vs-long ${vs == null ? "n/a" : "$" + vs.toFixed(2)}`);
}
console.log(`REAL COINS: ${rows.length}; held-back scored: ${holdScored}`);
console.log(`RULE LINE 1 — positive HELD-BACK money: ${holdPos}/${holdScored}`);
console.log(`RULE LINE 2 — positive vs ALWAYS-LONG (held-back): ${holdVsLong}/${holdScored}`);
'
