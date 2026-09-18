#!/usr/bin/env bash
# READ-ONLY. Does Sweep's tick -- "only the coins and shapes ticked on Coins" --
# agree with what the walk found out of sample? Lists every walk set on the box,
# then for each PASSER (what the tick would run) prints what the early/late
# reading said about that same coin and shape, and what the whole history
# chose for it. Writes nothing, starts nothing.
set -uo pipefail
echo "== walk sets on the box =="
curl -sS -m 30 http://127.0.0.1:8094/api/coins/walks \
| node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d;try{d=JSON.parse(r)}catch(e){console.log("no answer");return}
for(const w of d.walks||[])console.log("  "+w.id+"  "+w.name+"  rows "+w.rows+"  release "+w.release+"  picked "+(w.picked||0));
if(!(d.walks||[]).length)console.log("  none");})'
echo "== the passers the tick would run =="
curl -sS -m 60 http://127.0.0.1:8094/api/coins/records \
| node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d;try{d=JSON.parse(r)}catch(e){console.log("no answer");return}
const p=(d.passers&&d.passers.rows)||[];
console.log("  bar "+(d.passers&&d.passers.bar)+"  passers "+p.length+"  ticked "+p.filter(x=>x.ticked).length);
for(const x of p)console.log("  "+(x.ticked?"TICK":"off ")+"  "+x.coin+" "+x.geometry+"  band "+x.band+"  check "+x.check.asStrong+"/"+x.check.trials);}'
ID="${1:-}"
if [ -z "$ID" ]; then
  ID=$(curl -sS -m 30 http://127.0.0.1:8094/api/coins/walks | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d={};try{d=JSON.parse(r)}catch(e){}const w=(d.walks||[])[0];process.stdout.write(w?w.id:"")})')
fi
[ -z "$ID" ] && { echo "== no walk set to read =="; exit 0; }
echo "== early/late on walk set $ID, every pair, passers marked =="
curl -sS -m 30 -X POST -H 'Content-Type: application/json' \
  -d "{\"setId\":\"$ID\"}" http://127.0.0.1:8094/api/coins/walk/split \
| node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d;try{d=JSON.parse(r)}catch(e){console.log("no answer: "+r.slice(0,300));return}
if(d.none){console.log("  "+d.why);return}
console.log("  verdict "+d.verdict+"  |  "+d.beat+" of "+d.of+" ahead (bar "+Math.ceil(d.of*(60/90))+", chance "+d.chance+")  pooled late "+(d.pooled==null?"—":d.pooled.toFixed(3))+"%  net "+(d.netPooled==null?"—":d.netPooled.toFixed(3))+"%  same pick "+d.sameChoice+" of "+d.of);
const PASS=new Set(process.env.PASSERS?JSON.parse(process.env.PASSERS):[]);
const rows=(d.pairs||[]).map(p=>({k:p.coin+"|"+p.geometry,p}));
const show=(t)=>{console.log("  "+t);};
show("coin/shape".padEnd(26)+"back  band  early    late     blind    lead     pct  wholeBack wholeBand  paid");
for(const {k,p} of rows){
  const mark=PASS.has(k)?"* ":"  ";
  console.log("  "+mark+(p.coin+" "+p.geometry).padEnd(24)
   +String(p.lookback).padEnd(6)+String(p.band).padEnd(6)
   +(p.earlyPerTrade>=0?"+":"")+p.earlyPerTrade.toFixed(3)+"% "
   +((p.latePerTrade>=0?"+":"")+p.latePerTrade.toFixed(3)+"%").padEnd(9)
   +((p.blind>=0?"+":"")+p.blind.toFixed(3)+"%").padEnd(9)
   +((p.lead>=0?"+":"")+p.lead.toFixed(3)+"%").padEnd(9)
   +String(Math.round(p.percentile)).padEnd(5)
   +String(p.wholeLookback).padEnd(10)+String(p.wholeBand).padEnd(11)
   +(p.lateWindowsPaid==null?"—":p.lateWindowsPaid+"/"+p.lateWindows));
}})'
