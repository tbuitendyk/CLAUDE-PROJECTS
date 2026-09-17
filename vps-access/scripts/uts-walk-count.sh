#!/usr/bin/env bash
# uts-walk-count.sh -- how many walks the owner's own parameters now list, and
# then STOP AT ONCE. The count comes back from the press itself, before any
# walking, so this costs the box a second and leaves it free.
set -uo pipefail
echo -n 'collapse the box works out: '
curl -s -m 60 http://127.0.0.1:8094/api/coins/records \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(JSON.stringify(j.collapse));});'
echo -n 'press answers: '
curl -s -m 120 -X POST http://127.0.0.1:8094/api/coins/walk \
  -H 'Content-Type: application/json' \
  -d '{"windowMonths":6,"warmUpMonths":12,"bands":[200,250,300,350],"sweetSpot":false,"usual":"trailing","signsMode":"rolled","scrambles":100,"floor":3,"only":null,"lookbacks":[24,48,72,96,120,144,168,192,216,240,264,288,312,336,360,384,408,432,456,480,504]}'
echo
echo -n 'stop says: '
curl -s -m 60 -X POST http://127.0.0.1:8094/api/coins/walk/stop
echo
