// stoptuner: the tightest fixed stop that preserves every winner is max(MAE) over
// winners, read from hourly bar extremes. Synthetic candle maps, no network.
const { assert } = require('./helpers');
const { HOUR_MS } = require('../lib/binance');
const { tuneFixedStop, entryOutcome } = require('../lib/stoptuner');

// build a hold: entry bar (open=entry), intervening bars with a given adverse
// extreme, and an exit bar (open=exit). holdHours bars are walked [0..hold).
function putHold(map, entryTs, { entry, exit, low, high, hold = 3 }) {
  map.set(entryTs, { open: entry, high: high || entry, low: low || entry, close: entry });
  for (let h = 1; h < hold; h++) {
    map.set(entryTs + h * HOUR_MS, {
      open: entry, high: high || entry, low: low || entry, close: entry,
    });
  }
  map.set(entryTs + hold * HOUR_MS, { open: exit, high: exit, low: exit, close: exit });
}

module.exports.tightestStopIsMaxWinnerMae = function () {
  const map = new Map();
  // A: LONG winner, dips 5% (MAE .05), exits +10%
  putHold(map, 0, { entry: 100, exit: 110, low: 95 });
  // B: LONG winner, dips 2% (MAE .02), exits +5%
  putHold(map, 10 * HOUR_MS, { entry: 100, exit: 105, low: 98 });
  // C: LONG loser, dips 10% (MAE .10), exits -8% -> must NOT constrain the stop
  putHold(map, 20 * HOUR_MS, { entry: 100, exit: 92, low: 90 });
  const entries = [
    { entryTs: 0, side: 'LONG' },
    { entryTs: 10 * HOUR_MS, side: 'LONG' },
    { entryTs: 20 * HOUR_MS, side: 'LONG' },
  ];
  const r = tuneFixedStop(entries, map, { holdHours: 3, feePerLeg: 0.001 });
  assert.strictEqual(r.counts.winners, 2, 'A and B are winners; C is a loser');
  assert.ok(Math.abs(r.stopPct - 0.05) < 1e-9, `tightest stop = max winner MAE (0.05), got ${r.stopPct}`);
  assert.strictEqual(r.binding.entryTs, 0, 'the binding winner is A (deepest surviving dip)');
  assert.strictEqual(r.counts.losersCutByStop, 1, 'loser C (MAE .10 >= .05) is cut by the stop');
};

module.exports.shortSideMaeUsesHighsAndCanBind = function () {
  const map = new Map();
  // A: LONG winner, MAE .05
  putHold(map, 0, { entry: 100, exit: 110, low: 95 });
  // D: SHORT winner, adverse = price UP to 107 (MAE .07), exits down to 95 (+5%)
  putHold(map, 10 * HOUR_MS, { entry: 100, exit: 95, high: 107 });
  const r = tuneFixedStop(
    [{ entryTs: 0, side: 'LONG' }, { entryTs: 10 * HOUR_MS, side: 'SHORT' }],
    map, { holdHours: 3, feePerLeg: 0.001 },
  );
  assert.strictEqual(r.counts.winners, 2);
  assert.ok(Math.abs(r.stopPct - 0.07) < 1e-9, `short MAE (.07) binds, got ${r.stopPct}`);
  assert.strictEqual(r.binding.side, 'SHORT', 'the short is the binding constraint');
};

module.exports.feesDecideAMarginalWinnerLoser = function () {
  const map = new Map();
  // gross +0.15% but 2 legs of 0.1% fee = 0.2% -> NET negative -> a loser, so its
  // deep MAE must NOT loosen the stop (it is not "money making").
  putHold(map, 0, { entry: 100, exit: 100.15, low: 80 }); // MAE .20, net < 0
  // a genuine net winner with a small MAE
  putHold(map, 10 * HOUR_MS, { entry: 100, exit: 110, low: 99 }); // MAE .01
  const r = tuneFixedStop(
    [{ entryTs: 0, side: 'LONG' }, { entryTs: 10 * HOUR_MS, side: 'LONG' }],
    map, { holdHours: 3, feePerLeg: 0.001 },
  );
  assert.strictEqual(r.counts.winners, 1, 'the fee-negative trade is not a winner');
  assert.ok(Math.abs(r.stopPct - 0.01) < 1e-9, `only the real winner (MAE .01) binds, got ${r.stopPct}`);
};

module.exports.noWinnersLeavesStopUnconstrained = function () {
  const map = new Map();
  putHold(map, 0, { entry: 100, exit: 90, low: 85 }); // loser
  const r = tuneFixedStop([{ entryTs: 0, side: 'LONG' }], map, { holdHours: 3 });
  assert.strictEqual(r.stopPct, null, 'no winners -> the winner constraint is vacuous');
  assert.strictEqual(r.binding, null);
};

module.exports.unpricedEntriesAreSkippedNotCounted = function () {
  const map = new Map();
  putHold(map, 0, { entry: 100, exit: 110, low: 95 });
  // second entry has no bars at all -> unpriced
  const r = tuneFixedStop(
    [{ entryTs: 0, side: 'LONG' }, { entryTs: 999 * HOUR_MS, side: 'LONG' }],
    map, { holdHours: 3, feePerLeg: 0.001 },
  );
  assert.strictEqual(r.counts.unpriced, 1, 'the entry with no candles is unpriced');
  assert.strictEqual(r.counts.priced, 1);
  assert.ok(Math.abs(r.stopPct - 0.05) < 1e-9);
};

module.exports.marginFracWidensTheStopAwayFromTheBoundary = function () {
  const map = new Map();
  putHold(map, 0, { entry: 100, exit: 110, low: 95 }); // MAE .05
  const r = tuneFixedStop([{ entryTs: 0, side: 'LONG' }], map,
    { holdHours: 3, feePerLeg: 0.001, marginFrac: 0.2 });
  assert.ok(Math.abs(r.stopPct - 0.06) < 1e-9, `.05 widened by 20% = .06, got ${r.stopPct}`);
};

module.exports.sacrificeCurveShowsBothSidesPerStopLevel = function () {
  const map = new Map();
  putHold(map, 0, { entry: 100, exit: 110, low: 95 });            // A: winner, MAE .05
  putHold(map, 10 * HOUR_MS, { entry: 100, exit: 105, low: 98 }); // B: winner, MAE .02
  putHold(map, 20 * HOUR_MS, { entry: 100, exit: 92, low: 90 });  // C: loser,  MAE .10
  const r = tuneFixedStop(
    [{ entryTs: 0, side: 'LONG' }, { entryTs: 10 * HOUR_MS, side: 'LONG' }, { entryTs: 20 * HOUR_MS, side: 'LONG' }],
    map, { holdHours: 3, feePerLeg: 0.001, clipUsd: 10 },
  );
  // k=0: preserve all winners (stop just above .05). No winner cut; loser C is cut.
  const c0 = r.curve[0];
  assert.strictEqual(c0.sacrificeTopWinners, 0);
  assert.strictEqual(c0.winnersForfeited, 0, 'preserving all winners forfeits none');
  assert.strictEqual(c0.losersCut, 1, 'the deep loser is still cut');
  // cutting C at ~-5.2% instead of riding to ~-8.2% SAVES ~ $0.30 on the $10 clip
  assert.ok(Math.abs(c0.netPnlDeltaUsd - 0.30) < 1e-6, `k0 net ${c0.netPnlDeltaUsd}`);
  // k=1: give up the deepest winner A (stop just above .02); B preserved, C cut.
  const c1 = r.curve[1];
  assert.strictEqual(c1.winnersForfeited, 1, 'the one outlier winner is sacrificed');
  assert.ok(Math.abs(c1.winnerProfitForfeitedUsd - 0.98) < 1e-6, `A profit given up ${c1.winnerProfitForfeitedUsd}`);
  assert.strictEqual(c1.losersCut, 1);
  assert.ok(Math.abs(c1.netPnlDeltaUsd - (-0.60)) < 1e-6, `k1 net ${c1.netPnlDeltaUsd}`);
};

// STOPMATH BUG 1/2 (2026-08-11 e2e review): the engine stop boundary is STRICT
// (px < ep*(1-stop)), so a position sitting EXACTLY at the stop is preserved, not
// cut. The tuner's loser-cut count must use the same strict predicate (mae > stop),
// not the old weak `>=`, or it over-reports the losers the live engine would cut.
module.exports.loserExactlyAtStopIsSparedStrictBoundary = function () {
  const map = new Map();
  // winner A, MAE .05 -> tightest stop = .05
  putHold(map, 0, { entry: 100, exit: 110, low: 95 });
  // loser B, MAE EXACTLY .05 (dips to 95), exits -3%: sits ON the boundary
  putHold(map, 10 * HOUR_MS, { entry: 100, exit: 97, low: 95 });
  // loser C, MAE .06 (dips to 94): STRICTLY breaches the stop
  putHold(map, 20 * HOUR_MS, { entry: 100, exit: 97, low: 94 });
  const r = tuneFixedStop(
    [{ entryTs: 0, side: 'LONG' }, { entryTs: 10 * HOUR_MS, side: 'LONG' }, { entryTs: 20 * HOUR_MS, side: 'LONG' }],
    map, { holdHours: 3, feePerLeg: 0.001 },
  );
  assert.ok(Math.abs(r.stopPct - 0.05) < 1e-9, `stop = max winner MAE .05, got ${r.stopPct}`);
  assert.strictEqual(r.counts.losersCutByStop, 1,
    'only the loser STRICTLY past the stop (MAE .06) is cut; the one exactly at .05 is spared (strict boundary, matches engine)');
};

// STOPMATH BUG 3 (2026-08-11 e2e review): the exit lookup walks <=3h forward over
// gaps, EXACTLY as bracket.js (the authoritative forward book) does, so the tuner
// prices the same population the book trades. An entry whose exact-exit bar is
// missing but has a bar within 3h must be PRICED, not dropped as unpriced.
module.exports.exitGapWithinThreeHoursIsPricedNotDropped = function () {
  const map = new Map();
  map.set(0, { open: 100, high: 100, low: 96, close: 100 });
  map.set(1 * HOUR_MS, { open: 100, high: 100, low: 96, close: 100 });
  map.set(2 * HOUR_MS, { open: 100, high: 100, low: 96, close: 100 });
  // nominal exit at 3h is MISSING (data gap); the next bar is 2h late at 5h
  map.set(5 * HOUR_MS, { open: 108, high: 108, low: 108, close: 108 });
  const o = entryOutcome(0, 'LONG', map, 3, 0.001);
  assert.ok(o.priced, 'an exit within 3h of the nominal bar is priced, not dropped as unpriced');
  assert.ok(Math.abs(o.exit - 108) < 1e-9, 'exit is taken from the gap-resolved bar (108)');
  assert.ok(Math.abs(o.mae - 0.04) < 1e-9, `MAE walks the stretched hold [0..5): dips to 96 -> .04, got ${o.mae}`);
};

module.exports.exitGapBeyondThreeHoursIsUnpriced = function () {
  const map = new Map();
  map.set(0, { open: 100, high: 100, low: 100, close: 100 });
  map.set(1 * HOUR_MS, { open: 100, high: 100, low: 100, close: 100 });
  map.set(2 * HOUR_MS, { open: 100, high: 100, low: 100, close: 100 });
  // exit only at 7h = 4h past the nominal 3h exit -> beyond the 3h tolerance
  map.set(7 * HOUR_MS, { open: 108, high: 108, low: 108, close: 108 });
  const o = entryOutcome(0, 'LONG', map, 3, 0.001);
  assert.ok(!o.priced, 'an exit more than 3h past nominal is not priced (matches bracket.js tolerance)');
};

module.exports.entryOutcomeReportsMaeAndPnl = function () {
  const map = new Map();
  putHold(map, 0, { entry: 200, exit: 220, low: 190 });
  const o = entryOutcome(0, 'LONG', map, 3, 0.001);
  assert.ok(o.priced);
  assert.ok(Math.abs(o.mae - 0.05) < 1e-9, 'MAE = (200-190)/200 = .05');
  assert.ok(Math.abs(o.grossPct - 0.1) < 1e-9, 'gross = (220-200)/200 = .10');
};
