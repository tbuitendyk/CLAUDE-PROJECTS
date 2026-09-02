#!/usr/bin/env bash
# READ-ONLY. The Funnel's first step on one unit with the settings whose gate
# ignores the forecast (always) left out by a rule -- the same read the page
# makes with gate narrowed to active and directional -- and step 2 for the
# dials it lists, so the question "does always hide the signal?" is answered
# from the records rather than argued. Nothing is written.
set -uo pipefail
S=s3-mte0oajo-1
RULE='{"ranges":{},"allowed":{"gate":["active","directional"]},"floors":{}}'
post() { curl -sS -m 200 -H 'content-type: application/json' -d "$1" "http://127.0.0.1:8094/api/funnel/$S/read"; }
for U in "DOGEUSDT|||daily-1d" "XRPUSDT|||daily-4d" "BCHUSDT|||daily-4d"; do
  echo "== unit: $U  (gate: active, directional only) =="
  post "{\"step\":1,\"rule\":$RULE,\"target\":200,\"unit\":\"$U\"}" > /tmp/uts-s1.json
  node -e '
const d=JSON.parse(require("fs").readFileSync("/tmp/uts-s1.json","utf8")); if(d.error){console.log("ERROR",d.error);process.exit(0);}
console.log("survive:",d.survivors,"of",d.of," check:",JSON.stringify(d.check));
const r=d.reading||{}; if(r.why){console.log("why:",r.why);process.exit(0);}
const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));
console.log("dial".padEnd(14),"movement".padStart(9),"values beating".padStart(15),"bold".padStart(6));
for(const x of r.dials){const b=(r.beating||{})[x.dial]||{}; console.log(x.dial.padEnd(14),f(x.m).padStart(9),`${b.n} of ${b.of}`.padStart(15),String((r.counts||{})[x.dial]).padStart(6));}
require("fs").writeFileSync("/tmp/uts-dials.txt", r.dials.slice(0,5).map(x=>x.dial).join("\n"));
'
  for DIAL in $(cat /tmp/uts-dials.txt); do
    post "{\"step\":2,\"dial\":\"$DIAL\",\"rule\":$RULE,\"target\":200,\"unit\":\"$U\"}" | node -e '
let raw=""; process.stdin.on("data",(c)=>raw+=c).on("end",()=>{
  const d=JSON.parse(raw); if(d.error){console.log("ERROR",d.error);return;}
  const r=d.reading||{}; const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));
  const rec=r.rec||{}; const by=new Map((rec.values||[]).map(v=>[String(v.value),v]));
  console.log("-- "+r.dial+" ("+r.shape+")");
  for(const g of (r.groups||[])){const v=by.get(String(g.value))||{};const c=(v.check||[]).filter(x=>x!=null);
    const beats=c.filter(x=>Math.round(g.mean*100)>Math.round(x*100)).length;
    console.log("   "+String(g.value).padEnd(12),String(g.n).padStart(8),f(g.mean).padStart(10),(c.length?f(Math.min(...c))+".."+f(Math.max(...c)):"-").padStart(16),`beats ${beats} of ${c.length}`.padStart(15));}
});'
  done
done
