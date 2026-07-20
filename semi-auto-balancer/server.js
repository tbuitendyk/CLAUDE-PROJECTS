const crypto = require('crypto');
const path = require('path');
const express = require('express');
const config = require('./lib/config');
const db = require('./lib/db');
const {
  pollProfiles,
  setTargets,
  recordFlow,
  setIndexAsset,
  effectiveThreshold,
  computeBasket,
  computeValueIndex,
  indexLabel,
  indexUsdFor,
  priceAsset,
  rearmAfterUpload,
} = require('./lib/balancer');
const { getJob, startJob, latestResult } = require('./lib/jobs');
const { runTuneSweep, computeTargetsHash } = require('./lib/backtest');
const { runComposeSearch, venueTradableFilter, parseComposeExclusions } = require('./lib/compose');
const { topCandidates } = require('./lib/candidates');
const { hourlyStatus } = require('./lib/hourly');
const ladder = require('./lib/ladder');
const laddermon = require('./lib/laddermon');
const { sendAlertEvents, sendStatusReport, sendTestEmail, sendLadderNotice, emailConfigured } = require('./lib/mailer');
const { searchCoins, supportedFiats, fiatCode } = require('./lib/pricing');
const { visionConfigured, parseHoldingsScreenshot } = require('./lib/vision');
const telegram = require('./lib/telegram');
const { telegramConfigured } = telegram;
const { startScheduler } = require('./lib/scheduler');
const sync = require('./lib/sync');
const { monthlyCalls, MONTH_CAP } = require('./lib/cg');
const { cacheStatus } = require('./lib/history');

const app = express();
// Generous limit: the screenshot-import endpoint receives base64 images.
app.use(express.json({ limit: '15mb' }));

// ---- auth -----------------------------------------------------------------

const COOKIE = 'ab_session';

function sign(value) {
  return crypto.createHmac('sha256', config.appSecret).update(value).digest('hex');
}

function makeToken() {
  const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
  const payload = String(expires);
  return `${payload}.${sign(payload)}`;
}

function tokenValid(token) {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  return Number(payload) > Date.now();
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

app.post('/api/login', (req, res) => {
  if (!config.appPassword) return res.json({ ok: true });
  const { password } = req.body || {};
  const given = Buffer.from(String(password || ''));
  const want = Buffer.from(config.appPassword);
  const match = given.length === want.length && crypto.timingSafeEqual(given, want);
  if (!match) return res.status(401).json({ error: 'Wrong password' });
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(makeToken())}; HttpOnly; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax`
  );
  res.json({ ok: true });
});

function requireAuth(req, res, next) {
  if (!config.appPassword) return next();
  if (tokenValid(getCookie(req, COOKIE))) return next();
  res.status(401).json({ error: 'Not logged in' });
}

app.get('/api/session', (req, res) => {
  res.json({
    authed: !config.appPassword || tokenValid(getCookie(req, COOKIE)),
    passwordRequired: Boolean(config.appPassword),
    emailConfigured: emailConfigured(),
    visionConfigured: visionConfigured(),
    telegramConfigured: telegramConfigured(),
  });
});

app.use('/api', requireAuth);

// ---- profiles ---------------------------------------------------------------

app.get('/api/profiles', (req, res) => {
  const profiles = db.prepare('SELECT * FROM profiles ORDER BY id').all();
  res.json(profiles);
});

app.post('/api/profiles', (req, res) => {
  // The index currency is derived from the tethered (checkmarked) asset, not
  // set here. index_asset stays at its column default for legacy rows.
  const { name, threshold_pct, poll_minutes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db
    .prepare('INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES (?, ?, ?, ?)')
    .run(
      name,
      Number(threshold_pct) > 0 ? Number(threshold_pct) : 5,
      Number(poll_minutes) >= 1 ? Math.round(Number(poll_minutes)) : config.defaultPollMinutes,
      Date.now()
    );
  res.json(db.prepare('SELECT * FROM profiles WHERE id = ?').get(info.lastInsertRowid));
});

app.patch('/api/profiles/:id', (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};

  // Recipients: [{email, telegram_chat_id}, ...]. No global fallback exists
  // -- an empty list means on-screen logging only. (Rows saved by the old
  // CallMeBot era carried whatsapp fields; they are simply dropped here on
  // the next save and ignored by the mailer meanwhile.)
  let recipients = profile.recipients;
  if (b.recipients !== undefined) {
    if (!Array.isArray(b.recipients)) return res.status(400).json({ error: 'recipients must be an array' });
    const cleaned = [];
    for (const r of b.recipients) {
      const email = String(r.email || '').trim();
      const chatId = String(r.telegram_chat_id || '').trim();
      if (!email && !chatId) continue; // a row needs at least one working channel
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: `invalid email: ${email}` });
      }
      // Telegram chat ids are integers (negative for groups).
      if (chatId && !/^-?\d{1,20}$/.test(chatId)) {
        return res.status(400).json({ error: `invalid Telegram chat ID: ${chatId} (use "Find chat IDs")` });
      }
      cleaned.push({ email, telegram_chat_id: chatId });
    }
    recipients = JSON.stringify(cleaned);
  }

  // fee/spread accept 0 (fee-free venue), so their validation is >= 0 — not
  // Composition-lab candidate exclusions: array of coingecko ids the user
  // unchecked from the pool. Validated as plain strings; stored as JSON.
  let composeExcluded = profile.compose_excluded;
  if (b.compose_excluded !== undefined) {
    if (!Array.isArray(b.compose_excluded)) return res.status(400).json({ error: 'compose_excluded must be an array of ids' });
    const ids = b.compose_excluded.filter((v) => typeof v === 'string' && v.length > 0 && v.length <= 100).slice(0, 200);
    composeExcluded = JSON.stringify(ids);
  }

  // the > 0 pattern the always-positive fields use.
  const nonNeg = (v, prev) => (v === undefined ? prev : Number(v) >= 0 ? Number(v) : prev);
  db.prepare(
    'UPDATE profiles SET name = ?, threshold_pct = ?, poll_minutes = ?, enabled = ?, alerts_enabled = ?, recipients = ?, fee_pct = ?, spread_pct = ?, compose_excluded = ? WHERE id = ?'
  ).run(
    b.name ?? profile.name,
    Number(b.threshold_pct) > 0 ? Number(b.threshold_pct) : profile.threshold_pct,
    Number(b.poll_minutes) >= 1 ? Math.round(Number(b.poll_minutes)) : profile.poll_minutes,
    b.enabled === undefined ? profile.enabled : b.enabled ? 1 : 0,
    b.alerts_enabled === undefined ? profile.alerts_enabled : b.alerts_enabled ? 1 : 0,
    recipients,
    nonNeg(b.fee_pct, profile.fee_pct),
    nonNeg(b.spread_pct, profile.spread_pct),
    composeExcluded,
    profile.id
  );
  res.json(db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id));
});

app.delete('/api/profiles/:id', (req, res) => {
  db.prepare('DELETE FROM profiles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Assets with latest prices, actual vs target allocation, relative drift,
// plus pool totals and the currency basket. Shared by the state endpoint
// and the status-report email.
function buildProfileView(profile) {
  const latest = db.prepare(
    'SELECT usd_price, rel_price, ts FROM price_history WHERE asset_id = ? ORDER BY ts DESC LIMIT 1'
  );
  const rawAssets = db.prepare('SELECT * FROM assets WHERE profile_id = ? ORDER BY id').all(profile.id);
  // Price the view from each asset's most recent USD price, deriving relative
  // prices against the CURRENT tethered asset the same way the poller does.
  // (Stored rel_price values were computed under whatever index was set at poll
  // time, so reusing them would break the moment the checkmark changes.) USD
  // prices are denomination-independent, so this stays correct through any
  // index switch — the whole table re-denominates consistently.
  const lastById = new Map();
  const usdMap = {};
  for (const a of rawAssets) {
    const last = latest.get(a.id);
    if (last) {
      lastById.set(a.id, last);
      usdMap[a.coingecko_id] = last.usd_price;
    }
  }
  const indexUsd = indexUsdFor(rawAssets, usdMap);
  const assets = rawAssets.map((a) => {
    const last = lastById.get(a.id) || null;
    const p = priceAsset(a, indexUsd, usdMap);
    const rel = p ? p.rel : null;
    const valueRel = rel != null ? a.quantity * rel : null;
    const valueUsd = last ? a.quantity * last.usd_price : null;
    return { ...a, last, rel, valueRel, valueUsd };
  });

  let totalUsd = 0;
  let totalRel = 0;
  let targetTotal = 0;
  for (const a of assets) {
    targetTotal += a.target_pct || 0;
    if (a.valueRel != null) totalRel += a.valueRel;
    if (a.valueUsd != null) totalUsd += a.valueUsd;
  }
  const activeAlerts = new Set(
    db
      .prepare(
        'SELECT asset_id FROM alloc_alerts WHERE asset_id IN (SELECT id FROM assets WHERE profile_id = ?)'
      )
      .all(profile.id)
      .map((r) => r.asset_id)
  );
  for (const a of assets) {
    a.actualPct = totalRel > 0 && a.valueRel != null ? (a.valueRel / totalRel) * 100 : null;
    // Drift is RELATIVE to the target: +10 means 10% over its target share.
    a.driftRelPct =
      a.actualPct != null && a.target_pct > 0
        ? ((a.actualPct - a.target_pct) / a.target_pct) * 100
        : null;
    // Same weight-normalized threshold the engine alerts on (shared function,
    // so the UI/status email can never disagree with what actually triggers).
    const tEff = effectiveThreshold(profile.threshold_pct / 100, (a.target_pct || 0) / 100);
    a.effThresholdPct = tEff != null && a.target_pct > 0 ? tEff * 100 : null;
    a.breached =
      !a.is_index &&
      a.driftRelPct != null &&
      a.effThresholdPct != null &&
      Math.abs(a.driftRelPct) >= a.effThresholdPct;
    a.alertActive = activeAlerts.has(a.id);
    // Phase 3: surface engine-side BUY suppression so the UI can badge it.
    a.buySuppressed = Boolean(a.buy_frozen) && !a.freeze_override && a.breached && a.driftRelPct < 0;
  }

  // Chained indexes: basket (unit growth) and value index (value growth),
  // both continuous across target changes and deposits/withdrawals.
  const valueIndex = computeValueIndex(profile, totalRel);
  const growthPct = valueIndex != null ? (valueIndex - 1) * 100 : null;
  // Annualized (compounding) rate from the value-index start. Suppressed for the
  // first stretch, where annualizing a tiny window explodes into a nonsense
  // figure (e.g. +2% in a day -> thousands of % a year).
  const ANNUALIZE_MIN_DAYS = 7;
  let annualizedPct = null;
  if (valueIndex != null && valueIndex > 0 && profile.value_started_at) {
    const days = (Date.now() - profile.value_started_at) / 86400000;
    if (days >= ANNUALIZE_MIN_DAYS) annualizedPct = (Math.pow(valueIndex, 365.25 / days) - 1) * 100;
  }
  const totals = {
    totalUsd,
    totalRel,
    targetTotal,
    indexLabel: indexLabel(rawAssets),
    basket: computeBasket(rawAssets, profile.basket_base),
    valueIndex,
    growthPct,
    valueStartedAt: profile.value_started_at || null,
    annualizedPct,
  };
  return { assets, totals };
}

// Full state for one profile: assets with latest prices, actual vs target
// allocation, relative drift; pool totals; currency basket; alert history.
app.get('/api/profiles/:id/state', (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });
  const { assets, totals } = buildProfileView(profile);

  const snapshots = db
    .prepare(
      'SELECT ts, total_usd, total_rel, basket, value_index, quantities FROM profile_snapshots WHERE profile_id = ? ORDER BY ts DESC LIMIT 48'
    )
    .all(profile.id)
    .reverse();

  const alertLog = db
    .prepare('SELECT * FROM alert_log WHERE profile_id = ? ORDER BY ts DESC LIMIT 50')
    .all(profile.id);

  const flows = db
    .prepare('SELECT ts, deltas, note FROM flows WHERE profile_id = ? ORDER BY ts DESC LIMIT 20')
    .all(profile.id);

  res.json({
    profile,
    assets,
    alertLog,
    totals,
    snapshots,
    flows,
    exchange: exchangeView(profile.id),
    pendingFlows: db
      .prepare("SELECT id, ts, kind, code, asset_id, amount FROM pending_flows WHERE profile_id = ? AND status = 'pending' ORDER BY ts")
      .all(profile.id),
    latestTune: latestResult(profile.id, 'tune-threshold'),
    latestCompose: latestResult(profile.id, 'compose'),
  });
});

// ---- composition search (Phase 2.75) ----------------------------------------

// Start the empirical mix search as a job. Body knobs (all optional):
// days (window, default 720), samples (default 3000, cap 20000),
// candidates (top-N size, default 40), seed (reproducibility).
app.post('/api/profiles/:id/compose', (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });
  const body = req.body || {};
  const jobId = startJob('compose', profile.id, (setProgress) =>
    runComposeSearch(profile.id, body, setProgress)
  );
  res.json({ ok: true, jobId });
});

// The candidate POOL for this profile's composition lab, before any search:
// held assets + the top market-cap candidates, venue-filtered — with each
// entry's current excluded state, so the user can weed the pool up front.
app.get('/api/profiles/:id/compose-candidates', async (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profile.id);
  const tetherAsset = assets.find((a) => a.is_index) || null;
  try {
    const byId = new Map();
    for (const a of assets) {
      if (a.is_index || !(a.target_pct > 0 || a.quantity > 0)) continue;
      byId.set(a.coingecko_id, { id: a.coingecko_id, symbol: a.symbol.toLowerCase(), held: true });
    }
    // Show the FULL filtered candidate list (top ~100), not just the top-40
    // search cut: borderline-rank coins drift across the cut between market
    // snapshots, and everything that COULD enter a search must be visible and
    // weedable. inCut marks who is inside the cut as of this snapshot.
    let top = [];
    let marketsUnavailable = false;
    try {
      top = await topCandidates({ count: 100 });
      marketsUnavailable = top.length === 0;
    } catch (err) {
      marketsUnavailable = true;
      console.error('compose-candidates: topCandidates failed:', err.message);
    }
    const cutIds = new Set(top.slice(0, 40).map((c) => c.id));
    for (const c of top) {
      if (!byId.has(c.id) && (!tetherAsset || c.id !== tetherAsset.coingecko_id) && !fiatCode(c.id)) {
        byId.set(c.id, { id: c.id, symbol: c.symbol, rank: c.rank, inCut: cutIds.has(c.id) });
      }
    }
    for (const [, c] of byId) if (c.held) c.inCut = true; // held assets always enter
    let pool = [...byId.values()];
    const venueFilter = await venueTradableFilter(profile.id);
    if (venueFilter) {
      const kept = [];
      for (const c of pool) {
        if (c.held || (await venueFilter.tradable(c.symbol))) kept.push(c);
      }
      pool = kept;
    }
    const excluded = parseComposeExclusions(profile, tetherAsset ? tetherAsset.coingecko_id : null);
    res.json({
      tether: tetherAsset ? { id: tetherAsset.coingecko_id, symbol: tetherAsset.symbol } : null,
      venue: venueFilter ? venueFilter.venue : null,
      marketsUnavailable,
      pool: pool
        .sort((a, b) => (a.held === b.held ? (a.rank || 999) - (b.rank || 999) : a.held ? -1 : 1))
        .map((c) => ({ ...c, excluded: excluded.has(c.id) })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Ladder Lab (Phase L): BTC/USD cycle-ladder strategy lab ----------------

// Data coverage + latest sweep presence for the Ladder Lab page.
app.get('/api/ladder/status', async (req, res) => {
  try {
    const data = await ladder.dataStatus();
    const latest = latestResult(null, 'ladder-sweep');
    res.json({ data, hasResult: Boolean(latest), lastSweepAt: latest ? latest.createdAt : null, gridSize: ladder.GRID_SIZE });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Load maximum-depth daily BTC history (Binance archive reaches 2017) as a job.
app.post('/api/ladder/load-data', (req, res) => {
  const jobId = startJob('ladder-data', null, async (setProgress) => {
    setProgress('fetching deep BTC daily history (Binance archive)…', 5);
    const { getDailyHistory } = require('./lib/history');
    const rows = await getDailyHistory('bitcoin', 3650, 'btc');
    setProgress('done', 100);
    return { result: { rows: rows.length, from: rows[0] ? rows[0].ts : null, to: rows.length ? rows[rows.length - 1].ts : null }, params: {} };
  });
  res.json({ ok: true, jobId });
});

// Run the full configuration sweep + plateau detection + scenario grid.
app.post('/api/ladder/sweep', (req, res) => {
  const b = req.body || {};
  const jobId = startJob('ladder-sweep', null, (setProgress) =>
    ladder.runLadderSweep({ fast: Boolean(b.fast), seed: Number(b.seed) || 424242 }, setProgress)
  );
  res.json({ ok: true, jobId });
});

app.get('/api/ladder/latest', (req, res) => {
  const latest = latestResult(null, 'ladder-sweep');
  if (!latest) return res.json({ result: null });
  res.json(latest);
});

// ---- Ladder monitors (Phase L2): live rung watching + notifications ---------

app.get('/api/ladder/monitors', (req, res) => {
  try {
    res.json({ monitors: laddermon.listMonitors().map(laddermon.monitorView) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ladder/monitors', async (req, res) => {
  try {
    const b = req.body || {};
    let anchor = b.anchor;
    if (anchor == null) {
      // Default anchor: the highest daily close on record (the real ATH).
      const row = db.prepare("SELECT MAX(usd_price) AS ath FROM daily_prices WHERE coingecko_id = 'bitcoin'").get();
      anchor = row && row.ath;
    }
    const mon = laddermon.createMonitor({
      name: b.name,
      config: b.config,
      anchor,
      recipients: b.recipients,
      pollMinutes: b.pollMinutes,
      alertsEnabled: b.alertsEnabled != null ? b.alertsEnabled : 1,
    });
    // First evaluation immediately, so already-passed rungs alert now
    // (mirrors the simulator's mid-drawdown start) and the card shows live
    // state instead of "never checked".
    try {
      const prices = await require('./lib/pricing').fetchUsdPrices(['bitcoin']);
      if (prices && Number.isFinite(prices.bitcoin)) await laddermon.checkMonitor(mon, prices.bitcoin);
    } catch (err) {
      console.error('Initial ladder check failed:', err.message);
    }
    res.json({ ok: true, monitor: laddermon.monitorView(laddermon.getMonitor(mon.id)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/ladder/monitors/:id', (req, res) => {
  try {
    const mon = laddermon.updateMonitor(Number(req.params.id), req.body || {});
    res.json({ ok: true, monitor: laddermon.monitorView(mon) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/ladder/monitors/:id', (req, res) => {
  try {
    laddermon.deleteMonitor(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Force an immediate evaluation (the ladder's "Poll now").
app.post('/api/ladder/monitors/:id/check', async (req, res) => {
  try {
    const mon = laddermon.getMonitor(Number(req.params.id));
    if (!mon) return res.status(404).json({ error: 'monitor not found' });
    const prices = await require('./lib/pricing').fetchUsdPrices(['bitcoin']);
    const price = prices && prices.bitcoin;
    if (!Number.isFinite(price) || price <= 0) throw new Error('no BTC price available');
    const events = await laddermon.checkMonitor(mon, price);
    res.json({ ok: true, price, events: events.length, monitor: laddermon.monitorView(laddermon.getMonitor(mon.id)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send a test notification through the monitor's full comms path.
app.post('/api/ladder/monitors/:id/test', async (req, res) => {
  try {
    const mon = laddermon.getMonitor(Number(req.params.id));
    if (!mon) return res.status(404).json({ error: 'monitor not found' });
    const msg = `Test notification for ladder monitor "${mon.name}" — the comms path works.`;
    const { emailed } = await sendLadderNotice(mon, 'test notification', msg);
    db.prepare('INSERT INTO ladder_events (monitor_id, ts, type, price, message, emailed) VALUES (?, ?, ?, ?, ?, ?)')
      .run(mon.id, Date.now(), 'test', mon.last_price, msg, emailed);
    res.json({ ok: true, emailed: Boolean(emailed) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- threshold sweep (Phase 2) ----------------------------------------------

// Start the advisory backtest as a job (it can run minutes when history
// needs fetching); the UI polls GET /api/jobs/:id.
app.post('/api/profiles/:id/tune-threshold', (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  // 4-year mandate: daily sweeps default to the full deep window. Hourly
  // stays ~2y — its job is finer execution timing, and hourly source depth
  // is patchier; the bars selector labels this tradeoff.
  const granularity0 = b.granularity === 'hourly' ? 'hourly' : 'daily';
  const days = Number(b.days) > 0 ? Number(b.days) : granularity0 === 'hourly' ? 730 : 1460;
  const granularity = b.granularity === 'hourly' ? 'hourly' : 'daily';
  const lagHours = Number(b.lag_hours) > 0 ? Number(b.lag_hours) : 6;
  // Optional hypothetical mix (composition-lab row → tuner): sweeps that mix
  // instead of the applied targets; the result is stamped hypothetical.
  const mix = Array.isArray(b.mix) && b.mix.length > 0 ? b.mix : null;
  const idealTether = Boolean(b.idealTether);
  const jobId = startJob('tune-threshold', profile.id, (setProgress) =>
    runTuneSweep(profile.id, { days, granularity, lagHours, mix, idealTether }, setProgress)
  );
  res.json({ ok: true, jobId });
});

// Apply a swept X to the profile — advisory-with-apply. Refuses when the
// inputs the sweep depended on (targets, fee, spread) have changed since it
// ran; quantity changes do NOT invalidate (the sim starts at target weights).
app.post('/api/profiles/:id/apply-threshold', (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });
  const { x, stamp } = req.body || {};
  if (!(Number(x) > 0)) return res.status(400).json({ error: 'x must be > 0' });
  if (!stamp || !stamp.targetsHash) return res.status(400).json({ error: 'stamp required' });
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profile.id);
  if (stamp.targetsHash !== computeTargetsHash(assets)) {
    return res.status(409).json({ error: 'targets changed since this sweep ran — re-run it' });
  }
  if (Math.abs(Number(stamp.feePct) - profile.fee_pct) > 1e-9 || Math.abs(Number(stamp.spreadPct) - profile.spread_pct) > 1e-9) {
    return res.status(409).json({ error: 'fee/spread changed since this sweep ran — re-run it' });
  }
  db.prepare('UPDATE profiles SET threshold_pct = ? WHERE id = ?').run(Number(x), profile.id);
  res.json({ ok: true, threshold_pct: Number(x) });
});

// ---- exchange sync (Phase 1.5) ----------------------------------------------

// Account as the API exposes it: key masked to the last 4 chars, secret
// never leaves the server.
function exchangeView(profileId) {
  const a = sync.getAccountForProfile(profileId);
  if (!a) return null;
  let note = null;
  try {
    note = a.last_sync_note ? JSON.parse(a.last_sync_note) : null;
  } catch {}
  return {
    id: a.id,
    venue: a.venue,
    api_key_masked: `…${String(a.api_key).slice(-4)}`,
    auto_flows: a.auto_flows,
    enabled: a.enabled,
    sync_minutes: a.sync_minutes,
    last_sync_at: a.last_sync_at,
    last_sync_status: a.last_sync_status,
    note,
    feeObserved: sync.observedFee(a.id),
  };
}

// Link a read-only account (one per profile; replaces any existing link,
// with fresh watermarks). The key is verified with a balances call before
// the account is saved, so a typo'd or under-scoped key fails here.
app.post('/api/profiles/:id/exchange', async (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });
  const { venue, api_key, api_secret } = req.body || {};
  try {
    if (!sync.VENUES[venue]) throw new Error('venue must be kraken or bitso');
    const client = sync.VENUES[venue].makeClient({ apiKey: api_key, apiSecret: api_secret });
    await client.fetchBalances(); // read-scope verification
    sync.createAccount(profile.id, venue, api_key, api_secret);
    res.json({ ok: true, exchange: exchangeView(profile.id) });
  } catch (err) {
    res.status(400).json({ error: `key verification failed: ${err.message}` });
  }
});

app.patch('/api/exchange-accounts/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM exchange_accounts WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  db.prepare('UPDATE exchange_accounts SET enabled = ?, auto_flows = ?, sync_minutes = ? WHERE id = ?').run(
    b.enabled === undefined ? a.enabled : b.enabled ? 1 : 0,
    b.auto_flows === undefined ? a.auto_flows : b.auto_flows ? 1 : 0,
    Number(b.sync_minutes) >= 5 ? Math.round(Number(b.sync_minutes)) : a.sync_minutes,
    a.id
  );
  res.json({ ok: true, exchange: exchangeView(a.profile_id) });
});

app.delete('/api/exchange-accounts/:id', (req, res) => {
  db.prepare('DELETE FROM exchange_accounts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Manual "Sync now": reconcile, then force a poll so the pool re-values
// (and re-alerts if the fills changed the picture).
app.post('/api/exchange-accounts/:id/sync', async (req, res) => {
  const a = db.prepare('SELECT * FROM exchange_accounts WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'not found' });
  try {
    const summary = await sync.syncAccount(a.id);
    await pollProfiles({ force: true, profileId: a.profile_id }).catch(() => {});
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Confirm a detected deposit/withdrawal: applies the exact-amount splice
// with the venue's real timestamp. Dismiss drops it (e.g. already recorded
// manually).
app.post('/api/pending-flows/:id/confirm', async (req, res) => {
  try {
    const result = await sync.applyPendingFlow(Number(req.params.id));
    const flow = db.prepare('SELECT profile_id FROM pending_flows WHERE id = ?').get(req.params.id);
    if (flow) await pollProfiles({ force: true, profileId: flow.profile_id }).catch(() => {});
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/pending-flows/:id/dismiss', (req, res) => {
  try {
    sync.dismissPendingFlow(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- telegram notifications ---------------------------------------------------

// One bot serves all profiles. Saving verifies the token against getMe
// before storing; an empty token clears the stored one.
app.post('/api/telegram/token', async (req, res) => {
  try {
    const result = await telegram.setToken((req.body || {}).token);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/telegram/status', (req, res) => {
  res.json(telegram.botStatus());
});

// Chats that have messaged the bot recently — the "Find chat IDs" picker.
app.get('/api/telegram/chats', async (req, res) => {
  try {
    res.json(await telegram.recentChats());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// One test message straight to a chat id, so a recipient row can be proven
// live before the first real alert needs it.
app.post('/api/telegram/test', async (req, res) => {
  try {
    const chatId = String((req.body || {}).chat_id || '').trim();
    if (!chatId) return res.status(400).json({ error: 'chat_id required' });
    await telegram.sendTelegram(chatId, 'Semi-Auto Balancer: Telegram test — this channel works.');
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---- diagnostics --------------------------------------------------------------

// The deploy gate reads this: CG quota ledger, history-cache freshness, and
// per-account sync state (keys masked).
app.get('/api/diagnostics', (req, res) => {
  const accounts = db
    .prepare('SELECT id, profile_id, venue, api_key, enabled, auto_flows, sync_minutes, last_sync_at, last_sync_status FROM exchange_accounts')
    .all()
    .map((a) => ({ ...a, api_key: `…${String(a.api_key).slice(-4)}` }));
  res.json({
    coingecko: { monthCalls: monthlyCalls(), monthCap: MONTH_CAP },
    historyCache: cacheStatus(),
    hourlyCache: hourlyStatus(),
    exchangeAccounts: accounts,
    pendingFlows: db.prepare("SELECT COUNT(*) AS n FROM pending_flows WHERE status = 'pending'").get().n,
  });
});

// ---- assets -----------------------------------------------------------------

app.post('/api/profiles/:id/assets', async (req, res) => {
  const { coingecko_id, symbol, quantity } = req.body || {};
  if (!coingecko_id) return res.status(400).json({ error: 'coingecko_id required' });
  const id = coingecko_id.toLowerCase().trim();

  // Fiat currencies are stored as 'fiat:<code>' and validated against
  // CoinGecko's supported vs-currency list.
  let sym = (symbol || '').trim();
  if (id.startsWith('fiat:')) {
    const code = fiatCode(id);
    const supported = await supportedFiats();
    if (!code || !supported.includes(code)) {
      return res.status(400).json({ error: `unsupported fiat currency: ${id}` });
    }
    if (!sym) sym = code;
  }
  if (!sym) return res.status(400).json({ error: 'symbol required' });

  try {
    // New assets join with target 0% (targets change only via the explicit
    // "set new targets" action) and a neutral basket snapshot.
    const qty = Number(quantity) >= 0 ? Number(quantity) : 0;
    const info = db
      .prepare(
        'INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, basket_units) VALUES (?, ?, ?, ?, 0, ?)'
      )
      .run(req.params.id, id, sym, qty, qty);
    res.json(db.prepare('SELECT * FROM assets WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: 'asset already in profile' });
  }
});

// Fiat currency codes available for "add fiat" (live CoinGecko list).
app.get('/api/fiat-currencies', async (req, res) => {
  res.json(await supportedFiats());
});

// Update an asset: quantity (what you own) and/or the tethered-index flag.
// Target percentages are NOT set here -- use POST /profiles/:id/targets.
app.patch('/api/assets/:id', async (req, res) => {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  try {
    if (Number(b.quantity) >= 0) {
      db.prepare('UPDATE assets SET quantity = ? WHERE id = ?').run(Number(b.quantity), asset.id);
    }
    if (b.freeze_override !== undefined) {
      db.prepare('UPDATE assets SET freeze_override = ? WHERE id = ?').run(b.freeze_override ? 1 : 0, asset.id);
    }
    if (b.is_index !== undefined) {
      // Changing the tethered index re-denominates the pool. setIndexAsset
      // splices the value index so performance stays continuous; the re-poll
      // then stores fresh prices in the new denomination.
      await setIndexAsset(asset.profile_id, b.is_index ? asset.id : null);
      await pollProfiles({ force: true, profileId: asset.profile_id }).catch(() => {});
    }
    res.json(db.prepare('SELECT * FROM assets WHERE id = ?').get(asset.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/assets/:id', (req, res) => {
  db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Manual unfreeze (Phase 3): the human override on the buy-freeze rail.
// The rail may re-freeze on the next check if conditions still hold.
app.post('/api/assets/:id/unfreeze', (req, res) => {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE assets SET buy_frozen = 0, frozen_at = NULL, freeze_reason = NULL WHERE id = ?').run(asset.id);
  res.json({ ok: true });
});

// ---- jobs -------------------------------------------------------------------

// Long-running analysis jobs (threshold sweeps, scans) are started by their
// own endpoints and polled here. Unknown id => the service restarted since
// the job ran; finished results live on in analysis_results.
app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'unknown job (result expired — re-run)' });
  res.json({
    id: job.id,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    progressPct: job.progressPct != null ? job.progressPct : null,
    result: job.status === 'done' ? job.result : null,
    error: job.error,
  });
});

// ---- actions ----------------------------------------------------------------

// Manual update ("Poll now"). Manual polls drive the notification state
// machine: in 'notified' they re-check and escalate to 'awaiting_upload';
// in 'awaiting_upload' they restart the 12h clock.
app.post('/api/profiles/:id/poll', async (req, res) => {
  try {
    const { events } = await pollProfiles({ force: true, profileId: Number(req.params.id), manual: true });
    if (events.length > 0) await sendAlertEvents(events);
    res.json({ ok: true, notifications: events.length });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// On-demand full status report to the profile's recipients (email + a
// Telegram notice), regardless of breach state. Doubles as a comms test.
app.post('/api/profiles/:id/email-status', async (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });
  let recipients = [];
  try {
    recipients = JSON.parse(profile.recipients || '[]');
  } catch {}
  if (!recipients.some((r) => r.email || r.telegram_chat_id)) {
    return res.status(400).json({ error: 'No recipients configured on this profile' });
  }
  try {
    const result = await sendStatusReport(profile, buildProfileView(profile));
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Called by the UI after a screenshot import is applied: re-arms
// notifications (new target hits only).
app.post('/api/profiles/:id/import-complete', (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });
  rearmAfterUpload(profile.id);
  res.json({ ok: true });
});

// Set new target allocations: the deliberate decision to change the mix.
// Body: {targets: [{asset_id, target_pct}, ...]} covering every asset,
// totalling 100, plus optional reset_basket. Chain-linked by default so the
// currency basket stays continuous; reset_basket starts a fresh track record.
app.post('/api/profiles/:id/targets', (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });
  const body = req.body || {};
  try {
    setTargets(profile.id, body.targets || [], { resetBasket: Boolean(body.reset_basket) });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Record a deposit or withdrawal: per-asset signed quantity deltas that keep
// the currency basket and value index continuous (external money is not
// performance). Body: {deltas: [{asset_id, delta}], note}. A poll follows so
// the pool re-values immediately.
app.post('/api/profiles/:id/flow', async (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });
  const body = req.body || {};
  try {
    const result = await recordFlow(profile.id, body.deltas || [], body.note);
    await pollProfiles({ force: true, profileId: profile.id }).catch(() => {});
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Match parsed screenshot holdings against a profile's existing assets.
// Exported logic kept pure for testing.
function matchHoldings(parsed, assets) {
  const bySymbol = new Map(assets.map((a) => [a.symbol.toLowerCase(), a]));
  const matches = [];
  const unmatched = [];
  for (const h of parsed) {
    if (h.quantity == null) continue; // nothing to import without a quantity
    const sym = (h.symbol || '').toLowerCase();
    // Fiat rows match by symbol, by fiat asset id ('CAD' row -> fiat:cad),
    // and USD additionally falls back to the legacy 'usd' pseudo-asset or
    // the tethered index asset (e.g. a USDT row standing in for USD).
    const existing =
      bySymbol.get(sym) ||
      assets.find((a) => a.coingecko_id === `fiat:${sym}`) ||
      (sym === 'usd'
        ? assets.find((a) => a.coingecko_id === 'usd') || assets.find((a) => a.is_index)
        : undefined);
    if (existing) {
      matches.push({
        asset_id: existing.id,
        symbol: existing.symbol,
        old_quantity: existing.quantity,
        new_quantity: h.quantity,
        name: h.name,
        value_usd: h.value_usd,
      });
    } else {
      unmatched.push(h);
    }
  }
  return { matches, unmatched };
}

// Parse a screenshot of a trading app's balances into holdings, match them
// to this profile's assets, and suggest CoinGecko coins for new ones. The
// frontend applies the result via the existing PATCH/POST asset endpoints.
app.post('/api/profiles/:id/import-screenshot', async (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });
  if (!visionConfigured()) {
    return res.status(503).json({ error: 'Screenshot import requires ANTHROPIC_API_KEY on the server' });
  }
  const { image, media_type } = req.body || {};
  if (!image || !/^image\/(jpeg|png|webp|gif)$/.test(media_type || '')) {
    return res.status(400).json({ error: 'image (base64) and media_type required' });
  }
  try {
    const parsed = await parseHoldingsScreenshot(image, media_type);
    const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profile.id);
    const { matches, unmatched } = matchHoldings(parsed, assets);

    // For unmatched holdings, offer candidates so the UI can add them as
    // new assets: a fiat candidate when the symbol is a fiat code, plus
    // CoinGecko coin matches.
    const fiats = await supportedFiats();
    const withSuggestions = [];
    for (const h of unmatched) {
      let candidates = [];
      const symLower = (h.symbol || '').toLowerCase();
      if (fiats.includes(symLower)) {
        candidates.push({
          id: `fiat:${symLower}`,
          symbol: symLower,
          name: `${symLower.toUpperCase()} (fiat currency)`,
          rank: 0,
        });
      }
      try {
        const found = await searchCoins(h.symbol || h.name);
        candidates = candidates.concat(
          found
            .sort((a, b) => {
              const aExact = a.symbol.toLowerCase() === symLower ? 0 : 1;
              const bExact = b.symbol.toLowerCase() === symLower ? 0 : 1;
              return aExact - bExact || (a.rank || 1e9) - (b.rank || 1e9);
            })
            .slice(0, 3)
        );
      } catch {
        /* suggestions are best-effort */
      }
      withSuggestions.push({ ...h, candidates });
    }
    res.json({ parsed, matches, unmatched: withSuggestions });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/search-coins', async (req, res) => {
  try {
    res.json(await searchCoins(String(req.query.q || '')));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/assets/:id/history', (req, res) => {
  const rows = db
    .prepare('SELECT ts, usd_price, rel_price FROM price_history WHERE asset_id = ? ORDER BY ts DESC LIMIT 500')
    .all(req.params.id);
  res.json(rows.reverse());
});

app.post('/api/test-email', async (req, res) => {
  try {
    await sendTestEmail();
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---- static frontend ----------------------------------------------------------

app.use(express.static(path.join(__dirname, 'public')));

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Semi-auto balancer listening on http://localhost:${config.port}`);
    console.log(`Email alerts: ${emailConfigured() ? `on -> ${config.alertEmailTo}` : 'NOT configured'}`);
    startScheduler();
  });
}

module.exports = app;
module.exports.matchHoldings = matchHoldings;
