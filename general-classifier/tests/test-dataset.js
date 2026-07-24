const { assert } = require('./helpers');
const {
  toHourlyMap,
  forwardFill,
  mondayStarts,
  dailyStarts,
  buildChunks,
  scoreDiff,
  assetFeatures,
  GEOMETRIES,
  WEEKDAY_STARTS,
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
  async geometryTableIsAsRegistered() {
    // The pre-registered daily shapes: enter 01:00 the day after the chunk
    // ends, exit 18:00 (1-2d, 17h hold) or 18:00 the following day (3-4d, 41h).
    assert.deepStrictEqual(Object.keys(GEOMETRIES), ['weekly-8d', 'daily-1d', 'daily-2d', 'daily-3d', 'daily-4d']);
    const expect = {
      'daily-1d': [24, 25, 42],
      'daily-2d': [48, 49, 66],
      'daily-3d': [72, 73, 114],
      'daily-4d': [96, 97, 138],
    };
    for (const [key, [feat, entry, exit]] of Object.entries(expect)) {
      const g = GEOMETRIES[key];
      assert.strictEqual(g.featureHours, feat, `${key} featureHours`);
      assert.strictEqual(g.stepHours, 24, `${key} steps daily`);
      assert.strictEqual(g.entryOffsetH, entry, `${key} entry`);
      assert.strictEqual(g.exitOffsetH, exit, `${key} exit`);
      assert.strictEqual(g.entryOffsetH % 24, 1, `${key} enters at 01:00`);
      assert.strictEqual(g.exitOffsetH % 24, 18, `${key} exits at 18:00`);
      assert.strictEqual(g.entryOffsetH, g.featureHours + 1, `${key} enters 1h after the chunk`);
      assert.strictEqual(g.exitOffsetH - g.entryOffsetH, key < 'daily-3' ? 17 : 41, `${key} hold`);
      assert.strictEqual(g.labelMode, 'points');
    }
    const w = GEOMETRIES['weekly-8d'];
    assert.strictEqual(w.featureHours, CHUNK_HOURS);
    assert.strictEqual(w.stepHours, 168);
    assert.strictEqual(w.labelMode, 'windows');
    assert.strictEqual(w.entryOffsetH, 195); // Tue 03:00, tracker economics
    assert.strictEqual(w.exitOffsetH, 255); // Thu 15:00
  },
  async dailyStartsEveryMidnight() {
    const days = dailyStarts(MON_JAN5_2026, MON_JAN5_2026 + 3 * 24 * HOUR_MS);
    assert.deepStrictEqual(days, [0, 1, 2, 3].map((k) => MON_JAN5_2026 + k * 24 * HOUR_MS));
    assert.ok(days.every((ts) => new Date(ts).getUTCHours() === 0));
    // starting mid-day rounds UP to the next midnight
    const later = dailyStarts(MON_JAN5_2026 + 5 * HOUR_MS, MON_JAN5_2026 + 2 * 24 * HOUR_MS);
    assert.strictEqual(later[0], MON_JAN5_2026 + 24 * HOUR_MS);
  },
  async dailyGeometryPointLabels() {
    // 6 flat days; the candle at +42h (day 2, 18:00) opens at 105 — the
    // daily-1d chunk starting Jan 5 must label +1 from single candle OPENS.
    const trade = toHourlyMap(flatCandles(MON_JAN5_2026, 6 * 24));
    const compare = toHourlyMap(flatCandles(MON_JAN5_2026, 6 * 24, 50000));
    setWindow(trade, MON_JAN5_2026 + 42 * HOUR_MS, 1, 105);
    const { chunks, considered } = buildChunks(trade, compare, 2, 'compressed', { geometry: 'daily-1d' });
    assert.strictEqual(considered, 6); // one start per midnight in range
    assert.strictEqual(chunks.length, 5); // last start can't see its exit candle
    for (let i = 1; i < chunks.length; i++) {
      assert.strictEqual(chunks[i].startTs - chunks[i - 1].startTs, 24 * HOUR_MS); // daily stepping
    }
    assert.strictEqual(chunks[0].c1, 100); // entry: +25h open
    assert.strictEqual(chunks[0].c2, 105); // exit: +42h open
    assert.ok(Math.abs(chunks[0].diffPct - 5) < 1e-9);
    assert.deepStrictEqual(chunks.map((c) => c.label), [1, 0, 0, 0, 0]);
    assert.strictEqual(chunks[0].x.length, 30); // (1+12)×2 + 4 cross
  },
  async multiDayGeometriesUseTheirOwnOffsets() {
    // daily-3d: entry +73h, exit +114h. Set exit open to 90 -> label -1.
    const trade = toHourlyMap(flatCandles(MON_JAN5_2026, 8 * 24));
    const compare = toHourlyMap(flatCandles(MON_JAN5_2026, 8 * 24, 50000));
    setWindow(trade, MON_JAN5_2026 + 114 * HOUR_MS, 1, 90);
    const { chunks } = buildChunks(trade, compare, 2, 'compressed', { geometry: 'daily-3d' });
    const first = chunks.find((c) => c.startTs === MON_JAN5_2026);
    assert.ok(first, 'chunk at the fixture start exists');
    assert.strictEqual(first.label, -1);
    assert.strictEqual(first.c2, 90);
    assert.strictEqual(first.x.length, 34); // (3+12)×2 + 4 cross
  },
  async weekdayModeKeepsTheRegisteredStarts() {
    // The 24/5 table exactly as specified by the owner: 4 runs/week for 1d,
    // 3 for 2d, 1 each for 3d/4d (the 4d trade exits Saturday by design).
    assert.deepStrictEqual(WEEKDAY_STARTS, {
      'daily-1d': [1, 2, 3, 4],
      'daily-2d': [1, 2, 3],
      'daily-3d': [1],
      'daily-4d': [1],
    });
    // Derivation holds: every allowed start puts all feature days AND the
    // entry day on weekdays (Mon=1..Fri=5).
    for (const [key, days] of Object.entries(WEEKDAY_STARTS)) {
      const geo = GEOMETRIES[key];
      const featureDays = geo.featureHours / 24;
      for (const d of days) {
        for (let k = 0; k < featureDays; k++) assert.ok(d + k >= 1 && d + k <= 5, `${key} start ${d} feature day`);
        const entryDay = d + Math.floor(geo.entryOffsetH / 24);
        assert.ok(entryDay >= 1 && entryDay <= 5, `${key} start ${d} entry day`);
      }
    }
  },
  async weekdayModeFiltersDailyChunks() {
    // Three flat weeks: 1d keeps exactly Mon-Thu starts, 4d keeps Mondays,
    // and the classic weekly shape ignores the flag entirely.
    const trade = toHourlyMap(flatCandles(MON_JAN5_2026, 21 * 24));
    const compare = toHourlyMap(flatCandles(MON_JAN5_2026, 21 * 24, 50000));
    const oneDay = buildChunks(trade, compare, 2, 'compressed', { geometry: 'daily-1d', weekdaysOnly: true });
    assert.ok(oneDay.chunks.length >= 10, `got ${oneDay.chunks.length}`);
    for (const c of oneDay.chunks) {
      const dow = new Date(c.startTs).getUTCDay();
      assert.ok(dow >= 1 && dow <= 4, `1d start dow ${dow}`);
    }
    const all = buildChunks(trade, compare, 2, 'compressed', { geometry: 'daily-1d' });
    assert.ok(all.chunks.length > oneDay.chunks.length); // 24/5 costs samples
    const fourDay = buildChunks(trade, compare, 2, 'compressed', { geometry: 'daily-4d', weekdaysOnly: true });
    assert.ok(fourDay.chunks.length >= 1);
    for (const c of fourDay.chunks) assert.strictEqual(new Date(c.startTs).getUTCDay(), 1);
    const { trade: wTrade, compare: wCompare } = buildFixture();
    const weeklyOn = buildChunks(wTrade, wCompare, 2, 'compressed', { weekdaysOnly: true });
    const weeklyOff = buildChunks(wTrade, wCompare, 2, 'compressed', {});
    assert.strictEqual(weeklyOn.chunks.length, weeklyOff.chunks.length);
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
