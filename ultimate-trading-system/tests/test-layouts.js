// The three explicit window layouts (owner ruling, 2026-08-03):
// legacy80 = 80/20, split70 = 70/15/15, reserve61 = 61/13/13/13 with the
// final 13% SEALED. Retired quota layouts refuse loudly at launch.
const { assert } = require('./helpers');
const { splitBounds } = require('../lib/bracketwork');

module.exports = {
  async splitBoundsStillEncodesBothPercentageSplits() {
    const a = splitBounds(1000, false); // legacy80
    assert.strictEqual(a.nHold, 0);
    assert.strictEqual(a.nTest, 200, '80/20: test is 20%');
    const b = splitBounds(1000, true); // split70 (and reserve61 after the seal)
    assert.strictEqual(b.nHold, 150);
    assert.strictEqual(b.nTest, 150, '70/15/15: test and hold are 15% each');
  },
  async retiredLayoutNamesRefuseLoudlyAtLaunch() {
    const batch = require('../lib/batch');
    for (const bad of ['interlaced', 'chronological', 'both', 'legacy', 'nonsense']) {
      let err = null;
      try {
        await batch.startBracketLab({
          universe: ['DOTUSDT'], sizes: { singles: true }, windowLayout: bad,
        });
      } catch (e) { err = e; }
      assert.ok(err, `'${bad}' must refuse`);
      assert.ok(/unknown window layout/.test(err.message), `loud refusal names the problem: ${err.message}`);
      if (bad !== 'nonsense') assert.ok(/retired/.test(err.message), `retired names say so: ${err.message}`);
    }
  },
  async theReserveSealsTheFinalThirteenPercent() {
    // Arithmetic check on the carve itself: 13% sealed, then 70/15/15 of the
    // rest = 60.9/13.05/13.05/13 of the total — the owner's 61/13/13/13.
    const total = 1000;
    const nReserve = Math.max(2, Math.round(total * 0.13));
    assert.strictEqual(nReserve, 130);
    const remaining = total - nReserve;
    const { nTest, nHold } = splitBounds(remaining, true);
    const nTrain = remaining - nTest - nHold;
    assert.ok(Math.abs(nTrain / total - 0.609) < 0.005, `train ~61% of total (got ${nTrain / total})`);
    assert.ok(Math.abs(nTest / total - 0.13) < 0.005, 'test ~13% of total');
    assert.ok(Math.abs(nHold / total - 0.13) < 0.005, 'hold ~13% of total');
  },
};
