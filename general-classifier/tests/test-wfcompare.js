// The real-vs-null comparison arithmetic (lib/wfcompare.js) — the same
// declared formula the shell reader used, now testable and on the page.
const { assert } = require('./helpers');
const { med, pairedRows, supportedCount, compareRuns } = require('../lib/wfcompare');

// Tiny hand-checkable world: two setups, three folds each.
const REAL = {
  'AAA daily-1d argmax': { 100: 10, 200: 12, 300: -2 },
  'BBB daily-2d argmax': { 100: -5, 200: -1, 300: 0 },
};
const N1 = {
  'AAA daily-1d argmax': { 100: 2, 200: 4, 300: 6 },
  'BBB daily-2d argmax': { 100: -3, 200: 3, 300: 2 },
};
const N2 = {
  'AAA daily-1d argmax': { 100: 0, 200: 2, 300: -4 },
  'BBB daily-2d argmax': { 100: 1, 200: 1, 300: 4 },
};

module.exports = {
  async theMedianInterpolatesLikeTheEngine() {
    assert.strictEqual(med([1, 3]), 2, 'even length interpolates');
    assert.strictEqual(med([5]), 5);
    assert.strictEqual(med([]), null);
  },
  async pairingUsesOnlyFoldsAllRunsScored() {
    // knock fold 300 out of N1's AAA: AAA must pair on 2 folds only
    const n1 = JSON.parse(JSON.stringify(N1));
    delete n1['AAA daily-1d argmax'][300];
    const rows = pairedRows(REAL, [n1, N2]);
    const aaa = rows.find((r) => r.key.startsWith('AAA'));
    assert.strictEqual(aaa.n, 2, 'unpaired folds are dropped, not zero-filled');
  },
  async theCountsAndTheLineFollowTheDeclaredFormula() {
    // AAA paired d: 10-1=9, 12-3=9, -2-1=-3 -> med 9, pos 2/3 -> supported
    // BBB paired d: -5-(-1)=-4, -1-2=-3, 0-3=-3 -> med -3, pos 0 -> not
    const rows = pairedRows(REAL, [N1, N2]);
    assert.strictEqual(supportedCount(rows), 1);
    const out = compareRuns(REAL, [N1, N2]);
    assert.strictEqual(out.realCount, 1);
    assert.strictEqual(out.luckCounts.length, 2, 'each null scored against the rest');
    const mx = Math.max(...out.luckCounts);
    const mn = Math.min(...out.luckCounts);
    assert.strictEqual(out.line, mx + (mx - mn), 'line = max luck count + spread');
    assert.strictEqual(out.distinguishable, out.realCount > out.line);
    assert.ok(out.perCoin.AAA && out.perCoin.AAA.setups === 1);
  },
  async fewerThanTwoNullsIsRefusedLoudly() {
    assert.throws(() => compareRuns(REAL, [N1]), /at least 2 null runs/);
  },
};
