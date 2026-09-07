#!/usr/bin/env bash
# uts-verify-looks.sh -- READ-ONLY. The two looks VERIFY-DESIGN.md section 7
# asks for before any build (one survivor's null copies and kept scrambles;
# whether the parent carries the four comparisons for the unit), and the RULE
# TEN count for 3.85.0's fill block: sets still without their date ranges.
set -uo pipefail
APP=/opt/ultimate-trading-system
S4=s4-mtqq96dh-1
RUN=""
if [ "$(id -u)" = 0 ] && command -v runuser >/dev/null 2>&1; then RUN="runuser -u uts --"; fi
cd "$APP" || exit 1
echo "== the Stage 4 set and its parent =="
$RUN node -e '
  const d = require("'"$APP"'/data/stagesets/'"$S4"'.json");
  console.log("   " + d.name);
  console.log("   unit " + d.unit + " · parent " + ((d.parent||{}).id||"?") + " · release " + d.release);
  console.log("   top-level keys: " + Object.keys(d).join(", "));
  const p = require("'"$APP"'/data/stagesets/" + d.parent.id + ".json");
  const cu = ((p.controls||{}).units)||{};
  console.log("== look 2: does " + p.name + " carry the four comparisons for this unit ==");
  console.log("   comparisons written at " + ((p.controls||{}).at||"never") + " for " + Object.keys(cu).length + " unit(s)");
  const mine = cu[d.unit];
  if (!mine) { console.log("   NONE for " + d.unit); }
  else { const ks = Object.keys(mine); console.log("   " + ks.length + " key(s) for this unit: " + ks.slice(0,6).join(", ") + (ks.length>6?" ...":"")); console.log("   first: " + JSON.stringify(mine[ks[0]]).slice(0,300)); }
'
echo "== look 1: null copies and kept scrambles on one survivor row =="
curl -sf --max-time 90 "http://127.0.0.1:8094/api/funnel/set/$S4/rows" | $RUN node -e '
let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{
  const d=JSON.parse(r);
  console.log("   answer keys: " + Object.keys(d).join(", "));
  const rows = d.rows || [];
  console.log("   rows: " + rows.length);
  const x = rows.find(x => Array.isArray(x.noiseHold) && x.noiseHold.length) || rows[0];
  if (!x) { console.log("   no rows"); return; }
  console.log("   row keys: " + Object.keys(x).join(", "));
  console.log("   " + x.label);
  console.log("   beat its own null set = " + x.beat + " of null copies (pairs) = " + x.pairs);
  console.log("   kept scrambles: test " + (Array.isArray(x.noiseTest)?x.noiseTest.length:"none") + " · held-back " + (Array.isArray(x.noiseHold)?x.noiseHold.length:"none"));
  const withH = rows.filter(x => Array.isArray(x.noiseHold) && x.noiseHold.length).length;
  console.log("   survivors carrying held-back scrambles: " + withH + " of " + rows.length);
  console.log("   distinct null copies counts across survivors: " + [...new Set(rows.map(x=>x.pairs))].slice(0,8).join(", "));
});'
echo "== RULE TEN: sets still without their date ranges (3.85.0 fill block) =="
$RUN timeout 300 node -e '
  const stages = require("'"$APP"'/lib/stages");
  const m = stages.windowsMissing();
  console.log("   sets " + m.sets + " · units " + m.units);
  for (const row of stages.listSets()) {
    if (![1,2,3].includes(row.stage)) continue;
    const w = stages.windowsOfSet(stages.getSet(row.id));
    if (w && w.units > w.known) console.log("   " + row.name + " (stage " + row.stage + ", " + row.status + "): " + w.known + " of " + w.units + " units");
  }
  process.exit(0);
'
