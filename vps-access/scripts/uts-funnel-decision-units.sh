#!/usr/bin/env bash
# READ-ONLY. Step 2's table for the decision dial on EVERY unit of the newest
# stage 3 set, under gate = directional alone and with t 65..137, at bar 90%:
# each value's settings, avg test, and the check (copies' range, beats N of K,
# lead). Nothing written.
set -uo pipefail
S=${1:-s3-mtl42g1m-3}; B=http://127.0.0.1:8094
units=$(curl -sS -m 200 -H 'content-type: application/json' -d '{"step":1,"rule":{"ranges":{},"allowed":{},"floors":{}},"target":200}' "$B/api/funnel/$S/read" \
  | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const d=JSON.parse(r);for(const u of (d.units||[]))console.log(u.key)})')
for RULE in '{"ranges":{},"allowed":{"gate":["directional"]},"floors":{}}' '{"ranges":{"tHours":{"min":65,"max":137}},"allowed":{"gate":["directional"]},"floors":{}}'; do
  echo "=== rule $RULE ==="
  for U in all $units; do
    curl -sS -m 250 -H 'content-type: application/json' -d "{\"step\":2,\"dial\":\"decision\",\"unit\":\"$U\",\"rule\":$RULE,\"target\":200,\"barPct\":90,\"closing\":{\"key\":\"rule\"}}" "$B/api/funnel/$S/read" \
    | node -e 'let raw="";process.stdin.on("data",c=>raw+=c).on("end",()=>{const d=JSON.parse(raw);if(d.error){console.log("ERROR",d.error);return;}if(d.waiting){console.log("WAIT",d.waiting);return;}const r=d.reading||{};const rec=r.rec||{};const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));
      const g=new Map((r.groups||[]).map(x=>[String(x.value),x]));
      const line=(rec.values||[]).map(v=>{const gg=g.get(String(v.value))||{};const c=(v.check||[]).filter(x=>x!=null);return `${v.value}: ${gg.n} settings, avg test ${f(gg.mean)}, copies ${f(c.length?Math.min(...c):null)} to ${f(c.length?Math.max(...c):null)}, beats ${v.beaten} of ${c.length}, lead ${f(v.lead,1)}${v.counts?" BOLD":""}`}).join(" | ");
      console.log(String(d.unitName||d.unit||"all").padEnd(24), "survive", d.survivors, "of", d.of, "::", line||JSON.stringify(r.why||null));});'
  done
done
