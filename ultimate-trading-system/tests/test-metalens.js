const { assert } = require('./helpers');
const { metaCall, chooseFrac, committeeFor, splitHalves, buildSplit, interlacedSplit, purgeChunks, bestConstantOf, FRACTION_MENU, BLOCK_DAYS, SPECS } = require('../lib/metalens');
const { GEOMETRIES } = require('../lib/dataset');

const DAY_MS = 24 * 3_600_000;
const dailyChunks = (n, startTs = Date.UTC(2020, 0, 6)) =>
  Array.from({ length: n }, (_, i) => ({ startTs: startTs + i * DAY_MS, label: 0 }));

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
  async purgeWidthComesFromTheGeometry() {
    // a chunk reaches from its start to its exit candle; the purge must cover
    // that span in chunk-steps so neighbouring blocks share no candles
    assert.strictEqual(purgeChunks(GEOMETRIES['daily-3d']), 5); // 114h / 24h
    assert.strictEqual(purgeChunks(GEOMETRIES['daily-1d']), 2); // 42h / 24h
    assert.strictEqual(purgeChunks(GEOMETRIES['weekly-8d']), 2); // 255h / 168h
  },
  async interlacedBlocksSpanErasWithoutTouching() {
    const geo = GEOMETRIES['daily-3d'];
    const chunks = dailyChunks(49 * 8); // 8 full blocks
    const { fitA, scoreA, B, meta } = interlacedSplit(chunks, geo, BLOCK_DAYS);
    assert.strictEqual(BLOCK_DAYS, 49); // 7 weeks: whole weeks, odd multiple
    assert.strictEqual(meta.mode, 'interlaced');
    assert.strictEqual(meta.blocks, 8);
    assert.strictEqual(meta.purge, 5);
    assert.strictEqual(meta.purgedChunks, 8 * 5);
    // every group spans the whole history, which is the entire point
    const span = (g) => g[g.length - 1].startTs - g[0].startTs;
    const whole = span(chunks);
    for (const [name, g] of [['fitA', fitA], ['scoreA', scoreA], ['B', B]]) {
      assert.ok(g.length, `${name} non-empty`);
      assert.ok(span(g) > whole * 0.6, `${name} spans the history (got ${span(g) / whole})`);
    }
    // groups are disjoint, and no two chunks from different groups are close
    // enough to share candles — the leak the purge exists to prevent
    const tag = new Map();
    for (const c of fitA) tag.set(c.startTs, 'fitA');
    for (const c of scoreA) tag.set(c.startTs, 'scoreA');
    for (const c of B) tag.set(c.startTs, 'B');
    assert.strictEqual(tag.size, fitA.length + scoreA.length + B.length, 'no chunk in two groups');
    const all = [...tag.entries()].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < all.length; i++) {
      if (all[i][1] === all[i - 1][1]) continue;
      const gapDays = (all[i][0] - all[i - 1][0]) / DAY_MS;
      assert.ok(gapDays > geo.exitOffsetH / 24, `cross-group gap ${gapDays}d must exceed the ${geo.exitOffsetH / 24}d reach`);
    }
  },
  async buildSplitHonoursTheModes() {
    const geo = GEOMETRIES['daily-3d'];
    const chunks = dailyChunks(400);
    const chrono = buildSplit(chunks, geo, 'chronological');
    assert.strictEqual(chrono.meta.mode, 'chronological');
    assert.strictEqual(chrono.meta.purgedChunks, 0);
    // chronological: fit+score is the early half, B the late half
    assert.ok(chrono.fitA[0].startTs < chrono.B[0].startTs);
    assert.strictEqual(chrono.fitA.length + chrono.scoreA.length + chrono.B.length, 400);
    const inter = buildSplit(chunks, geo, 'interlaced');
    assert.strictEqual(inter.meta.mode, 'interlaced');
    assert.ok(inter.meta.purgedChunks > 0);
  },
  async noProfitableRungMeansStandAside() {
    // the pre-registered rule that ends least-bad threshold selection: both
    // DOT and DOGE chose 'unanimity' only because every option lost money
    assert.deepStrictEqual(chooseFrac([]), { frac: null, standAside: true });
    assert.deepStrictEqual(
      chooseFrac([{ frac: 0.5, pnl: -481 }, { frac: 0.75, pnl: -300 }, { frac: 1, pnl: -144 }]),
      { frac: null, standAside: true }
    );
    assert.deepStrictEqual(
      chooseFrac([{ frac: 0.5, pnl: -10 }, { frac: 0.75, pnl: 22 }, { frac: 1, pnl: 22 }]),
      { frac: 1, standAside: false } // profitable rungs exist; ties go stricter
    );
    assert.deepStrictEqual(chooseFrac([{ frac: 0.5, pnl: 0 }]), { frac: null, standAside: true }); // zero is not profit
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
