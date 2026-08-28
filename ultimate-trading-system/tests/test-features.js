const { assert, makeRng } = require('./helpers');
const feats = require('../lib/features');
const {
  compressedFeatures, FEATURE_NAMES, featureNamesFor, viewIndices, linSlope, pearson,
} = feats;

const HOURS = 192;

function candles(closeFn, qvFn = () => 1000, hours = HOURS) {
  const out = [];
  for (let i = 0; i < hours; i++) {
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

// A varied chunk of any length, from a seeded walk — used to prove that no
// measurement sits still or repeats another one.
function walkChunk(rng, hours, drift = 0) {
  const closes = [100];
  for (let i = 1; i < hours; i++) closes.push(closes[i - 1] * (1 + drift + (rng() - 0.5) * 0.02));
  const vols = [];
  for (let i = 0; i < hours; i++) vols.push(500 + rng() * 4000);
  return candles((i) => closes[i], (i) => vols[i], hours);
}

module.exports = {
  async shapeAndNames() {
    const res = compressedFeatures(candles(() => 100), candles(() => 50000));
    assert.strictEqual(res.x.length, 47, '21 per asset + 5 cross');
    assert.deepStrictEqual(res.names, FEATURE_NAMES);
    assert.ok(res.x.every((v) => Number.isFinite(v)), 'all features finite');
  },

  // THE WIDTH IS THE SAME AT EVERY CHUNK SHAPE (owner loop, 2026-08-28). The
  // old block grew with the days in the chunk, which is how numbers that only
  // made sense over several days ended up frozen at the shortest one.
  async everyChunkShapeIsTheSameWidth() {
    for (const n of [1, 2, 3, 4, 8]) {
      const c = candles((i) => 100 * (1.0005 ** i), () => 1000, n * 24);
      const res = compressedFeatures(c, c);
      assert.strictEqual(res.x.length, 47, `${n}-day width`);
      assert.deepStrictEqual(res.names, FEATURE_NAMES, `${n}-day names`);
      assert.ok(res.x.every((v) => Number.isFinite(v)), `${n}-day all finite`);
    }
    assert.strictEqual(featureNamesFor().length, 47);
  },

  // S1, THE RULE THIS BLOCK EXISTS TO KEEP: at every chunk shape, no
  // measurement is frozen across chunks and no measurement is an exact copy
  // of another. Both faults were real and measured on the owner's own coins
  // before this rewrite — two frozen and three duplicated at Daily 1-day.
  async noNumberIsFrozenOrRepeatsAnother() {
    for (const n of [1, 2, 3, 4, 8]) {
      const rng = makeRng(1000 + n);
      const rows = [];
      for (let k = 0; k < 60; k++) rows.push(compressedFeatures(walkChunk(rng, n * 24), walkChunk(rng, n * 24)).x);
      const M = rows[0].length;
      for (let j = 0; j < M; j++) {
        const col = rows.map((r) => r[j]);
        assert.ok(col.some((v) => v !== col[0]), `${n}-day: ${FEATURE_NAMES[j]} never changes — a frozen number is a member trained on nothing`);
      }
      for (let a = 0; a < M; a++) {
        for (let b = a + 1; b < M; b++) {
          const same = rows.every((r) => r[a] === r[b]);
          assert.ok(!same, `${n}-day: ${FEATURE_NAMES[a]} and ${FEATURE_NAMES[b]} are the same number written twice`);
        }
      }
    }
  },

  async flatWeekIsAllZeros() {
    const res = compressedFeatures(candles(() => 100), candles(() => 50000));
    for (const name of ['trade_total_ret', 'trade_hourly_vol', 'trade_trend_slope', 'trade_q1_ret', 'trade_q4_ret', 'ret_correlation']) {
      assert.strictEqual(get(res, name), 0, `${name} should be 0 on a flat week`);
    }
    assert.strictEqual(get(res, 'trade_qvol_cv'), 0, 'constant volume is not bursty');
    assert.strictEqual(get(res, 'trade_qvol_lastq'), 1, 'and its last quarter is exactly average');
    assert.ok(Math.abs(get(res, 'trade_close_in_range') - 0.5) < 1e-9, 'a flat close sits mid-range');
  },

  async risingTrendReadsPositive() {
    const rising = candles((i) => 100 * (1.001 ** i));
    const res = compressedFeatures(rising, candles(() => 50000));
    assert.ok(get(res, 'trade_total_ret') > 0.15);
    assert.ok(get(res, 'trade_trend_slope') > 0);
    assert.ok(get(res, 'trade_max_runup') > 0.15);
    assert.ok(get(res, 'trade_max_drawdown') < 0.01);
    assert.ok(get(res, 'trade_close_in_range') > 0.99, 'a straight climb closes at the top of its range');
    assert.ok(get(res, 'trade_path_efficiency') > 0.99, 'and travels in a line');
    assert.ok(Math.abs(get(res, 'rel_total_ret') - get(res, 'trade_total_ret')) < 1e-9);
  },

  // The quarters replace the day-by-day returns: four of them at every chunk
  // shape, none of them ever the whole chunk.
  async quarterReturnsLandOnTheRightQuarter() {
    const stepped = candles((i) => (i >= 96 ? 110 : 100));
    const res = compressedFeatures(stepped, candles(() => 50000));
    for (let q = 1; q <= 4; q++) {
      const v = get(res, `trade_q${q}_ret`);
      if (q === 3) assert.ok(Math.abs(v - 0.1) < 1e-9, `q3 ${v}`);
      else assert.ok(Math.abs(v) < 1e-9, `q${q} ${v}`);
    }
    // and the four still compound to the whole, exactly
    let p = 1;
    for (let q = 1; q <= 4; q++) p *= 1 + get(res, `trade_q${q}_ret`);
    assert.ok(Math.abs(p - 1 - get(res, 'trade_total_ret')) < 1e-12);
  },

  async correlatedAssetsScoreHigh() {
    const rng = makeRng(31);
    const walk = [100];
    for (let i = 1; i < HOURS; i++) walk.push(walk[i - 1] * (1 + (rng() - 0.5) * 0.01));
    const trade = candles((i) => walk[i]);
    const comp = candles((i) => walk[i] * 400);
    const res = compressedFeatures(trade, comp);
    assert.ok(get(res, 'ret_correlation') > 0.99, `correlation ${get(res, 'ret_correlation')}`);
    assert.ok(Math.abs(get(res, 'rel_total_ret')) < 1e-9);
  },

  async volumeConcentration() {
    // every bit of the volume in the last quarter
    const res = compressedFeatures(candles(() => 100, (i) => (i >= 144 ? 8000 : 0)), candles(() => 50000));
    assert.ok(Math.abs(get(res, 'trade_qvol_lastq') - 4) < 1e-9, 'four times the average hour');
    assert.ok(get(res, 'trade_qvol_cv') > 1.5, 'and plainly bursty');
    assert.ok(get(res, 'trade_qvol_shift') > 3, 'all of it in the second half');
  },

  // THE FOURTH READING IS REAL: change ONLY how much traded, leave every
  // price untouched, and the combined numbers must move while the price
  // numbers do not. Without this the new reading could be price numbers
  // wearing a different name.
  async theCombinedNumbersNeedBothPriceAndVolume() {
    const rng = makeRng(77);
    const closes = [100];
    for (let i = 1; i < HOURS; i++) closes.push(closes[i - 1] * (1 + (rng() - 0.5) * 0.02));
    const flatVol = compressedFeatures(candles((i) => closes[i], () => 1000), candles(() => 50000));
    const leanVol = compressedFeatures(candles((i) => closes[i], (i) => (closes[i] > closes[Math.max(0, i - 1)] ? 9000 : 200)), candles(() => 50000));
    const g = (r, n) => r.x[r.names.indexOf(n)];
    for (const n of FEATURE_NAMES.filter((x) => feats.FAMILY.get(x) === 'price' && x.startsWith('trade_'))) {
      assert.strictEqual(g(flatVol, n), g(leanVol, n), `${n} is a price number and must not notice a volume change`);
    }
    let moved = 0;
    for (const n of FEATURE_NAMES.filter((x) => feats.FAMILY.get(x) === 'pricevol' && x.startsWith('trade_'))) {
      if (g(flatVol, n) !== g(leanVol, n)) moved++;
    }
    assert.strictEqual(moved, 3, 'every combined number must react to volume');
    assert.ok(g(leanVol, 'trade_money_flow') > 0.9, 'volume all on the up hours is money flowing up');
  },

  // The four narrow readings PARTITION the block and 'full' is their union —
  // so a member on one narrow reading really is looking at different numbers
  // from a member on another.
  async theReadingsPartitionTheBlock() {
    const total = FEATURE_NAMES.length;
    const prices = viewIndices('prices').length;
    const volume = viewIndices('volume').length;
    const pricevol = viewIndices('pricevol').length;
    const cross = viewIndices('cross').length;
    assert.strictEqual(viewIndices('full').length, total);
    assert.strictEqual(prices + volume + pricevol + cross, total, 'the four narrow readings must partition the block');
    assert.strictEqual(volume, 6, 'three volume numbers per asset');
    assert.strictEqual(pricevol, 6, 'three combined numbers per asset');
    assert.strictEqual(cross, 5);
    const seen = new Set();
    for (const v of ['prices', 'volume', 'pricevol', 'cross']) {
      for (const i of viewIndices(v)) {
        assert.ok(!seen.has(i), `${FEATURE_NAMES[i]} is in two readings at once`);
        seen.add(i);
      }
    }
    assert.throws(() => viewIndices('nope'), /unknown feature view/);
    assert.deepStrictEqual(
      viewIndices('cross').map((i) => FEATURE_NAMES[i]),
      ['rel_total_ret', 'rel_q4_ret', 'rel_hvol_log', 'ret_correlation', 'rel_qvol_burst'],
    );
    // the comparison of the two coins' VOLATILITY is a price number, and the
    // one that compares how BUSY they are is the volume one — the old block
    // filed the volatility one under volume for years
    assert.strictEqual(feats.FAMILY.get('rel_hvol_log'), 'cross');
    assert.strictEqual(feats.FAMILY.get('trade_hourly_vol'), 'price');
    assert.strictEqual(feats.FAMILY.get('trade_qvol_cv'), 'volume');
  },

  async helpersBehave() {
    assert.ok(Math.abs(linSlope([0, 1, 2, 3]) - 1) < 1e-12);
    assert.strictEqual(linSlope([5]), 0);
    assert.ok(Math.abs(pearson([1, 2, 3], [2, 4, 6]) - 1) < 1e-12);
    assert.ok(Math.abs(pearson([1, 2, 3], [3, 2, 1]) + 1) < 1e-12);
    assert.strictEqual(pearson([1, 1, 1], [1, 2, 3]), 0);
  },
};
