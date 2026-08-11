const db = require('./db');
const { fetchUsdPrices } = require('./pricing');

// Core engine. Each profile is one flat pool of assets with target
// allocation percentages that total 100 (the tethered index asset included).
//
// The index denomination is derived from the checkmarked tethered asset
// (is_index) — NOT a separate stored string. Everything is valued in that
// asset's currency; the tethered asset is pinned 1:1 (e.g. USDT for a USD
// account, a peso holding for an MXN account). No tethered asset -> USD.
//
// Every poll: price each asset in index terms, total the pool, compute each
// asset's actual share, drift = (actual% - target%)/target% (relative to the
// target), and alert with the corrective market trade when a BASE asset
// crosses threshold. The tethered index asset never trades and never alerts
// alone (note only).
//
// Two chained performance indexes, both continuous across structural changes
// (target edits, deposits, withdrawals) — only trading and market moves ever
// move them:
//   * currency basket = basket_base x Σ target_weight x (units/snapshot_units)
//     — unit growth, independent of prices.
//   * value index     = value_base x (total_value_in_index / value_snap_rel)
//     — dollar/index-value growth (trading + market).
// A "splice" folds the current level into the base and re-anchors, so the
// structural change itself never moves the number.

const REARM_FRACTION = 0.5;
const NOTIFY_TIMEOUT_MS = 12 * 60 * 60 * 1000;

// Phase 1 calibration: profiles.threshold_pct means PRICE-MOVE SENSITIVITY X
// ("react when an asset has effectively moved ~X% against the rest of the
// account"). Allocation drift stays the trigger quantity — it ignores
// unharvestable correlated moves and catches creeping multi-asset imbalance —
// but a uniform drift threshold is miscalibrated across weights (the
// denominator moves: a 56%-weight asset needs a ~26% price move to hit 10%
// drift, a 4%-weight asset only ~10.5%). Normalizing per asset by
//   T = X(1−w)/(1+wX)     (X, w, T all fractions; w = target weight)
// makes every asset trigger at the same own-price move ≈ X.
// Returns null (never triggers) for degenerate inputs: X<=0, or w>=1 where
// the share is pinned and drift is meaningless.
function effectiveThreshold(X, w) {
  if (!(X > 0) || !(w >= 0) || w >= 1) return null;
  return (X * (1 - w)) / (1 + w * X);
}

// USD-pegged assets that represent the US dollar as an index: pinned to
// exactly $1 so a USD-denominated account stays clean (small market variation
// deliberately ignored). Other tethered assets (e.g. fiat:mxn) use their real
// USD price so the account denominates in that currency.
const USD_PEGGED = new Set([
  'usd', 'fiat:usd', 'tether', 'usd-coin', 'dai', 'binance-usd', 'true-usd',
  'usdd', 'first-digital-usd', 'paxos-standard', 'gemini-dollar',
]);

// USD price of one unit of the profile's index currency, from the tethered
// asset. Returns 1 when USD-pegged or no tether; null when the tether's price
// is missing this round (can't denominate — skip the profile).
function indexUsdFor(assets, usdPrices) {
  const t = assets.find((a) => a.is_index);
  if (!t) return 1;
  if (USD_PEGGED.has(t.coingecko_id)) return 1;
  const u = usdPrices[t.coingecko_id];
  return u > 0 ? u : null;
}

// Display label for the index currency (the tethered asset's symbol, or USD).
function indexLabel(assets) {
  const t = assets.find((a) => a.is_index);
  return t ? t.symbol.toUpperCase() : 'USD';
}

function indexLabelForProfile(profileId) {
  return indexLabel(db.prepare('SELECT symbol, is_index FROM assets WHERE profile_id = ?').all(profileId));
}

// Price one asset: rel = value in index-currency units, usd = value in USD.
function priceAsset(asset, indexUsd, usdPrices) {
  if (!indexUsd) return null;
  if (asset.is_index) return { rel: 1, usd: indexUsd }; // tethered: 1:1 by definition
  const cg = asset.coingecko_id;
  const assetUsd = cg === 'usd' || cg === 'fiat:usd' ? 1 : usdPrices[cg];
  if (!(assetUsd > 0)) return null;
  return { rel: assetUsd / indexUsd, usd: assetUsd };
}

// Currency basket, chain-linked. null until targets are set. Above 1 means
// more units of the underlying assets. The zero-total-weight guard matters:
// newly added assets carry basket_units (their add-time quantity), so
// without it a fresh no-targets profile would read basket = 0 — and the
// first setTargets would then freeze that 0 in as the base forever.
function computeBasket(assets, base = 1) {
  if (!assets.some((a) => a.basket_units != null)) return null;
  let inner = 0;
  let totalW = 0;
  for (const a of assets) {
    const w = (a.target_pct || 0) / 100;
    const ratio = a.basket_units > 0 ? a.quantity / a.basket_units : 1;
    inner += w * ratio;
    totalW += w;
  }
  if (!(totalW > 0)) return null; // no targets yet — no basket to track
  return (base || 1) * inner;
}

// Chained value-growth index (time-weighted). null until anchored.
function computeValueIndex(profile, totalRel) {
  if (!(totalRel > 0) || !(profile.value_snap_rel > 0)) return null;
  return (profile.value_base || 1) * (totalRel / profile.value_snap_rel);
}

// Behind-the-scenes ledger row per splice: level + weights, for later
// analysis of which asset mixes performed best.
function recordBasketEvent(profileId, ts, kind, basket, valueIndex, assets, note) {
  const weights = {};
  for (const a of assets) weights[a.symbol] = a.target_pct || 0;
  db.prepare(
    'INSERT INTO basket_events (profile_id, ts, kind, basket, value_index, weights, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(profileId, ts, kind, basket == null ? null : basket, valueIndex == null ? null : valueIndex, JSON.stringify(weights), note || null);
}

function latestValueIndex(profileId) {
  const row = db
    .prepare('SELECT value_index FROM profile_snapshots WHERE profile_id = ? AND value_index IS NOT NULL ORDER BY ts DESC LIMIT 1')
    .get(profileId);
  return row ? row.value_index : null;
}

function evaluateProfile(profile, usdPrices, now) {
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profile.id);
  const indexUsd = indexUsdFor(assets, usdPrices);
  const insertHistory = db.prepare(
    'INSERT INTO price_history (profile_id, asset_id, ts, usd_price, rel_price) VALUES (?, ?, ?, ?, ?)'
  );

  const priced = [];
  for (const asset of assets) {
    const p = priceAsset(asset, indexUsd, usdPrices);
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

  const breaches = [];
  const newBreaches = [];
  let indexNote = null;
  const sensitivity = profile.threshold_pct / 100; // price-move sensitivity X
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
        indexNote = {
          symbol: p.asset.symbol,
          actualPct,
          targetPct: target,
          deltaIndex: valueRel - (target / 100) * totalRel, // >0 overweight
          holdRel: valueRel,
          targetRel: (target / 100) * totalRel,
        };
        continue;
      }

      const active = getActive.get(p.asset.id);
      const tEff = effectiveThreshold(sensitivity, target / 100);
      if (tEff == null) {
        // Degenerate weight (w>=1): drift can't move — never alert, and drop
        // any stale active alert so it can't linger.
        if (active) clearActive.run(p.asset.id);
        continue;
      }
      if (Math.abs(driftRel) >= tEff) {
        const deltaRel = (target / 100) * totalRel - valueRel; // >0 buy, <0 sell
        // Phase 3: structural-break buy-freeze. Suppression lives HERE, not
        // in the mailer: a frozen asset's BUY breach neither emails, nor
        // marks alloc_alerts, nor consumes the armed state. SELLs pass.
        // freeze_override is the human veto: status keeps tracking, but the
        // suppression stands down while it's set.
        if (deltaRel > 0 && p.asset.buy_frozen && !p.asset.freeze_override) continue;
        const breach = {
          profile,
          asset: p.asset,
          actualPct,
          targetPct: target,
          driftRelPct: driftRel * 100,
          thresholdPct: tEff * 100, // this asset's effective drift threshold
          action: deltaRel > 0 ? 'BUY' : 'SELL',
          quantity: Math.abs(deltaRel) / p.rel,
          indexAmount: Math.abs(deltaRel),
          // The stale-proof numbers: an hour later the quantity above is
          // outdated, but "trade until the position's value reads ≈ targetRel"
          // still lands on target.
          holdRel: valueRel,
          targetRel: (target / 100) * totalRel,
        };
        breaches.push(breach);
        if (!active) newBreaches.push(breach);
      } else if (active && Math.abs(driftRel) < tEff * REARM_FRACTION) {
        clearActive.run(p.asset.id);
      }
    }
    breaches.sort((a, b) => Math.abs(b.driftRelPct) - Math.abs(a.driftRelPct));
    newBreaches.sort((a, b) => Math.abs(b.driftRelPct) - Math.abs(a.driftRelPct));
  }

  if (priced.length > 0) {
    // Anchor the value index the first time the pool has a value. Anchors at
    // the CURRENT total (fresh start at 1.0) rather than an old snapshot —
    // the index denomination now derives from the tethered asset, so historic
    // totals may be in a different currency and aren't comparable.
    if (!(profile.value_snap_rel > 0) && totalRel > 0) {
      db.prepare('UPDATE profiles SET value_base = 1, value_snap_rel = ?, value_started_at = ? WHERE id = ?').run(totalRel, now, profile.id);
      profile.value_base = 1;
      profile.value_snap_rel = totalRel;
      profile.value_started_at = now;
    }
    const quantities = {};
    for (const p of priced) quantities[p.asset.symbol] = p.asset.quantity;
    db.prepare(
      'INSERT INTO profile_snapshots (profile_id, ts, total_usd, total_rel, basket, value_index, quantities) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      profile.id,
      now,
      totalUsd,
      totalRel,
      computeBasket(assets, profile.basket_base),
      computeValueIndex(profile, totalRel),
      JSON.stringify(quantities)
    );
  }

  db.prepare('UPDATE profiles SET last_polled_at = ? WHERE id = ?').run(now, profile.id);
  return { breaches, newBreaches, indexNote };
}

// ---- notification state machine --------------------------------------------

function setNotifyState(profileId, state, now) {
  db.prepare('UPDATE profiles SET notify_state = ?, notify_state_at = ? WHERE id = ?').run(state, now, profileId);
}

function clearProfileAlerts(profileId) {
  db.prepare('DELETE FROM alloc_alerts WHERE asset_id IN (SELECT id FROM assets WHERE profile_id = ?)').run(profileId);
}

function markActive(breaches, now) {
  const add = db.prepare('INSERT OR REPLACE INTO alloc_alerts (asset_id, triggered_at, drift_rel_pct) VALUES (?, ?, ?)');
  for (const b of breaches) add.run(b.asset.id, now, b.driftRelPct);
}

function applyTimeout(profile, now) {
  if (profile.notify_state !== 'armed' && profile.notify_state_at && now - profile.notify_state_at >= NOTIFY_TIMEOUT_MS) {
    setNotifyState(profile.id, 'armed', now);
    clearProfileAlerts(profile.id);
    profile.notify_state = 'armed';
    profile.notify_state_at = now;
  }
}

// "Poll now" (manual) is a universal reset from any state; scheduled polls
// notify only from 'armed' on a NEW hit.
function decideNotification(profile, result, manual, now) {
  const state = profile.notify_state || 'armed';
  const { breaches, newBreaches, indexNote } = result;

  if (manual) {
    if (breaches.length > 0) {
      markActive(breaches, now);
      setNotifyState(profile.id, 'notified', now);
      return { profile, alerts: breaches, indexNote };
    }
    setNotifyState(profile.id, 'armed', now);
    return null;
  }

  // Per-ASSET quiet period: repeats of already-notified breaches stay silent
  // (alloc_alerts marks them active), but a breach on an asset NOT in the
  // notified set is NEW information — a just-unfrozen asset, a fresh drift —
  // and sends even while the profile is in its quiet window. (Observed live
  // 2026-07-21: a DOGE advice sat silent for over an hour behind an earlier
  // email's quiet period.) The 12h timeout and all re-arm paths unchanged.
  if (newBreaches.length > 0) {
    markActive(breaches, now);
    setNotifyState(profile.id, 'notified', now);
    return { profile, alerts: breaches, indexNote };
  }
  return null;
}

function rearmAfterUpload(profileId) {
  setNotifyState(profileId, 'armed', Date.now());
}

async function pollProfiles({ force = false, profileId = null, manual = false } = {}) {
  const now = Date.now();
  let profiles = db.prepare('SELECT * FROM profiles WHERE enabled = 1').all();
  if (profileId != null) profiles = profiles.filter((p) => p.id === profileId);
  if (!force) {
    profiles = profiles.filter((p) => !p.last_polled_at || now - p.last_polled_at >= p.poll_minutes * 60_000 - 5_000);
  }
  if (profiles.length === 0) return { polled: 0, events: [] };

  // The tethered asset's coingecko_id is already in each profile's asset list,
  // so collecting asset ids also fetches whatever the index needs.
  const ids = new Set();
  for (const p of profiles) {
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

// ---- splices: target changes and deposits/withdrawals ----------------------

function validateTargets(assets, targets) {
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
  if (Math.abs(sum - 100) > 0.01) throw new Error(`targets must total 100% (got ${sum.toFixed(2)}%)`);
  return byId;
}

// "Set new targets": change the intended mix. Chain-linked by default — the
// currency basket stays continuous across the change (only trading moves it).
// resetBasket=true starts a fresh track record at 1.0. The value index is not
// affected (targets don't change value). Clears active alerts.
function setTargets(profileId, targets, { resetBasket = false } = {}) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (!profile) throw new Error('profile not found');
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profileId);
  if (assets.length === 0) throw new Error('profile has no assets');
  const byId = validateTargets(assets, targets);

  const now = Date.now();
  db.transaction(() => {
    // 1. Freeze the basket level BEFORE the change.
    const before = computeBasket(assets, profile.basket_base);
    const newBase = resetBasket || before == null ? 1 : before;
    // 2. Apply new targets and re-snapshot units at current quantities.
    const update = db.prepare('UPDATE assets SET target_pct = ?, basket_units = ? WHERE id = ?');
    for (const t of targets) {
      const a = byId.get(Number(t.asset_id));
      update.run(Number(t.target_pct), a.quantity, a.id);
    }
    // 3. Re-base so the basket reads the same instant after as before.
    db.prepare('UPDATE profiles SET basket_base = ?, basket_started_at = ? WHERE id = ?').run(newBase, now, profileId);
    clearProfileAlerts(profileId);
    const after = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profileId);
    recordBasketEvent(profileId, now, resetBasket ? 'reset' : 'targets', newBase, latestValueIndex(profileId), after, null);
  })();
}

// Record a deposit/withdrawal: per-asset signed quantity deltas that splice
// past BOTH the currency basket and the value index, so external money never
// registers as performance. Values assets at live prices for an exact splice.
// opts.ts records the flow's real timestamp (exchange-synced flows carry the
// venue's event time); the splice itself is always valued at current prices —
// that's the only self-consistent snapshot for re-anchoring.
async function recordFlow(profileId, deltas, note, opts = {}) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (!profile) throw new Error('profile not found');
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profileId);
  const byId = new Map(assets.map((a) => [a.id, a]));

  const applied = [];
  for (const d of deltas || []) {
    const id = Number(d.asset_id);
    const delta = Number(d.delta);
    const a = byId.get(id);
    if (!a) throw new Error(`unknown asset ${d.asset_id}`);
    if (!Number.isFinite(delta) || delta === 0) continue;
    if (a.quantity + delta < 0) throw new Error(`${a.symbol.toUpperCase()}: withdrawal exceeds balance`);
    applied.push({ asset: a, delta });
  }
  if (applied.length === 0) throw new Error('no non-zero deltas');

  const usdPrices = await fetchUsdPrices(assets.map((a) => a.coingecko_id));
  const indexUsd = indexUsdFor(assets, usdPrices);
  const relOf = (a) => {
    const p = priceAsset(a, indexUsd, usdPrices);
    return p ? p.rel : null;
  };

  const now = Date.now();
  const recordTs = Number(opts.ts) > 0 ? Number(opts.ts) : now;
  db.transaction(() => {
    // Value index: level before, using live prices across every asset.
    let relBefore = 0;
    let relAfter = 0;
    for (const a of assets) {
      const r = relOf(a);
      if (r == null) continue;
      const d = applied.find((x) => x.asset.id === a.id);
      relBefore += a.quantity * r;
      relAfter += (a.quantity + (d ? d.delta : 0)) * r;
    }
    const valueBefore = computeValueIndex(profile, relBefore);
    // Basket: level before.
    const basketBefore = computeBasket(assets, profile.basket_base);

    // Apply the quantity deltas.
    const upd = db.prepare('UPDATE assets SET quantity = ? WHERE id = ?');
    for (const { asset, delta } of applied) upd.run(asset.quantity + delta, asset.id);
    const after = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profileId);

    // Basket splice: re-snapshot units at new quantities, base = level before.
    if (basketBefore != null) {
      const snap = db.prepare('UPDATE assets SET basket_units = ? WHERE id = ?');
      for (const a of after) snap.run(a.quantity, a.id);
      db.prepare('UPDATE profiles SET basket_base = ? WHERE id = ?').run(basketBefore, profileId);
    }
    // Value splice: value_snap_rel = post-flow total, value_base = level before
    // (so value_index reads identically before and after). Anchor if new.
    if (relAfter > 0) {
      if (profile.value_snap_rel > 0 && valueBefore != null) {
        db.prepare('UPDATE profiles SET value_base = ?, value_snap_rel = ? WHERE id = ?').run(valueBefore, relAfter, profileId);
      } else {
        db.prepare('UPDATE profiles SET value_base = 1, value_snap_rel = ?, value_started_at = ? WHERE id = ?').run(relAfter, now, profileId);
      }
    }

    db.prepare('INSERT INTO flows (profile_id, ts, deltas, note) VALUES (?, ?, ?, ?)').run(
      profileId,
      recordTs,
      JSON.stringify(applied.map((a) => ({ asset_id: a.asset.id, symbol: a.asset.symbol, delta: a.delta }))),
      note || null
    );
    recordBasketEvent(profileId, recordTs, 'flow', basketBefore, valueBefore, after, note || null);
  })();
  return { applied: applied.length };
}

// Total pool value in index units for a given denomination (indexUsd) and a
// USD-price map. Used by the index-switch splice to value the pool in both the
// old and new denominations from a single price fetch.
function sumRel(assets, indexUsd, usdPrices) {
  let total = 0;
  for (const a of assets) {
    const p = priceAsset(a, indexUsd, usdPrices);
    if (p) total += a.quantity * p.rel;
  }
  return total;
}

// Change the tethered index asset (assetId, or null to clear). This changes the
// pool's denomination, so it splices the value index exactly like a flow: the
// growth level is frozen and re-anchored to the new-denomination total, keeping
// performance (and its start date) continuous. The basket is unit-based, so it
// is unaffected. Callers should re-poll afterward to store fresh prices.
async function setIndexAsset(profileId, assetId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (!profile) throw new Error('profile not found');
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profileId);
  const targetId = assetId == null ? null : Number(assetId);
  if (targetId != null && !assets.some((a) => a.id === targetId)) throw new Error('unknown asset');

  const usdPrices = await fetchUsdPrices(assets.map((a) => a.coingecko_id));

  // Value-index level BEFORE the change, in the OLD denomination.
  const totalRelOld = sumRel(assets, indexUsdFor(assets, usdPrices), usdPrices);
  const valueBefore = computeValueIndex(profile, totalRelOld);

  // Total in the NEW denomination (tethered asset flipped in-memory).
  const flipped = assets.map((a) => ({ ...a, is_index: a.id === targetId ? 1 : 0 }));
  const totalRelNew = sumRel(flipped, indexUsdFor(flipped, usdPrices), usdPrices);

  const now = Date.now();
  db.transaction(() => {
    db.prepare('UPDATE assets SET is_index = 0 WHERE profile_id = ?').run(profileId);
    if (targetId != null) db.prepare('UPDATE assets SET is_index = 1 WHERE id = ?').run(targetId);

    if (totalRelNew > 0) {
      if (profile.value_snap_rel > 0 && valueBefore != null) {
        // Splice: value_index reads identically before and after the switch.
        db.prepare('UPDATE profiles SET value_base = ?, value_snap_rel = ? WHERE id = ?').run(valueBefore, totalRelNew, profileId);
      } else {
        // No prior anchor: start the track record fresh in the new denomination.
        db.prepare('UPDATE profiles SET value_base = 1, value_snap_rel = ?, value_started_at = ? WHERE id = ?').run(totalRelNew, now, profileId);
      }
    }
    const after = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profileId);
    recordBasketEvent(profileId, now, 'index', computeBasket(after, profile.basket_base), valueBefore, after, `index -> ${indexLabel(after)}`);
  })();
  return { indexLabel: indexLabel(flipped) };
}

module.exports = {
  pollProfiles,
  evaluateProfile,
  effectiveThreshold,
  setTargets,
  recordFlow,
  setIndexAsset,
  computeBasket,
  computeValueIndex,
  priceAsset,
  indexUsdFor,
  indexLabel,
  indexLabelForProfile,
  decideNotification,
  applyTimeout,
  rearmAfterUpload,
  NOTIFY_TIMEOUT_MS,
};
