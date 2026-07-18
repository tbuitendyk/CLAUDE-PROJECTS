// Regime classification (Phase 2.9): label each day of a market benchmark
// as bull / bear / range, then segment the timeline into contiguous SWATHS
// of a single regime. The composition search evaluates a mix's harvest edge
// per swath and aggregates by regime type, so "works across market types"
// becomes measurable.
//
// Benchmark: BTC's deep daily series is the market clock (crypto regimes are
// BTC-led; it's the one series guaranteed to span the full window). The
// caller passes the benchmark closes; classification is pure.
//
// Signal (no look-ahead beyond a trailing window — labels describe the past,
// and are used only to CHARACTERIZE historical performance, never to trade):
//   * trend = price vs its own trailing moving average (up/down bias)
//   * drawdown from the trailing high (stress)
//   Bull  = above a rising MA and not in a deep drawdown.
//   Bear  = in a deep drawdown (>= BEAR_DD) or below a falling MA while
//           sliding.
//   Range = everything else (sideways / choppy).
// A smoothing pass + minimum swath length keep swaths coherent rather than
// flickering day to day.

const MA_DAYS = 50; // trailing moving-average window
const SLOPE_DAYS = 20; // lookback for the MA's own slope (rising/falling)
const HIGH_WINDOW = 90; // rolling-high lookback for the drawdown signal
const BULL_UP = 0.05; // >5% above the MA => clear uptrend
const BEAR_DD = 0.25; // >=25% off the RECENT high => actively declining (bear)
const BEAR_BELOW = 0.12; // well below a FALLING MA (not mere chop) => bear
const MIN_SWATH = 20; // days; shorter runs get merged into a neighbour

function sma(prices, i, n) {
  const lo = Math.max(0, i - n + 1);
  let s = 0;
  for (let k = lo; k <= i; k++) s += prices[k];
  return s / (i - lo + 1);
}

function rollingHigh(prices, i, n) {
  const lo = Math.max(0, i - n + 1);
  let hi = 0;
  for (let k = lo; k <= i; k++) hi = Math.max(hi, prices[k]);
  return hi;
}

// Per-day raw label from trend + RECENT drawdown. The drawdown is measured
// against a rolling 90-day high (not the all-time high) so a sideways bottom
// after a crash reads as RANGE — mean-reverting, harvestable — rather than
// perpetual bear. Bear means the market is actively falling now.
function rawLabels(prices) {
  const labels = new Array(prices.length);
  for (let i = 0; i < prices.length; i++) {
    const hi = rollingHigh(prices, i, HIGH_WINDOW);
    const dd = hi > 0 ? 1 - prices[i] / hi : 0;
    const ma = sma(prices, i, MA_DAYS);
    const maPrev = sma(prices, Math.max(0, i - SLOPE_DAYS), MA_DAYS);
    const maRising = ma >= maPrev;
    const above = ma > 0 ? prices[i] / ma - 1 : 0;
    let label;
    if (dd >= BEAR_DD || (!maRising && above < -BEAR_BELOW)) label = 'bear';
    else if (maRising && above > BULL_UP && dd < 0.15) label = 'bull';
    else label = 'range';
    labels[i] = label;
  }
  return labels;
}

// Collapse per-day labels into contiguous swaths, absorbing sub-MIN_SWATH
// runs into the previous swath so the segmentation is coherent.
function segment(tsArr, labels) {
  const runs = [];
  for (let i = 0; i < labels.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.label === labels[i]) last.end = i;
    else runs.push({ label: labels[i], start: i, end: i });
  }
  // Merge short runs into the preceding swath (or the following one for a
  // leading short run).
  const merged = [];
  for (const r of runs) {
    const len = r.end - r.start + 1;
    if (len < MIN_SWATH && merged.length > 0) {
      merged[merged.length - 1].end = r.end;
    } else if (len < MIN_SWATH && runs.length > 1) {
      merged.push({ ...r }); // leading short run; will be extended by next merge
    } else {
      merged.push({ ...r });
    }
  }
  // Second pass: a leading short swath followed by a longer one adopts the
  // longer one's label region boundaries but keeps its own label only if it
  // still meets the minimum; otherwise fold forward.
  const out = [];
  for (let i = 0; i < merged.length; i++) {
    const r = merged[i];
    const len = r.end - r.start + 1;
    if (len < MIN_SWATH && out.length === 0 && merged[i + 1]) {
      merged[i + 1].start = r.start; // fold this short leader into the next
      continue;
    }
    out.push(r);
  }
  return out.map((r) => ({
    label: r.label,
    from: tsArr[r.start],
    to: tsArr[r.end],
    startIdx: r.start,
    endIdx: r.end,
    days: r.end - r.start + 1,
  }));
}

// Classify a benchmark series ([{ts, usd_price}] oldest→newest) into swaths.
// Returns { swaths, byType: {bull:n,bear:n,range:n}, days }.
function classify(series) {
  if (!series || series.length < MA_DAYS + MIN_SWATH) {
    return { swaths: [], byType: { bull: 0, bear: 0, range: 0 }, days: series ? series.length : 0, enough: false };
  }
  const ts = series.map((r) => r.ts);
  const prices = series.map((r) => r.usd_price);
  const swaths = segment(ts, rawLabels(prices));
  const byType = { bull: 0, bear: 0, range: 0 };
  for (const s of swaths) byType[s.label] += s.days;
  // "Enough" for a regime study: at least two of the three types present
  // with a meaningful number of days each.
  const typesPresent = Object.values(byType).filter((d) => d >= MIN_SWATH).length;
  return { swaths, byType, days: series.length, enough: typesPresent >= 2 };
}

module.exports = { classify, segment, rawLabels, MA_DAYS, MIN_SWATH, BEAR_DD, BULL_UP };
