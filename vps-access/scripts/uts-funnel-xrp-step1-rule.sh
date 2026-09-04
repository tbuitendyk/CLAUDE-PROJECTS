#!/usr/bin/env bash
# READ-ONLY. Step 1 on XRPUSDT weekly-8d under the owner's rule so far (gate =
# directional, t 65 to 137) at an 80% bar: every dial's movement, check, range,
# values and evenness, plus the honesty line. Nothing written.
set -uo pipefail
S=${1:-s3-mtl42g1m-3}; U="XRPUSDT|||weekly-8d"
R='{"ranges":{"tHours":{"min":65,"max":137}},"allowed":{"gate":["directional"]},"floors":{}}'
curl -sS -m 300 -H 'content-type: application/json' -d "{\"step\":1,\"unit\":\"$U\",\"rule\":$R,\"target\":200,\"barPct\":${BAR:-90},\"closing\":{\"key\":\"rule\"}}" "http://127.0.0.1:8094/api/funnel/$S/read" \
| node -e 'let raw="";process.stdin.on("data",c=>raw+=c).on("end",()=>{const d=JSON.parse(raw);if(d.error){console.log("ERROR",d.error);return;}const r=d.reading||{};const h=r.honesty||{};const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));
  console.log("survive",d.survivors,"of",d.of," bar",JSON.stringify(d.check)," clear",h.clear,"of",h.of,"(chance ~"+Math.round(h.byChance)+")"," sentence:",d.ruleSentence);
  console.log("dial".padEnd(13),"movement".padStart(9),"check".padStart(9),"range$".padStart(8),"values".padStart(7),"even".padStart(6));
  for(const x of (r.dials||[])){const b=(r.beating||{})[x.dial]||{};console.log(x.dial.padEnd(13),f(x.m).padStart(9),(b.n+" of "+b.of).padStart(9),f(x.range).padStart(8),String((x.values||[]).length).padStart(7),f((x.balance||{}).even).padStart(6),((r.counts||{})[x.dial])?"  BOLD":"");}
  console.log("split-half:",JSON.stringify(r.splitHalf)," not evenly swept:",(r.lopsided||[]).join(", ")||"none"," not measurable:",(r.skipped||[]).map(s=>s.dial+" ("+s.why+")").join("; ")||"none");});'
