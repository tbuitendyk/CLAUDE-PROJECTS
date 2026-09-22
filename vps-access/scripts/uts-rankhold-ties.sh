#!/usr/bin/env bash
# FOR THE COINS AND SHAPES WHOSE FOUR COMPARISONS ALL CAME BACK UNREADABLE on
# Worth walking? (owner, 2026-09-22): a comparison is unreadable when every
# setting sits on the same money in the part it ranks on or the part it scores
# on (lib/rankhold.js rankHold). This reads each such unit's file and says, per
# part of the test window, how many distinct money figures the settings hold
# and how many settings made exactly nothing there. Reads only.
set -uo pipefail
ID="${1:-}"; [ -n "$ID" ] || { echo "usage: uts-rankhold-ties.sh <stage 3 set id>"; exit 1; }
cd /opt/ultimate-trading-system || exit 1
curl -sS --max-time 30 "http://127.0.0.1:8094/api/funnel/$ID/rankhold?atLeast=&onHowMany=4&fewestRanked=30&fewestChunks=40" > /tmp/uts-rh2.json
node -e '
const fs = require("fs"), path = require("path");
const id = process.argv[1];
const d = JSON.parse(fs.readFileSync("/tmp/uts-rh2.json", "utf8"));
if (!d.result) { console.log("no reading in hand"); process.exit(0); }
const dir = `data/stagesets/${id}.funnelrich`;
for (const u of d.result.units) {
  if (u.bar.why !== "no boundary on this coin and shape could be read") continue;
  const f = path.join(dir, "units", u.unit.replace(/[^A-Za-z0-9._@+-]+/g, "_") + ".json");
  const file = JSON.parse(fs.readFileSync(f, "utf8"));
  const parts = [new Set(), new Set(), new Set()], zeros = [0, 0, 0]; let n = 0;
  for (const e of Object.values(file.settings || {})) { const t = e.pnlThirds; if (!Array.isArray(t) || t.length < 3) continue; n++; for (let i = 0; i < 3; i++) { const v = Number(t[i]); parts[i].add(v); if (v === 0) zeros[i]++; } }
  console.log(`${u.name}: ${n} settings with three parts`);
  for (let i = 0; i < 3; i++) console.log(`   part ${i + 1}: ${parts[i].size} distinct money figure(s), ${zeros[i]} setting(s) made exactly nothing${parts[i].size <= 3 ? "  values: " + [...parts[i]].slice(0, 3).join(", ") : ""}`);
}
' "$ID"
