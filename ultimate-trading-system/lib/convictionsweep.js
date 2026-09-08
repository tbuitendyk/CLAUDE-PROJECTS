// convictionsweep.js -- price an AGREEMENT clip ladder ("conviction sizing")
// as a pure $ overlay on priced entries: the captured trades of one survivor
// of a Stage 4 record set (lib/stages.js hands them in). The calls never
// change — only how many dollars ride each call.
//
// Owner idea (2026-08-13): F1 trades 1-of-4 quorum at a flat clip; when MORE
// members agree, bet more (2x/3x/4x). This tool answers "would that have
// improved the $ result?" the same way the stop tuner answers its question —
// full-history replay, declared rule, priced honestly.
//
// Instrument rules, declared BEFORE any run and stamped into every result:
//  - The ladder is DECLARED, not shopped: multiplier = winning-side vote count
//    by default ([1,2,3,4]). A custom ladder may be passed but is stamped into
//    the result so a shopped ladder can never masquerade as the declared one.
//  - Agreement = number of members voting the WINNING side of that day's call
//    (2-UP/1-DOWN/1-aside is agreement 2). Ties already stand aside upstream.
//  - The $ uplift is judged against a PERMUTATION NULL: shuffle which trades
//    got which agreement count (returns fixed, bucket sizes preserved), price
//    the ladder each time. That is what chance alone hands a sizing overlay on
//    this history. Seeded and deterministic.
//  - $ totals flatter big clips, so exposure-honest metrics ride along: return
//    per deployed dollar, worst single trade at ladder size, max drawdown of
//    the cumulative ladder book, and the PEAK CONCURRENT notional the ladder
//    would have required (a ladder the wallet cannot fund is not a result).
//  - Threshold labels: MIN_BUCKET_N=10 and NULL_P=0.10 are GUESSED (starting
//    points to look harder, never verdicts on the candidate — a failed gate
//    judges the instrument, only replication judges the candidate).
const { HOUR_MS } = require('./binance');

const MIN_BUCKET_N = 10;   // GUESSED: buckets thinner than this are noise-flagged
const NULL_SHUFFLES = 1000;
const NULL_P = 0.10;       // GUESSED: null quantile the uplift must beat
const DEFAULT_SEED = 12345;

// Deterministic LCG so the null is reproducible run to run (seed is stamped).
function lcg(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function shuffled(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const multFor = (ladder, agree) => ladder[Math.min(agree, ladder.length) - 1] ?? 1;

// Pure: evaluate the ladder on PRICED entries [{entryTs, side, agree, netPct}].
// clipUsd is the 1x clip. Returns totals, buckets, exposure metrics, and the
// permutation null.
function evalConviction(priced, { clipUsd = 10, ladder = [1, 2, 3, 4], holdHours = 137,
                                  seed = DEFAULT_SEED, shuffles = NULL_SHUFFLES } = {}) {
  const n = priced.length;
  const pnl1x = priced.map((e) => e.netPct * clipUsd);
  const flatUsd = pnl1x.reduce((a, b) => a + b, 0);
  const ladderUsdOf = (agrees) => {
    let t = 0;
    for (let i = 0; i < n; i++) t += pnl1x[i] * multFor(ladder, agrees[i]);
    return t;
  };
  const agrees = priced.map((e) => e.agree);
  const ladderUsd = ladderUsdOf(agrees);

  // per-bucket table
  const maxAgree = ladder.length;
  const buckets = [];
  for (let a = 1; a <= maxAgree; a++) {
    const idx = [];
    for (let i = 0; i < n; i++) if (Math.min(agrees[i], maxAgree) === a) idx.push(i);
    const bFlat = idx.reduce((t, i) => t + pnl1x[i], 0);
    buckets.push({
      agree: a, multiplier: ladder[a - 1], n: idx.length,
      winners: idx.filter((i) => pnl1x[i] > 0).length,
      flatUsd: round(bFlat), ladderUsd: round(bFlat * ladder[a - 1]),
      thin: idx.length > 0 && idx.length < MIN_BUCKET_N,
    });
  }

  // exposure honesty
  const deployedFlat = n * clipUsd;
  const deployedLadder = agrees.reduce((t, a) => t + clipUsd * multFor(ladder, a), 0);
  const worstTradeUsd = n ? Math.min(...priced.map((e, i) => pnl1x[i] * multFor(ladder, agrees[i]))) : null;
  // cumulative ladder book in entry order (hold is constant, so exit order ==
  // entry order); drawdown = deepest peak-to-trough of the realized cumulative
  const byTime = priced.map((e, i) => ({ t: e.entryTs, usd: pnl1x[i] * multFor(ladder, agrees[i]) }))
    .sort((a, b) => a.t - b.t);
  let cum = 0, peak = 0, maxDrawdownUsd = 0;
  for (const x of byTime) {
    cum += x.usd;
    if (cum > peak) peak = cum;
    if (peak - cum > maxDrawdownUsd) maxDrawdownUsd = peak - cum;
  }
  // peak concurrent notional: interval sweep over [entryTs, entryTs+hold)
  const events = [];
  for (let i = 0; i < n; i++) {
    const notional = clipUsd * multFor(ladder, agrees[i]);
    events.push([priced[i].entryTs, notional], [priced[i].entryTs + holdHours * HOUR_MS, -notional]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // exits (-) before entries (+) at a tie
  let cur = 0, peakConcurrentUsd = 0;
  for (const [, d] of events) { cur += d; if (cur > peakConcurrentUsd) peakConcurrentUsd = cur; }
  const flatEvents = events.map(([t, d]) => [t, Math.sign(d) * clipUsd]);
  let curF = 0, peakConcurrentFlatUsd = 0;
  for (const [, d] of flatEvents) { curF += d; if (curF > peakConcurrentFlatUsd) peakConcurrentFlatUsd = curF; }

  // permutation null: same returns, same bucket sizes, shuffled assignment
  const rand = lcg(seed);
  const uplift = ladderUsd - flatUsd;
  let ge = 0;
  const nullUplifts = [];
  for (let k = 0; k < shuffles; k++) {
    const u = ladderUsdOf(shuffled(agrees, rand)) - flatUsd;
    nullUplifts.push(u);
    if (u >= uplift) ge++;
  }
  nullUplifts.sort((a, b) => a - b);
  const q = (p) => nullUplifts.length ? nullUplifts[Math.min(nullUplifts.length - 1, Math.floor(p * nullUplifts.length))] : null;
  const pNull = shuffles ? ge / shuffles : null;

  const thinMultiplied = buckets.some((b) => b.multiplier > 1 && b.n > 0 && b.n < MIN_BUCKET_N);
  return {
    clipUsd, ladder, holdHours, seed, shuffles,
    entries: n,
    flatUsd: round(flatUsd), ladderUsd: round(ladderUsd), upliftUsd: round(uplift),
    deployedFlatUsd: round(deployedFlat), deployedLadderUsd: round(deployedLadder),
    flatPerDollar: deployedFlat ? round(flatUsd / deployedFlat) : null,
    ladderPerDollar: deployedLadder ? round(ladderUsd / deployedLadder) : null,
    worstTradeUsd: worstTradeUsd == null ? null : round(worstTradeUsd),
    maxDrawdownUsd: round(maxDrawdownUsd),
    peakConcurrentUsd: round(peakConcurrentUsd), peakConcurrentFlatUsd: round(peakConcurrentFlatUsd),
    buckets,
    null: { pNull, mean: round(avg(nullUplifts)), p90: round(q(0.90)), p95: round(q(0.95)) },
    minBucketN: MIN_BUCKET_N, nullPThreshold: NULL_P, thresholdsLabel: 'GUESSED',
    verdict:
      thinMultiplied ? 'INCONCLUSIVE — a multiplied bucket is thinner than the minimum N; the ladder rests on too few trades'
        : uplift <= 0 ? 'NO — the declared ladder did not beat flat sizing on this history'
          : (pNull != null && pNull <= NULL_P)
            ? 'YES (on this history) — the ladder beat flat sizing by more than chance hands a random assignment'
            : 'NOT DISTINGUISHABLE FROM CHANCE — positive uplift, but a shuffled assignment does as well too often',
  };
}

function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function round(v, n = 4) { return v == null ? null : Math.round(v * 10 ** n) / 10 ** n; }

module.exports = { evalConviction, MIN_BUCKET_N };
