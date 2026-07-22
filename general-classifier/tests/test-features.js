const { assert, makeRng } = require('./helpers');
const { compressedFeatures, FEATURE_NAMES, linSlope, pearson } = require('../lib/features');

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
  async helpersBehave() {
    assert.ok(Math.abs(linSlope([0, 1, 2, 3]) - 1) < 1e-12);
    assert.strictEqual(linSlope([5]), 0);
    assert.ok(Math.abs(pearson([1, 2, 3], [2, 4, 6]) - 1) < 1e-12);
    assert.ok(Math.abs(pearson([1, 2, 3], [3, 2, 1]) + 1) < 1e-12);
    assert.strictEqual(pearson([1, 1, 1], [1, 2, 3]), 0); // zero variance guard
  },
};
