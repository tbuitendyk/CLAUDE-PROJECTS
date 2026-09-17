#!/usr/bin/env bash
# uts-walk-split.sh -- READ-ONLY. The pre-registered reading: each coin and
# shape's best row is chosen on its EARLY windows alone and read on its LATE
# ones. The pass mark was fixed before the run (REGIME-DESIGN.md Part 7).
set -uo pipefail
curl -s -m 240 -o /tmp/uts-sp.json -X POST http://127.0.0.1:8094/api/coins/walk/split \
  -H 'Content-Type: application/json' -d '{"minTrades":30}'
node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/uts-sp.json","utf8"));
if(j.none){console.log("no finished walk:",j.why);process.exit(0);}
const pc=(v,d=3)=>(v==null?"   —  ":((v>0?"+":"")+Number(v).toFixed(d))).padStart(7);
console.log(`VERDICT ${j.verdict}  (pass needs beat >= ${Math.ceil(j.of*60/90)} of ${j.of} AND pooled late > ${j.cost}%)`);
console.log(`pairs ${j.of} · beat picking blind ${j.beat} of ${j.of} (chance ${j.chance}) · pooled late ${pc(j.pooled)}% · after the round trip ${pc(j.netPooled)}%`);
console.log(`picks that pay after costs ${j.paid} of ${j.of} · average percentile ${j.meanPercentile==null?"—":j.meanPercentile.toFixed(1)} (50 is no skill) · chose a look-back of 240h+ ${j.longChoices} of ${j.of}`);
const P=j.pairs;
const med=(a)=>{const s=a.slice().sort((x,y)=>x-y);return s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2;};
console.log(`median lead ${pc(med(P.map(p=>p.lead)))}% · median late ${pc(med(P.map(p=>p.latePerTrade)))}% · median blind ${pc(med(P.map(p=>p.blind)))}%`);
const line=(p)=>`${p.coin.replace("USDT","").padEnd(6)} ${p.geometry.padEnd(10)} ${String(p.lookback).padStart(5)} ${String(p.band).padStart(4)} ${pc(p.earlyPerTrade)} ${pc(p.latePerTrade)} ${pc(p.blind)} ${pc(p.lead)} ${(p.lateWindowsUp+"/"+p.lateWindows).padStart(6)} ${String(Math.round(p.percentile)).padStart(3)}`;
console.log("\ncoin   shape       back band   early    late   blind    lead  wins pct");
for(const p of P.slice(0,22)) console.log(line(p));
console.log("  ... middle omitted ...");
for(const p of P.slice(-8)) console.log(line(p));
const ltc=P.filter(p=>p.coin==="LTCUSDT");
console.log("\nLTC on every shape:");
for(const p of ltc) console.log(line(p));
' 2>&1 | head -60
rm -f /tmp/uts-sp.json
