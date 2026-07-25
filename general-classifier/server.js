const path = require('path');
const express = require('express');
const { startJob, getJob } = require('./lib/jobs');
const { runAnalysis, loadData, countRotations } = require('./lib/pipeline');
const { GEOMETRIES } = require('./lib/dataset');
const { cacheState, cachedMonths, monthlyKlines } = require('./lib/binance');
const throttle = require('./lib/throttle');
const batch = require('./lib/batch');
const tracker = require('./lib/tracker');

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

app.get('/api/cpu', (req, res) => res.json({ pct: throttle.currentCpuPct() }));

app.post('/api/cpu', (req, res) => {
  try {
    res.json({ pct: throttle.setCpuPct((req.body || {}).pct) });
  } catch (err) {
    res.status(400).json({ error: err.message });
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
