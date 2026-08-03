// THROUGH-PIPELINE coverage the adversarial review demanded (2026-08-03):
// the suite was green while (a) the promote stage dropped the null-deal seed
// — so every census sweep's null boards ran as REAL arms — and (b) Tool 1's
// replay task returned an undeclared variable and died on every call. Both
// were invisible because no test crossed the orchestration/worker seam with
// real payload shapes. These do.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const batch = require('../lib/batch');
const planted = require('../lib/planted');

const CACHE = path.join(__dirname, '..', 'data', 'cache');

const GATE_UNITS = () => {
  const c = { trade: planted.PLANTED_SYMBOL, ctx1: null, ctx2: null, size: 1 };
  const b = { geometry: 'daily-1d', decision: 'argmax', band: 'auto', weekdaysOnly: false };
  return [
    { c, b, nullDealSeed: null },
    { c, b, nullDealSeed: 1 },
    { c, b, nullDealSeed: 2 },
  ];
};

module.exports = {
  async promoteStageCarriesTheNullDealSeed() {
    // Watched failing 2026-08-03: the edge-screen branch of promotionSet
    // rebuilt each unit and dropped nullDealSeed, so the four gate null
    // boards (and every census sweep's null arms) ran un-dealt — bit-
    // identical to the real arm — and their census rows were tagged real.
    const rows = batch.promotionSet({ edgeScreen: true }, { leaders: [] }, GATE_UNITS());
    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(rows.map((r) => r.nullDealSeed ?? null), [null, 1, 2],
      'the promote stage must carry each arm\'s deal seed');
    const keys = new Set(rows.map((r) => r.key));
    assert.strictEqual(keys.size, 3,
      'the three arms must have distinct keys — shared keys collide model dumps and leader rows');
  },
  async toolOneReplayRunsThroughTheRealWorkerOnFabricatedData() {
    // The replay task must RETURN — 1.32.0 shipped it returning an
    // undeclared variable (ReferenceError on every call), and the fix round
    // that touched it never executed it. This runs it end to end on the
    // fabricated pair: real training, real deal, real menu sweep.
    const { nullRotationTask } = require('../lib/bracketwork');
    planted.generatePlanted({ fromMonth: '2024-01', toDate: '2025-06-30' });
    try {
      const out = await nullRotationTask({
        combo: { trade: planted.PLANTED_SYMBOL, ctx1: null, ctx2: null, size: 1 },
        branch: { geometry: 'daily-1d', decision: 'argmax', band: 'auto', weekdaysOnly: false },
        params: {
          allLoaded: true, windowLayout: 'split70', holdout: true, minTrades: 5, feePerLeg: 0.125,
          dMults: [1], tHours: [41], gates: ['directional'], entries: ['breakout'],
        },
        shiftIndex: 0,
        nShifts: 1,
        selection: { quorum: 2, gate: 'directional', entry: 'breakout', dMult: 1, tHours: 41 },
      });
      assert.ok(out && typeof out === 'object', 'replay must return');
      assert.strictEqual(out.shiftIndex, 0);
      assert.ok(Number.isFinite(out.best) || out.best === -Infinity, 'best-of-menu present');
    } finally {
      for (const f of fs.readdirSync(CACHE)) {
        if (f.startsWith(`${planted.PLANTED_SYMBOL}-1h-`)) fs.rmSync(path.join(CACHE, f), { force: true });
      }
    }
  },
};
