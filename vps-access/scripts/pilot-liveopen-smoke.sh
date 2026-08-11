#!/usr/bin/env bash
# pilot-liveopen-smoke.sh -- READ-ONLY: prove the live entry-open fetch works
# through the Mexico tunnel. Fetches the CURRENT (forming) hour's candle for the
# F1 trade pair via recentKlines and prints its ts + open — the exact value the
# live entry now uses instead of waiting for the candle to close. No orders.
set -uo pipefail
cd /opt/general-classifier || { echo "no /opt/general-classifier"; exit 1; }
PILOT_SOCKS=127.0.0.1:1080 node -e '
const b=require("./lib/binance");
(async () => {
  const HOUR=b.HOUR_MS;
  const curHour=Math.floor(Date.now()/HOUR)*HOUR;   // start of the current forming hour
  const rows=await b.recentKlines("LTCUSDT", curHour);
  const forming=rows.find(r=>r.ts===curHour);
  const prev=rows.find(r=>r.ts===curHour-HOUR);
  console.log("now:", new Date().toISOString());
  console.log("forming hour:", new Date(curHour).toISOString(),
              "-> open:", forming?forming.open:"(not returned)");
  console.log("prev closed :", new Date(curHour-HOUR).toISOString(),
              "-> open:", prev?prev.open:"n/a", "close:", prev?prev.close:"n/a");
  console.log(forming && forming.open>0 ? "LIVE-OPEN OK" : "LIVE-OPEN MISSING");
})().catch(e=>{console.error("FAIL", e && e.message); process.exit(1);});
'
