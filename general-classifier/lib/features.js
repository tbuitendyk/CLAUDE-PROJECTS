// v2 "compressed" feature set: distill each 8-day chunk (192 hourly candles
// per asset) into a few dozen engineered numbers instead of 1,920 raw ones.
// Rationale: at ~1,900 features vs ~300 training weeks a linear model can
// memorize ANY labeling (train accuracy 100% regardless of signal); at ~40
// features it cannot, so whatever it learns has to generalize. Pure
// deterministic arithmetic, zero imports, same as lib/logreg.js.

const HOURS = 192;
const DAY = 24;
const DAYS = 8;

function mean(a) {
  let s = 0;
  for (const v of a) s += v;
  return a.length ? s / a.length : 0;
}

function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) * (v - m);
  return Math.sqrt(s / a.length);
}

function hourlyLogReturns(candles, from, to) {
  const out = [];
  for (let i = from + 1; i < to; i++) out.push(Math.log(candles[i].close / candles[i - 1].close));
  return out;
}

// Least-squares slope of ys against 0..n-1 (per-index units).
function linSlope(ys) {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - mx) * (ys[i] - my);
    sxx += (i - mx) * (i - mx);
  }
  return sxx > 0 ? sxy / sxx : 0;
}

function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) * (a[i] - ma);
    sbb += (b[i] - mb) * (b[i] - mb);
  }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

// 20 features for one asset's 192 candles. Everything is scale-free
// (returns, ratios) so weeks at $20 and weeks at $700 describe the same
// shapes with the same numbers.
function assetCompressed(candles, prefix, names, out) {
  const push = (name, value) => {
    names.push(`${prefix}_${name}`);
    out.push(Number.isFinite(value) ? value : 0);
  };

  // Daily returns, Monday(1)..Monday(8), each day's close vs the previous close.
  for (let d = 0; d < DAYS; d++) {
    const dayClose = candles[d * DAY + DAY - 1].close;
    const base = d === 0 ? candles[0].open : candles[d * DAY - 1].close;
    push(`day${d + 1}_ret`, dayClose / base - 1);
  }

  const first = candles[0].open;
  const last = candles[HOURS - 1].close;
  push('total_ret', last / first - 1);

  const rets = hourlyLogReturns(candles, 0, HOURS);
  const vol = std(rets);
  push('hourly_vol', vol);
  const volFirst = std(hourlyLogReturns(candles, 0, HOURS / 2));
  const volSecond = std(hourlyLogReturns(candles, HOURS / 2 - 1, HOURS));
  push('vol_shift', Math.log((volSecond + 1e-9) / (volFirst + 1e-9)));

  const logCloses = candles.map((c) => Math.log(c.close));
  const slope = linSlope(logCloses) * DAY; // per-day log-trend
  push('trend_slope', slope);
  const slopeFirst = linSlope(logCloses.slice(0, HOURS / 2)) * DAY;
  const slopeSecond = linSlope(logCloses.slice(HOURS / 2)) * DAY;
  push('trend_accel', slopeSecond - slopeFirst);

  let peak = -Infinity;
  let trough = Infinity;
  let maxDrawdown = 0;
  let maxRunup = 0;
  for (const c of candles) {
    peak = Math.max(peak, c.close);
    trough = Math.min(trough, c.close);
    maxDrawdown = Math.max(maxDrawdown, (peak - c.close) / peak);
    maxRunup = Math.max(maxRunup, (c.close - trough) / trough);
  }
  push('max_drawdown', maxDrawdown);
  push('max_runup', maxRunup);

  let hi = -Infinity;
  let lo = Infinity;
  let closeSum = 0;
  for (const c of candles) {
    hi = Math.max(hi, c.high);
    lo = Math.min(lo, c.low);
    closeSum += c.close;
  }
  push('range', (hi - lo) / (closeSum / HOURS));

  push('ret_last24h', last / candles[HOURS - DAY - 1].close - 1);
  push('ret_last6h', last / candles[HOURS - 6 - 1].close - 1);

  const dayVols = [];
  for (let d = 0; d < DAYS; d++) {
    let s = 0;
    for (let h = 0; h < DAY; h++) s += candles[d * DAY + h].quoteVolume;
    dayVols.push(s);
  }
  const dvMean = mean(dayVols);
  push('dayvol_cv', dvMean > 0 ? std(dayVols) / dvMean : 0);
  push('dayvol_last_ratio', dvMean > 0 ? dayVols[DAYS - 1] / dvMean : 0);

  return rets; // hourly log returns, reused for the cross features
}

// Full compressed vector for one chunk: 20 trade + 20 compare + 4 cross = 44.
function compressedFeatures(tradeCandles, compareCandles) {
  const names = [];
  const out = [];
  const tradeRets = assetCompressed(tradeCandles, 'trade', names, out);
  const compRets = assetCompressed(compareCandles, 'comp', names, out);

  const tTotal = out[names.indexOf('trade_total_ret')];
  const cTotal = out[names.indexOf('comp_total_ret')];
  const tLast24 = out[names.indexOf('trade_ret_last24h')];
  const cLast24 = out[names.indexOf('comp_ret_last24h')];
  const tVol = out[names.indexOf('trade_hourly_vol')];
  const cVol = out[names.indexOf('comp_hourly_vol')];

  names.push('rel_total_ret');
  out.push(tTotal - cTotal);
  names.push('rel_ret_last24h');
  out.push(tLast24 - cLast24);
  names.push('rel_vol_log');
  out.push(Math.log((tVol + 1e-9) / (cVol + 1e-9)));
  names.push('ret_correlation');
  out.push(pearson(tradeRets, compRets));

  return { x: out, names };
}

// Stable name list (for reports) without needing candles.
const FEATURE_NAMES = (() => {
  const one = (p) => [
    ...Array.from({ length: DAYS }, (_, d) => `${p}_day${d + 1}_ret`),
    `${p}_total_ret`, `${p}_hourly_vol`, `${p}_vol_shift`, `${p}_trend_slope`, `${p}_trend_accel`,
    `${p}_max_drawdown`, `${p}_max_runup`, `${p}_range`, `${p}_ret_last24h`, `${p}_ret_last6h`,
    `${p}_dayvol_cv`, `${p}_dayvol_last_ratio`,
  ];
  return [...one('trade'), ...one('comp'), 'rel_total_ret', 'rel_ret_last24h', 'rel_vol_log', 'ret_correlation'];
})();

// Feature VIEWS for the consensus screen: methodologically distinct slices
// of the 44. A pair that shows edge across views can't be riding a single
// family's artifact. 'full' = everything; 'prices' = no volume features;
// 'volume' = only volume features; 'cross' = only the cross-asset features.
const isVolume = (n) => n.includes('dayvol') || n === 'rel_vol_log';
const isCross = (n) => n.startsWith('rel_') || n === 'ret_correlation';
const FEATURE_VIEWS = {
  full: () => true,
  prices: (n) => !isVolume(n),
  volume: (n) => isVolume(n),
  cross: (n) => isCross(n),
};

// Indices of FEATURE_NAMES selected by a view (throws on unknown views).
function viewIndices(view) {
  const pred = FEATURE_VIEWS[view];
  if (!pred) throw new Error(`unknown feature view "${view}"`);
  return FEATURE_NAMES.map((n, i) => (pred(n) ? i : -1)).filter((i) => i >= 0);
}

module.exports = { compressedFeatures, FEATURE_NAMES, FEATURE_VIEWS, viewIndices, mean, std, linSlope, pearson };
