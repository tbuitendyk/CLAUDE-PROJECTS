const db = require('./db');
const { fetchUsdPrices } = require('./pricing');

// Core engine. For each profile:
//  1. fetch USD prices for every asset + the index asset
//  2. record each asset's relative price (usd(asset) / usd(index))
//  3. for every set in the profile, compare every pair of member assets:
//     divergence = (relA / baselineA) / (relB / baselineB) - 1
//     If |divergence| >= profile threshold, the pair has drifted apart enough
//     to rebalance manually -> raise an alert (once, until it re-arms).
//
// Alerts re-arm when the pair converges back under half the threshold, or
// when baselines are reset via "rebalance".

const REARM_FRACTION = 0.5;

function relPrice(usdPrices, coingeckoId, indexId) {
  const assetUsd = coingeckoId === 'usd' ? 1 : usdPrices[coingeckoId];
  const indexUsd = indexId === 'usd' ? 1 : usdPrices[indexId];
  if (!assetUsd || !indexUsd) return null;
  return assetUsd / indexUsd;
}

function pairKey(a, b) {
  return a.id < b.id ? [a, b] : [b, a];
}

// Evaluates one profile against a price map. Returns alerts that should be
// emailed. Pure-ish (writes history/baselines/alert state to the db).
function evaluateProfile(profile, usdPrices, now) {
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profile.id);
  const alerts = [];
  const current = new Map(); // asset_id -> { asset, rel }

  const insertHistory = db.prepare(
    'INSERT INTO price_history (profile_id, asset_id, ts, usd_price, rel_price) VALUES (?, ?, ?, ?, ?)'
  );
  const setBaseline = db.prepare('UPDATE assets SET baseline_rel = ?, baseline_at = ? WHERE id = ?');

  for (const asset of assets) {
    const rel = relPrice(usdPrices, asset.coingecko_id, profile.index_asset);
    if (rel == null) continue; // price missing this round; skip, don't alert
    const usd = asset.coingecko_id === 'usd' ? 1 : usdPrices[asset.coingecko_id];
    insertHistory.run(profile.id, asset.id, now, usd, rel);
    if (asset.baseline_rel == null) {
      // First time we've priced this asset: today's value becomes the baseline.
      setBaseline.run(rel, now, asset.id);
      asset.baseline_rel = rel;
    }
    current.set(asset.id, { asset, rel });
  }

  const sets = db.prepare('SELECT * FROM sets WHERE profile_id = ?').all(profile.id);
  const getMembers = db.prepare(
    'SELECT asset_id FROM set_members WHERE set_id = ?'
  );
  const getActive = db.prepare(
    'SELECT * FROM active_alerts WHERE set_id = ? AND asset_a = ? AND asset_b = ?'
  );
  const addActive = db.prepare(
    'INSERT OR REPLACE INTO active_alerts (set_id, asset_a, asset_b, triggered_at, drift_pct) VALUES (?, ?, ?, ?, ?)'
  );
  const clearActive = db.prepare(
    'DELETE FROM active_alerts WHERE set_id = ? AND asset_a = ? AND asset_b = ?'
  );

  const threshold = profile.threshold_pct / 100;

  for (const set of sets) {
    const memberIds = getMembers.all(set.id).map((r) => r.asset_id);
    const members = memberIds.map((id) => current.get(id)).filter(Boolean);
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const [first, second] = pairKey(members[i].asset, members[j].asset);
        const a = current.get(first.id);
        const b = current.get(second.id);
        if (!a.asset.baseline_rel || !b.asset.baseline_rel) continue;
        const divergence = (a.rel / a.asset.baseline_rel) / (b.rel / b.asset.baseline_rel) - 1;
        const active = getActive.get(set.id, first.id, second.id);
        if (Math.abs(divergence) >= threshold) {
          if (!active) {
            addActive.run(set.id, first.id, second.id, now, divergence * 100);
            alerts.push({
              profile,
              set,
              a: a.asset,
              b: b.asset,
              relA: a.rel,
              relB: b.rel,
              divergencePct: divergence * 100,
            });
          }
        } else if (active && Math.abs(divergence) < threshold * REARM_FRACTION) {
          clearActive.run(set.id, first.id, second.id);
        }
      }
    }
  }

  db.prepare('UPDATE profiles SET last_polled_at = ? WHERE id = ?').run(now, profile.id);
  return alerts;
}

// Polls every due (or forced) profile in one CoinGecko round-trip.
async function pollProfiles({ force = false, profileId = null } = {}) {
  const now = Date.now();
  let profiles = db.prepare('SELECT * FROM profiles WHERE enabled = 1').all();
  if (profileId != null) profiles = profiles.filter((p) => p.id === profileId);
  if (!force) {
    profiles = profiles.filter(
      (p) => !p.last_polled_at || now - p.last_polled_at >= p.poll_minutes * 60_000 - 5_000
    );
  }
  if (profiles.length === 0) return { polled: 0, alerts: [] };

  const ids = new Set();
  for (const p of profiles) {
    ids.add(p.index_asset);
    for (const a of db.prepare('SELECT coingecko_id FROM assets WHERE profile_id = ?').all(p.id)) {
      ids.add(a.coingecko_id);
    }
  }
  const usdPrices = await fetchUsdPrices([...ids]);

  const alerts = [];
  for (const p of profiles) {
    alerts.push(...evaluateProfile(p, usdPrices, now));
  }
  return { polled: profiles.length, alerts };
}

// "Rebalance": accept current prices as the new baseline for a profile
// (or a single set's members) and clear its active alerts.
function resetBaselines(profileId, setId = null) {
  const now = Date.now();
  let assetIds;
  if (setId != null) {
    assetIds = db.prepare('SELECT asset_id AS id FROM set_members WHERE set_id = ?').all(setId).map((r) => r.id);
  } else {
    assetIds = db.prepare('SELECT id FROM assets WHERE profile_id = ?').all(profileId).map((r) => r.id);
  }
  const latest = db.prepare(
    'SELECT rel_price FROM price_history WHERE asset_id = ? ORDER BY ts DESC LIMIT 1'
  );
  const update = db.prepare('UPDATE assets SET baseline_rel = ?, baseline_at = ? WHERE id = ?');
  for (const id of assetIds) {
    const row = latest.get(id);
    if (row) update.run(row.rel_price, now, id);
  }
  if (setId != null) {
    db.prepare('DELETE FROM active_alerts WHERE set_id = ?').run(setId);
  } else {
    db.prepare(
      'DELETE FROM active_alerts WHERE set_id IN (SELECT id FROM sets WHERE profile_id = ?)'
    ).run(profileId);
  }
}

module.exports = { pollProfiles, resetBaselines, evaluateProfile };
