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
  planted.generatePlanted({ fromMonth: '2024-01', toDate: '2025-09-30' });
  const combo = { trade: planted.PLANTED_SYMBOL, ctx1: null, ctx2: null, size: 1 };
  const branch = { geometry: 'daily-1d', decision: 'argmax', band: 'auto', weekdaysOnly: false };
  // EXPLICIT ranges, not allLoaded: the run is swept over months ending 2025-06
  // and the grid is later asked over months ending 2025-09 — which IS "the cache
  // grew under a stored run". It also has to be explicit because getMap keys the
  // in-process map cache on `symbol|all` when allLoaded is set, so a cache that
  // grew on disk is invisible to a running process and the case would be vacuous.
  const params = {
    allLoaded: false, startMonth: '2024-01', endMonth: '2025-06',
    windowLayout: 'split70', holdout: true, minTrades: 5, feePerLeg: 0.125,
    dMults: [1], tHours: [41], gates: ['directional'], entries: ['breakout', 'market'], trailing: false,
  };
  const grownParams = { ...params, endMonth: '2025-09' };
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
    // A window that is genuinely GONE must still refuse — the data was revised
    // under the run, so its stored votes no longer describe those windows.
    const tampered = JSON.parse(JSON.stringify(res.memberDump));
    tampered.startTs.search[0] += 3600000;
    let err = null;
    try { await menuGridTask({ combo, branch, params, dump: tampered }); } catch (e) { err = e; }
    assert.ok(err && /no longer in the data|revised/i.test(err.message),
      `a window missing from the data must refuse; got: ${err && err.message}`);

    // ...but a cache that has merely GROWN must still open (owner, 2026-08-19).
    // This is the case that was wrongly refused: every window the run used is
    // still present, with this week's candles added after them. Extending the
    // planted series reproduces exactly that, and the grid must come back with
    // the SAME money as before, because it is scoring the same votes over the
    // same windows.
    const grown = await menuGridTask({ combo, branch, params: grownParams, dump: res.memberDump });
    assert.strictEqual(grown.cells.length, grid.cells.length,
      'a grown cache changed the grid shape — the run\'s own windows were not rebuilt');
    const grownTwin = grown.cells.find((c) => c.quorum === twin.quorum
      && c.entry === twin.entry && c.tHours === twin.tHours && c.dMult === twin.dMult);
    assert.ok(grownTwin, 'the sweep-chosen cell vanished once the cache grew');
    assert.ok(Math.abs(grownTwin.pnl - twin.pnl) < 1e-9,
      `a grown cache changed the money (${grownTwin.pnl} vs ${twin.pnl}) — the grid is not `
      + 'scoring the windows the votes were cast on');
  } finally {
    for (const f of fs.readdirSync(CACHE)) {
      if (f.startsWith(`${planted.PLANTED_SYMBOL}-1h-`)) fs.rmSync(path.join(CACHE, f), { force: true });
    }
  }
};

// QC 80: a null arm's votes must be a re-deal of THAT SLICE's own votes.
// Until 1.42.0 the board path dealt across the concatenated test+hold span, so
// a null arm's hold window carried the POOLED mix of both windows while the
// real arm kept the hold window's own mix. In a one-directional window that
// difference is worth money on its own, and it flattered every real arm.
// Drives the real worker on the fabricated pair — the only kind of check that
// would have caught it (a unit test of dealVotes alone passes either way).
module.exports.nullArmsAreDealtWithinTheirOwnSlice = async function () {
  const { unitTask } = require('../lib/bracketwork');
  planted.generatePlanted({ fromMonth: '2024-01', toDate: '2025-06-30' });
  const combo = { trade: planted.PLANTED_SYMBOL, ctx1: null, ctx2: null, size: 1 };
  const branch = { geometry: 'daily-1d', decision: 'argmax', band: 'auto', weekdaysOnly: false };
  const params = {
    allLoaded: true, windowLayout: 'split70', holdout: true, minTrades: 5, feePerLeg: 0.125,
    dMults: [1], tHours: [41], gates: ['directional'], entries: ['market'], trailing: false,
  };
  const tally = (calls) => {
    const c = { '-1': 0, 0: 0, 1: 0 };
    for (const v of calls) c[String(v)] = (c[String(v)] || 0) + 1;
    return `${c['-1']}/${c['0']}/${c['1']}`;
  };
  try {
    const real = await unitTask({ combo, branch, stage: 'promoted', params });
    const nul = await unitTask({ combo, branch, stage: 'promoted', params, nullDealSeed: 1 });
    const rv = real.memberDump.votes, nv = nul.memberDump.votes;
    assert.ok(rv.hold && nv.hold && rv.hold.length === nv.hold.length,
      'both arms must dump a hold slice with the same member count');
    for (let m = 0; m < rv.hold.length; m++) {
      assert.strictEqual(nv.hold[m].length, rv.hold[m].length,
        `member ${m}: null hold slice must be the same length as real`);
      assert.strictEqual(tally(nv.hold[m]), tally(rv.hold[m]),
        `member ${m}: null hold votes must be a PERMUTATION of the real hold votes `
        + `(down/flat/up real ${tally(rv.hold[m])} vs null ${tally(nv.hold[m])}) — a differing mix means `
        + 'the deal crossed the slice boundary and the null is carrying pooled-window direction');
      assert.strictEqual(tally(nv.search[m]), tally(rv.search[m]),
        `member ${m}: null search votes must be a permutation of the real search votes`);
    }
    const moved = rv.hold.some((calls, m) => calls.some((v, i) => v !== nv.hold[m][i]));
    assert.ok(moved, 'the null deal must actually move votes — an identity shuffle is not a null');
  } finally {
    for (const f of fs.readdirSync(CACHE)) {
      if (f.startsWith(`${planted.PLANTED_SYMBOL}-1h-`)) fs.rmSync(path.join(CACHE, f), { force: true });
    }
  }
};

// QC 81: a null arm must be dealt with ONE permutation shared by all members.
// Dealing members independently destroys their agreement as well as their
// timing, and the committee only trades when its members are not tied — so
// independent deals make the null trade less often than the real arm for
// reasons unrelated to skill (measured: real 310 of 364 periods, all 19
// independent draws 255-296). A shared permutation preserves the multiset of
// quorum calls exactly, so trade count and direction mix match by
// construction and only market alignment is destroyed.
module.exports.nullArmsPreserveCommitteeAgreementAndTradeCount = async function () {
  const { unitTask, quorumCall } = require('../lib/bracketwork');
  planted.generatePlanted({ fromMonth: '2024-01', toDate: '2025-06-30' });
  const combo = { trade: planted.PLANTED_SYMBOL, ctx1: null, ctx2: null, size: 1 };
  const branch = { geometry: 'daily-1d', decision: 'argmax', band: 'auto', weekdaysOnly: false };
  const params = {
    allLoaded: true, windowLayout: 'split70', holdout: true, minTrades: 5, feePerLeg: 0.125,
    dMults: [1], tHours: [41], gates: ['directional'], entries: ['market'], trailing: false,
  };
  // The committee's decision per period, tallied over the window: how many
  // periods it calls up, down, or stands aside. A correct null moves these
  // through time; it must not change how many of each there are.
  const callMix = (votes, k) => {
    const c = { up: 0, down: 0, aside: 0 };
    for (let i = 0; i < votes[0].length; i++) {
      const q = quorumCall(votes, i, k);
      c[q === 1 ? 'up' : q === -1 ? 'down' : 'aside']++;
    }
    return `${c.up}/${c.down}/${c.aside}`;
  };
  try {
    const real = await unitTask({ combo, branch, stage: 'promoted', params });
    const nul = await unitTask({ combo, branch, stage: 'promoted', params, nullDealSeed: 1 });
    const rv = real.memberDump.votes, nv = nul.memberDump.votes;
    for (const slice of ['search', 'hold']) {
      if (!rv[slice] || !rv[slice].length) continue;
      for (let k = 1; k <= rv[slice].length; k++) {
        assert.strictEqual(callMix(nv[slice], k), callMix(rv[slice], k),
          `${slice} slice, ${k}-of-${rv[slice].length}: the null committee must make the SAME number of `
          + `up/down/aside calls as the real one (real ${callMix(rv[slice], k)} vs null ${callMix(nv[slice], k)}). `
          + 'A mismatch means members were dealt independently, so the null trades a different amount than '
          + 'the arm it judges — QC 81.');
      }
    }
    const moved = rv.hold.some((calls, m) => calls.some((v, i) => v !== nv.hold[m][i]));
    assert.ok(moved, 'the null deal must actually move votes through time');
  } finally {
    for (const f of fs.readdirSync(CACHE)) {
      if (f.startsWith(`${planted.PLANTED_SYMBOL}-1h-`)) fs.rmSync(path.join(CACHE, f), { force: true });
    }
  }
};
