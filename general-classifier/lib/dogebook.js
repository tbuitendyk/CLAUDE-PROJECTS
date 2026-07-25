const fs = require('fs');
const path = require('path');
const { monthlyKlines, dailyKlines, recentKlines, HOUR_MS } = require('./binance');
const { toHourlyMap, forwardFill, buildChunks, scoreDiff, balancedBandPct, GEOMETRIES } = require('./dataset');
const { featureNamesFor, viewIndices } = require('./features');
const { standardizeFit, standardizeApply, tuneAndTrain, predict: predictLogreg } = require('./logreg');
const { trainBoost, predictBoost } = require('./boost');
const { NOTIONAL, FEE_PER_LEG, pnlFor, voteOf, superOf } = require('./paper');

// SECOND live paper book — DOGEUSDT on the daily-3d geometry.
// Pre-registered protocol: general-classifier/TRACKER-DOGE.md
//
// Deliberately a SEPARATE module with its own state file. lib/tracker.js
// carries the frozen DOT/AVAX weekly record and is not touched by anything
// here; the two books share only the paper-trade primitives in lib/paper.js,
// so a dollar means the same thing in both. Some helpers below duplicate
// tracker.js rather than refactoring it — that duplication is the price of
// guaranteeing the frozen record cannot be perturbed.
//
//   * Geometry: daily-3d. A chunk is 72h of hourly candles stepping one day,
//     so a new prediction exists EVERY day. Entry = +73h (01:00 the day after
//     the chunk closes), exit = +114h (18:00 the following day) — a 41-hour
//     hold, both prices single candle OPENS.
//   * Frozen models: the same 8-spec consensus grid (4 views x logreg/boost)
//     trained ONCE on every chunk whose outcome completed before the cutoff.
//     Weights persist on disk and are never retrained.
//   * Books, ALL declared in advance and ALL reported: the majority vote
//     (ties stand aside) plus the agreement gradient at quorums 5, 6, 7 and
//     8 of 8. Reporting every rung is what makes this free of selection bias:
//     nothing is chosen after the fact, so no multiplicity correction is owed.
//     The backtest's best rung was 7 of 8 and the pre-registered backtest rung
//     was 6 of 8; forward data adjudicates, and both claims are on the record.
//   * Paper trades: $100 notional per order, $0.50 friction per leg. Positions
//     overlap — a new signal each day against a 41-hour hold means up to two
//     concurrent positions, so the book's capital assumption is ~$200-300, not
//     $100. P&L simply sums; no compounding, no position sizing.

const STATE_FILE = path.join(__dirname, '..', 'data', 'dogebook', 'state.json');
const GEOMETRY = 'daily-3d';
const GEO = GEOMETRIES[GEOMETRY];
const SETTLE_AFTER_H = GEO.exitOffsetH + 1; // exit candle exists and the outcome is knowable
const MISSED_AFTER_MS = 72 * HOUR_MS; // laggy daily zips get 3 days before a period is unmeasurable
const QUORUMS = [5, 6, 7, 8];

const SPECS = [];
for (const view of ['full', 'prices', 'volume', 'cross']) {
  for (const model of ['logreg', 'boost']) SPECS.push({ key: `${view}/${model}`, view, model });
}

// LIVE provenance, same principle as TRACKER.md's amendment: a prediction is
// live when it was recorded before its OUTCOME could be known — i.e. before
// the exit candle. The guarantee is determinism (frozen weights + published
// candles), with the record required to exist before the result does. Note
// the entry candle (+73h) typically precedes the arrival of the bulk-portal
// data the prediction is computed from, so entry-time execution is an
// assumption of the paper book, not a claim this infrastructure can prove.
function isLive(recordedAtMs, chunkStart) {
  return recordedAtMs < chunkStart + GEO.exitOffsetH * HOUR_MS;
}

let state = null;
let ticking = false;

function loadState() {
  if (state) return state;
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    state = null;
  }
  return state;
}

function saveState() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

function initialized() {
  return !!loadState();
}

// ---- data assembly -----------------------------------------------------------

async function fullHourlyMap(symbol, startMonth, onProgress) {
  const rows = [];
  const now = new Date();
  let [y, m] = startMonth.split('-').map(Number);
  const curY = now.getUTCFullYear();
  const curM = now.getUTCMonth() + 1;
  while (y < curY || (y === curY && m < curM)) {
    onProgress(`loading ${symbol} ${y}-${String(m).padStart(2, '0')}`);
    const monthRows = await monthlyKlines(symbol, y, m);
    if (monthRows) for (const r of monthRows) rows.push(r);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  const lastTs = rows.length ? rows[rows.length - 1].ts : Date.UTC(curY, curM - 1, 1) - 45 * 24 * HOUR_MS;
  onProgress(`fetching recent ${symbol} candles`);
  try {
    for (const r of await recentKlines(symbol, lastTs + HOUR_MS)) rows.push(r);
  } catch (err) {
    onProgress(`REST mirror unavailable (${err.message}) — using daily zips for ${symbol}`);
    for (let ts = lastTs + 24 * HOUR_MS; ts < Date.now(); ts += 24 * HOUR_MS) {
      const d = new Date(ts);
      const dayRows = await dailyKlines(symbol, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
      if (dayRows) for (const r of dayRows) rows.push(r);
    }
  }
  return forwardFill(toHourlyMap(rows)).map;
}

// ---- model freeze/thaw -------------------------------------------------------

const N_DAYS = GEO.featureHours / 24;

async function trainSpec(spec, chunks) {
  const idx = viewIndices(spec.view, N_DAYS);
  const X = chunks.map((c) => idx.map((i) => c.x[i]));
  const y = chunks.map((c) => c.label);
  if (spec.model === 'logreg') {
    const scaler = standardizeFit(X);
    const Z = standardizeApply(X, scaler);
    const { model, chosenLambda } = await tuneAndTrain(Z, y, { onProgress: () => {} });
    return {
      kind: 'logreg',
      view: spec.view,
      lambda: chosenLambda,
      f: model.f,
      W: Array.from(model.W),
      mean: Array.from(scaler.mean),
      std: Array.from(scaler.std),
    };
  }
  const nVal = Math.max(3, Math.round(X.length * 0.25));
  const nSub = X.length - nVal;
  const probe = await trainBoost(X.slice(0, nSub), y.slice(0, nSub), { Xval: X.slice(nSub), yval: y.slice(nSub) });
  const model = await trainBoost(X, y, { rounds: probe.bestRound });
  return { kind: 'boost', view: spec.view, rounds: model.bestRound, priors: model.priors, trees: model.trees };
}

function predictSpec(saved, xFull) {
  const idx = viewIndices(saved.view, N_DAYS);
  const x = idx.map((i) => xFull[i]);
  if (saved.kind === 'logreg') {
    const z = new Float64Array(x.length);
    for (let j = 0; j < x.length; j++) z[j] = (x[j] - saved.mean[j]) / saved.std[j];
    return predictLogreg({ W: Float64Array.from(saved.W), f: saved.f }, z).label;
  }
  return predictBoost({ priors: saved.priors, trees: saved.trees }, x).label;
}

// Every declared book's call for one period, from the 8 spec predictions.
function callsFor(predictions) {
  const labels = SPECS.map((s) => predictions[s.key]);
  const out = { vote: voteOf(labels) };
  for (const q of QUORUMS) out[`q${q}`] = superOf(labels, q);
  return out;
}

const BOOK_KEYS = ['vote', ...QUORUMS.map((q) => `q${q}`)];

// ---- init ---------------------------------------------------------------------

async function init(params, onProgress = () => {}) {
  if (initialized()) throw new Error('doge book already initialized — remove data/dogebook/state.json to rebuild');
  const {
    pair = 'DOGEUSDT',
    compareSymbol = 'BTCUSDT',
    startMonth = '2019-01',
    cutoff = Date.UTC(2026, 6, 1), // models never see July 2026 or later
  } = params || {};

  const compareMap = await fullHourlyMap(compareSymbol, startMonth, onProgress);
  const tradeMap = await fullHourlyMap(pair, startMonth, onProgress);
  const { chunks } = buildChunks(tradeMap, compareMap, 0, 'compressed', { geometry: GEOMETRY });
  const trainChunks = chunks.filter((c) => c.startTs + (SETTLE_AFTER_H - 1) * HOUR_MS < cutoff);
  if (trainChunks.length < 200) throw new Error(`only ${trainChunks.length} training chunks before cutoff`);

  const bandPct = balancedBandPct(trainChunks.map((c) => c.diffPct));
  for (const c of trainChunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);

  const models = {};
  for (const spec of SPECS) {
    onProgress(`freezing ${spec.key} (${trainChunks.length} training chunks)`);
    models[spec.key] = await trainSpec(spec, trainChunks);
  }

  state = {
    createdAt: new Date().toISOString(),
    config: {
      pair,
      compareSymbol,
      startMonth,
      cutoff,
      geometry: GEOMETRY,
      notional: NOTIONAL,
      feePerLeg: FEE_PER_LEG,
      specs: SPECS.map((s) => s.key),
      books: BOOK_KEYS,
      quorums: QUORUMS,
    },
    bandPct,
    trainChunks: trainChunks.length,
    trainedThrough: new Date(cutoff).toISOString().slice(0, 10),
    featureCount: featureNamesFor(N_DAYS).length,
    models,
    lastPrice: null,
    periods: [],
  };
  saveState();
  onProgress('frozen models saved — seeding the gap since cutoff');
  await tick(onProgress);
  return status();
}

// ---- daily heartbeat -----------------------------------------------------------

async function tick(onProgress = () => {}) {
  const s = loadState();
  if (!s || ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const p of s.periods) p.live = isLive(Date.parse(p.recordedAt), p.chunkStart);

    const compareMap = await fullHourlyMap(s.config.compareSymbol, '2026-01', onProgress);
    const tradeMap = await fullHourlyMap(s.config.pair, '2026-01', onProgress);
    const { chunks } = buildChunks(tradeMap, compareMap, 0, 'compressed', {
      geometry: GEOMETRY,
      includeUnlabeled: true,
    });

    // 1. record predictions for completed post-cutoff chunks not yet seen
    for (const c of chunks) {
      if (c.startTs + (SETTLE_AFTER_H - 1) * HOUR_MS < s.config.cutoff) continue;
      if (s.periods.some((p) => p.chunkStart === c.startTs)) continue;
      const predictions = {};
      for (const spec of SPECS) predictions[spec.key] = predictSpec(s.models[spec.key], c.x);
      const calls = callsFor(predictions);
      s.periods.push({
        chunkStart: c.startTs,
        dayOf: new Date(c.startTs).toISOString().slice(0, 10),
        predictions,
        calls,
        recordedAt: new Date(now).toISOString(),
        live: isLive(now, c.startTs),
        entryTs: c.startTs + GEO.entryOffsetH * HOUR_MS,
        exitTs: c.startTs + GEO.exitOffsetH * HOUR_MS,
        entry: null,
        exit: null,
        actual: null,
        status: 'pending',
        pnl: null,
      });
      onProgress(`${new Date(c.startTs).toISOString().slice(0, 10)}: vote ${calls.vote}, 7/8 ${calls.q7} recorded`);
    }

    let lastTs = 0;
    for (const ts of tradeMap.keys()) if (ts > lastTs) lastTs = ts;
    if (lastTs) s.lastPrice = { price: tradeMap.get(lastTs).close, at: new Date(lastTs).toISOString() };

    // 2. settle pending periods whose exit has passed
    for (const p of s.periods.filter((x) => x.status === 'pending')) {
      if (p.entry == null && now >= p.entryTs) {
        const ec = tradeMap.get(p.entryTs);
        if (ec) p.entry = ec.open;
      }
      if (now < p.chunkStart + SETTLE_AFTER_H * HOUR_MS) continue;
      const entryCandle = p.entry != null ? { open: p.entry } : tradeMap.get(p.entryTs);
      const exitCandle = tradeMap.get(p.exitTs);
      if (!entryCandle || !exitCandle) {
        if (now > p.exitTs + MISSED_AFTER_MS) {
          p.status = 'missed';
          p.pnl = Object.fromEntries([...Object.keys(p.predictions), ...BOOK_KEYS].map((k) => [k, 0]));
        }
        continue;
      }
      p.entry = entryCandle.open;
      p.exit = exitCandle.open;
      p.pnl = {};
      for (const [k, call] of Object.entries(p.predictions)) p.pnl[k] = pnlFor(call, p.entry, p.exit);
      for (const k of BOOK_KEYS) p.pnl[k] = pnlFor(p.calls[k], p.entry, p.exit);
      // Point labels: the same two candle opens the geometry scores on.
      p.actual = scoreDiff((p.exit - p.entry) / p.entry, s.bandPct / 100);
      p.status = 'settled';
    }

    s.periods.sort((a, b) => a.chunkStart - b.chunkStart);
    saveState();
  } finally {
    ticking = false;
  }
}

// On-demand price pull (Refresh button): fills knowable entries, updates the
// floating price. Never throws — stale prices are better than a broken page.
async function refreshPrices(onProgress = () => {}) {
  const s = loadState();
  if (!s) return;
  const now = Date.now();
  let rows = [];
  try {
    rows = await recentKlines(s.config.pair, now - 8 * 24 * HOUR_MS);
  } catch {
    for (let ts = now - 8 * 24 * HOUR_MS; ts < now; ts += 24 * HOUR_MS) {
      const d = new Date(ts);
      try {
        const dayRows = await dailyKlines(s.config.pair, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
        if (dayRows) for (const r of dayRows) rows.push(r);
      } catch (err) {
        onProgress(`daily fetch failed ${d.toISOString().slice(0, 10)}: ${err.message}`);
      }
    }
  }
  if (!rows.length) return;
  const last = rows[rows.length - 1];
  if (!s.lastPrice || Date.parse(s.lastPrice.at) < last.ts) {
    s.lastPrice = { price: last.close, at: new Date(last.ts).toISOString() };
  }
  const byTs = new Map(rows.map((r) => [r.ts, r]));
  for (const p of s.periods.filter((x) => x.status === 'pending')) {
    if (p.entry == null && now >= p.entryTs) {
      const c = byTs.get(p.entryTs);
      if (c) p.entry = c.open;
    }
  }
  saveState();
}

// ---- status for the UI ---------------------------------------------------------

function bookStats(settled, callOf, key) {
  const traded = settled.filter((p) => callOf(p) !== 0);
  const scored = settled.filter((p) => p.actual !== null);
  const pnl = settled.reduce((sum, p) => sum + ((p.pnl && p.pnl[key]) || 0), 0);
  return {
    trades: traded.length,
    wins: traded.filter((p) => p.pnl && p.pnl[key] > 0).length,
    pnl,
    grossPerTrade: traded.length ? (pnl + traded.length) / traded.length : null,
    correct: scored.filter((p) => callOf(p) === p.actual).length,
    scored: scored.length,
  };
}

function status() {
  const s = loadState();
  if (!s) return { initialized: false };
  const settled = s.periods.filter((p) => p.status === 'settled');
  const books = {};
  for (const key of BOOK_KEYS) books[key] = bookStats(settled, (p) => p.calls[key], key);
  const specs = {};
  for (const key of s.config.specs) specs[key] = bookStats(settled, (p) => p.predictions[key], key);
  return {
    initialized: true,
    createdAt: s.createdAt,
    config: s.config,
    bandPct: s.bandPct,
    trainChunks: s.trainChunks,
    trainedThrough: s.trainedThrough,
    featureCount: s.featureCount,
    lastPrice: s.lastPrice || null,
    liveCount: s.periods.filter((p) => p.live).length,
    books,
    specs,
    periods: s.periods.map((p) => ({
      dayOf: p.dayOf,
      calls: p.calls,
      predictions: p.predictions,
      actual: p.actual,
      entry: p.entry,
      exit: p.exit,
      pnl: p.pnl,
      status: p.status,
      live: p.live,
    })),
  };
}

module.exports = {
  init,
  tick,
  refreshPrices,
  status,
  initialized,
  isLive,
  callsFor,
  bookStats,
  SPECS,
  QUORUMS,
  BOOK_KEYS,
  GEOMETRY,
  SETTLE_AFTER_H,
};
