#!/usr/bin/env bash
# READ-ONLY. What this account pays to trade, as the box now reports it
# (3.166.0): the exchange records under Setup's Account tab, the figure in
# force, and whether it is the owner's or the built-in standing in. Also asks
# the Coins records door whether that same figure is riding with the answer the
# Coins screens read -- which is the whole point of the release. Writes
# nothing, starts nothing.
set -uo pipefail
echo "== /api/account =="
curl -sS -m 20 http://127.0.0.1:8094/api/account \
| node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d;try{d=JSON.parse(r)}catch(e){console.log("no answer: "+r.slice(0,200));return}
for(const e of d.exchanges||[])console.log("  "+e.label+": fee "+(e.feePerLeg==null?"not entered":(100*e.feePerLeg).toFixed(3)+"% each way")+(e.isDefault?"  [system default]":""));
const f=d.fee||{};console.log("  in force: "+(f.roundTripPct==null?"—":Number(f.roundTripPct).toFixed(3)+"% the round trip")+" from "+f.from+(f.set?"":"  (NOT SET — standing in)"));})'
echo "== does the Coins answer carry it =="
curl -sS -m 30 http://127.0.0.1:8094/api/coins/records \
| node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d;try{d=JSON.parse(r)}catch(e){console.log("no answer: "+r.slice(0,200));return}
console.log("  coins/records fee: "+(d.fee?JSON.stringify(d.fee):"MISSING — the walk table would show a dash"));})'
curl -sS -m 20 http://127.0.0.1:8094/api/coins/walk \
| node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{let d;try{d=JSON.parse(r)}catch(e){console.log("no answer: "+r.slice(0,200));return}
console.log("  coins/walk    fee: "+(d.fee?JSON.stringify(d.fee):"MISSING — the walk table would show a dash"));})'
