const { assert } = require('./helpers');
const { foldGrid, foldSlices, reachMs, foldNullOffset, rotateCalls, TEST_WEEKS, HOLD_WEEKS, STEP_WEEKS, WARMUP_WEEKS } = require('../lib/walkforward');
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
  async theNullRotationPreservesTheCommitteeButNotTheDates() {
    // The null arm's whole claim: rotating every member by the SAME offset
    // keeps the committee's internal agreement exactly (same votes, same
    // concurrences) while moving every vote off its date. A per-member
    // offset would fake a different committee, not a lucky one.
    const m1 = [1, 0, -1, 1, 1, 0, -1, 0, 1, -1, 0, 1];
    const m2 = [1, -1, -1, 0, 1, 1, -1, 0, 0, -1, 1, 1];
    const agree = (a, b) => a.reduce((s, v, i) => s + (v === b[i] ? 1 : 0), 0);
    const off = foldNullOffset(101, 'DOTUSDT|daily-3d|argmax', 4);
    const r1 = rotateCalls(m1, off);
    const r2 = rotateCalls(m2, off);
    assert.strictEqual(agree(r1, r2), agree(m1, m2), 'common rotation must preserve pairwise agreement');
    assert.deepStrictEqual([...r1].sort(), [...m1].sort(), 'the multiset of votes is unchanged');
    assert.notDeepStrictEqual(r1, m1, 'the dates must actually move');
    // never a zero shift: a null fold must not silently be the real fold
    for (let i = 0; i < 200; i++) {
      const o = foldNullOffset(7, 'X|g|d', i);
      assert.notDeepStrictEqual(rotateCalls(m1, o), m1, `offset at fold ${i} left the calls in place`);
    }
    // deterministic in (seed, unit, fold); different folds move differently
    assert.strictEqual(foldNullOffset(101, 'k', 3), foldNullOffset(101, 'k', 3));
    assert.notStrictEqual(foldNullOffset(101, 'k', 3), foldNullOffset(101, 'k', 4));
    assert.notStrictEqual(foldNullOffset(101, 'k', 3), foldNullOffset(102, 'k', 3));
    // tiny slices cannot rotate and must come back untouched copies
    assert.deepStrictEqual(rotateCalls([1], 5), [1]);
    assert.deepStrictEqual(rotateCalls([], 5), []);
  },
};
