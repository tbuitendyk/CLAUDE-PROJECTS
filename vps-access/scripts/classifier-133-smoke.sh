#!/usr/bin/env bash
# classifier-133-smoke.sh -- post-deploy smoke for the 1.33.0 release.
# THE POINT OF THIS RELEASE: data on disk is visible to every reader
# (QC 70 — day-file months were invisible to sweeps), plus the planted-check
# button. So the centerpiece here is a READ-SIDE proof: load two assets the
# way a sweep loads them and print the last candle date — it must reach the
# day files, not stop at the last published bundle.
# Read-only except validation POSTs that must REFUSE.
set -uo pipefail
B="http://127.0.0.1:8093"
echo "healthz: $(curl -sS --max-time 10 $B/api/healthz)"
echo "engine:  $(node -e "console.log(require('/opt/general-classifier/package.json').version)")"
echo "-- READ-SIDE DATA PROOF (the QC 70 fix, seen from a sweep's eyes):"
node -e "
(async () => {
  const { loadSymbolAll } = require('/opt/general-classifier/lib/pipeline.js');
  for (const sym of ['ATOMUSDT', 'DOTUSDT']) {
    const { rows, cachedMonthCount } = await loadSymbolAll(sym, () => {});
    const last = rows.length ? new Date(rows[rows.length - 1].ts).toISOString().slice(0, 13) : 'NO ROWS';
    const first = rows.length ? new Date(rows[0].ts).toISOString().slice(0, 10) : '-';
    console.log(\`  \${sym}: \${rows.length} candles, \${cachedMonthCount} months, \${first} .. \${last}h — a sweep now SEES this\`);
  }
})().catch((e) => { console.log('  READ PROOF FAILED:', e.message); process.exit(1); });
"
echo "-- planted-gate status endpoint:"
curl -sS --max-time 10 $B/api/planted-gate/status | head -c 400; echo
echo "-- reserved pair must refuse in a real run:"
curl -sS --max-time 10 -X POST $B/api/bracketlab -H 'Content-Type: application/json' \
  -d '{"universe":["PLANTEDUSDT"],"sizes":{"singles":true},"windowLayout":"split70","allLoaded":true}' | head -c 300; echo
echo "-- reserved pair must refuse in download:"
curl -sS --max-time 10 -X POST $B/api/data/download -H 'Content-Type: application/json' \
  -d '{"symbols":["PLANTEDUSDT"],"startMonth":"2025-01","endMonth":"2025-02"}' | head -c 300; echo
echo "-- page stamps:"
grep -o 'app.js?v=[0-9]*\|style.css?v=[0-9]*' /opt/general-classifier/public/index.html | sort -u
grep -c 'bl-gate' /opt/general-classifier/public/index.html >/dev/null && echo "planted strip markup present"
