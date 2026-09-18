#!/usr/bin/env bash
# READ-ONLY. The exact state of the Coins tab's own controls on the box: the
# sit-out band and its tick, the look-backs SET against the look-backs the
# records actually CARRY, and per coin and shape which look-backs are stored.
# Writes nothing, starts nothing.
set -uo pipefail
curl -sS -m 90 http://127.0.0.1:8094/api/coins/records \
| node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d;try{d=JSON.parse(r)}catch(e){console.log("no answer: "+r.slice(0,300));return}
const b=d.band||{};console.log("sit-out band: value "+b.value+"  default "+b.default+"  each shape at its own sweet spot: "+(b.auto?"ON":"off"));
const L=d.lookbacks||{};
console.log("look-backs SET     : "+(L.value||[]).join(","));
console.log("look-backs DEFAULT : "+(L.default||[]).join(","));
console.log("look-backs IN RECORDS: "+(L.inRecords||[]).join(","));
const setA=new Set(L.value||[]),inA=new Set(L.inRecords||[]);
const missing=[...setA].filter(h=>!inA.has(h)), extra=[...inA].filter(h=>!setA.has(h));
console.log("  set but NOT stored (the walk cannot use these): "+(missing.length?missing.join(","):"none"));
console.log("  stored but no longer set (the walk CAN still use these): "+(extra.length?extra.join(","):"none"));
const p=(d.passers&&d.passers.rows)||[];
console.log("\npassers "+p.length+" at bar "+(d.passers&&d.passers.bar)+" of "+(d.passers&&d.passers.trials));
for(const x of p)console.log("  "+(x.ticked?"TICK":"off ")+"  "+x.coin+" "+x.geometry+"  band "+x.band+"  lean rising "+(x.lean?x.lean.rising:"—")+" falling "+(x.lean?x.lean.falling:"—")+"  yardstick "+(x.yardstick==null?"—":x.yardstick));
console.log("\nper coin: the band each shape is DRAWN at, and where it came from");
for(const row of (d.rows||[]).slice(0,4)){
  if(!row.read)continue;
  const bits=[];
  for(const [k,s] of Object.entries(row.shapes||{})){ if(!s||!s.periods)continue; bits.push(k+" "+(s.band?s.band.value+"("+s.band.source+")":"—")+(s.signal&&s.signal.sweetSpot?" spot "+s.signal.sweetSpot.band:" spot none")); }
  console.log("  "+row.coin+": "+bits.join("  |  "));
}
console.log("\nband grid the sweet spot is searched on: 0..300 step 10 (lib/coinsignal.js BAND_GRID)");
})'
