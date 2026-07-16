const crypto = require('crypto');
const path = require('path');
const express = require('express');
const config = require('./lib/config');
const db = require('./lib/db');
const { pollProfiles, setTargets, computeBasket } = require('./lib/balancer');
const { sendAlerts, sendTestEmail, emailConfigured } = require('./lib/mailer');
const { searchCoins } = require('./lib/pricing');
const { visionConfigured, parseHoldingsScreenshot } = require('./lib/vision');
const { startScheduler } = require('./lib/scheduler');

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
  });
});

app.use('/api', requireAuth);

// ---- profiles ---------------------------------------------------------------

app.get('/api/profiles', (req, res) => {
  const profiles = db.prepare('SELECT * FROM profiles ORDER BY id').all();
  res.json(profiles);
});

app.post('/api/profiles', (req, res) => {
  const { name, index_asset, threshold_pct, poll_minutes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db
    .prepare(
      'INSERT INTO profiles (name, index_asset, threshold_pct, poll_minutes, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      name,
      (index_asset || 'usd').toLowerCase().trim(),
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
  db.prepare(
    'UPDATE profiles SET name = ?, index_asset = ?, threshold_pct = ?, poll_minutes = ?, enabled = ? WHERE id = ?'
  ).run(
    b.name ?? profile.name,
    (b.index_asset ?? profile.index_asset).toLowerCase().trim(),
    Number(b.threshold_pct) > 0 ? Number(b.threshold_pct) : profile.threshold_pct,
    Number(b.poll_minutes) >= 1 ? Math.round(Number(b.poll_minutes)) : profile.poll_minutes,
    b.enabled === undefined ? profile.enabled : b.enabled ? 1 : 0,
    profile.id
  );
  res.json(db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile.id));
});

app.delete('/api/profiles/:id', (req, res) => {
  db.prepare('DELETE FROM profiles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Full state for one profile: assets with latest prices, actual vs target
// allocation, relative drift; pool totals; currency basket; alert history.
app.get('/api/profiles/:id/state', (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });

  const latest = db.prepare(
    'SELECT usd_price, rel_price, ts FROM price_history WHERE asset_id = ? ORDER BY ts DESC LIMIT 1'
  );
  const rawAssets = db.prepare('SELECT * FROM assets WHERE profile_id = ? ORDER BY id').all(profile.id);
  const assets = rawAssets.map((a) => {
    const last = latest.get(a.id);
    // The tethered asset is 1:1 with the index by definition, even if its
    // stored history predates the checkmark.
    const rel = a.is_index ? 1 : last ? last.rel_price : null;
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

  // Growth relative to the profile's very first valued snapshot.
  const first = db
    .prepare(
      'SELECT total_rel FROM profile_snapshots WHERE profile_id = ? AND total_rel > 0 ORDER BY ts LIMIT 1'
    )
    .get(profile.id);
  const totals = {
    totalUsd,
    totalRel,
    targetTotal,
    basket: computeBasket(rawAssets),
    initialRel: first ? first.total_rel : null,
    growthPct: first && first.total_rel > 0 && totalRel > 0 ? (totalRel / first.total_rel - 1) * 100 : null,
  };

  const snapshots = db
    .prepare(
      'SELECT ts, total_usd, total_rel, basket, quantities FROM profile_snapshots WHERE profile_id = ? ORDER BY ts DESC LIMIT 48'
    )
    .all(profile.id)
    .reverse();

  const alertLog = db
    .prepare('SELECT * FROM alert_log WHERE profile_id = ? ORDER BY ts DESC LIMIT 50')
    .all(profile.id);

  res.json({ profile, assets, alertLog, totals, snapshots });
});

// ---- assets -----------------------------------------------------------------

app.post('/api/profiles/:id/assets', (req, res) => {
  const { coingecko_id, symbol, quantity } = req.body || {};
  if (!coingecko_id || !symbol) return res.status(400).json({ error: 'coingecko_id and symbol required' });
  try {
    // New assets join with target 0% (targets change only via the explicit
    // "set new targets" action) and a neutral basket snapshot.
    const qty = Number(quantity) >= 0 ? Number(quantity) : 0;
    const info = db
      .prepare(
        'INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, basket_units) VALUES (?, ?, ?, ?, 0, ?)'
      )
      .run(req.params.id, coingecko_id.toLowerCase().trim(), symbol.trim(), qty, qty);
    res.json(db.prepare('SELECT * FROM assets WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: 'asset already in profile' });
  }
});

// Update an asset: quantity (what you own) and/or the tethered-index flag.
// Target percentages are NOT set here -- use POST /profiles/:id/targets.
app.patch('/api/assets/:id', (req, res) => {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  db.transaction(() => {
    if (Number(b.quantity) >= 0) {
      db.prepare('UPDATE assets SET quantity = ? WHERE id = ?').run(Number(b.quantity), asset.id);
    }
    if (b.is_index !== undefined) {
      if (b.is_index) {
        // At most one tethered asset per profile.
        db.prepare('UPDATE assets SET is_index = 0 WHERE profile_id = ?').run(asset.profile_id);
        db.prepare('UPDATE assets SET is_index = 1 WHERE id = ?').run(asset.id);
      } else {
        db.prepare('UPDATE assets SET is_index = 0 WHERE id = ?').run(asset.id);
      }
    }
  })();
  res.json(db.prepare('SELECT * FROM assets WHERE id = ?').get(asset.id));
});

app.delete('/api/assets/:id', (req, res) => {
  db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- actions ----------------------------------------------------------------

app.post('/api/profiles/:id/poll', async (req, res) => {
  try {
    const { alerts } = await pollProfiles({ force: true, profileId: Number(req.params.id) });
    if (alerts.length > 0) await sendAlerts(alerts);
    res.json({ ok: true, alerts: alerts.length });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Set new target allocations: the deliberate decision to change the mix.
// Body: {targets: [{asset_id, target_pct}, ...]} covering every asset,
// totalling 100. Resets the currency basket to 1.00000000.
app.post('/api/profiles/:id/targets', (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });
  try {
    setTargets(profile.id, (req.body || {}).targets || []);
    res.json({ ok: true });
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
    // Fiat USD rows map to the 'usd' pseudo-asset, or failing that to the
    // tethered index asset (e.g. a USDT row standing in for USD).
    const existing =
      bySymbol.get(sym) ||
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

    // For unmatched holdings, look up CoinGecko candidates so the UI can
    // offer "add as new asset" with a concrete coin id.
    const withSuggestions = [];
    for (const h of unmatched) {
      let candidates = [];
      try {
        const found = await searchCoins(h.symbol || h.name);
        const symLower = (h.symbol || '').toLowerCase();
        candidates = found
          .sort((a, b) => {
            const aExact = a.symbol.toLowerCase() === symLower ? 0 : 1;
            const bExact = b.symbol.toLowerCase() === symLower ? 0 : 1;
            return aExact - bExact || (a.rank || 1e9) - (b.rank || 1e9);
          })
          .slice(0, 3);
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
