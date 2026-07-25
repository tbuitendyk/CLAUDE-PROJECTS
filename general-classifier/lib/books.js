const fs = require('fs');
const path = require('path');
const { monthlyKlines, dailyKlines, recentKlines, HOUR_MS } = require('./binance');
const { toHourlyMap, forwardFill, buildChunks, balancedBandPct, GEOMETRIES } = require('./dataset');
const { viewIndices } = require('./features');
const { standardizeFit, standardizeApply, tuneAndTrain, predict: predictLogreg } = require('./logreg');
const { trainBoost, predictBoost } = require('./boost');
const { NOTIONAL, FEE_PER_LEG, pnlFor, voteOf, superOf } = require('./paper');

// Generalized live paper-book engine: one machine, many books.
//
// A book is a CONFIG (pair, compare, geometry, band, cutoff, rules, horizon)
// plus its own state file under data/books/. The owner creates books from
// the UI; nothing here requires a new module per book. The two original
// books (lib/tracker.js DOT/AVAX weekly, lib/dogebook.js DOGE daily-3d) are
// frozen protocol and untouched — this engine serves every book after them.
//
// Lifecycle, enforced by code rather than memory:
//   draft     — config chosen, data coverage + would-be band previewed, a
//               generated protocol document rendered. NOTHING trained or
//               frozen; drafts can be edited by discarding and recreating.
//   live      — "Declare & initialize" trains the 8 specs, freezes weights,
//               band and config (a hash is stamped; the engine exposes no
//               mutation path), seeds the backfill, and starts ticking.
//   completed — the declared horizon of LIVE periods has been reached; the
//               verdict window is closed. The book keeps recording, with
//               post-horizon periods flagged, but the verdict never moves.
//   retired   — the owner ended it early. Permanent, reason logged.
//
// Book numbers are assigned at DECLARATION and never reused: each declared
// book is one forward-time lottery ticket, and the number is the honest
// denominator that travels with any future winner.
//
// Labels/settlement reuse buildChunks itself (includeUnlabeled + the frozen
// band), so every geometry — daily point labels AND weekly window labels —
// settles with exactly the pipeline's semantics. Paper trades are always the
// geometry's entry/exit candle opens with $100 notional, $0.50 per leg.

const BOOKS_DIR = path.join(__dirname, '..', 'data', 'books');
const REGISTRY = path.join(BOOKS_DIR, 'registry.json');
const MISSED_AFTER_MS = 72 * HOUR_MS;

const SPECS = [];
for (const view of ['full', 'prices', 'volume', 'cross']) {
  for (const model of ['logreg', 'boost']) SPECS.push({ key: `${view}/${model}`, view, model });
}
const ALLOWED_RULES = ['vote', 'q5', 'q6', 'q7', 'q8'];

function ruleCall(rule, labels) {
  if (rule === 'vote') return voteOf(labels);
  return superOf(labels, Number(rule.slice(1)));
}

function callsFor(predictions, rules) {
  const labels = SPECS.map((s) => predictions[s.key]);
  return Object.fromEntries(rules.map((r) => [r, ruleCall(r, labels)]));
}

// ---- registry / files ----------------------------------------------------------

function readRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  } catch {
    return { declaredCount: 0 };
  }
}

function writeRegistry(reg) {
  fs.mkdirSync(BOOKS_DIR, { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify(reg));
}

function bookFile(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('bad book id');
  return path.join(BOOKS_DIR, `book-${id}.json`);
}

function saveBook(doc) {
  fs.mkdirSync(BOOKS_DIR, { recursive: true });
  fs.writeFileSync(bookFile(doc.id), JSON.stringify(doc));
}

function loadBook(id) {
  try {
    return JSON.parse(fs.readFileSync(bookFile(id), 'utf8'));
  } catch {
    return null;
  }
}

function listBooks() {
  let files = [];
  try {
    files = fs.readdirSync(BOOKS_DIR).filter((f) => f.startsWith('book-') && f.endsWith('.json'));
  } catch {
    return [];
  }
  return files
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

// ---- config validation -----------------------------------------------------------

function validateConfig(raw) {
  const c = raw || {};
  const pair = String(c.pair || '').toUpperCase();
  const compareSymbol = String(c.compareSymbol || 'BTCUSDT').toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(pair)) throw new Error('pair must look like DOTUSDT');
  if (!/^[A-Z0-9]{5,20}$/.test(compareSymbol)) throw new Error('compare pair must look like BTCUSDT');
  if (pair === compareSymbol) throw new Error('pair and compare must differ');
  const geometry = String(c.geometry || 'daily-3d');
  if (!GEOMETRIES[geometry]) throw new Error(`unknown geometry "${geometry}"`);
  const band = c.band === 'auto' || c.band === undefined ? 'auto' : Number(c.band);
  if (band !== 'auto' && (!Number.isFinite(band) || band <= 0 || band >= 50)) {
    throw new Error('band must be "auto" or a percentage between 0 and 50');
  }
  const startMonth = String(c.startMonth || '2019-01');
  if (!/^\d{4}-\d{2}$/.test(startMonth)) throw new Error('startMonth must be YYYY-MM');
  const cutoffStr = String(c.cutoff || defaultCutoff());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffStr)) throw new Error('cutoff must be YYYY-MM-DD');
  const cutoff = Date.parse(`${cutoffStr}T00:00:00Z`);
  if (!Number.isFinite(cutoff)) throw new Error('bad cutoff date');
  if (cutoff > Date.now()) throw new Error('cutoff must be in the past — models may never train on the live era');
  let rules = Array.isArray(c.rules) && c.rules.length ? c.rules.map(String) : [...ALLOWED_RULES];
  rules = [...new Set(rules)];
  for (const r of rules) if (!ALLOWED_RULES.includes(r)) throw new Error(`unknown rule "${r}"`);
  const horizonPeriods = c.horizonPeriods === undefined ? 90 : Number(c.horizonPeriods);
  if (!Number.isInteger(horizonPeriods) || horizonPeriods < 5 || horizonPeriods > 1000) {
    throw new Error('horizonPeriods must be an integer 5..1000');
  }
  const notes = c.notes ? String(c.notes).slice(0, 2000) : '';
  return { pair, compareSymbol, geometry, band, startMonth, cutoff: cutoffStr, cutoffMs: cutoff, rules, horizonPeriods, notes };
}

function defaultCutoff() {
  const n = new Date();
  return `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// ---- declaration document ---------------------------------------------------------

// The protocol the owner reads BEFORE declaring. Stored verbatim in the state
// file at declaration so every book carries its own commitment.
function generateDeclaration(config, preview, bookNumber) {
  const geo = GEOMETRIES[config.geometry];
  const hold = geo.exitOffsetH - geo.entryOffsetH;
  return [
    `PAPER BOOK #${bookNumber} — ${config.pair} ${config.geometry} — pre-registered protocol`,
    ``,
    `Declared before the first live period. This text is the commitment; the numbers are whatever they turn out to be.`,
    ``,
    `Pair: ${config.pair} vs ${config.compareSymbol}, history from ${config.startMonth}.`,
    `Geometry: ${config.geometry} — ${geo.featureHours}h feature chunks, entry at +${geo.entryOffsetH}h, exit at +${geo.exitOffsetH}h (${hold}h hold), ` +
      (geo.labelMode === 'points' ? 'outcomes scored on the two candle opens.' : 'outcomes scored on the Tue/Thu 6h window averages.'),
    `Band: ${config.band === 'auto' ? `adaptive (33rd percentile of training |move|) — froze at ±${preview.bandPct.toFixed(2)}%` : `fixed ±${config.band}%`}, never recomputed.`,
    `Models: 8 specs (full/prices/volume/cross × logreg/boost), trained once on the ${preview.trainChunks} chunks whose outcomes completed before ${config.cutoff}, then frozen. No data from ${config.cutoff} onward influenced them.`,
    `Economics: $${NOTIONAL} per order, $${FEE_PER_LEG.toFixed(2)} per leg. Positions may overlap; implied capital scales with hold length, not $${NOTIONAL}.`,
    ``,
    `Decision rules — declared now, ALL reported, none promotable on live results:`,
    ...config.rules.map((r) => `  ${r}: ${r === 'vote' ? 'majority of the 8 specs, any tie stands aside' : `trade only when ≥${r.slice(1)} of 8 specs call the same direction (absolute count, plurality never fires it)`}`),
    ``,
    `Provenance: a period is LIVE if recorded before its exit candle exists; later recordings are labeled unseen and never count toward the verdict.`,
    `Horizon: ${config.horizonPeriods} live periods. At the horizon the verdict window closes permanently; later data is recorded but flagged post-horizon.`,
    `Nothing may be altered after declaration. An unavoidable change restarts the record as a NEW book with a lineage note.`,
    `This is declared book #${bookNumber}: the count of declared books is the denominator against any future winner.`,
    config.notes ? `` : null,
    config.notes ? `Owner's rationale: ${config.notes}` : null,
  ].filter((l) => l !== null).join('\n');
}

// ---- data assembly (same fallback ladder as the frozen books) ----------------------

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

function settleAfterH(geometry) {
  const geo = GEOMETRIES[geometry];
  // outcome knowable once the exit candle exists (points) or the label
  // windows have closed (weekly): buildChunks label goes non-null then.
  return geo.labelMode === 'points' ? geo.exitOffsetH + 1 : 259; // Thu 18:00 + 1 for weekly
}

function trainCutoffFilter(chunks, geometry, cutoffMs) {
  const after = settleAfterH(geometry);
  return chunks.filter((c) => c.startTs + (after - 1) * HOUR_MS < cutoffMs);
}

// ---- lifecycle: draft ---------------------------------------------------------------

async function createDraft(rawConfig, onProgress = () => {}) {
  const config = validateConfig(rawConfig);
  const compareMap = await fullHourlyMap(config.compareSymbol, config.startMonth, onProgress);
  const tradeMap = await fullHourlyMap(config.pair, config.startMonth, onProgress);
  onProgress('building chunks for the preview');
  const { chunks } = buildChunks(tradeMap, compareMap, 0, 'compressed', { geometry: config.geometry });
  const trainChunks = trainCutoffFilter(chunks, config.geometry, config.cutoffMs);
  if (trainChunks.length < 100) throw new Error(`only ${trainChunks.length} training chunks before cutoff — need at least 100`);
  const bandPct = config.band === 'auto' ? balancedBandPct(trainChunks.map((c) => c.diffPct)) : Math.abs(config.band);

  const wouldBeNumber = readRegistry().declaredCount + 1;
  const preview = { trainChunks: trainChunks.length, totalChunks: chunks.length, bandPct };
  const id = `${config.pair.toLowerCase()}-${config.geometry}-${Date.now().toString(36)}`;
  const doc = {
    id,
    status: 'draft',
    createdAt: new Date().toISOString(),
    config,
    preview,
    wouldBeNumber,
    declaration: generateDeclaration(config, preview, wouldBeNumber),
    bookNumber: null,
    declaredAt: null,
    bandPct: null,
    models: null,
    periods: [],
    lastPrice: null,
    lineage: rawConfig && rawConfig.lineage ? String(rawConfig.lineage) : null,
    amendments: [],
  };
  saveBook(doc);
  return publicView(doc);
}

function discardDraft(id) {
  const doc = loadBook(id);
  if (!doc) throw new Error('unknown book');
  if (doc.status !== 'draft') throw new Error('only drafts can be discarded — live books are retired, not deleted');
  fs.unlinkSync(bookFile(id));
  return { ok: true };
}

// ---- lifecycle: declare & initialize ------------------------------------------------

const N_DAYS_OF = (geometry) => GEOMETRIES[geometry].featureHours / 24;

async function trainSpec(spec, chunks, nDays) {
  const idx = viewIndices(spec.view, nDays);
  const X = chunks.map((c) => idx.map((i) => c.x[i]));
  const y = chunks.map((c) => c.label);
  if (spec.model === 'logreg') {
    const scaler = standardizeFit(X);
    const Z = standardizeApply(X, scaler);
    const { model, chosenLambda } = await tuneAndTrain(Z, y, { onProgress: () => {} });
    return { kind: 'logreg', view: spec.view, lambda: chosenLambda, f: model.f, W: Array.from(model.W), mean: Array.from(scaler.mean), std: Array.from(scaler.std) };
  }
  const nVal = Math.max(3, Math.round(X.length * 0.25));
  const nSub = X.length - nVal;
  const probe = await trainBoost(X.slice(0, nSub), y.slice(0, nSub), { Xval: X.slice(nSub), yval: y.slice(nSub) });
  const model = await trainBoost(X, y, { rounds: probe.bestRound });
  return { kind: 'boost', view: spec.view, rounds: model.bestRound, priors: model.priors, trees: model.trees };
}

function predictSpec(saved, xFull, nDays) {
  const idx = viewIndices(saved.view, nDays);
  const x = idx.map((i) => xFull[i]);
  if (saved.kind === 'logreg') {
    const z = new Float64Array(x.length);
    for (let j = 0; j < x.length; j++) z[j] = (x[j] - saved.mean[j]) / saved.std[j];
    return predictLogreg({ W: Float64Array.from(saved.W), f: saved.f }, z).label;
  }
  return predictBoost({ priors: saved.priors, trees: saved.trees }, x).label;
}

async function declare(id, onProgress = () => {}) {
  const doc = loadBook(id);
  if (!doc) throw new Error('unknown book');
  if (doc.status !== 'draft') throw new Error(`book is ${doc.status} — only drafts can be declared`);

  const config = doc.config;
  const nDays = N_DAYS_OF(config.geometry);
  const compareMap = await fullHourlyMap(config.compareSymbol, config.startMonth, onProgress);
  const tradeMap = await fullHourlyMap(config.pair, config.startMonth, onProgress);
  const { chunks } = buildChunks(tradeMap, compareMap, 0, 'compressed', { geometry: config.geometry });
  const trainChunks = trainCutoffFilter(chunks, config.geometry, config.cutoffMs);
  if (trainChunks.length < 100) throw new Error(`only ${trainChunks.length} training chunks before cutoff`);

  const bandPct = config.band === 'auto' ? balancedBandPct(trainChunks.map((c) => c.diffPct)) : Math.abs(config.band);
  const { scoreDiff } = require('./dataset');
  for (const c of trainChunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);

  const models = {};
  for (const spec of SPECS) {
    onProgress(`freezing ${spec.key} (${trainChunks.length} training chunks)`);
    models[spec.key] = await trainSpec(spec, trainChunks, nDays);
  }

  // the ticket is purchased exactly here — number assigned, never reused
  const reg = readRegistry();
  reg.declaredCount += 1;
  writeRegistry(reg);

  doc.status = 'live';
  doc.bookNumber = reg.declaredCount;
  doc.declaredAt = new Date().toISOString();
  doc.bandPct = bandPct;
  doc.trainChunks = trainChunks.length;
  doc.models = models;
  doc.declaration = generateDeclaration(config, { ...doc.preview, bandPct, trainChunks: trainChunks.length }, doc.bookNumber);
  saveBook(doc);
  onProgress('frozen — seeding the record since cutoff');
  await tickBook(doc, { compareMap, tradeMap }, onProgress);
  return publicView(loadBook(id));
}

function retire(id, reason) {
  const doc = loadBook(id);
  if (!doc) throw new Error('unknown book');
  if (doc.status === 'draft') throw new Error('drafts are discarded, not retired');
  if (doc.status === 'retired') return publicView(doc);
  doc.status = 'retired';
  doc.retiredAt = new Date().toISOString();
  doc.amendments.push({ at: doc.retiredAt, what: `retired by owner${reason ? `: ${String(reason).slice(0, 500)}` : ''}` });
  saveBook(doc);
  return publicView(doc);
}

// ---- the heartbeat ------------------------------------------------------------------

function isLiveRecording(recordedAtMs, chunkStart, geometry) {
  const geo = GEOMETRIES[geometry];
  const outcomeAtH = geo.labelMode === 'points' ? geo.exitOffsetH : 252; // Thu 12:00 for weekly, per TRACKER.md
  return recordedAtMs < chunkStart + outcomeAtH * HOUR_MS;
}

let ticking = false;

async function tickBook(doc, maps, onProgress = () => {}) {
  const config = doc.config;
  const geo = GEOMETRIES[config.geometry];
  const nDays = N_DAYS_OF(config.geometry);
  const now = Date.now();
  const after = settleAfterH(config.geometry);

  // Labels come from buildChunks itself at the FROZEN band, so settlement
  // semantics are exactly the pipeline's for every geometry.
  const { chunks } = buildChunks(maps.tradeMap, maps.compareMap, doc.bandPct, 'compressed', {
    geometry: config.geometry,
    includeUnlabeled: true,
  });
  const byStart = new Map(chunks.map((c) => [c.startTs, c]));

  for (const c of chunks) {
    if (c.startTs + (after - 1) * HOUR_MS < config.cutoffMs) continue;
    if (doc.periods.some((p) => p.chunkStart === c.startTs)) continue;
    const predictions = {};
    for (const spec of SPECS) predictions[spec.key] = predictSpec(doc.models[spec.key], c.x, nDays);
    doc.periods.push({
      chunkStart: c.startTs,
      dayOf: new Date(c.startTs).toISOString().slice(0, 10),
      predictions,
      calls: callsFor(predictions, config.rules),
      recordedAt: new Date(now).toISOString(),
      live: isLiveRecording(now, c.startTs, config.geometry),
      entryTs: c.startTs + geo.entryOffsetH * HOUR_MS,
      exitTs: c.startTs + geo.exitOffsetH * HOUR_MS,
      entry: null,
      exit: null,
      actual: null,
      status: 'pending',
      pnl: null,
    });
  }

  let lastTs = 0;
  for (const ts of maps.tradeMap.keys()) if (ts > lastTs) lastTs = ts;
  if (lastTs) doc.lastPrice = { price: maps.tradeMap.get(lastTs).close, at: new Date(lastTs).toISOString() };

  for (const p of doc.periods.filter((x) => x.status === 'pending')) {
    if (p.entry == null && now >= p.entryTs) {
      const ec = maps.tradeMap.get(p.entryTs);
      if (ec) p.entry = ec.open;
    }
    if (now < p.chunkStart + after * HOUR_MS) continue;
    const entryCandle = p.entry != null ? { open: p.entry } : maps.tradeMap.get(p.entryTs);
    const exitCandle = maps.tradeMap.get(p.exitTs);
    const chunk = byStart.get(p.chunkStart);
    if (!entryCandle || !exitCandle || !chunk || chunk.label === null) {
      if (now > p.exitTs + MISSED_AFTER_MS) {
        p.status = 'missed';
        p.pnl = Object.fromEntries([...Object.keys(p.predictions), ...config.rules].map((k) => [k, 0]));
      }
      continue;
    }
    p.entry = entryCandle.open;
    p.exit = exitCandle.open;
    p.pnl = {};
    for (const [k, call] of Object.entries(p.predictions)) p.pnl[k] = pnlFor(call, p.entry, p.exit);
    for (const r of config.rules) p.pnl[r] = pnlFor(p.calls[r], p.entry, p.exit);
    p.actual = chunk.label;
    p.status = 'settled';
  }

  doc.periods.sort((a, b) => a.chunkStart - b.chunkStart);

  // horizon check: the verdict window closes at N live periods, permanently
  const liveDone = doc.periods.filter((p) => p.live && p.status !== 'pending').length;
  if (doc.status === 'live' && liveDone >= config.horizonPeriods) {
    doc.status = 'completed';
    doc.completedAt = new Date().toISOString();
    doc.amendments.push({ at: doc.completedAt, what: `horizon reached: ${liveDone} live periods — verdict window closed` });
  }
  if (doc.status === 'completed') {
    for (const p of doc.periods) {
      if (p.postHorizon === undefined) p.postHorizon = false;
    }
    // flag anything recorded after completion
    const doneAt = Date.parse(doc.completedAt);
    for (const p of doc.periods) if (Date.parse(p.recordedAt) > doneAt) p.postHorizon = true;
  }

  saveBook(doc);
  onProgress(`${doc.id}: ${doc.periods.length} periods, ${liveDone} live settled`);
}

// One pass over every book that still ticks; hourly maps fetched once per
// symbol per pass no matter how many books share a pair.
async function tick(onProgress = () => {}) {
  if (ticking) return;
  ticking = true;
  try {
    const books = listBooks().filter((b) => b.status === 'live' || b.status === 'completed');
    if (!books.length) return;
    const symbols = new Set();
    for (const b of books) {
      symbols.add(b.config.pair);
      symbols.add(b.config.compareSymbol);
    }
    const maps = {};
    for (const s of symbols) maps[s] = await fullHourlyMap(s, '2026-01', onProgress);
    for (const b of books) {
      try {
        await tickBook(b, { tradeMap: maps[b.config.pair], compareMap: maps[b.config.compareSymbol] }, onProgress);
      } catch (err) {
        onProgress(`tick failed for ${b.id}: ${err.message}`);
      }
    }
  } finally {
    ticking = false;
  }
}

// ---- status for the UI ---------------------------------------------------------------

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

function publicView(doc) {
  if (!doc) return null;
  const settled = doc.periods.filter((p) => p.status === 'settled' && !p.postHorizon);
  const rules = {};
  for (const r of doc.config.rules) rules[r] = bookStats(settled, (p) => p.calls[r], r);
  return {
    id: doc.id,
    status: doc.status,
    bookNumber: doc.bookNumber,
    wouldBeNumber: doc.wouldBeNumber,
    createdAt: doc.createdAt,
    declaredAt: doc.declaredAt,
    completedAt: doc.completedAt || null,
    retiredAt: doc.retiredAt || null,
    config: doc.config,
    preview: doc.preview,
    declaration: doc.declaration,
    bandPct: doc.bandPct,
    trainChunks: doc.trainChunks || (doc.preview && doc.preview.trainChunks) || null,
    lastPrice: doc.lastPrice,
    liveCount: doc.periods.filter((p) => p.live).length,
    horizonDone: doc.periods.filter((p) => p.live && p.status !== 'pending' && !p.postHorizon).length,
    rules,
    amendments: doc.amendments,
    lineage: doc.lineage,
    periods: doc.periods.map((p) => ({
      dayOf: p.dayOf,
      calls: p.calls,
      predictions: p.predictions,
      actual: p.actual,
      entry: p.entry,
      exit: p.exit,
      pnl: p.pnl,
      status: p.status,
      live: p.live,
      postHorizon: !!p.postHorizon,
    })),
  };
}

function statusAll() {
  const books = listBooks();
  return {
    declaredCount: readRegistry().declaredCount,
    books: books.map((b) => publicView(b)),
  };
}

async function refreshPrices(onProgress = () => {}) {
  // light refresh: recent candles per live pair, fill knowable entries
  const books = listBooks().filter((b) => b.status === 'live' || b.status === 'completed');
  const now = Date.now();
  const byPair = new Map();
  for (const b of books) {
    if (!byPair.has(b.config.pair)) byPair.set(b.config.pair, []);
    byPair.get(b.config.pair).push(b);
  }
  for (const [pair, group] of byPair) {
    let rows = [];
    try {
      rows = await recentKlines(pair, now - 8 * 24 * HOUR_MS);
    } catch {
      for (let ts = now - 8 * 24 * HOUR_MS; ts < now; ts += 24 * HOUR_MS) {
        const d = new Date(ts);
        try {
          const dayRows = await dailyKlines(pair, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
          if (dayRows) for (const r of dayRows) rows.push(r);
        } catch (err) {
          onProgress(`daily fetch failed for ${pair}: ${err.message}`);
        }
      }
    }
    if (!rows.length) continue;
    const last = rows[rows.length - 1];
    const byTs = new Map(rows.map((r) => [r.ts, r]));
    for (const b of group) {
      if (!b.lastPrice || Date.parse(b.lastPrice.at) < last.ts) {
        b.lastPrice = { price: last.close, at: new Date(last.ts).toISOString() };
      }
      for (const p of b.periods.filter((x) => x.status === 'pending')) {
        if (p.entry == null && now >= p.entryTs) {
          const c = byTs.get(p.entryTs);
          if (c) p.entry = c.open;
        }
      }
      saveBook(b);
    }
  }
}

module.exports = {
  createDraft,
  discardDraft,
  declare,
  retire,
  tick,
  refreshPrices,
  statusAll,
  publicView,
  loadBook,
  validateConfig,
  generateDeclaration,
  callsFor,
  bookStats,
  settleAfterH,
  isLiveRecording,
  ALLOWED_RULES,
  SPECS,
};
