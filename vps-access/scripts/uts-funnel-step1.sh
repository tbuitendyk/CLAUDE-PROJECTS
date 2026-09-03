#!/usr/bin/env bash
# READ-ONLY. What the Funnel's first step is showing for the set Boards has
# open, straight from the service on this box -- the same read the page makes.
# Nothing is written; the walk's state lives in the owner's browser.
set -uo pipefail
S=${1:-s3-mtl42g1m-3}
curl -sS -m 200 -H 'content-type: application/json' -d '{"step":1,"rule":{"ranges":{},"allowed":{},"floors":{}},"target":200}' \
  "http://127.0.0.1:8094/api/funnel/$S/read" | node -e '
let raw=""; process.stdin.on("data",(c)=>raw+=c).on("end",()=>{
  const d=JSON.parse(raw); if(d.error){console.log("ERROR",d.error);return;}
  console.log("set:",d.set.name," settings:",d.of," survive:",d.survivors," target:",d.target," check:",JSON.stringify(d.check)," kept:",d.set.keptScrambles);
  console.log("unit:",d.unit," unitName:",d.unitName," units on the set:",(d.units||[]).length," names:",(d.units||[]).map(u=>u.name).join(" | "));
  const rr=d.reading||{}; if(rr.honesty) console.log("honesty:",JSON.stringify(rr.honesty)); if(rr.beating) console.log("beating:",JSON.stringify(rr.beating));
  const r=d.reading||{};
  if(r.why){console.log("why:",r.why);return;}
  const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));
  console.log("dial".padEnd(14),"movement".padStart(9),"check lo..hi".padStart(16),"beats all".padStart(10),"range $".padStart(9),"values".padStart(7),"even".padStart(6));
  for(const x of r.dials){const ms=(r.checkM||{})[x.dial]||[];const fin=ms.filter(m=>m!=null);
    console.log(x.dial.padEnd(14),f(x.m).padStart(9),(fin.length?f(Math.min(...fin))+".."+f(Math.max(...fin)):"-").padStart(16),String((r.counts||{})[x.dial]).padStart(10),f(x.range).padStart(9),String((x.values||[]).length).padStart(7),f((x.balance||{}).even).padStart(6));}
  const sh=r.splitHalf||{}; console.log("split-half:",sh.why?sh.why:`A leads ${sh.a.join(", ")} | B leads ${sh.b.join(", ")} | agree: ${sh.agrees}`);
  console.log("not evenly swept:",(r.lopsided||[]).join(", ")||"none");
  console.log("not measurable:",(r.skipped||[]).map(s=>s.dial+" ("+s.why+")").join("; ")||"none");
  console.log("conditions:",JSON.stringify(d.conditions));
});'
