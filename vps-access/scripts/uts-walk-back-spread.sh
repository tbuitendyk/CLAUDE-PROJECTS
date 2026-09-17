#!/usr/bin/env bash
# uts-walk-back-spread.sh -- READ-ONLY. Is the long look-back one coin or many?
# Two readings: the pooled money per look-back across EVERY coin and shape, and
# how many distinct coins carry a row that beat all its copies at each one.
set -uo pipefail
curl -s -m 180 -o /tmp/uts-wb.json http://127.0.0.1:8094/api/coins/walk
node -e '
const j = JSON.parse(require("fs").readFileSync("/tmp/uts-wb.json","utf8"));
const rows = (j.rows||[]).filter((r)=>r.perTrade!=null); const cop=(j.asked||{}).scrambles||50;
const f=(v,d=3)=>(v==null?"  —   ":((v>0?"+":"")+Number(v).toFixed(d)).padStart(7));
const key=(r)=>String(r.lookback);
const backs=[...new Set(rows.map(key))].sort((a,b)=>(a==="own"?-1:Number(a))-(b==="own"?-1:Number(b)));
console.log("look-back   rows  trade-weighted money   beat all copies   distinct coins doing it");
for (const b of backs) {
  const g=rows.filter((r)=>key(r)===b);
  let n=0,s=0; for(const r of g){n+=r.trades;s+=r.perTrade*r.trades;}
  const win=g.filter((r)=>r.asGood===0);
  const coins=new Set(win.map((r)=>r.coin));
  console.log(`${b.padStart(6)}   ${String(g.length).padStart(4)}   ${f(n?s/n:null)}%            ${String(win.length).padStart(4)} of ${String(g.length).padStart(4)}       ${String(coins.size).padStart(2)}  ${[...coins].map((c)=>c.replace("USDT","")).sort().join(" ")}`);
}
' 2>&1 | head -30
rm -f /tmp/uts-wb.json
