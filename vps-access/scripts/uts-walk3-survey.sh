#!/usr/bin/env bash
# uts-walk3-survey.sh -- READ-ONLY. What is inside the saved walk the owner
# calls test-walk-3, and what Choose early, read late says about it.
#
# Nothing here opens the set. The split endpoint has taken a saved set by id
# since 3.164.0, so the reading is taken off disk and whatever the service is
# holding is left exactly where it is. Starts nothing, writes nothing.
set -uo pipefail
curl -s -m 60 -o /tmp/w3-list.json http://127.0.0.1:8094/api/coins/walks
ID=$(node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/w3-list.json","utf8"));
const w=(j.walks||[]).find(x=>String(x.name||"").toLowerCase().includes("test-walk-3"));
process.stdout.write(w?w.id:"");
')
node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/w3-list.json","utf8"));
console.log("SAVED WALKS ON THIS BOX");
for(const w of (j.walks||[])){
  const a=w.asked||{};
  console.log(`  ${String(w.id).padEnd(5)} ${String(w.name||"").padEnd(16)} ${String(w.rows).padStart(7)} rows · ${String(w.picked||0).padStart(3)} picked · ${(w.bytes/1048576).toFixed(0)}MB · release ${w.release||"?"}`);
  console.log(`        window ${a.windowMonths}mo warm ${a.warmUpMonths}mo · bands ${JSON.stringify(a.bands)} · sweet spot ${a.sweetSpot} · look-backs ${Array.isArray(a.lookbacks)?a.lookbacks.length:0} · ${a.scrambles} copies · floor ${a.floor}`);
}
'
[ -n "$ID" ] || { echo "no saved walk whose name contains test-walk-3"; rm -f /tmp/w3-list.json; exit 0; }
echo
echo "== CHOOSE EARLY, READ LATE on $ID, fewest trades each half 30 =="
curl -s -m 300 -o /tmp/w3-split.json -X POST http://127.0.0.1:8094/api/coins/walk/split \
  -H 'Content-Type: application/json' -d "{\"setId\":\"$ID\",\"minTrades\":30}"
node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/w3-split.json","utf8"));
if(j.none||!j.pairs){console.log("nothing back:",j.why||j.error||JSON.stringify(j).slice(0,200));process.exit(0);}
const pc=(v,d=3)=>(v==null?"  —":((v>0?"+":"")+Number(v).toFixed(d))).padStart(8);
console.log(`set ${j.setId} "${j.setName}" · verdict ${j.verdict}`);
console.log(`pairs ${j.of} · beat picking blind ${j.beat} of ${j.of} (chance ${j.chance.toFixed(0)}) · pooled late ${pc(j.pooled)}% · after the ${j.cost}% round trip ${pc(j.netPooled)}%`);
console.log(`pay after costs ${j.paid}/${j.of} · ONE setting won both halves ${j.sameBothHalves}/${j.of} · average percentile ${j.meanPercentile==null?"—":j.meanPercentile.toFixed(1)} (50 is no skill)`);
console.log(`whole history chose the same as the early half ${j.sameChoice}/${j.of} · its pooled money ${pc(j.wholePooled)}% · look-back 240h+ ${j.longChoices}/${j.of}`);
const P=j.pairs;
const med=a=>{const s=a.filter(x=>x!=null).sort((x,y)=>x-y);return s.length?(s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2):null;};
console.log(`median: early ${pc(med(P.map(p=>p.earlyPerTrade)))}% late ${pc(med(P.map(p=>p.latePerTrade)))}% blind ${pc(med(P.map(p=>p.blind)))}% lead ${pc(med(P.map(p=>p.lead)))}% worst late ${pc(med(P.map(p=>p.lateWorst)))}%`);
const cost=Number(j.cost);
const screens=[
  ["lead above nought",             p=>p.lead>0],
  ["late clears the round trip",    p=>p.latePerTrade>cost],
  ["ONE setting won both halves",   p=>p.sameBothHalves],
  ["whole agrees with the early half", p=>p.sameAsEarly],
  ["percentile 70 or better",       p=>p.percentile>=70],
  ["late windows paid, over half",  p=>p.lateWindows&&p.lateWindowsPaid/p.lateWindows>0.5],
  ["worst late window above -1%",   p=>p.lateWorst!=null&&p.lateWorst>-1],
];
console.log("\nHOW MANY OF THE "+P.length+" PAIRS CLEAR EACH SCREEN, ONE AT A TIME");
for(const [n,f] of screens) console.log(`  ${String(P.filter(f).length).padStart(3)} of ${P.length}  ${n}`);
let left=P.slice();
console.log("\nAND STACKED, IN THIS ORDER");
for(const [n,f] of screens){left=left.filter(f);console.log(`  ${String(left.length).padStart(3)} left  after ${n}`);}
console.log("\nWHAT SURVIVES ALL SEVEN");
console.log("coin   shape        back band    early     late    blind     lead  paid   pct both same");
for(const p of left.sort((a,b)=>b.lead-a.lead)) console.log(
  `${p.coin.replace("USDT","").padEnd(6)} ${String(p.geometry).padEnd(11)} ${String(p.lookback).padStart(4)} ${String(p.band).padStart(4)} ${pc(p.earlyPerTrade)} ${pc(p.latePerTrade)} ${pc(p.blind)} ${pc(p.lead)} ${(p.lateWindowsPaid+"/"+p.lateWindows).padStart(6)} ${String(Math.round(p.percentile)).padStart(3)}  ${p.sameBothHalves?"yes":" no"} ${p.sameAsEarly?"yes":" no"}`);
'
rm -f /tmp/w3-list.json /tmp/w3-split.json
