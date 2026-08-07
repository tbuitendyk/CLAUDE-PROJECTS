#!/usr/bin/env bash
# classifier-leak-diag.sh -- READ-ONLY. Three facts the confirm-run verdict
# depends on, taken from the artifacts rather than assumed:
#  (1) did the DISCOVERY board ever score the hold window (selection leak)?
#  (2) are the candidate's window stamps identical in confirm A and C?
#  (3) fee load on the candidate's hold trades (net vs gross).
set -uo pipefail
node -e '
const fs=require("fs"),path=require("path");
const dir="/opt/general-classifier/data/batches";
const disc=JSON.parse(fs.readFileSync(path.join(dir,"bracketlab-20260805-193433-real.json"),"utf8"));
console.log("(1) DISCOVERY board hold-window exposure");
const L=disc.leaders||[];
console.log("    leaders:",L.length);
const withHold=L.filter(x=>x.holdout&&x.holdout.pnl!=null);
console.log("    leaders carrying a scored holdout:",withHold.length);
const cand=L.filter(x=>{const s=new Set([x.trade,x.ctx1,x.ctx2]);return s.has("LTCUSDT")&&s.has("XRPUSDT")&&s.has("BCHUSDT");});
for(const c of cand.slice(0,4)){
  console.log("    cand row:",[c.trade,c.ctx1,c.ctx2].join("+"),c.geometry,c.decision,"q"+c.quorum+"/"+c.members,c.entry,"t"+c.tHours,
    "| pnl $"+(c.pnl==null?"n/a":c.pnl.toFixed(2)),"| holdout:",c.holdout?JSON.stringify({pnl:c.holdout.pnl,trades:c.holdout.trades}):"(absent)",
    "| stamps:",JSON.stringify(c.windowStamps||"(none)"));
}
console.log("    census rows:",(disc.replication||[]).length,"| doc keys:",Object.keys(disc).join(","));
console.log("\n(2) candidate window stamps, confirm A vs C");
for(const id of ["bracketlab-20260807-022033-triples-confirm-a-ltc-xrp-bch","bracketlab-20260807-085851-triples-confirm-c-ltc-sharpen"]){
  const d=JSON.parse(fs.readFileSync(path.join(dir,id+".json"),"utf8"));
  const row=(d.leaders||[]).find(x=>x.trade==="LTCUSDT"&&new Set([x.ctx1,x.ctx2]).has("XRPUSDT")&&new Set([x.ctx1,x.ctx2]).has("BCHUSDT"));
  const rep=(d.replication||[]).find(x=>x.nullDealSeed==null&&x.trade==="LTCUSDT"&&new Set([x.ctx1,x.ctx2]).has("XRPUSDT")&&new Set([x.ctx1,x.ctx2]).has("BCHUSDT"));
  const st=row?row.windowStamps:null;
  const f=(t)=>t?new Date(t).toISOString().slice(0,10):"n/a";
  console.log("   ",id.slice(-28),"stamps test",f(st&&st.testStartTs),"hold",f(st&&st.holdStartTs),
    "| hold pnl $"+(rep&&rep.holdout?rep.holdout.pnl.toFixed(2):"n/a"),"trades",rep&&rep.holdout?rep.holdout.trades:"n/a");
}
console.log("\n(3) fee load on the candidate hold window (confirm C)");
const c=JSON.parse(fs.readFileSync(path.join(dir,"bracketlab-20260807-085851-triples-confirm-c-ltc-sharpen.json"),"utf8"));
const r=(c.replication||[]).find(x=>x.nullDealSeed==null&&x.trade==="LTCUSDT");
const h=r&&r.holdout?r.holdout:null;
const fee=c.params.feePerLeg;
if(h){
  const legs=h.trades*2, feeTotal=legs*fee;
  console.log("    net $"+h.pnl.toFixed(2),"| trades",h.trades,"| feePerLeg $"+fee,"| fees paid $"+feeTotal.toFixed(2),
    "| implied gross $"+(h.pnl+feeTotal).toFixed(2));
  console.log("    break-even feePerLeg = $"+((h.pnl+feeTotal)/legs).toFixed(4),"(above this the hold window loses money)");
  console.log("    holdout fields:",Object.keys(h).join(","));
  if(h.holds) console.log("    holds:",JSON.stringify(h.holds));
}
'
