#!/usr/bin/env bash
# classifier-money-screen.sh -- READ-ONLY. The declared money screen: rank the
# discovery board's stored rows by HELD-BACK NET MONEY and compute fee headroom
# per row. Declared floor: (a) net > 0 after fees AND (b) break-even fee per leg
# >= $0.1875, i.e. 50% headroom over the $0.125 charged.
# Reports COVERAGE honestly — how many of the run's units carry a held-back
# number at all — because a floor cleared by nobody is only meaningful if you
# know how many were eligible to clear it.
set -uo pipefail
node -e '
const fs=require("fs");
const dir="/opt/general-classifier/data/batches";
const id="bracketlab-20260805-193433-real";
const d=JSON.parse(fs.readFileSync(dir+"/"+id+".json","utf8"));
const FEE=(d.params||{}).feePerLeg ?? 0.125;
const FLOOR=FEE*1.5;
const rows=[];
const push=(r,src)=>{
  const h=r.holdout; if(!h||h.pnl==null||!h.trades) return;
  const legs=h.trades*2, fees=legs*FEE, gross=h.pnl+fees;
  rows.push({src, name:[r.trade,r.ctx1,r.ctx2].filter(Boolean).join("+"),
    geo:r.geometry, q:r.quorum+"/"+r.members, entry:r.entry, t:r.tHours,
    net:h.pnl, trades:h.trades, gross, be:gross/legs, hr:100*(gross/legs/FEE-1)});
};
for(const r of (d.leaders||[])) push(r,"leader");
for(const r of (d.replication||[])) push(r,"census");
for(const r of (d.slimResults||[])) push(r,"slim");
console.log("MONEY SCREEN — discovery board "+id);
console.log("plan units:",(d.plan||{}).units,"| leaders stored:",(d.leaders||[]).length,
  "| census rows:",(d.replication||[]).length,"| slim rows:",(d.slimResults||[]).length);
console.log("COVERAGE: rows carrying a held-back number:",rows.length,
  "of",(d.plan||{}).units,"units ("+(100*rows.length/((d.plan||{}).units||1)).toFixed(1)+"%)");
console.log("fee charged $"+FEE.toFixed(3)+"/leg | declared floor: net>0 AND break-even >= $"+FLOOR.toFixed(4)+"/leg (50% headroom)\n");
rows.sort((a,b)=>b.net-a.net);
console.log("TOP 12 BY HELD-BACK NET MONEY (per $100 book)");
console.log("  net$   trades  gross$  break-even$/leg  headroom%  setup");
for(const r of rows.slice(0,12)){
  console.log("  "+r.net.toFixed(2).padStart(8), String(r.trades).padStart(6), r.gross.toFixed(2).padStart(8),
    r.be.toFixed(4).padStart(15), (r.hr.toFixed(1)+"%").padStart(10), " "+r.name+" "+r.geo+" q"+r.q+" "+r.entry+" t"+r.t);
}
const posNet=rows.filter(r=>r.net>0);
const clears=rows.filter(r=>r.net>0 && r.be>=FLOOR);
console.log("\nVERDICT AGAINST THE DECLARED FLOOR");
console.log("  rows with positive held-back net money: "+posNet.length+" of "+rows.length);
console.log("  rows ALSO clearing 50% fee headroom:    "+clears.length+" of "+rows.length);
for(const r of clears.slice(0,10)) console.log("    CLEARS: "+r.name+" "+r.geo+" q"+r.q+" "+r.entry+" t"+r.t+
  " | net $"+r.net.toFixed(2)+" ("+r.trades+"t) break-even $"+r.be.toFixed(4)+" ("+r.hr.toFixed(1)+"% headroom)");
if(!clears.length) console.log("    NONE.");
const best=rows.reduce((a,b)=>b.hr>a.hr?b:a, rows[0]);
console.log("  best headroom on the board: "+best.hr.toFixed(1)+"% ("+best.name+", net $"+best.net.toFixed(2)+")");
'
