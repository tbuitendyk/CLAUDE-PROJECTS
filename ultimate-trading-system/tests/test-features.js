const { assert, makeRng } = require('./helpers');
const { compressedFeatures, FEATURE_NAMES, featureNamesFor, viewIndices, linSlope, pearson } = require('../lib/features');

const HOURS = 192;

function candles(closeFn, qvFn = () => 1000) {
  const out = [];
  for (let i = 0; i < HOURS; i++) {
    const c = closeFn(i);
    out.push({ ts: i, open: i === 0 ? closeFn(0) : closeFn(i - 1), high: c * 1.001, low: c * 0.999, close: c, quoteVolume: qvFn(i) });
  }
  return out;
}

const get = (res, name) => {
  const idx = res.names.indexOf(name);
  if (idx < 0) throw new Error(`no feature ${name}`);
  return res.x[idx];
};

module.exports = {
  async shapeAndNames() {
    const res = compressedFeatures(candles(() => 100), candles(() => 50000));
    assert.strictEqual(res.x.length, 44);
    assert.deepStrictEqual(res.names, FEATURE_NAMES);
    assert.ok(res.x.every((v) => Number.isFinite(v)), 'all features finite');
  },
  async flatWeekIsAllZeros() {
    const res = compressedFeatures(candles(() => 100), candles(() => 50000));
    for (const name of ['trade_total_ret', 'trade_hourly_vol', 'trade_trend_slope', 'trade_max_drawdown', 'trade_ret_last24h', 'ret_correlation']) {
      assert.strictEqual(get(res, name), 0, `${name} should be 0 on a flat week`);
    }
    assert.strictEqual(get(res, 'trade_dayvol_cv'), 0); // constant volume
  },
  async risingTrendReadsPositive() {
    const rising = candles((i) => 100 * Math.pow(1.001, i));
    const res = compressedFeatures(rising, candles(() => 50000));
    assert.ok(get(res, 'trade_total_ret') > 0.15);
    assert.ok(get(res, 'trade_trend_slope') > 0);
    assert.ok(get(res, 'trade_max_runup') > 0.15);
    assert.ok(get(res, 'trade_max_drawdown') < 0.01);
    assert.ok(Math.abs(get(res, 'rel_total_ret') - get(res, 'trade_total_ret')) < 1e-9); // compare side is flat
  },
  async dailyReturnsLandOnTheRightDays() {
    // Price steps up 10% exactly at the start of day 4 (hour 72), flat otherwise.
    const stepped = candles((i) => (i >= 72 ? 110 : 100));
    const res = compressedFeatures(stepped, candles(() => 50000));
    for (let d = 1; d <= 8; d++) {
      const v = get(res, `trade_day${d}_ret`);
      if (d === 4) assert.ok(Math.abs(v - 0.1) < 1e-9, `day4 ${v}`);
      else assert.ok(Math.abs(v) < 1e-9, `day${d} ${v}`);
    }
  },
  async correlatedAssetsScoreHigh() {
    const rng = makeRng(31);
    const walk = [100];
    for (let i = 1; i < HOURS; i++) walk.push(walk[i - 1] * (1 + (rng() - 0.5) * 0.01));
    const trade = candles((i) => walk[i]);
    const comp = candles((i) => walk[i] * 400); // same shape, different scale
    const res = compressedFeatures(trade, comp);
    assert.ok(get(res, 'ret_correlation') > 0.99, `correlation ${get(res, 'ret_correlation')}`);
    assert.ok(Math.abs(get(res, 'rel_total_ret')) < 1e-9);
  },
  async volumeConcentration() {
    // All volume on the last day.
    const res = compressedFeatures(candles(() => 100, (i) => (i >= 168 ? 8000 : 0)), candles(() => 50000));
    assert.ok(Math.abs(get(res, 'trade_dayvol_last_ratio') - 8) < 1e-9); // 8x the daily mean
    assert.ok(get(res, 'trade_dayvol_cv') > 2);
  },
  async namesScaleWithChunkDays() {
    // (nDays+12) per asset + 4 cross: 44 for 8 days, 30 for 1, 34 for 3.
    assert.deepStrictEqual(featureNamesFor(8), FEATURE_NAMES);
    assert.strictEqual(FEATURE_NAMES.length, 44);
    assert.strictEqual(featureNamesFor(1).length, 30);
    assert.strictEqual(featureNamesFor(3).length, 34);
    assert.ok(featureNamesFor(1).includes('trade_day1_ret'));
    assert.ok(!featureNamesFor(1).includes('trade_day2_ret'));
  },
  async shortChunksProduceMatchingVectors() {
    const short = (n, price) => {
      const out = [];
      for (let i = 0; i < n * 24; i++) {
        const c = price * Math.pow(1.0005, i);
        out.push({ ts: i, open: i === 0 ? price : price * Math.pow(1.0005, i - 1), high: c * 1.001, low: c * 0.999, close: c, quoteVolume: 1000 });
      }
      return out;
    };
    for (const n of [1, 2, 3, 4]) {
      const res = compressedFeatures(short(n, 100), short(n, 50000));
      assert.strictEqual(res.x.length, featureNamesFor(n).length, `${n}-day length`);
      assert.deepStrictEqual(res.names, featureNamesFor(n), `${n}-day names`);
      assert.ok(res.x.every((v) => Number.isFinite(v)), `${n}-day all finite`);
    }
    // On a 1-day chunk "last 24h" IS the whole chunk — must equal total_ret.
    const one = compressedFeatures(short(1, 100), short(1, 50000));
    const g = (nm) => one.x[one.names.indexOf(nm)];
    assert.ok(Math.abs(g('trade_ret_last24h') - g('trade_total_ret')) < 1e-12);
  },
  async viewsSliceEveryGeometry() {
    for (const n of [1, 2, 3, 4, 8]) {
      const total = featureNamesFor(n).length;
      const prices = viewIndices('prices', n).length;
      const volume = viewIndices('volume', n).length;
      const cross = viewIndices('cross', n).length;
      assert.strictEqual(viewIndices('full', n).length, total);
      assert.strictEqual(volume, 5, `${n}-day volume view`); // 2×(dayvol_cv, dayvol_last_ratio) + rel_vol_log
      assert.strictEqual(cross, 4, `${n}-day cross view`);
      assert.strictEqual(prices + volume, total, `${n}-day prices/volume partition`);
    }
    // Carried here when the consensus screen's test file went with the screen
    // (THIS-RELEASE point 14). These two were the only assertions in it that
    // covered surviving code: every committee the sweep and History Tuning fit
    // slices its features through viewIndices, so an unknown view must refuse
    // rather than quietly return nothing, and the cross view must hold the
    // four relative measures by name and not merely by count.
    assert.throws(() => viewIndices('nope'), /unknown feature view/);
    assert.deepStrictEqual(
      viewIndices('cross').map((i) => FEATURE_NAMES[i]),
      ['rel_total_ret', 'rel_ret_last24h', 'rel_vol_log', 'ret_correlation'],
    );
  },
  async helpersBehave() {
    assert.ok(Math.abs(linSlope([0, 1, 2, 3]) - 1) < 1e-12);
    assert.strictEqual(linSlope([5]), 0);
    assert.ok(Math.abs(pearson([1, 2, 3], [2, 4, 6]) - 1) < 1e-12);
    assert.ok(Math.abs(pearson([1, 2, 3], [3, 2, 1]) + 1) < 1e-12);
    assert.strictEqual(pearson([1, 1, 1], [1, 2, 3]), 0); // zero variance guard
  },
};
