const db = require('./db');
const { recordFlow, indexUsdFor, priceAsset, indexLabel, computeBasket, computeValueIndex } = require('./balancer');
const { fetchUsdPrices } = require('./pricing');

// Phase 6 virtual sub-accounts: several profiles carve up ONE physical
// exchange account, each trading on its own alerts and tracking its own
// splice-continuous indices. This module owns the linking model, the
// "Unallocated" shell profile (the materialized residual pool), fill
// attribution (T1 unique holder / T2 advice match ±15% within 36h / T3
// inbox), the append-only transaction log, universal rewind/reassign, and
// carve-out virtual transfers. Advisory-only throughout — nothing here
// touches a venue.

const T2_SIZE_TOL = 0.15; // ±15% of the advised quantity (user's call)
const T2_WINDOW_MS = 36 * 3_600_000; // 36h from advice to fill (user's call)

// ---- linking + shell --------------------------------------------------------
function linkedProfiles(accountId) {
  return db
    .prepare('SELECT * FROM profiles WHERE exchange_account_id = ? ORDER BY is_shell, id')
    .all(accountId);
}

function shellOf(accountId) {
  return db
    .prepare('SELECT * FROM profiles WHERE exchange_account_id = ? AND is_shell = 1')
    .get(accountId) || null;
}

function linkProfile(profileId, accountId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (!profile) throw new Error('profile not found');
  const account = db.prepare('SELECT * FROM exchange_accounts WHERE id = ?').get(accountId);
  if (!account) throw new Error('exchange account not found');
  if (profile.exchange_account_id && profile.exchange_account_id !== accountId) {
    throw new Error('profile is linked to a different account — unlink it first');
  }
  db.prepare('UPDATE profiles SET exchange_account_id = ? WHERE id = ?').run(accountId, profileId);
  return linkedProfiles(accountId);
}

function unlinkProfile(profileId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (!profile) throw new Error('profile not found');
  if (profile.is_shell) throw new Error('the shell profile cannot be unlinked — it IS the unallocated pool');
  const owns = db.prepare('SELECT id FROM exchange_accounts WHERE profile_id = ?').get(profileId);
  if (owns) throw new Error('this profile owns the account keys — remove the account instead');
  db.prepare('UPDATE profiles SET exchange_account_id = NULL WHERE id = ?').run(profileId);
}

// Create (or return) the account's "Unallocated" shell: not a strategy — a
// visible pool. It POLLS for valuation (so the pool shows real prices and
// values in its chosen tether) but can never alert: alerts are off and it
// has no targets, so no breach is possible. Excluded from labs/scans.
function ensureShell(accountId) {
  const existing = shellOf(accountId);
  if (existing) return existing;
  const account = db.prepare('SELECT * FROM exchange_accounts WHERE id = ?').get(accountId);
  if (!account) throw new Error('exchange account not found');
  const info = db
    .prepare(
      `INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at, enabled, alerts_enabled, exchange_account_id, is_shell)
       VALUES (?, 5, 60, ?, 1, 0, ?, 1)`
    )
    .run(`Unallocated (${account.venue})`, Date.now(), accountId);
  return db.prepare('SELECT * FROM profiles WHERE id = ?').get(info.lastInsertRowid);
}

// Ensure `profile` carries an asset row matching another profile's asset (or
// a raw {coingecko_id, symbol}) so quantities have somewhere to land. New
// rows join at target 0% — composition is the human's call.
function ensureAsset(profileId, like) {
  const found = db
    .prepare('SELECT * FROM assets WHERE profile_id = ? AND coingecko_id = ?')
    .get(profileId, like.coingecko_id);
  if (found) return found;
  const info = db
    .prepare(
      'INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index) VALUES (?, ?, ?, 0, 0, 0)'
    )
    .run(profileId, like.coingecko_id, like.symbol);
  return db.prepare('SELECT * FROM assets WHERE id = ?').get(info.lastInsertRowid);
}

// ---- transaction log --------------------------------------------------------
function logTxn({ accountId, profileId = null, kind, ref = null, deltas = null, note, ts = Date.now() }) {
  const info = db
    .prepare('INSERT INTO txn_log (account_id, profile_id, ts, kind, ref, deltas, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(accountId, profileId, ts, kind, ref, deltas ? JSON.stringify(deltas) : null, note);
  return info.lastInsertRowid;
}

function listTxnLog(accountId, limit = 50) {
  return db
    .prepare('SELECT * FROM txn_log WHERE account_id = ? ORDER BY ts DESC, id DESC LIMIT ?')
    .all(accountId, limit)
    .map((r) => ({ ...r, deltas: r.deltas ? JSON.parse(r.deltas) : null }));
}

// ---- attribution ------------------------------------------------------------
// Decide which linked profile owns a synced fill. `holders` = linked
// profiles (with their asset row) that hold the trade's BASE code. Returns
// {profileId, tier} or {queue: reason, suggestedProfileId}.
function attributeTrade({ trade, holders, shell, now = Date.now() }) {
  if (holders.length === 1) return { profileId: holders[0].profile.id, tier: 't1' };
  if (holders.length === 0) {
    // Nobody holds it: the shell (if any) is the natural owner of trades on
    // unallocated assets; otherwise it queues for a human.
    if (shell) return { profileId: shell.id, tier: 't1' };
    return { queue: 'no linked profile holds this asset', suggestedProfileId: null };
  }
  // T2: match a profile's own recent advice — symbol+side, size ±15%, 36h.
  const baseQty = Math.abs(trade.baseDelta);
  const side = String(trade.side || '').toUpperCase();
  const adviceOf = new Map();
  for (const h of holders) {
    adviceOf.set(
      h.profile.id,
      db
        .prepare('SELECT * FROM advice_log WHERE profile_id = ? AND symbol = ? AND side = ? AND ts >= ? AND ts <= ?')
        .all(h.profile.id, trade.baseCode, side, trade.ts - T2_WINDOW_MS, trade.ts)
    );
  }
  const fits = (qtyAbs, rows) =>
    (rows || []).some((r) => qtyAbs >= r.quantity * (1 - T2_SIZE_TOL) && qtyAbs <= r.quantity * (1 + T2_SIZE_TOL));
  const matches = holders.filter((h) => fits(baseQty, adviceOf.get(h.profile.id)));
  if (matches.length === 1) return { profileId: matches[0].profile.id, tier: 't2' };

  // T2 AGGREGATE: an advised order often executes in PIECES, and no single
  // piece matches the advised size (observed live 2026-07-21: a ~1740-DOGE
  // advice filled as 379 + 1361 and both pieces queued). Sum this fill with
  // its sibling fills — same account/pair/side within the advice window,
  // still unattributed or already on the candidate profile — and match the
  // SUM against the advice instead.
  if (matches.length === 0 && trade.accountId && trade.pair) {
    const sibRows = db
      .prepare(
        `SELECT ts, deltas, profile_id FROM exchange_trades
         WHERE account_id = ? AND pair = ? AND side = ? AND ts >= ? AND ts <= ? AND venue_trade_id != ?`
      )
      .all(trade.accountId, trade.pair, trade.side, trade.ts - T2_WINDOW_MS, trade.ts, String(trade.id ?? ''));
    const aggMatches = [];
    for (const h of holders) {
      const advice = adviceOf.get(h.profile.id) || [];
      if (advice.length === 0) continue;
      // Pieces of an advised order cannot PREDATE the advice: only fills at
      // or after the earliest matching advice count toward the aggregate —
      // an older unrelated fill on the same pair must not inflate the sum.
      const minAdviceTs = Math.min(...advice.map((r) => r.ts));
      let sum = baseQty;
      for (const r of sibRows) {
        if (r.ts < minAdviceTs) continue;
        if (r.profile_id != null && r.profile_id !== h.profile.id) continue;
        try {
          const d = JSON.parse(r.deltas).find(
            (x) => String(x.code).toLowerCase() === trade.baseCode && (x.delta > 0) === (trade.baseDelta > 0)
          );
          if (d) sum += Math.abs(d.delta);
        } catch {
          /* unreadable sibling deltas — skip that sibling */
        }
      }
      if (sum > baseQty && fits(sum, advice)) aggMatches.push({ h, minAdviceTs });
    }
    if (aggMatches.length === 1) {
      return {
        profileId: aggMatches[0].h.profile.id,
        tier: 't2',
        aggregate: true,
        aggSinceTs: aggMatches[0].minAdviceTs,
      };
    }
  }

  return {
    queue:
      matches.length > 1
        ? `matches recent advice on ${matches.length} profiles — pick one`
        : `${holders.length} profiles hold ${trade.baseCode.toUpperCase()} and none advised this trade`,
    suggestedProfileId: (matches[0] || holders[0]).profile.id,
  };
}

function listInbox(accountId) {
  const queued = db
    .prepare("SELECT * FROM attribution_queue WHERE account_id = ? AND status = 'pending' ORDER BY ts DESC")
    .all(accountId)
    .map((r) => ({ ...r, deltas: JSON.parse(r.deltas) }));
  const flows = db
    .prepare("SELECT * FROM pending_flows WHERE account_id = ? AND status = 'pending' ORDER BY ts DESC")
    .all(accountId);
  return { trades: queued, flows };
}

// Apply a queued fill to the chosen profile. Deltas are venue-code keyed;
// missing asset rows are created at target 0 so nothing is silently lost.
function assignQueuedTrade(queueId, profileId, { kind = 'trade-assign', note = null } = {}) {
  const q = db.prepare("SELECT * FROM attribution_queue WHERE id = ? AND status = 'pending'").get(queueId);
  if (!q) throw new Error('queued item not found (already assigned or dismissed?)');
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (!profile || profile.exchange_account_id !== q.account_id) {
    throw new Error('target profile is not linked to this account');
  }
  const deltas = JSON.parse(q.deltas);
  const applied = [];
  db.transaction(() => {
    for (const d of deltas) {
      const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profileId);
      let asset = matchVenueAssetLocal(assets, d.code);
      if (!asset) {
        const donor = db
          .prepare(
            `SELECT a.* FROM assets a JOIN profiles p ON p.id = a.profile_id
             WHERE p.exchange_account_id = ? AND LOWER(a.symbol) = LOWER(?) LIMIT 1`
          )
          .get(q.account_id, d.code);
        if (!donor) throw new Error(`no linked profile knows the asset "${d.code}" — add it first`);
        asset = ensureAsset(profileId, donor);
      }
      const next = Math.max(0, asset.quantity + d.delta);
      db.prepare('UPDATE assets SET quantity = ? WHERE id = ?').run(next, asset.id);
      applied.push({ asset_id: asset.id, symbol: asset.symbol, delta: d.delta });
    }
    db.prepare('UPDATE exchange_trades SET profile_id = ? WHERE account_id = ? AND venue_trade_id = ?').run(
      profileId, q.account_id, q.venue_ref
    );
    db.prepare("UPDATE attribution_queue SET status = 'assigned', assigned_profile_id = ?, resolved_at = ? WHERE id = ?").run(
      profileId, Date.now(), queueId
    );
    logTxn({
      accountId: q.account_id,
      profileId,
      kind,
      ref: q.venue_ref,
      deltas: applied,
      note:
        note ||
        `${q.side || 'trade'} ${q.pair || ''} assigned to "${profile.name}"` +
          (q.suggested_profile_id === profileId ? ' (as suggested)' : ''),
      ts: Date.now(),
    });
  })();
  return { applied };
}

function dismissQueuedTrade(queueId) {
  const r = db
    .prepare("UPDATE attribution_queue SET status = 'dismissed', resolved_at = ? WHERE id = ? AND status = 'pending'")
    .run(Date.now(), queueId);
  if (r.changes === 0) throw new Error('queued item not found (already assigned or dismissed?)');
}

// Local copy of sync's venue-asset matcher (kept here to avoid a require
// cycle; same semantics: symbol match, case-insensitive).
function matchVenueAssetLocal(assets, code) {
  const c = String(code || '').toLowerCase();
  return assets.find((a) => String(a.symbol).toLowerCase() === c) || null;
}

// ---- rewind / reassign ------------------------------------------------------
// Every txn_log row is rewindable exactly once. A rewind APPENDS a
// compensating entry — history is never edited — and returns queued items
// to the inbox. Quantity-only kinds reverse in place (clamped at zero with
// a loud warning); flow kinds reverse through recordFlow so the indices
// splice back. If the rewind crosses a chained daily snapshot the affected
// profile gets a visible annotation instead of a falsified history.
async function rewindTxn(txnId) {
  const row = db.prepare('SELECT * FROM txn_log WHERE id = ?').get(txnId);
  if (!row) throw new Error('log entry not found');
  if (row.kind === 'rewind') throw new Error('a rewind entry cannot itself be rewound');
  if (row.rewound_by) throw new Error('already rewound');
  const deltas = row.deltas ? JSON.parse(row.deltas) : [];
  const warnings = [];

  const reverseQuantities = (profileId, ds) => {
    for (const d of ds) {
      const a = db.prepare('SELECT * FROM assets WHERE id = ?').get(d.asset_id);
      if (!a) {
        warnings.push(`asset ${d.symbol} no longer exists — its ${d.delta} could not be reversed`);
        continue;
      }
      let next = a.quantity - d.delta;
      if (next < 0) {
        warnings.push(`${d.symbol.toUpperCase()} clamped at 0 (later activity consumed ${(-next).toFixed(8)})`);
        next = 0;
      }
      db.prepare('UPDATE assets SET quantity = ? WHERE id = ?').run(next, a.id);
    }
  };

  if (row.kind === 'carve-out') {
    // Carve-outs are recorded as a PAIR sharing a ref; rewinding either side
    // reverses both through recordFlow (splice-continuous both ways).
    const pair = db
      .prepare("SELECT * FROM txn_log WHERE account_id = ? AND ref = ? AND kind = 'carve-out' AND rewound_by IS NULL")
      .all(row.account_id, row.ref);
    for (const side of pair) {
      const ds = JSON.parse(side.deltas);
      await recordFlow(
        side.profile_id,
        ds.map((d) => ({ asset_id: d.asset_id, delta: -d.delta })),
        `rewind of carve-out (${row.ref})`
      );
    }
    db.transaction(() => {
      for (const side of pair) {
        const compId = logTxn({
          accountId: row.account_id, profileId: side.profile_id, kind: 'rewind', ref: row.ref,
          deltas: JSON.parse(side.deltas).map((d) => ({ ...d, delta: -d.delta })),
          note: `rewound carve-out leg on "${profileName(side.profile_id)}"`,
        });
        db.prepare('UPDATE txn_log SET rewound_by = ? WHERE id = ?').run(compId, side.id);
        db.prepare('UPDATE txn_log SET rewound_of = ? WHERE id = ?').run(side.id, compId);
      }
    })();
    return { warnings };
  }

  if (row.kind === 'flow-apply' || row.kind === 'adopt') {
    // Flows spliced on apply, so the reversal must splice back too.
    await recordFlow(
      row.profile_id,
      deltas.map((d) => ({ asset_id: d.asset_id, delta: -d.delta })),
      `rewind of ${row.kind} (${row.ref || 'manual'})`
    );
    db.transaction(() => {
      if (row.ref) {
        db.prepare("UPDATE pending_flows SET status = 'pending' WHERE account_id = ? AND venue_ref = ? AND status = 'applied'").run(
          row.account_id, row.ref
        );
      }
      finishRewind(row, deltas, warnings);
    })();
    return { warnings };
  }

  // Trade attributions and snaps: quantity-only reversal.
  db.transaction(() => {
    reverseQuantities(row.profile_id, deltas);
    if (row.kind.startsWith('trade-')) {
      db.prepare('UPDATE exchange_trades SET profile_id = NULL WHERE account_id = ? AND venue_trade_id = ?').run(
        row.account_id, row.ref
      );
      const existing = db
        .prepare('SELECT id FROM attribution_queue WHERE account_id = ? AND kind = ? AND venue_ref = ?')
        .get(row.account_id, 'trade', row.ref);
      if (existing) {
        db.prepare("UPDATE attribution_queue SET status = 'pending', assigned_profile_id = NULL, resolved_at = NULL WHERE id = ?").run(existing.id);
      } else {
        // Auto-attributed fills never had a queue row — give them one so the
        // rewound fill is visibly waiting instead of vanishing.
        const t = db.prepare('SELECT * FROM exchange_trades WHERE account_id = ? AND venue_trade_id = ?').get(row.account_id, row.ref);
        db.prepare(
          `INSERT OR IGNORE INTO attribution_queue (account_id, kind, venue_ref, ts, pair, side, price, deltas, suggested_profile_id, reason)
           VALUES (?, 'trade', ?, ?, ?, ?, ?, ?, ?, 'rewound by user — reassign')`
        ).run(
          row.account_id, row.ref, t ? t.ts : row.ts, t ? t.pair : null, t ? t.side : null, t ? t.price : null,
          t ? JSON.stringify(JSON.parse(t.deltas)) : JSON.stringify(deltas.map((d) => ({ code: d.symbol, delta: d.delta }))),
          row.profile_id
        );
      }
    }
    finishRewind(row, deltas, warnings);
  })();
  return { warnings };
}

function profileName(id) {
  const p = db.prepare('SELECT name FROM profiles WHERE id = ?').get(id);
  return p ? p.name : `profile ${id}`;
}

function finishRewind(row, deltas, warnings) {
  const compId = logTxn({
    accountId: row.account_id,
    profileId: row.profile_id,
    kind: 'rewind',
    ref: row.ref,
    deltas: deltas.map((d) => ({ ...d, delta: -d.delta })),
    note: `rewound: ${row.note}` + (warnings.length ? ` ⚠ ${warnings.join('; ')}` : ''),
  });
  db.prepare('UPDATE txn_log SET rewound_by = ? WHERE id = ?').run(compId, row.id);
  db.prepare('UPDATE txn_log SET rewound_of = ? WHERE id = ?').run(row.id, compId);
  // Index honesty: if this profile's daily index already chained past the
  // original transaction, the correction cannot rewrite that history — say
  // so where the user will see it (the profile's on-screen alert log).
  if (row.profile_id) {
    const chained = db
      .prepare('SELECT COUNT(*) AS n FROM profile_snapshots WHERE profile_id = ? AND ts > ?')
      .get(row.profile_id, row.ts);
    if (chained && chained.n > 0) {
      db.prepare('INSERT INTO alert_log (profile_id, message, ts, emailed) VALUES (?, ?, ?, 0)').run(
        row.profile_id,
        `Transaction rewound (${row.kind}, originally ${new Date(row.ts).toISOString().slice(0, 16)}): the value index between then and now carries the original entry's distortion — history is annotated, not rewritten.`,
        Date.now()
      );
    }
  }
}

// Rewind + assign to the right profile in one step (attribution rows only).
async function reassignTxn(txnId, profileId) {
  const row = db.prepare('SELECT * FROM txn_log WHERE id = ?').get(txnId);
  if (!row) throw new Error('log entry not found');
  if (!row.kind.startsWith('trade-')) throw new Error('only trade attributions can be reassigned — use rewind');
  const { warnings } = await rewindTxn(txnId);
  const q = db
    .prepare("SELECT id FROM attribution_queue WHERE account_id = ? AND kind = 'trade' AND venue_ref = ? AND status = 'pending'")
    .get(row.account_id, row.ref);
  if (!q) throw new Error('rewound fill did not reach the inbox — assign manually');
  const { applied } = assignQueuedTrade(q.id, profileId, { note: `reassigned to "${profileName(profileId)}"` });
  return { warnings, applied };
}

// ---- account summary --------------------------------------------------------
// Combined view across every linked profile: each asset's TOTAL balance and
// the account's total value, denominated in the VIEWING profile's index
// tether (each profile may denominate differently — the header follows
// whichever profile is on screen). usdPrices injected for testability; a
// missing price leaves that asset's value null and marks the total ≈partial.
function accountSummary(accountId, viewProfileId, usdPrices) {
  const profiles = linkedProfiles(accountId);
  if (profiles.length === 0) return null;
  const view = profiles.find((p) => p.id === Number(viewProfileId)) || profiles[0];
  let viewAssets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(view.id);
  // The shell has no tether of its own — denominate in the account CREATOR
  // profile's tether (falling back to any linked profile that has one).
  if (!viewAssets.some((a) => a.is_index)) {
    const owner = db
      .prepare('SELECT profile_id FROM exchange_accounts WHERE id = ?')
      .get(accountId);
    const candidates = [owner && owner.profile_id, ...profiles.map((p) => p.id)].filter(Boolean);
    for (const pid of candidates) {
      const rows = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(pid);
      if (rows.some((a) => a.is_index)) {
        viewAssets = rows;
        break;
      }
    }
  }
  const indexUsd = indexUsdFor(viewAssets, usdPrices);
  const symbol = indexLabel(viewAssets);

  // Total quantity per coingecko id across all linked profiles.
  const totals = new Map(); // id -> {symbol, qty, sample}
  for (const p of profiles) {
    for (const a of db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(p.id)) {
      const t = totals.get(a.coingecko_id) || { symbol: a.symbol, qty: 0, sample: a };
      t.qty += a.quantity;
      totals.set(a.coingecko_id, t);
    }
  }

  let totalValue = 0;
  let complete = indexUsd != null;
  const assets = [];
  for (const t of totals.values()) {
    if (t.qty <= 0) continue;
    let value = null;
    if (indexUsd != null) {
      const pr = priceAsset(t.sample, indexUsd, usdPrices);
      if (pr && Number.isFinite(pr.rel)) value = t.qty * pr.rel;
      else complete = false;
    }
    if (value != null) totalValue += value;
    assets.push({ symbol: t.symbol, qty: t.qty, value });
  }
  assets.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  // Per-profile split for the account-status header.
  const perProfile = [];
  for (const p of profiles) {
    let value = 0;
    let ok = indexUsd != null;
    for (const a of db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(p.id)) {
      if (a.quantity <= 0) continue;
      const pr = indexUsd != null ? priceAsset(a, indexUsd, usdPrices) : null;
      if (pr && Number.isFinite(pr.rel)) value += a.quantity * pr.rel;
      else ok = false;
    }
    perProfile.push({ id: p.id, name: p.name, isShell: Boolean(p.is_shell), value: ok || value > 0 ? value : null });
  }
  return { indexSymbol: symbol, totalValue: complete || totalValue > 0 ? totalValue : null, complete, assets, perProfile };
}

// ---- carve-out --------------------------------------------------------------
// A virtual transfer between two linked profiles: paired recordFlow calls at
// live prices, splice-continuous on both sides, no venue I/O. If the second
// leg fails the first is compensated, so it can never half-apply.
async function carveOut(accountId, fromProfileId, toProfileId, items) {
  const profiles = linkedProfiles(accountId);
  const from = profiles.find((p) => p.id === Number(fromProfileId));
  const to = profiles.find((p) => p.id === Number(toProfileId));
  if (!from || !to) throw new Error('both profiles must be linked to this account');
  if (from.id === to.id) throw new Error('source and target are the same profile');
  if (!Array.isArray(items) || items.length === 0) throw new Error('nothing to transfer');

  const fromAssets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(from.id);
  const legFrom = [];
  const legTo = [];
  for (const it of items) {
    const src = fromAssets.find((a) => a.id === Number(it.asset_id));
    const qty = Number(it.qty);
    if (!src) throw new Error(`asset ${it.asset_id} is not in "${from.name}"`);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`bad quantity for ${src.symbol}`);
    if (qty > src.quantity + 1e-12) throw new Error(`${src.symbol.toUpperCase()}: only ${src.quantity} available`);
    const dst = ensureAsset(to.id, src);
    legFrom.push({ asset_id: src.id, symbol: src.symbol, delta: -qty });
    legTo.push({ asset_id: dst.id, symbol: dst.symbol, delta: qty });
  }

  const ref = `carve-${Date.now().toString(36)}`;
  await recordFlow(from.id, legFrom.map((d) => ({ asset_id: d.asset_id, delta: d.delta })), `carve-out to "${to.name}" (${ref})`);
  try {
    await recordFlow(to.id, legTo.map((d) => ({ asset_id: d.asset_id, delta: d.delta })), `carve-in from "${from.name}" (${ref})`);
  } catch (err) {
    // Compensate the first leg so the transfer never half-applies.
    await recordFlow(from.id, legFrom.map((d) => ({ asset_id: d.asset_id, delta: -d.delta })), `carve-out FAILED, compensated (${ref})`);
    throw err;
  }
  const human = items.length === 1 ? `${legTo[0].delta} ${legTo[0].symbol.toUpperCase()}` : `${items.length} assets`;
  logTxn({ accountId, profileId: from.id, kind: 'carve-out', ref, deltas: legFrom, note: `carved ${human} out of "${from.name}" → "${to.name}"` });
  logTxn({ accountId, profileId: to.id, kind: 'carve-out', ref, deltas: legTo, note: `received ${human} from "${from.name}"` });
  return { ref, legFrom, legTo };
}

// Bare quantity edits don't mix with the group model: inside an account
// group every quantity change has a proper owner — sync/attribution for
// trades, carve-outs for transfers, the master's deposit rows for external
// flows, rewind for corrections — and a bare number edit can't say which it
// is, silently breaks the reconcile invariant (physical = Σ virtual), and
// reads as fake performance in the indices. Returns the human reason the
// edit is refused, or null where quantities are manually owned (unlinked
// profiles, and 1:1 links where sync reconciles to venue truth anyway).
function quantityEditBlocked(profileId) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (!profile || !profile.exchange_account_id) return null;
  const shell = shellOf(profile.exchange_account_id);
  if (!shell) return null; // 1:1 link — manual edits keep old-app parity
  if (profile.is_shell) {
    return "the pool's balances come from account sync, deposits, and carve-outs — use those controls";
  }
  return "this sub-account's balances come from account sync, carve-outs from the master, and the attribution inbox — use those (or rewind a bad transaction)";
}

// Deleting an asset row DESTROYS its recorded quantity — and inside an
// account group that quantity is real money on the venue (observed live
// 2026-07-21: 15,000 MXN vanished when a trial sub-account's MXN row was
// deleted; nothing returned it to the pool and nothing logged it). So:
// a grouped sub-account returns any remaining balance to the SHELL first,
// as a normal carve — recorded in flows (value-index splice intact) and the
// txn log (rewindable) — and only then drops the row. A funded SHELL asset
// refuses deletion outright: the pool row IS the group's money. Unlinked
// profiles and dust balances keep the old plain delete.
const REMOVE_DUST = 1e-9;
async function removeAsset(assetId) {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
  if (!asset) return { ok: true, existed: false };
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(asset.profile_id);
  const qty = Number(asset.quantity) || 0;
  let returned = null;
  if (profile && profile.exchange_account_id && qty > REMOVE_DUST) {
    const shell = shellOf(profile.exchange_account_id);
    if (profile.is_shell) {
      throw new Error(
        `${asset.symbol.toUpperCase()} still holds ${qty} in the unallocated pool — ` +
          'carve it to a sub-account (or withdraw it on the venue and sync) before deleting; ' +
          "deleting the pool row would erase the group's money"
      );
    }
    if (shell && shell.id !== profile.id) {
      await carveOut(profile.exchange_account_id, profile.id, shell.id, [{ asset_id: asset.id, qty }]);
      returned = { qty, symbol: asset.symbol, toProfileId: shell.id, toName: shell.name };
    }
  }

  // Removing the ROW is itself a structural change the indices must splice
  // across — observed live 2026-07-21: deleting a zero-balance but
  // 20%-TARGETED row dropped its weight term from the basket sum (1.0 → 0.8)
  // and the next targets-set folded the corrupted level into the base.
  // Re-read profile/assets: the carve above may have just updated both.
  const prof = profile ? db.prepare('SELECT * FROM profiles WHERE id = ?').get(asset.profile_id) : null;
  const assetsNow = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(asset.profile_id);
  const live = assetsNow.find((a) => a.id === asset.id);
  const liveQty = live ? Number(live.quantity) || 0 : 0;

  // BASKET: level with the row present (unit math, no prices needed); after
  // the delete the base is rescaled so the displayed level is unchanged.
  const basketBefore = prof && live ? computeBasket(assetsNow, prof.basket_base) : null;

  // VALUE: only a still-FUNDED row changes the total (grouped deletes were
  // just carved to zero above). Treat it like a withdrawal: fold the level,
  // re-anchor the snap without the removed value. If pricing is down we
  // REFUSE rather than delete-and-corrupt.
  let valueSplice = null;
  if (prof && live && liveQty > REMOVE_DUST && prof.value_snap_rel > 0) {
    const usdPrices = await fetchUsdPrices(assetsNow.map((a) => a.coingecko_id));
    const indexUsd = indexUsdFor(assetsNow, usdPrices);
    let relTotal = 0;
    let relRemoved = 0;
    for (const a of assetsNow) {
      const p = priceAsset(a, indexUsd, usdPrices);
      if (!p) {
        if ((Number(a.quantity) || 0) > 0) {
          throw new Error(
            `cannot price ${a.symbol.toUpperCase()} right now — deleting ${asset.symbol.toUpperCase()} needs a valued splice; retry when pricing is back`
          );
        }
        continue;
      }
      relTotal += a.quantity * p.rel;
      if (a.id === asset.id) relRemoved = a.quantity * p.rel;
    }
    valueSplice = { valueBefore: computeValueIndex(prof, relTotal), relAfter: relTotal - relRemoved };
  }

  db.transaction(() => {
    db.prepare('DELETE FROM assets WHERE id = ?').run(asset.id);
    if (basketBefore != null) {
      const remaining = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(asset.profile_id);
      const innerAfter = computeBasket(remaining, 1);
      // No targeted rows left → the basket track goes dormant (reads null);
      // nothing to rescale. Otherwise preserve the displayed level exactly.
      if (innerAfter > 0) {
        db.prepare('UPDATE profiles SET basket_base = ? WHERE id = ?').run(basketBefore / innerAfter, asset.profile_id);
      }
    }
    if (valueSplice) {
      if (valueSplice.relAfter > 0 && valueSplice.valueBefore > 0) {
        db.prepare('UPDATE profiles SET value_base = ?, value_snap_rel = ? WHERE id = ?').run(
          valueSplice.valueBefore, valueSplice.relAfter, asset.profile_id
        );
      } else {
        // Nothing valued remains — pause the track; the next flow re-anchors.
        db.prepare('UPDATE profiles SET value_snap_rel = NULL WHERE id = ?').run(asset.profile_id);
      }
    }
  })();
  return { ok: true, existed: true, returned };
}

module.exports = {
  linkedProfiles,
  accountSummary,
  removeAsset,
  quantityEditBlocked,
  shellOf,
  linkProfile,
  unlinkProfile,
  ensureShell,
  ensureAsset,
  logTxn,
  listTxnLog,
  attributeTrade,
  listInbox,
  assignQueuedTrade,
  dismissQueuedTrade,
  rewindTxn,
  reassignTxn,
  carveOut,
  T2_SIZE_TOL,
  T2_WINDOW_MS,
};
