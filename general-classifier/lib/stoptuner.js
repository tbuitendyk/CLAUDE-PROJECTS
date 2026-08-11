// stoptuner.js -- tune the tightest FIXED stop-loss that loses no winner.
//
// Owner spec (2026-08-11, "New Final Tune Before Live Deploy"): for a prospective
// live setup that has NO protective (trailing/fixed) stop, sweep the FULL history
// (start->end, no holdout) and find the tightest %-from-entry fixed stop such that
// no money-making entry is stopped out, cutting contrary positions as early as
// that bound allows. The resulting % becomes a hard per-order stop in the live
// engine.
//
// The tightest such stop is CLOSED-FORM, not a grid search: an entry is stopped
// out iff its Maximum Adverse Excursion (MAE, the deepest the price moved AGAINST
// the position during the hold, as a fraction of entry) is >= the stop. So the
// tightest stop that preserves EVERY winner is exactly max(MAE) over the winners
// -- any tighter stops a winner; any looser is not as tight as possible. MAE is
// read from hourly bar extremes (bar.low for a long, bar.high for a short) and is
// UNAMBIGUOUS -- unlike a stop-vs-target race, the adverse extreme does not depend
// on within-bar ordering, so the primary answer needs no minute data.
//
// Pure: functions over a caller-supplied hourly candle map. No I/O, no engine.
const { HOUR_MS } = require('./binance');

// Walk one entry's hold and return its adverse extreme + no-stop outcome.
//   entryTs   ms timestamp of the entry bar (aligned to the hourly grid)
//   side      'LONG' | 'SHORT'
//   map       Map(ms -> {open,high,low,close}) forward-filled hourly candles
//   holdHours how long the position is held before its scheduled exit
//   feePerLeg round-trip fee is 2*feePerLeg, as a FRACTION of notional (e.g. .001)
// Returns { priced, mae, grossPct, netPct, entry, exit, worst } or {priced:false}.
function entryOutcome(entryTs, side, map, holdHours, feePerLeg = 0) {
  const e0 = map.get(entryTs);
  const exitTs = entryTs + holdHours * HOUR_MS;
  const eExit = map.get(exitTs);
  if (!e0 || !eExit) return { priced: false };
  const entry = e0.open;
  const exit = eExit.open; // open-to-open, matching the market-entry convention
  if (!(entry > 0) || !(exit > 0)) return { priced: false };
  // adverse extreme over [entry, exit): a long is hurt by lows, a short by highs
  let worst = entry;
  const steps = Math.round((holdHours * HOUR_MS) / HOUR_MS); // = holdHours, explicit
  for (let h = 0; h < steps; h++) {
    const bar = map.get(entryTs + h * HOUR_MS);
    if (!bar) continue;
    if (side === 'LONG') { if (bar.low < worst) worst = bar.low; }
    else { if (bar.high > worst) worst = bar.high; }
  }
  const mae = side === 'LONG' ? (entry - worst) / entry : (worst - entry) / entry;
  const grossPct = side === 'LONG' ? (exit - entry) / entry : (entry - exit) / entry;
  const netPct = grossPct - 2 * feePerLeg;
  return { priced: true, mae: Math.max(0, mae), grossPct, netPct, entry, exit, worst };
}

// Tune the tightest fixed stop that preserves every winner.
//   entries : [{ entryTs, side }]  the setup's actual historical entries
//   map     : hourly candle Map for the trade pair, over the whole history
//   opts    : { holdHours, feePerLeg=0, marginFrac=0 }
//             marginFrac widens the chosen stop by this fraction of itself, so a
//             live stop checked at tick (not bar) resolution does not clip the
//             very winner that defined the bound. 0 = exactly the tightest.
// Returns a report: the stop %, the winners it preserves, and what it does to the
// losers it would now cut early (with a conservative resolution -- see below).
function tuneFixedStop(entries, map, opts = {}) {
  const holdHours = opts.holdHours;
  const feePerLeg = opts.feePerLeg || 0;
  const marginFrac = opts.marginFrac || 0;
  if (!(holdHours > 0)) throw new Error('tuneFixedStop: holdHours required');

  const per = [];
  let unpriced = 0;
  for (const e of entries) {
    const o = entryOutcome(e.entryTs, e.side, map, holdHours, feePerLeg);
    if (!o.priced) { unpriced++; continue; }
    per.push({ entryTs: e.entryTs, side: e.side, ...o, winner: o.netPct > 0 });
  }
  const winners = per.filter((p) => p.winner);
  const losers = per.filter((p) => !p.winner);

  // the tightest stop that stops out NO winner = the deepest adverse move any
  // winner survived. If there are no winners, the winner constraint is vacuous.
  const maxWinnerMae = winners.length ? Math.max(...winners.map((p) => p.mae)) : null;
  const stopPct = maxWinnerMae == null ? null : maxWinnerMae * (1 + marginFrac);
  // which winner sits at the bound (the binding constraint) -- useful to eyeball
  const binding = winners.length
    ? winners.reduce((a, b) => (b.mae > a.mae ? b : a))
    : null;

  // What the stop does to the losers it now cuts: a loser whose MAE >= stopPct
  // would exit at ~ -stopPct (minus fees) instead of riding to its no-stop netPct.
  // CONSERVATIVE accounting: the stop only helps when the capped loss is smaller
  // than the ride-to-exit loss; if the loser had recovered to a shallower loss by
  // exit, the stop makes it WORSE. We report both so the trade-off is explicit,
  // never hidden. (This does not affect the stop choice, which is winner-driven.)
  let cut = 0;
  let deltaOnLosers = 0; // sum of (stopped outcome - no-stop outcome), net pct
  if (stopPct != null) {
    for (const p of losers) {
      if (p.mae >= stopPct) {
        cut++;
        const stoppedNet = -stopPct - 2 * feePerLeg; // exit at the stop, pay fees
        deltaOnLosers += stoppedNet - p.netPct;
      }
    }
  }

  return {
    stopPct,                       // the tightest fixed stop that loses no winner
    marginFrac,
    holdHours,
    feePerLeg,
    counts: {
      entries: entries.length,
      priced: per.length,
      unpriced,
      winners: winners.length,
      losers: losers.length,
      losersCutByStop: cut,
    },
    binding: binding ? { entryTs: binding.entryTs, side: binding.side, mae: binding.mae } : null,
    // net pct change ACROSS the whole book from adding the stop (losers only; the
    // stop touches no winner by construction). Positive = the stop saved money.
    loserPnlDeltaPct: round(deltaOnLosers, 6),
    // the full per-entry table, newest constraint first, for the screen/report
    perEntry: per
      .slice()
      .sort((a, b) => b.mae - a.mae)
      .map((p) => ({
        entryTs: p.entryTs, side: p.side, winner: p.winner,
        maePct: round(p.mae, 6), netPct: round(p.netPct, 6),
      })),
  };
}

function round(v, n = 6) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** n;
  return Math.round(v * f) / f;
}

module.exports = { entryOutcome, tuneFixedStop };
