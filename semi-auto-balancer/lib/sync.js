const db = require('./db');
const { recordFlow, rearmAfterUpload } = require('./balancer');
const kraken = require('./exchanges/kraken');
const bitso = require('./exchanges/bitso');

// Reconciliation engine (Phase 1.5) — the point of the phase: each sync
// explains the quantity diff between what the app tracks and what the venue
// holds.
//
//   * TRADES (from trade history) update quantities with NO splice — trading
//     is the harvest registering, so the basket and value index move.
//   * DEPOSITS/WITHDRAWALS (from the venue ledger) become pending flows;
//     confirming applies the exact-amount splice via recordFlow with the
//     venue's real timestamp (auto-applied once the account is trusted —
//     auto_flows). A wrong flow splice silently corrupts the basket, hence
//     the confirmation gate by default.
//   * Whatever remains is either snapped (dust within tolerance — the venue
//     balance is ground truth) or surfaced as an unexplained residual for
//     the user to classify. It is never silently applied: applying a flow as
//     a trade (or vice versa) corrupts exactly one of the two indexes.
//
// Applying trades also re-arms notifications: alert → user trades on the
// venue → sync sees the fill → quantities update → the armed state returns
// without the user uploading anything.

const VENUES = { kraken, bitso };

// Residual tolerance: |residual| beyond max(absolute, relative × balance)
// is "unexplained"; anything inside is venue dust (fee rounding, precision)
// and snaps to the venue balance silently.
const RESIDUAL_ABS = 1e-8;
const RESIDUAL_REL = 5e-4; // 0.05%

function makeClientFor(account) {
  const venue = VENUES[account.venue];
  if (!venue) throw new Error(`unknown venue: ${account.venue}`);
  return venue.makeClient({ apiKey: account.api_key, apiSecret: account.api_secret });
}

// Fiat codes the sync may SYNTHESIZE an asset row for when a trade leg
// settles in a currency no profile tracks yet (observed live 2026-07-21:
// BUY legs settled in USD were silently dropped — the cash vanished from
// the virtual books). Cash must always have a home; unknown NON-fiat codes
// queue the whole fill for a human instead.
const SYNTH_FIATS = new Set(['usd', 'eur', 'mxn', 'cad', 'gbp', 'ars', 'brl', 'cop', 'chf', 'jpy', 'aud']);

// Venue currency code -> profile asset, mirroring the screenshot-import
// matching: symbol first, fiat:<code> second, USD's pseudo/tether forms last.
function matchVenueAsset(assets, code) {
  return (
    assets.find((a) => a.symbol.toLowerCase() === code) ||
    assets.find((a) => a.coingecko_id === `fiat:${code}`) ||
    (code === 'usd'
      ? assets.find((a) => a.coingecko_id === 'usd' || a.coingecko_id === 'fiat:usd')
      : undefined)
  );
}

function getAccount(accountId) {
  return db.prepare('SELECT * FROM exchange_accounts WHERE id = ?').get(accountId);
}

function getAccountForProfile(profileId) {
  // Phase 6: linked profiles (profiles.exchange_account_id) resolve first —
  // several profiles may share one account; the legacy owner-column lookup
  // stays as the fallback for unmigrated rows.
  const p = db.prepare('SELECT exchange_account_id FROM profiles WHERE id = ?').get(profileId);
  if (p && p.exchange_account_id) return getAccount(p.exchange_account_id);
  return db.prepare('SELECT * FROM exchange_accounts WHERE profile_id = ?').get(profileId);
}

// Observed taker fee from the account's real fills — the advisory input that
// calibrates profiles.fee_pct against genuinely executed trades.
// Sample = last 10 fills (user-tuned): a one-off expensive trade at account
// setup (e.g. a fiat conversion) must age out of the calibration quickly
// instead of dragging the average for fifty fills.
function observedFee(accountId, sample = 10) {
  const row = db
    .prepare(
      `SELECT AVG(fee_pct) AS avg_pct, COUNT(*) AS n FROM (
         SELECT fee_pct FROM exchange_trades
         WHERE account_id = ? AND fee_pct IS NOT NULL
         ORDER BY ts DESC LIMIT ?
       )`
    )
    .get(accountId, sample);
  return row && row.n > 0 ? { feePct: row.avg_pct, trades: row.n } : null;
}

// Create (or replace) the profile's linked account. Watermarks start at link
// time: the venue history from before the link never replays — current
// quantities are the baseline reconciliation explains forward from.
function createAccount(profileId, venue, apiKey, apiSecret) {
  if (!VENUES[venue]) throw new Error(`unknown venue: ${venue}`);
  if (!apiKey || !apiSecret) throw new Error('api_key and api_secret required');
  const now = Date.now();
  return db.transaction(() => {
    db.prepare('DELETE FROM exchange_accounts WHERE profile_id = ?').run(profileId);
    const info = db
      .prepare(
        `INSERT INTO exchange_accounts
           (profile_id, venue, api_key, api_secret, last_trade_ts, last_ledger_ts, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(profileId, venue, apiKey, apiSecret, now, now, now);
    return getAccount(info.lastInsertRowid);
  })();
}

// Apply one pending flow: the exact-amount splice, stamped with the venue's
// real event timestamp. Throws when the flow's currency has no matching
// asset yet (add the asset first, then confirm).
async function applyPendingFlow(flowId, overrideProfileId = null) {
  const flow = db.prepare("SELECT * FROM pending_flows WHERE id = ? AND status = 'pending'").get(flowId);
  if (!flow) throw new Error('pending flow not found (already applied or dismissed?)');
  // Phase 6: the inbox may redirect a flow to a different LINKED profile at
  // apply time (the stored profile_id is only the suggestion).
  let targetProfileId = flow.profile_id;
  if (overrideProfileId != null && Number(overrideProfileId) !== flow.profile_id) {
    const target = db.prepare('SELECT * FROM profiles WHERE id = ?').get(overrideProfileId);
    if (!target || target.exchange_account_id !== flow.account_id) {
      throw new Error('target profile is not linked to this account');
    }
    targetProfileId = target.id;
  }
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(targetProfileId);
  let asset =
    (targetProfileId === flow.profile_id && flow.asset_id ? assets.find((a) => a.id === flow.asset_id) : null) ||
    matchVenueAsset(assets, flow.code);
  if (!asset) {
    // A linked sibling that knows the asset donates the identity (target 0).
    const donor = db
      .prepare(
        `SELECT a.* FROM assets a JOIN profiles p ON p.id = a.profile_id
         WHERE p.exchange_account_id = ? AND LOWER(a.symbol) = LOWER(?) LIMIT 1`
      )
      .get(flow.account_id, flow.code);
    if (!donor) throw new Error(`no asset matches "${flow.code.toUpperCase()}" — add it to the profile, then confirm`);
    asset = require('./subaccounts').ensureAsset(targetProfileId, donor);
  }
  const account = getAccount(flow.account_id);
  await recordFlow(
    targetProfileId,
    [{ asset_id: asset.id, delta: flow.amount }],
    `${account ? account.venue : 'exchange'} ${flow.kind} (synced, ${new Date(flow.ts).toISOString()})`,
    { ts: flow.ts }
  );
  db.prepare("UPDATE pending_flows SET status = 'applied', asset_id = ?, profile_id = ? WHERE id = ?").run(
    asset.id, targetProfileId, flowId
  );
  require('./subaccounts').logTxn({
    accountId: flow.account_id,
    profileId: targetProfileId,
    kind: 'flow-apply',
    ref: flow.venue_ref,
    deltas: [{ asset_id: asset.id, symbol: asset.symbol, delta: flow.amount }],
    note: `${flow.kind} of ${flow.amount} ${asset.symbol.toUpperCase()} applied to "${db.prepare('SELECT name FROM profiles WHERE id = ?').get(targetProfileId).name}"`,
    ts: Date.now(),
  });
  return { flowId, symbol: asset.symbol, delta: flow.amount };
}

function dismissPendingFlow(flowId) {
  const info = db
    .prepare("UPDATE pending_flows SET status = 'dismissed' WHERE id = ? AND status = 'pending'")
    .run(flowId);
  if (info.changes === 0) throw new Error('pending flow not found (already applied or dismissed?)');
}

// One full sync of a profile's linked account. `client` is injectable for
// tests; production builds it from the stored keys.
async function syncAccount(accountId, { client = null } = {}) {
  const account = getAccount(accountId);
  if (!account) throw new Error('exchange account not found');
  // Phase 6: two or more linked profiles → the account-level multi path
  // (attribution + shell). One linked profile keeps THIS original path,
  // byte-for-byte — migration is a no-op until a second profile links.
  const linked = db
    .prepare('SELECT * FROM profiles WHERE exchange_account_id = ? ORDER BY is_shell, id')
    .all(accountId);
  if (linked.length > 1) return syncAccountMulti(account, client, linked);
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(account.profile_id);
  if (!profile) throw new Error('profile not found');
  const c = client || makeClientFor(account);

  const summary = {
    venue: account.venue,
    tradesApplied: 0,
    tradeDeltas: {}, // symbol -> net delta
    newPendingFlows: 0,
    autoAppliedFlows: 0,
    adopted: [], // [{symbol, quantity}] fresh-profile baseline adoption
    snapped: [], // [{symbol, from, to}] dust corrections
    unexplained: [], // [{code, symbol, residual}] needs user classification
    unmapped: [], // venue codes with balance but no matching asset
    rearmed: false,
  };

  try {
    // All venue I/O happens before the DB transaction. Balances are the hard
    // requirement (ground truth — without them there is nothing to reconcile,
    // so a failure fails the sync). Trade and ledger history degrade
    // gracefully: some venues gate them behind extra key permissions (Bitso
    // bundles reading your own fills under its trading permission), and a
    // partial sync that says WHAT it couldn't see beats a hard failure.
    // Watermarks don't advance for a failed endpoint, so nothing is skipped
    // once the permission is granted.
    const capability = { trades: 'ok', flows: 'ok' };
    const balances = await c.fetchBalances();
    let trades = [];
    let flows = [];
    try {
      trades = await c.fetchTradesSince(account.last_trade_ts);
    } catch (err) {
      capability.trades = err.message;
    }
    try {
      flows = await c.fetchFlowsSince(account.last_ledger_ts);
    } catch (err) {
      capability.flows = err.message;
    }
    summary.capability = capability;

    const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profile.id);
    const assetFor = (code) => matchVenueAsset(assets, code);

    let maxTradeTs = account.last_trade_ts;
    let maxLedgerTs = account.last_ledger_ts;
    const newPendingIds = [];
    const adoptDeltas = []; // zero-quantity assets adopting their venue balance

    db.transaction(() => {
      const qtyById = new Map(assets.map((a) => [a.id, a.quantity]));
      const updQty = db.prepare('UPDATE assets SET quantity = ? WHERE id = ?');
      const insTrade = db.prepare(
        `INSERT OR IGNORE INTO exchange_trades
           (account_id, venue_trade_id, ts, pair, side, price, cost, fee, fee_currency, fee_pct, deltas, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      // 1. Trades: apply quantity deltas directly — NO splice. Deduped by the
      // venue trade id so an interrupted sync can safely replay.
      const unmappedTradeCodes = new Set();
      for (const t of trades) {
        const inserted = insTrade.run(
          account.id,
          t.id,
          t.ts,
          t.pair || null,
          t.side || null,
          t.price ?? null,
          t.cost ?? null,
          t.fee ?? null,
          t.feeCurrency || null,
          t.feePct ?? null,
          JSON.stringify(t.deltas),
          JSON.stringify(t.raw ?? null)
        );
        if (t.ts > maxTradeTs) maxTradeTs = t.ts;
        if (inserted.changes === 0) continue; // already applied by an earlier sync
        summary.tradesApplied++;
        for (const d of t.deltas) {
          const asset = assetFor(d.code);
          if (!asset) {
            unmappedTradeCodes.add(d.code);
            continue;
          }
          const next = Math.max(0, (qtyById.get(asset.id) || 0) + d.delta);
          qtyById.set(asset.id, next);
          summary.tradeDeltas[asset.symbol] = (summary.tradeDeltas[asset.symbol] || 0) + d.delta;
        }
      }
      for (const code of unmappedTradeCodes) summary.unmapped.push(code);

      // 2. Flows: record as pending confirmations (UNIQUE(account, ref)
      // guards replays when a watermark didn't advance).
      const insFlow = db.prepare(
        `INSERT OR IGNORE INTO pending_flows
           (account_id, profile_id, venue_ref, ts, kind, code, asset_id, amount, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const f of flows) {
        if (f.ts > maxLedgerTs) maxLedgerTs = f.ts;
        if (!(Math.abs(f.amount) > 0)) continue;
        const asset = assetFor(f.code);
        const r = insFlow.run(
          account.id,
          profile.id,
          f.id,
          f.ts,
          f.kind,
          f.code,
          asset ? asset.id : null,
          f.amount,
          JSON.stringify(f.raw ?? null)
        );
        if (r.changes > 0) {
          summary.newPendingFlows++;
          newPendingIds.push(r.lastInsertRowid);
        }
      }

      // 3. Reconcile against venue balances (ground truth). Stored quantity
      // should equal venue balance MINUS still-pending flow deltas; only
      // assets the venue actually reports are reconciled (a profile may mix
      // in off-venue holdings — those are left alone).
      //
      // Baseline adoption, per asset: a tracked asset still at quantity 0
      // (nothing synced, typed, or pending explains it) whose venue balance
      // is positive is money the app simply hasn't started tracking yet —
      // typically an asset just added to the profile. Its balance is adopted
      // via the FLOW SPLICE path (recordFlow, after this transaction), so
      // starting to track it never registers as gains on the value index.
      // The zero-quantity check uses the post-trade quantity: a fill that
      // already explains the balance takes the normal reconcile path.
      const pendingByAsset = new Map();
      for (const p of db
        .prepare("SELECT asset_id, amount FROM pending_flows WHERE account_id = ? AND status = 'pending'")
        .all(account.id)) {
        if (p.asset_id != null) {
          pendingByAsset.set(p.asset_id, (pendingByAsset.get(p.asset_id) || 0) + p.amount);
        }
      }
      for (const b of balances) {
        const asset = assetFor(b.code);
        if (!asset) {
          if (b.amount > 1e-8) summary.unmapped.push(b.code);
          continue;
        }
        if (!(qtyById.get(asset.id) > 0) && !pendingByAsset.get(asset.id) && b.amount > 0) {
          adoptDeltas.push({ asset_id: asset.id, delta: b.amount, symbol: asset.symbol });
          continue;
        }
        const expected = (qtyById.get(asset.id) || 0) + (pendingByAsset.get(asset.id) || 0);
        const residual = b.amount - expected;
        const tolerance = Math.max(RESIDUAL_ABS, RESIDUAL_REL * Math.max(Math.abs(b.amount), 1e-8));
        if (Math.abs(residual) <= tolerance) {
          if (residual !== 0) {
            const target = b.amount - (pendingByAsset.get(asset.id) || 0);
            summary.snapped.push({ symbol: asset.symbol, from: qtyById.get(asset.id), to: target });
            qtyById.set(asset.id, target);
          }
        } else {
          summary.unexplained.push({ code: b.code, symbol: asset.symbol, residual });
        }
      }

      // Persist quantity changes.
      for (const a of assets) {
        const next = qtyById.get(a.id);
        if (next != null && next !== a.quantity) updQty.run(next, a.id);
      }

      summary.unmapped = [...new Set(summary.unmapped)];
      db.prepare(
        `UPDATE exchange_accounts SET last_trade_ts = ?, last_ledger_ts = ?, last_sync_at = ?,
           last_sync_status = 'ok', last_sync_note = ? WHERE id = ?`
      ).run(
        maxTradeTs,
        maxLedgerTs,
        Date.now(),
        JSON.stringify({ unmapped: summary.unmapped, unexplained: summary.unexplained, capability }),
        account.id
      );
    })();

    // 4. Baseline adoptions apply through recordFlow (needs live prices, so
    // post-commit): quantities land AND the value index / basket splice past
    // them — starting to track an asset is never performance. If pricing
    // fails, the assets stay at 0 and the next sync retries.
    if (adoptDeltas.length > 0) {
      try {
        await recordFlow(
          profile.id,
          adoptDeltas.map((d) => ({ asset_id: d.asset_id, delta: d.delta })),
          `${account.venue} baseline adoption (synced balances)`
        );
        for (const d of adoptDeltas) summary.adopted.push({ symbol: d.symbol, quantity: d.delta });
      } catch (err) {
        console.error(`baseline adoption failed for account ${account.id}:`, err.message);
        summary.adoptFailed = err.message;
      }
    }

    // 5. Trusted accounts apply detected flows immediately (same code path as
    // manual confirmation — recordFlow prices live, so it runs post-commit).
    if (account.auto_flows) {
      for (const id of newPendingIds) {
        try {
          await applyPendingFlow(id);
          summary.autoAppliedFlows++;
        } catch (err) {
          // Stays pending for manual confirmation (e.g. unmatched currency).
          console.error(`auto-apply flow ${id} failed:`, err.message);
        }
      }
    }

    // 6. The alert loop closes: fills seen -> quantities updated -> re-arm.
    if (summary.tradesApplied > 0 || summary.autoAppliedFlows > 0) {
      rearmAfterUpload(profile.id);
      summary.rearmed = true;
    }

    summary.feeObserved = observedFee(account.id);
    return summary;
  } catch (err) {
    db.prepare('UPDATE exchange_accounts SET last_sync_at = ?, last_sync_status = ? WHERE id = ?').run(
      Date.now(),
      err.message,
      accountId
    );
    throw err;
  }
}

// ---- Phase 6: account-level sync for MULTI-profile accounts -----------------
// Same venue I/O as the single path; the difference is WHO owns each event:
// trades attribute across linked profiles (T1 unique holder / T2 advice
// match / T3 inbox — queued fills apply nothing until assigned), flows get
// a suggested target, and the reconcile invariant runs account-wide with
// the SHELL absorbing dust so strategy track records never inherit noise.
async function syncAccountMulti(account, client, profiles) {
  const sub = require('./subaccounts');
  const c = client || makeClientFor(account);
  const shell = profiles.find((p) => p.is_shell) || null;
  const summary = {
    venue: account.venue,
    multi: true,
    linkedProfiles: profiles.length,
    tradesApplied: 0,
    tradesQueued: 0,
    attribution: { t1: 0, t2: 0, queued: 0 },
    tradeDeltas: {},
    newPendingFlows: 0,
    autoAppliedFlows: 0,
    adopted: [],
    snapped: [],
    unexplained: [],
    unmapped: [],
    perCode: [],
    rearmed: false,
  };

  try {
    const capability = { trades: 'ok', flows: 'ok' };
    const balances = await c.fetchBalances();
    let trades = [];
    let flows = [];
    try {
      trades = await c.fetchTradesSince(account.last_trade_ts);
    } catch (err) {
      capability.trades = err.message;
    }
    try {
      flows = await c.fetchFlowsSince(account.last_ledger_ts);
    } catch (err) {
      capability.flows = err.message;
    }
    summary.capability = capability;

    const assetsOf = new Map(
      profiles.map((p) => [p.id, db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(p.id)])
    );
    const holdersOf = (code) =>
      profiles
        .map((p) => {
          const a = matchVenueAsset(assetsOf.get(p.id), code);
          return a ? { profile: p, asset: a } : null;
        })
        .filter(Boolean);

    let maxTradeTs = account.last_trade_ts;
    let maxLedgerTs = account.last_ledger_ts;
    const newPendingIds = [];
    const adoptTargets = []; // {profileId, asset, delta}
    const aggFollowups = []; // {pair, side, ts, profileId, name} — aggregate-T2 sibling pulls
    const touchedProfiles = new Set();

    db.transaction(() => {
      const qty = new Map(); // asset_id -> live quantity during this pass
      for (const rows of assetsOf.values()) for (const a of rows) qty.set(a.id, a.quantity);
      const updQty = db.prepare('UPDATE assets SET quantity = ? WHERE id = ?');
      const insTrade = db.prepare(
        `INSERT OR IGNORE INTO exchange_trades
           (account_id, profile_id, venue_trade_id, ts, pair, side, price, cost, fee, fee_currency, fee_pct, deltas, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      // 1. Trades: attribute, then apply (or queue applying nothing).
      for (const t of trades) {
        if (t.ts > maxTradeTs) maxTradeTs = t.ts;
        const baseCode = String((t.pair || '').split(/[_/]/)[0] || (t.deltas[0] && t.deltas[0].code) || '').toLowerCase();
        const baseDelta = (t.deltas.find((d) => d.code === baseCode) || t.deltas[0] || { delta: 0 }).delta;
        let decision = sub.attributeTrade({
          trade: { ts: t.ts, side: t.side, baseCode, baseDelta, pair: t.pair || null, accountId: account.id, id: t.id },
          holders: holdersOf(baseCode),
          shell,
        });
        // EVERY leg must have a home BEFORE anything applies: a leg in an
        // unknown NON-fiat currency demotes the whole fill to the inbox —
        // a partially-applied trade silently destroys money on the books.
        // (Fiat legs synthesize their asset row at apply time below.)
        if (decision.profileId) {
          const targetAssets = assetsOf.get(decision.profileId);
          const stranger = t.deltas.find(
            (d) =>
              !matchVenueAsset(targetAssets, d.code) &&
              !holdersOf(d.code)[0] &&
              !SYNTH_FIATS.has(String(d.code).toLowerCase())
          );
          if (stranger) {
            summary.unmapped.push(stranger.code);
            decision = {
              queue: `settles in unmapped currency "${stranger.code}" — add that asset to a linked profile, then assign`,
              suggestedProfileId: decision.profileId,
            };
          }
        }
        const inserted = insTrade.run(
          account.id,
          decision.profileId ?? null,
          t.id, t.ts, t.pair || null, t.side || null, t.price ?? null, t.cost ?? null,
          t.fee ?? null, t.feeCurrency || null, t.feePct ?? null,
          JSON.stringify(t.deltas), JSON.stringify(t.raw ?? null)
        );
        if (inserted.changes === 0) continue; // replay of an already-seen fill

        if (decision.profileId) {
          const target = profiles.find((p) => p.id === decision.profileId);
          const applied = [];
          for (const d of t.deltas) {
            let asset = matchVenueAsset(assetsOf.get(target.id), d.code);
            if (!asset) {
              const donor = holdersOf(d.code)[0];
              // No donor anywhere: the pre-scan guarantees this is a known
              // fiat — synthesize its row so the cash leg lands on the books
              // instead of vanishing (the old `continue` here dropped it).
              asset = donor
                ? sub.ensureAsset(target.id, donor.asset)
                : sub.ensureAsset(target.id, {
                    coingecko_id: `fiat:${String(d.code).toLowerCase()}`,
                    symbol: String(d.code).toLowerCase(),
                  });
              assetsOf.get(target.id).push(asset);
              qty.set(asset.id, asset.quantity);
            }
            const next = Math.max(0, (qty.get(asset.id) || 0) + d.delta);
            qty.set(asset.id, next);
            applied.push({ asset_id: asset.id, symbol: asset.symbol, delta: d.delta });
            summary.tradeDeltas[asset.symbol] = (summary.tradeDeltas[asset.symbol] || 0) + d.delta;
          }
          summary.tradesApplied++;
          summary.attribution[decision.tier]++;
          touchedProfiles.add(target.id);
          sub.logTxn({
            accountId: account.id,
            profileId: target.id,
            kind: `trade-auto-${decision.tier}`,
            ref: t.id,
            deltas: applied,
            note:
              `${(t.side || 'trade').toUpperCase()} ${t.pair || baseCode} → "${target.name}" ` +
              (decision.tier === 't2'
                ? decision.aggregate
                  ? '(auto: partial fills aggregate-matched its advice)'
                  : '(auto: matched its own advice)'
                : target.is_shell
                  ? '(unallocated asset)'
                  : '(only holder)'),
            ts: t.ts,
          });
          if (decision.aggregate) {
            aggFollowups.push({
              pair: t.pair,
              side: t.side,
              ts: t.ts,
              sinceTs: decision.aggSinceTs ?? t.ts - sub.T2_WINDOW_MS,
              profileId: target.id,
              name: target.name,
            });
          }
        } else {
          db.prepare(
            `INSERT OR IGNORE INTO attribution_queue
               (account_id, kind, venue_ref, ts, pair, side, price, deltas, suggested_profile_id, reason)
             VALUES (?, 'trade', ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            account.id, t.id, t.ts, t.pair || null, t.side || null, t.price ?? null,
            JSON.stringify(t.deltas), decision.suggestedProfileId, decision.queue
          );
          summary.tradesQueued++;
          summary.attribution.queued++;
        }
      }

      // 2. Flows: pending as always; profile_id = the SUGGESTED target
      // (unique holder, else the shell) — changeable at apply time.
      const insFlow = db.prepare(
        `INSERT OR IGNORE INTO pending_flows
           (account_id, profile_id, venue_ref, ts, kind, code, asset_id, amount, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const f of flows) {
        if (f.ts > maxLedgerTs) maxLedgerTs = f.ts;
        if (!(Math.abs(f.amount) > 0)) continue;
        const holders = holdersOf(f.code);
        const suggested = holders.length === 1 ? holders[0] : null;
        const targetProfileId = suggested ? suggested.profile.id : (shell || profiles[0]).id;
        const r = insFlow.run(
          account.id, targetProfileId, f.id, f.ts, f.kind, f.code,
          suggested ? suggested.asset.id : null, f.amount, JSON.stringify(f.raw ?? null)
        );
        if (r.changes > 0) {
          summary.newPendingFlows++;
          newPendingIds.push(r.lastInsertRowid);
        }
      }

      // 3. Account-wide reconcile: physical = Σ profiles + pending + queued.
      const pendingByCode = new Map();
      for (const p of db
        .prepare("SELECT code, amount FROM pending_flows WHERE account_id = ? AND status = 'pending'")
        .all(account.id)) {
        const code = String(p.code).toLowerCase();
        pendingByCode.set(code, (pendingByCode.get(code) || 0) + p.amount);
      }
      const queuedByCode = new Map();
      for (const q of db
        .prepare("SELECT deltas FROM attribution_queue WHERE account_id = ? AND status = 'pending'")
        .all(account.id)) {
        for (const d of JSON.parse(q.deltas)) {
          const code = String(d.code).toLowerCase();
          queuedByCode.set(code, (queuedByCode.get(code) || 0) + d.delta);
        }
      }
      for (const b of balances) {
        const holders = holdersOf(b.code);
        if (holders.length === 0) {
          if (b.amount > 1e-8) summary.unmapped.push(b.code);
          continue;
        }
        const virtual = holders.reduce((s, h) => s + (qty.get(h.asset.id) || 0), 0);
        const pend = pendingByCode.get(b.code) || 0;
        const queued = queuedByCode.get(b.code) || 0;
        if (virtual === 0 && !pend && !queued && b.amount > 0 && holders.length === 1) {
          adoptTargets.push({ profileId: holders[0].profile.id, asset: holders[0].asset, delta: b.amount, symbol: holders[0].asset.symbol });
          continue;
        }
        const expected = virtual + pend + queued;
        const residual = b.amount - expected;
        const tolerance = Math.max(RESIDUAL_ABS, RESIDUAL_REL * Math.max(Math.abs(b.amount), 1e-8));
        if (Math.abs(residual) <= tolerance) {
          if (residual !== 0 && shell) {
            // Dust lands in the shell — strategy track records never absorb
            // noise they didn't earn.
            let sAsset = matchVenueAsset(assetsOf.get(shell.id), b.code);
            if (!sAsset) {
              sAsset = sub.ensureAsset(shell.id, holders[0].asset);
              assetsOf.get(shell.id).push(sAsset);
              qty.set(sAsset.id, sAsset.quantity);
            }
            const next = Math.max(0, (qty.get(sAsset.id) || 0) + residual);
            summary.snapped.push({ symbol: sAsset.symbol, from: qty.get(sAsset.id) || 0, to: next });
            qty.set(sAsset.id, next);
            sub.logTxn({
              accountId: account.id, profileId: shell.id, kind: 'snap', ref: null,
              deltas: [{ asset_id: sAsset.id, symbol: sAsset.symbol, delta: residual }],
              note: `dust snap ${residual > 0 ? '+' : ''}${residual} ${sAsset.symbol.toUpperCase()} → shell`,
            });
          }
        } else {
          summary.unexplained.push({ code: b.code, residual });
        }
        summary.perCode.push({ code: b.code, physical: b.amount, virtual, pending: pend, queued, residual });
      }

      // Persist every touched quantity.
      for (const rows of assetsOf.values()) {
        for (const a of rows) {
          const next = qty.get(a.id);
          if (next != null && next !== a.quantity) updQty.run(next, a.id);
        }
      }

      summary.unmapped = [...new Set(summary.unmapped)];
      db.prepare(
        `UPDATE exchange_accounts SET last_trade_ts = ?, last_ledger_ts = ?, last_sync_at = ?,
           last_sync_status = 'ok', last_sync_note = ? WHERE id = ?`
      ).run(
        maxTradeTs, maxLedgerTs, Date.now(),
        JSON.stringify({ multi: true, unmapped: summary.unmapped, unexplained: summary.unexplained, capability, perCode: summary.perCode }),
        account.id
      );
    })();

    // Aggregate-T2 follow-through: the earlier PIECES of the same advised
    // order may be sitting in the inbox — pull them onto the matched profile.
    // Runs post-flush so quantity writes never collide with the batch cache.
    for (const s of aggFollowups) {
      const sibs = db
        .prepare(
          `SELECT id FROM attribution_queue WHERE account_id = ? AND kind = 'trade' AND status = 'pending'
             AND pair = ? AND side = ? AND ts >= ? AND ts <= ?`
        )
        .all(account.id, s.pair, s.side, s.sinceTs, s.ts);
      for (const row of sibs) {
        try {
          sub.assignQueuedTrade(row.id, s.profileId, {
            kind: 'trade-auto-t2',
            note: `partial fill — aggregate matched "${s.name}" advice`,
          });
          summary.tradesApplied++;
          summary.attribution.t2++;
          summary.tradesQueued = Math.max(0, summary.tradesQueued - 1);
          touchedProfiles.add(s.profileId);
        } catch (err) {
          console.error(`aggregate sibling assign failed (queue ${row.id}):`, err.message);
        }
      }
    }

    // Baseline adoptions splice via recordFlow (live prices → post-commit).
    for (const t of adoptTargets) {
      try {
        await recordFlow(t.profileId, [{ asset_id: t.asset.id, delta: t.delta }], `${account.venue} baseline adoption (synced balances)`);
        summary.adopted.push({ symbol: t.symbol, quantity: t.delta });
        sub.logTxn({
          accountId: account.id, profileId: t.profileId, kind: 'adopt', ref: null,
          deltas: [{ asset_id: t.asset.id, symbol: t.symbol, delta: t.delta }],
          note: `adopted ${t.delta} ${t.symbol.toUpperCase()} (venue balance, sole holder)`,
        });
      } catch (err) {
        console.error(`baseline adoption failed for account ${account.id}:`, err.message);
        summary.adoptFailed = err.message;
      }
    }

    if (account.auto_flows) {
      for (const id of newPendingIds) {
        try {
          await applyPendingFlow(id);
          summary.autoAppliedFlows++;
        } catch (err) {
          console.error(`auto-apply flow ${id} failed:`, err.message);
        }
      }
    }

    for (const pid of touchedProfiles) rearmAfterUpload(pid);
    summary.rearmed = touchedProfiles.size > 0;
    summary.feeObserved = observedFee(account.id);
    return summary;
  } catch (err) {
    db.prepare('UPDATE exchange_accounts SET last_sync_at = ?, last_sync_status = ? WHERE id = ?').run(
      Date.now(), err.message, account.id
    );
    throw err;
  }
}

// Sync every enabled account that is due, per its own sync_minutes cadence.
// Called from the scheduler tick; each account failure is isolated.
async function syncDueAccounts() {
  const now = Date.now();
  const due = db
    .prepare('SELECT * FROM exchange_accounts WHERE enabled = 1')
    .all()
    .filter((a) => !a.last_sync_at || now - a.last_sync_at >= a.sync_minutes * 60_000 - 5_000);
  const results = [];
  for (const account of due) {
    try {
      const summary = await syncAccount(account.id);
      results.push({ accountId: account.id, profileId: account.profile_id, summary });
    } catch (err) {
      console.error(`Exchange sync failed for account ${account.id} (${account.venue}):`, err.message);
    }
  }
  return results;
}

// "Poll now" semantics with account groups: on the MASTER (shell) and on a
// profile that owns its account ALONE (1:1 link — the profile IS the account
// view) the button means "read the account, then reprice", so those sync the
// venue first. A grouped sub-account stays a pure price poll — its balances
// are managed by the account-level sync on the master, and per-sub clicks
// must not multiply venue API traffic. Returns the account id to sync before
// polling, or null for a pure price poll.
function syncScopeForPoll(profileId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (!profile) return null;
  const account = getAccountForProfile(profileId);
  if (!account) return null;
  const shell = db
    .prepare('SELECT id FROM profiles WHERE exchange_account_id = ? AND is_shell = 1')
    .get(account.id);
  if (!shell) return account.id; // 1:1 — no group, the profile is the account view
  return profile.is_shell ? account.id : null;
}

module.exports = {
  syncAccount,
  syncDueAccounts,
  syncScopeForPoll,
  createAccount,
  applyPendingFlow,
  dismissPendingFlow,
  observedFee,
  matchVenueAsset,
  getAccountForProfile,
  makeClientFor,
  VENUES,
};
