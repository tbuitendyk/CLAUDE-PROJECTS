const path = require('path');
const express = require('express');
const { startJob, getJob } = require('./lib/jobs');
const { GEOMETRIES } = require('./lib/dataset');
const { cacheState, cachedMonths, monthlyKlines } = require('./lib/binance');
const throttle = require('./lib/throttle');
const { configuredSize, createPool } = require('./lib/pool');

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

// The /api/cpu pair that served the Construct page's CPU button is GONE with
// the button (owner order, 2026-08-26). The duty cycle's one home is the
// Compute tab, through /api/compute-config below — same throttle, one door.

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

app.get('/api/data-state', (req, res) => res.json({ symbols: cacheState() }));


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

const paper = require('./lib/paper');

app.post('/api/data/download', (req, res) => {
  const b = req.body || {};
  const symbols = (Array.isArray(b.symbols) ? b.symbols : []).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
  if (!symbols.length || symbols.some((x) => !SYMBOL_RE.test(x))) {
    return res.status(400).json({ error: 'symbols must be a list like ["DOTUSDT","PEPEUSDT"]' });
  }
  {
    // the stage-engine check's two fabricated coins are generated, never downloaded
    const hit = symbols.find((x) => require('./lib/stagegate').isExamSymbol(x));
    if (hit) return res.status(400).json({ error: `${hit} is a reserved fabricated coin of the stage-engine check — it is generated, never downloaded` });
  }
  if (!/^\d{4}-\d{2}$/.test(String(b.startMonth)) || !/^\d{4}-\d{2}$/.test(String(b.endMonth))) {
    return res.status(400).json({ error: 'months must be YYYY-MM' });
  }
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
  const state = cacheState();
  // The stage-engine check's fabricated coins never touch Binance: they are
  // generated for the check and deleted when it lands, so a refresh leaves
  // them out.
  const G = require('./lib/stagegate');
  const targets = (one ? state.filter((s2) => s2.symbol === one) : state)
    .filter((s2) => !G.isExamSymbol(s2.symbol));
  if (!targets.length) {
    return res.status(400).json({ error: one ? `${one} has no cached data — use download` : (state.length ? 'nothing to refresh' : 'nothing cached yet') });
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
  res.json({ purged: victims.length, symbol: sym, kept: keepFrom || keepTo ? { keepFrom, keepTo } : null });
});

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

app.post('/api/campaign', (req, res) => {
  try {
    res.json({ name: campaign.setCampaign((req.body || {}).name) });
  } catch (err) {
    res.status(400).json({ error: err.message });
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
  const now = new Date();
  for (const { symbol } of cacheState()) {
    // The stage-engine check's fabricated coins are generated, never fetched —
    // asking Binance for one would 404 every tick forever.
    if (require('./lib/stagegate').isExamSymbol(symbol)) continue;
    // cachedMonths (bundle months only) is DELIBERATE here: this tick's job
    // is fetching newly PUBLISHED bundles, and a month already held as day
    // files still wants its bundle when Binance posts it (the bundle is the
    // durable form; reads prefer it automatically).
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


// ---- the three-stage record sets (Sweep / Boards) ---------------------------
//
// Launches are plan-first and chained: stage 2 reads a finished stage 1 set,
// stage 3 a finished stage 2 set, and a launch refuses — by name — when the
// price files no longer fingerprint identically to the ones the parent read.
// All the arithmetic lives in lib/stages.js + lib/stagework.js; these routes
// only validate shapes and put refusals on the wire as plain sentences.
const stages = require('./lib/stages');

// THE STAGE ENGINE'S OWN PLANTED CHECK (3.87.0): its state, and the press that
// runs it. It fabricates two coins and runs all three stages, so it refuses
// while anything else is going, and everything else refuses while it runs.
app.get('/api/stage-gate/status', (req, res) => res.json(stages.stageGateStatus()));
app.post('/api/stage-gate', (req, res) => {
  try { return res.json(stages.stageGateStart()); } catch (err) { return res.status(409).json({ error: err.message }); }
});

// the stage-engine check's own sets are never listed for a screen
app.get('/api/stagesets', (req, res) => res.json({ running: stages.stageRunning(), sets: stages.listSets().filter((s) => !s.exam), nextNames: stages.nextNames() }));

app.get('/api/stageset/:id', (req, res) => {
  const doc = stages.getSet(req.params.id);
  if (!doc) return res.status(404).json({ error: `no record set called "${req.params.id}"` });
  const { plan, ...rest } = doc;
  return res.json({
    set: { ...rest, plan: plan ? { units: plan.units || 0, settings: plan.settings || 0 } : null },
    chain: stages.chainOf(doc.id),
    // the actual date ranges the set used (3.85.0)
    windows: stages.windowsOfSet(doc),
  });
});

// Anything in the query that is not paging is a FILTER, and an unknown one
// is refused by name rather than quietly dropped — a filter the screen shows
// and the service ignores is worse than no filter at all.
const filtersOf = (q) => {
  const out = {};
  for (const [k, v] of Object.entries(q || {})) {
    if (k === 'from' || k === 'n') continue;
    if (v !== '' && v != null) out[k] = v;
  }
  return out;
};
app.get('/api/stageset/:id/stage1', (req, res) => {
  try {
    const out = stages.stage1Table(req.params.id, Math.max(0, Number(req.query.from) || 0), Math.max(1, Math.min(500, Number(req.query.n) || 100)), filtersOf(req.query));
    if (!out) return res.status(404).json({ error: 'no such record set' });
    return res.json(out);
  } catch (err) { return res.status(400).json({ error: err.message }); }
});
app.get('/api/stageset/:id/stage2', (req, res) => {
  try {
    const out = stages.stage2Table(req.params.id, Math.max(0, Number(req.query.from) || 0), Math.max(1, Math.min(500, Number(req.query.n) || 100)), filtersOf(req.query));
    if (!out) return res.status(404).json({ error: 'no such record set' });
    return res.json(out);
  } catch (err) { return res.status(400).json({ error: err.message }); }
});
// A finished set whose tables are missing (a restart or a death mid-total)
// totals itself when opened: these two answer with how far that has got
// instead of a bare refusal, and the page asks again until the tables land.
// one filling-in at a time, in the service that owns the pool
let fillIn = null;
let dropping = null;   // the pass that drops settings the block no longer declares
let undoing = null;    // the pass that undoes what an unfinished fill-in left
app.get('/api/stageset/:id/ranked', (req, res) => {
  let out;
  try {
    out = stages.stage3Ranked(req.params.id, Math.max(0, Number(req.query.from) || 0), Math.max(1, Math.min(500, Number(req.query.n) || 100)), filtersOf(req.query));
  } catch (err) { return res.status(400).json({ error: err.message }); }
  if (!out) {
    const t = stages.ensureTally(req.params.id);
    if (t.totalling || t.waiting || t.failed) return res.json({ totalling: t.totalling || null, waiting: t.waiting || null, failed: t.failed || null });
    return res.status(404).json({ error: 'this set has no totalled tables yet' });
  }
  return res.json(out);
});
// ---- THE FUNNEL: the step between Boards and Verify -----------------------------
//
// ONE READ RETURNS THE WHOLE STATE OF THE WALK. A route per step would apply the
// rule in several places, and the survivor count on step 2 and the one the cut
// writes would be free to become two different numbers.
app.post('/api/funnel/:id/read', async (req, res) => {
  let out;
  try {
    // async since §17: a unit's board is read from its records the first
    // time it is asked for, yielding between blocks
    out = await stages.funnelRead(req.params.id, req.body || {});
  } catch (err) { return res.status(400).json({ error: err.message }); }
  if (!out) {
    // no tally yet: the same answer the tables give, so the screen starts a
    // totalling rather than reporting an empty board
    const t = stages.ensureTally(req.params.id);
    if (t.totalling || t.waiting || t.failed) return res.json({ totalling: t.totalling || null, waiting: t.waiting || null, failed: t.failed || null });
    return res.status(404).json({ error: 'this set has no totalled tables yet' });
  }
  return res.json(out);
});

// Step 6: work out the numbers stage 3 did not store, for the survivors only.
//
// STARTED, THEN POLLED (3.81.0, owner order 2026-09-07: "needs to not time out
// after 1 minute"). It used to do the pricing inside this POST, holding the
// request open for as long as it took -- and the web server in front allows a
// request sixty seconds, so any set big enough to matter timed out while the
// work carried on behind the dead request. Everything else on this screen that
// prices was moved to started-and-polled in 3.67.0; this was the one left.
// The whole of what this handler used to do is in stages.funnelRichStart now,
// so the refusals and the one-at-a-time gate live beside the other pressed
// jobs rather than in the door.
app.post('/api/funnel/:id/rebuild', (req, res) => {
  try { return res.json(stages.funnelRichStart(req.params.id, req.body || {})); }
  catch (err) { return res.status(409).json({ error: err.message }); }
});

// DOES THE RANKING HOLD (3.102.0, SELECTION-DESIGN.md Part 4). Reads stored
// numbers only: no pricing, and nothing from the held-back window or the
// reserve, which is what makes it legal on a screen used for choosing. The
// same set asked twice is answered from the reading already in hand.
app.post('/api/funnel/:id/rankhold', (req, res) => {
  try { return res.json(stages.funnelRankHoldStart(req.params.id, req.body || {})); }
  catch (err) { return res.status(409).json({ error: err.message }); }
});
// AND THE BAR TRAVELS WITH THE POLL, because the answer is the reading WITH the
// bar on it and the owner may have moved the bar since it started. Polling
// through the same POST would restart a reading that failed, on every poll.
app.get('/api/funnel/:id/rankhold', (req, res) => res.json(stages.funnelRankHoldStatus(req.params.id, req.query || {})));
app.get('/api/funnel/:id/rebuild', (req, res) => res.json(stages.funnelRichStatus(req.params.id)));

// HOW MANY THE RULE ON SCREEN WOULD KEEP (3.81.0, owner order). Asked while the
// two limits on step 6 are being typed, so it must be cheap and it must be the
// SAME arithmetic the walk uses -- the page sends a whole rule, this counts what
// it keeps, and nothing here knows which boxes the caller was typing in.
app.post('/api/funnel/:id/keeps', async (req, res) => {
  try { return res.json((await stages.funnelKeeps(req.params.id, req.body || {})) || { keeps: null, of: null }); }
  catch (err) { return res.status(400).json({ error: err.message }); }
});

// Step 7: write the Stage 4 set. The rule is what is written, not the rows it
// happened to pick today, and the cut checks its own replay before saving.
// Step 4 on a unit's board (§17.3): the same rule on each of the other units,
// read one at a time. Pressed, started in the background and polled -- nine
// boards is about a minute, and the web server in front allows a request
// sixty seconds. POST starts it (or answers from the run already made for
// this rule); GET reports how far it is and hands the result over.
app.post('/api/funnel/:id/across', (req, res) => {
  try { return res.json(stages.funnelAcrossStart(req.params.id, req.body || {})); }
  catch (err) { return res.status(400).json({ error: err.message }); }
});
app.get('/api/funnel/:id/across', (req, res) => res.json(stages.funnelAcrossStatus(req.params.id)));

// WHICH CROSSES ARE WORTH READING (§18a): started on the box, polled by the
// page, one reading at a time. Read-only -- it writes nothing and changes no
// rule; it only says which pairs of dials are worth gridding.
app.post('/api/funnel/:id/crosses', (req, res) => {
  try { return res.json(stages.funnelCrossesStart(req.params.id, req.body || {})); }
  catch (err) { return res.status(409).json({ error: err.message }); }
});
app.get('/api/funnel/:id/crosses', (req, res) => res.json(stages.funnelCrossesStatus(req.params.id)));

// STARTED, THEN POLLED (3.67.0, owner order): the press starts it and comes
// straight back, the page asks how far it is, and no request is held open long
// enough for the gateway in front to give up on it -- which is what happened,
// and which also made every other screen look dead while it ran.
app.post('/api/funnel/:id/cut', (req, res) => {
  try { return res.json(stages.cutFunnelSetStart(req.params.id, req.body || {})); }
  catch (err) { return res.status(409).json({ error: err.message }); }
});
app.get('/api/funnel/:id/cut', (req, res) => res.json(stages.cutFunnelSetStatus(req.params.id)));

// PUTTING A STAGE 4 SET'S REBUILT NUMBERS BACK (3.68.0, owner order). Its own
// survivors, priced again from the parent's records, added to the shared file
// and stamped onto the set. Started and polled, like everything that prices.
app.post('/api/funnel/set/:id/rebuild', (req, res) => {
  try { return res.json(stages.rebuildSetRichStart(req.params.id)); }
  catch (err) { return res.status(409).json({ error: err.message }); }
});
app.get('/api/funnel/set/:id/rebuild', (req, res) => res.json(stages.rebuildSetRichStatus(req.params.id)));

app.get('/api/funnel/sets', (req, res) => {
  const parent = req.query.parent ? String(req.query.parent) : null;
  return res.json({
    sets: stages.listFunnelSets(parent).filter((d) => !d.exam).map((d) => ({
      id: d.id, seq: d.seq, name: d.name, createdAt: d.createdAt,
      parent: d.parent, unit: d.unit || null, unitName: d.unitName || null, target: d.target, counts: d.counts,
      ruleSentence: d.ruleSentence || null, warnings: d.warnings || [],
      closing: d.closing, boardNull: d.boardNull, release: d.release,
      steps: (d.steps || []).length, backSteps: (d.backSteps || []).length,
      // the marks ride with the set wherever it is listed (§16.5)
      marks: d.marks || [],
      // and whether a verdict is stamped on it (3.86.0)
      verify: stages.verifySummaryOf(d),
      // a half-life set says what it was built from (3.95.0); its standing is that set's
      derived: d.derived || null,
    })),
  });
});

// ONE STAGE 4 SET'S OWN VIEW (3.58.0): the settings it kept, with the numbers
// from the board it was cut from. Read-only -- it writes nothing, changes no
// rule, and starts nothing.
app.get('/api/funnel/set/:id/rows', async (req, res) => {
  let out;
  try {
    out = await stages.funnelSetRows(req.params.id, {
      sort: req.query.sort, dir: req.query.dir,
    });
  } catch (err) { return res.status(400).json({ error: err.message }); }
  if (out && out.needsTally) {
    // its parent has no tables yet: the same answer the walk gives, so the screen
    // starts a totalling rather than reporting an empty set
    const t = stages.ensureTally(out.needsTally);
    if (t.totalling || t.waiting || t.failed) return res.json({ totalling: t.totalling || null, waiting: t.waiting || null, failed: t.failed || null });
    return res.status(404).json({ error: 'the stage 3 set this was cut from has no totalled tables yet' });
  }
  return res.json(out);
});

// VERIFY: THE VERDICT ON A STAGE 4 RECORD SET (3.86.0). The GET is the dry read:
// the record's footing, its marks and the blocks already stamped, and no
// held-back figure. The POST is the stamped look, started and polled; the read
// itself is the only thing that opens the held-back window on Verify.
app.get('/api/funnel/set/:id/verify', async (req, res) => {
  try { return res.json(await stages.funnelVerifyDry(req.params.id)); } catch (err) { return res.status(400).json({ error: err.message }); }
});
app.post('/api/funnel/set/:id/verify', (req, res) => {
  try { return res.json(stages.funnelVerifyStart(req.params.id, req.body || {})); } catch (err) { return res.status(409).json({ error: err.message }); }
});
app.get('/api/funnel/set/:id/verify/status', (req, res) => res.json(stages.funnelVerifyStatus(req.params.id)));
// the rule on the other units' held-back windows (V6) and the held-back ride
// (V7), 3.88.0: each started and polled, each appended to the set, neither a gate
app.post('/api/funnel/set/:id/others', (req, res) => {
  try { return res.json(stages.funnelOthersStart(req.params.id, req.body || {})); } catch (err) { return res.status(409).json({ error: err.message }); }
});
app.get('/api/funnel/set/:id/others/status', (req, res) => res.json(stages.funnelOthersStatus(req.params.id)));
// WHAT THE SETTINGS THE RULE DROPPED DID ON THE SAME WINDOW (V8, 3.100.0,
// SELECTION-DESIGN.md Part 7). It prices nothing -- every figure is already on
// the board -- so it answers in one request rather than being polled. It is
// still a read of the held-back window, so it is a counted look, and it is
// information only: it never gates a set.
app.post('/api/funnel/set/:id/dropped', async (req, res) => {
  try { return res.json(await stages.funnelDroppedStart(req.params.id, req.body || {})); } catch (err) { return res.status(409).json({ error: err.message }); }
});
app.post('/api/funnel/set/:id/ride', (req, res) => {
  try { return res.json(stages.funnelRideStart(req.params.id)); } catch (err) { return res.status(409).json({ error: err.message }); }
});
app.get('/api/funnel/set/:id/ride/status', (req, res) => res.json(stages.funnelRideStatus(req.params.id)));
// THE RESERVE GRADE ON A STAGE 4 RECORD SET (3.89.0), on History: the GET is
// the dry read (the gate, the seal, the looks so far, the grades stamped), the
// POST prices the unread window, started and polled; every grade is a counted look
app.get('/api/funnel/set/:id/unread', async (req, res) => {
  try { return res.json(await stages.unreadGradeDry(req.params.id)); } catch (err) { return res.status(400).json({ error: err.message }); }
});
app.post('/api/funnel/set/:id/unread', (req, res) => {
  try { return res.json(stages.unreadGradeStart(req.params.id, req.body || {})); } catch (err) { return res.status(409).json({ error: err.message }); }
});
app.get('/api/funnel/set/:id/unread/status', (req, res) => res.json(stages.unreadGradeStatus(req.params.id)));
// THE PER-TRADE CAPTURE OF A STAGE 4 RECORD SET (3.92.0), on Tune: the GET is
// the dry read (the gate, the capture on record and its looks), the POST
// captures the survivors' trades, started and polled
app.get('/api/funnel/set/:id/capture', async (req, res) => {
  try { return res.json(await stages.tuneCaptureDry(req.params.id)); } catch (err) { return res.status(400).json({ error: err.message }); }
});
app.post('/api/funnel/set/:id/capture', (req, res) => {
  try { return res.json(stages.tuneCaptureStart(req.params.id)); } catch (err) { return res.status(409).json({ error: err.message }); }
});
app.get('/api/funnel/set/:id/capture/status', (req, res) => res.json(stages.tuneCaptureStatus(req.params.id)));
// THE HISTORY HALF-LIFE RUN (3.94.0): the GET is the dry read (the gate, the
// set's layout and its judge, the runs so far), the POST retrains the set's
// records at the ticked half-lives and prices them, started and polled
app.get('/api/funnel/set/:id/halflife', async (req, res) => {
  try { return res.json(await stages.halfLifeDry(req.params.id)); } catch (err) { return res.status(400).json({ error: err.message }); }
});
app.post('/api/funnel/set/:id/halflife', (req, res) => {
  try { return res.json(stages.halfLifeStart(req.params.id, req.body || {})); } catch (err) { return res.status(409).json({ error: err.message }); }
});
app.get('/api/funnel/set/:id/halflife/status', (req, res) => res.json(stages.halfLifeStatus(req.params.id)));
// the 4.h set built from a half-life table (3.95.0): the rows a half-life won, each carrying its half-life
app.post('/api/funnel/set/:id/halflife/build', (req, res) => {
  try { return res.json({ ok: true, set: stages.buildHalfLifeSet(req.params.id, req.body || {}) }); } catch (err) { return res.status(400).json({ error: err.message }); }
});

app.get('/api/stageset/:id/coins', (req, res) => {
  const out = stages.stage3Coins(req.params.id, req.query || {});
  if (!out) {
    const t = stages.ensureTally(req.params.id);
    if (t.totalling || t.waiting || t.failed) return res.json({ totalling: t.totalling || null, waiting: t.waiting || null, failed: t.failed || null });
    return res.status(404).json({ error: 'this set has no totalled tables yet' });
  }
  return res.json(out);
});
// WHAT THIS SET'S BLOCK DECLARES AND ITS RECORDS DO NOT HOLD, and the door
// that prices it. A set can be priced before its block is whole — the quorum
// bar became a dial after this one ran — and the answer is to price what is
// missing, not to explain the gap away on a screen (owner order, 2026-08-30).
app.get('/api/stageset/:id/missing', (req, res) => {
  const out = stages.missingSettingsOf(req.params.id);
  if (!out) return res.status(404).json({ error: 'no such stage 3 record set' });
  return res.json(out);
});
// THE SETTING NAMES, BROUGHT UP TO DATE (owner order, 2026-08-30). Same shape
// as filling in below it: started once, watched by asking, and it says what
// went wrong rather than going quiet.
// THE SETTINGS THE BLOCK NO LONGER DECLARES, DROPPED (owner order,
// 2026-08-30). Same shape as the two beside it. It deletes priced records, so
// every refusal it can make is made inside stages, not here.
app.post('/api/stageset/:id/drop-undeclared', (req, res) => {
  if (dropping && !dropping.done) return res.json({ running: dropping.id, done: dropping.progress.done, total: dropping.progress.total });
  const id = String(req.params.id || '');
  const doc = stages.getSet(id);
  if (!doc || doc.stage !== 3) return res.status(404).json({ error: 'no such stage 3 record set' });
  const run = { id, done: false, error: null, settings: 0, rows: 0, progress: { done: 0, total: 0 } };
  dropping = run;
  run.promise = (async () => {
    try {
      const out = await stages.dropUndeclaredSettings(doc, (dn, tn) => { run.progress = { done: dn, total: tn }; });
      run.settings = out.settings || 0;
      run.rows = out.rows || 0;
    } catch (err) {
      run.error = String(err.message || err);
    } finally {
      run.done = true;
    }
  })();
  return res.json({ started: true });
});
app.get('/api/stageset/:id/drop-undeclared/status', (req, res) => {
  if (!dropping || dropping.id !== String(req.params.id || '')) return res.json({ idle: true });
  return res.json({
    running: !dropping.done, done: dropping.progress.done, total: dropping.progress.total,
    settings: dropping.settings, rows: dropping.rows, error: dropping.error,
  });
});
// CHECKING A SET IS A USER FUNCTION (owner, 2026-08-30). Read-only: it opens
// the records, adds nothing, changes nothing, and answers with what it found.
app.get('/api/stageset/:id/check', (req, res) => {
  const doc = stages.getSet(String(req.params.id || ''));
  if (!doc || doc.stage !== 3) return res.status(404).json({ error: 'no such stage 3 record set' });
  try {
    const own = stages.auditRecordSet(doc);
    let block = null;
    try { block = stages.auditAgainstBlock(doc); } catch (err) { block = { why: err.message }; }
    return res.json({ ...own, block });
  } catch (err) { return res.status(500).json({ error: err.message }); }
});
app.post('/api/stageset/:id/fill-in', (req, res) => {
  if (fillIn && !fillIn.done) return res.json({ running: fillIn.id, done: fillIn.progress.done, total: fillIn.progress.total });
  const id = String(req.params.id || '');
  let plan;
  try { plan = stages.missingSettingsOf(id); } catch (err) { return res.status(400).json({ error: err.message }); }
  if (!plan) return res.status(404).json({ error: 'no such stage 3 record set' });
  if (plan.why) return res.status(400).json({ error: plan.why });
  if (!plan.missing) return res.json({ already: true, held: plan.held });
  const run = { id, done: false, error: null, added: 0, stop: false, stopped: false,
    progress: { done: 0, total: plan.units || 0 } };
  fillIn = run;
  run.promise = (async () => {
    let pool = null;
    try {
      pool = stages.createPoolForFillIn();
      const out = await stages.appendMissingSettings(stages.getSet(id), pool,
        (dn, tn) => { run.progress = { done: dn, total: tn }; },
        () => run.stop);
      run.added = out.added || 0;
      run.stopped = !!out.stopped;
    } catch (err) {
      run.error = String(err.message || err);
    } finally {
      if (pool) pool.abort();
      run.done = true;
    }
  })();
  return res.json({ started: true, settings: plan.missing, units: plan.units, pricings: plan.pricings });
});
app.get('/api/stageset/:id/fill-in/status', (req, res) => {
  if (!fillIn || fillIn.id !== String(req.params.id || '')) return res.json({ idle: true });
  return res.json({
    running: !fillIn.done, done: fillIn.progress.done, total: fillIn.progress.total,
    added: fillIn.added, error: fillIn.error, stopping: !!fillIn.stop && !fillIn.done, stopped: !!fillIn.stopped,
  });
});
// STOPPING IT IS A USER FUNCTION (owner order, 2026-08-30; RULE FIVE). Until
// now the only way to end a seven-hour pass was to restart the service, which
// is not a control and leaves the half-written append behind either way. Asked,
// not forced: it stops between units, so whole ones are never torn in half.
app.post('/api/stageset/:id/fill-in/stop', (req, res) => {
  if (!fillIn || fillIn.id !== String(req.params.id || '') || fillIn.done) return res.json({ idle: true });
  fillIn.stop = true;
  return res.json({ stopping: true, done: fillIn.progress.done, total: fillIn.progress.total });
});
// AND UNDOING WHAT AN UNFINISHED ONE LEFT.
app.post('/api/stageset/:id/undo-append', (req, res) => {
  if (undoing && !undoing.done) return res.json({ running: undoing.id, done: undoing.progress.done, total: undoing.progress.total });
  const id = String(req.params.id || '');
  const doc = stages.getSet(id);
  if (!doc || doc.stage !== 3) return res.status(404).json({ error: 'no such stage 3 record set' });
  const run = { id, done: false, error: null, rows: 0, progress: { done: 0, total: 0 } };
  undoing = run;
  run.promise = (async () => {
    try {
      const out = await stages.undoUnfinishedAppend(doc, (dn, tn) => { run.progress = { done: dn, total: tn }; });
      run.rows = out.rows || 0;
    } catch (err) {
      run.error = String(err.message || err);
    } finally {
      run.done = true;
    }
  })();
  return res.json({ started: true });
});
app.get('/api/stageset/:id/undo-append/status', (req, res) => {
  const doc = stages.getSet(String(req.params.id || ''));
  const gap = doc ? stages.unfinishedAppend(doc) : null;
  const half = gap && gap.extra > 0 ? gap : null;
  if (!undoing || undoing.id !== String(req.params.id || '')) return res.json({ idle: true, half });
  return res.json({
    running: !undoing.done, done: undoing.progress.done, total: undoing.progress.total,
    rows: undoing.rows, error: undoing.error, half,
  });
});
app.get('/api/stageset/:id/coin-rows', (req, res) => {
  try { return res.json(stages.stage3CoinRows(req.params.id, req.query || {})); }
  catch (err) { return res.status(500).json({ error: err.message }); }
});

// The counters behind the Sweep cost lines — the same enumerators the
// launches run, so the number on the screen and the number that runs can
// never be two different numbers.
app.post('/api/stage1-count', (req, res) => {
  const b = req.body || {};
  try {
    const universe = Array.isArray(b.universe) && b.universe.length ? b.universe.map((s) => String(s).toUpperCase()) : require('./lib/dataset').DEFAULT_PAIRS;
    if (universe.some((p) => !SYMBOL_RE.test(p))) return res.status(400).json({ error: 'trade coins must be symbols like DOTUSDT' });
    // the coins each traded coin is read against (3.75.0). Empty means the
    // traded coins themselves, which is the launch's own rule — the cost line
    // and the launch must never resolve it two different ways.
    const compare = Array.isArray(b.compare) && b.compare.length ? b.compare.map((s) => String(s).toUpperCase()) : [];
    if (compare.some((p) => !SYMBOL_RE.test(p))) return res.status(400).json({ error: 'compare coins must be symbols like DOTUSDT' });
    const geometries = b.permuteGeometry ? Object.keys(require('./lib/dataset').GEOMETRIES) : [b.geometry || 'daily-4d'];
    const units = stages.unitsFor(universe, {
      singles: !!(b.sizes || {}).singles, doubles: !!(b.sizes || {}).doubles, triples: !!(b.sizes || {}).triples,
    }, geometries, compare);
    const { slimViewsFor } = require('./lib/bracketwork');
    const trainings = units.reduce((n, u) => n + slimViewsFor(u.size === 1 ? 1 : 2).length, 0);
    return res.json({ units: units.length, trainings });
  } catch (err) { return res.status(400).json({ error: err.message }); }
});
app.post('/api/stage3-count', (req, res) => {
  try {
    const b = req.body || {};
    // the count rides the SAME resolution the launch runs — the parent's
    // actual carried units decide which agreement bars are declared at all
    // (cellForUnits), and the budget arithmetic rides the same answer the
    // launch will enforce — so the cost line and the refusal can never be
    // two different numbers
    const d = stages.stage3Declared(b);
    // what the units hold between them (3.52.0): a unit prices only the
    // settings that place different orders on it, so the disk gate and the
    // cost line read the sum of what each holds, never settings × units
    const out = { settings: d.settings, declared: d.declared, folded: d.folded, pricings: d.pricings, unitSettings: d.unitSettings, weekdaysApply: d.weekdaysApply, holds: d.holds || [], filtered: d.filtered || null };
    const units = d.units ?? Math.max(0, Math.floor(Number(b.units) || 0));
    const coins = d.coins ?? Math.max(1, Math.floor(Number(b.coins) || 1));
    if (units > 0) {
      out.heap = stages.tallyBudgetFor({ settings: d.settings, coins });
      out.disk = stages.storeBudgetFor({ rows: d.units != null ? d.pricings : d.settings * units });
    }
    return res.json(out);
  } catch (err) { return res.status(400).json({ error: err.message }); }
});

app.post('/api/stage1', (req, res) => {
  const b = req.body || {};
  for (const m of ['startMonth', 'endMonth']) {
    if (!b.allLoaded && b[m] !== undefined && !/^\d{4}-\d{2}$/.test(String(b[m]))) {
      return res.status(400).json({ error: `${m} must be YYYY-MM` });
    }
  }
  if (b.universe !== undefined && b.universe !== null
    && (!Array.isArray(b.universe) || b.universe.some((p) => !SYMBOL_RE.test(String(p).toUpperCase())))) {
    return res.status(400).json({ error: 'universe must be an array of symbols like DOTUSDT' });
  }
  try { return res.json(stages.startStage1(b)); }
  catch (err) { return res.status(409).json({ error: err.message }); }
});
app.post('/api/stage2', (req, res) => {
  try { return res.json(stages.startStage2(req.body || {})); }
  catch (err) { return res.status(409).json({ error: err.message }); }
});
app.post('/api/stage3', (req, res) => {
  try { return res.json(stages.startStage3(req.body || {})); }
  catch (err) { return res.status(409).json({ error: err.message }); }
});
// FILLING IN THE KEPT SCRAMBLES on a set priced before the column existed.
// It runs for hours, so it answers straight away and reports on the set
// document the way every other long job on a set does.
app.post('/api/stageset/:id/kept-fill', (req, res) => {
  // dryRun/onlyUnit are the PROVING run: one unit priced, the whole store
  // walked, nothing written. It is not on any screen — it exists so a change
  // to this pass can be tried in minutes instead of bet on for hours.
  try {
    const b = req.body || {};
    return res.json(stages.startKeptScrambleFill(String(req.params.id || ''), b.keep,
      { dryRun: !!b.dryRun, onlyUnit: b.onlyUnit }));
  }
  catch (err) { return res.status(409).json({ error: err.message }); }
});
// THE UNITS A STAGE 1 RUN LOST, PUT BACK (3.73.0, owner order 2026-09-06).
// Started once and watched by asking, like every other long job here. Every
// refusal it can make is made inside stages, so the reason is one sentence and
// there is only one copy of it.
app.post('/api/stageset/:id/fill-units', (req, res) => {
  try {
    const run = stages.fillMissingUnitsStart(String(req.params.id || ''));
    if (run.already) return res.json({ already: true });
    return res.json({ started: true, units: run.total });
  } catch (err) { return res.status(409).json({ error: String(err.message || err) }); }
});
app.get('/api/stageset/:id/fill-units/status', (req, res) => {
  try { return res.json(stages.fillMissingUnitsStatus(String(req.params.id || ''))); }
  catch (err) { return res.status(400).json({ error: String(err.message || err) }); }
});
app.post('/api/stageset/:id/stop', (req, res) => res.json(stages.cancelStage(req.params.id)));
// A PAUSED STAGE 3 RUN, STARTED AGAIN (3.82.0, owner order). The same gate a
// launch goes through: one heavy job at a time, refused in a sentence.
app.post('/api/stageset/:id/continue', (req, res) => {
  try { return res.json(stages.continueStage3(String(req.params.id || ''))); }
  catch (err) { return res.status(409).json({ error: String(err.message || err) }); }
});
app.post('/api/stageset/:id/notes', (req, res) => {
  try { return res.json(stages.setSetNotes(req.params.id, (req.body || {}).text)); }
  catch (err) { return res.status(400).json({ error: err.message }); }
});
// the owner's name for a record set; a refusal names the set that has it
app.post('/api/stageset/:id/name', (req, res) => {
  try { return res.json(stages.setSetName(req.params.id, (req.body || {}).name)); }
  catch (err) { return res.status(409).json({ error: err.message }); }
});
// THE STAGE 2 TABLE'S FILTERS, SAVED ON THE SET (3.78.0). Every other table's
// filters are a view; these decide what a stage 3 launch prices, so they live
// where the launch can read them — the same contract the sort has.
app.post('/api/stageset/:id/filters', (req, res) => {
  try { return res.json(stages.setSetFilters(req.params.id, (req.body || {}).filters)); }
  catch (err) { return res.status(400).json({ error: String(err.message || err) }); }
});
app.post('/api/stageset/:id/sort', (req, res) => {
  try { return res.json(stages.setSetSort(req.params.id, (req.body || {}).sort)); }
  catch (err) { return res.status(400).json({ error: err.message }); }
});
// the records ticked on a stage 2 table, saved on the set like its sort
app.post('/api/stageset/:id/picked', (req, res) => {
  try { return res.json(stages.setSetPicked(req.params.id, (req.body || {}).picked)); }
  catch (err) { return res.status(400).json({ error: err.message }); }
});
app.post('/api/stageset/:id/delete', (req, res) => {
  try { return res.json(stages.deleteSet(req.params.id, (req.body || {}).confirm)); }
  catch (err) { return res.status(409).json({ error: err.message }); }
});

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
// What the scans on Tune can be aimed at: the Stage 4 record sets that carry a
// per-trade capture (3.92.0). Each row says which set and how many of its
// survivors are captured. The older engine's targets — a saved run's row and
// the live setups, which the scans replayed with the older committee — went
// with that engine (3.97.0).
app.get('/api/pilot/stop-candidates', (req, res) => {
  try {
    const candidates = [];
    // THE STAGE 4 RECORD SETS THAT CARRY A PER-TRADE CAPTURE (3.92.0): a scan
    // on one of these runs on the captured entries of one survivor, over the
    // windows ticked, and applies nothing.
    try {
      for (const c of stages.captureCandidates()) candidates.push(c);
    } catch (e) {
      candidates.push({ kind: 'error', id: '(Stage 4 record sets unreadable)', name: '(Stage 4 record sets unreadable)', blocked: e.message });
    }

    res.json({ candidates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// A SCAN AIMED AT A STAGE 4 RECORD SET (3.92.0) reads the captured entries of
// one survivor instead of replaying a committee; the same mutex, the same
// result file, the same polling. The target is resolved BEFORE the mutex is
// taken so a refusal never leaves the scan marked running.
function captureScan(req, res, tool, write) {
  const target = stages.captureTargetOf(req.body || {});
  heavyScanRunning = tool;
  write({ status: 'running', bookId: target.bookId, startedUtc: new Date().toISOString() });
  (async () => {
    try {
      const r = await stages.tuneOnCapture(req.body || {}, tool);
      write({ status: 'done', bookId: target.bookId, finishedUtc: new Date().toISOString(), ...r });
    } catch (e) {
      write({ status: 'error', bookId: target.bookId, finishedUtc: new Date().toISOString(), error: String((e && e.message) || e).slice(0, 300) });
    } finally {
      heavyScanRunning = false;
    }
  })();
  res.json({ ok: true, status: 'running', bookId: target.bookId });
}
// Conviction sizing (owner 2026-08-13): price an agreement clip ladder over
// the captured trades of one survivor of a Stage 4 record set, pure $ overlay.
// A scan SHOWS the answer; it changes no sizing anywhere. Background + polled.
// ONE heavy scan at a time (owner 2026-08-14): the stop tuner and the
// conviction sweep replay full history and must never run concurrently — a
// shared mutex gates both, and both UIs disable both launch buttons while
// either runs. Scans are minutes-scale and run to completion.
let heavyScanRunning = false; // false | 'stop' | 'conviction'
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
    if (req.body && req.body.setId) return captureScan(req, res, 'conviction', writeConvictionSweep);
    return res.status(400).json({ error: 'name a Stage 4 record set to scan (setId) — the scans run on the captured trades of one of its survivors' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});
app.get('/api/pilot/stopsweep', (req, res) => res.json(readStopSweep()));
app.post('/api/pilot/stopsweep', (req, res) => {
  try {
    if (heavyScanRunning) return res.status(409).json({ error: `a heavy scan is already running (${heavyScanRunning}) — one at a time` });
    if (req.body && req.body.setId) return captureScan(req, res, 'stop', writeStopSweep);
    return res.status(400).json({ error: 'name a Stage 4 record set to scan (setId) — the scans run on the captured trades of one of its survivors' });
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

// A DEATH LEAVES A NOTE (owner order, 2026-08-27). At boot, ask the separate
// control program what the machine recorded about this service's last stop;
// a set stranded mid-write then says WHY the service restarted, in the
// machine's own words, instead of leaving a silent hole. Best-effort: when
// no control program answers, the sets still get the plain marking.
(() => {
  const svcPort = Number(process.env.UTS_SVC_PORT || 8095);
  const unitName = process.env.UTS_UNIT_NAME || 'ultimate-trading-system.service';
  const mark = (plain) => { try { stages.markInterrupted(plain || undefined); } catch (_) { /* the lazy marking covers it */ } };
  const req = require('http').get({
    host: '127.0.0.1', port: svcPort, path: `/api/last-death?unit=${encodeURIComponent(unitName)}`, timeout: 1500,
  }, (r) => {
    let raw = '';
    r.on('data', (c) => { raw += c; });
    r.on('end', () => {
      let plain = null;
      try { const d = JSON.parse(raw); if (d && d.died && d.plain) plain = d.plain; } catch (_) { /* plain marking */ }
      mark(plain);
    });
  });
  req.on('timeout', () => { req.destroy(); });
  req.on('error', () => mark(null));
})();

app.listen(PORT, '127.0.0.1', () => {
  console.log(`ultimate-trading-system listening on 127.0.0.1:${PORT}`);
});
