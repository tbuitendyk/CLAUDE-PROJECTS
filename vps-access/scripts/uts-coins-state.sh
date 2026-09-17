#!/usr/bin/env bash
# uts-coins-state.sh -- READ-ONLY. Are the coin records on this box current for
# the release now running, and do they carry the look-backs that are set?
set -uo pipefail
echo -n 'release running: '; node -e 'console.log(require("/opt/ultimate-trading-system/package.json").version)'
echo -n 'RECORD_V the code wants: '; grep -o 'const RECORD_V = [0-9]*' /opt/ultimate-trading-system/lib/coinsrun.js
curl -s -m 240 -o /tmp/uts-cs.json http://127.0.0.1:8094/api/coins/records
node -e '
const j=JSON.parse(require("fs").readFileSync("/tmp/uts-cs.json","utf8"));
console.log(`look-backs SET: ${(j.lookbacks&&j.lookbacks.value||[]).join(",")}`);
console.log(`look-backs IN THE RECORDS: ${(j.lookbacks&&j.lookbacks.inRecords||[]).join(",")}`);
console.log(`records drawn: ${(j.records||[]).length} · refused as another record shape: ${(j.unreadable||[]).length}`);
for (const u of (j.unreadable||[]).slice(0,6)) console.log(`  refused: ${u.coin||"?"} ${u.why||""}`);
const rel={}; let shapes=0, withMoves=0;
for (const r of (j.records||[])) {
  const v=(r.provenance&&r.provenance.release)||"?"; rel[v]=(rel[v]||0)+1;
  for (const k of Object.keys(r.shapes||{})) { const s=r.shapes[k]; if (s&&s.periods>0) shapes++; }
}
console.log(`written under release: ${Object.entries(rel).map(([k,n])=>k+" x"+n).join(", ")}`);
console.log(`coin-and-shape pairs with decisions: ${shapes}`);
const first=(j.records||[])[0];
if (first) console.log(`one record read back: ${first.coin} · captured ${(first.provenance||{}).capturedAt} · ${((first.provenance||{}).candles||0).toLocaleString()} candles`);
' 2>&1 | head -30
rm -f /tmp/uts-cs.json
