#!/usr/bin/env bash
# READ-ONLY. Step 3's grid for quorum bar (agreeBar) against share (agreePct)
# on XRPUSDT weekly-8d of the newest stage 3 set, under gate = directional
# with t 65..137, thin below 20, bar 90%: every square's real average, its
# settings, whether it is thin or counts, the copies' average and highest in
# that square, the recommended block and the floor line. Nothing written; if
# the set is still folding or totalling, this prints that and stops.
set -uo pipefail
S=${1:-s3-mtl42g1m-3}; U="XRPUSDT|||weekly-8d"; B=http://127.0.0.1:8094
R='{"ranges":{"tHours":{"min":65,"max":137}},"allowed":{"gate":["directional"]},"floors":{}}'
curl -sS -m 280 -H 'content-type: application/json' -d "{\"step\":3,\"dialA\":\"agreeBar\",\"dialB\":\"agreePct\",\"floor\":20,\"unit\":\"$U\",\"rule\":$R,\"target\":200,\"barPct\":90,\"closing\":{\"key\":\"rule\"}}" "$B/api/funnel/$S/read" \
| node -e 'let raw="";process.stdin.on("data",c=>raw+=c).on("end",()=>{const d=JSON.parse(raw);if(d.error){console.log("ERROR",d.error);return;}if(d.totalling||d.waiting||d.failed){console.log("NOT READY",JSON.stringify({totalling:d.totalling,waiting:d.waiting,failed:d.failed}));return;}
 const r=d.reading||{};const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));
 console.log("survive",d.survivors,"of",d.of," check",JSON.stringify(d.check)," why",JSON.stringify(r.why||null));
 if(!r.grid){console.log("no grid");return;}
 console.log("first dial",r.dialA,"values",JSON.stringify(r.aVals)," second dial",r.dialB,"values",JSON.stringify(r.bVals));
 console.log("thin",r.thin,"of",r.squares,"squares; floor line:",(r.floorCost||[]).map(x=>`${x.floor} keeps ${x.keeps} of ${x.of}`).join("; "));
 const counting=new Set(((r.block||{}).counting)||[]);const blk=(r.block||{}).block;
 console.log("recommended block:",blk?JSON.stringify(blk):`none - ${(r.block||{}).why}`);
 const cg=r.checkGrids||[];
 console.log(["square".padEnd(22),"settings".padStart(9),"real avg".padStart(9),"copies avg".padStart(11),"copies max".padStart(11),"beats".padStart(6),"thin".padStart(5),"bold".padStart(5)].join(" "));
 for(const a of r.aVals){for(const b of r.bVals){const c=(r.grid||[]).find(x=>x.a===a&&x.b===b)||{};const cs=cg.map(g=>((g.grid||[]).find(x=>x.a===a&&x.b===b)||{}).mean).filter(x=>x!=null);
   const avg=cs.length?cs.reduce((p,q)=>p+q,0)/cs.length:null;const mx=cs.length?Math.max(...cs):null;const beats=c.mean==null?"-":cs.filter(v=>c.mean>v+0.005).length;
   console.log([`${a} x ${b}`.padEnd(22),String(c.n??"-").padStart(9),f(c.mean).padStart(9),f(avg).padStart(11),f(mx).padStart(11),String(beats).padStart(6),(c.thin?"yes":"").padStart(5),(counting.has(`${a}|${b}`)?"BOLD":"").padStart(5)].join(" "));}}
});'
