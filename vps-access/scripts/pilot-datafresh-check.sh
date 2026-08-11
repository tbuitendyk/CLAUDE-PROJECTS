#!/usr/bin/env bash
# pilot-datafresh-check.sh -- READ-ONLY: the F1 per-pair data freshness the pilot
# screen shows (newest cached candle, the hour it is COMPLETE through, and how long
# since that close), straight from the deployed classifier. No network, no state.
set -uo pipefail
cd /opt/general-classifier || { echo "no /opt/general-classifier"; exit 1; }
node -e '
const pv=require("./lib/pilotview"), b=require("./lib/binance");
const now=Date.now();
const df=pv.dataFreshness(["LTCUSDT","XRPUSDT","BCHUSDT"].map(s=>({symbol:s,ts:b.newestCandleTs(s)})),now);
console.log("now:", new Date(now).toISOString());
for(const f of df) console.log(f.symbol.padEnd(8), "complete through", (f.throughUtc||"none"), "| closed", f.closedAgeHours, "h ago | stale:", f.stale);
'
