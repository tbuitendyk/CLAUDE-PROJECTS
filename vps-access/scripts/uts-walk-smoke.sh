#!/usr/bin/env bash
# uts-walk-smoke.sh -- READ-ONLY. Does the new Walk it forward door answer on
# the box, and how long does it take with the numbers the screen defaults to?
# One small ask first, then the full one. Reports; changes nothing.
set -uo pipefail
echo "== one coin, no scrambled copies =="
curl -s -m 300 -w '\n(%{time_total}s, HTTP %{http_code})\n' -X POST http://127.0.0.1:8094/api/coins/walk \
  -H 'Content-Type: application/json' \
  -d '{"windowMonths":6,"warmUpMonths":12,"bands":[100],"sweetSpot":false,"scrambles":0,"only":"LTCUSDT"}' \
  | head -c 900
echo
echo "== everything, the screen's defaults =="
T=$(curl -s -m 580 -o /tmp/uts-walk.json -w '%{time_total}' -X POST http://127.0.0.1:8094/api/coins/walk \
  -H 'Content-Type: application/json' \
  -d '{"windowMonths":6,"warmUpMonths":12,"bands":[50,100,150,200],"sweetSpot":true,"usual":"trailing","signsMode":"rolled","scrambles":10,"floor":5}')
echo "took ${T}s"
node -e '
const j = JSON.parse(require("fs").readFileSync("/tmp/uts-walk.json","utf8"));
if (j.error) { console.log("ERROR:", j.error); process.exit(0); }
const rows = j.rows || [];
console.log(`rows ${rows.length} · with a searched band ${rows.filter((r)=>r.searched).length}`);
const ok = rows.filter((r) => r.perTrade != null);
console.log(`rows with money ${ok.length} · beat all their copies ${rows.filter((r)=>r.asGood===0).length}`);
const top = ok.slice().sort((a,b)=>(a.asGood-b.asGood)||(b.perTrade-a.perTrade)).slice(0,8);
for (const r of top) console.log(`  ${r.coin} ${r.geometry} band ${r.band}${r.searched?" (searched)":""} · ${r.trades} trades · ${(r.perTrade>0?"+":"")+r.perTrade.toFixed(3)}% a trade · ${r.windowsUp}/${r.windows} windows up · ${r.asGood} of ${r.copies} copies as good`);
'
rm -f /tmp/uts-walk.json
