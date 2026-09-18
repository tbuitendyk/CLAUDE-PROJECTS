#!/usr/bin/env bash
# READ-ONLY. The four coin-and-shape units Sweep's tick would run, set beside
# what the 4,896-row walk's early/late reading said about those same four --
# and beside the best and worst of all 75 pairs, so "how good is a passer" has
# something to be good against. Writes nothing, starts nothing.
set -uo pipefail
curl -sS -m 90 -X POST -H 'Content-Type: application/json' -d '{"setId":"W-1"}' \
  http://127.0.0.1:8094/api/coins/walk/split \
| node -e '
const PASS=[["ATOMUSDT","daily-2d"],["DOTUSDT","weekly-8d"],["LTCUSDT","daily-3d"],["BCHUSDT","daily-1d"]].map(a=>a.join("|"));
let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d;try{d=JSON.parse(r)}catch(e){console.log("no answer: "+r.slice(0,300));return}
if(d.none){console.log(d.why);return}
console.log("W-1 whole table: verdict "+d.verdict+" | "+d.beat+" of "+d.of+" ahead (bar "+Math.ceil(d.of*(60/90))+", chance "+d.chance+") | pooled late "+d.pooled.toFixed(3)+"% net "+d.netPooled.toFixed(3)+"% | mean percentile "+d.meanPercentile.toFixed(1)+" | same pick "+d.sameChoice+" of "+d.of);
const hdr="  "+"coin shape".padEnd(24)+"back  band  early    late     blind    lead     pct  paid   wholeBack wholeBand";
const line=(p)=>"  "+(p.coin+" "+p.geometry).padEnd(24)+String(p.lookback).padEnd(6)+String(p.band).padEnd(6)
 +((p.earlyPerTrade>=0?"+":"")+p.earlyPerTrade.toFixed(3)+"%").padEnd(9)
 +((p.latePerTrade>=0?"+":"")+p.latePerTrade.toFixed(3)+"%").padEnd(9)
 +((p.blind>=0?"+":"")+p.blind.toFixed(3)+"%").padEnd(9)
 +((p.lead>=0?"+":"")+p.lead.toFixed(3)+"%").padEnd(9)
 +String(Math.round(p.percentile)).padEnd(5)
 +(p.lateWindowsPaid==null?"—":(p.lateWindowsPaid+"/"+p.lateWindows)).padEnd(7)
 +String(p.wholeLookback).padEnd(10)+String(p.wholeBand);
const pairs=d.pairs||[];
const hit=pairs.filter(p=>PASS.includes(p.coin+"|"+p.geometry));
console.log("\n== the four the tick would run ==");console.log(hdr);
for(const p of hit)console.log(line(p));
for(const k of PASS)if(!hit.some(p=>p.coin+"|"+p.geometry===k))console.log("  "+k+"  -- not in the walk reading (too few trades in one half, or fewer than two rows)");
const byLate=[...pairs].sort((a,b)=>b.latePerTrade-a.latePerTrade);
console.log("\n== best 6 of "+pairs.length+" on late money ==");console.log(hdr);
for(const p of byLate.slice(0,6))console.log(line(p)+(PASS.includes(p.coin+"|"+p.geometry)?"   <= a passer":""));
console.log("\n== worst 4 ==");
for(const p of byLate.slice(-4))console.log(line(p)+(PASS.includes(p.coin+"|"+p.geometry)?"   <= a passer":""));
const paidN=pairs.filter(p=>p.latePerTrade-d.cost>0).length;
const rank=hit.map(p=>({k:p.coin+" "+p.geometry,r:byLate.findIndex(x=>x===p)+1}));
console.log("\npairs paying after the round trip: "+paidN+" of "+pairs.length);
console.log("where the four rank on late money: "+rank.map(x=>x.k+" #"+x.r).join(", "));
})'
