// lib/compare.js — the run comparison the Tune section offers.
//
// It had no coverage at all, on a path the owner reaches from the screen. The
// rule it enforces is the one-variable rule: a money difference between two
// runs means something only when exactly ONE setting differs. Getting that
// wrong does not crash — it labels a confounded comparison as attributable,
// which is a wrong answer delivered confidently.
const { assert } = require('./helpers');
const { compareDocs, settingsDiff, ALLOW_DIFF } = require('../lib/compare');

const doc = (id, params, rows = []) => ({ id, params, edgeCensus: rows });
const row = (trade, layout, pnl) => ({
  trade, ctx1: 'BTCUSDT', ctx2: '', geometry: 'daily-3d', decision: 'directional',
  windowLayout: layout, holdPnl: pnl, searchPnl: pnl, shiftFrac: null, trades: 10,
});

module.exports = {
  // Absent, null and undefined are the SAME recorded state. A key that simply
  // did not exist when an older run was stored must not read as a difference,
  // or every old run looks confounded against every new one.
  async absentAndNullAreTheSameRecordedState() {
    assert.deepStrictEqual(settingsDiff({ a: null }, {}, new Set()), []);
    assert.deepStrictEqual(settingsDiff({ a: undefined }, { a: null }, new Set()), []);
    assert.deepStrictEqual(settingsDiff({ a: 1 }, { a: 2 }, new Set()), ['a']);
  },

  // The allow-list exists so a layout-only pair is not rejected out of hand.
  async theAllowListIsHonouredWhenPassed() {
    assert.deepStrictEqual(settingsDiff({ windowLayout: 'x' }, { windowLayout: 'y' }, ALLOW_DIFF), []);
    assert.deepStrictEqual(settingsDiff({ windowLayout: 'x' }, { windowLayout: 'y' }, new Set()), ['windowLayout']);
  },

  // ONE difference is attributable. Two is not, and saying otherwise is the
  // whole failure this tool exists to prevent.
  async oneDifferenceIsAttributableAndTwoAreNot() {
    const rows = [row('DOTUSDT', 'legacy80', 12)];
    const one = compareDocs(
      doc('a', { windowLayout: 'legacy80', minTrades: 8 }, rows),
      doc('b', { windowLayout: 'split70', minTrades: 8 }, rows),
    );
    assert.strictEqual(one.attributable, true);

    const two = compareDocs(
      doc('a', { windowLayout: 'legacy80', minTrades: 8 }, rows),
      doc('b', { windowLayout: 'split70', minTrades: 20 }, rows),
    );
    assert.strictEqual(two.attributable, false);
    assert.ok(two.differences.length >= 2, 'both differing settings must be named');
  },

  // Identical settings on different code is not a twin comparison, and the
  // reader has to be told rather than left to assume.
  async differentEngineVersionsRaiseAWarning() {
    const rows = [row('DOTUSDT', 'legacy80', 12)];
    const r = compareDocs(
      doc('a', { windowLayout: 'legacy80', engineVersion: '1.0.0' }, rows),
      doc('b', { windowLayout: 'split70', engineVersion: '2.0.0' }, rows),
    );
    assert.ok(r.warnings.some((w) => /ENGINE VERSIONS DIFFER/.test(w)),
      'a version mismatch passed without a warning');
  },

  // A single run has nothing to compare against and must say so, not return
  // an empty comparison that reads as "no difference found".
  async aSingleRunRefusesRatherThanReturningNothing() {
    assert.throws(
      () => compareDocs(doc('solo', { windowLayout: 'legacy80' }, [row('DOTUSDT', 'legacy80', 1)]), null),
      /pick a second run/,
    );
  },
};
