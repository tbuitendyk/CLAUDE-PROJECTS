const path = require('path');
const express = require('express');
const { startJob, getJob } = require('./lib/jobs');
const { runAnalysis, loadData } = require('./lib/pipeline');
const { cacheState } = require('./lib/binance');
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
  if (!SYMBOL_RE.test(tradeSymbol)) return res.status(400).json({ error: 'trade pair must look like ZECUSDT' });
  if (!SYMBOL_RE.test(compareSymbol)) return res.status(400).json({ error: 'compare pair must look like BTCUSDT' });
  if (tradeSymbol === compareSymbol) return res.status(400).json({ error: 'trade and compare pairs must differ' });
  if (!/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) {
    return res.status(400).json({ error: 'months must be YYYY-MM' });
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

  const jobId = startJob((setProgress) =>
    runAnalysis({ dormantPct, tradeSymbol, compareSymbol, startMonth, endMonth, featureSet, model, featureView }, setProgress)
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
    if (b[m] !== undefined && !/^\d{4}-\d{2}$/.test(String(b[m]))) {
      return res.status(400).json({ error: `${m} must be YYYY-MM` });
    }
  }
  if (b.pairs !== undefined && (!Array.isArray(b.pairs) || b.pairs.some((p) => !SYMBOL_RE.test(String(p))))) {
    return res.status(400).json({ error: 'pairs must be an array of symbols like ETHUSDT' });
  }
  if (b.models !== undefined && (!Array.isArray(b.models) || b.models.some((m) => m !== 'logreg' && m !== 'boost'))) {
    return res.status(400).json({ error: 'models must be an array of "logreg"/"boost"' });
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
    });
    res.json({ batchId: id });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

app.post('/api/consensus', (req, res) => {
  const b = req.body || {};
  for (const m of ['startMonth', 'endMonth']) {
    if (b[m] !== undefined && !/^\d{4}-\d{2}$/.test(String(b[m]))) {
      return res.status(400).json({ error: `${m} must be YYYY-MM` });
    }
  }
  if (b.pairs !== undefined && (!Array.isArray(b.pairs) || !b.pairs.length || b.pairs.some((p) => !SYMBOL_RE.test(String(p).toUpperCase())))) {
    return res.status(400).json({ error: 'pairs must be a non-empty array of symbols like DOTUSDT' });
  }
  const nullShifts = b.nullShifts === undefined ? 0 : Number(b.nullShifts);
  if (!Number.isInteger(nullShifts) || nullShifts < 0 || nullShifts > 20) {
    return res.status(400).json({ error: 'nullShifts must be an integer 0..20' });
  }
  try {
    const id = batch.startConsensus({
      startMonth: b.startMonth,
      endMonth: b.endMonth,
      compareSymbol: b.compareSymbol ? String(b.compareSymbol).toUpperCase() : undefined,
      pairs: b.pairs ? b.pairs.map((p) => String(p).toUpperCase()) : undefined,
      nullShifts,
    });
    res.json({ batchId: id });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// ---- live paper tracker ------------------------------------------------------

app.get('/api/tracker', (req, res) => res.json(tracker.status()));

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
