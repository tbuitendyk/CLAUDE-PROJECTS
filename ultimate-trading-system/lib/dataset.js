const { HOUR_MS } = require('./binance');
const { compressedFeatures } = require('./features');

// Chunking + labeling, exactly as specified:
//
//   * A chunk is 8 FULL days of hourly candles: Monday 00:00 UTC through the
//     following Monday 23:00 UTC inclusive = 192 hours. Chunks advance one
//     calendar week, so consecutive chunks share one Monday of overlap.
//   * ALL 192 hours x 5 fields x 2 assets are model input features (plus the
//     shared hour timestamps for bookkeeping — time itself is not a feature).
//   * The score comes from AFTER the chunk ends, TRADE ASSET ONLY:
//       c1 = mean of the 24 o/h/l/c values in the Tuesday 00:00–05:59
//            immediately following the chunk's final Monday
//       c2 = mean of the 24 o/h/l/c values in that week's Thursday 12:00–17:59
//       score = 0 if |c2 - c1| / c1 < dormant band, else +1 if c1 < c2, else -1

const CHUNK_HOURS = 192; // Mon 00:00 -> next Mon 23:00 inclusive
const TUE_OFFSET_H = 192; // first hour after the chunk IS Tuesday 00:00
const THU_OFFSET_H = 252; // Tue 00:00 + 60h = Thursday 12:00 same week
const LABEL_HOURS = 6;
const FIELDS_PER_CANDLE = 5; // open, high, low, close, quote_volume
const FEATURES_PER_ASSET = CHUNK_HOURS * FIELDS_PER_CANDLE; // 960
const FEATURE_COUNT = FEATURES_PER_ASSET * 2; // 1920

// Chunk/label GEOMETRIES. The classic weekly shape scores on 6h window
// AVERAGES (Tue morning vs Thu afternoon); the daily shapes score on two
// single candle opens: enter at 01:00 the day after the sample ends (one
// clear hour after midnight), exit at 18:00 that same day (1d/2d, 17h hold)
// or the following day (3d/4d, 41h hold). Daily shapes step every day, so
// six years yields ~2,200 overlapping samples instead of ~310.
const GEOMETRIES = {
  'weekly-8d': { featureHours: 192, stepHours: 168, anchor: 'monday', labelMode: 'windows', entryOffsetH: TUE_OFFSET_H + 3, exitOffsetH: THU_OFFSET_H + 3 },
  'daily-1d': { featureHours: 24, stepHours: 24, anchor: 'daily', labelMode: 'points', entryOffsetH: 25, exitOffsetH: 42 },
  'daily-2d': { featureHours: 48, stepHours: 24, anchor: 'daily', labelMode: 'points', entryOffsetH: 49, exitOffsetH: 66 },
  'daily-3d': { featureHours: 72, stepHours: 24, anchor: 'daily', labelMode: 'points', entryOffsetH: 73, exitOffsetH: 114 },
  'daily-4d': { featureHours: 96, stepHours: 24, anchor: 'daily', labelMode: 'points', entryOffsetH: 97, exitOffsetH: 138 },
};

// 24/5 mode: keep only daily-geometry starts whose FEATURE window sits
// entirely on weekdays and whose entry candle lands on a weekday — crypto
// trades through weekends, but weekend microstructure (thin volume, gap-y
// moves) is exactly the noise the classic 8-day chunk averaged away, so the
// short shapes get the option to sidestep it. Allowed start weekdays (UTC,
// getUTCDay: Mon=1) follow from each shape:
//   1d: Mon-Thu starts -> features Mon-Thu, trade Tue-Fri        (4 per week)
//   2d: Mon-Wed starts -> features Mon-Thu, trade Wed-Fri        (3 per week)
//   3d: Mon only       -> features Mon-Wed, enter Thu, exit Fri  (1 per week)
//   4d: Mon only       -> features Mon-Thu, enter Fri 01:00 —
//       the exit lands Saturday 18:00, accepted by design        (1 per week)
// weekly-8d has no entry: 8 straight days always span a weekend.
// A SHAPE WITH NO ENTRY HERE HAS NO WEEKDAY VERSION: 24/5 changes nothing on it,
// and a setting is folded accordingly (3.52.0).
function weekdaysApply(geometry) { return !!WEEKDAY_STARTS[geometry]; }
const WEEKDAY_STARTS = {
  'daily-1d': [1, 2, 3, 4],
  'daily-2d': [1, 2, 3],
  'daily-3d': [1],
  'daily-4d': [1],
};

function toHourlyMap(rows) {
  const map = new Map();
  for (const r of rows) map.set(r.ts, r);
  return map;
}

// Forward-fill isolated gaps (Binance months occasionally miss an hour, e.g.
// exchange downtime) with a flat candle at the previous close, zero volume.
// Runs longer than maxGapHours stay missing, which later drops the chunks
// covering them — better a dropped week than an invented one.
function forwardFill(map, maxGapHours = 3) {
  if (map.size === 0) return { map, fills: 0 };
  const times = [...map.keys()].sort((a, b) => a - b);
  const out = new Map(map);
  let fills = 0;
  for (let i = 1; i < times.length; i++) {
    const gapHours = (times[i] - times[i - 1]) / HOUR_MS - 1;
    if (gapHours <= 0 || gapHours > maxGapHours) continue;
    const prev = out.get(times[i - 1]);
    for (let h = 1; h <= gapHours; h++) {
      const ts = times[i - 1] + h * HOUR_MS;
      out.set(ts, {
        ts,
        open: prev.close,
        high: prev.close,
        low: prev.close,
        close: prev.close,
        quoteVolume: 0,
        filled: true,
      });
      fills++;
    }
  }
  return { map: out, fills };
}

// Every Monday 00:00 UTC in [minTs, maxTs].
function mondayStarts(minTs, maxTs) {
  const out = [];
  const DAY_MS = 24 * HOUR_MS;
  let d = Math.floor(minTs / DAY_MS) * DAY_MS;
  while (new Date(d).getUTCDay() !== 1) d += DAY_MS;
  for (; d <= maxTs; d += 7 * DAY_MS) out.push(d);
  return out;
}

// Every day's 00:00 UTC in [minTs, maxTs].
function dailyStarts(minTs, maxTs) {
  const out = [];
  const DAY_MS = 24 * HOUR_MS;
  for (let d = Math.ceil(minTs / DAY_MS) * DAY_MS; d <= maxTs; d += DAY_MS) out.push(d);
  return out;
}

function candleRun(map, startTs, hours) {
  const out = [];
  for (let i = 0; i < hours; i++) {
    const c = map.get(startTs + i * HOUR_MS);
    if (!c) return null;
    out.push(c);
  }
  return out;
}

function meanOHLC(candles) {
  let sum = 0;
  for (const c of candles) sum += c.open + c.high + c.low + c.close;
  return sum / (candles.length * 4);
}

// Per-chunk, per-asset normalization so the model learns SHAPE, not price
// level: prices become fractional distance from the chunk's first open;
// quote volume becomes fractional distance from the chunk's mean volume
// (capped — a single 50x volume spike shouldn't own the feature scale).
function assetFeatures(candles) {
  const base = candles[0].open;
  let qvSum = 0;
  for (const c of candles) qvSum += c.quoteVolume;
  const qvBase = qvSum / candles.length || 1;
  const out = new Array(candles.length * FIELDS_PER_CANDLE);
  let k = 0;
  for (const c of candles) {
    out[k++] = c.open / base - 1;
    out[k++] = c.high / base - 1;
    out[k++] = c.low / base - 1;
    out[k++] = c.close / base - 1;
    out[k++] = Math.min(c.quoteVolume / qvBase - 1, 9);
  }
  return out;
}

function scoreDiff(diffFrac, dormantFrac) {
  if (Math.abs(diffFrac) < dormantFrac) return 0;
  return diffFrac > 0 ? 1 : -1;
}

// Adaptive band: the |move| percentile that makes ~1/3 of the given weeks
// dormant. Callers pass TRAINING diffs only, so the test window never
// influences its own labeling. Returned in percent, floored at 0.01.
function balancedBandPct(diffPcts) {
  const abs = diffPcts.map((d) => Math.abs(d)).sort((a, b) => a - b);
  if (abs.length === 0) return 0.01;
  return Math.max(abs[Math.floor(abs.length / 3)], 0.01);
}

// Build every labelable chunk from two forward-filled hourly maps.
// dormantPct: e.g. 2 for "+/-2%". featureSet: 'compressed' (v2 default,
// engineered numbers) or 'raw' (v1, all hourly values).
// geometry: a GEOMETRIES key — classic weekly window-average labels, or
// daily-stepped shapes labeled on two single candle opens.
// includeUnlabeled (live tracker): chunks whose features are complete but
// whose label data hasn't happened yet are emitted with label/c1/c2/diffPct
// null instead of being dropped.
function buildChunks(tradeMap, compareMap, dormantPct, featureSet = 'compressed', { includeUnlabeled = false, geometry = 'weekly-8d', weekdaysOnly = false } = {}) {
  const geo = GEOMETRIES[geometry];
  if (!geo) throw new Error(`unknown geometry "${geometry}"`);
  const dormantFrac = Math.abs(dormantPct) / 100;
  // Min/max via a loop, NOT Math.min(...keys): spreading a multi-year run's
  // ~150k timestamps as function arguments overflows the call stack.
  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const m of [tradeMap, compareMap]) {
    for (const ts of m.keys()) {
      if (ts < minTs) minTs = ts;
      if (ts > maxTs) maxTs = ts;
    }
  }
  if (minTs === Infinity) return { chunks: [], dropped: { gap: 0, noLabel: 0 }, considered: 0 };

  const chunks = [];
  // `invented` is counted apart from `noLabel` on purpose. "There was no price"
  // and "the price we have was made up to bridge a hole" are different facts,
  // and only one of them used to be visible.
  const dropped = { gap: 0, noLabel: 0, invented: 0 };
  let starts = geo.anchor === 'monday' ? mondayStarts(minTs, maxTs) : dailyStarts(minTs, maxTs);
  if (weekdaysOnly && WEEKDAY_STARTS[geometry]) {
    const allowed = new Set(WEEKDAY_STARTS[geometry]);
    starts = starts.filter((ts) => allowed.has(new Date(ts).getUTCDay()));
  }
  for (const start of starts) {
    const trade = candleRun(tradeMap, start, geo.featureHours);
    const compare = candleRun(compareMap, start, geo.featureHours);
    if (!trade || !compare) {
      if (start + (geo.featureHours - 1) * HOUR_MS <= maxTs) dropped.gap++;
      continue;
    }
    const x = featureSet === 'raw'
      ? [...assetFeatures(trade), ...assetFeatures(compare)]
      : compressedFeatures(trade, compare).x;

    let c1 = null;
    let c2 = null;
    if (geo.labelMode === 'windows') {
      const tue = candleRun(tradeMap, start + TUE_OFFSET_H * HOUR_MS, LABEL_HOURS);
      const thu = candleRun(tradeMap, start + THU_OFFSET_H * HOUR_MS, LABEL_HOURS);
      if (tue && thu) {
        c1 = meanOHLC(tue);
        c2 = meanOHLC(thu);
      }
    } else {
      const entryC = tradeMap.get(start + geo.entryOffsetH * HOUR_MS);
      const exitC = tradeMap.get(start + geo.exitOffsetH * HOUR_MS);
      // A CANDLE THAT WAS INVENTED CANNOT BE A PRICE A TRADE HAPPENS AT
      // (found 2026-08-21). forwardFill bridges a hole of up to three hours by
      // repeating the last close, which is defensible for working out features
      // — you need an unbroken series — and is not defensible here. There was
      // no price. A trade booked at one is fabricated money, and it looked
      // exactly like real money: a three-hour outage turned a 25-cent loss into
      // a $5.75 profit at a price that never traded, and both runs reported the
      // same chunk count with nothing missing.
      if ((entryC && entryC.filled) || (exitC && exitC.filled)) {
        dropped.invented++;
      } else if (entryC && exitC) {
        c1 = entryC.open;
        c2 = exitC.open;
      }
    }
    if (c1 === null || c2 === null) {
      dropped.noLabel++;
      if (includeUnlabeled) chunks.push({ startTs: start, label: null, c1: null, c2: null, diffPct: null, x });
      continue;
    }
    const diffFrac = (c2 - c1) / c1;
    chunks.push({
      startTs: start,
      label: scoreDiff(diffFrac, dormantFrac),
      c1,
      c2,
      diffPct: diffFrac * 100,
      x,
    });
  }
  chunks.sort((a, b) => a.startTs - b.startTs);
  return { chunks, dropped, considered: starts.length };
}

module.exports = {
  weekdaysApply, WEEKDAY_STARTS,
  toHourlyMap,
  forwardFill,
  mondayStarts,
  dailyStarts,
  buildChunks,
  meanOHLC,
  scoreDiff,
  balancedBandPct,
  GEOMETRIES,
  WEEKDAY_STARTS,
  assetFeatures,
  CHUNK_HOURS,
  TUE_OFFSET_H,
  THU_OFFSET_H,
  LABEL_HOURS,
  FEATURE_COUNT,
};
