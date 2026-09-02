#!/usr/bin/env bash
# READ-ONLY. For every unit the stage 3 set carries: the Funnel's first step
# (how many values clear the bar, against chance) and its second step on the
# entry dial, so market entry -- the purest test of direction -- can be held
# beside its ten copies unit by unit. Then the stage 2 ranking as the page
# reads it, and the per-coin held-back table. Nothing is written.
set -uo pipefail
S=s3-mte0oajo-1; P=s2-mtdyamtf-1
cd /opt/ultimate-trading-system
node - <<'JS' > /tmp/uts-units.txt
const rowstore = require('./lib/rowstore');
const recs = rowstore.readAll('s2-mtdyamtf-1', 'records');
const ordered = recs.slice().sort((a, b) => ((b.beat || 0) - (a.beat || 0)) || ((b.lead || 0) - (a.lead || 0)));
for (const r of ordered.slice(0, 10)) console.log(`${r.trade}|${r.ctx1 || ''}|${r.ctx2 || ''}|${r.geometry}`);
JS
echo "== units (parent's top ten): $(tr '\n' ' ' < /tmp/uts-units.txt)"
post() { curl -sS -m 250 -H 'content-type: application/json' -d "$1" "http://127.0.0.1:8094/api/funnel/$S/read"; }
RULE='{"ranges":{},"allowed":{},"floors":{}}'
for U in $(cat /tmp/uts-units.txt); do
  T0=$(date +%s)
  post "{\"step\":1,\"rule\":$RULE,\"target\":200,\"unit\":\"$U\"}" > /tmp/uts-s1.json
  post "{\"step\":2,\"dial\":\"entry\",\"rule\":$RULE,\"target\":200,\"unit\":\"$U\"}" > /tmp/uts-s2.json
  node -e '
const fs=require("fs"); const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));
const d=JSON.parse(fs.readFileSync("/tmp/uts-s1.json","utf8"));
if(d.error){console.log("== "+process.argv[1]+" ERROR "+d.error);process.exit(0);}
const r=d.reading||{}; const h=r.honesty||{};
let line="== "+(d.unitName||d.unit)+"  settings "+d.of+"  clear the bar "+h.clear+" of "+h.of+" (by chance about "+f(h.byChance,1)+")";
const b=r.beating||{}; const parts=Object.keys(b).map(k=>k+" "+b[k].n+"/"+b[k].of);
console.log(line); console.log("   values beating, per dial: "+parts.join("  "));
const e=JSON.parse(fs.readFileSync("/tmp/uts-s2.json","utf8"));
if(e.error){console.log("   entry: ERROR "+e.error);process.exit(0);}
const rr=e.reading||{}; const by=new Map(((rr.rec||{}).values||[]).map(v=>[String(v.value),v]));
for(const g of (rr.groups||[])){const v=by.get(String(g.value))||{}; const c=(v.check||[]).filter(x=>x!=null);
  const beats=c.filter(x=>Math.round(g.mean*100)>Math.round(x*100)).length; const mean=c.length?c.reduce((a,b)=>a+b,0)/c.length:null;
  console.log("   entry "+String(g.value).padEnd(9)+" settings "+String(g.n).padStart(7)+"  real "+f(g.mean).padStart(9)+"  copies "+(c.length?f(Math.min(...c))+".."+f(Math.max(...c))+" (avg "+f(mean)+")":"-")+"  beats "+beats+" of "+c.length+"  lead "+f(v.lead));}
' "$U"
  echo "   ($(( $(date +%s) - T0 )) s)"
done
echo; echo "== the stage 2 ranking as the page reads it =="
curl -sS -m 60 "http://127.0.0.1:8094/api/stageset/$P/ranked?from=0&n=25" | node -e '
let raw=""; process.stdin.on("data",(c)=>raw+=c).on("end",()=>{ let d; try{d=JSON.parse(raw);}catch(e){console.log("NOT JSON",raw.slice(0,200));return;}
const rows=d.rows||[]; if(!rows.length){console.log("keys:",Object.keys(d).join(" "));return;}
console.log("saved sort:", JSON.stringify(d.sort||d.sortedBy||null), " row keys:", Object.keys(rows[0]).join(" "));
const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));
rows.forEach((r,i)=>console.log(String(i+1).padStart(2), (r.trade+"|"+(r.ctx1||"")+"|"+(r.ctx2||"")+"|"+r.geometry).padEnd(34), "beat",String(r.beat).padStart(3),"of",r.pairs," lead",f(r.lead)," score3",f(r.score3,1)," scoreAll",f(r.scoreAll,1)," helped",f(r.helped,2)));
});'
echo; echo "== the per-coin held-back table of the stage 3 set =="
curl -sS -m 120 "http://127.0.0.1:8094/api/stageset/$S/coins" | node -e '
let raw=""; process.stdin.on("data",(c)=>raw+=c).on("end",()=>{ let d; try{d=JSON.parse(raw);}catch(e){console.log("NOT JSON",raw.slice(0,200));return;}
const rows=d.rows||d.coins||[]; console.log("keys:",Object.keys(d).join(" ")," rows:",rows.length); if(!rows.length)return;
console.log("row keys:",Object.keys(rows[0]).join(" "));
const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));
for(const r of rows.slice(0,12)) console.log("  ", JSON.stringify(r).slice(0,300));
});'
