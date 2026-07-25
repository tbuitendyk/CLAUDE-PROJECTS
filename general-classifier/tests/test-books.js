const { assert } = require('./helpers');
const {
  validateConfig,
  generateDeclaration,
  callsFor,
  bookStats,
  settleAfterH,
  isLiveRecording,
  ALLOWED_RULES,
  SPECS,
} = require('../lib/books');
const { GEOMETRIES } = require('../lib/dataset');

const HOUR_MS = 3_600_000;
const preds = (labels) => Object.fromEntries(SPECS.map((s, i) => [s.key, labels[i]]));

module.exports = {
  async configValidationGuardsTheProtocol() {
    const ok = validateConfig({ pair: 'dotusdt', geometry: 'daily-3d', cutoff: '2026-07-01', rules: ['vote', 'q7'] });
    assert.strictEqual(ok.pair, 'DOTUSDT');
    assert.deepStrictEqual(ok.rules, ['vote', 'q7']);
    assert.strictEqual(ok.horizonPeriods, 90); // default verdict window
    assert.strictEqual(ok.feePerLeg, 0.125); // research friction (VERDICTS.md)
    assert.strictEqual(validateConfig({ pair: 'DOTUSDT', feePerLeg: 0.5 }).feePerLeg, 0.5);
    assert.throws(() => validateConfig({ pair: 'DOTUSDT', feePerLeg: 2 }), /0\.\.1/);
    assert.throws(() => validateConfig({ pair: 'DOTUSDT', compareSymbol: 'DOTUSDT' }), /differ/);
    assert.throws(() => validateConfig({ pair: 'DOTUSDT', geometry: 'hourly-1h' }), /unknown geometry/);
    assert.throws(() => validateConfig({ pair: 'DOTUSDT', band: 60 }), /between 0 and 50/);
    assert.throws(() => validateConfig({ pair: 'DOTUSDT', rules: ['q9'] }), /unknown rule/);
    assert.throws(() => validateConfig({ pair: 'DOTUSDT', horizonPeriods: 2 }), /5\.\.1000/);
    // the one rule that can never bend: models may not train on the future
    const future = new Date(Date.now() + 40 * 24 * HOUR_MS).toISOString().slice(0, 10);
    assert.throws(() => validateConfig({ pair: 'DOTUSDT', cutoff: future }), /past/);
    // defaults: all five rules, duplicates collapse
    assert.deepStrictEqual(validateConfig({ pair: 'DOTUSDT', rules: ['q6', 'q6'] }).rules, ['q6']);
    assert.deepStrictEqual(validateConfig({ pair: 'DOTUSDT' }).rules, ALLOWED_RULES);
  },
  async declarationCarriesTheCommitments() {
    const config = validateConfig({ pair: 'DOTUSDT', geometry: 'daily-3d', cutoff: '2026-07-01', rules: ['vote', 'q6', 'q7'], notes: 'motivated by the 1000-shift null' });
    const text = generateDeclaration(config, { trainChunks: 2400, totalChunks: 2500, bandPct: 2.13 }, 3);
    for (const must of [
      'BOOK #3', 'DOTUSDT', 'daily-3d', '+73h', '+114h', '41h hold',
      '±2.13%', '2400 chunks', '2026-07-01',
      'ALL reported, none promotable',
      '≥6 of 8', '≥7 of 8', 'majority of the 8',
      '90 live periods', 'NEW book', 'denominator',
      'motivated by the 1000-shift null',
    ]) {
      assert.ok(text.includes(must), `declaration missing: ${must}`);
    }
    // fixed band variant states the number and not the adaptive language
    const fixed = validateConfig({ pair: 'DOTUSDT', band: 5 });
    const t2 = generateDeclaration(fixed, { trainChunks: 500, totalChunks: 600, bandPct: 5 }, 4);
    assert.ok(t2.includes('fixed ±5%'));
    assert.ok(!t2.includes('adaptive'));
  },
  async rulesSubsetControlsTheCalls() {
    // only the declared rules get calls — nothing extra sneaks into the record
    const p = preds([1, 1, 1, 1, 1, 1, 1, -1]); // 7 up, 1 down
    assert.deepStrictEqual(callsFor(p, ['vote', 'q7']), { vote: 1, q7: 1 });
    assert.deepStrictEqual(callsFor(p, ['q8']), { q8: 0 }); // 7 up does not clear unanimity
    assert.deepStrictEqual(Object.keys(callsFor(p, ['q5', 'q6', 'q7', 'q8'])), ['q5', 'q6', 'q7', 'q8']);
  },
  async liveRuleMatchesEachGeometry() {
    // points geometries: live until the exit candle exists
    const start = Date.UTC(2026, 6, 6);
    const geo3 = GEOMETRIES['daily-3d'];
    assert.ok(isLiveRecording(start + (geo3.exitOffsetH - 1) * HOUR_MS, start, 'daily-3d'));
    assert.ok(!isLiveRecording(start + geo3.exitOffsetH * HOUR_MS, start, 'daily-3d'));
    // weekly: live until the outcome window opens (Thu 12:00 = +252h), the
    // same rule the original tracker's amended protocol uses
    assert.ok(isLiveRecording(start + 251 * HOUR_MS, start, 'weekly-8d'));
    assert.ok(!isLiveRecording(start + 252 * HOUR_MS, start, 'weekly-8d'));
  },
  async settlementWaitsForTheOutcome() {
    assert.strictEqual(settleAfterH('daily-1d'), 43);
    assert.strictEqual(settleAfterH('daily-3d'), 115);
    assert.strictEqual(settleAfterH('weekly-8d'), 259); // Thu 18:00 + 1, like the tracker
  },
  async bookStatsExcludeStandAsidesFromTrades() {
    const settled = [
      { calls: { q6: 1 }, actual: 1, pnl: { q6: 9 } },
      { calls: { q6: 0 }, actual: 0, pnl: { q6: 0 } },
      { calls: { q6: -1 }, actual: 1, pnl: { q6: -11 } },
    ];
    const s = bookStats(settled, (p) => p.calls.q6, 'q6');
    assert.strictEqual(s.trades, 2);
    assert.strictEqual(s.wins, 1);
    assert.ok(Math.abs(s.pnl - -2) < 1e-9);
    assert.strictEqual(s.correct, 2); // the win and the correct stand-aside
    assert.strictEqual(s.scored, 3);
    // trade accuracy judges only the periods the rule acted on — the DOT
    // "3-for-3 but 50%" confusion, split into its two honest numbers
    assert.strictEqual(s.tradeCorrect, 1);
    assert.strictEqual(s.tradeScored, 2);
  },
  async frozenBooksAreUnreachable() {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'books.js'), 'utf8');
    assert.ok(!src.includes("require('./tracker')"), 'engine must not import the frozen tracker');
    assert.ok(!src.includes("require('./dogebook')"), 'engine must not import the frozen doge book');
  },
};
