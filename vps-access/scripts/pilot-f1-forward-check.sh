#!/usr/bin/env bash
# pilot-f1-forward-check.sh -- READ-ONLY: F1's AUTHORITATIVE forward-window numbers
# from forwardbook.scoreBook (the same path the verdict emails use). Prints trades,
# wins, win rate, net/gross $, fee realism, and the always-long/short controls. No
# persistence, no engine touch.
set -uo pipefail
APP=/opt/general-classifier
cd "$APP" || { echo "no $APP"; exit 1; }
node -e '
const { BOOKS, scoreBook } = require("./lib/forwardbook");
const F1 = BOOKS.find((b) => b.id === "F1");
(async () => {
  const r = await scoreBook(F1);
  const iso = (t) => (t ? new Date(t).toISOString().slice(0, 10) : "n/a");
  const wr = r.trades ? (100 * r.wins / r.trades) : 0;
  console.log("F1_FWD " + JSON.stringify({
    window: `${iso(r.firstPeriodTs)}..${iso(r.lastPeriodTs)}`,
    periods: r.periods,
    trades: r.trades,
    wins: r.wins,
    winRatePct: Math.round(wr * 10) / 10,
    netUsd: Math.round(r.net * 100) / 100,
    grossUsd: Math.round(r.gross * 100) / 100,
    feePerLegUsd: r.fee,
    breakEvenPerLegUsd: r.breakEvenPerLeg == null ? null : Math.round(r.breakEvenPerLeg * 1000) / 1000,
    feeHeadroomPct: r.feeHeadroomPct == null ? null : Math.round(r.feeHeadroomPct * 10) / 10,
    alwaysLongUsd: r.alwaysLong == null ? null : Math.round(r.alwaysLong * 100) / 100,
    alwaysShortUsd: r.alwaysShort == null ? null : Math.round(r.alwaysShort * 100) / 100,
    notionalUsd: 100,
    verdictAllowed: r.verdictAllowed,
    thinness: r.thinness || null,
  }, null, 2));
})().catch((e) => { console.error("F1_FWD_FAIL " + (e && e.stack || e)); process.exit(1); });
'
