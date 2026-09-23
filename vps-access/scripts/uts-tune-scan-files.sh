#!/usr/bin/env bash
# READ-ONLY. The scan results Tune keeps: the two whole-box files the scans
# wrote until 3.234.0 (data/pilot/stop-sweep.json, conviction-sweep.json) and,
# from 3.234.0, the per-set files beside the sets (<id>-tunescans.json). For
# each: status, the set it read, the survivor, the windows, when, and whether
# that set and the capture it read are still there. Nothing written.
set -uo pipefail
cd /opt/ultimate-trading-system
node -e '
const fs=require("fs"); const path=require("path");
const s=require("./lib/stages");
for (const name of ["stop-sweep.json","conviction-sweep.json"]) {
  const f=path.join("data","pilot",name);
  if (!fs.existsSync(f)) { console.log(`${name}: not there`); continue; }
  let x=null; try { x=JSON.parse(fs.readFileSync(f,"utf8")); } catch (e) { console.log(`${name}: unreadable (${e.message})`); continue; }
  const t=x.target||{}; const doc=t.setId?s.getSet(t.setId):null;
  console.log(`${name}: status ${x.status} | set ${t.set||"-"} (${t.setId||"-"}) | survivor ${t.survivor||"-"} (${t.pick||"-"}) | windows ${(t.windows||[]).join("+")||"-"} | finished ${x.finishedUtc||"-"}`);
  console.log(`   set still there: ${!!doc} | capture it read still current: ${!!(doc&&doc.capture&&doc.capture.at===t.captureAt)} | looks in it: ${t.look==null?"none":t.look}`);
}
const dir=path.join("data","stagesets");
const per=fs.readdirSync(dir).filter((f)=>f.endsWith("-tunescans.json"));
console.log(`per-set files: ${per.length}`);
for (const f of per) {
  const x=JSON.parse(fs.readFileSync(path.join(dir,f),"utf8"));
  for (const tool of Object.keys(x.scans||{})) for (const [k,r] of Object.entries(x.scans[tool])) console.log(`  ${f} ${tool} ${k} ${r.status} ${r.finishedUtc||"-"}`);
}'
