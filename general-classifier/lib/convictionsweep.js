// convictionsweep.js -- price a QUORUM-AGREEMENT clip ladder ("conviction
// sizing") for a market-entry setup over its FULL history, by replaying the
// SAME frozen committee the live engine trades (identical chain to
// stopsweep.js) and applying the ladder as a pure $ overlay on the entries the
// replay actually takes. The committee's calls never change — only how many
// dollars ride each call.
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
const { buildCombo, trainMembers, quorumCall } = require('./bracketwork');
const bracketLib = require('./bracket');
const { scoreDiff } = require('./dataset');
const { splitFrozen } = require('./freeze');
const { REAL_FEE_PER_LEG, NOTIONAL } = require('./paper');
const { entryOutcome } = require('./stoptuner');
const { hasExistingStop } = require('./stopsweep');
const { HOUR_MS } = require('./binance');

const MIN_BUCKET_N = 10;   // GUESSED: buckets thinner than this are noise-flagged
const NULL_SHUFFLES = 1000;
const NULL_P = 0.10;       // GUESSED: null quantile the uplift must beat
const DEFAULT_SEED = 12345;

// Pure: entries WITH the winning-side agreement count. calls[i] is the quorum
// call (1/-1/0); memberCalls[m][i] is member m's call for chunk i. Agreement is
// how many members voted the SAME direction as the final call — never the
// opposition, never the asides.
function agreementEntries(chunks, calls, memberCalls, geo) {
  const off = (geo.entryOffsetH || 0) * HOUR_MS;
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = calls[i];
    if (c !== 1 && c !== -1) continue;
    let agree = 0;
    for (const m of memberCalls) if (m[i] === c) agree++;
    out.push({ entryTs: chunks[i].startTs + off, side: c === 1 ? 'LONG' : 'SHORT', agree });
  }
  return out;
}

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

// Full-history replay for a book: identical frozen chain to stopsweep, then the
// conviction overlay. Only market-entry cells (the $ pricing is the market
// open-to-open convention; a breakout/trailing cell prices differently).
// THE FREEZE IS THE CALLER'S TO STATE (owner, 2026-08-19: "generalizing it all
// so that ALL of the functionality -- DATA AND CODE" belongs to the profile).
//
// This module used to default its training cutoff to TRAIN_THROUGH/SCORE_FROM
// imported from lib/forwardbook.js. Those constants are the frozen dates of a
// PRE-REGISTERED RESEARCH RECORD — three books committed with their cutoffs
// before any number existed. They are correct for that record and meaningless
// for anyone else. Inheriting them meant a profile's stop was tuned against a
// stranger's training window, silently and with a plausible-looking number
// coming out the far end: the exact shape of every instrumentation defect in
// this project.
//
// So there is no default any more. A caller states the cutoff or gets an error
// naming what is missing — the same contract splitFrozen already enforces one
// level down, for the same reason.
function requireFreeze(book, opts) {
  const t = opts && opts.trainThrough;
  const f = opts && opts.scoreFrom;
  if (!Number.isFinite(t)) {
    throw new Error(`setup ${(book && book.id) || '?'}: no training cutoff was stated for this scan. `
      + 'A cutoff must come from the thing being scanned — a profile\'s trainPolicy, or the fire time of '
      + 'the run a lab row was selected from — never inherited from another record\'s frozen dates.');
  }
  // scoreFrom only splits train from score; the sweep re-unions both halves, so
  // an unstated one is not ambiguous the way the cutoff is. Default it to the
  // instant after the cutoff and say so, rather than reaching for a constant.
  return { trainThrough: t, scoreFrom: Number.isFinite(f) ? f : t + 1 };
}

async function computeConvictionSweep(book, opts = {}) {
  // CHECK THE CUTOFF FIRST. buildCombo below loads full history and takes
  // minutes; refusing after that is a slow way to say something that is knowable
  // instantly, and the error that surfaced was whatever the data loader hit
  // rather than the real cause.
  const freeze = requireFreeze(book, opts);
  if (hasExistingStop(book.cell)) {
    throw new Error(`setup ${book.id} is not a market-entry/no-trail cell — conviction pricing does not apply`);
  }
  const feeUsd = opts.feePerLegUsd ?? REAL_FEE_PER_LEG;
  const feeFrac = opts.feePerLeg ?? (feeUsd / NOTIONAL);
  const params = { allLoaded: true, feePerLeg: feeUsd };
  const { geo, maps, chunks } = await buildCombo(book.combo, book.branch, params);
  const bandPct = Math.abs(book.branch.band);
  for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);
  const outcomeMs = (geo.exitOffsetH || 0) * 3600000;
  const { trainChunks, fwdChunks } = splitFrozen(
    chunks, freeze.trainThrough, freeze.scoreFrom, outcomeMs,
  );
  if (!trainChunks.length) throw new Error(`setup ${book.id}: no training chunks at/before the freeze date`);
  const scoreChunks = [...trainChunks, ...fwdChunks].sort((a, b) => a.startTs - b.startTs);
  const views = bracketLib.comboViews(book.combo.size, geo.featureHours / 24).views;
  const members = await trainMembers(book.members, views, trainChunks, scoreChunks, book.branch, maps, geo);
  const memberCalls = members.map((m) => m.calls);
  const calls = scoreChunks.map((_, i) => quorumCall(memberCalls, i, book.cell.quorum));

  const entries = agreementEntries(scoreChunks, calls, memberCalls, geo);
  const priced = [];
  let unpriced = 0;
  for (const e of entries) {
    const o = entryOutcome(e.entryTs, e.side, maps.trade, book.cell.tHours, feeFrac);
    if (o.priced) priced.push({ ...e, netPct: o.netPct });
    else unpriced++;
  }
  const evalOut = evalConviction(priced, {
    clipUsd: opts.clipUsd ?? 10,
    ladder: opts.ladder ?? Array.from({ length: (book.members || []).length || 4 }, (_, i) => i + 1),
    holdHours: book.cell.tHours,
    seed: opts.seed ?? DEFAULT_SEED,
    shuffles: opts.shuffles ?? NULL_SHUFFLES,
  });
  return {
    setup: { id: book.id, combo: book.combo, cell: book.cell, members: (book.members || []).length },
    trainThrough: freeze.trainThrough,
    fullHistory: {
      chunks: scoreChunks.length, unpricedEntries: unpriced,
      firstChunkUtc: scoreChunks.length ? new Date(scoreChunks[0].startTs).toISOString() : null,
      lastChunkUtc: scoreChunks.length ? new Date(scoreChunks[scoreChunks.length - 1].startTs).toISOString() : null,
    },
    ...evalOut,
  };
}

function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function round(v, n = 4) { return v == null ? null : Math.round(v * 10 ** n) / 10 ** n; }

module.exports = { computeConvictionSweep, agreementEntries, evalConviction, MIN_BUCKET_N };
