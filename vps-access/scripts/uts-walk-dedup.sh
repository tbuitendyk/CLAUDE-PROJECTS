#!/usr/bin/env bash
# uts-walk-dedup.sh -- READ-ONLY. The early/late reading AGAIN, with the daily
# shapes that are the same unit collapsed into one.
#
# Once a look-back is given in HOURS, a chunk shape's own span stops deciding
# what is looked at, and all that is left of the shape is when the trade opens
# and closes. Those coincide in pairs: daily-1d opens 25h into its chunk and
# closes at 42h, daily-2d at 49h and 66h -- exactly one 24h step later, so
# chunk i of daily-2d IS chunk i+1 of daily-1d. Same for daily-3d (73h, 114h)
# and daily-4d (97h, 138h). So the four daily shapes are two units seen twice,
# and 90 pairs are about 45. This collapses them by hold length and re-applies
# the same pass mark, to see whether it survives.
set -uo pipefail
curl -s -m 240 -o /tmp/uts-dd.json -X POST http://127.0.0.1:8094/api/coins/walk/split \
  -H 'Content-Type: application/json' -d '{"minTrades":30}'
node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/uts-dd.json","utf8"));
const HOLD={"daily-1d":17,"daily-2d":17,"daily-3d":41,"daily-4d":41,"weekly-8d":60};
const pc=(v,d=3)=>(v==null?"   —  ":((v>0?"+":"")+Number(v).toFixed(d))).padStart(7);
const g=new Map();
for(const p of j.pairs){const k=p.coin+"|"+(HOLD[p.geometry]||p.geometry);if(!g.has(k))g.set(k,[]);g.get(k).push(p);}
// how alike are the twins? the thing the note above claims
let twins=0,close=0,maxGap=0;
for(const [,v] of g) if(v.length===2){twins++;const d=Math.abs(v[0].latePerTrade-v[1].latePerTrade);maxGap=Math.max(maxGap,d);if(d<0.02)close++;}
console.log(`${g.size} distinct coin-and-hold unit(s) out of ${j.pairs.length} pairs · ${twins} unit(s) had both shapes readable · ${close} of those agreed to within 0.02% · widest gap ${maxGap.toFixed(3)}%`);
const rows=[];
for(const [k,v] of g){
  let t=0,s=0,l=0,pct=0,lw=0,lu=0;
  for(const p of v){t+=p.lateTrades;s+=p.latePerTrade*p.lateTrades;l+=p.lead*p.lateTrades;pct+=p.percentile;lw+=p.lateWindows;lu+=p.lateWindowsUp;}
  rows.push({k,n:v.length,late:t?s/t:null,lead:t?l/t:null,pct:pct/v.length,lw,lu,backs:v.map(p=>p.lookback).join("/"),trades:t});
}
rows.sort((a,b)=>b.late-a.late);
const n=rows.length;
const beat=rows.filter(r=>r.lead>0).length;
let T=0,S=0,P=0;for(const r of rows){T+=r.trades;S+=r.late*r.trades;P+=r.pct;}
const pooled=T?S/T:null; const bar=Math.ceil(n*60/90);
const verdict=(beat>=bar&&pooled>0.25)?"PASS":(beat<=Math.floor(n*50/90)||pooled<=0.25)?"FAIL":"inconclusive";
console.log(`\nSAME PASS MARK ON THE COLLAPSED UNITS: ${verdict}`);
console.log(`units ${n} · beat picking blind ${beat} of ${n} (chance ${(n/2).toFixed(0)}, bar ${bar}) · pooled late ${pc(pooled)}% · after the round trip ${pc(pooled-0.25)}% · average percentile ${(P/n).toFixed(1)}`);
console.log(`units whose pick pays after costs: ${rows.filter(r=>r.late>0.25).length} of ${n} · late windows behind it all told: ${rows.reduce((a,r)=>a+r.lw,0)}`);
console.log("\nunit            hold  look-back(s)  late     lead   late wins  pct  trades");
for(const r of rows) console.log(`${r.k.split("|")[0].replace("USDT","").padEnd(6)} ${String(r.k.split("|")[1]+"h").padStart(5)}  ${r.backs.padStart(11)} ${pc(r.late)} ${pc(r.lead)}   ${(r.lu+"/"+r.lw).padStart(6)}  ${String(Math.round(r.pct)).padStart(3)}  ${String(r.trades).padStart(5)}`);
' 2>&1 | head -70
rm -f /tmp/uts-dd.json
