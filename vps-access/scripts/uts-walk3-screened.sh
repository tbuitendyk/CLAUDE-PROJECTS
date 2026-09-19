#!/usr/bin/env bash
# uts-walk3-screened.sh -- READ-ONLY. test-walk-3 put through exactly the
# filter boxes that now exist on Choose early, read late, one at a time and
# then together, so the owner can read a cut-off off the counts before typing
# it. Reads the saved set by id; opens nothing, writes nothing.
set -uo pipefail
curl -s -m 60 -o /tmp/w3x.json http://127.0.0.1:8094/api/coins/walks
ID=$(node -e 'const j=JSON.parse(require("fs").readFileSync("/tmp/w3x.json","utf8"));const w=(j.walks||[]).find(x=>String(x.name||"").toLowerCase().includes("test-walk-3"));process.stdout.write(w?w.id:"")')
[ -n "$ID" ] || { echo "no test-walk-3"; exit 0; }
BANDS=$(node -e 'const j=JSON.parse(require("fs").readFileSync("/tmp/w3x.json","utf8"));const w=(j.walks||[]).find(x=>String(x.name||"").toLowerCase().includes("test-walk-3"));process.stdout.write(JSON.stringify((w.asked||{}).bands||[]))')
curl -s -m 300 -o /tmp/w3y.json -X POST http://127.0.0.1:8094/api/coins/walk/split \
  -H 'Content-Type: application/json' -d "{\"setId\":\"$ID\",\"minTrades\":30}"
BANDS="$BANDS" node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/w3y.json","utf8"));
const P=j.pairs, cost=Number(j.cost);
const bands=JSON.parse(process.env.BANDS).map(Number);
const lo=Math.min(...bands), hi=Math.max(...bands);
const share=(n,of)=>(of?(n/of)*100:null);
const pc=(v,d=3)=>(v==null?"  —":((v>0?"+":"")+Number(v).toFixed(d))).padStart(8);
// THE BOXES, exactly as they are named on the screen. Blank hides nothing.
const BOX=[
 ["least lead, %",              0,    p=>p.lead],
 ["least late, %",              cost, p=>p.latePerTrade],
 ["least late windows paid, %", 50,   p=>share(p.lateWindowsPaid,p.lateWindows)],
 ["least percentile",           70,   p=>p.percentile],
 ["fewest late windows",        5,    p=>p.lateWindows],
 ["least whole per trade, %",   cost, p=>p.wholePerTrade],
];
console.log(`test-walk-3 (${j.setId}) · ${P.length} pair(s) at fewest trades each half must have 30 · round trip ${cost}% · sit-out bands to try ${lo} to ${hi}`);
console.log("\nEACH BOX ON ITS OWN -- how many of the "+P.length+" it leaves");
for(const [n,v,f] of BOX) console.log(`  ${String(P.filter(p=>f(p)!=null&&f(p)>=v).length).padStart(3)} left   ${n} = ${v}`);
let left=P.slice();
console.log("\nALL SIX TOGETHER, in the order you would type them");
for(const [n,v,f] of BOX){left=left.filter(p=>f(p)!=null&&f(p)>=v);console.log(`  ${String(left.length).padStart(3)} left   ${n} = ${v}`);}
const both=left.filter(p=>p.sameBothHalves), same=left.filter(p=>p.sameAsEarly);
console.log(`\n  of those ${left.length}: ${both.length} would survive the tick only rows best on both halves, ${same.length} the tick only rows same pick`);
const clean=left.filter(p=>(p.wholeAsGood??99)<=10&&(p.wholeAsGoodSlid??99)<=10);
console.log(`  ${clean.length} of them have 10 or fewer scrambles as good AND 10 or fewer slides as good on the row a tick promotes`);
const edge=left.filter(p=>p.wholeBand===hi||p.wholeBand===lo);
console.log(`  ${edge.length} of them would carry a band-edge marker: ${left.filter(p=>p.wholeBand===hi).length} highest tried, ${left.filter(p=>p.wholeBand===lo).length} lowest tried`);
console.log("\nWHAT IS LEFT, sorted by lead high to low -- and the row a tick on each one promotes");
console.log("coin   shape         late     lead  paid  pct  win | tick promotes: back band    /trade  scr sld  edge  both same");
for(const p of left.sort((a,b)=>b.lead-a.lead)) console.log(
 `${p.coin.replace("USDT","").padEnd(6)} ${String(p.geometry).padEnd(10)} ${pc(p.latePerTrade)} ${pc(p.lead)} ${(p.lateWindowsPaid+"/"+p.lateWindows).padStart(5)} ${String(Math.round(p.percentile)).padStart(3)} ${String(p.lateWindows).padStart(4)} |`
 +` ${String(p.wholeLookback).padStart(5)} ${String(p.wholeBand).padStart(4)} ${pc(p.wholePerTrade)} ${String(p.wholeAsGood).padStart(4)} ${String(p.wholeAsGoodSlid).padStart(3)}`
 +`  ${(p.wholeBand===hi?"HIGH":(p.wholeBand===lo?"low ":"  · ")).padEnd(4)}  ${p.sameBothHalves?"yes":" no"} ${p.sameAsEarly?"yes":" no"}`);
'
rm -f /tmp/w3x.json /tmp/w3y.json
