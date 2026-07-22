const { HOUR_MS } = require('./binance');

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

// Build every labelable chunk from two forward-filled hourly maps.
// dormantPct: e.g. 2 for "+/-2%".
function buildChunks(tradeMap, compareMap, dormantPct) {
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
  const dropped = { gap: 0, noLabel: 0 };
  const mondays = mondayStarts(minTs, maxTs);
  for (const start of mondays) {
    if (start + (THU_OFFSET_H + LABEL_HOURS - 1) * HOUR_MS > maxTs) {
      // Label windows extend past loaded data; not an anomaly, just the tail.
      dropped.noLabel++;
      continue;
    }
    const trade = candleRun(tradeMap, start, CHUNK_HOURS);
    const compare = candleRun(compareMap, start, CHUNK_HOURS);
    if (!trade || !compare) {
      dropped.gap++;
      continue;
    }
    const tue = candleRun(tradeMap, start + TUE_OFFSET_H * HOUR_MS, LABEL_HOURS);
    const thu = candleRun(tradeMap, start + THU_OFFSET_H * HOUR_MS, LABEL_HOURS);
    if (!tue || !thu) {
      dropped.noLabel++;
      continue;
    }
    const c1 = meanOHLC(tue);
    const c2 = meanOHLC(thu);
    const diffFrac = (c2 - c1) / c1;
    chunks.push({
      startTs: start,
      label: scoreDiff(diffFrac, dormantFrac),
      c1,
      c2,
      diffPct: diffFrac * 100,
      x: [...assetFeatures(trade), ...assetFeatures(compare)],
    });
  }
  chunks.sort((a, b) => a.startTs - b.startTs);
  return { chunks, dropped, considered: mondays.length };
}

module.exports = {
  toHourlyMap,
  forwardFill,
  mondayStarts,
  buildChunks,
  meanOHLC,
  scoreDiff,
  assetFeatures,
  CHUNK_HOURS,
  TUE_OFFSET_H,
  THU_OFFSET_H,
  LABEL_HOURS,
  FEATURE_COUNT,
};
