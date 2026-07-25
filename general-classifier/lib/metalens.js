const { HOUR_MS } = require('./binance');
const { toHourlyMap, forwardFill, buildChunks, scoreDiff, balancedBandPct, GEOMETRIES } = require('./dataset');
const { viewIndices } = require('./features');
const { standardizeFit, standardizeApply, tuneAndTrain, predict: predictLogreg } = require('./logreg');
const { trainBoost, predictBoost } = require('./boost');
const { pnlFor } = require('./paper');
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

const FRACTION_MENU = [0.5, 0.625, 0.75, 0.875, 1.0];

const SPECS = [];
for (const view of ['full', 'prices', 'volume', 'cross']) {
  for (const model of ['logreg', 'boost']) SPECS.push({ key: `${view}/${model}`, view, model });
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
    const p = pnlFor(call, entryC.open, exitC.open);
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
  const trainChunks = chunks.slice(0, chunks.length - nTest);
  const testChunks = chunks.slice(chunks.length - nTest);

  let bandPct = adaptiveBand ? balancedBandPct(trainChunks.map((c) => c.diffPct)) : Math.abs(params.dormantPct);
  if (adaptiveBand) for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);

  const { A, B } = splitHalves(trainChunks);

  // ---- stage 1: lens selection on half A ------------------------------------
  const nValA = Math.max(3, Math.round(A.length * 0.25));
  const subA = A.slice(0, A.length - nValA);
  const valA = A.slice(A.length - nValA);
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

  // ---- stage 2: agreement threshold on half B --------------------------------
  let stage2 = { menu: [], chosenFrac: null, lenses: passedSpecs.map((s) => s.key) };
  let finalModels = [];
  if (passedSpecs.length) {
    const modelsA = [];
    for (const spec of passedSpecs) {
      onProgress(`stage 2: retraining ${spec.key} on all of half A`);
      modelsA.push(await trainOn(spec, A, nDays, onProgress));
    }
    const bCalls = B.map((c) => modelsA.map((m) => m.predictOne(c)));
    for (const frac of FRACTION_MENU) {
      const book = paperOver(B, (i) => metaCall(bCalls[i], frac), tradeFilled.map, geo);
      stage2.menu.push({ frac, ...book });
    }
    let best = stage2.menu[0];
    for (const row of stage2.menu) if (row.pnl > best.pnl || (row.pnl === best.pnl && row.frac > best.frac)) best = row;
    stage2.chosenFrac = best.frac;

    // ---- verdict: retrain on A+B, trade the untouched test window ------------
    for (const spec of passedSpecs) {
      onProgress(`final: retraining ${spec.key} on the full training window`);
      finalModels.push(await trainOn(spec, trainChunks, nDays, onProgress));
    }
  }

  const testCalls = testChunks.map((c) => finalModels.map((m) => m.predictOne(c)));
  const callOf = (i) => (passedSpecs.length ? metaCall(testCalls[i], stage2.chosenFrac) : 0);
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
      dormantPct: adaptiveBand ? 'auto' : params.dormantPct,
      labelShift,
      allLoaded,
    },
    data: { chunks: chunks.length, bandPct, halves: { A: A.length, B: B.length }, test: testChunks.length },
    stage1,
    stage2,
    test: {
      book,
      grossPerTrade: book.trades ? (book.pnl + book.trades) / book.trades : null,
      accuracy: testAcc,
      bestConstant: testConst,
      edge: testAcc != null && testConst != null ? testAcc - testConst : null,
      rows: testChunks.map((c, i) => ({
        dayOf: new Date(c.startTs).toISOString().slice(0, 10),
        call: callOf(i),
        backing: passedSpecs.length ? testCalls[i].filter((v) => v !== 0 && v === callOf(i)).length : 0,
        of: passedSpecs.length,
        actual: c.label,
      })),
    },
  };
}

// Compact metrics for batch storage — the null runs keep only these.
function extractMetaMetrics(report) {
  return {
    lensesPassed: report.stage2.lenses.length,
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

module.exports = { runMetaLens, extractMetaMetrics, metaCall, splitHalves, bestConstantOf, FRACTION_MENU, SPECS };
