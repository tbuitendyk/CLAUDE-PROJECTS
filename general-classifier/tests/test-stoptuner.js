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

module.exports.entryOutcomeReportsMaeAndPnl = function () {
  const map = new Map();
  putHold(map, 0, { entry: 200, exit: 220, low: 190 });
  const o = entryOutcome(0, 'LONG', map, 3, 0.001);
  assert.ok(o.priced);
  assert.ok(Math.abs(o.mae - 0.05) < 1e-9, 'MAE = (200-190)/200 = .05');
  assert.ok(Math.abs(o.grossPct - 0.1) < 1e-9, 'gross = (220-200)/200 = .10');
};
