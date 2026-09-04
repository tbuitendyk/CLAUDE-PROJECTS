#!/usr/bin/env bash
# READ-ONLY. Step 2's value table for the decision dial on XRPUSDT weekly-8d,
# under two rules the owner has on screen (gate = directional; and gate =
# directional with t 65..137), at bar 90% and 80%: each value's settings,
# average test money, the copies' spread, how many copies it beats, its lead
# and the recommendation. Nothing written.
set -uo pipefail
S=${1:-s3-mtl42g1m-3}; U="XRPUSDT|||weekly-8d"
table() { node -e 'let raw="";process.stdin.on("data",c=>raw+=c).on("end",()=>{const d=JSON.parse(raw);if(d.error){console.log("ERROR",d.error);return;}if(d.waiting){console.log("WAIT",d.waiting);return;}const r=d.reading||{};const rec=r.rec||{};const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));
    console.log("survive",d.survivors,"of",d.of," check",JSON.stringify(d.check)," why",JSON.stringify(r.why||null));
    const g=new Map((r.groups||[]).map(x=>[String(x.value),x]));
    console.log("value".padStart(12),"settings".padStart(9),"avg test".padStart(9),"copies lo".padStart(10),"copies hi".padStart(10),"copies avg".padStart(11),"beats".padStart(6),"lead".padStart(6),"counts");
    for(const v of (rec.values||[])){const gg=g.get(String(v.value))||{};const c=(v.check||[]).filter(x=>x!=null);const avg=c.length?c.reduce((a,b)=>a+b,0)/c.length:null;
      console.log(String(v.value).padStart(12),String(gg.n??v.n??"-").padStart(9),f(gg.mean??v.mean).padStart(9),f(c.length?Math.min(...c):null).padStart(10),f(c.length?Math.max(...c):null).padStart(10),f(avg).padStart(11),String(v.beaten).padStart(6),f(v.lead,1).padStart(6),v.counts?"BOLD":"");}
    console.log("groups:",JSON.stringify((r.groups||[]).map(x=>({value:x.value,n:x.n,mean:x.mean==null?null:+Number(x.mean).toFixed(2),median:x.median==null?null:+Number(x.median).toFixed(2),share:x.share}))));
    console.log("recommend:",JSON.stringify(rec.recommend),"why:",rec.why||null);});'; }
for RULE in '{"ranges":{},"allowed":{"gate":["directional"]},"floors":{}}' '{"ranges":{"tHours":{"min":65,"max":137}},"allowed":{"gate":["directional"]},"floors":{}}'; do
  for BAR in 90 80; do
    echo "== rule $RULE  bar ${BAR}% =="
    curl -sS -m 250 -H 'content-type: application/json' -d "{\"step\":2,\"dial\":\"decision\",\"unit\":\"$U\",\"rule\":$RULE,\"target\":200,\"barPct\":$BAR,\"closing\":{\"key\":\"rule\"}}" "http://127.0.0.1:8094/api/funnel/$S/read" | table
  done
done
