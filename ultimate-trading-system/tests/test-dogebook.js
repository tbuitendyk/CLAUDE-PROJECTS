const { assert } = require('./helpers');
const { callsFor, bookStats, isLive, SPECS, QUORUMS, BOOK_KEYS, GEOMETRY, SETTLE_AFTER_H } = require('../lib/dogebook');
const { GEOMETRIES } = require('../lib/dataset');

const HOUR_MS = 3_600_000;
const GEO = GEOMETRIES[GEOMETRY];

const preds = (labels) => Object.fromEntries(SPECS.map((s, i) => [s.key, labels[i]]));

module.exports = {
  async protocolConstantsMatchTheDocument() {
    // TRACKER-DOGE.md: daily-3d, entry +73h, exit +114h, 41-hour hold.
    assert.strictEqual(GEOMETRY, 'daily-3d');
    assert.strictEqual(GEO.featureHours, 72);
    assert.strictEqual(GEO.entryOffsetH, 73);
    assert.strictEqual(GEO.exitOffsetH, 114);
    assert.strictEqual(GEO.exitOffsetH - GEO.entryOffsetH, 41);
    assert.strictEqual(SETTLE_AFTER_H, 115); // exit candle knowable
    assert.deepStrictEqual(QUORUMS, [5, 6, 7, 8]);
    assert.deepStrictEqual(BOOK_KEYS, ['vote', 'q5', 'q6', 'q7', 'q8']);
    assert.strictEqual(SPECS.length, 8);
  },
  async everyDeclaredBookGetsACall() {
    // 6 up, 2 down: vote long, q5 and q6 fire, q7 and q8 stand aside.
    const c = callsFor(preds([1, 1, 1, 1, 1, 1, -1, -1]));
    assert.deepStrictEqual(c, { vote: 1, q5: 1, q6: 1, q7: 0, q8: 0 });
    // unanimous: every book trades
    assert.deepStrictEqual(callsFor(preds([-1, -1, -1, -1, -1, -1, -1, -1])),
      { vote: -1, q5: -1, q6: -1, q7: -1, q8: -1 });
    // 4-4 split: the vote's tie rule stands aside and no quorum is reachable
    assert.deepStrictEqual(callsFor(preds([1, 1, 1, 1, -1, -1, -1, -1])),
      { vote: 0, q5: 0, q6: 0, q7: 0, q8: 0 });
    // plurality is not a quorum: 5 up vs 3 down clears q5 only
    assert.deepStrictEqual(callsFor(preds([1, 1, 1, 1, 1, -1, -1, -1])),
      { vote: 1, q5: 1, q6: 0, q7: 0, q8: 0 });
  },
  async liveMeansRecordedBeforeTheOutcome() {
    const start = Date.UTC(2026, 6, 6); // a Monday, irrelevant to daily stepping
    const exitTs = start + GEO.exitOffsetH * HOUR_MS;
    assert.ok(isLive(exitTs - HOUR_MS, start), 'an hour before the exit is live');
    assert.ok(!isLive(exitTs, start), 'at the exit candle it is no longer live');
    assert.ok(!isLive(exitTs + 5 * HOUR_MS, start), 'after the outcome it is unseen');
    // recording before the entry is obviously live too
    assert.ok(isLive(start + GEO.entryOffsetH * HOUR_MS - HOUR_MS, start));
  },
  async bookStatsCountWhatWasTraded() {
    const settled = [
      { calls: { q7: 1 }, actual: 1, pnl: { q7: 9 } }, // win
      { calls: { q7: 0 }, actual: -1, pnl: { q7: 0 } }, // stood aside, wrong call
      { calls: { q7: -1 }, actual: 1, pnl: { q7: -11 } }, // loss
      { calls: { q7: 0 }, actual: 0, pnl: { q7: 0 } }, // stood aside, right
    ];
    const b = bookStats(settled, (p) => p.calls.q7, 'q7');
    assert.strictEqual(b.trades, 2); // stand-asides are not trades
    assert.strictEqual(b.wins, 1);
    assert.ok(Math.abs(b.pnl - -2) < 1e-9);
    assert.ok(Math.abs(b.grossPerTrade - 0) < 1e-9); // (-2 + 2) / 2
    assert.strictEqual(b.correct, 2); // periods 1 and 4
    assert.strictEqual(b.scored, 4);
    // a book that never fires reports honestly rather than dividing by zero
    const idle = bookStats(settled, () => 0, 'q8');
    assert.strictEqual(idle.trades, 0);
    assert.strictEqual(idle.grossPerTrade, null);
  },
  async frozenTrackerIsUntouched() {
    // The DOT/AVAX book must not be reachable from this module: separate
    // state file, separate module, sharing only paper.js primitives.
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'dogebook.js'), 'utf8');
    assert.ok(!src.includes("require('./tracker')"), 'dogebook must not import the frozen tracker');
    assert.ok(src.includes('data'), 'dogebook has its own state path');
    const tracker = require('../lib/tracker');
    assert.strictEqual(typeof tracker.status, 'function'); // still loads independently
  },
};
