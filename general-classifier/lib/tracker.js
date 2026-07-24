const fs = require('fs');
const path = require('path');
const { monthlyKlines, dailyKlines, recentKlines, HOUR_MS } = require('./binance');
const { toHourlyMap, forwardFill, buildChunks, scoreDiff, balancedBandPct, TUE_OFFSET_H, THU_OFFSET_H, LABEL_HOURS } = require('./dataset');
const { FEATURE_NAMES, viewIndices } = require('./features');
const { standardizeFit, standardizeApply, trainSoftmax, tuneAndTrain, predict: predictLogreg } = require('./logreg');
const { trainBoost, predictBoost } = require('./boost');

// Live paper tracker (pre-registered protocol in general-classifier/TRACKER.md):
//
//   * Frozen models: for each tracked pair, the full 8-spec consensus grid
//     (4 feature views x logreg/boost) trained ONCE on all chunks whose
//     label windows completed before the cutoff (end of the OOS data era).
//     Weights persist on disk; they are never retrained.
//   * Every completed Mon->Mon chunk after the cutoff gets the 8 spec
//     predictions plus a majority VOTE (ties -> 0 / no trade), recorded with
//     a timestamp. Predictions recorded before their entry time are LIVE;
//     anything recorded later (the catch-up seed from cutoff to now, or a
//     week missed while the service was down) is flagged SEEDED.
//   * Paper trades: $100 notional per order, market orders at the TIME
//     midpoint of each window — entry = Tuesday 03:00 open, exit = Thursday
//     15:00 open — with $0.50 friction per leg ($1.00 round trip).
//     vote +1 -> long, -1 -> short, 0 -> no trade. Each of the 8 specs also
//     keeps its own $100 paper book for comparison.

const { NOTIONAL, FEE_PER_LEG, ENTRY_OFFSET_H, EXIT_OFFSET_H, pnlFor } = require('./paper');

const STATE_FILE = path.join(__dirname, '..', 'data', 'tracker', 'state.json');
const SETTLE_AFTER_H = THU_OFFSET_H + LABEL_HOURS + 1; // Thu 18:00+: exit price AND actual label knowable
const MISSED_AFTER_MS = 72 * HOUR_MS; // give laggy data 3 days before declaring a week unmeasurable

const SPECS = [];
for (const view of ['full', 'prices', 'volume', 'cross']) {
  for (const model of ['logreg', 'boost']) SPECS.push({ key: `${view}/${model}`, view, model });
}

// LIVE provenance (TRACKER.md, amended 2026-07-23 pre-live): a prediction is
// live if recorded before its outcome window opens (Thu 12:00 UTC). The
// guarantee is determinism — frozen weights + published candles — with the
// record required to exist before the outcome does.
function isLive(recordedAtMs, chunkStart) {
  return recordedAtMs < chunkStart + THU_OFFSET_H * HOUR_MS;
}

let state = null; // lazy-loaded singleton
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

// Hourly map for a symbol: cached monthly zips through the last published
// month + the REST mirror for everything after. Gap-filled like the pipeline.
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
    // REST mirror unreachable from this network: fall back to the bulk
    // portal's DAILY zips (~1 day behind — predictions may land as seeded
    // instead of live, but the record never goes missing).
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

async function trainSpec(spec, chunks, onProgress) {
  const idx = viewIndices(spec.view);
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
  // boost: pick rounds on the chronological tail, retrain in full
  const nVal = Math.max(3, Math.round(X.length * 0.25));
  const nSub = X.length - nVal;
  const probe = await trainBoost(X.slice(0, nSub), y.slice(0, nSub), { Xval: X.slice(nSub), yval: y.slice(nSub) });
  const model = await trainBoost(X, y, { rounds: probe.bestRound });
  return { kind: 'boost', view: spec.view, rounds: model.bestRound, priors: model.priors, trees: model.trees };
}

function predictSpec(saved, x44) {
  const idx = viewIndices(saved.view);
  const x = idx.map((i) => x44[i]);
  if (saved.kind === 'logreg') {
    const z = new Float64Array(x.length);
    for (let j = 0; j < x.length; j++) z[j] = (x[j] - saved.mean[j]) / saved.std[j];
    return predictLogreg({ W: Float64Array.from(saved.W), f: saved.f }, z).label;
  }
  return predictBoost({ priors: saved.priors, trees: saved.trees }, x).label;
}

function voteOf(predictions) {
  const counts = { '-1': 0, 0: 0, 1: 0 };
  for (const p of Object.values(predictions)) counts[p]++;
  const top = Math.max(counts['-1'], counts['0'], counts['1']);
  const winners = Object.keys(counts).filter((k) => counts[k] === top);
  return winners.length === 1 ? Number(winners[0]) : 0; // any tie -> stand aside
}

// ---- init ---------------------------------------------------------------------

async function init(params, onProgress = () => {}) {
  if (initialized()) throw new Error('tracker already initialized — remove data/tracker/state.json to rebuild');
  const {
    pairs = ['DOTUSDT', 'AVAXUSDT'],
    compareSymbol = 'BTCUSDT',
    startMonth = '2018-01',
    cutoff = Date.UTC(2026, 6, 1), // end of the OOS data era: models never see July 2026+
  } = params || {};

  const compareMap = await fullHourlyMap(compareSymbol, startMonth, onProgress);
  const doc = {
    createdAt: new Date().toISOString(),
    config: { pairs, compareSymbol, startMonth, cutoff, notional: NOTIONAL, feePerLeg: FEE_PER_LEG, specs: SPECS.map((s) => s.key) },
    pairs: {},
    weeks: [],
  };

  for (const pair of pairs) {
    const tradeMap = await fullHourlyMap(pair, startMonth, onProgress);
    const { chunks } = buildChunks(tradeMap, compareMap, 0, 'compressed');
    const trainChunks = chunks.filter((c) => c.startTs + (SETTLE_AFTER_H - 1) * HOUR_MS < cutoff);
    if (trainChunks.length < 50) throw new Error(`${pair}: only ${trainChunks.length} training chunks before cutoff`);
    const bandPct = balancedBandPct(trainChunks.map((c) => c.diffPct));
    for (const c of trainChunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);

    const models = {};
    for (const spec of SPECS) {
      onProgress(`${pair}: freezing ${spec.key} (${trainChunks.length} training weeks)`);
      models[spec.key] = await trainSpec(spec, trainChunks, onProgress);
    }
    doc.pairs[pair] = { bandPct, trainWeeks: trainChunks.length, trainedThrough: new Date(cutoff).toISOString().slice(0, 10), models };
  }

  state = doc;
  saveState();
  onProgress('frozen models saved — seeding the gap since cutoff');
  await tick(onProgress);
  return status();
}

// ---- the weekly heartbeat ------------------------------------------------------

async function tick(onProgress = () => {}) {
  const s = loadState();
  if (!s || ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    // Idempotent provenance migration: recompute every stored week's live
    // flag from its recorded timestamp under the current TRACKER.md rule.
    for (const w of s.weeks) w.live = isLive(Date.parse(w.recordedAt), w.chunkStart);
    const compareMap = await fullHourlyMap(s.config.compareSymbol, '2026-01', onProgress);
    for (const pair of s.config.pairs) {
      const pairCfg = s.pairs[pair];
      const tradeMap = await fullHourlyMap(pair, '2026-01', onProgress);
      const { chunks } = buildChunks(tradeMap, compareMap, 0, 'compressed', { includeUnlabeled: true });

      // 1. record predictions for completed post-cutoff chunks we haven't seen
      for (const c of chunks) {
        const isPost = c.startTs + (SETTLE_AFTER_H - 1) * HOUR_MS >= s.config.cutoff;
        if (!isPost) continue;
        if (s.weeks.some((w) => w.pair === pair && w.chunkStart === c.startTs)) continue;
        const predictions = {};
        for (const spec of SPECS) predictions[spec.key] = predictSpec(pairCfg.models[spec.key], c.x);
        const entryTs = c.startTs + ENTRY_OFFSET_H * HOUR_MS;
        s.weeks.push({
          pair,
          chunkStart: c.startTs,
          weekOf: new Date(c.startTs).toISOString().slice(0, 10),
          predictions,
          vote: voteOf(predictions),
          recordedAt: new Date(now).toISOString(),
          live: isLive(now, c.startTs),
          entryTs,
          exitTs: c.startTs + EXIT_OFFSET_H * HOUR_MS,
          entry: null,
          exit: null,
          actual: null,
          status: 'pending',
          pnl: null,
        });
        onProgress(`${pair} ${new Date(c.startTs).toISOString().slice(0, 10)}: vote ${voteOf(predictions)} recorded`);
      }

      // latest known price for the pair (the in-progress hourly candle) —
      // shown italic in the UI as the floating exit for pending positions
      let lastTs = 0;
      for (const ts of tradeMap.keys()) if (ts > lastTs) lastTs = ts;
      if (lastTs) pairCfg.lastPrice = { price: tradeMap.get(lastTs).close, at: new Date(lastTs).toISOString() };

      // 2. settle pending weeks whose exit window has passed (filling the
      // actual entry price as soon as its candle exists, pre-settlement)
      for (const w of s.weeks.filter((x) => x.pair === pair && x.status === 'pending')) {
        if (w.entry == null && now >= w.entryTs) {
          const ec = tradeMap.get(w.entryTs);
          if (ec) w.entry = ec.open;
        }
        if (now < w.chunkStart + SETTLE_AFTER_H * HOUR_MS) continue;
        const entryCandle = w.entry != null ? { open: w.entry } : tradeMap.get(w.entryTs);
        const exitCandle = tradeMap.get(w.exitTs);
        if (!entryCandle || !exitCandle) {
          if (now > w.exitTs + MISSED_AFTER_MS) {
            w.status = 'missed';
            w.pnl = Object.fromEntries([...Object.keys(w.predictions), 'vote'].map((k) => [k, 0]));
          }
          continue;
        }
        w.entry = entryCandle.open;
        w.exit = exitCandle.open;
        w.pnl = {};
        for (const [k, p] of Object.entries(w.predictions)) w.pnl[k] = pnlFor(p, w.entry, w.exit);
        w.pnl.vote = pnlFor(w.vote, w.entry, w.exit);
        // actual class, for accuracy bookkeeping (same windows as the pipeline)
        let tueSum = 0;
        let thuSum = 0;
        let have = 0;
        for (let h = 0; h < LABEL_HOURS; h++) {
          const t = tradeMap.get(w.chunkStart + (TUE_OFFSET_H + h) * HOUR_MS);
          const u = tradeMap.get(w.chunkStart + (THU_OFFSET_H + h) * HOUR_MS);
          if (t && u) {
            tueSum += (t.open + t.high + t.low + t.close) / 4;
            thuSum += (u.open + u.high + u.low + u.close) / 4;
            have++;
          }
        }
        if (have === LABEL_HOURS) {
          const diff = (thuSum - tueSum) / tueSum;
          w.actual = scoreDiff(diff, pairCfg.bandPct / 100);
        }
        w.status = 'settled';
      }
    }
    s.weeks.sort((a, b) => a.chunkStart - b.chunkStart || (a.pair < b.pair ? -1 : 1));
    saveState();
  } finally {
    ticking = false;
  }
}

// On-demand price pull (the UI's Refresh button): one REST call per pair
// updates lastPrice and fills any pending entries whose candle now exists.
// Much lighter than a full tick; failures leave prices stale, never break.
async function refreshPrices(onProgress = () => {}) {
  const s = loadState();
  if (!s) return;
  const now = Date.now();
  for (const pair of s.config.pairs) {
    let rows = [];
    try {
      rows = await recentKlines(pair, now - 8 * 24 * HOUR_MS);
    } catch {
      // REST unreachable (geo-blocked from this VPS): bulk portal's daily
      // zips are the freshest source available — typically ~1 day behind.
      for (let ts = now - 8 * 24 * HOUR_MS; ts < now; ts += 24 * HOUR_MS) {
        const d = new Date(ts);
        try {
          const dayRows = await dailyKlines(pair, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
          if (dayRows) for (const r of dayRows) rows.push(r);
        } catch (err) {
          onProgress(`daily fetch failed for ${pair} ${d.toISOString().slice(0, 10)}: ${err.message}`);
        }
      }
    }
    if (!rows.length) continue;
    const last = rows[rows.length - 1];
    if (!s.pairs[pair].lastPrice || Date.parse(s.pairs[pair].lastPrice.at) < last.ts) {
      s.pairs[pair].lastPrice = { price: last.close, at: new Date(last.ts).toISOString() };
    }
    const byTs = new Map(rows.map((r) => [r.ts, r]));
    for (const w of s.weeks.filter((x) => x.pair === pair && x.status === 'pending')) {
      if (w.entry == null && now >= w.entryTs) {
        const c = byTs.get(w.entryTs);
        if (c) w.entry = c.open;
      }
    }
  }
  saveState();
}

// ---- screening reference edges --------------------------------------------------

// Per-spec true edges for a pair from a completed consensus screen's
// unshifted runs, plus their median (the vote row's reference). Pure
// function so it's testable; returns null when the doc has nothing usable.
function refEdgesFromDoc(doc, pair) {
  if (!doc || doc.kind !== 'consensus') return null;
  const specs = {};
  const edges = [];
  for (const r of doc.runs || []) {
    if (r.trade !== pair || r.shift || r.status !== 'done' || !r.metrics) continue;
    const e = r.metrics.hindsightEdge ?? r.metrics.edge;
    if (e === undefined || e === null) continue;
    specs[`${r.view}/${r.model}`] = e;
    edges.push(e);
  }
  if (!edges.length) return null;
  edges.sort((a, b) => a - b);
  const mid = Math.floor(edges.length / 2);
  const median = edges.length % 2 ? edges[mid] : (edges[mid - 1] + edges[mid]) / 2;
  return { specs, median };
}

// Newest completed consensus screen that covers the pair. Display-only
// context (ranking the book table) — never feeds any decision.
function referenceEdges(pair) {
  try {
    const { listBatches, getBatch } = require('./batch');
    for (const b of listBatches()) {
      if (b.status !== 'done') continue;
      const ref = refEdgesFromDoc(getBatch(b.id), pair);
      if (ref) return { ...ref, source: b.id };
    }
  } catch {
    /* reference is optional */
  }
  return null;
}

// ---- status for the UI ---------------------------------------------------------

function status() {
  const s = loadState();
  if (!s) return { initialized: false };
  const perPair = {};
  for (const pair of s.config.pairs) {
    const weeks = s.weeks.filter((w) => w.pair === pair);
    const settled = weeks.filter((w) => w.status === 'settled');
    const books = {};
    for (const key of [...s.config.specs, 'vote']) {
      const get = (w) => (key === 'vote' ? w.vote : w.predictions[key]);
      const traded = settled.filter((w) => get(w) !== 0);
      books[key] = {
        trades: traded.length,
        wins: traded.filter((w) => w.pnl[key] > 0).length,
        pnl: settled.reduce((sum, w) => sum + (w.pnl[key] || 0), 0),
        correct: settled.filter((w) => w.actual !== null && get(w) === w.actual).length,
        scored: settled.filter((w) => w.actual !== null).length,
      };
    }
    perPair[pair] = {
      bandPct: s.pairs[pair].bandPct,
      trainWeeks: s.pairs[pair].trainWeeks,
      trainedThrough: s.pairs[pair].trainedThrough,
      screenRef: referenceEdges(pair),
      lastPrice: s.pairs[pair].lastPrice || null,
      books,
      weeks: weeks.map(({ pair: p, predictions, ...w }) => ({ ...w, specs: predictions })),
    };
  }
  return {
    initialized: true,
    createdAt: s.createdAt,
    config: { ...s.config, cutoffDate: new Date(s.config.cutoff).toISOString().slice(0, 10) },
    pairs: perPair,
  };
}

module.exports = { init, tick, status, initialized, refreshPrices, isLive, voteOf, pnlFor, trainSpec, predictSpec, refEdgesFromDoc, SPECS, NOTIONAL, FEE_PER_LEG };
