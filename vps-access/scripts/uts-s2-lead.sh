#!/usr/bin/env bash
# READ-ONLY. Sorting by lead over null set - tuning-slice $ and taking the top
# 300: where the cut falls, and how badly the share ties up by comparison.
set -euo pipefail
cd /opt/ultimate-trading-system
node -e '
const stages = require("./lib/stages");
const fs = require("fs");
const dir = "data/stagesets";
const f = fs.readdirSync(dir).filter((x) => /^s2-.*\.json$/.test(x)).sort()[0];
const doc = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8"));
const rows = stages.stage2Table(doc.id, 0, 100000, null).rows;
const G = ["daily-1d","daily-2d","daily-3d","daily-4d","weekly-8d"];

const byLead = rows.slice().sort((a, b) => ((b.leadMoney ?? -1e9) - (a.leadMoney ?? -1e9)) || (a.rank - b.rank));
const top = byLead.slice(0, 300);
const s = {}; for (const r of top) s[r.geometry] = (s[r.geometry] || 0) + 1;
console.log("TOP 300 BY lead over null set - tuning-slice $");
console.log("  shapes " + G.map((g) => g + " " + (s[g] || 0)).join("  "));
console.log("  coins alongside " + new Set(top.flatMap((r) => [r.ctx1, r.ctx2].filter(Boolean))).size + " of 16");
const L = top.map((r) => r.leadMoney);
console.log("  lead: best " + L[0].toFixed(2) + "   300th " + L[299].toFixed(2) + "   negative leads carried: " + L.filter((x) => x < 0).length);
const m = top.map((r) => r.moneyAll).filter((x) => x != null).sort((a, b) => a - b);
console.log("  tuning-slice $ median " + m[Math.floor(m.length / 2)].toFixed(0) + "   losing units carried " + m.filter((x) => x < 0).length);
const all = rows.map((r) => r.leadMoney).sort((a, b) => b - a);
console.log("  whole set: lead > 0 on " + all.filter((x) => x > 0).length + "   > 1 on " + all.filter((x) => x > 1).length + "   > 2 on " + all.filter((x) => x > 2).length);

// how much of the share ordering is really a tie-break
const pct = (r) => (r.pairs ? Math.round((r.beatMoney / r.pairs) * 100) : -1);
const bands = {};
for (const r of rows) bands[pct(r)] = (bands[pct(r)] || 0) + 1;
console.log("");
console.log("BY beat its own null set - tuning-slice $, the ties:");
console.log("  " + Object.entries(bands).map(([k, v]) => k + "%:" + v).sort((a, b) => Number(b.split("%")[0]) - Number(a.split("%")[0])).slice(0, 9).join("  "));
const byShare = rows.slice().sort((a, b) => (pct(b) - pct(a)) || (a.rank - b.rank));
console.log("  the 300th row sits in the " + pct(byShare[299]) + "% band, which holds " + bands[pct(byShare[299])] + " rows — the order inside it is the carry position, not the measure");
'
