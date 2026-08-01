const { assert } = require('./helpers');
const { foldGrid, foldSlices, reachMs, nullRng, dealVotes, TEST_WEEKS, HOLD_WEEKS, STEP_WEEKS, WARMUP_WEEKS } = require('../lib/walkforward');
const { GEOMETRIES } = require('../lib/dataset');

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const T0 = Date.UTC(2020, 0, 6);

module.exports = {
  async foldGridTilesHistoryUniformly() {
    const spanDays = 900;
    const g = foldGrid(T0, T0 + (spanDays - 1) * DAY);
    assert.ok(g.length >= 5, `expected several folds over ${spanDays} days, got ${g.length}`);
    // first fold starts after the warm-up, never before
    assert.strictEqual(g[0].testStart, T0 + WARMUP_WEEKS * WEEK);
    for (const f of g) {
      assert.strictEqual(f.holdStart - f.testStart, TEST_WEEKS * WEEK, 'test slice is 8 weeks');
      assert.strictEqual(f.holdEnd - f.holdStart, HOLD_WEEKS * WEEK, 'hold slice is 8 weeks');
    }
    // step = hold width: hold slices tile history with no gap and no overlap
    for (let i = 1; i < g.length; i++) {
      assert.strictEqual(g[i].testStart - g[i - 1].testStart, STEP_WEEKS * WEEK);
      assert.strictEqual(g[i].holdStart, g[i - 1].holdEnd, 'hold slices must tile exactly');
    }
    // no fold's hold slice runs past the data
    const last = g[g.length - 1];
    assert.ok(last.holdEnd <= T0 + spanDays * DAY, 'grid must not overrun the history');
    // THE COUNT INVARIANT: identical spans yield identical grids wherever
    // they sit on the calendar
    const shifted = foldGrid(T0 + 500 * DAY, T0 + (500 + spanDays - 1) * DAY);
    assert.strictEqual(shifted.length, g.length);
    for (let i = 0; i < g.length; i++) {
      assert.strictEqual(shifted[i].testStart - shifted[0].testStart, g[i].testStart - g[0].testStart);
    }
  },
  async reachCoversTheExecutionHorizonForEveryShape() {
    // Same lesson as QC 52: the purge must cover features, label window AND
    // the longest trade the menu allows.
    for (const [name, geo] of Object.entries(GEOMETRIES)) {
      const r = reachMs(geo, [17, 161]);
      const expect = Math.max(geo.featureHours, geo.exitOffsetH + 3, geo.entryOffsetH + 161 + 3) * 3_600_000;
      assert.strictEqual(r, expect, `${name}: reach must be the max of the three horizons`);
      assert.ok(r >= (geo.entryOffsetH + 161 + 3) * 3_600_000, `${name}: reach covers entry+timeout+gap-scan`);
    }
    // With a menu short enough that the EXIT horizon dominates, the reach
    // must still let the exit candle (or the weekly 6h window's tail) CLOSE:
    // exit+3, never bare exit. The old arithmetic passed every long-menu
    // case and understated exactly here.
    const d1 = GEOMETRIES['daily-1d'];
    assert.strictEqual(reachMs(d1, [14]), (d1.exitOffsetH + 3) * 3_600_000,
      'daily-1d with a 14h timeout: the exit candle itself sets the reach, and it has to close');
  },
  async trainSliceNeverRepeatsOrLeaksAChunk() {
    // QC 58: the first walk-forward cut weighted recency by DUPLICATING the
    // trailing 104 weeks of train chunks. The duplicates landed in the
    // members' last-25% validation slice, so lambda / boost rounds / tau
    // were tuned on rows the model had already memorized. The train slice
    // must be duplicate-free, and the three slices must never share a chunk.
    const chunks = [];
    for (let d = 0; d < 900; d++) chunks.push({ startTs: T0 + d * DAY });
    const reach = reachMs(GEOMETRIES['daily-3d'], [161]);
    const grid = foldGrid(T0, T0 + 899 * DAY);
    assert.ok(grid.length >= 3, 'need several folds for this to mean anything');
    for (const f of grid) {
      const { trainChunks, testChunks, holdChunks } = foldSlices(chunks, f, reach);
      const train = new Set(trainChunks.map((c) => c.startTs));
      assert.strictEqual(train.size, trainChunks.length, 'no chunk may appear twice in the train slice');
      for (const c of [...testChunks, ...holdChunks]) {
        assert.ok(!train.has(c.startTs), 'train must not share a chunk with test or hold');
      }
      for (const c of trainChunks) assert.ok(c.startTs + reach <= f.testStart, 'train purged by the full reach');
      for (const c of testChunks) assert.ok(c.startTs + reach <= f.holdStart, 'test trades must not touch hold candles');
    }
  },
  async theNullDealKeepsEachMembersMixButNoDateStructure() {
    // QC 66 (owner-redesigned): the null run DEALS each member's real vote
    // mix onto random days. What must hold: the mix is exactly preserved
    // (same count of ups/downs/stand-asides), the order genuinely moves,
    // reruns are byte-identical, and members shuffle INDEPENDENTLY — the
    // old common-rotation construction (which the owner caught leaking
    // market knowledge at small offsets) preserved date structure that
    // this construction must NOT preserve.
    const m1 = [1, 0, -1, 1, 1, 0, -1, 0, 1, -1, 0, 1];
    const m2 = [1, -1, -1, 0, 1, 1, -1, 0, 0, -1, 1, 1];
    const d1 = dealVotes(m1, nullRng(101, 'DOTUSDT|daily-3d|argmax', 4, 0, 'test'));
    const d1again = dealVotes(m1, nullRng(101, 'DOTUSDT|daily-3d|argmax', 4, 0, 'test'));
    const d2 = dealVotes(m2, nullRng(101, 'DOTUSDT|daily-3d|argmax', 4, 1, 'test'));
    assert.deepStrictEqual([...d1].sort(), [...m1].sort(), 'the multiset of votes is unchanged');
    assert.deepStrictEqual([...d2].sort(), [...m2].sort(), 'every member keeps its own mix');
    assert.deepStrictEqual(d1, d1again, 'same seed, same deal — byte-identical');
    assert.notDeepStrictEqual(d1, m1, 'the dates must actually move (verified non-identity for this case)');
    // members are dealt independently: dealing the SAME votes under member
    // index 0 vs 1 must give different arrangements of the same mix — a
    // shared transformation (the old rotation) would give the same one.
    assert.notDeepStrictEqual(
      dealVotes(m1, nullRng(101, 'k', 3, 0, 'test')),
      dealVotes(m1, nullRng(101, 'k', 3, 1, 'test')),
      'each member gets its own deal, not a shared one');
    // and the deal is distinct across seed, fold, and slice
    assert.notDeepStrictEqual(dealVotes(m1, nullRng(101, 'k', 3, 0, 'test')), dealVotes(m1, nullRng(102, 'k', 3, 0, 'test')), 'seed changes the deal');
    assert.notDeepStrictEqual(dealVotes(m1, nullRng(101, 'k', 3, 0, 'test')), dealVotes(m1, nullRng(101, 'k', 4, 0, 'test')), 'fold changes the deal');
    assert.notDeepStrictEqual(dealVotes(m1, nullRng(101, 'k', 3, 0, 'test')), dealVotes(m1, nullRng(101, 'k', 3, 0, 'hold')), 'slice changes the deal');
    // tiny slices come back as untouched copies, never crash
    assert.deepStrictEqual(dealVotes([1], nullRng(1, 'k', 0, 0, 'test')), [1]);
    assert.deepStrictEqual(dealVotes([], nullRng(1, 'k', 0, 0, 'test')), []);
    // and the task itself refuses an ambiguous arm — a present-but-broken
    // seed must never silently run the real arm under a null flag
    const { wfUnitTask } = require('../lib/walkforward');
    for (const bad of [0, NaN, 2.5, 'lucky']) {
      await assert.rejects(
        () => wfUnitTask({ combo: { trade: 'X', size: 1 }, branch: { geometry: 'daily-1d', decision: 'argmax', band: 'auto' }, params: { nullShiftSeed: bad } }),
        /nullShiftSeed/,
        `seed ${String(bad)} must be refused at the task level`,
      );
    }
  },
};
