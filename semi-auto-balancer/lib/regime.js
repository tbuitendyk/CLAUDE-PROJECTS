// Regime classification (Phase 2.9, honest-taxonomy rewrite): label each day
// of a market benchmark bull / bear / range from BTC's actual price action,
// then segment the timeline into contiguous SWATHS of a single regime. The
// composition search evaluates a mix's harvest edge per swath and aggregates
// by regime type, so "works across market types" becomes measurable.
//
// Benchmark: BTC's deep daily series is the market clock (crypto regimes are
// BTC-led; it's the one series guaranteed to span the full window). The
// caller passes the benchmark closes; classification is pure.
//
// Method — a CENTERED, smoothed trend. These labels exist ONLY to characterize
// the historical record for performance attribution ("how did this mix do in
// the bull stretches vs the bears?"); they never generate a signal that
// trades. That freedom matters: a causal trailing indicator (a moving-average
// slope) LAGS every turning point, so it miscalls the first months of a
// recovery — even a +37% rally — as "bear" until the average catches up. A
// centered window looks symmetrically forward and back and has no such lag, so
// the labels match what actually happened. We smooth daily closes, measure the
// price change across a ±TREND_HALF window, and call it:
//   * bull  when the centered move is a clear uptrend   (> +TREND_THRESH)
//   * bear  when it is a clear downtrend                 (< −TREND_THRESH)
//   * range otherwise (sideways / choppy / consolidating)
// Days near the series ends fall back to a shorter one-sided window, with the
// threshold scaled to the span actually available. A minimum swath length then
// keeps the segmentation coherent rather than flickering day to day.
//
// Validated against real BTC/USD 2022-07→2026-07: the swaths land on the
// actual cycle (2022-H2 bear to ~$16k, the 2023 recovery, the 2023-10→2024
// bull run, the 2024 mid-year range, the late-2025→2026 drawdown), ≈42% bull /
// 23% bear / 34% range — versus the old trailing classifier's ~1% bear.

const SMOOTH_DAYS = 10; // short SMA to denoise daily closes before trending
const TREND_HALF = 45; // centered half-window (±45d ≈ a quarter each side)
const TREND_THRESH = 0.12; // >12% across the window => a real trend, else range
const EDGE_MIN_SPAN = 0.4; // don't over-relax the threshold at the very ends
const MIN_SWATH = 25; // days; shorter runs get merged into a neighbour

function sma(prices, i, n) {
  const lo = Math.max(0, i - n + 1);
  let s = 0;
  for (let k = lo; k <= i; k++) s += prices[k];
  return s / (i - lo + 1);
}

// Per-day label from the CENTERED smoothed trend. `chg` is the smoothed price
// change from TREND_HALF days before to TREND_HALF days after (clipped at the
// series ends); `span` is how much of the full ±window was actually available,
// which scales the threshold so the shortened end-windows aren't hair-trigger.
function rawLabels(prices) {
  const n = prices.length;
  const sm = new Array(n);
  for (let i = 0; i < n; i++) sm[i] = sma(prices, i, SMOOTH_DAYS);
  const labels = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - TREND_HALF);
    const b = Math.min(n - 1, i + TREND_HALF);
    const chg = sm[a] > 0 ? sm[b] / sm[a] - 1 : 0;
    const span = TREND_HALF > 0 ? (b - a) / (2 * TREND_HALF) : 1;
    const t = TREND_THRESH * Math.max(span, EDGE_MIN_SPAN);
    labels[i] = chg > t ? 'bull' : chg < -t ? 'bear' : 'range';
  }
  return labels;
}

// Collapse per-day labels into contiguous swaths, absorbing sub-MIN_SWATH runs
// into a neighbour so the segmentation is coherent.
function segment(tsArr, labels) {
  const runs = [];
  for (let i = 0; i < labels.length; i++) {
    const last = runs[runs.length - 1];
    if (last && last.label === labels[i]) last.end = i;
    else runs.push({ label: labels[i], start: i, end: i });
  }
  // Merge short runs into the preceding swath.
  const merged = [];
  for (const r of runs) {
    const len = r.end - r.start + 1;
    if (len < MIN_SWATH && merged.length > 0) {
      merged[merged.length - 1].end = r.end;
    } else {
      merged.push({ ...r });
    }
  }
  // A leading short swath folds forward into the next.
  const out = [];
  for (let i = 0; i < merged.length; i++) {
    const r = merged[i];
    const len = r.end - r.start + 1;
    if (len < MIN_SWATH && out.length === 0 && merged[i + 1]) {
      merged[i + 1].start = r.start;
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
// Returns { swaths, byType: {bull,bear,range}, days, enough }.
function classify(series) {
  if (!series || series.length < 2 * MIN_SWATH) {
    return { swaths: [], byType: { bull: 0, bear: 0, range: 0 }, days: series ? series.length : 0, enough: false };
  }
  const ts = series.map((r) => r.ts);
  const prices = series.map((r) => r.usd_price);
  const swaths = segment(ts, rawLabels(prices));
  const byType = { bull: 0, bear: 0, range: 0 };
  for (const s of swaths) byType[s.label] += s.days;
  // "Enough" for a regime study: at least two of the three types present with
  // a meaningful number of days each.
  const typesPresent = Object.values(byType).filter((d) => d >= MIN_SWATH).length;
  return { swaths, byType, days: series.length, enough: typesPresent >= 2 };
}

module.exports = { classify, segment, rawLabels, MIN_SWATH, TREND_HALF, TREND_THRESH };
