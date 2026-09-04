#!/usr/bin/env bash
# READ-ONLY. The Funnel under the OWNER'S OWN RULE, pasted from the line under
# "The rule so far" on 2026-09-04, on XRPUSDT weekly-8d: step 1 (which dials
# still move the money), and step 3's grid for quorum bar against share at
# bar 90% and 80%. Nothing written.
set -uo pipefail
S=${1:-s3-mtl42g1m-3}; U="XRPUSDT|||weekly-8d"; B=http://127.0.0.1:8094
R='{"ranges":{"tHours":{"min":65,"max":137},"agreePersist":{"min":0,"max":0},"agreePct":{"min":10,"max":30}},"allowed":{"gate":["directional"],"weekdaysOnly":["false"],"decision":["directional"],"agreeBar":["all","own"],"entry":["breakout","market"]},"floors":{}}'
echo "=== step 1, bar 90% ==="
curl -sS -m 280 -H 'content-type: application/json' -d "{\"step\":1,\"unit\":\"$U\",\"rule\":$R,\"target\":200,\"barPct\":90}" "$B/api/funnel/$S/read" \
| node -e 'let raw="";process.stdin.on("data",c=>raw+=c).on("end",()=>{const d=JSON.parse(raw);if(d.error){console.log("ERROR",d.error);return;}if(d.totalling||d.waiting||d.failed){console.log("NOT READY",JSON.stringify({totalling:d.totalling,waiting:d.waiting,failed:d.failed}));return;}
 const r=d.reading||{};const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));console.log("survive",d.survivors,"of",d.of," sentence:",d.ruleSentence);
 for(const x of (r.dials||[])){const b=(r.beating||{})[x.dial]||{};console.log("  ",x.dial.padEnd(13),"movement",f(x.m,3),"check",b.n,"of",b.of,"range$",f(x.range),((r.counts||{})[x.dial])?"BOLD":"");}
 console.log("  not measurable:",(r.skipped||[]).map(x=>`${x.dial} - ${x.why}`).join("; ")||"none");});'
for BAR in 90 80; do
echo "=== step 3 quorum bar x share, bar ${BAR}% ==="
curl -sS -m 280 -H 'content-type: application/json' -d "{\"step\":3,\"dialA\":\"agreeBar\",\"dialB\":\"agreePct\",\"floor\":20,\"unit\":\"$U\",\"rule\":$R,\"target\":200,\"barPct\":$BAR,\"closing\":{\"key\":\"rule\"}}" "$B/api/funnel/$S/read" \
| node -e 'let raw="";process.stdin.on("data",c=>raw+=c).on("end",()=>{const d=JSON.parse(raw);if(d.error){console.log("ERROR",d.error);return;}if(d.totalling||d.waiting||d.failed){console.log("NOT READY",JSON.stringify({totalling:d.totalling,waiting:d.waiting,failed:d.failed}));return;}
 const r=d.reading||{};const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));console.log("survive",d.survivors,"of",d.of," check",JSON.stringify(d.check));
 if(!r.grid){console.log("no grid",JSON.stringify(r.why||null));return;}
 const counting=new Set(((r.block||{}).counting)||[]);const blk=(r.block||{}).block;
 console.log("thin",r.thin,"of",r.squares,"; recommended block:",blk?JSON.stringify(blk):`none - ${(r.block||{}).why}`);
 const cg=r.checkGrids||[];
 for(const a of r.aVals){const line=[];for(const b of r.bVals){const c=(r.grid||[]).find(x=>x.a===a&&x.b===b)||{};const cs=cg.map(g=>((g.grid||[]).find(x=>x.a===a&&x.b===b)||{}).mean).filter(x=>x!=null);const beats=c.mean==null?"-":cs.filter(v=>c.mean>v+0.005).length;const mx=cs.length?Math.max(...cs):null;
   line.push(`${b}: real ${f(c.mean)} (${c.n} settings) beats ${beats} of ${cs.length}, best copy ${f(mx)}${counting.has(`${a}|${b}`)?" BOLD":""}`);}
   console.log(a, "|", line.join(" | "));}
});'
done
