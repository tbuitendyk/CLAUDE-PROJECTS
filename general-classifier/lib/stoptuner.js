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
// the position during the hold, as a fraction of entry) STRICTLY exceeds the stop.
// The engine boundary is strict (px < ep*(1-stop) for a long, px > ep*(1+stop) for
// a short), so a position whose MAE equals the stop is preserved, not cut. So the
// tightest stop that preserves EVERY winner is exactly max(MAE) over the winners:
// at that stop the deepest winner sits ON the boundary and survives (strict), one
// tick tighter would cut it, and looser is not as tight as possible. This is why
// marginFrac=0 is SAFE — the strict boundary already spares the binding winner. MAE is
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
  if (!e0) return { priced: false };
  const entry = e0.open;
  // Walk <=3h forward over gaps for the EXIT bar, EXACTLY as bracket.js (the
  // authoritative forward book, lines 133-135) does, so the tuner and the book
  // price the SAME population. Before this, a missing exact-exit bar dropped the
  // entry as unpriced here while the book counted it — the two disagreed on which
  // trades exist, so the tuner's winner/loser set was a different population from
  // the one being traded (STOPMATH BUG 3, 2026-08-11 e2e review).
  let eExit = null;
  let exitStepH = holdHours;
  for (let g = 0; g <= 3; g++) {
    const cand = map.get(entryTs + (holdHours + g) * HOUR_MS);
    if (cand) { eExit = cand; exitStepH = holdHours + g; break; }
  }
  if (!eExit) return { priced: false };
  const exit = eExit.open; // open-to-open, matching the market-entry convention
  if (!(entry > 0) || !(exit > 0)) return { priced: false };
  // adverse extreme over the ACTUAL hold [entry, exit): a long is hurt by lows,
  // a short by highs. The window extends to the gap-resolved exit so a stretched
  // hold's later adverse ticks are not missed.
  let worst = entry;
  for (let h = 0; h < exitStepH; h++) {
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

  // What the stop does to the losers it now cuts: a loser whose MAE STRICTLY
  // exceeds stopPct exits at ~ -stopPct (minus fees) instead of riding to its
  // no-stop netPct. The predicate is STRICT (mae > stopPct), matching BOTH the
  // engine's strict stop boundary (mx_executor: px < ep*(1-stop) / px > ep*(1+stop))
  // and the sacrifice curve below — so a position sitting exactly at the bound is
  // preserved, never counted as cut (STOPMATH BUG 1/2, 2026-08-11 e2e review). It
  // was `>=`, which over-counted by one boundary loser and contradicted the curve.
  // CONSERVATIVE accounting: the stop only helps when the capped loss is smaller
  // than the ride-to-exit loss; if the loser had recovered to a shallower loss by
  // exit, the stop makes it WORSE. We report both so the trade-off is explicit,
  // never hidden. (This does not affect the stop choice, which is winner-driven.)
  let cut = 0;
  let deltaOnLosers = 0; // sum of (stopped outcome - no-stop outcome), net pct
  if (stopPct != null) {
    for (const p of losers) {
      if (p.mae > stopPct) {
        cut++;
        const stoppedNet = -stopPct - 2 * feePerLeg; // exit at the stop, pay fees
        deltaOnLosers += stoppedNet - p.netPct;
      }
    }
  }

  // SACRIFICE CURVE (owner 2026-08-11): the "preserve every winner" stop can be
  // pinned by one outlier winner. So for k = 0,1,2,3 of the DEEPEST winners given
  // up, report the tightest stop that still spares the rest AND the real both-sides
  // money at that stop: the winning profit forfeited by stopping those k winners,
  // and how the losing side changes (cut sooner). netPnlDeltaUsd is the sum — a
  // positive number means the stop makes more on the losers it saves than it gives
  // up on the winners it sacrifices. Figures are per the $clipUsd clip across ALL
  // priced historical entries, for comparison (not the live book's realized P&L).
  const clipUsd = opts.clipUsd || 10;
  const winnerMaes = winners.map((w) => w.mae).sort((a, b) => b - a);
  const curve = [];
  for (let k = 0; k <= Math.min(3, winnerMaes.length - 1); k++) {
    const S = winnerMaes[k]; // stop just above the (k+1)th-deepest winner spares it
    const stoppedNet = -S - 2 * feePerLeg;
    let wCount = 0; let wProfit = 0; let wDelta = 0; let lCount = 0; let lDelta = 0;
    for (const p of per) {
      if (p.mae > S) { // strict: the stop sits just above S, sparing the winner at S
        const delta = (stoppedNet - p.netPct) * clipUsd;
        if (p.winner) { wCount++; wProfit += p.netPct * clipUsd; wDelta += delta; }
        else { lCount++; lDelta += delta; }
      }
    }
    curve.push({
      sacrificeTopWinners: k,
      stopPct: round(S, 6),
      winnersForfeited: wCount,
      winnerProfitForfeitedUsd: round(wProfit, 2), // the winning $ we give up
      losersCut: lCount,
      loserPnlDeltaUsd: round(lDelta, 2),          // + = saved on the losers
      netPnlDeltaUsd: round(wDelta + lDelta, 2),   // total change vs no stop
    });
  }

  return {
    stopPct,                       // the tightest fixed stop that loses no winner
    marginFrac,
    holdHours,
    feePerLeg,
    clipUsd,
    curve,
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
