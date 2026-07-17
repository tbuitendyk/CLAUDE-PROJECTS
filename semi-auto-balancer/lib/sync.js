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
  return db.prepare('SELECT * FROM exchange_accounts WHERE profile_id = ?').get(profileId);
}

// Observed taker fee from the account's real fills — the advisory input that
// calibrates profiles.fee_pct against genuinely executed trades.
function observedFee(accountId, sample = 50) {
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
async function applyPendingFlow(flowId) {
  const flow = db.prepare("SELECT * FROM pending_flows WHERE id = ? AND status = 'pending'").get(flowId);
  if (!flow) throw new Error('pending flow not found (already applied or dismissed?)');
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(flow.profile_id);
  const asset = flow.asset_id
    ? assets.find((a) => a.id === flow.asset_id)
    : matchVenueAsset(assets, flow.code);
  if (!asset) {
    throw new Error(`no asset matches "${flow.code.toUpperCase()}" — add it to the profile, then confirm`);
  }
  const account = getAccount(flow.account_id);
  await recordFlow(
    flow.profile_id,
    [{ asset_id: asset.id, delta: flow.amount }],
    `${account ? account.venue : 'exchange'} ${flow.kind} (synced, ${new Date(flow.ts).toISOString()})`,
    { ts: flow.ts }
  );
  db.prepare("UPDATE pending_flows SET status = 'applied', asset_id = ? WHERE id = ?").run(asset.id, flowId);
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
    // All venue I/O happens before the DB transaction.
    const [balances, trades, flows] = [
      await c.fetchBalances(),
      await c.fetchTradesSince(account.last_trade_ts),
      await c.fetchFlowsSince(account.last_ledger_ts),
    ];

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
        JSON.stringify({ unmapped: summary.unmapped, unexplained: summary.unexplained }),
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

module.exports = {
  syncAccount,
  syncDueAccounts,
  createAccount,
  applyPendingFlow,
  dismissPendingFlow,
  observedFee,
  matchVenueAsset,
  getAccountForProfile,
  makeClientFor,
  VENUES,
};
