const { monthlyKlines } = require('./binance');
const { toHourlyMap, forwardFill, buildChunks, FEATURE_COUNT } = require('./dataset');
const { CLASSES, standardizeFit, standardizeApply, predict, accuracy, tuneAndTrain } = require('./logreg');

// End-to-end run: download -> prune -> chunk -> score -> train 80% -> test
// 20% -> report. Split is CHRONOLOGICAL: the test set is the most recent
// fifth of the weeks, the honest simulation of training on the past and
// predicting the future.

const MIN_CHUNKS = 12;

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
  const rows = [];
  const missing = [];
  for (const { year, month } of months) {
    const mm = `${year}-${String(month).padStart(2, '0')}`;
    onProgress(`downloading ${symbol} ${mm}`);
    const monthRows = await monthlyKlines(symbol, year, month);
    if (monthRows === null) missing.push(mm);
    else for (const r of monthRows) rows.push(r); // no spread-push: keeps arg counts off the call stack
  }
  return { rows, missing };
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

async function runAnalysis(params, onProgress = () => {}) {
  const { dormantPct, tradeSymbol, compareSymbol, startMonth, endMonth } = params;
  const months = monthList(startMonth, endMonth);

  const trade = await loadSymbol(tradeSymbol, months, onProgress);
  const compare = await loadSymbol(compareSymbol, months, onProgress);
  if (trade.rows.length === 0) throw new Error(`no data for ${tradeSymbol} in that range — is the pair listed on Binance spot?`);
  if (compare.rows.length === 0) throw new Error(`no data for ${compareSymbol} in that range — is the pair listed on Binance spot?`);

  onProgress('building 8-day chunks and scoring them');
  const tradeFilled = forwardFill(toHourlyMap(trade.rows));
  const compareFilled = forwardFill(toHourlyMap(compare.rows));
  const { chunks, dropped, considered } = buildChunks(tradeFilled.map, compareFilled.map, dormantPct);

  if (chunks.length < MIN_CHUNKS) {
    throw new Error(
      `only ${chunks.length} labelable chunks in that range (need at least ${MIN_CHUNKS}) — widen the month range`
    );
  }

  const nTest = Math.max(2, Math.round(chunks.length * 0.2));
  const nTrain = chunks.length - nTest;
  const trainChunks = chunks.slice(0, nTrain);
  const testChunks = chunks.slice(nTrain);

  onProgress(`standardizing features (${FEATURE_COUNT} per chunk)`);
  const scaler = standardizeFit(trainChunks.map((c) => c.x));
  const Xtr = standardizeApply(trainChunks.map((c) => c.x), scaler);
  const Xte = standardizeApply(testChunks.map((c) => c.x), scaler);
  const ytr = trainChunks.map((c) => c.label);
  const yte = testChunks.map((c) => c.label);

  const { model, ladder, chosenLambda, valSize } = await tuneAndTrain(Xtr, ytr, { onProgress });

  onProgress('evaluating the out-of-sample test set');
  const testRows = testChunks.map((c, i) => {
    const p = predict(model, Xte[i]);
    return {
      weekStart: new Date(c.startTs).toISOString().slice(0, 10),
      actual: c.label,
      predicted: p.label,
      probs: p.probs,
      c1: c.c1,
      c2: c.c2,
      diffPct: c.diffPct,
    };
  });
  const pairs = testRows.map((r) => ({ actual: r.actual, predicted: r.predicted }));
  const testAcc = pairs.filter((p) => p.actual === p.predicted).length / pairs.length;

  const trainCounts = classCounts(ytr);
  const testCounts = classCounts(yte);
  const majorityClass = CLASSES.reduce((a, b) => (trainCounts[b] > trainCounts[a] ? b : a));
  const majorityBaseline = yte.filter((l) => l === majorityClass).length / yte.length;

  const fmtWeek = (c) => new Date(c.startTs).toISOString().slice(0, 10);
  return {
    params: { dormantPct, tradeSymbol, compareSymbol, startMonth, endMonth },
    data: {
      monthsRequested: months.length,
      missingMonths: { [tradeSymbol]: trade.missing, [compareSymbol]: compare.missing },
      candles: { [tradeSymbol]: trade.rows.length, [compareSymbol]: compare.rows.length },
      gapFills: { [tradeSymbol]: tradeFilled.fills, [compareSymbol]: compareFilled.fills },
      mondaysConsidered: considered,
      chunks: chunks.length,
      dropped,
      featureCount: FEATURE_COUNT,
      classCounts: classCounts(chunks.map((c) => c.label)),
    },
    split: {
      method: 'chronological',
      train: { count: nTrain, from: fmtWeek(trainChunks[0]), to: fmtWeek(trainChunks[nTrain - 1]), classCounts: trainCounts },
      test: { count: nTest, from: fmtWeek(testChunks[0]), to: fmtWeek(testChunks[nTest - 1]), classCounts: testCounts },
    },
    tuning: { ladder, chosenLambda, valSize },
    final: {
      iters: model.iters,
      converged: model.converged,
      trainAcc: accuracy(model, Xtr, ytr),
    },
    test: {
      accuracy: testAcc,
      randomBaseline: 1 / 3,
      majorityClass,
      majorityBaseline,
      confusion: confusionMatrix(pairs),
      perClass: perClassMetrics(pairs),
      rows: testRows,
    },
  };
}

module.exports = { runAnalysis, monthList, MIN_CHUNKS };
