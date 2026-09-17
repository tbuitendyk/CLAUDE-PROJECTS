#!/usr/bin/env bash
# uts-walk-spread2.sh -- READ-ONLY. Is the tilt one coin or the whole box?
# Per coin-and-shape: rows that beat both sets of copies, and pooled money.
# Then LTC daily-1d across every look-back at band 200, and 312h/200 on every
# coin, so a plateau can be told from a spike. Nothing is written.
set -uo pipefail
curl -s -m 240 -o /tmp/uts-ws.json http://127.0.0.1:8094/api/coins/walk
node -e '
const j = JSON.parse(require("fs").readFileSync("/tmp/uts-ws.json","utf8"));
const rows = (j.rows||[]).filter((r)=>r.perTrade!=null); const K=(j.asked||{}).scrambles||100;
const pc=(v,d=3)=>(v==null?"   —  ":((v>0?"+":"")+Number(v).toFixed(d))).padStart(7);
const backs=[...new Set(rows.map((r)=>String(r.lookback)))];
const bands=[...new Set(rows.map((r)=>r.band))].sort((a,b)=>a-b);
const pairs=[...new Set(rows.map((r)=>r.coin+"|"+r.geometry))];
console.log(`${rows.length} priced rows = ${pairs.length} coin-and-shape pair(s) x ${backs.length} look-back(s) x ${bands.length} band(s)`);
console.log(`bands: ${bands.join(" ")}`);
console.log(`look-backs: ${backs.sort((a,b)=>(a==="own"?-1:+a)-(b==="own"?-1:+b)).join(" ")}`);
const per={};
for(const r of rows){const k=r.coin.replace("USDT","")+" "+r.geometry;(per[k]=per[k]||{n:0,both:0,t:0,s:0,best:null}).n++;
  if(r.asGood===0&&r.asGoodSlid===0)per[k].both++; per[k].t+=r.trades; per[k].s+=r.perTrade*r.trades;
  if(per[k].best==null||r.perTrade>per[k].best)per[k].best=r.perTrade;}
const list=Object.entries(per).sort((a,b)=>b[1].both-a[1].both);
const withAny=list.filter(([,v])=>v.both>0).length;
console.log(`\npairs with at least one row beating BOTH: ${withAny} of ${pairs.length}`);
console.log("pair              rows  beat both   pooled money   best row");
for(const [k,v] of list.slice(0,16)) console.log(`${k.padEnd(18)} ${String(v.n).padStart(4)}   ${String(v.both).padStart(3)}      ${pc(v.t?v.s/v.t:null)}%      ${pc(v.best)}%`);
const zero=list.filter(([,v])=>v.both===0).length;
console.log(`... ${zero} pair(s) had none at all`);
// the ladder: one coin, one shape, one band, every look-back
const lad=(coin,geo,band)=>{const g=rows.filter((r)=>r.coin===coin&&r.geometry===geo&&r.band===band)
  .sort((a,b)=>(a.lookback==="own"?-1:+a.lookback)-(b.lookback==="own"?-1:+b.lookback));
  console.log(`\n${coin.replace("USDT","")} ${geo} band ${band} — every look-back:`);
  console.log("look-back  trades  per trade  windows up   dealt  slid");
  for(const r of g) console.log(`${String(r.lookback).padStart(7)}  ${String(r.trades).padStart(6)}  ${pc(r.perTrade)}%  ${(r.windowsUp+" of "+r.windows).padStart(9)}   ${String(r.asGood).padStart(4)}  ${String(r.asGoodSlid).padStart(4)}`);};
lad("LTCUSDT","daily-1d",200);
// and the same cell on every coin
const cell=rows.filter((r)=>String(r.lookback)==="312"&&r.band===200&&r.geometry==="daily-1d").sort((a,b)=>b.perTrade-a.perTrade);
console.log(`\ndaily-1d, look-back 312h, band 200 — every coin:`);
console.log("coin     trades  per trade  windows up   dealt  slid");
for(const r of cell) console.log(`${r.coin.replace("USDT","").padEnd(6)}  ${String(r.trades).padStart(6)}  ${pc(r.perTrade)}%  ${(r.windowsUp+" of "+r.windows).padStart(9)}   ${String(r.asGood).padStart(4)}  ${String(r.asGoodSlid).padStart(4)}`);
' 2>&1 | head -80
rm -f /tmp/uts-ws.json
