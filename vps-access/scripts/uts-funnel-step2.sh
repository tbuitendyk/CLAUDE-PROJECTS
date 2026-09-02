#!/usr/bin/env bash
# READ-ONLY. What the Funnel's second step shows for one dial on the set Boards
# has open -- the same read the page makes. The dial is the one the owner is
# looking at; edit DIAL to read another. Nothing is written.
set -uo pipefail
S=s3-mte0oajo-1; DIAL=gate
curl -sS -m 200 -H 'content-type: application/json' -d "{\"step\":2,\"dial\":\"$DIAL\",\"rule\":{\"ranges\":{},\"allowed\":{},\"floors\":{}},\"target\":200}" \
  "http://127.0.0.1:8094/api/funnel/$S/read" | node -e '
let raw=""; process.stdin.on("data",(c)=>raw+=c).on("end",()=>{
  const d=JSON.parse(raw); if(d.error){console.log("ERROR",d.error);return;}
  const r=d.reading||{}; const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));
  console.log("dial:",r.dial," shape:",r.shape," within (scatter):",f(r.within)," range $:",f(r.range)," survive:",d.survivors,"of",d.of," check:",JSON.stringify(d.check));
  const sh=r.splitHalf||{}; console.log("split-half shapes:",sh.a,"/",sh.b," agree:",sh.agrees);
  const rec=r.rec||{}; const by=new Map((rec.values||[]).map(v=>[String(v.value),v]));
  console.log("value".padEnd(14),"settings".padStart(9),"avg test $".padStart(11),"check lo..hi".padStart(16),"counts".padStart(7));
  for(const g of r.groups){const v=by.get(String(g.value))||{};const c=(v.check||[]).filter(x=>x!=null);
    console.log(String(g.value).padEnd(14),String(g.n).padStart(9),f(g.mean).padStart(11),(c.length?f(Math.min(...c))+".."+f(Math.max(...c)):"-").padStart(16),String(v.counts).padStart(7));}
  console.log("recommend:",JSON.stringify(rec.recommend)," why:",rec.why);
  console.log("conditions:",JSON.stringify(d.conditions));
});'
