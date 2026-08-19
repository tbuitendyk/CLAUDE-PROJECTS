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

# WHICH PAIRS MATTER — asked of the service, which answers from lib/live/pairs.js.
# This used to be re-derived here in JS, in two sibling scripts, and again in the
# refresher: four copies of one rule, which had already drifted (one looked in
# configSnapshot.members[], which carries no symbol, so it silently reported a
# single pair as the whole set). An unreadable registry is reported as unknown,
# never as an empty list — "no pairs" reads as "nothing needs watching".
pairs_in_use() {
  local body
  body=$(curl -sS -m 8 http://127.0.0.1:8093/api/live/pairs 2>/dev/null) || { echo "__ERR__"; return; }
  python3 -c '
import json, sys
try:
    d = json.loads(sys.stdin.read())
except Exception:
    print("__ERR__"); raise SystemExit
if d.get("error"):
    print("__ERR__"); raise SystemExit
print(" ".join(d.get("pairs") or []))
' <<<"$body"
}

PAIRS=$(pairs_in_use)
if [ "$PAIRS" = "__ERR__" ]; then
  echo "cannot read which pairs are in use (is the classifier service up?) — NOT reporting a clean bill"
  exit 1
fi
if [ -z "${PAIRS// }" ]; then
  echo "no setup is in paper/live/stopped — no pair needs refreshing"
  exit 0
fi

PAIRS="$PAIRS" node -e '
const b = require("./lib/binance");
const now = Date.now();
const want = (process.env.PAIRS || "").split(/\s+/).filter(Boolean);

console.log("now:", new Date(now).toISOString());
// STALE is GUESSED at 3h, declared here rather than hidden: an hourly feed that
// has not closed a candle in three hours is behind, but the number is a prompt
// to look, not a verdict.
const STALE_H = 3;
let worst = 0;
for (const sym of want) {
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
