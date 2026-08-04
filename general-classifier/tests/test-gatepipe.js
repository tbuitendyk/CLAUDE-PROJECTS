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

// The menu grid re-scores a promoted row's stored votes across the whole
// execution menu. Equivalence is the contract: the grid must contain the
// exact cell the sweep chose, at the same money — same machinery or nothing.
// And a grid on shifted windows must REFUSE, never render fiction.
module.exports.menuGridMatchesTheSweepAndRefusesShiftedWindows = async function () {
  const { unitTask, menuGridTask } = require('../lib/bracketwork');
  planted.generatePlanted({ fromMonth: '2024-01', toDate: '2025-06-30' });
  const combo = { trade: planted.PLANTED_SYMBOL, ctx1: null, ctx2: null, size: 1 };
  const branch = { geometry: 'daily-1d', decision: 'argmax', band: 'auto', weekdaysOnly: false };
  const params = {
    allLoaded: true, windowLayout: 'split70', holdout: true, minTrades: 5, feePerLeg: 0.125,
    dMults: [1], tHours: [41], gates: ['directional'], entries: ['breakout', 'market'], trailing: false,
  };
  try {
    const res = await unitTask({ combo, branch, stage: 'promoted', params });
    assert.ok(res.memberDump && res.best, 'promoted unit must dump members and pick a best cell');
    const grid = await menuGridTask({ combo, branch, params, dump: res.memberDump });
    assert.strictEqual(grid.cells.length, 6 * 2, '6 agreement levels x (1 breakout cell + 1 market cell)');
    const twin = grid.cells.find((c) => c.quorum === res.best.quorum
      && c.entry === (res.best.entry || 'breakout') && c.tHours === res.best.tHours
      && (c.entry === 'market' || c.dMult === res.best.dMult));
    assert.ok(grid.cells.every((c) => c.holdPnl === undefined && c.holdout === undefined),
      'per-cell held-back numbers must NEVER leave the engine — only the average is disclosed');
    assert.ok(grid.holdAvg == null || Number.isFinite(grid.holdAvg), 'hold average is a number when a hold window exists');
    assert.ok(twin, 'the sweep-chosen cell must exist in the grid');
    assert.ok(Math.abs(twin.pnl - res.best.pnl) < 1e-9, `grid money must equal sweep money (${twin.pnl} vs ${res.best.pnl})`);
    const tampered = JSON.parse(JSON.stringify(res.memberDump));
    tampered.startTs.search[0] += 3600000;
    let err = null;
    try { await menuGridTask({ combo, branch, params, dump: tampered }); } catch (e) { err = e; }
    assert.ok(err && /data cut|fiction/.test(err.message), 'shifted windows must refuse');
  } finally {
    for (const f of fs.readdirSync(CACHE)) {
      if (f.startsWith(`${planted.PLANTED_SYMBOL}-1h-`)) fs.rmSync(path.join(CACHE, f), { force: true });
    }
  }
};
