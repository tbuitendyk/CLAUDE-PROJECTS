#!/usr/bin/env bash
# pilot-datafresh-check.sh -- READ-ONLY: per-pair candle freshness (newest cached
# candle, the hour it is COMPLETE through, and how long since that close),
# straight from the deployed classifier. No network, no state, no engine touch.
#
# Two things were wrong here and both were invisible: it called a view module
# that has since been deleted (so it just threw), and it asked about three
# hardcoded symbols. It now asks the registry which pairs the trading profiles
# actually need — a profile added on a fourth pair was previously unmonitored
# while this check still printed three reassuring green lines.
set -uo pipefail
cd /opt/general-classifier || { echo "no /opt/general-classifier"; exit 1; }
node -e '
const b = require("./lib/binance");
const st = require("./lib/live/setups");
const now = Date.now();

// Which pairs matter: for every profile that is running or could resume, the
// pair it trades AND the two context pairs its committee reads. They live in
// configSnapshot.combo as {trade, ctx1, ctx2} — the same fields lib/live/signal.js
// reads. An earlier version of this check looked at configSnapshot.members[],
// which carry no symbol, so it reported one pair fresh while the two the
// committee also depends on went unwatched.
const want = new Set();
for (const s of st.listSetups()) {
  if (!["paper", "live", "stopped"].includes(s.state)) continue;
  const combo = (s.configSnapshot || {}).combo || {};
  for (const k of ["trade", "ctx1", "ctx2"]) if (combo[k]) want.add(combo[k]);
  if (s.tradedPair) want.add(s.tradedPair);
}
console.log("now:", new Date(now).toISOString());
if (!want.size) {
  console.log("(no profile is in paper/live/stopped — no pair needs refreshing)");
  process.exit(0);
}
// STALE is GUESSED at 3h, declared here rather than hidden: an hourly feed that
// has not closed a candle in three hours is behind, but the number is a prompt
// to look, not a verdict.
const STALE_H = 3;
let worst = 0;
for (const sym of [...want].sort()) {
  const ts = b.newestCandleTs(sym);
  if (!ts) { console.log(sym.padEnd(9), "no cached candle at all"); worst = 999; continue; }
  const throughUtc = new Date(ts + b.HOUR_MS).toISOString();
  const ageH = Math.round(((now - (ts + b.HOUR_MS)) / 3.6e6) * 100) / 100;
  if (ageH > worst) worst = ageH;
  console.log(sym.padEnd(9), "complete through", throughUtc,
    "| closed", ageH, "h ago | stale:", ageH > STALE_H);
}
console.log(worst > STALE_H
  ? "DATA STALE — worst pair is " + worst + "h behind (stale threshold " + STALE_H + "h, GUESSED)"
  : "DATA FRESH — worst pair is " + worst + "h behind");
'
