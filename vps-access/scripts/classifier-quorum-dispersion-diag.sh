#!/usr/bin/env bash
# classifier-quorum-dispersion-diag.sh -- READ-ONLY. Tests the open question
# from the run D audit: is the 1-of-8 null a weak opponent because the shuffle
# cannot change WHICH periods are traded, only their direction? If real and
# null arms trade nearly the same number of times out of nearly every period,
# the null is only re-randomising direction and its spread will be collapsed.
set -uo pipefail
node -e '
const fs=require("fs");
const dir="/opt/general-classifier/data/batches";
const f=fs.readdirSync(dir).filter(x=>x.includes("confirm-d")&&x.endsWith(".json")).sort().pop();
const d=JSON.parse(fs.readFileSync(dir+"/"+f,"utf8"));
const key=(r)=>[r.trade,r.ctx1,r.ctx2].join("+");
const idx={};
for(const r of (d.replication||[])){const e=(idx[key(r)]||={real:null,nulls:[]});
  if(r.nullDealSeed==null){if(!e.real)e.real=r;} else e.nulls.push(r);}
console.log("PARTICIPATION: how many of the holdout periods each arm actually traded");
console.log("ordering                  periods  realTrades  real%   nullTrades(min..max)  null%avg  tradesSd");
for(const [k,v] of Object.entries(idx)){
  if(!v.real||!v.real.holdout)continue;
  const per=v.real.holdout.periods;
  const rt=v.real.holdout.trades;
  const nt=v.nulls.map(r=>r.holdout&&r.holdout.trades).filter(x=>x!=null);
  if(!nt.length)continue;
  const m=nt.reduce((a,b)=>a+b,0)/nt.length;
  const sd=Math.sqrt(nt.reduce((a,b)=>a+(b-m)*(b-m),0)/(nt.length-1));
  console.log(k.padEnd(24), String(per).padStart(8), String(rt).padStart(11),
    (100*rt/per).toFixed(1).padStart(6)+"%",
    (Math.min(...nt)+".."+Math.max(...nt)).padStart(21),
    (100*m/per).toFixed(1).padStart(8)+"%", sd.toFixed(1).padStart(9));
}
console.log("\nDIRECTION MIX: wins/trades tells whether nulls are coin-flipping direction");
for(const [k,v] of Object.entries(idx)){
  if(!v.real||!v.real.holdout)continue;
  const rw=v.real.holdout.wins, rt=v.real.holdout.trades;
  const nr=v.nulls.map(r=>r.holdout?r.holdout.wins/r.holdout.trades:null).filter(x=>x!=null);
  const m=nr.reduce((a,b)=>a+b,0)/nr.length;
  console.log("  "+k.padEnd(24),"real win rate",(100*rw/rt).toFixed(1)+"%","| null win rate avg",(100*m).toFixed(1)+"%",
    "| null win-rate range",(100*Math.min(...nr)).toFixed(1)+".."+(100*Math.max(...nr)).toFixed(1)+"%");
}
'
