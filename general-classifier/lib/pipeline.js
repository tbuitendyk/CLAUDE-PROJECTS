const { monthlyKlines, cachedMonths, HOUR_MS } = require('./binance');
const { pnlFor, directionalCall } = require('./paper');
const { toHourlyMap, forwardFill, buildChunks, scoreDiff, balancedBandPct, GEOMETRIES } = require('./dataset');
const { featureNamesFor, viewIndices } = require('./features');
const { CLASSES, standardizeFit, standardizeApply, predict, accuracy, tuneAndTrain, trainSoftmax } = require('./logreg');
const { trainBoost, predictBoost, accuracyBoost, importanceTable } = require('./boost');

// End-to-end run: download -> prune -> chunk -> score -> train 80% -> test
// 20% -> report. Split is CHRONOLOGICAL: the test set is the most recent
// fifth of the weeks, the honest simulation of training on the past and
// predicting the future.

const MIN_CHUNKS = 12;

// Threshold menu for the directional decision rule — a FIXED, pre-registered
// grid (never a continuous scan). tau=0 is "always in, direction only".
// Chosen on the chronological validation tail by paper P&L; ties go to the
// higher tau (fewer, more confident trades).
const TAU_GRID = [0, 0.34, 0.4, 0.45, 0.5, 0.55, 0.6];

function tuneTau(valChunks, valProbs, tradeMap, geo) {
  const ladder = TAU_GRID.map((tau) => {
    let pnl = 0;
    let trades = 0;
    valChunks.forEach((c, i) => {
      const call = directionalCall(valProbs[i], tau);
      if (call === 0) return;
      const entryC = tradeMap.get(c.startTs + geo.entryOffsetH * HOUR_MS);
      const exitC = tradeMap.get(c.startTs + geo.exitOffsetH * HOUR_MS);
      if (!entryC || !exitC) return;
      pnl += pnlFor(call, entryC.open, exitC.open);
      trades++;
    });
    return { tau, pnl, trades };
  });
  let best = ladder[0];
  for (const row of ladder) {
    if (row.pnl > best.pnl || (row.pnl === best.pnl && row.tau > best.tau)) best = row;
  }
  return { tau: best.tau, tauLadder: ladder };
}

function monthList(startMonth, endMonth) {
  const parse = (s) => {
    const m = /^(\d{4})-(\d{2})$/.exec(String(s || ''));
    if (!m) throw new Error(`bad month "${s}" (expected YYYY-MM)`);
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) throw new Error(`bad month "${s}"`);
    return { year, month };
  };
  const a = parse(startMonth);
  const b = parse(endMonth);
  const out = [];
  let { year, month } = a;
  while (year < b.year || (year === b.year && month <= b.month)) {
    out.push({ year, month });
    if (out.length > 120) throw new Error('range too large (max 120 months)');
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  if (out.length === 0) throw new Error('end month is before start month');
  return out;
}

async function loadSymbol(symbol, months, onProgress) {
  const { currentAbortEpoch, throwIfAbortedSince } = require('./throttle');
  const epoch = currentAbortEpoch();
  const rows = [];
  const missing = [];
  for (const { year, month } of months) {
    throwIfAbortedSince(epoch);
    const mm = `${year}-${String(month).padStart(2, '0')}`;
    onProgress(`downloading ${symbol} ${mm}`);
    const monthRows = await monthlyKlines(symbol, year, month);
    if (monthRows === null) missing.push(mm);
    else for (const r of monthRows) rows.push(r); // no spread-push: keeps arg counts off the call stack
  }
  return { rows, missing };
}

// "All loaded data" mode: read exactly the months already cached on disk
// for this symbol — never touches the network.
async function loadSymbolAll(symbol, onProgress) {
  const { currentAbortEpoch, throwIfAbortedSince } = require('./throttle');
  const epoch = currentAbortEpoch();
  const rows = [];
  const list = cachedMonths(symbol);
  for (const mm of list) {
    throwIfAbortedSince(epoch);
    onProgress(`reading cached ${symbol} ${mm}`);
    const [year, month] = mm.split('-').map(Number);
    const monthRows = await monthlyKlines(symbol, year, month);
    if (monthRows) for (const r of monthRows) rows.push(r);
  }
  return { rows, missing: [], cachedMonthCount: list.length };
}

function confusionMatrix(pairs) {
  const m = {};
  for (const a of CLASSES) {
    m[a] = {};
    for (const p of CLASSES) m[a][p] = 0;
  }
  for (const { actual, predicted } of pairs) m[actual][predicted]++;
  return m;
}

function perClassMetrics(pairs) {
  return CLASSES.map((cls) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let support = 0;
    for (const { actual, predicted } of pairs) {
      if (actual === cls) support++;
      if (predicted === cls && actual === cls) tp++;
      if (predicted === cls && actual !== cls) fp++;
      if (predicted !== cls && actual === cls) fn++;
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : null;
    const recall = tp + fn > 0 ? tp / (tp + fn) : null;
    const f1 = precision != null && recall != null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;
    return { class: cls, support, precision, recall, f1 };
  });
}

function classCounts(labels) {
  const counts = { '-1': 0, 0: 0, 1: 0 };
  for (const l of labels) counts[l]++;
  return counts;
}

// On standardized features every weight is in comparable units, so with the
// compressed (named) set we can report what the model actually leaned on.
function topWeights(model, names, count = 12) {
  const f = names.length;
  return names
    .map((name, j) => {
      const w = CLASSES.map((_, k) => model.W[k * (f + 1) + j]);
      return { name, weights: { '-1': w[0], 0: w[1], 1: w[2] }, mag: Math.max(Math.abs(w[0]), Math.abs(w[1]), Math.abs(w[2])) };
    })
    .sort((a, b) => b.mag - a.mag)
    .slice(0, count);
}

async function runAnalysis(params, onProgress = () => {}) {
  const { dormantPct, tradeSymbol, compareSymbol, startMonth, endMonth } = params;
  const adaptiveBand = dormantPct === 'auto';
  const featureSet = params.featureSet === 'raw' ? 'raw' : 'compressed';
  const modelKind = params.model === 'boost' ? 'boost' : 'logreg';
  const featureView = params.featureView || 'full';
  const decision = params.decision === 'directional' ? 'directional' : 'argmax';
  const geometry = params.geometry || 'weekly-8d';
  const weekdaysOnly = !!params.weekdaysOnly;
  const geo = GEOMETRIES[geometry];
  if (!geo) throw new Error(`unknown geometry "${geometry}"`);
  const nDays = geo.featureHours / 24;
  const explicitShift = Math.max(0, Math.floor(Number(params.labelShift) || 0));
  const labelShiftFrac = Number(params.labelShiftFrac) || 0;
  const allLoaded = !!params.allLoaded;
  const months = allLoaded ? null : monthList(startMonth, endMonth);

  const trade = allLoaded ? await loadSymbolAll(tradeSymbol, onProgress) : await loadSymbol(tradeSymbol, months, onProgress);
  const compare = allLoaded ? await loadSymbolAll(compareSymbol, onProgress) : await loadSymbol(compareSymbol, months, onProgress);
  if (trade.rows.length === 0) throw new Error(`no data for ${tradeSymbol} in that range — is the pair listed on Binance spot?`);
  if (compare.rows.length === 0) throw new Error(`no data for ${compareSymbol} in that range — is the pair listed on Binance spot?`);

  onProgress(`building ${geometry} chunks and scoring them`);
  const tradeFilled = forwardFill(toHourlyMap(trade.rows));
  const compareFilled = forwardFill(toHourlyMap(compare.rows));
  const { chunks, dropped, considered } = buildChunks(
    tradeFilled.map,
    compareFilled.map,
    adaptiveBand ? 0 : dormantPct,
    featureSet,
    { geometry, weekdaysOnly }
  );

  if (chunks.length < MIN_CHUNKS) {
    throw new Error(
      `only ${chunks.length} labelable chunks in that range (need at least ${MIN_CHUNKS}) — widen the month range`
    );
  }

  // Null-calibration mode: circularly shift the LABEL side (c1/c2/diff/label)
  // across chunks, preserving the labels' own time structure while severing
  // the feature->label link. What the pipeline "finds" under shifts is the
  // noise floor a real result must clear. A fractional shift request maps
  // onto THIS pair's own cycle length, keeping an 8-week buffer at both ends
  // (a shift near 0 or near n leaves labels nearly aligned with reality).
  const labelShift = explicitShift > 0 ? explicitShift : labelShiftFrac > 0 ? deriveShift(chunks.length, labelShiftFrac) : 0;
  if (labelShift > 0) {
    const n = chunks.length;
    const src = chunks.map((c) => ({ c1: c.c1, c2: c.c2, diffPct: c.diffPct, label: c.label }));
    for (let i = 0; i < n; i++) Object.assign(chunks[i], src[(i + labelShift) % n]);
  }

  // Feature view projection (consensus screen): restrict the compressed
  // vector to one methodological slice.
  const allNames = featureNamesFor(nDays);
  let featureNames = allNames;
  if (featureSet === 'compressed' && featureView !== 'full') {
    const idx = viewIndices(featureView, nDays);
    featureNames = idx.map((i) => allNames[i]);
    for (const c of chunks) c.x = idx.map((i) => c.x[i]);
  }

  const nTest = Math.max(2, Math.round(chunks.length * 0.2));
  const nTrain = chunks.length - nTest;
  const trainChunks = chunks.slice(0, nTrain);
  const testChunks = chunks.slice(nTrain);

  // Adaptive band: calibrate on TRAINING weeks only (the test window never
  // influences its own labeling), then relabel every chunk with it.
  let dormantBandPct = adaptiveBand ? null : Math.abs(dormantPct);
  if (adaptiveBand) {
    dormantBandPct = balancedBandPct(trainChunks.map((c) => c.diffPct));
    onProgress(`adaptive band calibrated: ±${dormantBandPct.toFixed(2)}% (training weeks only)`);
    for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, dormantBandPct / 100);
  }

  const featureCount = chunks[0].x.length;
  const ytr = trainChunks.map((c) => c.label);
  const yte = testChunks.map((c) => c.label);
  const trainCounts = classCounts(ytr);

  // Big-move hunter: balanced class weights from TRAINING counts, so the
  // rare ±1 chunks carry as much total loss as the dormant majority and the
  // optimizer can't settle for "always 0". Capped so a nearly-empty class
  // can't dominate. The decision side (directionalCall + tau) is tuned on
  // the validation tail by paper P&L below.
  let classWeights = null;
  if (decision === 'directional') {
    const present = CLASSES.filter((c) => trainCounts[c] > 0);
    classWeights = {};
    for (const c of CLASSES) {
      classWeights[c] = trainCounts[c] > 0 ? Math.min(20, ytr.length / (present.length * trainCounts[c])) : 1;
    }
  }
  const weightsFor = (labels) => (classWeights ? labels.map((l) => classWeights[l]) : null);

  let tuning;
  let finalInfo;
  let predictFn;
  let trainPredictFn; // same model, training rows — scored through the same
  let tau = null; //     decision rule as the test set (see `decide` below)
  let tauLadder = null;
  if (modelKind === 'logreg') {
    onProgress(`standardizing features (${featureCount} per chunk)`);
    const scaler = standardizeFit(trainChunks.map((c) => c.x));
    const Xtr = standardizeApply(trainChunks.map((c) => c.x), scaler);
    const Xte = standardizeApply(testChunks.map((c) => c.x), scaler);
    const { model, ladder, chosenLambda, valSize, valMajorityAcc } = await tuneAndTrain(Xtr, ytr, { onProgress, classWeights });
    if (decision === 'directional') {
      // Honest tau: a probe at the chosen lambda trained on the sub-train
      // only (same split as the ladder), so the validation probabilities the
      // threshold is tuned on were never trained on.
      const nSub = Xtr.length - Math.max(3, Math.round(Xtr.length * 0.25));
      onProgress('tuning directional threshold on the validation tail (paper P&L)');
      const probe = await trainSoftmax(Xtr.slice(0, nSub), ytr.slice(0, nSub), chosenLambda, {
        weights: weightsFor(ytr.slice(0, nSub)),
      });
      const valProbs = [];
      for (let i = nSub; i < Xtr.length; i++) valProbs.push(predict(probe, Xtr[i]).probs);
      ({ tau, tauLadder } = tuneTau(trainChunks.slice(nSub), valProbs, tradeFilled.map, geo));
    }
    tuning = { model: 'logreg', ladder, chosenLambda, valSize, valMajorityAcc };
    finalInfo = {
      iters: model.iters,
      converged: model.converged,
      trainAcc: accuracy(model, Xtr, ytr),
      topWeights: featureSet === 'compressed' ? topWeights(model, featureNames) : null,
    };
    predictFn = (i) => predict(model, Xte[i]);
    trainPredictFn = (i) => predict(model, Xtr[i]);
  } else {
    // Boosted trees: raw (unstandardized) features — thresholds don't care
    // about scale. Round count is tuned by early stopping on the same
    // chronological validation tail the ladder uses, then the final model
    // retrains on the full training window for exactly bestRound rounds.
    const Xtr = trainChunks.map((c) => c.x);
    const Xte = testChunks.map((c) => c.x);
    const nVal = Math.max(3, Math.round(Xtr.length * 0.25));
    const nSub = Xtr.length - nVal;
    if (nSub < 4) throw new Error(`not enough training chunks (${Xtr.length}) to tune boosting rounds`);
    const ysub = ytr.slice(0, nSub);
    const yval = ytr.slice(nSub);
    const counts = new Map();
    for (const l of ysub) counts.set(l, (counts.get(l) || 0) + 1);
    const majLabel = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // Same scale rule as the logreg ladder: when training is weighted, the
    // prior reference must be weighted too, or boost and logreg specs in one
    // directional screen get graded on different yardsticks.
    const wval = weightsFor(yval);
    const valMajorityAcc = wval
      ? yval.reduce((s, l, i) => s + (l === majLabel ? wval[i] : 0), 0) / wval.reduce((a, b) => a + b, 0)
      : yval.filter((l) => l === majLabel).length / yval.length;

    onProgress('boosting on the sub-train window (early stopping on validation)');
    const probe = await trainBoost(Xtr.slice(0, nSub), ysub, {
      Xval: Xtr.slice(nSub),
      yval,
      weights: weightsFor(ysub),
      valWeights: wval,
      onRound: (r) => { if (r % 10 === 0) onProgress(`boosting round ${r} (validation watch)`); },
    });
    const valAcc = accuracyBoost(probe, Xtr.slice(nSub), yval, wval);
    if (decision === 'directional') {
      // The probe never trained on the validation tail — its probabilities
      // there are honest, so tau tunes on them by paper P&L.
      onProgress('tuning directional threshold on the validation tail (paper P&L)');
      const valProbs = [];
      for (let i = nSub; i < Xtr.length; i++) valProbs.push(predictBoost(probe, Xtr[i]).probs);
      ({ tau, tauLadder } = tuneTau(trainChunks.slice(nSub), valProbs, tradeFilled.map, geo));
    }
    onProgress(`retraining on all ${Xtr.length} training weeks for ${probe.bestRound} rounds`);
    const model = await trainBoost(Xtr, ytr, {
      rounds: probe.bestRound,
      weights: weightsFor(ytr),
      onRound: (r) => { if (r % 10 === 0) onProgress(`final boosting round ${r}/${probe.bestRound}`); },
    });
    tuning = { model: 'boost', bestRound: probe.bestRound, valAcc, valSize: nVal, valMajorityAcc };
    finalInfo = {
      iters: model.bestRound,
      converged: true,
      trainAcc: accuracyBoost(model, Xtr, ytr),
      topWeights: null,
      importance: featureSet === 'compressed' ? importanceTable(model, featureNames) : null,
    };
    predictFn = (i) => predictBoost(model, Xte[i]);
    trainPredictFn = (i) => predictBoost(model, Xtr[i]);
  }

  if (decision === 'directional') {
    Object.assign(tuning, { decision, classWeights, tau, tauLadder });
  }

  onProgress('evaluating the out-of-sample test set');
  // Directional mode: the ACTION is the prediction — every downstream metric
  // (accuracy, confusion, paper, vote books) scores what would be traded.
  const decide = decision === 'directional'
    ? (p) => ({ label: directionalCall(p.probs, tau), probs: p.probs })
    : (p) => p;
  // trainAcc must score the SAME rule as test accuracy, or the two numbers
  // differ by decision rule rather than by fit and the "far above test acc =
  // memorization" reading breaks. Recompute it through `decide` once tau is known.
  if (decision === 'directional') {
    let hit = 0;
    for (let i = 0; i < trainChunks.length; i++) {
      if (decide(trainPredictFn(i)).label === ytr[i]) hit++;
    }
    finalInfo.trainAcc = trainChunks.length ? hit / trainChunks.length : null;
  }
  const testRows = testChunks.map((c, i) => {
    const p = decide(predictFn(i));
    // one-shot paper book over the test window at this geometry's own
    // entry/exit candles (classic = the tracker's Tue 03:00 / Thu 15:00)
    const entryC = tradeFilled.map.get(c.startTs + geo.entryOffsetH * HOUR_MS);
    const exitC = tradeFilled.map.get(c.startTs + geo.exitOffsetH * HOUR_MS);
    const entry = entryC ? entryC.open : null;
    const exit = exitC ? exitC.open : null;
    return {
      weekStart: new Date(c.startTs).toISOString().slice(0, 10),
      actual: c.label,
      predicted: p.label,
      probs: p.probs,
      c1: c.c1,
      c2: c.c2,
      diffPct: c.diffPct,
      entry,
      exit,
      paperPnl: entry != null && exit != null ? pnlFor(p.label, entry, exit) : null,
    };
  });
  const pairs = testRows.map((r) => ({ actual: r.actual, predicted: r.predicted }));
  const testAcc = pairs.filter((p) => p.actual === p.predicted).length / pairs.length;

  const priced = testRows.filter((r) => r.paperPnl !== null);
  const paperTrades = priced.filter((r) => r.predicted !== 0);
  const paper = {
    pnl: priced.reduce((s, r) => s + r.paperPnl, 0),
    trades: paperTrades.length,
    wins: paperTrades.filter((r) => r.paperPnl > 0).length,
    priced: priced.length,
    unpriced: testRows.length - priced.length,
  };

  const testCounts = classCounts(yte);
  const majorityClass = CLASSES.reduce((a, b) => (trainCounts[b] > trainCounts[a] ? b : a));
  const majorityBaseline = yte.filter((l) => l === majorityClass).length / yte.length;

  const fmtWeek = (c) => new Date(c.startTs).toISOString().slice(0, 10);
  return {
    params: { dormantPct, tradeSymbol, compareSymbol, startMonth, endMonth, featureSet, model: modelKind, featureView, decision, labelShift, allLoaded, geometry, weekdaysOnly },
    data: {
      dormantBandPct,
      adaptiveBand,
      monthsRequested: allLoaded ? Math.max(trade.cachedMonthCount, compare.cachedMonthCount) : months.length,
      missingMonths: { [tradeSymbol]: trade.missing, [compareSymbol]: compare.missing },
      candles: { [tradeSymbol]: trade.rows.length, [compareSymbol]: compare.rows.length },
      gapFills: { [tradeSymbol]: tradeFilled.fills, [compareSymbol]: compareFilled.fills },
      mondaysConsidered: considered,
      chunks: chunks.length,
      dropped,
      featureCount,
      classCounts: classCounts(chunks.map((c) => c.label)),
    },
    split: {
      method: 'chronological',
      train: { count: nTrain, from: fmtWeek(trainChunks[0]), to: fmtWeek(trainChunks[nTrain - 1]), classCounts: trainCounts },
      test: { count: nTest, from: fmtWeek(testChunks[0]), to: fmtWeek(testChunks[nTest - 1]), classCounts: testCounts },
    },
    tuning,
    final: finalInfo,
    test: {
      accuracy: testAcc,
      randomBaseline: 1 / 3,
      majorityClass,
      majorityBaseline,
      confusion: confusionMatrix(pairs),
      perClass: perClassMetrics(pairs),
      paper,
      rows: testRows,
    },
  };
}

// Exact null-shift ceiling for a pair on the currently cached data: count
// the labelable chunks (at the given geometry) and subtract the 16-chunk
// buffer. Used by the UI's "max" button so oversized shift requests aren't
// guesswork.
async function countRotations(tradeSymbol, compareSymbol, onProgress = () => {}, geometry = 'weekly-8d', weekdaysOnly = false, range = null) {
  // The ceiling must be computed over the SAME months the screen will run on.
  // Sizing from the whole cache while the screen honors a short form range
  // quoted ceilings ~40x too high and queued that many pointless runs.
  const months = range && !range.allLoaded && range.startMonth && range.endMonth
    ? monthList(range.startMonth, range.endMonth)
    : null;
  const trade = months ? await loadSymbol(tradeSymbol, months, onProgress) : await loadSymbolAll(tradeSymbol, onProgress);
  const compare = months ? await loadSymbol(compareSymbol, months, onProgress) : await loadSymbolAll(compareSymbol, onProgress);
  if (!trade.rows.length || !compare.rows.length) return { chunks: 0, maxRotations: 0 };
  const tradeFilled = forwardFill(toHourlyMap(trade.rows));
  const compareFilled = forwardFill(toHourlyMap(compare.rows));
  const { chunks } = buildChunks(tradeFilled.map, compareFilled.map, 0, 'compressed', { geometry, weekdaysOnly });
  return { chunks: chunks.length, maxRotations: Math.max(0, chunks.length - 16) };
}

// Map a fractional null-shift request (0..1) onto a pair's own cycle of n
// weeks, keeping an 8-week buffer away from both ends. Distinct fractions
// can collapse to the same integer once n < requested shifts — callers
// group null samples by the DERIVED shift so duplicates never double-count.
function deriveShift(n, frac) {
  const usable = n - 16;
  if (usable < 4) throw new Error(`too few chunks (${n}) for null-shift calibration`);
  return Math.min(n - 1, Math.max(1, 8 + Math.round(frac * usable)));
}

// Compact, comparable metrics from a full report — what the batch screen
// stores per run so pair/model combos can be ranked side by side.
function extractMetrics(report) {
  const t = report.test;
  const perClassRecall = t.perClass.filter((m) => m.recall != null).map((m) => m.recall);
  const balancedAcc = perClassRecall.length ? perClassRecall.reduce((s, v) => s + v, 0) / perClassRecall.length : null;
  let dirCalls = 0;
  let dirHits = 0;
  for (const row of t.rows) {
    if (row.predicted !== 0) {
      dirCalls++;
      if (row.predicted === row.actual) dirHits++;
    }
  }
  // Best CONSTANT guess in hindsight: the strongest prior-only competitor.
  // Under an adaptive band the test class mix can drift far from training's,
  // making the train-majority baseline too easy to "beat" — this one can't
  // be gamed by distribution shift.
  const testCounts = report.split.test.classCounts;
  const bestConstant = Math.max(...Object.values(testCounts)) / report.split.test.count;
  return {
    testAcc: t.accuracy,
    majorityBaseline: t.majorityBaseline,
    majorityClass: t.majorityClass,
    edge: t.accuracy - t.majorityBaseline,
    bestConstant,
    hindsightEdge: t.accuracy - bestConstant,
    balancedAcc,
    balancedEdge: balancedAcc != null ? balancedAcc - 1 / 3 : null,
    directionalCalls: dirCalls,
    directionalHits: dirHits,
    directionalHitRate: dirCalls > 0 ? dirHits / dirCalls : null,
    trainAcc: report.final.trainAcc,
    trainWeeks: report.split.train.count,
    testWeeks: report.split.test.count,
    chunks: report.data.chunks,
    testClassCounts: report.split.test.classCounts,
    chosen: (report.tuning.model === 'boost' ? `rounds=${report.tuning.bestRound}` : `lambda=${report.tuning.chosenLambda}`)
      + (report.tuning.tau != null ? `, tau=${report.tuning.tau}` : ''),
    decision: report.params.decision || 'argmax',
    tau: report.tuning.tau ?? null,
    valMajorityAcc: report.tuning.valMajorityAcc,
    bandPct: report.data.dormantBandPct,
    paperPnl: report.test.paper ? report.test.paper.pnl : null,
    paperTrades: report.test.paper ? report.test.paper.trades : null,
    paperWins: report.test.paper ? report.test.paper.wins : null,
  };
}

// Download/cache the months for both symbols WITHOUT running an analysis —
// the "Load Data" phase. Returns a per-symbol summary for the data-state UI.
async function loadData({ tradeSymbol, compareSymbol, startMonth, endMonth }, onProgress = () => {}) {
  const months = monthList(startMonth, endMonth);
  const out = {};
  for (const symbol of [tradeSymbol, compareSymbol]) {
    const { rows, missing } = await loadSymbol(symbol, months, onProgress);
    out[symbol] = { candles: rows.length, monthsRequested: months.length, missingMonths: missing };
  }
  return out;
}

module.exports = { runAnalysis, loadData, monthList, extractMetrics, deriveShift, countRotations, loadSymbol, loadSymbolAll, MIN_CHUNKS };
