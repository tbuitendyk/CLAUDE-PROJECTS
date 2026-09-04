#!/usr/bin/env bash
# READ-ONLY. For a few settings of the newest stage 3 set: the money stored for
# ONE unit's board against the money stored for all units together. If those
# differ, a rebuild averaged over every unit cannot be compared against a unit
# board's stored figure. Reads the tables only; nothing priced, nothing written.
set -uo pipefail
cd /opt/ultimate-trading-system
node -e '
(async () => {
const s=require("./lib/stages");
const id="s3-mtl42g1m-3"; const unit="XRPUSDT|||weekly-8d";
const t=s.readTally(id); if(!t){console.log("no tables");return;}
const one=await s.funnelBoard(id,t,unit);
const all=await s.funnelBoard(id,t,"all");
const byLabelAll=new Map(all.all.map((r)=>[r.label,r]));
let same=0, diff=0; const show=[];
for (const r of one.all) {
  const a=byLabelAll.get(r.label); if(!a) continue;
  const x=Number(r.avgTest), y=Number(a.avgTest);
  if(!Number.isFinite(x)||!Number.isFinite(y)) continue;
  if(Math.abs(x-y)/Math.max(1,Math.abs(y))<=1e-6) same++; else { diff++; if(show.length<5) show.push([r.label.slice(0,52),x.toFixed(2),y.toFixed(2)]); }
}
console.log(`one unit board: ${one.all.length} settings | all units together: ${all.all.length}`);
console.log(`same money: ${same} | different money: ${diff}`);
for (const [l,x,y] of show) console.log(`   ${l} | this unit ${x} | all units ${y}`);
})();'
