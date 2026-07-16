const db = require('./db');
const { fetchUsdPrices } = require('./pricing');

// Core engine. Each profile is one flat pool of assets with target
// allocation percentages that total 100 (the tethered index asset included).
// Every poll:
//  1. price every asset in index-asset terms; the tethered asset (is_index)
//     is pinned to exactly 1 (e.g. USDT on a USD index -- small market
//     variation is deliberately ignored)
//  2. total the pool and compute each asset's actual share of it
//  3. drift = (actual% - target%) / target%  -- RELATIVE to the target, so a
//     10% threshold on a 56% target trips at +/-5.6 absolute points
//  4. an asset crossing its threshold raises an alert carrying the exact
//     corrective market trade (buy/sell quantity + index-asset amount) to
//     bring THAT asset back to its target; assets inside their band are
//     left alone (dust trades lose money to spread)
//  5. the currency basket -- sum of (units / snapshot units) x target weight
//     -- is recorded so unit growth is visible independent of prices
//
// Alerts re-arm once the asset converges back under half its threshold, or
// when new targets are set.
//
// The tethered index asset never gets a trade recommendation and never
// triggers an alert by itself -- it is the counterparty leg. Its over/under
// weight is included in alert emails as an informational note only.
//
// Notifications follow a per-profile state machine:
//   armed           -- scheduled poll with a NEW breach -> notify -> 'notified'
//   notified        -- quiet; manual poll: still breaching -> notify again ->
//                      'awaiting_upload'; not breaching -> back to 'armed'
//   awaiting_upload -- quiet; manual poll restarts the clock; a screenshot
//                      import re-arms (new hits only)
// Both muted states time out after 12 hours back to 'armed' with alert
// state cleared, so a persisting breach produces a fresh reminder email.

const REARM_FRACTION = 0.5;
const NOTIFY_TIMEOUT_MS = 12 * 60 * 60 * 1000;

// Price one asset in USD and in index-asset units. Returns null when a
// price is missing this round (skip, don't alert on bad data).
function priceAsset(asset, profile, usdPrices) {
  const indexUsd = profile.index_asset === 'usd' ? 1 : usdPrices[profile.index_asset];
  if (!indexUsd) return null;
  if (asset.is_index) return { rel: 1, usd: indexUsd }; // tethered: 1:1 by definition
  const assetUsd = asset.coingecko_id === 'usd' ? 1 : usdPrices[asset.coingecko_id];
  if (!assetUsd) return null;
  return { rel: assetUsd / indexUsd, usd: assetUsd };
}

// Currency basket: starts at 1.00000000 when targets are set (unit snapshot
// taken); above 1 means the pool holds more units of the underlying assets.
function computeBasket(assets) {
  if (!assets.some((a) => a.basket_units != null)) return null;
  let basket = 0;
  for (const a of assets) {
    const w = (a.target_pct || 0) / 100;
    // Assets without a usable snapshot contribute neutrally (ratio 1).
    const ratio = a.basket_units > 0 ? a.quantity / a.basket_units : 1;
    basket += w * ratio;
  }
  return basket;
}

function evaluateProfile(profile, usdPrices, now) {
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profile.id);
  const insertHistory = db.prepare(
    'INSERT INTO price_history (profile_id, asset_id, ts, usd_price, rel_price) VALUES (?, ?, ?, ?, ?)'
  );

  const priced = [];
  for (const asset of assets) {
    const p = priceAsset(asset, profile, usdPrices);
    if (!p) continue;
    insertHistory.run(profile.id, asset.id, now, p.usd, p.rel);
    priced.push({ asset, rel: p.rel, usd: p.usd });
  }

  let totalRel = 0;
  let totalUsd = 0;
  for (const p of priced) {
    totalRel += p.asset.quantity * p.rel;
    totalUsd += p.asset.quantity * p.usd;
  }

  // Allocation drift, only when the whole pool priced (a missing price
  // skews every other asset's share). Base assets over threshold become
  // trade candidates; the tethered index asset only ever yields a note.
  // This function detects and clears (hysteresis) -- whether a breach turns
  // into a notification is the state machine's call.
  const breaches = [];
  const newBreaches = [];
  let indexNote = null;
  const threshold = profile.threshold_pct / 100;
  const getActive = db.prepare('SELECT * FROM alloc_alerts WHERE asset_id = ?');
  const clearActive = db.prepare('DELETE FROM alloc_alerts WHERE asset_id = ?');

  if (totalRel > 0 && priced.length === assets.length) {
    for (const p of priced) {
      const target = p.asset.target_pct;
      if (!target) continue;
      const valueRel = p.asset.quantity * p.rel;
      const actualPct = (valueRel / totalRel) * 100;
      const driftRel = (actualPct - target) / target;

      if (p.asset.is_index) {
        // Informational only: how far the index leg is over/under weight.
        indexNote = {
          symbol: p.asset.symbol,
          actualPct,
          targetPct: target,
          deltaIndex: valueRel - (target / 100) * totalRel, // >0 overweight
        };
        continue;
      }

      const active = getActive.get(p.asset.id);
      if (Math.abs(driftRel) >= threshold) {
        const deltaRel = (target / 100) * totalRel - valueRel; // >0 buy, <0 sell
        const breach = {
          profile,
          asset: p.asset,
          actualPct,
          targetPct: target,
          driftRelPct: driftRel * 100,
          action: deltaRel > 0 ? 'BUY' : 'SELL',
          quantity: Math.abs(deltaRel) / p.rel,
          indexAmount: Math.abs(deltaRel),
        };
        breaches.push(breach);
        if (!active) newBreaches.push(breach);
      } else if (active && Math.abs(driftRel) < threshold * REARM_FRACTION) {
        clearActive.run(p.asset.id);
      }
    }
    // Biggest breach first, in emails and logs alike.
    breaches.sort((a, b) => Math.abs(b.driftRelPct) - Math.abs(a.driftRelPct));
    newBreaches.sort((a, b) => Math.abs(b.driftRelPct) - Math.abs(a.driftRelPct));
  }

  if (priced.length > 0) {
    const quantities = {};
    for (const p of priced) quantities[p.asset.symbol] = p.asset.quantity;
    db.prepare(
      'INSERT INTO profile_snapshots (profile_id, ts, total_usd, total_rel, basket, quantities) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(profile.id, now, totalUsd, totalRel, computeBasket(assets), JSON.stringify(quantities));
  }

  db.prepare('UPDATE profiles SET last_polled_at = ? WHERE id = ?').run(now, profile.id);
  return { breaches, newBreaches, indexNote };
}

// ---- notification state machine --------------------------------------------

function setNotifyState(profileId, state, now) {
  db.prepare('UPDATE profiles SET notify_state = ?, notify_state_at = ? WHERE id = ?').run(
    state,
    now,
    profileId
  );
}

function clearProfileAlerts(profileId) {
  db.prepare(
    'DELETE FROM alloc_alerts WHERE asset_id IN (SELECT id FROM assets WHERE profile_id = ?)'
  ).run(profileId);
}

function markActive(breaches, now) {
  const add = db.prepare(
    'INSERT OR REPLACE INTO alloc_alerts (asset_id, triggered_at, drift_rel_pct) VALUES (?, ?, ?)'
  );
  for (const b of breaches) add.run(b.asset.id, now, b.driftRelPct);
}

// Muted states fall back to 'armed' after 12 hours with alert state cleared,
// so a breach that nobody acted on produces a fresh reminder.
function applyTimeout(profile, now) {
  if (
    profile.notify_state !== 'armed' &&
    profile.notify_state_at &&
    now - profile.notify_state_at >= NOTIFY_TIMEOUT_MS
  ) {
    setNotifyState(profile.id, 'armed', now);
    clearProfileAlerts(profile.id);
    profile.notify_state = 'armed';
    profile.notify_state_at = now;
  }
}

// Decides whether this poll produces a notification event. Returns
// {profile, alerts, indexNote} or null. `manual` marks a user-initiated poll.
function decideNotification(profile, result, manual, now) {
  const state = profile.notify_state || 'armed';
  const { breaches, newBreaches, indexNote } = result;

  if (state === 'armed') {
    // Scheduled polls notify only on a NEW hit; a manual "Poll now" treats
    // any currently-exceeded target as a fresh breach and notifies.
    const trigger = manual ? breaches.length > 0 : newBreaches.length > 0;
    if (!trigger) return null;
    markActive(breaches, now);
    setNotifyState(profile.id, 'notified', now);
    return { profile, alerts: breaches, indexNote };
  }

  if (state === 'notified') {
    if (!manual) return null; // quiet until the user checks in
    if (breaches.length > 0) {
      markActive(breaches, now);
      setNotifyState(profile.id, 'awaiting_upload', now);
      return { profile, alerts: breaches, indexNote };
    }
    setNotifyState(profile.id, 'armed', now); // drift resolved itself
    return null;
  }

  // awaiting_upload: silent; a manual poll restarts the 12h clock.
  if (manual) setNotifyState(profile.id, 'awaiting_upload', now);
  return null;
}

// A screenshot import was applied: re-arm. Still-active alerts stay marked,
// so only NEW target hits notify from here.
function rearmAfterUpload(profileId) {
  setNotifyState(profileId, 'armed', Date.now());
}

// Polls every due (or forced) profile in one CoinGecko round-trip.
// `manual` marks a user-initiated poll ("Poll now"), which the notification
// state machine treats differently from the scheduler's ticks.
async function pollProfiles({ force = false, profileId = null, manual = false } = {}) {
  const now = Date.now();
  let profiles = db.prepare('SELECT * FROM profiles WHERE enabled = 1').all();
  if (profileId != null) profiles = profiles.filter((p) => p.id === profileId);
  if (!force) {
    profiles = profiles.filter(
      (p) => !p.last_polled_at || now - p.last_polled_at >= p.poll_minutes * 60_000 - 5_000
    );
  }
  if (profiles.length === 0) return { polled: 0, events: [] };

  const ids = new Set();
  for (const p of profiles) {
    ids.add(p.index_asset);
    for (const a of db.prepare('SELECT coingecko_id FROM assets WHERE profile_id = ?').all(p.id)) {
      ids.add(a.coingecko_id);
    }
  }
  const usdPrices = await fetchUsdPrices([...ids]);

  const events = [];
  for (const p of profiles) {
    applyTimeout(p, now);
    const result = evaluateProfile(p, usdPrices, now);
    const event = decideNotification(p, result, manual, now);
    if (event) events.push(event);
  }
  return { polled: profiles.length, events };
}

// "Set new targets": the deliberate decision to change the intended mix.
// Targets (including the tethered asset's) must cover every asset and total
// 100. Takes a fresh unit snapshot, so the currency basket resets to
// 1.00000000, and clears active alerts so drift is re-judged against the
// new targets.
function setTargets(profileId, targets) {
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profileId);
  if (assets.length === 0) throw new Error('profile has no assets');
  const byId = new Map(assets.map((a) => [a.id, a]));
  const seen = new Set();
  let sum = 0;
  for (const t of targets || []) {
    const id = Number(t.asset_id);
    const pct = Number(t.target_pct);
    if (!byId.has(id)) throw new Error(`unknown asset ${t.asset_id}`);
    if (seen.has(id)) throw new Error('duplicate asset in targets');
    if (!(pct >= 0)) throw new Error('target_pct must be >= 0');
    seen.add(id);
    sum += pct;
  }
  if (seen.size !== assets.length) throw new Error('a target is required for every asset');
  if (Math.abs(sum - 100) > 0.01) {
    throw new Error(`targets must total 100% (got ${sum.toFixed(2)}%)`);
  }

  const now = Date.now();
  const update = db.prepare('UPDATE assets SET target_pct = ?, basket_units = ? WHERE id = ?');
  db.transaction(() => {
    for (const t of targets) {
      const asset = byId.get(Number(t.asset_id));
      update.run(Number(t.target_pct), asset.quantity, asset.id);
    }
    db.prepare('UPDATE profiles SET basket_started_at = ? WHERE id = ?').run(now, profileId);
    clearProfileAlerts(profileId);
  })();
}

module.exports = {
  pollProfiles,
  evaluateProfile,
  setTargets,
  computeBasket,
  priceAsset,
  decideNotification,
  applyTimeout,
  rearmAfterUpload,
  NOTIFY_TIMEOUT_MS,
};
