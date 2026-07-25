const { assert } = require('./helpers');
const { metaCall, committeeFor, splitHalves, bestConstantOf, FRACTION_MENU, SPECS } = require('../lib/metalens');

module.exports = {
  async menuIsTheRegisteredOne() {
    // fixed, pre-registered agreement fractions — never a continuous scan
    assert.deepStrictEqual(FRACTION_MENU, [0.5, 0.625, 0.75, 0.875, 1.0]);
    assert.strictEqual(SPECS.length, 8);
  },
  async metaCallNeedsBackersAndAMajority() {
    // 4 lenses, frac 0.5 -> need 2 same-direction AND strictly more than the
    // other side: a 2-2 split stands aside.
    assert.strictEqual(metaCall([1, 1, -1, -1], 0.5), 0);
    assert.strictEqual(metaCall([1, 1, 1, -1], 0.5), 1);
    assert.strictEqual(metaCall([-1, -1, 1, 0], 0.5), -1);
    // unanimity fraction on 3 lenses
    assert.strictEqual(metaCall([1, 1, 1], 1.0), 1);
    assert.strictEqual(metaCall([1, 1, 0], 1.0), 0);
    // one lens passing: any fraction just gates on that lens's call
    assert.strictEqual(metaCall([1], 0.75), 1);
    assert.strictEqual(metaCall([0], 0.5), 0);
    // zero lenses: always stand aside — "no signal found" is a result
    assert.strictEqual(metaCall([], 0.5), 0);
    // dormant calls never count as backing
    assert.strictEqual(metaCall([0, 0, 0, 1], 0.75), 0); // 1 backer < need 3
  },
  async zeroPassFallbackIsExplicitAndMarked() {
    const passed = [SPECS[0], SPECS[3]];
    // survivors exist: the fallback never engages, forced or not
    assert.deepStrictEqual(committeeFor(passed, SPECS, true), { specs: passed, forcedAll: false });
    assert.deepStrictEqual(committeeFor(passed, SPECS, false), { specs: passed, forcedAll: false });
    // nothing survives: default is stand-aside (empty committee)...
    assert.deepStrictEqual(committeeFor([], SPECS, false), { specs: [], forcedAll: false });
    // ...and the owner's fallback runs all 8, permanently marked as forced
    const forced = committeeFor([], SPECS, true);
    assert.strictEqual(forced.specs.length, 8);
    assert.strictEqual(forced.forcedAll, true);
  },
  async halvesAreChronological() {
    const chunks = Array.from({ length: 11 }, (_, i) => ({ startTs: i }));
    const { A, B } = splitHalves(chunks);
    assert.strictEqual(A.length, 5);
    assert.strictEqual(B.length, 6);
    assert.ok(Math.max(...A.map((c) => c.startTs)) < Math.min(...B.map((c) => c.startTs)), 'A strictly precedes B');
  },
  async bestConstantIsTheModeShare() {
    assert.strictEqual(bestConstantOf([0, 0, 0, 1, -1]), 0.6);
    assert.strictEqual(bestConstantOf([1, 1]), 1);
    assert.strictEqual(bestConstantOf([]), null);
  },
};
