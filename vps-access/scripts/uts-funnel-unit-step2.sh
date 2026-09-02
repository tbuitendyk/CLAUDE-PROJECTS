#!/usr/bin/env bash
# READ-ONLY. The Funnel's second step for one dial, read the way the page
# reads it, on ONE coin-and-shape unit and on the blended table -- so the
# unit's numbers can be held against the same figures worked out
# independently from the records. Nothing is written.
set -uo pipefail
S=s3-mte0oajo-1; DIAL=gate
for U in "XRPUSDT|||daily-4d" "BCHUSDT|||daily-4d" "all"; do
  echo "== unit: $U =="
  curl -sS -m 200 -H 'content-type: application/json' \
    -d "{\"step\":2,\"dial\":\"$DIAL\",\"rule\":{\"ranges\":{},\"allowed\":{},\"floors\":{}},\"target\":200,\"unit\":\"$U\"}" \
    "http://127.0.0.1:8094/api/funnel/$S/read" | node -e '
let raw=""; process.stdin.on("data",(c)=>raw+=c).on("end",()=>{
  let d; try { d=JSON.parse(raw); } catch (e) { console.log("NOT JSON:", raw.slice(0,300)); return; }
  if(d.error){console.log("ERROR",d.error);return;}
  const r=d.reading||{}; const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));
  console.log("board:",d.unit,"/",d.unitName," settings on the board:",d.of," survive:",d.survivors," check:",JSON.stringify(d.check));
  console.log("dial:",r.dial," shape:",r.shape," within (scatter):",f(r.within)," range $:",f(r.range));
  const rec=r.rec||{}; const by=new Map((rec.values||[]).map(v=>[String(v.value),v]));
  console.log("value".padEnd(14),"settings".padStart(9),"avg test $".padStart(11),"check lo..hi".padStart(16),"counts".padStart(7));
  for(const g of (r.groups||[])){const v=by.get(String(g.value))||{};const c=(v.check||[]).filter(x=>x!=null);
    console.log(String(g.value).padEnd(14),String(g.n).padStart(9),f(g.mean).padStart(11),(c.length?f(Math.min(...c))+".."+f(Math.max(...c)):"-").padStart(16),String(v.counts).padStart(7));}
  console.log("recommend:",JSON.stringify(rec.recommend));
});'
done
