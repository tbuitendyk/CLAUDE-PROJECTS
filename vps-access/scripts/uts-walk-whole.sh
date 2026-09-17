#!/usr/bin/env bash
# uts-walk-whole.sh -- READ-ONLY. The whole of the owner's finished walk:
# how many rows beat all their copies each way, how many beat both, how many
# also hold every window, and where those rows sit. Nothing is written.
set -uo pipefail
curl -s -m 240 -o /tmp/uts-ww.json http://127.0.0.1:8094/api/coins/walk
node -e '
const j = JSON.parse(require("fs").readFileSync("/tmp/uts-ww.json","utf8"));
const all = j.rows || []; const rows = all.filter((r)=>r.perTrade!=null);
const K = (j.asked||{}).scrambles || 0; const COST = 0.25;
const pc=(v,d=3)=>((v>0?"+":"")+Number(v).toFixed(d)).padStart(7);
const chance = rows.length/(K+1);
const dealt = rows.filter((r)=>r.asGood===0);
const slid  = rows.filter((r)=>r.asGoodSlid===0);
const both  = rows.filter((r)=>r.asGood===0 && r.asGoodSlid===0);
const haveSlid = rows.filter((r)=>r.asGoodSlid!=null).length;
console.log(`rows ${all.length} (${rows.length} priced) | ${K} copies each way | a row beats all ${K} by luck about 1 in ${K+1}, so ~${chance.toFixed(0)} rows`);
console.log(`beat all DEALT ${dealt.length}   beat all SLID ${slid.length}   beat BOTH ${both.length}   (slid count present on ${haveSlid})`);
let sd=0,ss=0; for(const r of rows){sd+=r.asGood;ss+=r.asGoodSlid;}
console.log(`average copies as good: dealt ${(sd/rows.length).toFixed(1)} of ${K}, slid ${(ss/rows.length).toFixed(1)} of ${K}  (fair is ${(K/2).toFixed(0)})`);
const disagree = rows.filter((r)=>Math.abs(r.asGood-r.asGoodSlid)>=K*0.2).length;
console.log(`rows where the two counts differ by a fifth of the copies or more: ${disagree}`);
// THE STRICT FILTER: beats both, every counted window up, enough windows, and
// still pays after the round trip the system charges itself.
const strict = both.filter((r)=>r.windows>=10 && r.windowsUp===r.windows && (r.perTrade-COST)>0)
  .sort((a,b)=>b.perTrade-a.perTrade);
console.log(`\nEVERY WINDOW UP on 10+ windows, beats both, and pays after ${COST}% a round trip: ${strict.length} row(s)`);
console.log("coin       shape        look-back  band   trades  per trade    net   windows  worst");
for (const r of strict.slice(0,28)) console.log(
  `${r.coin.replace("USDT","").padEnd(7)}  ${String(r.geometry).padEnd(11)}  ${String(r.lookback).padStart(6)}  ${String(r.band).padStart(5)}  ${String(r.trades).padStart(6)}  ${pc(r.perTrade)}% ${pc(r.perTrade-COST)}%  ${String(r.windowsUp)+" of "+r.windows}   ${pc(r.worst,2)}%`);
if (strict.length>28) console.log(`... and ${strict.length-28} more`);
const byCoin={}; for(const r of strict){const k=r.coin.replace("USDT","")+" "+r.geometry; byCoin[k]=(byCoin[k]||0)+1;}
console.log(`\nthose ${strict.length} rows sit on ${Object.keys(byCoin).length} coin-and-shape pair(s): ` +
  Object.entries(byCoin).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k} x${n}`).join(", ").slice(0,900));
' 2>&1 | head -60
rm -f /tmp/uts-ww.json
