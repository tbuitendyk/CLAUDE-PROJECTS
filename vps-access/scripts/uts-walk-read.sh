#!/usr/bin/env bash
# uts-walk-read.sh -- READ-ONLY. Reads back the LAST walk the owner ran, exactly
# as it sits in the service, and pulls out the rows that beat all or all-but-one
# of their scrambled copies, with their window strips so the shape over the
# years can be read. Starts nothing, writes nothing.
set -uo pipefail
curl -s -m 120 -o /tmp/uts-wr.json http://127.0.0.1:8094/api/coins/walk
node -e '
const j = JSON.parse(require("fs").readFileSync("/tmp/uts-wr.json","utf8"));
if (j.none) { console.log("no walk has been run since the service last started"); process.exit(0); }
if (j.running) { console.log(`a walk is running: ${j.done} of ${j.of}`); process.exit(0); }
const a = j.asked || {};
console.log(`the run: window ${a.windowMonths}mo · warm-up ${a.warmUpMonths}mo · bands ${JSON.stringify(a.bands)} · sweet spot ${a.sweetSpot} · usual move ${a.usual} · leaning ${a.signsMode} · ${a.scrambles} copies · floor ${a.floor}`);
const rows = j.rows || [];
console.log(`rows ${rows.length} · took ${((j.finishedAt-j.startedAt)/1000).toFixed(1)}s`);
const dist = {}; for (const r of rows) dist[r.asGood == null ? "none" : (r.asGood <= 1 ? r.asGood : (r.asGood <= 5 ? "2-5" : (r.asGood <= 12 ? "6-12" : "13+")))] = (dist[r.asGood == null ? "none" : (r.asGood <= 1 ? r.asGood : (r.asGood <= 5 ? "2-5" : (r.asGood <= 12 ? "6-12" : "13+")))] || 0) + 1;
console.log(`copies as good: ${JSON.stringify(dist)}`);
const f = (v,d=3) => (v==null?"—":((v>0?"+":"")+Number(v).toFixed(d)));
const pick = rows.filter((r) => r.asGood != null && r.asGood <= 1 && r.windows >= 5);
pick.sort((x,y) => (x.asGood-y.asGood) || ((y.windowsUp/y.windows)-(x.windowsUp/x.windows)) || (y.perTrade-x.perTrade));
console.log(`\nbeat all or all-but-one of their copies, with at least 5 windows: ${pick.length}`);
for (const r of pick) {
  const net = r.perTrade == null ? null : r.perTrade - 0.25;
  console.log(`${r.coin} ${r.geometry} band ${r.band}${r.searched?" SEARCHED":""} · ${r.asGood}/${r.copies} copies · ${r.windowsUp}/${r.windows} windows up · ${r.trades} trades · ${f(r.perTrade)}% a trade (${f(net)}% net) · best ${f(r.best,2)}% worst ${f(r.worst,2)}%`);
  const strip = (r.scan||[]).map((w) => `${w.ts?new Date(w.ts).toISOString().slice(2,7):"?"}:${w.thin||w.perTrade==null?"—":(w.perTrade>0?"+":"")+w.perTrade.toFixed(1)}`).join("  ");
  console.log(`    ${strip}`);
}
' 2>&1 | head -90
rm -f /tmp/uts-wr.json
