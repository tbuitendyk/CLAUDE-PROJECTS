#!/usr/bin/env bash
# uts-walk-tops.sh -- READ-ONLY. What a plain share puts at the top of the
# windows-up column: every row whose windows all went up, smallest count first.
# Starts nothing, writes nothing.
set -uo pipefail
curl -s -m 120 -o /tmp/uts-wt.json http://127.0.0.1:8094/api/coins/walk
node -e '
const j = JSON.parse(require("fs").readFileSync("/tmp/uts-wt.json","utf8"));
const rows = j.rows || [];
const all = rows.filter((r) => r.windows > 0 && r.windowsUp === r.windows);
all.sort((a,b) => a.windows - b.windows);
console.log(`rows where EVERY counted window went up: ${all.length}`);
for (const r of all) console.log(`  ${r.windowsUp}/${r.windows}  ${r.coin} ${r.geometry} band ${r.band} · ${r.trades} trades · ${(r.perTrade>0?"+":"")+r.perTrade.toFixed(3)}% a trade · ${r.asGood}/${r.copies} copies`);
const few = rows.filter((r) => r.windows > 0 && r.windows <= 3);
console.log(`\nrows counted on 3 windows or fewer: ${few.length} (these are what a plain share floats to the top)`);
' 2>&1 | head -40
rm -f /tmp/uts-wt.json
