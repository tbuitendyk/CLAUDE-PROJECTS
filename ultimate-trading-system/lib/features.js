// The measurements each chunk is boiled down to.
//
// v3 (owner loop, 2026-08-28). The old block was distilled per DAY, which
// made its width depend on the chunk shape and made several numbers
// meaningless at the shortest one. Measured on real coins before this
// rewrite: at Daily 1-day a coin on its own had 13 numbers of which 2 were
// frozen forever (0 and 1, every chunk) and 3 were the same number written
// three times. That is why six members voted as three voices there.
//
// THE RULES THIS BLOCK NOW KEEPS, at every chunk shape (24, 48, 72, 96 and
// 192 hours) without a single special case:
//
//   1. Count in HOURS, never in days. The smallest chunk still has 24.
//   2. Every window is strictly smaller than the chunk — a quarter of it, or
//      a half. A window that can equal the chunk is a frozen number at the
//      shortest shape, which is exactly how the old block broke.
//   3. Ratios and logs only, never levels. A coin trading $10m an hour and
//      one trading $10k an hour must describe the same shape with the same
//      number.
//   4. A few zero-volume hours are legal (gap filling writes flat candles
//      with no volume), so ratios of SUMS are safe and nothing may divide by
//      one hour's volume.
//   5. One formula everywhere. Anything needing a special case at 24 hours
//      is the wrong formula.
//
// The width is now the SAME at every chunk shape: 21 per asset, 5 more for
// each context asset compared against the traded one.
//
// Pure deterministic arithmetic, no imports at all.

const DAY = 24;

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

const EPS = 1e-9;

// ---- THE FOUR FAMILIES ----------------------------------------------------
//
// Every number belongs to exactly ONE family, named here by hand. Nothing is
// guessed from the spelling: the old block decided what was a volume number
// by looking for "vol" in its name, and that filed a VOLATILITY comparison
// as volume for years.
//
//   price     — what the price did, on its own
//   volume    — how much traded, on its own
//   pricevol  — price and volume TOGETHER; neither family can express these
//               and a straight-line model can never build one for itself
//   cross     — the traded coin measured against a context coin
//
// The families PARTITION the block. "Everything" is their union and is
// therefore NOT an independent line of evidence — it is offered as a member
// because a model with all the numbers usually predicts best, but the
// independent-voices measurement is what says whether it added anything.
const PER_ASSET_SPEC = [
  ['q1_ret', 'price'], ['q2_ret', 'price'], ['q3_ret', 'price'], ['q4_ret', 'price'],
  ['total_ret', 'price'],
  ['hourly_vol', 'price'],
  ['vol_shift', 'price'],
  ['trend_slope', 'price'],
  ['trend_accel', 'price'],
  ['max_drawdown', 'price'],
  ['max_runup', 'price'],
  ['range', 'price'],
  ['close_in_range', 'price'],
  ['path_efficiency', 'price'],
  ['acf1', 'price'],
  ['qvol_cv', 'volume'],
  ['qvol_shift', 'volume'],
  ['qvol_lastq', 'volume'],
  ['money_flow', 'pricevol'],
  ['qvol_move_corr', 'pricevol'],
  ['vol_weighted_edge', 'pricevol'],
];
const CROSS_SPEC = [
  ['rel_total_ret', 'cross'],
  ['rel_q4_ret', 'cross'],
  ['rel_hvol_log', 'cross'],
  ['ret_correlation', 'cross'],
  ['rel_qvol_burst', 'cross'],
];
// THE MEASUREMENT BLOCK'S OWN VERSION. Everything trained on one version is
// meaningless under another: the numbers are in different places and mean
// different things. It is stamped on every record set, and a set stamped
// with an older one is REFUSED as a parent by name (owner loop, 2026-08-28
// — the owner accepted that old sets become obsolete; they are refused, not
// deleted, and the delete control on the screen is theirs to use).
const MEASUREMENTS_VERSION = 3;
const PER_ASSET = PER_ASSET_SPEC.length;   // 21, at every chunk shape
const CROSS = CROSS_SPEC.length;           // 5

// nDays+12 features for one asset's chunk (any whole number of days, 24
// candles each). Everything is scale-free (returns, ratios) so chunks at
// $20 and chunks at $700 describe the same shapes with the same numbers.
function assetCompressed(candles, prefix, names, out) {
  const HOURS = candles.length;
  const Q = Math.floor(HOURS / 4);
  const push = (name, value) => {
    names.push(`${prefix}_${name}`);
    out.push(Number.isFinite(value) ? value : 0);
  };

  // QUARTER RETURNS, four of them at every chunk shape. These replace the
  // day-by-day returns, whose count changed with the shape and whose single
  // entry at Daily 1-day WAS the whole chunk — the same number as the total
  // and as the last-24-hours number, three columns holding one fact.
  const first = candles[0].open;
  const last = candles[HOURS - 1].close;
  for (let k = 0; k < 4; k++) {
    const end = candles[(k + 1) * Q - 1].close;
    const base = k === 0 ? first : candles[k * Q - 1].close;
    push(`q${k + 1}_ret`, end / base - 1);
  }
  push('total_ret', last / first - 1);

  const rets = hourlyLogReturns(candles, 0, HOURS);
  push('hourly_vol', std(rets));
  // The two halves are compared over the SAME number of hours. The old one
  // started the second half a candle early, so it weighed 12 hours against
  // 11 at the shortest shape.
  const half = HOURS / 2;
  const volFirst = std(hourlyLogReturns(candles, 0, half + 1));
  const volSecond = std(hourlyLogReturns(candles, half - 1, HOURS));
  push('vol_shift', Math.log((volSecond + EPS) / (volFirst + EPS)));

  const logCloses = candles.map((c) => Math.log(c.close));
  push('trend_slope', linSlope(logCloses) * DAY);
  const slopeFirst = linSlope(logCloses.slice(0, half)) * DAY;
  const slopeSecond = linSlope(logCloses.slice(half)) * DAY;
  push('trend_accel', slopeSecond - slopeFirst);

  // Biggest fall and biggest rise, read from the HIGHS and LOWS the hours
  // actually reached. The old pair read closes only and understated both,
  // while the range number beside them was already using high and low.
  let peak = -Infinity;
  let trough = Infinity;
  let maxDrawdown = 0;
  let maxRunup = 0;
  for (const c of candles) {
    peak = Math.max(peak, c.high);
    trough = Math.min(trough, c.low);
    maxDrawdown = Math.max(maxDrawdown, (peak - c.low) / peak);
    maxRunup = Math.max(maxRunup, (c.high - trough) / trough);
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
  // Where the chunk finished inside its own range: 1 at the very top, 0 at
  // the very bottom. Uses the highs and lows, which nothing else did.
  push('close_in_range', hi > lo ? (last - lo) / (hi - lo) : 0.5);

  // Net move against distance travelled: 1 is a straight line, near 0 is
  // thrash. Measured as the most independent price number of the candidates.
  const travel = rets.reduce((a, b) => a + Math.abs(b), 0);
  push('path_efficiency', travel > 0 ? Math.abs(Math.log(last / first)) / travel : 0);
  // Hour-to-hour follow-through: does an up hour tend to be followed by one.
  push('acf1', rets.length > 2 ? pearson(rets.slice(0, -1), rets.slice(1)) : 0);

  // ---- how much traded, measured over HOURS ------------------------------
  const v = candles.map((c) => c.quoteVolume);
  const sumV = v.reduce((a, b) => a + b, 0);
  const mv = mean(v);
  push('qvol_cv', mv > 0 ? std(v) / mv : 0);
  const vSecond = v.slice(half).reduce((a, b) => a + b, 0);
  const vFirst = v.slice(0, half).reduce((a, b) => a + b, 0);
  push('qvol_shift', Math.log((vSecond + EPS) / (vFirst + EPS)));
  push('qvol_lastq', mv > 0 ? mean(v.slice(HOURS - Q)) / mv : 0);

  // ---- price AND volume together -----------------------------------------
  // The old block had NOT ONE of these. A straight-line model cannot build a
  // product of two of its inputs, so "it rose on heavy volume" was not
  // merely unnamed in this system — it was unrepresentable.
  const rv = v.slice(1);                      // volume of each hour that has a return
  const sv = rv.reduce((a, b) => a + b, 0);
  push('money_flow', sv > 0 ? rv.reduce((a, b, i) => a + b * Math.sign(rets[i]), 0) / sv : 0);
  push('qvol_move_corr', pearson(rets.map(Math.abs), rv));
  const vwr = sv > 0 ? rv.reduce((a, b, i) => a + b * rets[i], 0) / sv : 0;
  push('vol_weighted_edge', vwr - (rets.length ? mean(rets) : 0));

  return { rets, sumV, lastqShare: mv > 0 ? mean(v.slice(HOURS - Q)) / mv : 0 };
}

// Full compressed vector for one chunk: 21 per asset + 5 cross, the same
// count at every chunk shape.
function compressedFeatures(tradeCandles, compareCandles) {
  const names = [];
  const out = [];
  const t = assetCompressed(tradeCandles, 'trade', names, out);
  const c = assetCompressed(compareCandles, 'comp', names, out);

  const at = (n) => out[names.indexOf(n)];
  names.push('rel_total_ret');
  out.push(at('trade_total_ret') - at('comp_total_ret'));
  // The last QUARTER, not the last 24 hours: at Daily 1-day the last 24
  // hours are the whole chunk, so the old number was the total written twice.
  names.push('rel_q4_ret');
  out.push(at('trade_q4_ret') - at('comp_q4_ret'));
  // Named for what it is. This compares the two coins' VOLATILITY, and the
  // old block filed it under volume, which is why a coin read alongside
  // another had a volume-only reading whose one live number was not volume.
  names.push('rel_hvol_log');
  out.push(Math.log((at('trade_hourly_vol') + EPS) / (at('comp_hourly_vol') + EPS)));
  names.push('ret_correlation');
  out.push(pearson(t.rets, c.rets));
  // A genuine relative-VOLUME number, which the block never had: did the
  // traded coin get busy while its companion did not?
  names.push('rel_qvol_burst');
  out.push(Math.log((t.lastqShare + EPS) / (c.lastqShare + EPS)));

  return { x: out, names };
}

// Stable name list (for reports) for a chunk of any shape, without candles.
// The count no longer depends on the shape; the argument is kept because
// callers pass it and because a future shape-dependent number would need it.
function featureNamesFor() {
  const one = (p) => PER_ASSET_SPEC.map(([n]) => `${p}_${n}`);
  return [...one('trade'), ...one('comp'), ...CROSS_SPEC.map(([n]) => n)];
}
const FEATURE_NAMES = featureNamesFor();

// The family of every number, by exact name — never guessed from spelling.
const FAMILY = new Map();
for (const [n, fam] of PER_ASSET_SPEC) { FAMILY.set(`trade_${n}`, fam); FAMILY.set(`comp_${n}`, fam); }
for (const [n, fam] of CROSS_SPEC) FAMILY.set(n, fam);

// The READINGS a member can be trained on. The first four partition the
// block; 'full' is their union.
const FEATURE_VIEWS = {
  full: () => true,
  prices: (n) => FAMILY.get(n) === 'price',
  volume: (n) => FAMILY.get(n) === 'volume',
  pricevol: (n) => FAMILY.get(n) === 'pricevol',
  cross: (n) => FAMILY.get(n) === 'cross',
};

// Indices of the name list selected by a reading (throws on unknowns).
function viewIndices(view) {
  const pred = FEATURE_VIEWS[view];
  if (!pred) throw new Error(`unknown feature view "${view}"`);
  return FEATURE_NAMES.map((n, i) => (pred(n) ? i : -1)).filter((i) => i >= 0);
}

module.exports = {
  compressedFeatures, FEATURE_NAMES, featureNamesFor, FEATURE_VIEWS, viewIndices,
  FAMILY, PER_ASSET, CROSS, PER_ASSET_SPEC, CROSS_SPEC, MEASUREMENTS_VERSION,
  mean, std, linSlope, pearson,
};
