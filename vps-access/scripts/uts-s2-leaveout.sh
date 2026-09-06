#!/usr/bin/env bash
# READ-ONLY. The owner's saved stage 2 cut, taken apart: each condition alone,
# and the cut with each one lifted, so it is plain which is doing the cutting.
set -euo pipefail
cd /opt/ultimate-trading-system
node -e '
const stages = require("./lib/stages");
const fs = require("fs");
const dir = "data/stagesets";
const f = fs.readdirSync(dir).filter((x) => /^s2-.*\.json$/.test(x)).sort()[0];
const doc = JSON.parse(fs.readFileSync(dir + "/" + f, "utf8"));
const saved = doc.filters || {};
const NAME = {
  helpedMin: "fuller board helped at least",
  beatMin: "beat its own null set at least, %",
  moneyAllMin: "tuning-slice $ - all members at least",
  beatMoneyMin: "beat its own null set - tuning-slice $ at least, %",
  leadMoneyMin: "lead over null set - tuning-slice $ at least",
};
const G = ["daily-1d","daily-2d","daily-3d","daily-4d","weekly-8d"];
const line = (label, filters) => {
  const rows = stages.stage2Table(doc.id, 0, 100000, filters).rows;
  const s = {}; for (const r of rows) s[r.geometry] = (s[r.geometry] || 0) + 1;
  console.log(String(rows.length).padStart(4) + "   " + G.map((g) => String(s[g] || 0).padStart(3)).join(" ") + "   " + label);
};
console.log("rows    1d  2d  3d  4d  8d   cut");
line("YOUR CUT, all five", saved);
console.log("");
console.log("-- each condition on its own --");
for (const k of Object.keys(saved)) line(`${NAME[k]} ${saved[k]}`, { [k]: saved[k] });
console.log("");
console.log("-- your cut with one condition LIFTED --");
for (const k of Object.keys(saved)) {
  const less = { ...saved }; delete less[k];
  line(`without ${NAME[k]}`, less);
}
console.log("");
console.log("-- toward 300, keeping the shape of what you built --");
line("yours, money floors off (helped/beat/beatMoney only)", { helpedMin: saved.helpedMin, beatMin: saved.beatMin, beatMoneyMin: saved.beatMoneyMin });
line("yours, beatMoney 90 -> 80 and money floors off", { helpedMin: saved.helpedMin, beatMin: saved.beatMin, beatMoneyMin: "80" });
line("yours, beatMoney 90 -> 75 and money floors off", { helpedMin: saved.helpedMin, beatMin: saved.beatMin, beatMoneyMin: "75" });
line("beat its own null set - tuning-slice $ >= 75 alone", { beatMoneyMin: "75" });
'
