#!/usr/bin/env bash
# READ-ONLY. The Funnel's first step for EVERY coin-and-shape unit of the newest
# finished stage 3 set -- the honesty line, the leading dials, the split-half
# and the bold rows -- the same read the page makes for each unit. Nothing is
# written; the walk's state lives in the owner's browser.
set -uo pipefail
S=${1:-s3-mtl42g1m-3}
BAR=${BAR:-16}
B=http://127.0.0.1:8094
units=$(curl -sS -m 200 -H 'content-type: application/json' -d '{"step":1,"rule":{"ranges":{},"allowed":{},"floors":{}},"target":200}' "$B/api/funnel/$S/read" \
  | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const d=JSON.parse(r);console.log("set "+d.set.name+" settings "+d.of+" copies "+d.set.keptScrambles+" bar "+JSON.stringify(d.check));for(const u of (d.units||[]))console.log(u.key)})')
echo "$units" | head -1
for u in all $(echo "$units" | tail -n +2); do
  curl -sS -m 300 -H 'content-type: application/json' -d "{\"step\":1,\"bar\":$BAR,\"unit\":\"$u\",\"rule\":{\"ranges\":{},\"allowed\":{},\"floors\":{}},\"target\":200}" "$B/api/funnel/$S/read" \
  | node -e 'let raw="";process.stdin.on("data",c=>raw+=c).on("end",()=>{const d=JSON.parse(raw);if(d.error){console.log("ERROR",d.error);return;}
    const r=d.reading||{};const h=r.honesty||{};const f=(x,n=2)=>(x==null||!isFinite(x)?"-":Number(x).toFixed(n));
    console.log("== "+(d.unitName||d.unit)+"  survive "+d.survivors+" of "+d.of+"  clear "+h.clear+" of "+h.of+" values (chance ~"+Math.round(h.byChance)+")");
    for(const x of (r.dials||[]).slice(0,5)){const b=(r.beating||{})[x.dial]||{};console.log("   "+x.dial.padEnd(13)+" movement "+f(x.m)+"  check "+b.n+" of "+b.of+"  range$ "+f(x.range)+"  even "+f((x.balance||{}).even)+(((r.counts||{})[x.dial])?"  BOLD":""));}
    const sh=r.splitHalf||{};console.log("   split-half agree: "+(sh.why?sh.why:sh.agrees)+"   not evenly swept: "+((r.lopsided||[]).join(", ")||"none"));
    console.log("   conditions: "+JSON.stringify(d.conditions));});'
done
