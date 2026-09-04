#!/usr/bin/env bash
# READ-ONLY. Step 2's value table for tHours on XRPUSDT weekly-8d under the
# owner's rule (gate = directional), at two bars, as the page receives it: each
# value's settings, average test money, the copies' spread, how many copies it
# beats, its lead, and the recommendation. Nothing written.
set -uo pipefail
S=${1:-s3-mtl42g1m-3}; U="XRPUSDT|||weekly-8d"
R='{"ranges":{},"allowed":{"gate":["directional"]},"floors":{}}'
for BAR in 90 75; do
  echo "== bar ${BAR}% =="
  curl -sS -m 200 -H 'content-type: application/json' -d "{\"step\":2,\"dial\":\"tHours\",\"unit\":\"$U\",\"rule\":$R,\"target\":200,\"barPct\":$BAR,\"closing\":{\"key\":\"rule\"}}" "http://127.0.0.1:8094/api/funnel/$S/read" \
  | node -e 'let raw="";process.stdin.on("data",c=>raw+=c).on("end",()=>{const d=JSON.parse(raw);const r=d.reading||{};const rec=r.rec||{};const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));
    console.log("survive",d.survivors,"of",d.of," check",JSON.stringify(d.check)," shape",r.shape," within",f(r.within)," range$",f(r.range));
    const g=new Map((r.groups||[]).map(x=>[String(x.value),x]));
    console.log("value".padStart(6),"settings".padStart(9),"avg test".padStart(9),"copies lo".padStart(10),"copies hi".padStart(10),"copies avg".padStart(11),"beats".padStart(6),"lead".padStart(6),"counts");
    for(const v of (rec.values||[])){const gg=g.get(String(v.value))||{};const c=(v.check||[]).filter(x=>x!=null);const avg=c.length?c.reduce((a,b)=>a+b,0)/c.length:null;
      console.log(String(v.value).padStart(6),String(gg.n??v.n??"-").padStart(9),f(gg.mean??v.mean).padStart(9),f(c.length?Math.min(...c):null).padStart(10),f(c.length?Math.max(...c):null).padStart(10),f(avg).padStart(11),String(v.beaten).padStart(6),f(v.lead,1).padStart(6),v.counts?"BOLD":"");}
    console.log("recommend:",JSON.stringify(rec.recommend),"why:",rec.why||null," split-half:",JSON.stringify(r.splitHalf));});'
done
