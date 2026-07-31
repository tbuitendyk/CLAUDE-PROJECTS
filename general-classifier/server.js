const path = require('path');
const express = require('express');
const { startJob, getJob } = require('./lib/jobs');
const { runAnalysis, loadData, countRotations } = require('./lib/pipeline');
const { GEOMETRIES } = require('./lib/dataset');
const { cacheState, cachedMonths, monthlyKlines } = require('./lib/binance');
const throttle = require('./lib/throttle');
const { configuredSize, createPool } = require('./lib/pool');
const batch = require('./lib/batch');
const tracker = require('./lib/tracker');
const dogebook = require('./lib/dogebook');
const books = require('./lib/books');

// General Classifier web service. Fronted by nginx at
// https://www.buitendyk.ca/classifier/ behind the site's Basic Auth (the
// trailing-slash proxy_pass strips the prefix, so everything here is
// prefix-relative). No auth or AI/API calls in-app: the only outbound
// traffic is Binance bulk-data downloads in lib/binance.js, and training is
// pure local arithmetic in lib/logreg.js.

const PORT = Number(process.env.PORT || 8093);

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;
const GEOMETRY_KEYS = Object.keys(GEOMETRIES); // weekly-8d, daily-1d..daily-4d

app.get('/api/healthz', (req, res) => res.json({ ok: true, cpuPct: throttle.currentCpuPct() }));

// ---- CPU throttle (semi-auto balancer pattern) ------------------------------

// The cap is a PER-WORKER duty cycle, so the machine-wide draw is
// threads x pct. Report the pool size alongside it so the button can say so
// instead of quietly redefining the number the owner has been reading.
app.get('/api/cpu', (req, res) =>
  res.json({ pct: throttle.currentCpuPct(), threads: configuredSize() }));

app.post('/api/cpu', (req, res) => {
  try {
    res.json({ pct: throttle.setCpuPct((req.body || {}).pct), threads: configuredSize() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// WORKER SELF-TEST. The pool is created per job and torn down after it, so
// there is no long-lived set of threads to inspect between runs, and `ps` on
// the host cannot tell the pool's threads apart from any other node thread.
// That left "workers run at nice 19" as a claim in a comment: the one shape of
// bug this codebase keeps producing — instrumentation that fails silently.
//
// So prove it on demand instead. This boots a real pool at the configured
// size, asks each worker for the kernel's own nice value for its thread, and
// tears the pool down. Cost is a few hundred ms of otherwise idle threads, so
// it is safe to run while a job is in flight.
//
// Distinct TIDs matter as much as the nice values: N replies from one worker
// would satisfy a naive check while saying nothing about the other three.
app.get('/api/selftest/workers', async (req, res) => {
  const size = configuredSize();
  const pool = createPool();
  try {
    const settled = await pool.map('ping', Array.from({ length: pool.workers.length || 1 }, () => ({})));
    const rows = settled.filter((r) => r && r.ok).map((r) => r.value);
    const tids = new Set(rows.map((r) => r.tid).filter((t) => t != null));
    const niced = rows.filter((r) => r.nice === 19);
    res.json({
      configuredSize: size,
      workersBooted: pool.workers.length,
      parallel: pool.parallel,
      replies: rows,
      distinctThreads: tids.size,
      // Unverifiable (no procfs) is reported as such rather than as a pass.
      verifiable: rows.every((r) => r.nice != null),
      // Inline fallback runs on the main thread, which SHOULD be nice 0 — so
      // the pass condition only applies when real workers booted.
      ok: pool.parallel
        ? niced.length === rows.length && rows.length > 0 && tids.size === rows.length
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    pool.abort();
  }
});

// ---- data state + load-only phase -------------------------------------------

app.get('/api/data-state', (req, res) => res.json({ symbols: cacheState() }));

app.post('/api/load', (req, res) => {
  const b = req.body || {};
  const tradeSymbol = String(b.tradeSymbol || '').trim().toUpperCase();
  const compareSymbol = String(b.compareSymbol || '').trim().toUpperCase();
  const startMonth = String(b.startMonth || '').trim();
  const endMonth = String(b.endMonth || '').trim();
  if (!SYMBOL_RE.test(tradeSymbol)) return res.status(400).json({ error: 'trade pair must look like ZECUSDT' });
  if (!SYMBOL_RE.test(compareSymbol)) return res.status(400).json({ error: 'compare pair must look like BTCUSDT' });
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) {
    return res.status(400).json({ error: 'months must be YYYY-MM' });
  }
  const jobId = startJob((setProgress) => loadData({ tradeSymbol, compareSymbol, startMonth, endMonth }, setProgress));
  res.json({ jobId });
});

app.post('/api/run', (req, res) => {
  const b = req.body || {};
  const dormantPct = b.dormantPct === 'auto' ? 'auto' : Number(b.dormantPct);
  const tradeSymbol = String(b.tradeSymbol || '').trim().toUpperCase();
  const compareSymbol = String(b.compareSymbol || '').trim().toUpperCase();
  const startMonth = String(b.startMonth || '').trim();
  const endMonth = String(b.endMonth || '').trim();
  const featureSet = String(b.featureSet || 'compressed');

  if (dormantPct !== 'auto' && (!Number.isFinite(dormantPct) || dormantPct <= 0 || dormantPct >= 50)) {
    return res.status(400).json({ error: 'dormant range must be "auto" or a percentage between 0 and 50' });
  }
  const allLoaded = !!b.allLoaded;
  if (!SYMBOL_RE.test(tradeSymbol)) return res.status(400).json({ error: 'trade pair must look like ZECUSDT' });
  if (!SYMBOL_RE.test(compareSymbol)) return res.status(400).json({ error: 'compare pair must look like BTCUSDT' });
  if (tradeSymbol === compareSymbol) return res.status(400).json({ error: 'trade and compare pairs must differ' });
  if (!allLoaded && (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth))) {
    return res.status(400).json({ error: 'months must be YYYY-MM (or check "all loaded data")' });
  }
  if (featureSet !== 'compressed' && featureSet !== 'raw') {
    return res.status(400).json({ error: 'featureSet must be "compressed" or "raw"' });
  }
  const model = String(b.model || 'logreg');
  if (model !== 'logreg' && model !== 'boost') {
    return res.status(400).json({ error: 'model must be "logreg" or "boost"' });
  }
  const featureView = String(b.featureView || 'full');
  if (!['full', 'prices', 'volume', 'cross'].includes(featureView)) {
    return res.status(400).json({ error: 'featureView must be full/prices/volume/cross' });
  }
  const geometry = String(b.geometry || 'weekly-8d');
  if (!GEOMETRY_KEYS.includes(geometry)) {
    return res.status(400).json({ error: `geometry must be one of ${GEOMETRY_KEYS.join('/')}` });
  }
  const decision = String(b.decision || 'argmax');
  if (decision !== 'argmax' && decision !== 'directional') {
    return res.status(400).json({ error: 'decision must be "argmax" or "directional"' });
  }
  const jobId = startJob((setProgress) =>
    runAnalysis({ dormantPct, tradeSymbol, compareSymbol, startMonth, endMonth, featureSet, model, featureView, decision, geometry, weekdaysOnly: !!b.weekdaysOnly, allLoaded }, setProgress)
  );
  res.json({ jobId });
});

// ---- pair-screen batches ----------------------------------------------------

app.post('/api/batch', (req, res) => {
  const b = req.body || {};
  const dormantPct = b.dormantPct === 'auto' ? 'auto' : b.dormantPct === undefined ? 5 : Number(b.dormantPct);
  if (dormantPct !== 'auto' && (!Number.isFinite(dormantPct) || dormantPct <= 0 || dormantPct >= 50)) {
    return res.status(400).json({ error: 'dormant range must be "auto" or a percentage between 0 and 50' });
  }
  for (const m of ['startMonth', 'endMonth']) {
    if (!b.allLoaded && b[m] !== undefined && !/^\d{4}-\d{2}$/.test(String(b[m]))) {
      return res.status(400).json({ error: `${m} must be YYYY-MM` });
    }
  }
  if (b.pairs !== undefined && (!Array.isArray(b.pairs) || b.pairs.some((p) => !SYMBOL_RE.test(String(p))))) {
    return res.status(400).json({ error: 'pairs must be an array of symbols like ETHUSDT' });
  }
  if (b.models !== undefined && (!Array.isArray(b.models) || b.models.some((m) => m !== 'logreg' && m !== 'boost'))) {
    return res.status(400).json({ error: 'models must be an array of "logreg"/"boost"' });
  }
  const batchGeometry = String(b.geometry || 'weekly-8d');
  if (!GEOMETRY_KEYS.includes(batchGeometry)) {
    return res.status(400).json({ error: `geometry must be one of ${GEOMETRY_KEYS.join('/')}` });
  }
  const batchDecision = String(b.decision || 'argmax');
  if (batchDecision !== 'argmax' && batchDecision !== 'directional') {
    return res.status(400).json({ error: 'decision must be "argmax" or "directional"' });
  }
  try {
    const id = batch.startBatch({
      dormantPct,
      startMonth: b.startMonth,
      endMonth: b.endMonth,
      featureSet: b.featureSet === 'raw' ? 'raw' : 'compressed',
      compareSymbol: b.compareSymbol ? String(b.compareSymbol).toUpperCase() : undefined,
      pairs: b.pairs,
      models: b.models,
      geometry: batchGeometry,
      decision: batchDecision,
      weekdaysOnly: !!b.weekdaysOnly,
      allLoaded: !!b.allLoaded,
    });
    res.json({ batchId: id });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// Bracket lab: the execution-permutation sweep (combos × option branches ×
// the OCO bracket menu), slim-then-promote, no nulls in the sweep.
app.post('/api/bracketlab', (req, res) => {
  const b = req.body || {};
  for (const m of ['startMonth', 'endMonth']) {
    if (!b.allLoaded && b[m] !== undefined && !/^\d{4}-\d{2}$/.test(String(b[m]))) {
      return res.status(400).json({ error: `${m} must be YYYY-MM` });
    }
  }
  if (b.universe !== undefined && (!Array.isArray(b.universe) || b.universe.some((p) => !SYMBOL_RE.test(String(p).toUpperCase())))) {
    return res.status(400).json({ error: 'universe must be an array of symbols like DOTUSDT' });
  }
  if (b.set && b.set.band !== undefined && b.set.band !== 'auto') {
    const v = Number(b.set.band);
    if (!Number.isFinite(v) || v <= 0 || v >= 50) return res.status(400).json({ error: 'band must be "auto" or between 0 and 50' });
  }
  try {
    const id = batch.startBracketLab({
      declared: b.declared,
      universe: b.universe ? b.universe.map((p) => String(p).toUpperCase()) : undefined,
      sizes: b.sizes,
      startMonth: b.startMonth,
      endMonth: b.endMonth,
      allLoaded: !!b.allLoaded,
      permute: b.permute,
      set: b.set,
      promoteK: b.promoteK,
      minTrades: b.minTrades,
      trailing: b.trailing,
      holdout: b.holdout,
      edgeScreen: b.edgeScreen,
      labelShiftFrac: b.labelShiftFrac,
      labelShiftReps: b.labelShiftReps,
      labelShiftScope: b.labelShiftScope,
      feePerLeg: b.feePerLeg,
      dMults: b.dMults,
      tHours: b.tHours,
      gates: b.gates,
      entries: b.entries,
      description: b.description,
      label: b.label,
      windowLayout: b.windowLayout,
      interlaceSeed: b.interlaceSeed,
      sharedBand: b.sharedBand,
    });
    res.json({ batchId: id });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.post('/api/bracketlab/:id/select', (req, res) => {
  try {
    const doc = batch.bracketSelect(req.params.id, req.body || {});
    res.json({ ok: true, selection: doc.selection });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bracketlab/:id/confirm', (req, res) => {
  try {
    res.json(batch.startBracketConfirm(req.params.id, (req.body || {}).target || 'best'));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bracketlab/:id/null', (req, res) => {
  try {
    res.json(batch.startBracketNull(req.params.id, (req.body || {}).shifts));
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// Permutation screen: stage 1 of the owner's staged pick workflow — every
// pair × every spec × both training regimes, 0 null shifts by design.
app.post('/api/permscreen', (req, res) => {
  const b = req.body || {};
  for (const m of ['startMonth', 'endMonth']) {
    if (!b.allLoaded && b[m] !== undefined && !/^\d{4}-\d{2}$/.test(String(b[m]))) {
      return res.status(400).json({ error: `${m} must be YYYY-MM` });
    }
  }
  if (b.pairs !== undefined && (!Array.isArray(b.pairs) || !b.pairs.length || b.pairs.some((p) => !SYMBOL_RE.test(String(p).toUpperCase())))) {
    return res.status(400).json({ error: 'pairs must be a non-empty array of symbols like DOTUSDT' });
  }
  const geometry = String(b.geometry || 'weekly-8d');
  if (!GEOMETRY_KEYS.includes(geometry)) {
    return res.status(400).json({ error: `geometry must be one of ${GEOMETRY_KEYS.join('/')}` });
  }
  const decision = String(b.decision || 'argmax');
  if (decision !== 'argmax' && decision !== 'directional') {
    return res.status(400).json({ error: 'decision must be "argmax" or "directional"' });
  }
  const dormant = b.dormantPct === undefined || b.dormantPct === 'auto' ? 'auto' : Number(b.dormantPct);
  if (dormant !== 'auto' && (!Number.isFinite(dormant) || dormant <= 0 || dormant >= 50)) {
    return res.status(400).json({ error: 'dormant range must be "auto" or a percentage between 0 and 50' });
  }
  try {
    const id = batch.startPermScreen({
      startMonth: b.startMonth,
      endMonth: b.endMonth,
      compareSymbol: b.compareSymbol ? String(b.compareSymbol).toUpperCase() : undefined,
      pairs: b.pairs ? b.pairs.map((p) => String(p).toUpperCase()) : undefined,
      geometry,
      decision,
      dormantPct: dormant,
      weekdaysOnly: !!b.weekdaysOnly,
      allLoaded: !!b.allLoaded,
    });
    res.json({ batchId: id });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// Stages 2/3/5: persist the owner's selections (asset -> members -> rungs).
app.post('/api/permscreen/:id/select', (req, res) => {
  try {
    const doc = batch.permSelect(req.params.id, req.body || {});
    res.json({ ok: true, selection: doc.selection, quorums: doc.quorums });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Stage 6: fire the null test over the frozen selection.
app.post('/api/permscreen/:id/null', (req, res) => {
  try {
    res.json(batch.startPermNull(req.params.id, (req.body || {}).shifts));
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.post('/api/consensus', (req, res) => {
  const b = req.body || {};
  for (const m of ['startMonth', 'endMonth']) {
    if (!b.allLoaded && b[m] !== undefined && !/^\d{4}-\d{2}$/.test(String(b[m]))) {
      return res.status(400).json({ error: `${m} must be YYYY-MM` });
    }
  }
  if (b.pairs !== undefined && (!Array.isArray(b.pairs) || !b.pairs.length || b.pairs.some((p) => !SYMBOL_RE.test(String(p).toUpperCase())))) {
    return res.status(400).json({ error: 'pairs must be a non-empty array of symbols like DOTUSDT' });
  }
  const nullShifts = b.nullShifts === undefined ? 0 : Number(b.nullShifts);
  if (!Number.isInteger(nullShifts) || nullShifts < 0 || nullShifts > 1000) {
    return res.status(400).json({ error: 'nullShifts must be an integer 0..1000' });
  }
  const consGeometry = String(b.geometry || 'weekly-8d');
  if (!GEOMETRY_KEYS.includes(consGeometry)) {
    return res.status(400).json({ error: `geometry must be one of ${GEOMETRY_KEYS.join('/')}` });
  }
  const consDecision = String(b.decision || 'argmax');
  if (consDecision !== 'argmax' && consDecision !== 'directional') {
    return res.status(400).json({ error: 'decision must be "argmax" or "directional"' });
  }
  const consDormant = b.dormantPct === undefined || b.dormantPct === 'auto' ? 'auto' : Number(b.dormantPct);
  if (consDormant !== 'auto' && (!Number.isFinite(consDormant) || consDormant <= 0 || consDormant >= 50)) {
    return res.status(400).json({ error: 'dormant range must be "auto" or a percentage between 0 and 50' });
  }
  try {
    const id = batch.startConsensus({
      startMonth: b.startMonth,
      endMonth: b.endMonth,
      compareSymbol: b.compareSymbol ? String(b.compareSymbol).toUpperCase() : undefined,
      pairs: b.pairs ? b.pairs.map((p) => String(p).toUpperCase()) : undefined,
      nullShifts,
      geometry: consGeometry,
      decision: consDecision,
      dormantPct: consDormant,
      weekdaysOnly: !!b.weekdaysOnly,
      allLoaded: !!b.allLoaded,
    });
    res.json({ batchId: id });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// Meta-lens screen: the two-stage protocol (lens selection on half A,
// agreement threshold on half B, verdict on the untouched test window),
// with nulls that replay the whole recipe per rotation.
app.post('/api/metalens', (req, res) => {
  const b = req.body || {};
  for (const m of ['startMonth', 'endMonth']) {
    if (!b.allLoaded && b[m] !== undefined && !/^\d{4}-\d{2}$/.test(String(b[m]))) {
      return res.status(400).json({ error: `${m} must be YYYY-MM` });
    }
  }
  if (b.pairs !== undefined && (!Array.isArray(b.pairs) || !b.pairs.length || b.pairs.some((p) => !SYMBOL_RE.test(String(p).toUpperCase())))) {
    return res.status(400).json({ error: 'pairs must be a non-empty array of symbols like DOTUSDT' });
  }
  const nullShifts = b.nullShifts === undefined ? 0 : Number(b.nullShifts);
  if (!Number.isInteger(nullShifts) || nullShifts < 0 || nullShifts > 1000) {
    return res.status(400).json({ error: 'nullShifts must be an integer 0..1000' });
  }
  const geometry = String(b.geometry || 'daily-3d');
  if (!GEOMETRY_KEYS.includes(geometry)) {
    return res.status(400).json({ error: `geometry must be one of ${GEOMETRY_KEYS.join('/')}` });
  }
  const dormant = b.dormantPct === undefined || b.dormantPct === 'auto' ? 'auto' : Number(b.dormantPct);
  if (dormant !== 'auto' && (!Number.isFinite(dormant) || dormant <= 0 || dormant >= 50)) {
    return res.status(400).json({ error: 'dormant range must be "auto" or a percentage between 0 and 50' });
  }
  try {
    const id = batch.startMetalens({
      startMonth: b.startMonth,
      endMonth: b.endMonth,
      compareSymbol: b.compareSymbol ? String(b.compareSymbol).toUpperCase() : undefined,
      pairs: b.pairs ? b.pairs.map((p) => String(p).toUpperCase()) : undefined,
      nullShifts,
      geometry,
      dormantPct: dormant,
      weekdaysOnly: !!b.weekdaysOnly,
      forceAllOnZeroPass: !!b.forceAllOnZeroPass,
      splitMode: b.splitMode === 'interlaced' ? 'interlaced' : 'chronological',
      allLoaded: !!b.allLoaded,
    });
    res.json({ batchId: id });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// Exact null-shift ceilings for a comma-separated pair list, computed on the
// currently cached data (no network). Powers the consensus "max" button.
app.get('/api/rotations', async (req, res) => {
  const pairs = String(req.query.pairs || '').split(',').map((p) => p.trim().toUpperCase()).filter(Boolean);
  const compareSymbol = String(req.query.compare || 'BTCUSDT').toUpperCase();
  const geometry = String(req.query.geometry || 'weekly-8d');
  const weekdaysOnly = req.query.weekdays === '1';
  const allLoaded = req.query.allLoaded === '1';
  const startMonth = String(req.query.startMonth || '');
  const endMonth = String(req.query.endMonth || '');
  if (!pairs.length || pairs.length > 6 || pairs.some((p) => !SYMBOL_RE.test(p))) {
    return res.status(400).json({ error: 'pass 1-6 pairs like ?pairs=DOTUSDT,AVAXUSDT' });
  }
  if (!GEOMETRY_KEYS.includes(geometry)) {
    return res.status(400).json({ error: `geometry must be one of ${GEOMETRY_KEYS.join('/')}` });
  }
  if (!allLoaded && (startMonth || endMonth) && !(/^\d{4}-\d{2}$/.test(startMonth) && /^\d{4}-\d{2}$/.test(endMonth))) {
    return res.status(400).json({ error: 'months must be YYYY-MM' });
  }
  // The ceiling is quoted for the months the screen will actually use.
  const range = { allLoaded, startMonth, endMonth };
  try {
    const out = {};
    for (const p of pairs) out[p] = await countRotations(p, compareSymbol, () => {}, geometry, weekdaysOnly, range);
    const suggested = Math.min(1000, Math.max(0, ...Object.values(out).map((r) => r.maxRotations)));
    res.json({ pairs: out, suggested });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Keep every dataset already on the server fresh: every 6 hours, fetch any
// newly PUBLISHED monthly zips (the bulk portal posts a month a few days
// after it ends) for each cached symbol. Purely additive; never re-downloads.
async function refreshNewMonths() {
  const now = new Date();
  for (const { symbol } of cacheState()) {
    const have = new Set(cachedMonths(symbol));
    for (let back = 1; back <= 2; back++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
      const mm = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (have.has(mm)) continue;
      try {
        const rows = await monthlyKlines(symbol, d.getUTCFullYear(), d.getUTCMonth() + 1);
        if (rows) console.log(`auto-refresh: cached ${symbol} ${mm} (${rows.length} candles)`);
      } catch (err) {
        console.error(`auto-refresh failed for ${symbol} ${mm}:`, err.message);
      }
    }
  }
}
setInterval(() => refreshNewMonths().catch((err) => console.error('auto-refresh failed:', err.message)), 6 * 60 * 60 * 1000);
setTimeout(() => refreshNewMonths().catch((err) => console.error('auto-refresh failed:', err.message)), 60 * 1000);

// ---- live paper tracker ------------------------------------------------------

app.get('/api/tracker', (req, res) => res.json(tracker.status()));

// Refresh-button path: pull a fresh price per pair (one REST call each),
// fill any newly knowable pending entry prices, then return status.
app.post('/api/tracker/refresh', async (req, res) => {
  try {
    await tracker.refreshPrices();
    res.json(tracker.status());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tracker/init', (req, res) => {
  if (tracker.initialized()) return res.status(409).json({ error: 'tracker already initialized' });
  const jobId = startJob((setProgress) => tracker.init({}, setProgress));
  res.json({ jobId });
});

// Weekly heartbeat: predictions post at Tue 00:xx, settlements after Thu
// 18:00; a 30-minute cadence catches both promptly and self-heals after
// downtime (missed weeks arrive flagged as seeded, never lost).
setInterval(() => tracker.tick().catch((err) => console.error('tracker tick failed:', err.message)), 30 * 60 * 1000);
setTimeout(() => tracker.tick().catch((err) => console.error('tracker tick failed:', err.message)), 20 * 1000);

// ---- second live paper book: DOGE daily-3d (TRACKER-DOGE.md) -----------------
// Entirely separate state and endpoints from the frozen DOT/AVAX tracker.

app.get('/api/dogebook', (req, res) => res.json(dogebook.status()));

app.post('/api/dogebook/refresh', async (req, res) => {
  try {
    await dogebook.refreshPrices();
    res.json(dogebook.status());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/dogebook/init', (req, res) => {
  if (dogebook.initialized()) return res.status(409).json({ error: 'doge book already initialized' });
  const jobId = startJob((setProgress) => dogebook.init({}, setProgress));
  res.json({ jobId });
});

// Daily geometry: a new chunk closes every day and settlement lands 115h
// later, so a 30-minute cadence catches both promptly and self-heals after
// downtime (missed days arrive flagged unseen, never lost).
setInterval(() => dogebook.tick().catch((err) => console.error('dogebook tick failed:', err.message)), 30 * 60 * 1000);
setTimeout(() => dogebook.tick().catch((err) => console.error('dogebook tick failed:', err.message)), 40 * 1000);

// ---- generalized paper books (owner-created, code-enforced freeze) -----------

app.get('/api/books', (req, res) => res.json(books.statusAll()));

app.post('/api/books', (req, res) => {
  try {
    books.validateConfig(req.body); // fail fast with a readable error
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const jobId = startJob((setProgress) => books.createDraft(req.body, setProgress));
  res.json({ jobId });
});

app.post('/api/books/:id/declare', (req, res) => {
  const doc = books.loadBook(req.params.id);
  if (!doc) return res.status(404).json({ error: 'unknown book' });
  if (doc.status !== 'draft') return res.status(409).json({ error: `book is ${doc.status}` });
  const jobId = startJob((setProgress) => books.declare(req.params.id, setProgress));
  res.json({ jobId });
});

app.post('/api/books/:id/discard', (req, res) => {
  try {
    res.json(books.discardDraft(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/books/:id/retire', (req, res) => {
  try {
    res.json(books.retire(req.params.id, (req.body || {}).reason));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/books/refresh', async (req, res) => {
  try {
    await books.refreshPrices();
    res.json(books.statusAll());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

setInterval(() => books.tick().catch((err) => console.error('books tick failed:', err.message)), 30 * 60 * 1000);
setTimeout(() => books.tick().catch((err) => console.error('books tick failed:', err.message)), 60 * 1000);

// Owner's kill switch: stops the active screen at its current run AND
// aborts every in-flight heavy loop (single runs, tracker init) at its next
// yield point — works even with the CPU cap at OFF. Ticks, downloads-in-
// progress for the current file, and saved results are unaffected.
app.post('/api/abort', (req, res) => {
  const cancelledBatch = batch.cancelActive();
  throttle.abortHeavyWork();
  res.json({ ok: true, cancelledBatch });
});

app.get('/api/batches', (req, res) => res.json({ running: batch.batchRunning(), batches: batch.listBatches() }));

// ---- owner-operable inspection + null verdicts (read-only over stored data) --

const { inspectDump } = require('./lib/inspect');
const { nullVerdict, realRows, drawsOf } = require('./lib/verdict');
const { compareDocs } = require('./lib/compare');

// Which runs can play which role in a null verdict — feeds the dropdowns so
// the owner picks from runs that actually qualify instead of guessing.
app.get('/api/bracketlab/verdict-sources', (req, res) => {
  const out = [];
  for (const b of batch.listBatches()) {
    if (!String(b.id).startsWith('bracketlab-')) continue;
    const doc = batch.getBatch(b.id);
    if (!doc || !Array.isArray(doc.edgeCensus) || !doc.edgeCensus.length) continue;
    const real = realRows(doc).length;
    const draws = drawsOf(doc).length;
    if (!real && !draws) continue;
    out.push({
      id: doc.id, realRows: real, scrambleDraws: draws, status: doc.status,
      windowLayout: (doc.params && doc.params.windowLayout) || 'legacy',
      engineVersion: (doc.params && doc.params.engineVersion) || null,
    });
  }
  res.json({ sources: out });
});

// Serve one saved member dump, analysed. Path inputs are hostile until proven
// otherwise: id and file are pinned to strict shapes and the resolved path
// must stay inside the models directory.
app.get('/api/bracketlab/:id/inspect', (req, res) => {
  const id = String(req.params.id || '');
  const file = String(req.query.file || '');
  const quorum = Number(req.query.quorum) || 1;
  if (!/^bracketlab-[A-Za-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'bad job id' });
  if (!/^[A-Za-z0-9._-]+\.json$/.test(file) || file.includes('..')) return res.status(400).json({ error: 'bad file name' });
  const base = path.join(__dirname, 'data', 'models');
  const full = path.resolve(base, id, file);
  if (!full.startsWith(path.resolve(base) + path.sep)) return res.status(400).json({ error: 'bad path' });
  let dump;
  try {
    dump = JSON.parse(require('fs').readFileSync(full, 'utf8'));
  } catch {
    return res.status(404).json({ error: 'no saved dump for that setup (runs before 2026-07-30 saved nothing)' });
  }
  try {
    res.json({ job: id, file, meta: { trade: dump.trade, geometry: dump.geometry, decision: dump.decision, best: dump.best || null }, ...inspectDump(dump, quorum) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The two null tests over stored runs. POST because it names two docs and an
// optional setup; it computes only — nothing is fired.
app.post('/api/bracketlab/null-verdict', (req, res) => {
  const b = req.body || {};
  const realDoc = batch.getBatch(String(b.realId || ''));
  const nullDoc = batch.getBatch(String(b.nullId || ''));
  if (!realDoc) return res.status(400).json({ error: 'unknown real run' });
  if (!nullDoc) return res.status(400).json({ error: 'unknown scramble run' });
  const sel = b.trade ? {
    trade: String(b.trade), geometry: String(b.geometry || ''), decision: String(b.decision || ''),
    ...(b.windowLayout ? { windowLayout: String(b.windowLayout) } : {}),
  } : null;
  try {
    res.json(nullVerdict(realDoc, nullDoc, sel));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Layout comparison (owner's workflow criteria, 2026-07-30): one 'both' run
// compares its own two arms; two separate runs link ONLY when every stored
// setting matches — compareDocs refuses otherwise, naming the differences.
app.post('/api/bracketlab/compare', (req, res) => {
  const b = req.body || {};
  // Run ids are hostile until proven otherwise — pinned to the same strict
  // shape the inspect endpoint uses, so nothing here can walk the filesystem.
  const ID_RE = /^bracketlab-[A-Za-z0-9-]+$/;
  if (!ID_RE.test(String(b.a || ''))) return res.status(400).json({ error: 'bad run id (a)' });
  if (b.b && !ID_RE.test(String(b.b))) return res.status(400).json({ error: 'bad run id (b)' });
  const docA = batch.getBatch(String(b.a || ''));
  if (!docA) return res.status(400).json({ error: 'unknown run (a)' });
  const docB = b.b ? batch.getBatch(String(b.b)) : null;
  if (b.b && !docB) return res.status(400).json({ error: 'unknown run (b)' });
  try {
    res.json(compareDocs(docA, docB));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/batch/:id', (req, res) => {
  const doc = batch.getBatch(req.params.id);
  if (!doc) return res.status(404).json({ error: 'unknown batch' });
  res.json(doc);
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'unknown job (restarted server?) — run again' });
  res.json({ id: job.id, status: job.status, progress: job.progress, result: job.result, error: job.error });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`general-classifier listening on 127.0.0.1:${PORT}`);
});
