#!/usr/bin/env bash
# uts-walk3-shortlist.sh -- READ-ONLY. Where every column of the Choose early,
# read late reading on test-walk-3 actually sits, so a cut-off is read off the
# data instead of invented, and what is left when the screens are stacked in
# the order that survives. Reads the saved set by id; opens nothing, writes
# nothing.
set -uo pipefail
curl -s -m 60 -o /tmp/w3l.json http://127.0.0.1:8094/api/coins/walks
ID=$(node -e 'const j=JSON.parse(require("fs").readFileSync("/tmp/w3l.json","utf8"));const w=(j.walks||[]).find(x=>String(x.name||"").toLowerCase().includes("test-walk-3"));process.stdout.write(w?w.id:"")')
[ -n "$ID" ] || { echo "no test-walk-3"; exit 0; }
curl -s -m 300 -o /tmp/w3s.json -X POST http://127.0.0.1:8094/api/coins/walk/split \
  -H 'Content-Type: application/json' -d "{\"setId\":\"$ID\",\"minTrades\":30}"
node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/w3s.json","utf8"));
const P=j.pairs; const cost=Number(j.cost);
const q=(a,f)=>{const s=a.map(f).filter(v=>v!=null).sort((x,y)=>x-y);const at=p=>s[Math.min(s.length-1,Math.max(0,Math.round(p*(s.length-1))))];return s.length?[at(0),at(.25),at(.5),at(.75),at(1)]:null;};
const n=(v,d=2)=>(v==null?"—":((v>0?"+":"")+Number(v).toFixed(d)));
console.log(`${P.length} pairs · ${new Set(P.map(p=>p.coin)).size} coins x ${new Set(P.map(p=>p.geometry)).size} shapes · round trip ${cost}%`);
console.log("\nWHERE EACH COLUMN SITS  (worst / quarter / middle / three-quarter / best)");
for(const [lab,f] of [["early",p=>p.earlyPerTrade],["late",p=>p.latePerTrade],["picking blind",p=>p.blind],["lead",p=>p.lead],["worst late window",p=>p.lateWorst],["percentile",p=>p.percentile],["whole per trade",p=>p.wholePerTrade]]){
  const Q=q(P,f); console.log(`  ${lab.padEnd(18)} ${Q.map(v=>n(v).padStart(8)).join(" ")}`);
}
const sh=(f)=>{const a=P.map(f).filter(v=>v!=null).sort((x,y)=>x-y);return a;};
const paid=P.filter(p=>p.lateWindows).map(p=>p.lateWindowsPaid/p.lateWindows).sort((a,b)=>a-b);
console.log(`  late windows paid  ${[0,.25,.5,.75,1].map(p=>(100*paid[Math.round(p*(paid.length-1))]).toFixed(0).padStart(7)+"%").join(" ")}`);
const ag=sh(p=>p.wholeAsGood), sl=sh(p=>p.wholeAsGoodSlid);
console.log(`  scrambles as good (on the whole-history row, out of 100)  ${[0,.25,.5,.75,1].map(p=>String(ag[Math.round(p*(ag.length-1))]).padStart(5)).join(" ")}`);
console.log(`  slides as good     (same row)                             ${[0,.25,.5,.75,1].map(p=>String(sl[Math.round(p*(sl.length-1))]).padStart(5)).join(" ")}`);
const order=[
 ["lead above nought",                p=>p.lead>0],
 ["late clears the round trip",       p=>p.latePerTrade>cost],
 ["over half the late windows paid",  p=>p.lateWindows&&p.lateWindowsPaid/p.lateWindows>0.5],
 ["percentile 70 or better",          p=>p.percentile>=70],
 ["whole per trade clears the trip",  p=>p.wholePerTrade!=null&&p.wholePerTrade>cost],
 ["10 or fewer scrambles as good",    p=>p.wholeAsGood!=null&&p.wholeAsGood<=10],
 ["10 or fewer slides as good",       p=>p.wholeAsGoodSlid!=null&&p.wholeAsGoodSlid<=10],
];
let left=P.slice();
console.log("\nSTACKED IN THIS ORDER");
for(const [t,f] of order){left=left.filter(f);console.log(`  ${String(left.length).padStart(3)} left  after ${t}`);}
const both=left.filter(p=>p.sameBothHalves);
console.log(`  ${String(both.length).padStart(3)} of those also had ONE setting win both halves`);
const pc=(v,d=3)=>(v==null?"  —":((v>0?"+":"")+Number(v).toFixed(d))).padStart(8);
console.log("\nTHE SHORTLIST, and the settings the WHOLE history chooses for each -- which is what to tick");
console.log("coin   shape        late    lead  paid  pct | whole back band  whole/trade  scr sld  both");
for(const p of left.sort((a,b)=>b.wholePerTrade-a.wholePerTrade)) console.log(
 `${p.coin.replace("USDT","").padEnd(6)} ${String(p.geometry).padEnd(10)} ${pc(p.latePerTrade)} ${pc(p.lead)} ${(p.lateWindowsPaid+"/"+p.lateWindows).padStart(5)} ${String(Math.round(p.percentile)).padStart(3)} | ${String(p.wholeLookback).padStart(5)} ${String(p.wholeBand).padStart(4)} ${pc(p.wholePerTrade)} ${String(p.wholeAsGood).padStart(4)} ${String(p.wholeAsGoodSlid).padStart(3)}  ${p.sameBothHalves?"yes":"no"}`);
'
rm -f /tmp/w3l.json /tmp/w3s.json
