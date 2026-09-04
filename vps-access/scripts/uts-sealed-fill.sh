#!/usr/bin/env bash
# READ-ONLY on the owner's part: asks the Funnel for the newest stage 3 set the
# way the page does, which is what starts the sealed-window fill on a stage 2
# parent behind on it (3.51.0). Polls until the read stops waiting, then prints
# the sealed verdict. Nothing is typed into any record by this script.
set -uo pipefail
S=${1:-s3-mtl42g1m-3}
B=http://127.0.0.1:8094
for i in $(seq 1 40); do
  out=$(curl -sS -m 120 -H 'content-type: application/json' -d '{"step":1,"rule":{"ranges":{},"allowed":{},"floors":{}},"target":200}' "$B/api/funnel/$S/read")
  said=$(echo "$out" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const d=JSON.parse(r);if(d.error){console.log("ERROR "+d.error);process.exit(0)}if(d.waiting||d.totalling){console.log("WAIT "+(d.waiting||JSON.stringify(d.totalling)));process.exit(0)}console.log("DONE sealed="+JSON.stringify(d.set.sealed));})')
  echo "$i: $said"
  case "$said" in DONE*|ERROR*) break;; esac
  sleep 3
done
cd /opt/ultimate-trading-system && sudo -u uts node -e '
const st=require("./lib/stages"); const rs=require("./lib/rowstore");
const s2=st.getSet("s2-mtkq55cv-2"); const rows=rs.readAll(s2.id,"records");
console.log("S2 #2 status", s2.status, "sealedFilledAt", s2.sealedFilledAt, "records", rows.length, "with reserve", rows.filter(r=>r.reserve).length, "progress:", s2.progress);'
