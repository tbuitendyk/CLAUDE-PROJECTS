#!/usr/bin/env bash
# READ-ONLY. The pre-registered reading of step A (LOOP-2026-09-18-COINS.md):
# how many coin-and-shape pairs had ONE setting win BOTH halves of the history.
# Declared before this ran: >3 is beyond chance, 0-1 means the column has
# nothing in it, 2-3 is inconclusive. Writes nothing, starts nothing.
set -uo pipefail
ID="${1:-W-3}"
curl -sS -m 180 -X POST -H 'Content-Type: application/json' -d "{\"setId\":\"$ID\"}" \
  http://127.0.0.1:8094/api/coins/walk/split \
| node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d;try{d=JSON.parse(r)}catch(e){console.log("no answer: "+r.slice(0,300));return}
if(d.none){console.log(d.why);return}
console.log("set "+(d.setName||"?")+"  pairs "+d.of+"  verdict "+d.verdict);
console.log("  ahead of picking blind : "+d.beat+" of "+d.of+"   (bar "+Math.ceil(d.of*(60/90))+", chance "+d.chance+")");
console.log("  pay after the round trip: "+d.paid+" of "+d.of);
console.log("  pooled late "+(d.pooled==null?"—":d.pooled.toFixed(3))+"%  net "+(d.netPooled==null?"—":d.netPooled.toFixed(3))+"%  mean percentile "+(d.meanPercentile==null?"—":d.meanPercentile.toFixed(1)));
console.log("  same pick as the WHOLE history: "+d.sameChoice+" of "+d.of);
console.log("");
console.log("  *** ONE SETTING WON BOTH HALVES: "+d.sameBothHalves+" of "+d.of+" ***");
const n=d.sameBothHalves;
console.log("  pre-registered verdict: "+(n>3?"BEYOND CHANCE — worth selecting on":n<=1?"NOTHING IN IT — honest and empty":"INCONCLUSIVE"));
const hit=(d.pairs||[]).filter(p=>p.sameBothHalves).sort((a,b)=>b.latePerTrade-a.latePerTrade);
if(hit.length){
  console.log("\n  the rows that won both halves:");
  console.log("  "+"coin shape".padEnd(24)+"back  band  early    late     blind    lead     pct  paid");
  for(const p of hit)console.log("  "+(p.coin+" "+p.geometry).padEnd(24)+String(p.lookback).padEnd(6)+String(p.band).padEnd(6)
   +((p.earlyPerTrade>=0?"+":"")+p.earlyPerTrade.toFixed(3)+"%").padEnd(9)
   +((p.latePerTrade>=0?"+":"")+p.latePerTrade.toFixed(3)+"%").padEnd(9)
   +((p.blind>=0?"+":"")+p.blind.toFixed(3)+"%").padEnd(9)
   +((p.lead>=0?"+":"")+p.lead.toFixed(3)+"%").padEnd(9)
   +String(Math.round(p.percentile)).padEnd(5)
   +(p.lateWindowsPaid==null?"—":p.lateWindowsPaid+"/"+p.lateWindows));
}
// AND HUNT THE INSTRUMENT: how many rows was each pair choosing among? A pair
// with few rows makes a "yes" cheap, and that has to be visible.
const sizes=(d.pairs||[]).map(p=>p.of).sort((a,b)=>a-b);
const med=sizes.length?sizes[Math.floor(sizes.length/2)]:0;
console.log("\n  rows each pair chose among: smallest "+sizes[0]+", median "+med+", largest "+sizes[sizes.length-1]);
const cheap=(d.pairs||[]).filter(p=>p.sameBothHalves&&p.of<=4);
console.log("  of the both-halves rows, how many were choosing among 4 or fewer: "+cheap.length
  +(cheap.length?"  <-- those yeses are cheap":"  (none — every yes was a real choice)"));
})'
