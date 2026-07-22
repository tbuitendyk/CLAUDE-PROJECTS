const { assert } = require('./helpers');
const {
  toHourlyMap,
  forwardFill,
  mondayStarts,
  buildChunks,
  scoreDiff,
  assetFeatures,
  CHUNK_HOURS,
  TUE_OFFSET_H,
  THU_OFFSET_H,
  LABEL_HOURS,
  FEATURE_COUNT,
} = require('../lib/dataset');

const HOUR_MS = 3_600_000;
const MON_JAN5_2026 = Date.UTC(2026, 0, 5); // a Monday, 00:00 UTC

function flatCandles(fromTs, hours, price = 100) {
  const rows = [];
  for (let i = 0; i < hours; i++) {
    const ts = fromTs + i * HOUR_MS;
    rows.push({ ts, open: price, high: price, low: price, close: price, quoteVolume: 1000 });
  }
  return rows;
}

function setWindow(map, fromTs, hours, price) {
  for (let i = 0; i < hours; i++) {
    const ts = fromTs + i * HOUR_MS;
    map.set(ts, { ts, open: price, high: price, low: price, close: price, quoteVolume: 1000 });
  }
}

// ~29 days of hourly candles starting Mon Jan 5 2026: three labelable chunks.
function buildFixture() {
  const hours = 29 * 24;
  const trade = toHourlyMap(flatCandles(MON_JAN5_2026, hours));
  const compare = toHourlyMap(flatCandles(MON_JAN5_2026, hours, 50000));
  const starts = [0, 1, 2].map((k) => MON_JAN5_2026 + k * 7 * 24 * HOUR_MS);
  // chunk 0: Thu 5% above Tue -> +1 at a 2% band; chunk 1: 5% below -> -1;
  // chunk 2: 1% above -> inside the band -> 0.
  setWindow(trade, starts[0] + THU_OFFSET_H * HOUR_MS, LABEL_HOURS, 105);
  setWindow(trade, starts[1] + THU_OFFSET_H * HOUR_MS, LABEL_HOURS, 95);
  setWindow(trade, starts[2] + THU_OFFSET_H * HOUR_MS, LABEL_HOURS, 101);
  return { trade, compare, starts };
}

module.exports = {
  async mondayDetection() {
    const mons = mondayStarts(MON_JAN5_2026, MON_JAN5_2026 + 15 * 24 * HOUR_MS);
    assert.deepStrictEqual(mons, [MON_JAN5_2026, MON_JAN5_2026 + 7 * 24 * HOUR_MS, MON_JAN5_2026 + 14 * 24 * HOUR_MS]);
    assert.ok(mons.every((ts) => new Date(ts).getUTCDay() === 1 && new Date(ts).getUTCHours() === 0));
  },
  async chunkGeometry() {
    // Tue 00:00 is the first hour AFTER the 192h chunk; Thu 12:00 is 60h later.
    assert.strictEqual(CHUNK_HOURS, 192);
    assert.strictEqual(TUE_OFFSET_H, 192);
    assert.strictEqual(THU_OFFSET_H, 252);
    const tue = new Date(MON_JAN5_2026 + TUE_OFFSET_H * HOUR_MS);
    const thu = new Date(MON_JAN5_2026 + THU_OFFSET_H * HOUR_MS);
    assert.strictEqual(tue.getUTCDay(), 2); // Tuesday
    assert.strictEqual(tue.getUTCHours(), 0);
    assert.strictEqual(thu.getUTCDay(), 4); // Thursday
    assert.strictEqual(thu.getUTCHours(), 12);
  },
  async labelsFollowSpec() {
    const { trade, compare } = buildFixture();
    const { chunks, dropped } = buildChunks(trade, compare, 2);
    assert.strictEqual(chunks.length, 3);
    assert.deepStrictEqual(chunks.map((c) => c.label), [1, -1, 0]);
    assert.ok(Math.abs(chunks[0].diffPct - 5) < 1e-9);
    assert.ok(Math.abs(chunks[1].diffPct + 5) < 1e-9);
    assert.strictEqual(chunks[0].x.length, 44); // compressed is the default
    assert.ok(dropped.noLabel >= 1); // tail Mondays can't see their Thursday
  },
  async featureSetSelectsRepresentation() {
    const { trade, compare } = buildFixture();
    const compressed = buildChunks(trade, compare, 2, 'compressed');
    const raw = buildChunks(trade, compare, 2, 'raw');
    assert.strictEqual(compressed.chunks[0].x.length, 44);
    assert.strictEqual(raw.chunks[0].x.length, FEATURE_COUNT); // 1920
    // Same chunks, same labels — only the representation differs.
    assert.deepStrictEqual(compressed.chunks.map((c) => c.label), raw.chunks.map((c) => c.label));
  },
  async adaptiveBandBalancesClasses() {
    const { balancedBandPct } = require('../lib/dataset');
    // 90 diffs spread evenly from -4.5% to +4.5% (in steps of 0.1, no zero):
    // the 33rd-percentile |diff| should make roughly a third dormant.
    const diffs = [];
    for (let i = 1; i <= 45; i++) {
      diffs.push(i * 0.1);
      diffs.push(-i * 0.1);
    }
    const band = balancedBandPct(diffs);
    const labels = diffs.map((d) => scoreDiff(d / 100, band / 100));
    const zeros = labels.filter((l) => l === 0).length;
    assert.ok(Math.abs(zeros / diffs.length - 1 / 3) < 0.05, `dormant share ${zeros / diffs.length}`);
    const pos = labels.filter((l) => l === 1).length;
    const neg = labels.filter((l) => l === -1).length;
    assert.strictEqual(pos, neg); // symmetric fixture -> symmetric split
    assert.strictEqual(balancedBandPct([]), 0.01); // floor, never zero/NaN
  },
  async dormantBandIsRelative() {
    assert.strictEqual(scoreDiff(0.019, 0.02), 0);
    assert.strictEqual(scoreDiff(0.021, 0.02), 1);
    assert.strictEqual(scoreDiff(-0.021, 0.02), -1);
    assert.strictEqual(scoreDiff(0, 0.02), 0);
  },
  async forwardFillSmallGapsOnly() {
    const rows = flatCandles(MON_JAN5_2026, 48);
    const map = toHourlyMap(rows);
    map.delete(MON_JAN5_2026 + 10 * HOUR_MS); // 1h gap: fillable
    map.delete(MON_JAN5_2026 + 11 * HOUR_MS); // (2h total)
    for (let i = 20; i < 25; i++) map.delete(MON_JAN5_2026 + i * HOUR_MS); // 5h gap: too big
    const { map: filled, fills } = forwardFill(map, 3);
    assert.strictEqual(fills, 2);
    assert.ok(filled.get(MON_JAN5_2026 + 10 * HOUR_MS).filled);
    assert.strictEqual(filled.get(MON_JAN5_2026 + 10 * HOUR_MS).quoteVolume, 0);
    assert.strictEqual(filled.get(MON_JAN5_2026 + 22 * HOUR_MS), undefined);
  },
  async bigGapDropsChunk() {
    const { trade, compare } = buildFixture();
    for (let i = 30; i < 40; i++) trade.delete(MON_JAN5_2026 + i * HOUR_MS); // hole inside chunk 0 only
    const { chunks, dropped } = buildChunks(trade, compare, 2);
    assert.deepStrictEqual(chunks.map((c) => c.label), [-1, 0]);
    assert.strictEqual(dropped.gap, 1);
  },
  async survivesMultiYearKeyCounts() {
    // Regression: Math.min(...keys) blew the call stack at ~150k timestamps
    // (a 2018→2026 run). Sparse candles (every other hour) keep this test
    // light — zero complete chunks — while the min/max scan sees every key.
    const map = new Map();
    const hours = 9 * 365 * 24; // nine years
    for (let i = 0; i < hours; i += 2) {
      const ts = MON_JAN5_2026 - hours * HOUR_MS + i * HOUR_MS;
      map.set(ts, { ts, open: 1, high: 1, low: 1, close: 1, quoteVolume: 1 });
    }
    assert.ok(map.size > 39000, `fixture too small (${map.size})`);
    const { chunks } = buildChunks(map, map, 2); // must not throw
    assert.strictEqual(chunks.length, 0); // hourly gaps everywhere -> nothing labelable
  },
  async featuresAreShapeNotLevel() {
    const candles = flatCandles(MON_JAN5_2026, 4, 200);
    candles[3] = { ...candles[3], open: 220, high: 220, low: 220, close: 220 };
    const f = assetFeatures(candles);
    assert.strictEqual(f.length, 20);
    assert.strictEqual(f[0], 0); // first open is its own base
    assert.ok(Math.abs(f[15] - 0.1) < 1e-12); // 220/200 - 1
  },
};
