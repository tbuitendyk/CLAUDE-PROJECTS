#!/usr/bin/env bash
# READ-ONLY. What each candidate cut on the stage 2 table leaves, and how
# balanced it is -- so a 300 can be chosen on evidence rather than a round number.
set -euo pipefail
cd /opt/ultimate-trading-system
node -e '
const stages = require("./lib/stages");
const fs = require("fs");
const dir = "data/stagesets";
const f = fs.readdirSync(dir).filter((x) => /^s2-.*\.json$/.test(x)).sort()[0];
const doc = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8"));
const rows = stages.stage2Table(doc.id, 0, 100000, null).rows;
const pct = (r) => (r.pairs ? (r.beatMoney / r.pairs) * 100 : -1);
const show = (label, keep) => {
  const k = rows.filter(keep);
  const s = {}; const coins = new Set();
  for (const r of k) { s[r.geometry] = (s[r.geometry] || 0) + 1; for (const c of [r.ctx1, r.ctx2]) if (c) coins.add(c); }
  const m = k.map((r) => r.moneyAll).filter((x) => x != null).sort((a, b) => a - b);
  console.log(String(k.length).padStart(4) + "  " + label.padEnd(52)
    + " shapes " + ["daily-1d","daily-2d","daily-3d","daily-4d","weekly-8d"].map((g) => (s[g] || 0)).join("/")
    + "  coins " + coins.size
    + (m.length ? "  money med " + m[Math.floor(m.length / 2)].toFixed(0) : ""));
};
console.log("rows  cut                                                  shapes 1d/2d/3d/4d/8d  coins");
for (const bar of [100, 95, 90, 85, 80, 75, 70]) show("beat its own null set - tuning-slice $ >= " + bar + "%", (r) => pct(r) >= bar);
console.log("");
show(">=100% and tuning-slice $ - all members > 0", (r) => pct(r) >= 100 && (r.moneyAll ?? -1) > 0);
show(">=95% and tuning-slice $ - all members > 0", (r) => pct(r) >= 95 && (r.moneyAll ?? -1) > 0);
show(">=90% and tuning-slice $ - all members > 0", (r) => pct(r) >= 90 && (r.moneyAll ?? -1) > 0);
show(">=75% and tuning-slice $ - all members > 0", (r) => pct(r) >= 75 && (r.moneyAll ?? -1) > 0);
show("tuning-slice $ - all members > 0 (alone)", (r) => (r.moneyAll ?? -1) > 0);
'
