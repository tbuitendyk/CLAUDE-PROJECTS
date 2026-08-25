const path = require('path');
const express = require('express');
const { startJob, getJob } = require('./lib/jobs');
const { GEOMETRIES } = require('./lib/dataset');
const { cacheState, cachedMonths, monthlyKlines } = require('./lib/binance');
const throttle = require('./lib/throttle');
const { configuredSize, createPool } = require('./lib/pool');
const batch = require('./lib/batch');
const guard = require('./lib/guard');

// General Classifier web service. Fronted by nginx at
// https://www.buitendyk.ca/classifier/ behind the site's Basic Auth (the
// trailing-slash proxy_pass strips the prefix, so everything here is
// prefix-relative). No auth or AI/API calls in-app: the only outbound
// traffic is Binance bulk-data downloads in lib/binance.js, and training is
// pure local arithmetic in lib/logreg.js.

// 8094, and NEVER 8093. 8093 is the previous generation's port, and it is
// still serving the owner's live trading and paper books on this box. If the
// env file ever lost its PORT line this fallback is what would be used, and a
// fallback of 8093 would have this service race the running one for its port
// at boot — with no ordering between the units, this one can win.
const PORT = Number(process.env.PORT || 8094);

const app = express();
app.use(express.json({ limit: '256kb' }));
// EVERY REPLY IS MEASURED (owner order, 2026-08-23: "always chunk data PROPERLY
// to browsers"). There was a 256kb ceiling on what a browser could SEND and
// nothing at all on what it was sent back — so a reply grew to 99 MB and the
// only symptom was a screen that never arrived. Installed before the routes so
// it covers every one of them, including the next one somebody writes.
require('./lib/payload').installPayloadGuard(app);
// CACHE MARKER = THE RELEASE. construct.html asked for construct.js?v=1 —
// a marker fixed at 1 forever. Browsers cache by full URL, so the moment anyone
// lengthens max-age (it is 0 today, which is the only reason this has not bitten)
// a returning browser would keep serving a copy from days ago and every shipped
// fix would read as not-applied. Stamping the release into the URL makes the
// address change with the file, so there is nothing to get stale
// (found 2026-08-18 while proving a deployed fix really was deployed).
// THE FRONT DOOR IS THE SETUP TAB (owner ruling, 2026-08-19; THIS-RELEASE 14/17).
// Serving '/' explicitly, ABOVE express.static, because static's own index
// handling would otherwise pick index.html — the page this release removes —
// and the address would go dark the moment it does.
app.get(['/', '/setup.html', '/construct.html', '/trade.html'], (req, res, next) => {
  const name = req.path === '/' ? 'setup.html' : path.basename(req.path);
  const file = path.join(__dirname, 'public', name);
  require('fs').readFile(file, 'utf8', (err, html) => {
    if (err) return next();
    // THE MARKER IS THE FILE'S OWN CONTENTS, not a version number anybody has
    // to remember to bump (fixed 2026-08-21, and it had already bitten).
    //
    // It used to stamp the version out of package.json. That version had not
    // changed in weeks, so every deploy served the scripts at the SAME address
    // — and a browser caches by address. A whole day of shipped work sat on the
    // box while the owner's browser served them the copy from before it, and
    // asked where their new tab was. The comment right here warned that this
    // would happen.
    //
    // A short hash of the file changes exactly when the file changes: never
    // when it has not, always when it has. Nothing to remember.
    const stamp = (jsName) => {
      try {
        const body = require('fs').readFileSync(path.join(__dirname, 'public', jsName));
        return require('crypto').createHash('sha1').update(body).digest('hex').slice(0, 12);
      } catch (_) {
        // Unreadable: fall back to something that always misses the cache
        // rather than something that always hits it. A stale page is the
        // failure being fixed; an extra fetch is not a failure at all.
        return `x${Date.now().toString(36)}`;
      }
    };
    // The ?v= marker only rewrites EXTERNAL script URLs, and two of these three
    // pages carry all their JavaScript inline — so for them the marker protects
    // nothing and a cached copy would survive a deploy. Say no-cache outright
    // rather than relying on a mechanism that does not reach them.
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html.replace(/([\w.-]+\.js)\?v=[\w.-]+/g, (m0, jsName) => `${jsName}?v=${stamp(jsName)}`));
  });
});
app.use(express.static(path.join(__dirname, 'public')));

const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;
const GEOMETRY_KEYS = Object.keys(GEOMETRIES); // weekly-8d, daily-1d..daily-4d

// EVERY CONTROL ON EVERY SCREEN, so the Help tab can describe all of them and
// show which ones it has not described. Read out of the code that draws each
// screen — the SAME reader the tests use, so the page and the test that checks
// the page cannot disagree about what exists.
app.get('/api/screen-controls', (req, res) => {
  try { res.json(require('./lib/screencontrols').byTab()); }
  catch (err) { res.status(500).json({ error: `the controls could not be read: ${err.message}` }); }
});

// EVERY CHOICE LIST THE INTERFACE OFFERS, so the page does not keep its own
// copy of any of them (RULE FIVE). Read out of the code that implements each
// one, so a value added to the engine appears on screen with nothing to keep in
// step — and so a value the engine has cannot be missing from the screen, which
// it was: the engine implements a 161-hour hold and the page's list stopped at
// 137.
app.get('/api/vocabulary', (req, res) => {
  try {
    res.json(require('./lib/vocabulary').vocabulary());
  } catch (err) {
    res.status(500).json({ error: `the choice lists could not be read: ${err.message}` });
  }
});

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

// ---- Compute (owner design, 2026-08-25) -------------------------------------
// Which platform each role points at, which platforms exist to point at, and
// the two CPU settings this service already honours live (worker count from
// data/settings.json at each job launch; per-worker duty cycle re-read every
// few seconds by running work). The page fills every dropdown from this reply
// and holds no list of its own (RULE FIVE).
app.get('/api/compute-config', (req, res) => {
  try {
    const cfg = require('./lib/compute').config();
    res.json({
      ...cfg,
      workers: { setting: (() => {
        try { return JSON.parse(require('fs').readFileSync(path.join(__dirname, 'data', 'settings.json'), 'utf8')).worker_threads ?? null; } catch (_) { return null; }
      })(),
      inForce: configuredSize(),
      max: require('os').cpus().length },
      pct: throttle.currentCpuPct(),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/compute-config', (req, res) => {
  const body = req.body || {};
  try {
    const out = {};
    if (body.role != null) out.role = require('./lib/compute').setRole(String(body.role), String(body.platform || ''));
    if (body.workers != null) {
      const n = Math.floor(Number(body.workers));
      const cores = require('os').cpus().length;
      if (!Number.isFinite(n) || n < 1 || n > cores) {
        return res.status(400).json({ error: `workers must be a whole number from 1 to ${cores} — this machine has ${cores} processors` });
      }
      // Same file, same atomic write discipline as the duty cycle setting.
      const file = path.join(__dirname, 'data', 'settings.json');
      let settings = {};
      try { settings = JSON.parse(require('fs').readFileSync(file, 'utf8')); } catch (_) { /* first write */ }
      settings.worker_threads = n;
      require('fs').mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp${process.pid}`;
      require('fs').writeFileSync(tmp, JSON.stringify(settings, null, 1));
      require('fs').renameSync(tmp, file);
      out.workers = { setting: n, inForce: configuredSize(), max: cores };
    }
    if (body.pct != null) out.pct = throttle.setCpuPct(body.pct);
    res.json(out);
  } catch (err) { res.status(400).json({ error: err.message }); }
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
// ---- data state + load-only phase -------------------------------------------

// `planted` marks the FABRICATED pairs. The Data section used to test one
// hardcoded symbol name, so the second fabricated pair (the late-rule exam) was
// offered download/refresh/trim like a real Binance pair — and trimming it
// silently corrupts the exam it exists to be (audit 2026-08-17). The flag comes
// from lib/planted.js's own list so a third fabricated pair cannot be missed.
app.get('/api/data-state', (req, res) => res.json({
  symbols: cacheState().map((r) => ({ ...r, planted: planted.isPlanted(r.symbol) })),
}));


// ---- data management (owner order, 2026-08-03): the "available data on
// server" section gains download / refresh / purge / range controls. All
// writes sit behind the cache-write guard; purges also refuse mid-job.
const dataFs = require('fs');
const dataPath = require('path');
const DATA_CACHE_DIR = dataPath.join(__dirname, 'data', 'cache');
const currentMonth = () => new Date().toISOString().slice(0, 7);


// Backfill a month that has no published bundle yet, day by day — the same
// path the paper books use to stay current (owner caught the refresh
// fetching nothing while July's bundles are unpublished, 2026-08-03).
async function backfillDailies(symbol, monthStr, setProgress) {
  const { dailyKlines } = require('./lib/binance');
  const [y, m] = monthStr.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = new Date();
  let fetched = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dayDate = Date.UTC(y, m - 1, d);
    if (dayDate >= Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) break; // today is never a finished day file
    setProgress(`${symbol} ${monthStr}-${String(d).padStart(2, '0')} (day file)`);
    const rows = await dailyKlines(symbol, y, m, d);
    if (rows && rows.length) fetched++;
  }
  return fetched;
}

const planted = require('./lib/planted');
const paper = require('./lib/paper');

app.post('/api/data/download', (req, res) => {
  const b = req.body || {};
  const symbols = (Array.isArray(b.symbols) ? b.symbols : []).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
  if (!symbols.length || symbols.some((x) => !SYMBOL_RE.test(x))) {
    return res.status(400).json({ error: 'symbols must be a list like ["DOTUSDT","PEPEUSDT"]' });
  }
  {
    const hit = symbols.find((x) => planted.PLANTED_SYMBOLS.includes(x));
    if (hit) return res.status(400).json({ error: `${hit} is a reserved fabricated pair — it is generated, never downloaded` });
  }
  if (!/^\d{4}-\d{2}$/.test(String(b.startMonth)) || !/^\d{4}-\d{2}$/.test(String(b.endMonth))) {
    return res.status(400).json({ error: 'months must be YYYY-MM' });
  }
  const loadStop = guard.loadRefusal(batch.batchRunning());
  if (loadStop) return res.status(409).json({ error: loadStop });
  const { monthList: ml, loadSymbol } = require('./lib/pipeline');
  const months = ml(String(b.startMonth), String(b.endMonth));
  const jobId = startJob(async (setProgress) => {
    const out = {};
    for (const sym of symbols) {
      const { rows, missing } = await loadSymbol(sym, months, setProgress);
      const backfilled = {};
      for (const mm of missing) {
        backfilled[mm] = await backfillDailies(sym, mm, setProgress);
      }
      out[sym] = { candles: rows.length, monthsRequested: months.length, monthsWithoutBundles: missing, dayFilesFetched: backfilled };
    }
    // The fabricated pair mirrors the real data's date span (owner order,
    // 2026-08-03) — new real months mean it regenerates to match.
    if (planted.plantedExists()) {
      setProgress(`regenerating ${planted.PLANTED_SYMBOL} to the new span`);
      out[planted.PLANTED_SYMBOL] = { regenerated: true, ...planted.generatePlanted(planted.plantedSpan()) };
      if (planted.plantedExists(planted.PLANTED_LATE_SYMBOL)) {
        out[planted.PLANTED_LATE_SYMBOL] = { regenerated: true, ...planted.generatePlantedLate(planted.plantedSpan()) };
      }
    }
    return out;
  });
  res.json({ jobId });
});

// Refresh one asset (or every cached asset) from its newest cached month to
// the current month. Re-fetches the newest cached month too — it may have
// been partial when first downloaded.
app.post('/api/data/refresh', (req, res) => {
  const one = req.body && req.body.symbol ? String(req.body.symbol).trim().toUpperCase() : null;
  if (one && !SYMBOL_RE.test(one)) return res.status(400).json({ error: 'symbol must look like DOTUSDT' });
  const loadStop = guard.loadRefusal(batch.batchRunning());
  if (loadStop) return res.status(409).json({ error: loadStop });
  const state = cacheState();
  // The fabricated pair never touches Binance: refreshing it means
  // regenerating it over the real data's current span, and that happens
  // after EVERY refresh that leaves real data on disk — single-pair
  // refreshes included — so the pair can never trail the data it mirrors.
  // On a Global Refresh it regenerates LAST, after every real pair fetched.
  // EVERY fabricated pair, not just the first one. This filtered PLANTED_SYMBOL
  // alone, so a refresh of the late-rule exam pair fell through to the Binance
  // fetch path for a symbol that does not exist on Binance.
  const hasRealData = state.some((s2) => !planted.isPlanted(s2.symbol));
  const targets = (one ? state.filter((s2) => s2.symbol === one) : state)
    .filter((s2) => !planted.isPlanted(s2.symbol));
  if (planted.isPlanted(one) && !hasRealData) {
    return res.status(400).json({ error: `${one} mirrors the real data's date span and nothing real is cached — download real pairs first` });
  }
  if (planted.isPlanted(one) && !planted.plantedExists()) {
    return res.status(400).json({ error: `${one} has never been generated — the planted-check button creates it` });
  }
  if (!targets.length && !planted.isPlanted(one)) {
    return res.status(400).json({ error: one ? `${one} has no cached data — use download` : (hasRealData ? 'nothing to refresh' : 'nothing cached yet') });
  }
  const { monthList: ml, loadSymbol } = require('./lib/pipeline');
  const jobId = startJob(async (setProgress) => {
    const out = {};
    for (const t of targets) {
      const months = ml((t.toMonth || t.to).slice(0, 7), currentMonth());
      const { rows, missing } = await loadSymbol(t.symbol, months, setProgress);
      const backfilled = {};
      for (const mm of missing) {
        backfilled[mm] = await backfillDailies(t.symbol, mm, setProgress);
      }
      out[t.symbol] = { refreshedFrom: t.to, candles: rows.length, monthsWithoutBundles: missing, dayFilesFetched: backfilled };
    }
    if (planted.plantedExists()) {
      setProgress(`regenerating ${planted.PLANTED_SYMBOL} to the refreshed span`);
      out[planted.PLANTED_SYMBOL] = { regenerated: true, ...planted.generatePlanted(planted.plantedSpan()) };
      if (planted.plantedExists(planted.PLANTED_LATE_SYMBOL)) {
        out[planted.PLANTED_LATE_SYMBOL] = { regenerated: true, ...planted.generatePlantedLate(planted.plantedSpan()) };
      }
    }
    return out;
  });
  res.json({ jobId, refreshing: targets.map((t) => t.symbol) });
});

// Purge: an entire asset, or the months of one asset OUTSIDE a kept range
// (that is how the month range shrinks; growing it is a download). Purge is
// destructive and refuses while anything runs.
app.post('/api/data/purge', (req, res) => {
  const b = req.body || {};
  const sym = String(b.symbol || '').trim().toUpperCase();
  if (!SYMBOL_RE.test(sym)) return res.status(400).json({ error: 'symbol must look like DOTUSDT' });
  if (batch.batchRunning()) return res.status(409).json({ error: 'a sweep is running — purge refuses while anything reads the cache' });
  { const j = require('./lib/jobs').anyJobRunning(); if (j) return res.status(409).json({ error: `data/analysis job ${j} is running — purge refuses while anything reads or writes the cache` }); }
  const keepFrom = b.keepFrom ? String(b.keepFrom) : null;
  const keepTo = b.keepTo ? String(b.keepTo) : null;
  if ((keepFrom && !/^\d{4}-\d{2}$/.test(keepFrom)) || (keepTo && !/^\d{4}-\d{2}$/.test(keepTo))) {
    return res.status(400).json({ error: 'keepFrom/keepTo must be YYYY-MM' });
  }
  let files = [];
  try { files = dataFs.readdirSync(DATA_CACHE_DIR); } catch { files = []; }
  const victims = files.filter((f) => {
    const m = new RegExp(`^${sym}-1h-(\\d{4}-\\d{2})(?:-\\d{2})?\\.json$`).exec(f);
    if (!m) return false;
    if (!keepFrom && !keepTo) return true; // whole asset
    const month = m[1];
    return (keepFrom && month < keepFrom) || (keepTo && month > keepTo);
  });
  for (const f of victims) {
    try { dataFs.unlinkSync(dataPath.join(DATA_CACHE_DIR, f)); } catch { /* reported below via recount */ }
  }
  // A purge/trim of REAL data changes the span the fabricated pair mirrors —
  // regenerate it in the same breath (fast, deterministic, no network).
  let plantedRegen = null;
  if (!planted.isPlanted(sym) && planted.plantedExists()) {
    const span = planted.plantedSpan();
    plantedRegen = span ? { regenerated: true, ...planted.generatePlanted(span) } : { removed: true };
    // THE LATE-RULE EXAM PAIR TOO. Only the first fabricated pair was
    // regenerated after a purge, so the late pair kept mirroring a span the
    // real data no longer has — exam A then grades against a stale world with
    // nothing on screen to say so (audit 2026-08-17).
    if (span && planted.plantedExists(planted.PLANTED_LATE_SYMBOL)) {
      plantedRegen.late = { regenerated: true, ...planted.generatePlantedLate(span) };
    }
    if (!span) {
      for (const f of dataFs.readdirSync(DATA_CACHE_DIR)) {
        if (planted.PLANTED_SYMBOLS.some((ps) => f.startsWith(`${ps}-1h-`))) {
          try { dataFs.unlinkSync(dataPath.join(DATA_CACHE_DIR, f)); } catch { /* recount */ }
        }
      }
    }
  }
  res.json({ purged: victims.length, symbol: sym, kept: keepFrom || keepTo ? { keepFrom, keepTo } : null, planted: plantedRegen });
});

// ---- the planted check (owner order, 2026-08-03): instrument gate as a
// button. POST regenerates the fabricated pair over the real data's span and
// fires ONE ordinary sweep on it through the real front door — caller, not
// copy. GET is the status strip at the top of the lab: current release,
// PASS / FAIL / NOT CHECKED with the versions quoted.
const RELEASE_VERSION = require('./package.json').version;

// ---- campaign name + post-run notes (owner orders, 2026-08-04) --------------
const campaign = require('./lib/campaign');

app.get('/api/campaign', (req, res) => res.json({ name: campaign.getCampaign() }));
// Campaign-as-parent (point 25): computed tree + name catalog, drift-proof.
app.get('/api/campaigns', (req, res) => {
  try { res.json({ names: campaign.listCampaignNames() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/campaign-tree', (req, res) => {
  try { res.json(campaign.campaignTree(String(req.query.name || '') || null)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// WHAT A CAMPAIGN OWNS, before anything is deleted. Read-only, so the screen
// can say exactly what would go and the owner answers knowing it.
app.get('/api/campaign-contents', (req, res) => {
  try { res.json(campaign.campaignContents(String(req.query.name || ''))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE A CAMPAIGN AND EVERYTHING UNDER IT.
//
// Guarded like the live-money controls, and for the same reason: it cannot be
// undone. It also demands the name back — `{name, confirm}` must match — so a
// request that arrives without a deliberate answer deletes nothing. Silence is
// not an instruction on this route any more than it is on the protective stop.
app.post('/api/campaign/delete', csrfGuard, (req, res) => {
  const body = req.body || {};
  if (!body.name || body.confirm !== body.name) {
    return res.status(400).json({
      error: 'deleting a campaign needs the name given twice — {"name": X, "confirm": X}. '
        + 'A request that does not say the name back is refused, because this cannot be undone.',
    });
  }
  try {
    res.json(campaign.deleteCampaign(body.name));
  } catch (err) {
    res.status(err.code === 'CAMPAIGN_LOCKED' ? 409 : 400)
      .json({ error: err.message, locked: err.code === 'CAMPAIGN_LOCKED', blocking: err.blocking || [] });
  }
});

// THE REPLICATION TABLE, aggregated on this side. The rows live on disk and
// there can be hundreds of millions of them; what the screen shows is one line
// per declared configuration, so the counting happens here by streaming and the
// browser is sent the lines rather than the rows.
app.get('/api/batch/:id/replication', (req, res) => {
  const doc = batch.getBatch(String(req.params.id || ''));
  if (!doc) return res.status(404).json({ error: 'unknown run' });
  try { res.json(require('./lib/replication').rank(doc, req.query)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// One configuration's real rows, for the per-asset table a reader opens. Fetched
// when it is opened rather than shipped with everything else: on a wide run
// that payload would be the whole problem again.
app.get('/api/batch/:id/replication-detail', (req, res) => {
  const doc = batch.getBatch(String(req.params.id || ''));
  if (!doc) return res.status(404).json({ error: 'unknown run' });
  try { res.json(require('./lib/replication').detail(doc, String(req.query.label || ''), req.query)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// Any of a run's stored row collections, a page at a time. The rows ARE the
// record (QC 74) and this is how they are read back without holding them.
app.get('/api/batch/:id/rows', (req, res) => {
  const name = String(req.query.name || '');
  if (!['slim', 'census', 'replication'].includes(name)) {
    return res.status(400).json({ error: 'name must be slim, census or replication' });
  }
  const doc = batch.getBatch(String(req.params.id || ''));
  if (!doc) return res.status(404).json({ error: 'unknown run' });
  try { res.json(require('./lib/rowstore').page(doc.id, name, req.query.from, req.query.n)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// WHETHER A STOPPED RUN CAN BE PICKED UP WHERE IT LEFT OFF, and what is left.
app.get('/api/resume-contents', (req, res) => {
  try { res.json(batch.resumeContents(String(req.query.id || ''))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// PICK UP A STOPPED RUN. Guarded, because it starts hours of work on the box
// and takes the one job slot. It refuses anything it cannot pick up honestly —
// a different engine, different price files, a run that finished or is going —
// and says which.
app.post('/api/run/resume', csrfGuard, (req, res) => {
  const id = String((req.body || {}).id || '');
  if (!id) return res.status(400).json({ error: 'name the run to pick up — {"id": X}' });
  try {
    // the SAME shape a fresh launch answers with, so the page reads one contract
    res.json({ batchId: batch.resumeBracketLab(id) });
  } catch (err) {
    res.status(err.code === 'NOT_RESUMABLE' ? 409 : 400)
      .json({ error: err.message, why: (err.contents || {}).why || [] });
  }
});

// WHAT DELETING ONE RUN WOULD TAKE, and whether anything is standing on it.
app.get('/api/run-contents', (req, res) => {
  try { res.json(batch.runContents(String(req.query.id || ''))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE ONE RUN. Guarded exactly like the campaign delete above and for the
// same reason — it cannot be undone — so the id comes twice. It refuses the
// running one by name (the owner's rule: they restart that themselves) and any
// run a greenlight names as its evidence.
app.post('/api/run/delete', csrfGuard, (req, res) => {
  const body = req.body || {};
  if (!body.id || body.confirm !== body.id) {
    return res.status(400).json({
      error: 'deleting a run needs the id given twice — {"id": X, "confirm": X}. '
        + 'A request that does not say the id back is refused, because this cannot be undone.',
    });
  }
  try {
    res.json(batch.deleteBatch(body.id));
  } catch (err) {
    res.status(err.code === 'RUN_LOCKED' ? 409 : 400)
      .json({ error: err.message, locked: err.code === 'RUN_LOCKED', why: (err.locked || {}).lockedWhy || null });
  }
});

app.post('/api/campaign', (req, res) => {
  try {
    res.json({ name: campaign.setCampaign((req.body || {}).name) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/bracketlab/:id/notes', (req, res) => {
  try {
    res.json(batch.setBatchNotes(req.params.id, (req.body || {}).text));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/planted-gate/status', (req, res) => {
  try {
    res.json(planted.gateStatus(RELEASE_VERSION));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/planted-gate', (req, res) => {
  // BOTH kinds of work refuse it: batches (sweeps) AND data jobs
  // (downloads/refreshes). A refresh job's tail regenerates the fabricated
  // pair — overlapping the gate would rewrite the pair's candles under the
  // gate sweep's workers (review 2026-08-03, MAJOR).
  const busy = batch.batchRunning() || require('./lib/jobs').anyJobRunning();
  if (busy) {
    return res.status(409).json({ error: `${busy} is running — the planted check regenerates cache data and fires a sweep, so it refuses while ANY job or sweep runs` });
  }
  try {
    const span = planted.plantedSpan();
    const gen = planted.generatePlanted(span); // throws loudly when no real data is cached
    const id = batch.startBracketLab(planted.gateParams());
    res.json({ batchId: id, planted: gen });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// ---- pair-screen batches ----------------------------------------------------

// Bracket lab: the execution-permutation sweep (combos × option branches ×
// the OCO bracket menu), slim-then-promote, no nulls in the sweep.
// ONE MAPPING FROM THE REQUEST TO THE RUN'S PARAMETERS, because two callers
// need it: the launch below and the pre-launch estimate. A parameter the
// estimate did not carry would be a parameter the estimate silently priced at
// zero — and an estimate that describes a different run from the one about to
// start is worse than none (owner order, 2026-08-22).
function sweepParams(b) {
  return {
    declared: b.declared,
    universe: b.universe ? b.universe.map((p) => String(p).toUpperCase()) : undefined,
    sizes: b.sizes,
    startMonth: b.startMonth,
    endMonth: b.endMonth,
    allLoaded: !!b.allLoaded,
    permute: b.permute,
    set: b.set,
    promoteK: b.promoteK,
    // How many rows the board keeps. Fixed at 50 and reachable from nowhere
    // until 2026-08-23; it also bounds promoteK, so a launch that could not
    // send it could not raise that either.
    detailK: b.detailK,
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
    // which replication boxes are permuted; absent = the single declared config
    declaredPermute: b.declaredPermute,
    interlaceSeed: b.interlaceSeed,
    sharedBand: b.sharedBand,
  };
}

// WHAT A RUN WILL COST, before anybody presses anything. Starts nothing, claims
// no job slot, writes nothing.
app.post('/api/sweep-estimate', (req, res) => {
  try {
    const { configuredSize } = require('./lib/pool');
    res.json(require('./lib/estimate').estimate(sweepParams(req.body || {}),
      { poolSize: typeof configuredSize === 'function' ? configuredSize() : undefined }));
  } catch (err) {
    // A refusal IS an estimate: it is what the launch would say, said earlier.
    res.status(200).json({ refusal: err.message });
  }
});

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
    const id = batch.startBracketLab(sweepParams(b));
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

app.post('/api/bracketlab/:id/null', (req, res) => {
  try {
    res.json(batch.startBracketNull(req.params.id, (req.body || {}).shifts));
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// Permutation screen: stage 1 of the owner's staged pick workflow — every
// pair × every spec × both training regimes, 0 null shifts by design.
// Stages 2/3/5: persist the owner's selections (asset -> members -> rungs).
// Stage 6: fire the null test over the frozen selection.
// Meta-lens screen: the two-stage protocol (lens selection on half A,
// agreement threshold on half B, verdict on the untouched test window),
// with nulls that replay the whole recipe per rotation.
// Exact null-shift ceilings for a comma-separated pair list, computed on the
// currently cached data (no network). Powers the consensus "max" button.
// Keep every dataset already on the server fresh: every 6 hours, fetch any
// newly PUBLISHED monthly zips (the bulk portal posts a month a few days
// after it ends) for each cached symbol. Purely additive; never re-downloads.
async function refreshNewMonths() {
  // Cache-write guard: a newly published month landing mid-batch changes
  // the dataset later units read ("all loaded" jobs re-read the cache per
  // unit). Skip the tick; the next one catches up after the batch ends.
  if (batch.batchRunning()) return;
  const now = new Date();
  for (const { symbol } of cacheState()) {
    // The fabricated planted-check pair is generated, never fetched — asking
    // Binance for it would 404 every tick forever.
    if (planted.isPlanted(symbol)) continue;
    // cachedMonths (bundle months only) is DELIBERATE here: this tick's job
    // is fetching newly PUBLISHED bundles, and a month already held as day
    // files still wants its bundle when Binance posts it (the bundle is the
    // durable form; reads prefer it automatically).
    const have = new Set(cachedMonths(symbol));
    for (let back = 1; back <= 2; back++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
      const mm = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (have.has(mm)) continue;
      // Re-check per fetch, not just at entry: each download awaits the
      // network for seconds, and a sweep launched in that window would
      // otherwise get cache writes mid-run despite the guard above.
      if (batch.batchRunning()) return;
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
    // The planted-check calibration judges the instrument, never candidates —
    // its board never plays a role in a real null verdict.
    if (doc.params && doc.params.plantedGate) continue;
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

// THE FULL MENU GRID for one promoted row (owner order, 2026-08-04): every
// execution-menu permutation re-scored from the row's stored member votes —
// no retraining, test window only (browsing held-back money cell-by-cell
// would turn the graded window into another shopping window). The task
// self-checks that the reconstructed windows match the stored record and
// refuses otherwise.
app.post('/api/bracketlab/:id/menugrid', (req, res) => {
  const id = String(req.params.id || '');
  const file = String((req.body || {}).file || '');
  if (!/^bracketlab-[A-Za-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'bad job id' });
  if (!/^[A-Za-z0-9._-]+\.json$/.test(file) || file.includes('..')) return res.status(400).json({ error: 'bad file name' });
  if (batch.batchRunning()) return res.status(409).json({ error: 'a sweep is running — the grid recompute waits so it cannot slow it down' });
  const doc = batch.getBatch(id);
  if (!doc || doc.kind !== 'bracketlab') return res.status(404).json({ error: 'unknown run' });
  const base = path.join(__dirname, 'data', 'models');
  const full = path.resolve(base, id, file);
  if (!full.startsWith(path.resolve(base) + path.sep)) return res.status(400).json({ error: 'bad path' });
  let dump;
  try {
    dump = JSON.parse(require('fs').readFileSync(full, 'utf8'));
  } catch {
    return res.status(404).json({ error: 'no saved record for that row (runs before 2026-07-30 saved nothing)' });
  }
  const p = doc.params;
  const band = p.permute && p.permute.band ? null : ((p.set && p.set.band) ?? 'auto');
  const weekdaysOnly = dump.weekdaysOnly != null ? dump.weekdaysOnly
    : (p.permute && p.permute.weekdays ? null : !!(p.set && p.set.weekdaysOnly));
  if (band == null || weekdaysOnly == null) {
    return res.status(400).json({ error: 'this run permuted band/24-5 and the stored record does not say which branch this row used — re-run the sweep for a grid' });
  }
  const combo = { trade: dump.trade, ctx1: dump.ctx1 || null, ctx2: dump.ctx2 || null, size: 1 + (dump.ctx1 ? 1 : 0) + (dump.ctx2 ? 1 : 0) };
  const branch = { geometry: dump.geometry, decision: dump.decision, band, weekdaysOnly };
  const jobId = startJob(async (setProgress) => {
    setProgress(`re-scoring the full menu for ${combo.trade} ${branch.geometry} from the stored votes`);
    const pool = require('./lib/pool').createPool(1);
    try {
      const [settled] = await pool.map('menuGrid', [{ combo, branch, params: p, dump }]);
      if (!settled.ok) throw new Error(settled.error);
      return { unit: { ...combo, geometry: branch.geometry, decision: branch.decision }, trailingSwept: !!p.trailing, ...settled.value };
    } finally {
      pool.abort();
    }
  });
  res.json({ jobId });
});

// The two null tests over stored runs. POST because it names two docs and an
// optional setup; it computes only — nothing is fired.
app.post('/api/bracketlab/null-verdict', (req, res) => {
  const b = req.body || {};
  const realDoc = batch.getBatch(String(b.realId || ''));
  const nullDoc = batch.getBatch(String(b.nullId || ''));
  if (!realDoc) return res.status(400).json({ error: 'unknown real run' });
  if (!nullDoc) return res.status(400).json({ error: 'unknown scramble run' });
  // THE CONTEXT PAIRS ARE PART OF THE SETUP'S IDENTITY, and this endpoint threw
  // them away. lib/verdict.js builds its pairing key from trade|ctx1|ctx2|… and
  // has done since the 2026-08-04 review ("without ctx, a singles+doubles run
  // scored whichever DOT-family row was pushed first") — but the route never
  // forwarded them, so every request arrived as the SINGLES key. Both pages sent
  // a doubles/triples setup and both got "setup … not in this run's real rows".
  // The live vocabulary only accepts three-asset combos, so the null verdict —
  // the check that says whether a result beats its own null — could not be read
  // for any setup this project can trade (runtime harness, 2026-08-17).
  const sel = b.trade ? {
    trade: String(b.trade),
    ctx1: b.ctx1 ? String(b.ctx1) : null,
    ctx2: b.ctx2 ? String(b.ctx2) : null,
    geometry: String(b.geometry || ''), decision: String(b.decision || ''),
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

// ---- walk-forward (DESIGN-WALKFORWARD.md) ----------------------------------

// ---- History Tuning (design ledger; owner build order 2026-08-03) ----------

// The machine verdict for a REAL History Tuning run, computed THROUGH the
// stamped reading rules from the docs on disk (review finding 5: the rules
// must produce a printed sentence, never a table for interpretation).
app.get('/api/historytuning/:id/verdict', (req, res) => {
  try {
    const doc = batch.getBatch(req.params.id);
    if (!doc || doc.kind !== 'historytuning') return res.status(404).json({ error: 'unknown History Tuning run' });
    if (doc.params.arm === 'null' || doc.params.mode) return res.status(400).json({ error: 'verdicts print on the REAL run' });
    if (doc.status !== 'done') return res.status(400).json({ error: `run is ${doc.status}` });
    const excluded = new Set(doc.excludedArms || []);
    const agg = new Map();
    for (const r of doc.htRows || []) {
      if (r.refused || r.skipped) continue;
      const k = `${r.ageKey}|${r.retuneKey}`;
      if (excluded.has(k)) continue;
      const cur = agg.get(k) || { test: 0, hold: 0, holdWins: 0, splits: 0, holds: {} };
      cur.test += r.testPnl || 0;
      cur.hold += r.holdPnl || 0;
      cur.holds[r.split] = r.holdPnl || 0;
      cur.splits++;
      agg.set(k, cur);
    }
    const full = [...agg.entries()].filter(([, v]) => v.splits === 3);
    if (!full.length) return res.json({ sentence: 'NO VERDICT: no dial pair scored all three splits above the floors.' });
    full.sort((a, b) => b[1].test - a[1].test);
    const [winKey, win] = full[0];
    const ref = agg.get('none|never');
    if (!ref || ref.splits !== 3) return res.json({ sentence: 'NO VERDICT: the reference pass did not score all three splits — nothing to beat.' });
    const winsVsRef = ['early', 'middle', 'late'].filter((sp) => (win.holds[sp] ?? 0) > (ref.holds[sp] ?? 0)).length;
    const holdPassed = win.hold > ref.hold && winsVsRef >= 2;
    // Null rule: every finished null draw of this run, same aggregation,
    // its own best-of-grid combined hold.
    const draws = batch.listBatches().filter((b) => b.kind === 'historytuning'
      && b.params && b.params.replayOf === doc.id && b.params.arm === 'null' && b.status === 'done');
    const drawBests = [];
    for (const d of draws) {
      const dd = batch.getBatch(d.id);
      const a2 = new Map();
      for (const r of dd.htRows || []) {
        if (r.refused || r.skipped) continue;
        const k = `${r.ageKey}|${r.retuneKey}`;
        const cur = a2.get(k) || { test: 0, hold: 0, splits: 0 };
        cur.test += r.testPnl || 0;
        cur.hold += r.holdPnl || 0;
        cur.splits++;
        a2.set(k, cur);
      }
      const f2 = [...a2.entries()].filter(([, v]) => v.splits === 3);
      if (f2.length) {
        f2.sort((a, b) => b[1].test - a[1].test);
        drawBests.push({ seed: dd.params.nullShiftSeed, hold: f2[0][1].hold });
      }
    }
    const nullsAtOrAbove = drawBests.filter((d) => d.hold >= win.hold).length;
    const nullPassed = drawBests.length > 0 && nullsAtOrAbove === 0;
    const holdSentence = holdPassed
      ? `HOLD RULE PASSED: the winner (${winKey}) beat the reference pass on combined hold dollars ($${win.hold.toFixed(2)} vs $${ref.hold.toFixed(2)}) and in ${winsVsRef} of 3 hold windows.`
      : `HOLD RULE FAILED: tuning did not strengthen this survivor (winner ${winKey}: $${win.hold.toFixed(2)} vs reference $${ref.hold.toFixed(2)}, ${winsVsRef} of 3 windows).`;
    const nullSentence = drawBests.length === 0
      ? 'NULL RULE PENDING: no finished null draws yet — no claim until they exist.'
      : nullPassed
        ? `NULL RULE PASSED so far: the winner exceeds every one of ${drawBests.length} null draws (resolution floor 1 in ${drawBests.length + 1}; the declared count is 19).`
        : `NULL RULE FAILED: ${nullsAtOrAbove} of ${drawBests.length} null draws matched or beat the winner.`;
    res.json({
      winner: winKey, winnerHold: win.hold, referenceHold: ref.hold, holdWindowsWon: winsVsRef,
      holdPassed, drawCount: drawBests.length, nullsAtOrAbove, nullPassed,
      sentence: `${holdSentence} ${nullSentence}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- History Tuning v2: the paired age-dial instrument (DESIGN-HT2.md) ----
app.post('/api/httwo', async (req, res) => {
  const b = req.body || {};
  try {
    const out = await batch.startHtTwo(b);
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.get('/api/httwo/exams', (req, res) => {
  try {
    const T2 = require('./lib/httwo');
    const docs = batch.listBatches().filter((x) => x.kind === 'httwo').map((x) => batch.getBatch(x.id)).filter(Boolean);
    res.json(T2.examStatus(RELEASE_VERSION, docs));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Forward books: out-of-sample money records for setups whose backtest window
// is spent (lib/forwardbook.js; pre-registered in vps-access
// reports/FORWARD-BOOKS.md before any forward number existed). Recomputed on
// demand rather than stored — training and scoring are frozen to dates, so the
// record is a deterministic function of the cached data and cannot drift.
// Trains members, so it refuses while a sweep holds the box.
// Live pilot screen data (PILOT-F1.md). Read-only view of the executor's
// journal synced from the Mexico box. No trading logic lives here — this only
// renders what the deterministic executor already did (independence rule §4).
app.get('/api/pilot', (req, res) => {
  try {
    // marginFloor (from the view) is what the BOX reports it is ENFORCING;
    // marginFloorRequested is what the owner last SAVED here. They differ for
    // the few minutes it takes the sync to carry the value across, and the
    // screen must be able to say so — otherwise setting a floor looks like
    // nothing happened, which is exactly what the owner hit (2026-08-19).
    res.json({
      ...require('./lib/boxview').status(),
      marginFloorRequested: readMarginFloor().floor ?? null,
      // The owner's recorded CHOICE about the stop, which is a different fact
      // from what the box is enforcing: "no stop, decided" and "no stop, never
      // considered" leave the engine identical and the record must not.
      fixedStopChoice: readFixedStop(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The owner's MASTER SWITCH. These endpoints only record the owner's intent in
// a request file; they place no orders and do not touch the box. The VPS timer
// (pilot-produce-and-push.sh) reconciles the box's ARM flag to this request on
// its next run, and the screen shows "pending" until the box confirms. This
// keeps the classifier server out of the trade path — it writes a flag, nothing
// more. Sessions must never call these: START/STOP is the owner's alone.
function writeArmRequest(on, by) {
  const crypto = require('crypto');
  const dir = path.join(__dirname, 'data', 'pilot');
  dataFs.mkdirSync(dir, { recursive: true });
  // Each button press mints a FRESH nonce + utc so the box can edge-trigger on a
  // genuine START and refuse a stale replay (findings 12/15). If a shared secret
  // is provisioned (PILOT_ARM_SECRET, held by this UI process and the box), the
  // request is HMAC-signed so only the owner's UI can authorise an arm; without
  // it the box falls back to the freshness+nonce edge and journals unauthenticated.
  const nonce = crypto.randomBytes(9).toString('hex');
  const utc = new Date().toISOString();
  const rec = { armed: on, by, utc, nonce };
  const secret = process.env.PILOT_ARM_SECRET || '';
  if (secret) {
    rec.hmac = crypto.createHmac('sha256', secret)
      .update(`${on ? 1 : 0}|${nonce}|${utc}`).digest('hex');
  }
  dataFs.writeFileSync(path.join(dir, 'arm-request.json'), JSON.stringify(rec));
  return { armed: on, by, utc, nonce, authenticated: !!secret };
}
// CSRF guard for the live-money switch (finding C, 2026-08-12 HTTP-surface pass).
// The arm/disarm handlers ignore the request body, so a cross-site <form> POST
// riding the owner's cached Basic Auth could flip the switch. A browser CSRF
// ALWAYS attaches an Origin (sent on every cross-origin POST, and NOT suppressible
// by referrer-policy) — or at least a Referer — pointing at the attacker's site.
// So we REJECT any request whose Origin/Referer host is present and NOT ours.
//
// Chosen deliberately over a custom-header/token scheme because it needs NO client
// change: the live screen's existing fetch already carries a same-origin
// Origin/Referer, so the running button cannot break, and it fails OPEN when those
// headers are absent (e.g. a proxy strips them, or a non-browser curl that would
// need the site credentials anyway and is not a CSRF vector). It fails CLOSED on
// every positively cross-site browser request, INCLUDING one whose Origin is the
// literal "null" that a sandboxed frame or a data:/file: page sends — that is a
// browser naming a cross-site context, not an absent header (fixed 2026-08-21). ALLOWED covers the documented
// public host plus localhost for tests; PILOT_ALLOWED_HOSTS can extend it.
function sameSiteOrNoBrowserOrigin(req) {
  const ALLOWED = new Set(['www.buitendyk.ca', 'buitendyk.ca', '127.0.0.1', 'localhost',
    ...String(process.env.PILOT_ALLOWED_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean)]);
  const src = req.get('Origin') || req.get('Referer') || '';
  if (!src) return true;                 // no browser origin at all -> not a CSRF vector
  let host = null;
  try { host = new URL(src).hostname; } catch (_) { host = null; }
  // AN ORIGIN THAT IS PRESENT BUT NOT AN ADDRESS IS A CROSS-SITE ORIGIN, AND
  // THIS USED TO LET IT THROUGH (found 2026-08-21, and it is the one that
  // mattered). The reasoning above says a browser always names its host, so an
  // unparseable value must be something other than a browser and safe to allow.
  // That is wrong. A page inside a sandboxed frame, and a page loaded from a
  // data: or file: address, are sent by the browser with the literal text
  // "null" — the browser saying "I am from somewhere that cannot be named",
  // which is the exact circumstance this guard exists for. Proved: a request
  // claiming https://evil.example was refused 403 while the identical request
  // claiming "null" was allowed and disarmed the engine.
  //
  // The distinction that matters is PRESENT-AND-UNNAMEABLE versus ABSENT. An
  // absent header still fails open, deliberately, and for the reason already
  // recorded: a proxy that strips it would otherwise break the owner's real
  // button. A header that is present and does not name a host we accept is
  // refused, whatever it says.
  if (!host) return false;
  if (ALLOWED.has(host.toLowerCase())) return true;
  // ALSO accept when the Origin/Referer host equals the request's OWN Host header —
  // a self-consistent same-origin request, whatever host the site is served under.
  // This makes the guard robust to an unexpected serving host (belt to the ALLOWED
  // suspenders), so it still cannot break the legit button; a cross-site forgery
  // (Origin=attacker, Host=our site) still mismatches and is refused.
  const reqHost = (req.get('Host') || '').split(':')[0].toLowerCase();
  if (reqHost && host.toLowerCase() === reqHost) return true;
  return false;
}
function csrfGuard(req, res, next) {
  if (sameSiteOrNoBrowserOrigin(req)) return next();
  return res.status(403).json({ error: 'cross-site request refused (CSRF guard on the live-money switch)' });
}
app.post('/api/pilot/arm', csrfGuard, (req, res) => {
  // A caller that sends {armed:false} to the ARM route means DISARM and has
  // reached the wrong door. Answering it with an arm is how the Trading tab's
  // STOP button silently re-armed the live engine for as long as it existed.
  // Refuse loudly instead of guessing: on the real-money master switch, a
  // contradictory request must fail where the operator can see it.
  if (req.body && req.body.armed === false) {
    return res.status(400).json({
      error: 'this is the ARM route and it always arms — to stop the engine, POST /api/pilot/disarm',
    });
  }
  // AN EMPTY REQUEST IS NOT A YES. This used to arm on anything that was not an
  // explicit refusal, so a request carrying no instruction at all started the
  // live engine. On the one control that puts real money at risk the default
  // must be to refuse: silence is not consent (owner-approved fix, 2026-08-21).
  if (!req.body || req.body.armed !== true) {
    return res.status(400).json({
      error: 'arming the live engine requires an explicit {"armed": true} — a request with no instruction is refused',
    });
  }
  try { res.json({ ok: true, request: writeArmRequest(true, 'owner') }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
// CLEAR THE HALT, from the screen. A halt never self-clears — a gate that fires
// says the instrument is unreliable, and auto-clearing would be the instrument
// marking its own homework. So recovery is deliberate; until now it was also
// only possible with shell access to the box, which is not a mechanism the
// owner has (owner, 2026-08-18: "if it cannot by itself then a mechanism must
// be provided for the user to do that").
//
// This writes a REQUEST, exactly as the arm switch does; the control plane
// carries it on its next sync and the box clears its own flag. It does NOT arm:
// entries still require the master switch, so the worst this can do is let an
// already-armed box resume entries once its halt cause is fixed. If the cause
// is NOT fixed the next reconcile tick re-halts, which is the check working.
function writeUnhaltRequest(by) {
  const crypto = require('crypto');
  const dir = path.join(__dirname, 'data', 'pilot');
  dataFs.mkdirSync(dir, { recursive: true });
  const nonce = crypto.randomBytes(9).toString('hex');
  const utc = new Date().toISOString();
  const rec = { by, utc, nonce };
  const secret = process.env.PILOT_ARM_SECRET || '';
  if (secret) {
    rec.hmac = crypto.createHmac('sha256', secret).update(`unhalt|${nonce}|${utc}`).digest('hex');
  }
  dataFs.writeFileSync(path.join(dir, 'unhalt-request.json'), JSON.stringify(rec));
  return { by, utc, nonce, authenticated: !!secret };
}
app.get('/api/pilot/unhalt-request', (req, res) => {
  try {
    const f = path.join(__dirname, 'data', 'pilot', 'unhalt-request.json');
    res.json({ request: JSON.parse(dataFs.readFileSync(f, 'utf8')) });
  } catch (_) { res.json({ request: null }); }
});
app.post('/api/pilot/unhalt', csrfGuard, (req, res) => {
  try { res.json({ ok: true, request: writeUnhaltRequest('owner') }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/pilot/disarm', csrfGuard, (req, res) => {
  try { res.json({ ok: true, request: writeArmRequest(false, 'owner') }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Live Trading tab backend (IMPLEMENTATION-PLAN phase 1+). One-line mount so
// the module boundary holds — all live-trading code lives in lib/live/.
require('./lib/live/routes').installLiveRoutes(app, { csrfGuard });

// PROTECTIVE-STOP TUNER (owner 2026-08-11). For a prospective live setup that has
// no existing stop, replay its frozen committee over the WHOLE history and tune
// the tightest fixed stop that loses no winner. The result is persisted to
// data/pilot/stop-sweep.json; the VPS sync (pilot-produce-and-push.sh) carries the
// determined FIXED_STOP_PCT to the box, and the live screen shows it. Heavy
// (loads full history + trains), so it runs in the background and the UI polls.
// This writes a RISK PARAMETER, not an authorization to trade — it opens nothing.
function stopSweepPath() {
  const dir = path.join(__dirname, 'data', 'pilot');
  dataFs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'stop-sweep.json');
}
function readStopSweep() {
  try { return JSON.parse(dataFs.readFileSync(stopSweepPath(), 'utf8')); } catch (_) { return { status: 'idle' }; }
}
function writeStopSweep(obj) {
  const f = stopSweepPath();
  dataFs.writeFileSync(`${f}.tmp`, JSON.stringify(obj));
  dataFs.renameSync(`${f}.tmp`, f);
}
// The APPLIED stop is separate from the scan (owner: running the scan must NOT set
// a stop — it shows options; the owner then CHOOSES one or none). fixed-stop.json
// holds the chosen value the VPS sync carries; stopPct null = no stop (the sync
// then removes FIXED_STOP_PCT from the box).
function fixedStopPath() { return path.join(__dirname, 'data', 'pilot', 'fixed-stop.json'); }
// A CHOSEN "none" AND A NEVER-CHOSEN "none" ARE DIFFERENT FACTS (owner,
// 2026-08-19, after the full-history scan came back saying every stop level
// loses money). The engine behaves identically either way — no stop is no stop
// — but the RECORD must tell them apart, or a deliberate decision taken against
// seven years of evidence is indistinguishable from nobody ever getting round
// to it. `chosen` is false only when no file exists at all.
function readFixedStop() {
  try {
    const r = JSON.parse(dataFs.readFileSync(fixedStopPath(), 'utf8'));
    return { chosen: true, why: null, ...r };
  } catch (_) { return { stopPct: null, chosen: false, why: null }; }
}
function writeFixedStop(obj) {
  dataFs.mkdirSync(path.join(__dirname, 'data', 'pilot'), { recursive: true });
  const f = fixedStopPath();
  dataFs.writeFileSync(`${f}.tmp`, JSON.stringify(obj));
  dataFs.renameSync(`${f}.tmp`, f);
}

// THE MARGIN FLOOR (owner, 2026-08-19). Margin level is collateral / debt on the
// isolated wallet — how far the account is from a forced liquidation. This engine
// borrows to short and nothing read that number, so there was no brake on it at
// all. Same shape and same carry path as the stop above, deliberately: the owner
// chooses the number through the interface and the sync puts it on the box.
// null = no floor, which is the state until they set one. A threshold that stops
// trading is not mine to pick, so there is NO default value anywhere.
function marginFloorPath() { return path.join(__dirname, 'data', 'pilot', 'margin-floor.json'); }
function readMarginFloor() {
  try { return JSON.parse(dataFs.readFileSync(marginFloorPath(), 'utf8')); } catch (_) { return { floor: null }; }
}
function writeMarginFloor(obj) {
  dataFs.mkdirSync(path.join(__dirname, 'data', 'pilot'), { recursive: true });
  const f = marginFloorPath();
  dataFs.writeFileSync(`${f}.tmp`, JSON.stringify(obj));
  dataFs.renameSync(`${f}.tmp`, f);
}
app.post('/api/pilot/margin-floor', csrfGuard, (req, res) => {
  try {
    const raw = req.body ? req.body.floor : null;
    let v = null;
    if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
      v = Number(raw);
      if (!Number.isFinite(v) || v <= 0) {
        return res.status(400).json({ error: 'floor must be a positive margin level (e.g. 2 for 2.0), or blank to clear' });
      }
      // Binance liquidates around 1.0-1.3; a floor at or below that would only
      // fire after the exchange had already acted, which is not a brake.
      if (v <= 1.3) {
        return res.status(400).json({ error: `a floor of ${v} sits in the exchange's own liquidation range — it would fire too late to protect anything. Choose a higher level.` });
      }
      if (v > 1000) return res.status(400).json({ error: `a floor of ${v} would halt on almost any borrowing at all` });
    }
    writeMarginFloor({ floor: v, by: 'owner', utc: new Date().toISOString() });
    res.json({ ok: true, marginFloor: readMarginFloor() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// Which pairs the trading setups need, from lib/live/pairs.js — the ONE
// definition. The VPS checking scripts read this instead of each re-deriving it
// (owner, 2026-08-19): four copies of one rule had already disagreed once, and
// the disagreement showed up as a green line for a pair nobody was watching.
app.get('/api/live/pairs', (req, res) => {
  try {
    const { pairsInUse, ACTIVE_STATES } = require('./lib/live/pairs');
    res.json({ pairs: pairsInUse(), states: ACTIVE_STATES });
  } catch (err) {
    // An unreadable registry is NOT an empty pair list. Saying "no pairs" would
    // read to every caller as "nothing needs watching", which is the opposite
    // of what an unreadable registry means.
    res.status(500).json({ error: err.message });
  }
});
// What can have a protective stop tuned: anything WITHOUT one already (a market
// entry with no trailing stop — a breakout cell's opposite rail already IS its
// stop, so tuning one is meaningless).
//
// THE OWNER'S OWN PROFILES WERE NOT IN THIS LIST (fixed 2026-08-19). It returned
// the three pre-registered research books and nothing else, so the setup they
// actually have money in could not be selected for tuning from any screen. That
// is the complaint in one endpoint: the software knew about its built-in books
// and not about the thing its owner built.
//
// Profiles come first because they are the live question; the research books
// stay listed because tuning one is still a legitimate thing to ask for. Each
// row says which kind it is and carries its own training cutoff, so no scan can
// silently borrow another record's dates.
app.get('/api/pilot/stop-candidates', (req, res) => {
  try {
    const { hasExistingStop } = require('./lib/stopsweep');
    const candidates = [];

    // the owner's profiles, newest first
    try {
      const reg = require('./lib/live/setups');
      const { resolveFreeze } = require('./lib/live/trainpolicy');
      for (const s of reg.listSetups()) {
        if (s.state === 'retired') continue;
        const cfg = s.configSnapshot || {};
        if (!cfg.cell || !cfg.combo) continue;
        if (hasExistingStop(cfg.cell)) continue;
        // A profile with no usable training policy is LISTED and marked, never
        // hidden: silently dropping it is how the owner ends up staring at a
        // list that does not contain their setup with nothing explaining why.
        let freeze = null; let blocked = null;
        try { freeze = resolveFreeze(s); } catch (e) { blocked = e.message; }
        candidates.push({
          kind: 'profile',
          id: s.id,
          name: s.name || s.id,
          state: s.state,
          combo: cfg.combo,
          cell: cfg.cell,
          trainThrough: freeze ? freeze.throughMs : null,
          trainMode: freeze ? freeze.mode : null,
          blocked,
        });
      }
    } catch (e) {
      // The registry being unreadable must not blank the whole list.
      candidates.push({ kind: 'error', id: '(profiles unreadable)', name: '(profiles unreadable)', blocked: e.message });
    }

    // the pre-registered research books, which carry their own frozen dates
    try {
      const { BOOKS, TRAIN_THROUGH } = require('./lib/forwardbook');
      for (const b of BOOKS) {
        if (hasExistingStop(b.cell)) continue;
        candidates.push({ kind: 'book', id: b.id, name: `${b.id} — ${b.note}`,
          combo: b.combo, cell: b.cell, trainThrough: TRAIN_THROUGH, trainMode: 'frozen', blocked: null });
      }
    } catch (_) { /* the record is not required for the owner's own profiles to be tunable */ }

    res.json({ candidates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// Conviction sizing (owner 2026-08-13): price a quorum-agreement clip ladder
// over full history — same frozen replay as the stop sweep, pure $ overlay.
// A scan SHOWS the answer; it changes no sizing anywhere. Background + polled.
// ONE heavy scan at a time (owner 2026-08-14): the stop tuner and the
// conviction sweep replay full history and must never run concurrently — a
// shared mutex gates both, and both UIs disable both launch buttons while
// either runs. Scans are minutes-scale and run to completion; the batch
// runner's Stop jobs (api/abort) covers batch jobs.
let heavyScanRunning = false; // false | 'stop' | 'conviction'
// Owner-driven candidates (point 25): a sweep can target a SELECTED ROW of a
// saved run — the same anchor the greenlight uses — not just the hardcoded
// registry. configFromSelection freezes the row into the shared vocabulary;
// the training freeze is the selecting run's own fire time.
function bookFromScanBody(b) {
  if (b && b.runId) {
    const doc = require('./lib/batch').getBatch(String(b.runId));
    if (!doc) { const e = new Error(`no saved run ${b.runId}`); e.status = 404; throw e; }
    const target = String(b.target || 'declared');
    const { cfg } = require('./lib/live/greenlight').configFromSelection(doc, target);
    return {
      book: { id: `${doc.id}:${target}`, combo: cfg.combo, branch: cfg.branch,
        members: cfg.members, cell: cfg.cell },
      // THIS PATH IS A SCAN, NOT A DEPLOYMENT. It replays a lab row over history
      // ad hoc, so there is no deployment whose training policy could apply. It
      // used to read cfg.trainThrough, which the greenlight set from the run's
      // fire time; that field is gone from the rule shape, so the same instant is
      // taken directly and named for what it is — the scan's assumed freeze.
      // Behaviour is unchanged, deliberately: Stage A moves where the freeze
      // lives, it does not change any number.
      opts: (() => { const assumed = Date.parse(doc.startedAt || doc.finishedAt || '');
        if (!Number.isFinite(assumed)) { const e = new Error('run carries no startedAt — cannot place the scan freeze'); e.status = 400; throw e; }
        return { trainThrough: assumed, scoreFrom: assumed + 1 }; })(),
    };
  }
  // A PROFILE, resolved from the registry with ITS OWN training cutoff. This
  // path did not exist: the only non-run target was a built-in book, defaulting
  // to a hardcoded id, so the owner could not aim a scan at their own setup.
  if (b && b.setupId) {
    const reg = require('./lib/live/setups');
    const { resolveFreeze } = require('./lib/live/trainpolicy');
    const s = reg.getSetup(String(b.setupId));
    if (!s) { const e = new Error(`no such profile ${b.setupId}`); e.status = 404; throw e; }
    const cfg = s.configSnapshot || {};
    if (!cfg.combo || !cfg.cell) {
      const e = new Error(`profile ${s.id} carries no config to scan`); e.status = 400; throw e;
    }
    // The freeze comes from the PROFILE's deployment policy — frozen at the
    // instant it names, or rolling, in which case "now" is the honest cutoff.
    const freeze = resolveFreeze(s);
    return {
      book: { id: s.id, combo: cfg.combo, branch: cfg.branch, members: cfg.members, cell: cfg.cell },
      opts: { trainThrough: freeze.throughMs, scoreFrom: freeze.throughMs + 1 },
    };
  }

  // A PRE-REGISTERED RESEARCH BOOK, which supplies its own frozen dates. No
  // default id any more: scanning "whatever was hardcoded" when the caller named
  // nothing is how a screen ends up reporting one setup's numbers under another
  // setup's heading.
  const { BOOKS, TRAIN_THROUGH, SCORE_FROM } = require('./lib/forwardbook');
  const bookId = String((b && b.bookId) || '');
  if (!bookId) {
    const e = new Error('name what to scan: setupId for one of your profiles, '
      + 'bookId for a pre-registered book, or runId for a row of a saved run');
    e.status = 400; throw e;
  }
  const book = BOOKS.find((x) => x.id === bookId);
  if (!book) { const e = new Error(`no such setup ${bookId}`); e.status = 404; throw e; }
  return { book, opts: { trainThrough: TRAIN_THROUGH, scoreFrom: SCORE_FROM } };
}
function convictionSweepPath() {
  const dir = path.join(__dirname, 'data', 'pilot');
  dataFs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'conviction-sweep.json');
}
function readConvictionSweep() {
  try { return JSON.parse(dataFs.readFileSync(convictionSweepPath(), 'utf8')); } catch (_) { return { status: 'idle' }; }
}
function writeConvictionSweep(obj) {
  const f = convictionSweepPath();
  dataFs.writeFileSync(`${f}.tmp`, JSON.stringify(obj));
  dataFs.renameSync(`${f}.tmp`, f);
}
app.get('/api/pilot/convictionsweep', (req, res) => res.json(readConvictionSweep()));
app.get('/api/pilot/heavyscan', (req, res) => res.json({ running: heavyScanRunning || false }));
app.post('/api/pilot/convictionsweep', (req, res) => {
  try {
    if (heavyScanRunning) return res.status(409).json({ error: `a heavy scan is already running (${heavyScanRunning}) — one at a time` });
    const { computeConvictionSweep } = require('./lib/convictionsweep');
    const { hasExistingStop } = require('./lib/stopsweep');
    const { book, opts } = bookFromScanBody(req.body || {});
    if (hasExistingStop(book.cell)) {
      return res.status(400).json({ error: `${book.id} is not a market-entry cell; conviction pricing does not apply` });
    }
    heavyScanRunning = 'conviction';
    writeConvictionSweep({ status: 'running', bookId: book.id, startedUtc: new Date().toISOString() });
    (async () => {
      try {
        const r = await computeConvictionSweep(book, opts);
        writeConvictionSweep({ status: 'done', bookId: book.id,
          finishedUtc: new Date().toISOString(), ...r });
      } catch (e) {
        writeConvictionSweep({ status: 'error', bookId: book.id,
          finishedUtc: new Date().toISOString(), error: String((e && e.message) || e).slice(0, 300) });
      } finally {
        heavyScanRunning = false;
      }
    })();
    res.json({ ok: true, status: 'running', bookId: book.id });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});
app.get('/api/pilot/stopsweep', (req, res) => res.json(readStopSweep()));
app.post('/api/pilot/stopsweep', (req, res) => {
  try {
    if (heavyScanRunning) return res.status(409).json({ error: `a heavy scan is already running (${heavyScanRunning}) — one at a time` });
    const { computeSetupStop, hasExistingStop } = require('./lib/stopsweep');
    const { book, opts } = bookFromScanBody(req.body || {});
    if (hasExistingStop(book.cell)) {
      return res.status(400).json({ error: `${book.id} already has a protective stop; tuning does not apply` });
    }
    heavyScanRunning = 'stop';
    writeStopSweep({ status: 'running', bookId: book.id, startedUtc: new Date().toISOString() });
    // fire and forget; the UI polls GET /api/pilot/stopsweep
    (async () => {
      try {
        const r = await computeSetupStop(book, opts);
        // The scan only SHOWS options — it applies nothing. The owner chooses a
        // value (or none) via POST /api/pilot/stop-apply.
        writeStopSweep({ status: 'done', bookId: book.id,
          finishedUtc: new Date().toISOString(), ...r });
      } catch (e) {
        writeStopSweep({ status: 'error', bookId: book.id,
          finishedUtc: new Date().toISOString(), error: String((e && e.message) || e).slice(0, 300) });
      } finally {
        heavyScanRunning = false;
      }
    })();
    res.json({ ok: true, status: 'running', bookId: book.id });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});
// The owner's CHOICE of stop after seeing the scan: a positive fraction to apply,
// or NULL to clear (no stop). Only this drives the live engine — a scan never
// does. Writes a risk parameter; opens nothing.
//
// Null, not zero. This comment used to say "null/0" while the guard below refuses
// anything <= 0, and the Constructing tab believed the comment: its "No stop
// (clear)" button sent 0 and got a 400 every time, so the stop could not be
// cleared from that tab at all. Zero stays REFUSED on purpose — an empty box
// parses to 0, and a parse slip must not silently strip a live risk parameter.
// THE FLOOR TRAVELS WITH THE ANSWER (owner order, 2026-08-23). The Tune section
// used to carry its own copy of 0.5% in an input's min=, a tooltip and an alert,
// kept in step with the server by a test. A number the screen restates is a
// number that goes stale; the screen reads it from here now.
app.get('/api/pilot/fixed-stop', (req, res) => res.json({
  ...readFixedStop(),
  feePerLeg: paper.FEE_PER_LEG,
  roundTripPct: paper.roundTripPct(paper.FEE_PER_LEG),
  floorPct: paper.minStopPct(paper.FEE_PER_LEG),
  // WHOSE FEE THIS IS. This control writes the live engine's own risk
  // parameter, not a chosen profile's, so there is no profile fee to follow
  // here — it is the lab rate and the screen says so rather than implying the
  // floor moved with something the owner set.
  floorFrom: 'lab rate',
}));
// csrfGuard, matching POST /api/pilot/margin-floor. This route sets the
// protective stop on the live rule and had no guard at all while its declared
// twin did — the difference was an oversight, not a decision.
app.post('/api/pilot/stop-apply', csrfGuard, (req, res) => {
  try {
    // "NO STOP" AND "YOU DID NOT SAY" ARE DIFFERENT ANSWERS. An empty request
    // used to be recorded as the owner deliberately choosing to run with no
    // protective stop, and the screen then displayed that as their decision.
    // Clearing the stop is a real choice and must be made explicitly: the
    // No stop (clear) button sends stopPct: null, so requiring the field to be
    // PRESENT refuses silence without touching either real button.
    if (!req.body || !Object.prototype.hasOwnProperty.call(req.body, 'stopPct')) {
      return res.status(400).json({
        error: 'stopPct must be given explicitly — send a fraction to set a stop, or null to clear it. A request that says nothing is refused.',
      });
    }
    const raw = req.body.stopPct;
    let v = null;
    if (raw != null && raw !== '') {
      v = Number(raw);
      if (!Number.isFinite(v) || v <= 0) {
        return res.status(400).json({ error: 'stopPct must be a positive fraction (e.g. 0.11 for 11%), or null to clear' });
      }
      if (v >= 1) return res.status(400).json({ error: 'stopPct is a fraction of entry price; refusing a value >= 1' });
      // MINIMUM-STOP FLOOR (CONTROL BUG 2, 2026-08-11 e2e review). A stop tighter
      // than ordinary hourly noise stops out on microstructure wiggle, not on a
      // real adverse move — it converts winners into fee-paying losses and can
      // churn a position out on the first tick. The scan never proposes anything
      // this tight; this only guards a hand-typed value.
      //
      // DERIVED, and now actually derived (owner order, 2026-08-23). This said
      // "DERIVED floor = 0.5%: it is 2x the 0.25% round-trip fee" and then wrote
      // the literal 0.005, which stopped being that arithmetic the day the fee
      // became a per-profile setting. lib/paper.js owns it.
      //
      // This route writes the live engine's OWN risk parameter — the scan target
      // above chooses what is scanned, not what this changes — so there is no
      // profile here whose fee to follow, and it is the lab rate. Said out loud
      // rather than left to look like it followed something.
      const MIN_STOP_PCT = paper.minStopPct(paper.FEE_PER_LEG);
      if (v < MIN_STOP_PCT) {
        const pc = (x) => `${(100 * x).toFixed(3)}%`;
        return res.status(400).json({ error: `stopPct ${v} is below the ${MIN_STOP_PCT} floor (${pc(MIN_STOP_PCT)}) — `
          + `twice the ${pc(paper.roundTripPct(paper.FEE_PER_LEG))} round trip at the lab rate of ${pc(paper.FEE_PER_LEG)} `
          + 'each way. A tighter stop triggers on noise, not on real moves. Choose a wider stop or clear it.' });
      }
    }
    // WHY, not just what. A stop of none is a risk decision; recording the
    // reasoning beside it is what makes it a decision rather than a gap.
    const why = req.body && typeof req.body.why === 'string' ? req.body.why.trim().slice(0, 300) : '';
    writeFixedStop({ stopPct: v, by: 'owner', utc: new Date().toISOString(),
      ...(why ? { why } : {}) });
    res.json({ ok: true, fixedStop: readFixedStop() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/httwo/:id/verdict', (req, res) => {
  try {
    const T2 = require('./lib/httwo');
    const doc = batch.getBatch(String(req.params.id));
    if (!doc || doc.kind !== 'httwo') return res.status(404).json({ error: 'unknown HT v2 run' });
    res.json(T2.httwoVerdict(doc));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/historytuning', async (req, res) => {
  const b = req.body || {};
  try {
    const out = await batch.startHistoryTuning(b);
    res.json(typeof out === 'string' ? { batchId: out } : out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post('/api/historytuning/null', async (req, res) => {
  const b = req.body || {};
  try {
    const out = await batch.startHistoryTuning({ replayOf: b.replayOf, nullShiftSeed: b.nullShiftSeed, label: b.label });
    res.json(typeof out === 'string' ? { batchId: out } : out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post('/api/historytuning/reserve-grade', (req, res) => {
  try {
    const id = batch.startReserveGrade({ sourceHtRunId: (req.body || {}).sourceHtRunId });
    res.json({ batchId: id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/batch/:id', (req, res) => {
  const doc = batch.getBatch(req.params.id);
  if (!doc) return res.status(404).json({ error: 'unknown batch' });
  // THE SAME TRIM AS THE PICKER (owner order, 2026-08-23). One run's document
  // carries the expanded declared set too — 500 KB on the current run, which no
  // screen reads. The rows themselves are already left on disk; this is the
  // last collection in the document that grows with the run's settings.
  //
  // `leaders` is deliberately NOT paged here: it is bounded by the board size
  // the owner set, it is the thing the page is for, and paging it would mean
  // the board could not be sorted on the screen.
  res.json({ ...doc, params: batch.screenParams(doc.params) });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'unknown job (restarted server?) — run again' });
  res.json({ id: job.id, status: job.status, progress: job.progress, result: job.result, error: job.error });
});

// JSON error handler (finding B, 2026-08-12 HTTP-surface pass). Body-parser
// SyntaxErrors (malformed JSON POST) and any error passed to next() would otherwise
// render express's default HTML page WITH a stack trace. Return JSON instead, so the
// client can surface it and no stack leaks. Must be LAST and take four args for
// express to treat it as an error handler. Routes that already res.json() their own
// errors return before reaching here; this is the safety net for the rest.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = Number.isInteger(err && err.status) ? err.status
    : (err && err.type === 'entity.parse.failed') ? 400 : 500;
  const msg = err && err.message ? String(err.message).slice(0, 200) : 'server error';
  res.status(status).json({ error: msg });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`ultimate-trading-system listening on 127.0.0.1:${PORT}`);
});
