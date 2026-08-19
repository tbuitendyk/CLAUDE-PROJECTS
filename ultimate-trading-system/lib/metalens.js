const { HOUR_MS } = require('./binance');
const { toHourlyMap, forwardFill, buildChunks, scoreDiff, balancedBandPct, GEOMETRIES } = require('./dataset');
const { viewIndices } = require('./features');
const { standardizeFit, standardizeApply, tuneAndTrain, predict: predictLogreg } = require('./logreg');
const { trainBoost, predictBoost } = require('./boost');
const { pnlAt, REAL_FEE_PER_LEG } = require('./paper');
const { loadSymbol, loadSymbolAll, monthList, deriveShift } = require('./pipeline');

// META-LENS protocol (owner's design, agreed 2026-07-25):
//
// Two-stage nested construction, so the machine that trades the test window
// was assembled without ever seeing it — OR the data that picked its parts.
//
//   The TRAINING window (first 80% of chunks) is split into two
//   chronological halves, A (early) and B (late). The test window is the
//   usual most-recent 20% and stays untouched until the final verdict.
//
//   Stage 1 — lens selection, on half A only. Each of the 8 specs trains on
//   the first 75% of A and is scored on A's chronological tail. A lens
//   PASSES if its tail accuracy beats the tail's best constant guess —
//   "detects signal on data it hasn't seen", the owner's criterion.
//
//   Stage 2 — agreement threshold, on half B only. The passing lenses
//   retrain on all of A and predict B. The threshold is chosen from a FIXED
//   menu of agreement fractions (50/62.5/75/87.5/100% of the passing
//   lenses) by paper P&L on B; ties go to the stricter fraction.
//
//   Verdict — the passing lenses retrain on all of A+B and trade the test
//   window at the chosen threshold: one meta-book, $100 per order, $0.50
//   per leg at the geometry's entry/exit candle opens.
//
// Null calibration REPLAYS THE ENTIRE RECIPE per label rotation — selection
// on shifted A, threshold on shifted B, verdict on the shifted test — so the
// noise floor enjoys every freedom the real run had. (Fridge magnet: what-
// ever freedom you enjoyed, the null must enjoy too.)
//
// Honest degenerate outcomes, reported rather than papered over: zero lenses
// passing stage 1 means the meta-book stands aside everywhere (P&L $0.00,
// 0 trades) — "no signal found" is a result, not an error.
//
// forceAllOnZeroPass (owner's requirement, motivated by DOT): when stage 1
// passes NOTHING, optionally continue with ALL 8 lenses as the committee
// instead of standing aside — because a pair can have individually-dead
// lenses whose rare agreement still carries signal (DOT's 1000-shift null:
// every spec negative, vote dead at 40%, yet the 6/8 gate at 2%). The
// fallback is recorded on the result (forcedAll: true) so a forced run can
// never masquerade as a selective one, and null replays inherit the same
// setting so the calibration stays apples-to-apples.

// The committee stage 2 works with: the stage-1 survivors, or — only when
// nothing survived AND the owner forced it — the full grid.
function committeeFor(passed, all, forceAllOnZeroPass) {
  if (passed.length) return { specs: passed, forcedAll: false };
  if (forceAllOnZeroPass) return { specs: all, forcedAll: true };
  return { specs: [], forcedAll: false };
}

const FRACTION_MENU = [0.5, 0.625, 0.75, 0.875, 1.0];

const SPECS = [];
for (const view of ['full', 'prices', 'volume', 'cross']) {
  for (const model of ['logreg', 'boost']) SPECS.push({ key: `${view}/${model}`, view, model });
}

// Threshold choice over the fixed menu: highest P&L, ties to the stricter
// fraction — but if NOTHING on half B made money, the recipe found nothing
// and the book stands aside rather than trading a least-bad default.
function chooseFrac(menu) {
  if (!menu.length) return { frac: null, standAside: true };
  let best = menu[0];
  for (const row of menu) if (row.pnl > best.pnl || (row.pnl === best.pnl && row.frac > best.frac)) best = row;
  if (best.pnl <= 0) return { frac: null, standAside: true };
  return { frac: best.frac, standAside: false };
}

// Meta call: direction backed by at least ceil(frac * m) of the m passing
// lenses, and strictly more backers than the opposite direction. Stand aside
// otherwise. frac=0.5 with an even split therefore stands aside.
function metaCall(calls, frac) {
  const m = calls.length;
  if (!m) return 0;
  const need = Math.max(1, Math.ceil(frac * m));
  let up = 0;
  let down = 0;
  for (const c of calls) {
    if (c === 1) up++;
    else if (c === -1) down++;
  }
  if (up >= need && up > down) return 1;
  if (down >= need && down > up) return -1;
  return 0;
}

// Chronological halves of the training window: A = early, B = late.
function splitHalves(trainChunks) {
  const nA = Math.floor(trainChunks.length / 2);
  return { A: trainChunks.slice(0, nA), B: trainChunks.slice(nA) };
}

// BLOCK-INTERLACED split (owner's design). Chronological halves make stage 2
// choose its threshold in one era and apply it in another — and both DOT and
// DOGE showed the raw gross edge FLIPPING SIGN between eras, so that isn't a
// nuisance, it's the dominant effect. Interlacing whole blocks lets every
// group span the entire history instead.
//
// Block size is an odd number of WEEKS (49 days = 7 weeks by default):
//   * whole weeks keep the weekday composition identical in every block, so
//     day-of-week can never differ between the groups;
//   * an odd multiple drifts steadily across the calendar, so no block ever
//     consistently starts on a month boundary and picks up month-end
//     structure (rebalancing, expiry, funding cycles).
//
// PURGE: neighbouring chunks overlap — a daily-3d chunk spans 72h of features
// and settles 114h out, so chunks near a block edge reach into the next block.
// The last `purge` chunks of every block are dropped, purge = ceil(settle
// horizon / step), which is 5 chunks for daily-3d and 2 for weekly-8d.
// Without this, interlacing would leak a model's training data into the very
// set meant to score it — worse than the era problem it fixes.
//
// Groups come from block index mod 4: 0 -> stage-1 fit, 2 -> stage-1 score,
// 1 and 3 -> stage 2's half B. Every group therefore spans all eras, and
// stage 1's scoring set is era-mixed too (a chronological tail of an
// interlaced A would have quietly reintroduced the same problem).
const BLOCK_DAYS = 49; // 7 weeks
const DAY_MS = 24 * HOUR_MS;

function purgeChunks(geo) {
  return Math.ceil(geo.exitOffsetH / (geo.stepHours || 24));
}

function interlacedSplit(trainChunks, geo, blockDays = BLOCK_DAYS) {
  const purge = purgeChunks(geo);
  const t0 = trainChunks[0].startTs;
  const blockMs = blockDays * DAY_MS;
  const blocks = new Map();
  for (const c of trainChunks) {
    const b = Math.floor((c.startTs - t0) / blockMs);
    if (!blocks.has(b)) blocks.set(b, []);
    blocks.get(b).push(c);
  }
  const fitA = [];
  const scoreA = [];
  const B = [];
  let purged = 0;
  for (const [idx, list] of [...blocks.entries()].sort((a, b) => a[0] - b[0])) {
    const kept = list.length > purge ? list.slice(0, list.length - purge) : [];
    purged += list.length - kept.length;
    const bucket = idx % 4 === 0 ? fitA : idx % 4 === 2 ? scoreA : B;
    for (const c of kept) bucket.push(c);
  }
  return {
    fitA,
    scoreA,
    B,
    meta: { mode: 'interlaced', blockDays, blocks: blocks.size, purge, purgedChunks: purged },
  };
}

// One entry point for both modes, so the rest of the recipe is split-agnostic.
function buildSplit(trainChunks, geo, splitMode, blockDays = BLOCK_DAYS) {
  if (splitMode === 'interlaced') return interlacedSplit(trainChunks, geo, blockDays);
  const { A, B } = splitHalves(trainChunks);
  const nVal = Math.max(3, Math.round(A.length * 0.25));
  return {
    fitA: A.slice(0, A.length - nVal),
    scoreA: A.slice(A.length - nVal),
    B,
    meta: { mode: 'chronological', blockDays: null, blocks: null, purge: 0, purgedChunks: 0 },
  };
}

async function trainOn(spec, chunks, nDays, onProgress) {
  const idx = viewIndices(spec.view, nDays);
  const X = chunks.map((c) => idx.map((i) => c.x[i]));
  const y = chunks.map((c) => c.label);
  if (spec.model === 'logreg') {
    const scaler = standardizeFit(X);
    const Z = standardizeApply(X, scaler);
    const { model } = await tuneAndTrain(Z, y, { onProgress: () => {} });
    return {
      predictOne: (c) => {
        const x = idx.map((i) => c.x[i]);
        const z = new Float64Array(x.length);
        for (let j = 0; j < x.length; j++) z[j] = (x[j] - scaler.mean[j]) / scaler.std[j];
        return predictLogreg(model, z).label;
      },
    };
  }
  const nVal = Math.max(3, Math.round(X.length * 0.25));
  const nSub = X.length - nVal;
  if (nSub < 4) throw new Error(`not enough chunks (${X.length}) to train ${spec.key}`);
  const probe = await trainBoost(X.slice(0, nSub), y.slice(0, nSub), { Xval: X.slice(nSub), yval: y.slice(nSub) });
  const model = await trainBoost(X, y, { rounds: probe.bestRound });
  return { predictOne: (c) => predictBoost({ priors: model.priors, trees: model.trees }, idx.map((i) => c.x[i])).label };
}

function bestConstantOf(labels) {
  const counts = { '-1': 0, 0: 0, 1: 0 };
  for (const l of labels) counts[l]++;
  return labels.length ? Math.max(counts['-1'], counts[0], counts[1]) / labels.length : null;
}

function paperOver(chunks, callOf, tradeMap, geo) {
  let pnl = 0;
  let trades = 0;
  let wins = 0;
  let priced = 0;
  chunks.forEach((c, i) => {
    const entryC = tradeMap.get(c.startTs + geo.entryOffsetH * HOUR_MS);
    const exitC = tradeMap.get(c.startTs + geo.exitOffsetH * HOUR_MS);
    if (!entryC || !exitC) return;
    priced++;
    const call = callOf(i);
    if (call === 0) return;
    const p = pnlAt(call, entryC.open, exitC.open);
    pnl += p;
    trades++;
    if (p > 0) wins++;
  });
  return { pnl, trades, wins, priced, unpriced: chunks.length - priced };
}

async function runMetaLens(params, onProgress = () => {}) {
  const { tradeSymbol, compareSymbol, startMonth, endMonth } = params;
  const geometry = params.geometry || 'daily-3d';
  const geo = GEOMETRIES[geometry];
  if (!geo) throw new Error(`unknown geometry "${geometry}"`);
  const nDays = geo.featureHours / 24;
  const weekdaysOnly = !!params.weekdaysOnly;
  const forceAllOnZeroPass = !!params.forceAllOnZeroPass;
  const splitMode = params.splitMode === 'interlaced' ? 'interlaced' : 'chronological';
  const adaptiveBand = params.dormantPct === 'auto' || params.dormantPct === undefined;
  const labelShiftFrac = Number(params.labelShiftFrac) || 0;
  const allLoaded = !!params.allLoaded;
  const months = allLoaded ? null : monthList(startMonth, endMonth);

  const trade = allLoaded ? await loadSymbolAll(tradeSymbol, onProgress) : await loadSymbol(tradeSymbol, months, onProgress);
  const compare = allLoaded ? await loadSymbolAll(compareSymbol, onProgress) : await loadSymbol(compareSymbol, months, onProgress);
  if (!trade.rows.length) throw new Error(`no data for ${tradeSymbol}`);
  if (!compare.rows.length) throw new Error(`no data for ${compareSymbol}`);

  onProgress(`building ${geometry} chunks`);
  const tradeFilled = forwardFill(toHourlyMap(trade.rows));
  const compareFilled = forwardFill(toHourlyMap(compare.rows));
  const { chunks } = buildChunks(tradeFilled.map, compareFilled.map, adaptiveBand ? 0 : params.dormantPct, 'compressed', {
    geometry,
    weekdaysOnly,
  });
  // The nested split leaves stage 1 with ~10% of the data as its scoring
  // tail; below ~200 chunks that tail is small enough to go single-class,
  // which makes the pass criterion unpassable and the whole recipe
  // meaningless rather than merely weak. Refuse instead.
  if (chunks.length < 200) throw new Error(`only ${chunks.length} chunks — the two-stage split needs at least 200 (use a longer range or a daily geometry)`);

  // Null mode: circularly rotate the label side, exactly as the pipeline does.
  const labelShift = labelShiftFrac > 0 ? deriveShift(chunks.length, labelShiftFrac) : 0;
  if (labelShift > 0) {
    const src = chunks.map((c) => ({ c1: c.c1, c2: c.c2, diffPct: c.diffPct, label: c.label }));
    for (let i = 0; i < chunks.length; i++) Object.assign(chunks[i], src[(i + labelShift) % chunks.length]);
  }

  const nTest = Math.max(2, Math.round(chunks.length * 0.2));
  // The test window is ALWAYS the chronological tail — interlacing it would
  // destroy the predict-the-future property this whole project rests on.
  // Purge the training side of the boundary too: with overlapping chunks the
  // last few training chunks share candles with the first test chunks.
  const boundaryPurge = purgeChunks(geo);
  const trainChunks = chunks.slice(0, Math.max(0, chunks.length - nTest - boundaryPurge));
  const testChunks = chunks.slice(chunks.length - nTest);

  let bandPct = adaptiveBand ? balancedBandPct(trainChunks.map((c) => c.diffPct)) : Math.abs(params.dormantPct);
  if (adaptiveBand) for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);

  const split = buildSplit(trainChunks, geo, splitMode);
  const { fitA: subA, scoreA: valA, B } = split;
  if (!subA.length || !valA.length || !B.length) {
    throw new Error(`split produced an empty group (fit ${subA.length}, score ${valA.length}, B ${B.length}) — widen the range`);
  }

  // ---- stage 1: lens selection ------------------------------------------------
  const valConst = bestConstantOf(valA.map((c) => c.label));
  const stage1 = [];
  for (const spec of SPECS) {
    onProgress(`stage 1: scoring lens ${spec.key} on half A`);
    let row;
    try {
      const m = await trainOn(spec, subA, nDays, onProgress);
      const hits = valA.filter((c) => m.predictOne(c) === c.label).length;
      const valAcc = hits / valA.length;
      row = { key: spec.key, valAcc, bestConstant: valConst, edge: valAcc - valConst, passed: valAcc > valConst };
    } catch (err) {
      row = { key: spec.key, valAcc: null, bestConstant: valConst, edge: null, passed: false, error: err.message };
    }
    stage1.push(row);
  }
  const passedSpecs = SPECS.filter((s) => stage1.find((r) => r.key === s.key).passed);
  const committee = committeeFor(passedSpecs, SPECS, forceAllOnZeroPass);

  // ---- stage 2: agreement threshold on half B --------------------------------
  let stage2 = { menu: [], chosenFrac: null, lenses: committee.specs.map((s) => s.key), forcedAll: committee.forcedAll };
  let finalModels = [];
  if (committee.specs.length) {
    const allA = [...subA, ...valA].sort((a, b) => a.startTs - b.startTs);
    const modelsA = [];
    for (const spec of committee.specs) {
      onProgress(`stage 2: retraining ${spec.key} on all of group A`);
      modelsA.push(await trainOn(spec, allA, nDays, onProgress));
    }
    const bCalls = B.map((c) => modelsA.map((m) => m.predictOne(c)));
    for (const frac of FRACTION_MENU) {
      const book = paperOver(B, (i) => metaCall(bCalls[i], frac), tradeFilled.map, geo);
      stage2.menu.push({ frac, ...book });
    }
    // STAND-ASIDE RULE (pre-registered 2026-07-26, VERDICTS.md era): if no
    // rung on half B is profitable, there is no threshold worth choosing —
    // "least bad" is noise selecting the strictest rung, and both DOT and
    // DOGE runs demonstrated exactly that failure. The book stands aside on
    // the whole test window instead: "this recipe found nothing" is the
    // honest result.
    const chosen = chooseFrac(stage2.menu);
    stage2.chosenFrac = chosen.frac;
    stage2.standAside = chosen.standAside;

    if (!chosen.standAside) {
      // ---- verdict: retrain on A+B, trade the untouched test window ----------
      for (const spec of committee.specs) {
        onProgress(`final: retraining ${spec.key} on the full training window`);
        finalModels.push(await trainOn(spec, trainChunks, nDays, onProgress));
      }
    }
  }

  const testCalls = testChunks.map((c) => finalModels.map((m) => m.predictOne(c)));
  const callOf = (i) => (committee.specs.length && stage2.chosenFrac != null ? metaCall(testCalls[i], stage2.chosenFrac) : 0);
  const book = paperOver(testChunks, callOf, tradeFilled.map, geo);
  const testConst = bestConstantOf(testChunks.map((c) => c.label));
  const hits = testChunks.filter((c, i) => callOf(i) === c.label).length;
  const testAcc = testChunks.length ? hits / testChunks.length : null;

  return {
    params: {
      protocol: 'metalens',
      tradeSymbol,
      compareSymbol,
      startMonth,
      endMonth,
      geometry,
      weekdaysOnly,
      forceAllOnZeroPass,
      splitMode,
      dormantPct: adaptiveBand ? 'auto' : params.dormantPct,
      labelShift,
      allLoaded,
    },
    data: {
      chunks: chunks.length,
      bandPct,
      halves: { A: subA.length + valA.length, B: B.length },
      groups: { fitA: subA.length, scoreA: valA.length, B: B.length },
      split: split.meta,
      boundaryPurge,
      test: testChunks.length,
    },
    stage1,
    stage2,
    test: {
      book,
      grossPerTrade: book.trades ? (book.pnl + book.trades * 2 * REAL_FEE_PER_LEG) / book.trades : null,
      accuracy: testAcc,
      bestConstant: testConst,
      edge: testAcc != null && testConst != null ? testAcc - testConst : null,
      rows: testChunks.map((c, i) => ({
        dayOf: new Date(c.startTs).toISOString().slice(0, 10),
        call: callOf(i),
        backing: committee.specs.length ? testCalls[i].filter((v) => v !== 0 && v === callOf(i)).length : 0,
        of: committee.specs.length,
        actual: c.label,
      })),
    },
  };
}

// Compact metrics for batch storage — the null runs keep only these.
function extractMetaMetrics(report) {
  return {
    lensesPassed: report.stage1.filter((r) => r.passed).length,
    committeeSize: report.stage2.lenses.length,
    forcedAll: !!report.stage2.forcedAll,
    standAside: !!report.stage2.standAside,
    lenses: report.stage2.lenses,
    chosenFrac: report.stage2.chosenFrac,
    pnl: report.test.book.pnl,
    trades: report.test.book.trades,
    wins: report.test.book.wins,
    grossPerTrade: report.test.grossPerTrade,
    accuracy: report.test.accuracy,
    bestConstant: report.test.bestConstant,
    edge: report.test.edge,
    bandPct: report.data.bandPct,
    chunks: report.data.chunks,
  };
}

module.exports = {
  runMetaLens,
  extractMetaMetrics,
  metaCall,
  chooseFrac,
  committeeFor,
  splitHalves,
  buildSplit,
  interlacedSplit,
  purgeChunks,
  bestConstantOf,
  FRACTION_MENU,
  BLOCK_DAYS,
  SPECS,
};
