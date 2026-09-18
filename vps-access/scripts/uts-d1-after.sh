#!/usr/bin/env bash
# READ-ONLY. Two things, after the migration and the deletes: does the notice's
# question answer at all (it timed out before 3.173.1), and how long does it
# take? Plus what the box holds now.
set -uo pipefail
B=http://127.0.0.1:8094
echo "== /api/d1/needs, timed =="
s=$(date +%s%N)
out=$(curl -sS -m 30 "$B/api/d1/needs" || echo '{"error":"no answer in 30s"}')
e=$(date +%s%N)
echo "  answered in $(( (e-s)/1000000 )) ms"
echo "  $out"
echo
echo "== the plateau grid the box is using =="
curl -sS -m 30 "$B/api/coins/records" | node -e 'let r="";process.stdin.on("data",c=>r+=c).on("end",()=>{const d=JSON.parse(r);console.log("  "+JSON.stringify(d.grid))})' 2>/dev/null || echo "  (records answer not readable here)"
echo
echo "== disk =="
df -h /opt | tail -1 | awk '{print "  used "$3" of "$2", "$4" free"}'
