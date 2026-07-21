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
  computeBasket,
  computeValueIndex,
  indexLabel,
  indexUsdFor,
  priceAsset,
  rearmAfterUpload,
} = require('./lib/balancer');
const { sendAlertEvents, sendStatusReport, sendTestEmail, emailConfigured } = require('./lib/mailer');
const { searchCoins, supportedFiats, fiatCode } = require('./lib/pricing');
const { visionConfigured, parseHoldingsScreenshot } = require('./lib/vision');
const { startScheduler } = require('./lib/scheduler');
const { serviceOn, setServiceOn } = require('./lib/settings');

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
    serviceOn: serviceOn(),
  });
});

app.use('/api', requireAuth);

// Master service switch: OFF suspends scheduled + manual polling and all
// notifications; the UI stays reachable so it can be switched back ON.
app.post('/api/service', (req, res) => {
  const on = setServiceOn(Boolean((req.body || {}).on));
  console.log(`[${new Date().toISOString()}] service switched ${on ? 'ON' : 'OFF'} via UI`);
  res.json({ serviceOn: on });
});

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

  // Recipients: [{email, whatsapp_phone, whatsapp_key}, ...]. No global
  // fallback exists -- an empty list means on-screen logging only.
  let recipients = profile.recipients;
  if (b.recipients !== undefined) {
    if (!Array.isArray(b.recipients)) return res.status(400).json({ error: 'recipients must be an array' });
    const cleaned = [];
    for (const r of b.recipients) {
      const email = String(r.email || '').trim();
      const phone = String(r.whatsapp_phone || '').trim();
      const key = String(r.whatsapp_key || '').trim();
      if (!email && !(phone && key)) continue; // a row needs at least one working channel
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: `invalid email: ${email}` });
      }
      if ((phone && !key) || (!phone && key)) {
        return res.status(400).json({ error: 'WhatsApp needs both phone and CallMeBot API key' });
      }
      cleaned.push({ email, whatsapp_phone: phone, whatsapp_key: key });
    }
    recipients = JSON.stringify(cleaned);
  }

  db.prepare(
    'UPDATE profiles SET name = ?, threshold_pct = ?, poll_minutes = ?, enabled = ?, alerts_enabled = ?, recipients = ? WHERE id = ?'
  ).run(
    b.name ?? profile.name,
    Number(b.threshold_pct) > 0 ? Number(b.threshold_pct) : profile.threshold_pct,
    Number(b.poll_minutes) >= 1 ? Math.round(Number(b.poll_minutes)) : profile.poll_minutes,
    b.enabled === undefined ? profile.enabled : b.enabled ? 1 : 0,
    b.alerts_enabled === undefined ? profile.alerts_enabled : b.alerts_enabled ? 1 : 0,
    recipients,
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
    a.breached = a.driftRelPct != null && Math.abs(a.driftRelPct) >= profile.threshold_pct;
    a.alertActive = activeAlerts.has(a.id);
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

  res.json({ profile, assets, alertLog, totals, snapshots, flows });
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

// ---- actions ----------------------------------------------------------------

// Manual update ("Poll now"). Manual polls drive the notification state
// machine: in 'notified' they re-check and escalate to 'awaiting_upload';
// in 'awaiting_upload' they restart the 12h clock.
app.post('/api/profiles/:id/poll', async (req, res) => {
  if (!serviceOn()) return res.status(409).json({ error: 'Service is OFF — switch it back ON to poll' });
  try {
    const { events } = await pollProfiles({ force: true, profileId: Number(req.params.id), manual: true });
    if (events.length > 0) await sendAlertEvents(events);
    res.json({ ok: true, notifications: events.length });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// On-demand full status report to the profile's recipients (email + a
// WhatsApp notice), regardless of breach state. Doubles as a comms test.
app.post('/api/profiles/:id/email-status', async (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });
  let recipients = [];
  try {
    recipients = JSON.parse(profile.recipients || '[]');
  } catch {}
  if (!recipients.some((r) => r.email || (r.whatsapp_phone && r.whatsapp_key))) {
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
    console.log(`Asset balancer listening on http://localhost:${config.port}`);
    console.log(`Email alerts: ${emailConfigured() ? `on -> ${config.alertEmailTo}` : 'NOT configured'}`);
    startScheduler();
  });
}

module.exports = app;
module.exports.matchHoldings = matchHoldings;
