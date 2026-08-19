#!/usr/bin/env bash
# pilot-liveopen-smoke.sh -- READ-ONLY: prove the live entry-open fetch works
# through the Mexico tunnel. Fetches the CURRENT (forming) hour's candle and
# prints its ts + open — the exact value a live entry uses instead of waiting for
# the candle to close. No orders, no state.
#
# Usage: pilot-liveopen-smoke.sh [PAIR]   (default: each live profile's own pair)
set -uo pipefail
cd /opt/general-classifier || { echo "no /opt/general-classifier"; exit 1; }
PAIR="${1:-}"
PILOT_SOCKS=127.0.0.1:1080 PAIR="$PAIR" node -e '
const b = require("./lib/binance");
const st = require("./lib/live/setups");
(async () => {
  // DELIBERATELY NOT lib/live/pairs.js. That helper answers "which pairs need
  // fresh candles", which includes the two context pairs a committee reads. This
  // smoke asks a different question: which pair does an ENTRY take its price
  // from. That is the traded pair only — a context pair is never bought or sold
  // — so folding the two together would have this check fetching prices for
  // pairs no order will ever touch and calling a failure on one of them a
  // failure of the entry path.
  //
  // combo.trade is the authority (it is what lib/live/signal.js prices off);
  // tradedPair is the fallback for a setup whose snapshot is incomplete.
  let pairs = process.env.PAIR ? [process.env.PAIR] : [...new Set(
    st.listSetups().filter((s) => ["paper", "live"].includes(s.state))
      .map((s) => ((s.configSnapshot || {}).combo || {}).trade || s.tradedPair)
      .filter(Boolean))];
  if (!pairs.length) {
    console.log("no profile is in paper/live and no pair was given — nothing to smoke");
    console.log("pass a pair explicitly, e.g. pilot-liveopen-smoke.sh LTCUSDT");
    return;
  }
  const HOUR = b.HOUR_MS;
  const curHour = Math.floor(Date.now() / HOUR) * HOUR;
  console.log("now:", new Date().toISOString());
  let allOk = true;
  for (const sym of pairs) {
    const rows = await b.recentKlines(sym, curHour);
    const forming = rows.find((r) => r.ts === curHour);
    const prev = rows.find((r) => r.ts === curHour - HOUR);
    console.log("", sym);
    console.log("   forming hour:", new Date(curHour).toISOString(),
      "-> open:", forming ? forming.open : "(not returned)");
    console.log("   prev closed :", new Date(curHour - HOUR).toISOString(),
      "-> open:", prev ? prev.open : "n/a", "close:", prev ? prev.close : "n/a");
    if (!(forming && forming.open > 0)) allOk = false;
  }
  console.log(allOk ? "LIVE-OPEN OK" : "LIVE-OPEN MISSING");
})().catch((e) => { console.error("FAIL", e && e.message); process.exit(1); });
'
