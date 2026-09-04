#!/usr/bin/env bash
# READ-ONLY. Step 3's grid for quorum bar (agreeBar) against share (agreePct)
# on XRPUSDT weekly-8d, under gate = directional, t 65..137 AND 24/5 off
# (weekdaysOnly false), thin below 20, at bar 90% and 80%: the recommended
# block and every square's real average, copies' average and highest, and how
# many copies it beats. Nothing written.
set -uo pipefail
S=${1:-s3-mtl42g1m-3}; U="XRPUSDT|||weekly-8d"; B=http://127.0.0.1:8094
R='{"ranges":{"tHours":{"min":65,"max":137}},"allowed":{"gate":["directional"],"weekdaysOnly":["false"]},"floors":{}}'
for BAR in 90 80; do
echo "=== bar ${BAR}% ==="
curl -sS -m 280 -H 'content-type: application/json' -d "{\"step\":3,\"dialA\":\"agreeBar\",\"dialB\":\"agreePct\",\"floor\":20,\"unit\":\"$U\",\"rule\":$R,\"target\":200,\"barPct\":$BAR,\"closing\":{\"key\":\"rule\"}}" "$B/api/funnel/$S/read" \
| node -e 'let raw="";process.stdin.on("data",c=>raw+=c).on("end",()=>{const d=JSON.parse(raw);if(d.error){console.log("ERROR",d.error);return;}if(d.totalling||d.waiting||d.failed){console.log("NOT READY",JSON.stringify({totalling:d.totalling,waiting:d.waiting,failed:d.failed}));return;}
 const r=d.reading||{};const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));
 console.log("survive",d.survivors,"of",d.of," check",JSON.stringify(d.check));
 if(!r.grid){console.log("no grid",JSON.stringify(r.why||null));return;}
 const counting=new Set(((r.block||{}).counting)||[]);const blk=(r.block||{}).block;
 console.log("recommended block:",blk?JSON.stringify(blk):`none - ${(r.block||{}).why}`);
 const cg=r.checkGrids||[];
 for(const a of r.aVals){const line=[];for(const b of r.bVals){const c=(r.grid||[]).find(x=>x.a===a&&x.b===b)||{};const cs=cg.map(g=>((g.grid||[]).find(x=>x.a===a&&x.b===b)||{}).mean).filter(x=>x!=null);const beats=c.mean==null?"-":cs.filter(v=>c.mean>v+0.005).length;
   line.push(`${b}:${f(c.mean)}/${c.n}${counting.has(`${a}|${b}`)?"*":""}(${beats})`);}
   console.log(a.padEnd(4),line.join("  "));}
 console.log("  (each square: share:real avg/settings, * = bold, (beats N of 20))");
});'
done
