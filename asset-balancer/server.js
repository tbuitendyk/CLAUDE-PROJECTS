const crypto = require('crypto');
const path = require('path');
const express = require('express');
const config = require('./lib/config');
const db = require('./lib/db');
const { pollProfiles, resetBaselines } = require('./lib/balancer');
const { sendAlerts, sendTestEmail, emailConfigured } = require('./lib/mailer');
const { searchCoins } = require('./lib/pricing');
const { startScheduler } = require('./lib/scheduler');

const app = express();
app.use(express.json());

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
  // The index asset is part of the allocation too (targets sum to 100%
  // including it), so it gets an asset row from the start.
  const idx = (index_asset || 'usd').toLowerCase().trim();
  db.prepare(
    'INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct) VALUES (?, ?, ?, 0, 0)'
  ).run(info.lastInsertRowid, idx, idx === 'usd' ? 'USD' : idx);
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

// Full state for one profile: assets (with latest prices/drift), sets, alerts.
app.get('/api/profiles/:id/state', (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) return res.status(404).json({ error: 'not found' });

  const latest = db.prepare(
    'SELECT usd_price, rel_price, ts FROM price_history WHERE asset_id = ? ORDER BY ts DESC LIMIT 1'
  );
  const assets = db
    .prepare('SELECT * FROM assets WHERE profile_id = ? ORDER BY id')
    .all(profile.id)
    .map((a) => {
      const last = latest.get(a.id);
      const driftPct =
        last && a.baseline_rel ? (last.rel_price / a.baseline_rel - 1) * 100 : null;
      const valueUsd = last ? a.quantity * last.usd_price : null;
      const valueRel = last ? a.quantity * last.rel_price : null;
      return { ...a, last, driftPct, valueUsd, valueRel };
    });

  // Profile totals: sum up all the pieces, then divide by their value at
  // baseline prices to get growth since the last rebalance.
  let totalUsd = 0;
  let totalRel = 0;
  let baseRelTotal = 0;
  let targetTotal = 0;
  for (const a of assets) {
    targetTotal += a.target_pct || 0;
    if (a.last) {
      totalUsd += a.valueUsd;
      totalRel += a.valueRel;
      if (a.baseline_rel) baseRelTotal += a.quantity * a.baseline_rel;
    }
  }
  for (const a of assets) {
    a.actualPct = totalUsd > 0 && a.valueUsd != null ? (a.valueUsd / totalUsd) * 100 : null;
  }
  const totals = {
    totalUsd,
    totalRel,
    baselineRelTotal: baseRelTotal || null,
    growthPct: baseRelTotal > 0 ? (totalRel / baseRelTotal - 1) * 100 : null,
    targetTotal,
  };

  const snapshots = db
    .prepare('SELECT ts, total_usd, total_rel, growth_pct, quantities FROM profile_snapshots WHERE profile_id = ? ORDER BY ts DESC LIMIT 48')
    .all(profile.id)
    .reverse();

  const sets = db
    .prepare('SELECT * FROM sets WHERE profile_id = ? ORDER BY id')
    .all(profile.id)
    .map((s) => ({
      ...s,
      member_ids: db
        .prepare('SELECT asset_id FROM set_members WHERE set_id = ?')
        .all(s.id)
        .map((r) => r.asset_id),
      active_alerts: db.prepare('SELECT * FROM active_alerts WHERE set_id = ?').all(s.id),
    }));

  const alertLog = db
    .prepare('SELECT * FROM alert_log WHERE profile_id = ? ORDER BY ts DESC LIMIT 50')
    .all(profile.id);

  res.json({ profile, assets, sets, alertLog, totals, snapshots });
});

// ---- assets & sets ----------------------------------------------------------

app.post('/api/profiles/:id/assets', (req, res) => {
  const { coingecko_id, symbol, quantity, target_pct } = req.body || {};
  if (!coingecko_id || !symbol) return res.status(400).json({ error: 'coingecko_id and symbol required' });
  try {
    const info = db
      .prepare('INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct) VALUES (?, ?, ?, ?, ?)')
      .run(
        req.params.id,
        coingecko_id.toLowerCase().trim(),
        symbol.trim(),
        Number(quantity) >= 0 ? Number(quantity) : 0,
        Number(target_pct) >= 0 ? Number(target_pct) : 0
      );
    res.json(db.prepare('SELECT * FROM assets WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: 'asset already in profile' });
  }
});

// Update holdings: quantity (what you own) and target allocation percentage.
app.patch('/api/assets/:id', (req, res) => {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  db.prepare('UPDATE assets SET quantity = ?, target_pct = ? WHERE id = ?').run(
    Number(b.quantity) >= 0 ? Number(b.quantity) : asset.quantity,
    Number(b.target_pct) >= 0 ? Number(b.target_pct) : asset.target_pct,
    asset.id
  );
  res.json(db.prepare('SELECT * FROM assets WHERE id = ?').get(asset.id));
});

app.delete('/api/assets/:id', (req, res) => {
  db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/profiles/:id/sets', (req, res) => {
  const { name, member_ids } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO sets (profile_id, name) VALUES (?, ?)').run(req.params.id, name);
  const add = db.prepare('INSERT OR IGNORE INTO set_members (set_id, asset_id) VALUES (?, ?)');
  for (const id of member_ids || []) add.run(info.lastInsertRowid, id);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.patch('/api/sets/:id', (req, res) => {
  const set = db.prepare('SELECT * FROM sets WHERE id = ?').get(req.params.id);
  if (!set) return res.status(404).json({ error: 'not found' });
  const { name, member_ids } = req.body || {};
  if (name) db.prepare('UPDATE sets SET name = ? WHERE id = ?').run(name, set.id);
  if (Array.isArray(member_ids)) {
    db.prepare('DELETE FROM set_members WHERE set_id = ?').run(set.id);
    const add = db.prepare('INSERT OR IGNORE INTO set_members (set_id, asset_id) VALUES (?, ?)');
    for (const id of member_ids) add.run(set.id, id);
    db.prepare('DELETE FROM active_alerts WHERE set_id = ?').run(set.id);
  }
  res.json({ ok: true });
});

app.delete('/api/sets/:id', (req, res) => {
  db.prepare('DELETE FROM sets WHERE id = ?').run(req.params.id);
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

app.post('/api/profiles/:id/rebalance', (req, res) => {
  const setId = req.body && req.body.set_id ? Number(req.body.set_id) : null;
  resetBaselines(Number(req.params.id), setId);
  res.json({ ok: true });
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
