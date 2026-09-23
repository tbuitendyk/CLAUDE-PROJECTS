// Phase 6 virtual sub-accounts: several profiles carve up one physical
// exchange account. Battery per the PLAN.md gate: migration no-op for 1:1;
// T1/T2/T3 attribution (unique holder / advice ±15% within 36h / inbox);
// tether-follows-trade; the account-wide reconcile invariant with the shell
// absorbing dust; single-holder-only baseline adoption; queued fills
// applying on assign; universal rewind (compensating entries, re-queue,
// clamp warning, cross-snapshot annotation) + one-step reassign; carve-out
// virtual transfers with index continuity and pair rewind.
process.env.EXCHANGE_MARKET_DATA = 'off';
const { freshDb, ok, approx } = require('./helpers');
freshDb('subaccounts');

const pricing = require('../lib/pricing');
let PRICES = { 'usd-coin': 1, bitcoin: 50_000, ripple: 2.5, 'pax-gold': 3000, solana: 150 };
pricing.fetchUsdPrices = async () => PRICES;

const db = require('../lib/db');
const bal = require('../lib/balancer');
const sync = require('../lib/sync');
const sub = require('../lib/subaccounts');

const qtyOf = (pid, sym) =>
  (db.prepare('SELECT quantity FROM assets WHERE profile_id = ? AND symbol = ?').get(pid, sym) || {}).quantity;
const valueIndexNow = (pid) => {
  const p = db.prepare('SELECT * FROM profiles WHERE id = ?').get(pid);
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(pid);
  const iu = bal.indexUsdFor(assets, PRICES);
  const totalRel = assets.reduce((s, a) => {
    const pr = bal.priceAsset(a, iu, PRICES);
    return s + (pr ? a.quantity * pr.rel : 0);
  }, 0);
  return bal.computeValueIndex(p, totalRel);
};

const VENUE = { balances: [], trades: [], flows: [] };
const client = {
  venue: 'test',
  fetchBalances: async () => VENUE.balances,
  fetchTradesSince: async (since) => VENUE.trades.filter((t) => t.ts > since),
  fetchFlowsSince: async (since) => VENUE.flows.filter((f) => f.ts > since),
};

(async () => {
  const now = Date.now();

  // P1 "Main": usdc(tether) + btc + xrp. P2 "Trial": usdc(tether) + paxg + xrp + sol(0).
  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('Main', 10, 15, 0)").run();
  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('Trial', 10, 15, 0)").run();
  const add = db.prepare(
    'INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  add.run(1, 'usd-coin', 'usdc', 10_000, 40, 1, 10_000);
  add.run(1, 'bitcoin', 'btc', 0.2, 40, 0, 0.2);
  add.run(1, 'ripple', 'xrp', 1_000, 20, 0, 1_000);
  add.run(2, 'usd-coin', 'usdc', 2_000, 50, 1, 2_000);
  add.run(2, 'pax-gold', 'paxg', 1.0, 30, 0, 1.0);
  add.run(2, 'ripple', 'xrp', 400, 20, 0, 400);
  add.run(2, 'solana', 'sol', 0, 0, 0, 0);
  await bal.pollProfiles({ force: true }); // anchor both value indices at 1.0

  // ---- migration no-op: 1:1 account stays on the single-profile path --------
  const account = sync.createAccount(1, 'kraken', 'k', 's');
  VENUE.balances = [
    { code: 'usdc', amount: 10_000 },
    { code: 'btc', amount: 0.2 },
    { code: 'xrp', amount: 1_000 },
  ];
  let s = await sync.syncAccount(account.id, { client });
  ok(!s.multi, 'unlinked second profile → the ORIGINAL single-profile sync path runs');
  ok(sync.getAccountForProfile(1).id === account.id, 'owner still resolves its account (legacy column fallback)');
  // Poll semantics, 1:1 era: the profile IS the account view → sync first.
  ok(sync.syncScopeForPoll(1) === account.id, '1:1-linked profile: poll syncs the account first');
  ok(sync.syncScopeForPoll(2) === null, 'unlinked profile: pure price poll');
  ok(sub.quantityEditBlocked(1) === null, '1:1 era: quantities stay hand-editable (old-app parity)');
  ok(sub.quantityEditBlocked(2) === null, 'unlinked profile: quantities hand-editable');

  // ---- linking + shell ------------------------------------------------------
  sub.linkProfile(1, account.id);
  sub.linkProfile(2, account.id);
  const shell = sub.ensureShell(account.id);
  ok(shell.is_shell === 1 && /Unallocated/.test(shell.name), `shell created ("${shell.name}")`);
  ok(shell.enabled === 1 && shell.alerts_enabled === 0, 'shell polls for valuation but can never alert');
  ok(sub.ensureShell(account.id).id === shell.id, 'ensureShell is idempotent');
  ok(sub.linkedProfiles(account.id).length === 3, 'three linked profiles (Main, Trial, shell)');
  ok(sync.getAccountForProfile(2).id === account.id, 'linked non-owner resolves the shared account');
  let threw = false;
  try { sub.unlinkProfile(shell.id); } catch { threw = true; }
  ok(threw, 'the shell cannot be unlinked');

  // Poll semantics, grouped era: only the MASTER reads the venue on poll;
  // grouped subs reprice their recorded balances (sync lives on the master).
  ok(sync.syncScopeForPoll(shell.id) === account.id, 'master (shell): poll syncs the account first');
  ok(sync.syncScopeForPoll(1) === null && sync.syncScopeForPoll(2) === null, 'grouped subs: pure price poll');
  ok(sync.syncScopeForPoll(999) === null, 'unknown profile: pure price poll (no crash)');
  // Group-owned books: bare quantity edits refused everywhere in the group.
  ok(/carve-outs/.test(sub.quantityEditBlocked(shell.id) || ''), 'shell: bare quantity edits refused (pool is group money)');
  ok(/rewind/.test(sub.quantityEditBlocked(1) || '') && /rewind/.test(sub.quantityEditBlocked(2) || ''), 'grouped subs: bare quantity edits refused');
  ok(sub.quantityEditBlocked(999) === null, 'unknown profile: no crash, no block');

  // ---- multi sync: T1 unique holder + tether-follows-trade ------------------
  const t1 = now + 1000;
  VENUE.trades = [
    { id: 'tr-1', ts: t1, pair: 'btc_usdc', side: 'buy', price: 50_000, deltas: [
      { code: 'btc', delta: 0.1 }, { code: 'usdc', delta: -5_000 }] },
  ];
  VENUE.balances = [
    { code: 'usdc', amount: 10_000 + 2_000 - 5_000 },
    { code: 'btc', amount: 0.3 },
    { code: 'xrp', amount: 1_400 },
    { code: 'paxg', amount: 1.0 },
  ];
  s = await sync.syncAccount(account.id, { client });
  ok(s.multi === true && s.linkedProfiles === 3, 'multi path engaged');
  ok(s.attribution.t1 === 1 && s.tradesApplied === 1, 'unique-holder fill auto-attributed (T1)');
  ok(approx(qtyOf(1, 'btc'), 0.3, 1e-9), 'Main btc credited');
  ok(approx(qtyOf(1, 'usdc'), 5_000, 1e-9), 'the tether leg followed the trade into Main');
  ok(approx(qtyOf(2, 'usdc'), 2_000, 1e-9), 'Trial usdc untouched');
  ok(s.unexplained.length === 0, 'reconcile invariant holds across profiles');
  const t1Log = sub.listTxnLog(account.id).find((r) => r.ref === 'tr-1');
  ok(t1Log && t1Log.kind === 'trade-auto-t1' && t1Log.profile_id === 1, 'T1 landed in the transaction log');

  // ---- T2 advice match (±15%, 36h) ------------------------------------------
  db.prepare('INSERT INTO advice_log (profile_id, ts, symbol, side, quantity) VALUES (2, ?, ?, ?, ?)').run(
    t1 + 500, 'xrp', 'SELL', 100
  );
  const t2 = t1 + 2000;
  VENUE.trades.push({ id: 'tr-2', ts: t2, pair: 'xrp_usdc', side: 'sell', price: 2.5, deltas: [
    { code: 'xrp', delta: -110 }, { code: 'usdc', delta: 275 }] }); // 110 = within ±15% of 100
  VENUE.balances = [
    { code: 'usdc', amount: 7_000 + 275 },
    { code: 'btc', amount: 0.3 },
    { code: 'xrp', amount: 1_290 },
    { code: 'paxg', amount: 1.0 },
  ];
  s = await sync.syncAccount(account.id, { client });
  ok(s.attribution.t2 === 1, 'advice-matched fill auto-attributed (T2)');
  ok(approx(qtyOf(2, 'xrp'), 290, 1e-9) && approx(qtyOf(2, 'usdc'), 2_275, 1e-9), 'Trial xrp sold, its usdc credited');
  ok(approx(qtyOf(1, 'xrp'), 1_000, 1e-9), 'Main xrp untouched by the shared-asset fill');

  // ---- T3 ambiguous → inbox, applies NOTHING --------------------------------
  const t3 = t2 + 2000;
  VENUE.trades.push({ id: 'tr-3', ts: t3, pair: 'xrp_usdc', side: 'sell', price: 2.5, deltas: [
    { code: 'xrp', delta: -30 }, { code: 'usdc', delta: 75 }] }); // no advice matches 30
  VENUE.balances = [
    { code: 'usdc', amount: 7_275 + 75 },
    { code: 'btc', amount: 0.3 },
    { code: 'xrp', amount: 1_260 },
    { code: 'paxg', amount: 1.0 },
  ];
  s = await sync.syncAccount(account.id, { client });
  ok(s.attribution.queued === 1 && s.tradesQueued === 1, 'ambiguous shared-asset fill queued (T3)');
  ok(approx(qtyOf(1, 'xrp'), 1_000, 1e-9) && approx(qtyOf(2, 'xrp'), 290, 1e-9), 'queued fill applied NOTHING');
  ok(s.unexplained.length === 0, 'invariant still holds — queued deltas count as expected');
  const inbox = sub.listInbox(account.id);
  ok(inbox.trades.length === 1 && /hold xrp/i.test(inbox.trades[0].reason.replace('XRP', 'xrp')), 'inbox explains why it queued');
  const tradeRow = db.prepare("SELECT profile_id FROM exchange_trades WHERE venue_trade_id = 'tr-3'").get();
  ok(tradeRow.profile_id === null, 'queued fill has no owner yet');

  // ---- assign from the inbox ------------------------------------------------
  sub.assignQueuedTrade(inbox.trades[0].id, 1);
  ok(approx(qtyOf(1, 'xrp'), 970, 1e-9) && approx(qtyOf(1, 'usdc'), 5_075, 1e-9), 'assignment applied both legs to Main');
  ok(db.prepare("SELECT profile_id FROM exchange_trades WHERE venue_trade_id = 'tr-3'").get().profile_id === 1, 'fill now owned');
  const assignLog = sub.listTxnLog(account.id).find((r) => r.ref === 'tr-3' && r.kind === 'trade-assign');
  ok(Boolean(assignLog), 'assignment logged');

  // ---- universal true-up: dust lands on the HOLDER as performance -----------
  const dust = 0.00002; // 0.007% of 0.3 btc — within the cap, below visibility
  VENUE.trades = [];
  VENUE.balances = [
    { code: 'usdc', amount: 7_350 },
    { code: 'btc', amount: 0.3 + dust },
    { code: 'xrp', amount: 1_260 },
    { code: 'paxg', amount: 1.0 },
  ];
  s = await sync.syncAccount(account.id, { client });
  ok(s.snapped.length === 1, 'dust within cap trued up');
  ok(approx(qtyOf(1, 'btc'), 0.3 + dust, 1e-12), 'the HOLDER absorbed the dust as P&L (sole positive holder)');
  ok(qtyOf(shell.id, 'btc') === undefined, 'the shell never grew a btc row for it');

  // ---- float-noise residuals never true up, never log -----------------------
  // Observed live: a 1.4e-14 stored-quantity tail produced an identical
  // txn_log entry every hourly sync, forever.
  const sweepRows = () => db.prepare("SELECT COUNT(*) c FROM txn_log WHERE account_id = ? AND kind IN ('snap','sweep')").get(account.id).c;
  const noiseBase = sweepRows();
  const btcPhys = 0.3 + dust;
  VENUE.balances = VENUE.balances.map((b2) => (b2.code === 'btc' ? { code: 'btc', amount: btcPhys - 1.4e-14 } : b2));
  s = await sync.syncAccount(account.id, { client });
  ok(s.snapped.length === 0 && s.unexplained.length === 0, 'sub-noise residual neither trues up nor surfaces');
  s = await sync.syncAccount(account.id, { client });
  ok(sweepRows() === noiseBase, 'repeated syncs over a noise residual write NO txn_log entries');
  ok(approx(qtyOf(1, 'btc'), 0.3 + dust, 1e-12), 'noise residual left quantities untouched');

  // ---- pro-rata true-up across several holders, logged when visible ---------
  VENUE.balances = VENUE.balances.map((b2) => (b2.code === 'xrp' ? { code: 'xrp', amount: 1_258 } : b2)); // −2 of 1260 = 0.16%: within cap, above 0.05% visibility
  s = await sync.syncAccount(account.id, { client });
  ok(s.unexplained.length === 0 && s.snapped.length === 2, 'within-cap drift trues up instead of surfacing');
  ok(approx(qtyOf(1, 'xrp'), 970 - 2 * (970 / 1260), 1e-9), 'holder 1 debited pro-rata');
  ok(approx(qtyOf(2, 'xrp'), 290 - 2 * (290 / 1260), 1e-9), 'holder 2 debited pro-rata');
  ok(approx(qtyOf(1, 'xrp') + qtyOf(2, 'xrp'), 1_258, 1e-9), 'books equal the venue after the true-up');
  ok(sweepRows() === noiseBase + 2, 'visible true-up leaves a txn_log trail per touched profile');
  ok(
    db.prepare("SELECT COUNT(*) c FROM flows WHERE note LIKE '%true-up%'").get().c === 0,
    'true-up is P&L — no flow splice recorded'
  );
  // sweep back up to the venue (also logged), then micro-dust stays silent
  VENUE.balances = VENUE.balances.map((b2) => (b2.code === 'xrp' ? { code: 'xrp', amount: 1_260 } : b2));
  s = await sync.syncAccount(account.id, { client });
  ok(approx(qtyOf(1, 'xrp'), 970, 1e-6) && approx(qtyOf(2, 'xrp'), 290, 1e-6), 'true-up back to the venue restores holdings');
  const visBase = sweepRows();
  VENUE.balances = VENUE.balances.map((b2) => (b2.code === 'xrp' ? { code: 'xrp', amount: 1_260 - 1e-4 } : b2));
  s = await sync.syncAccount(account.id, { client });
  ok(s.snapped.length === 2 && sweepRows() === visBase, 'micro-dust below 0.05% trues up silently (no log)');
  VENUE.balances = VENUE.balances.map((b2) =>
    b2.code === 'btc' ? { code: 'btc', amount: btcPhys } : b2.code === 'xrp' ? { code: 'xrp', amount: 1_260 } : b2
  );
  s = await sync.syncAccount(account.id, { client });

  // ---- true-up refuses when pending money dominates the balance -------------
  // Cap is 0.5% of the BALANCE and 0.5% of the HOLDINGS: a residual small vs
  // a deposit-inflated balance but big vs what profiles actually hold must
  // surface, not be booked as P&L on tiny positions.
  VENUE.flows.push({ id: 'fl-h', ts: now + 60_000, kind: 'deposit', code: 'paxg', amount: 9, raw: {} });
  VENUE.balances = VENUE.balances.map((b2) => (b2.code === 'paxg' ? { code: 'paxg', amount: 10.02 } : b2));
  s = await sync.syncAccount(account.id, { client });
  ok(s.newPendingFlows === 1, 'the deposit was detected as a pending flow');
  ok(s.unexplained.length === 1 && s.unexplained[0].code === 'paxg' && typeof s.unexplained[0].symbol === 'string',
    'residual within balance-cap but beyond holdings-cap surfaces as unexplained');
  ok(approx(qtyOf(2, 'paxg'), 1.0, 1e-12), 'tiny position NOT inflated by pending-dominated drift');
  db.prepare("UPDATE pending_flows SET status = 'dismissed' WHERE code = 'paxg'").run();
  VENUE.flows = VENUE.flows.filter((f) => f.id !== 'fl-h');
  VENUE.balances = VENUE.balances.map((b2) => (b2.code === 'paxg' ? { code: 'paxg', amount: 1.0 } : b2));

  // ---- true-up refuses while an endpoint is degraded ------------------------
  // Blind of trades/flows, a real fill or deposit would be booked as fake
  // P&L — so drift waits, visibly, until the account can see again.
  const blindClient = { ...client, fetchTradesSince: async () => { throw new Error('no permission'); } };
  VENUE.balances = VENUE.balances.map((b2) => (b2.code === 'xrp' ? { code: 'xrp', amount: 1_258 } : b2));
  s = await sync.syncAccount(account.id, { client: blindClient });
  ok(s.capability.trades !== 'ok', 'degraded endpoint reported');
  ok(s.snapped.length === 0 && s.unexplained.some((u) => u.code === 'xrp'), 'no true-up while blind — drift surfaces instead');
  ok(approx(qtyOf(1, 'xrp'), 970, 1e-6) && approx(qtyOf(2, 'xrp'), 290, 1e-6), 'holdings untouched while blind');
  s = await sync.syncAccount(account.id, { client });
  ok(s.unexplained.length === 0 && approx(qtyOf(1, 'xrp') + qtyOf(2, 'xrp'), 1_258, 1e-9), 'sight restored → drift trues up normally');
  VENUE.balances = VENUE.balances.map((b2) => (b2.code === 'xrp' ? { code: 'xrp', amount: 1_260 } : b2));
  s = await sync.syncAccount(account.id, { client });

  // ---- baseline adoption: sole holder only ----------------------------------
  VENUE.balances.push({ code: 'sol', amount: 5 });
  s = await sync.syncAccount(account.id, { client });
  ok(s.adopted.length === 1 && s.adopted[0].symbol === 'sol', 'sole-holder zero-quantity balance adopted');
  ok(approx(qtyOf(2, 'sol'), 5, 1e-9), 'adoption landed on the only holder (Trial)');
  ok(sub.listTxnLog(account.id).some((r) => r.kind === 'adopt'), 'adoption logged');

  // ---- unexplained entries carry symbol (the toUpper regression) ------------
  // Multi-path unexplained residuals must ship the same {code, symbol,
  // residual} shape as the single path — the UI renders symbol on every
  // refresh and a symbol-less entry crashed the whole page.
  VENUE.balances = VENUE.balances.map((b2) => (b2.code === 'xrp' ? { code: 'xrp', amount: 1_310 } : b2));
  s = await sync.syncAccount(account.id, { client });
  ok(s.unexplained.length === 1 && s.unexplained[0].code === 'xrp', 'out-of-tolerance residual surfaces as unexplained');
  ok(typeof s.unexplained[0].symbol === 'string' && s.unexplained[0].symbol.toLowerCase() === 'xrp', 'multi-path unexplained entry carries symbol');
  VENUE.balances = VENUE.balances.map((b2) => (b2.code === 'xrp' ? { code: 'xrp', amount: 1_260 } : b2));

  // ---- sub-noise float tail must not block adoption --------------------------
  db.prepare("UPDATE assets SET quantity = 1e-12 WHERE profile_id = 2 AND symbol = 'sol'").run();
  VENUE.balances = VENUE.balances.map((b2) => (b2.code === 'sol' ? { code: 'sol', amount: 7 } : b2));
  s = await sync.syncAccount(account.id, { client });
  ok(s.adopted.length === 1 && s.adopted[0].symbol === 'sol', 'sole holder with a 1e-12 tail still adopts the venue balance');
  ok(approx(qtyOf(2, 'sol'), 7, 1e-9), 'adopted quantity lands despite the tail');
  VENUE.balances = VENUE.balances.map((b2) => (b2.code === 'sol' ? { code: 'sol', amount: qtyOf(2, 'sol') } : b2));

  // ---- rewind: T1 trade → reversed + back in the inbox ----------------------
  const before = { btc: qtyOf(1, 'btc'), usdc: qtyOf(1, 'usdc') };
  let r = await sub.rewindTxn(t1Log.id);
  ok(r.warnings.length === 0, 'clean rewind, no warnings');
  ok(approx(qtyOf(1, 'btc'), before.btc - 0.1, 1e-9) && approx(qtyOf(1, 'usdc'), before.usdc + 5_000, 1e-9), 'rewind reversed both legs');
  ok(db.prepare("SELECT profile_id FROM exchange_trades WHERE venue_trade_id = 'tr-1'").get().profile_id === null, 'ownership cleared');
  const requeued = sub.listInbox(account.id).trades.find((q) => q.venue_ref === 'tr-1');
  ok(requeued && /rewound/.test(requeued.reason), 'auto-attributed fill returned to the inbox');
  const orig = db.prepare('SELECT * FROM txn_log WHERE id = ?').get(t1Log.id);
  ok(orig.rewound_by != null, 'original marked rewound');
  threw = false;
  try { await sub.rewindTxn(t1Log.id); } catch { threw = true; }
  ok(threw, 'double rewind refused');
  sub.assignQueuedTrade(requeued.id, 1); // put it back for later state sanity

  // ---- reassign in one step + clamp warning ---------------------------------
  const t2Log = sub.listTxnLog(account.id).find((r2) => r2.ref === 'tr-2' && r2.kind === 'trade-auto-t2');
  db.prepare('UPDATE assets SET quantity = 100 WHERE profile_id = 2 AND symbol = ?').run('usdc'); // consume Trial usdc
  r = await sub.reassignTxn(t2Log.id, 1);
  ok(r.warnings.some((w) => /clamped/i.test(w)), `consumed quantity produced a clamp warning (${r.warnings[0] || 'none'})`);
  ok(approx(qtyOf(2, 'xrp'), 400, 1e-9), 'Trial xrp restored by the reassign rewind');
  ok(approx(qtyOf(1, 'xrp'), 970 - 110, 1e-9), 'Main received the reassigned fill (970 − 110 = 860)');

  // ---- cross-snapshot annotation --------------------------------------------
  const snapLogRow = sub.listTxnLog(account.id).find((r2) => r2.kind === 'trade-assign' && r2.ref === 'tr-1');
  db.prepare('INSERT INTO profile_snapshots (profile_id, ts, total_usd, total_rel) VALUES (1, ?, 1, 1)').run(Date.now() + 1);
  await sub.rewindTxn(snapLogRow.id);
  const note = db
    .prepare("SELECT message FROM alert_log WHERE profile_id = 1 ORDER BY id DESC LIMIT 1")
    .get();
  ok(/annotated, not rewritten/.test(note.message), 'cross-snapshot rewind annotates the profile visibly');

  // ---- carve-out: splice-continuous both sides, rewindable as a pair --------
  const v1 = valueIndexNow(1);
  const btcAsset = db.prepare('SELECT * FROM assets WHERE profile_id = 1 AND symbol = ?').get('btc');
  const carve = await sub.carveOut(account.id, 1, shell.id, [{ asset_id: btcAsset.id, qty: 0.05 }]);
  ok(approx(qtyOf(shell.id, 'btc'), 0.05, 1e-9), 'shell received the carved btc');
  ok(approx(valueIndexNow(1), v1, 1e-6), 'carve-out did not move the source value index (splice-continuous)');
  const carveLegs = sub.listTxnLog(account.id).filter((r2) => r2.ref === carve.ref);
  ok(carveLegs.length === 2, 'carve-out logged as a pair');
  await sub.rewindTxn(carveLegs[0].id);
  ok(approx(qtyOf(shell.id, 'btc'), 0, 1e-9) && approx(qtyOf(1, 'btc'), btcAsset.quantity, 1e-9), 'rewinding one leg reversed BOTH');

  // ---- account summary: totals across profiles in the VIEW's tether ---------
  const sum1 = sub.accountSummary(account.id, 1, PRICES);
  ok(sum1.indexSymbol === 'USDC', 'summary denominates in the viewing profile tether');
  const btcTotal = sum1.assets.find((a) => a.symbol === 'btc');
  const expectBtc = qtyOf(1, 'btc') + (qtyOf(2, 'btc') || 0) + qtyOf(shell.id, 'btc');
  ok(approx(btcTotal.qty, expectBtc, 1e-9), `btc total spans all linked profiles (${btcTotal.qty})`);
  ok(approx(btcTotal.value, expectBtc * 50_000, 1e-6), 'asset value priced in tether units');
  const expectTotal = sum1.assets.reduce((s2, a) => s2 + (a.value || 0), 0);
  ok(approx(sum1.totalValue, expectTotal, 1e-6) && sum1.complete, 'account total = sum of asset values, complete');
  // A missing price degrades honestly instead of lying.
  const partial = sub.accountSummary(account.id, 1, { ...PRICES, 'pax-gold': undefined });
  ok(partial.complete === false && partial.assets.find((a) => a.symbol === 'paxg').value === null, 'unpriced asset → null value, total marked partial');
  // Viewing from the tetherless SHELL denominates in the account owner's tether.
  const shellView = sub.accountSummary(account.id, shell.id, PRICES);
  ok(shellView.indexSymbol === 'USDC', `shell view falls back to the owner's tether (${shellView.indexSymbol})`);
  // Per-profile split for the account-status header.
  ok(Array.isArray(shellView.perProfile) && shellView.perProfile.length === 3, 'summary carries a per-profile split');
  const splitSum = shellView.perProfile.reduce((s2, p) => s2 + (p.value || 0), 0);
  ok(approx(splitSum, shellView.totalValue, 1e-6), `per-profile values sum to the account total (${splitSum.toFixed(2)})`);

  // ---- carve validation ------------------------------------------------------
  threw = false;
  try { await sub.carveOut(account.id, 1, shell.id, [{ asset_id: btcAsset.id, qty: 99 }]); } catch (e) { threw = /available/.test(e.message); }
  ok(threw, 'over-carving refused with the available amount');

  // ---- every trade leg lands on the books (the vanished-USD incident) -------
  // A fill settling in a fiat no profile tracks must SYNTHESIZE the fiat row
  // on the attributed profile (cash never vanishes); a fill settling in an
  // unknown NON-fiat currency must queue WHOLE instead of half-applying.
  {
    db.prepare(
      "INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (2, 'litecoin', 'ltc', 1, 0, 0, 0)"
    ).run();
    // Physical balances mirror the virtual books post-trade so reconcile is
    // quiet and the assertions test ONLY the leg handling.
    const groupBalances = (extra = {}) => {
      const rows = db
        .prepare(
          `SELECT LOWER(a.symbol) code, SUM(a.quantity) s FROM assets a JOIN profiles p ON p.id = a.profile_id
           WHERE p.exchange_account_id = ? GROUP BY LOWER(a.symbol)`
        )
        .all(account.id);
      const by = new Map(rows.map((r) => [r.code, r.s]));
      for (const [c, d] of Object.entries(extra)) by.set(c, (by.get(c) || 0) + d);
      return [...by.entries()].filter(([, v]) => v > 1e-12).map(([code, amount]) => ({ code, amount }));
    };
    const tF = now + 90_000;
    VENUE.trades = [
      { id: 'tr-usd-leg', ts: tF, pair: 'ltc_usd', side: 'sell', price: 100, deltas: [
        { code: 'ltc', delta: -0.5 }, { code: 'usd', delta: 2500 }] },
    ];
    VENUE.balances = groupBalances({ ltc: -0.5, usd: 2500 });
    const sF = await sync.syncAccount(account.id, { client });
    ok(sF.tradesApplied >= 1, 'fiat-settled fill applied (not dropped, not queued)');
    ok(approx(qtyOf(2, 'ltc'), 0.5, 1e-9), 'base leg debited on the unique holder');
    const usdRow = db.prepare("SELECT * FROM assets WHERE profile_id = 2 AND coingecko_id = 'fiat:usd'").get();
    ok(usdRow && approx(usdRow.quantity, 2500, 1e-9), 'the USD cash leg SYNTHESIZED its fiat row and landed on the books');

    const tG = tF + 1000;
    VENUE.trades = [
      { id: 'tr-zzz-leg', ts: tG, pair: 'ltc_zzz', side: 'sell', price: 1, deltas: [
        { code: 'ltc', delta: -0.1 }, { code: 'zzz', delta: 10 }] },
    ];
    VENUE.balances = groupBalances({ ltc: -0.1 });
    const sG = await sync.syncAccount(account.id, { client });
    ok(sG.tradesQueued >= 1, 'unknown-currency fill queued whole');
    ok(approx(qtyOf(2, 'ltc'), 0.5, 1e-9), 'NOTHING applied from the queued fill (no half-application)');
    ok(db.prepare("SELECT * FROM assets WHERE symbol = 'zzz'").get() === undefined, 'no phantom asset row created');
    const qz = db
      .prepare("SELECT * FROM attribution_queue WHERE venue_ref = 'tr-zzz-leg'")
      .get();
    ok(qz && qz.status === 'pending' && /zzz/.test(qz.reason || ''), 'inbox row names the unmapped currency');
  }

  // ---- partial fills aggregate-match advice (the queued-DOGE incident) ------
  // An advised order that executes in pieces: no single piece fits the
  // advised size ±15%, so piece 1 queues — but when piece 2 arrives, the SUM
  // matches the advice, piece 2 auto-attributes (T2 aggregate) and the
  // queued sibling is pulled onto the same profile automatically.
  {
    db.prepare(
      "INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (1, 'litecoin', 'ltc', 0.3, 0, 0, 0)"
    ).run(); // second LTC holder → per-fill T2 territory, not T1
    const tH = now + 200_000;
    db.prepare('INSERT INTO advice_log (profile_id, ts, symbol, side, quantity) VALUES (2, ?, ?, ?, ?)').run(
      tH - 1000, 'ltc', 'SELL', 0.42
    );
    const balancesNow = (extra = {}) => {
      const rows = db
        .prepare(
          `SELECT LOWER(a.symbol) code, SUM(a.quantity) s FROM assets a JOIN profiles p ON p.id = a.profile_id
           WHERE p.exchange_account_id = ? GROUP BY LOWER(a.symbol)`
        )
        .all(account.id);
      const by = new Map(rows.map((r) => [r.code, r.s]));
      for (const [c, d] of Object.entries(extra)) by.set(c, (by.get(c) || 0) + d);
      return [...by.entries()].filter(([, v]) => v > 1e-12).map(([code, amount]) => ({ code, amount }));
    };
    VENUE.trades = [
      { id: 'fill-1', ts: tH, pair: 'ltc_usd', side: 'sell', price: 100, deltas: [
        { code: 'ltc', delta: -0.12 }, { code: 'usd', delta: 12 }] },
      { id: 'fill-2', ts: tH + 60_000, pair: 'ltc_usd', side: 'sell', price: 100, deltas: [
        { code: 'ltc', delta: -0.3 }, { code: 'usd', delta: 30 }] },
    ];
    VENUE.balances = balancesNow({ ltc: -0.42, usd: 42 });
    const sP = await sync.syncAccount(account.id, { client });
    ok(sP.attribution.t2 === 2, `both pieces landed as T2 (piece 2 aggregate + sibling pull; t2=${sP.attribution.t2})`);
    ok(approx(qtyOf(2, 'ltc'), 0.5 - 0.42, 1e-9), 'advised profile debited by the FULL aggregate (0.42 LTC)');
    ok(approx(qtyOf(1, 'ltc'), 0.3, 1e-9), 'the other holder untouched');
    ok(
      db.prepare("SELECT COUNT(*) n FROM attribution_queue WHERE venue_ref IN ('fill-1','fill-2') AND status = 'pending'").get().n === 0,
      'nothing left in the inbox — the queued sibling was pulled automatically'
    );
    ok(
      sub.listTxnLog(account.id).some((t) => /aggregate matched/.test(t.note || '')),
      'txn log says WHY: aggregate matched the advice'
    );
  }

  // ---- delete-asset guard (the live 15,000-MXN vanish, 2026-07-21) ----------
  // Deleting a funded asset on a grouped sub-account must return the balance
  // to the shell (logged carve), never erase it; a funded SHELL asset must
  // refuse; a zero-balance row still deletes plainly.
  {
    db.prepare(
      "INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (2, 'chainlink', 'link', 25, 0, 0, 0)"
    ).run();
    const a = db.prepare("SELECT * FROM assets WHERE profile_id = 2 AND symbol = 'link'").get();
    const shellBefore = qtyOf(shell.id, 'link') || 0;
    const r = await sub.removeAsset(a.id);
    ok(r.ok && r.returned && approx(r.returned.qty, 25, 1e-9), 'funded grouped delete reports the returned balance');
    ok(db.prepare('SELECT * FROM assets WHERE id = ?').get(a.id) === undefined, 'the asset row itself is gone');
    ok(approx(qtyOf(shell.id, 'link'), shellBefore + 25, 1e-9), 'the balance landed in the SHELL, not the void');
    ok(
      sub.listTxnLog(account.id).some(
        (t) => t.kind === 'carve-out' && t.profile_id === shell.id && (t.deltas || []).some((d) => d.symbol === 'link' && d.delta === 25)
      ),
      'the return is in the txn log as a carve (rewindable)'
    );

    const sh = db.prepare("SELECT * FROM assets WHERE profile_id = ? AND symbol = 'link'").get(shell.id);
    ok(sh && sh.quantity > 0, 'shell link row funded by the return');
    let refuse = false;
    try { await sub.removeAsset(sh.id); } catch (e) { refuse = /pool/.test(e.message); }
    ok(refuse, 'a funded shell asset refuses deletion (the pool row IS the money)');
    ok(db.prepare('SELECT * FROM assets WHERE id = ?').get(sh.id) !== undefined, 'the refused shell row survives untouched');

    db.prepare(
      "INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (2, 'tron', 'trx', 0, 0, 0, 0)"
    ).run();
    const z = db.prepare("SELECT * FROM assets WHERE profile_id = 2 AND symbol = 'trx'").get();
    const rz = await sub.removeAsset(z.id);
    ok(rz.ok && !rz.returned, 'a zero-balance grouped row deletes plainly (no carve)');
  }

  // ---- delete-asset SPLICES (the live basket 1.0 → 0.8000 lock-in) ----------
  // Removing a ROW is a structural change: the basket must not lose the row's
  // weight term (observed live: deleting a zero-balance 20%-targeted row read
  // as a 20% unit loss), and a funded unlinked delete must splice value like
  // a withdrawal instead of faking a crash.
  {
    db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('SpliceTest', 10, 15, 0)").run();
    const P = db.prepare("SELECT id FROM profiles WHERE name = 'SpliceTest'").get().id;
    const addA = db.prepare(
      'INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    addA.run(P, 'usd-coin', 'usdc', 100, 40, 1, 100);
    addA.run(P, 'ripple', 'xrp', 10, 40, 0, 10);
    addA.run(P, 'solana', 'sol', 0, 20, 0, 0);
    // Value anchor: rel total = usdc 100×1 + xrp 10×2.5 = 125.
    db.prepare('UPDATE profiles SET value_base = 1, value_snap_rel = 125 WHERE id = ?').run(P);
    const basketAt = () => {
      const prof = db.prepare('SELECT * FROM profiles WHERE id = ?').get(P);
      return bal.computeBasket(db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(P), prof.basket_base);
    };
    ok(approx(basketAt(), 1, 1e-9), 'splice fixture starts at basket 1.0');

    const sol = db.prepare("SELECT * FROM assets WHERE profile_id = ? AND symbol = 'sol'").get(P);
    await sub.removeAsset(sol.id);
    ok(approx(basketAt(), 1, 1e-9), 'deleting a zero-balance TARGETED row leaves the basket level unchanged (the 1.0 → 0.8 bug)');

    const xrpRow = db.prepare("SELECT * FROM assets WHERE profile_id = ? AND symbol = 'xrp'").get(P);
    await sub.removeAsset(xrpRow.id);
    const prof = db.prepare('SELECT * FROM profiles WHERE id = ?').get(P);
    ok(approx(prof.value_snap_rel, 100, 1e-9), 'funded unlinked delete re-anchors the value snap without the removed value');
    ok(approx(bal.computeValueIndex(prof, 100), 1, 1e-9), 'value index reads 1.0 after the funded delete — no fake −20% crash');
    ok(approx(basketAt(), 1, 1e-9), 'basket level survives the funded delete too');

    addA.run(P, 'ripple', 'xrp', 10, 0, 0, 10);
    const again = db.prepare("SELECT * FROM assets WHERE profile_id = ? AND symbol = 'xrp'").get(P);
    const saved = PRICES;
    PRICES = {};
    let refused = false;
    try { await sub.removeAsset(again.id); } catch (e) { refused = /cannot price/.test(e.message); }
    PRICES = saved;
    ok(refused, 'funded delete with pricing down REFUSES (never delete-and-corrupt)');
    ok(db.prepare('SELECT * FROM assets WHERE id = ?').get(again.id) !== undefined, 'the refused row survives untouched');
  }

  // ---- the 377.27-USDC incident (2026-09-23): overdrafts queue, never clamp --
  // Replays the live sequence on its own account: a BTC buy spends the whole
  // shared USDC wallet (Production's 30 + Trial's 140.27), an XRP sale's
  // proceeds wait in the inbox, a second BTC buy spends them. The old code
  // T1-applied both buys to Production and clamped its USDC at zero —
  // silently dropping 377.27 USDC of spending. Now each overdrawing fill
  // queues with the shortfall named, assign refuses until the cash is on the
  // books, and the human fix (assign the sale, carve Trial's cash) closes it.
  {
    const mk = (name) => db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES (?, 10, 15, 0)").run(name).lastInsertRowid;
    const PX = mk('ProdX');
    const TX = mk('TrialX');
    add.run(PX, 'usd-coin', 'usdc', 30, 10, 1, 30);
    add.run(PX, 'bitcoin', 'btc', 0.1, 60, 0, 0.1);
    add.run(PX, 'ripple', 'xrp', 1_000, 30, 0, 1_000);
    add.run(TX, 'usd-coin', 'usdc', 140.27458663, 10, 1, 140.27458663);
    add.run(TX, 'pax-gold', 'paxg', 0.04, 90, 0, 0.04);
    await bal.pollProfiles({ force: true });
    const acct = sync.createAccount(PX, 'bitso', 'k2', 's2');
    sub.linkProfile(PX, acct.id);
    sub.linkProfile(TX, acct.id);
    const shX = sub.ensureShell(acct.id);
    const shXrp = sub.ensureAsset(shX.id, { coingecko_id: 'ripple', symbol: 'xrp' });
    db.prepare('UPDATE assets SET quantity = 500 WHERE id = ?').run(shXrp.id);
    const V = { balances: [], trades: [], flows: [] };
    const cX = {
      venue: 'test',
      fetchBalances: async () => V.balances,
      fetchTradesSince: async (since) => V.trades.filter((t) => t.ts > since),
      fetchFlowsSince: async (since) => V.flows.filter((f) => f.ts > since),
    };
    const T0 = Date.now() + 1000;
    V.trades = [
      { id: 'inc-buy-1', ts: T0, pair: 'btc_usdc', side: 'buy', price: 50_000, deltas: [
        { code: 'btc', delta: 0.0034 }, { code: 'usdc', delta: -170.27 }] },
      { id: 'inc-sell-xrp', ts: T0 + 1000, pair: 'xrp_usdc', side: 'sell', price: 2.37, deltas: [
        { code: 'xrp', delta: -100 }, { code: 'usdc', delta: 237.79184685 }, { code: 'usdc', delta: -0.79184685 }] },
      { id: 'inc-buy-2', ts: T0 + 2000, pair: 'btc_usdc', side: 'buy', price: 50_000, deltas: [
        { code: 'btc', delta: 0.0047 }, { code: 'usdc', delta: -237 }] },
    ];
    V.balances = [
      { code: 'usdc', amount: 0.00458663 },
      { code: 'btc', amount: 0.1081 },
      { code: 'xrp', amount: 1_400 },
      { code: 'paxg', amount: 0.04 },
    ];
    let si = await sync.syncAccount(acct.id, { client: cX });
    ok(si.multi && si.tradesQueued === 3 && si.tradesApplied === 0, `all three fills wait in the inbox (queued=${si.tradesQueued})`);
    ok(approx(qtyOf(PX, 'usdc'), 30) && approx(qtyOf(PX, 'btc'), 0.1), 'NOTHING applied — no silent clamp of Production\'s USDC');
    ok(si.unexplained.length === 0, 'reconcile stays clean: queued deltas count as expected');
    const q = (ref) => db.prepare('SELECT * FROM attribution_queue WHERE venue_ref = ?').get(ref);
    ok(/short 140\.27 USDC/.test(q('inc-buy-1').reason) && /carve/.test(q('inc-buy-1').reason), `overdraft reason names the shortfall and the fix ("${q('inc-buy-1').reason.slice(0, 60)}…")`);
    ok(q('inc-buy-1').suggested_profile_id === PX, 'overdrawing fill still suggests its natural owner');
    ok(/short 207 USDC/.test(q('inc-buy-2').reason), 'second buy: short 207 (the XRP proceeds are not on the books yet)');

    let msg = '';
    try { sub.assignQueuedTrade(q('inc-buy-1').id, PX); } catch (e) { msg = e.message; }
    ok(/Can't assign/.test(msg) && /short 140\.27 USDC/.test(msg), 'assign refuses an overdraft instead of clamping');
    ok(approx(qtyOf(PX, 'usdc'), 30) && approx(qtyOf(PX, 'btc'), 0.1), 'a refused assign changes nothing');
    ok(q('inc-buy-1').status === 'pending', 'refused fill stays in the inbox');

    // The human fix, in UI order: the sale first, then the second buy …
    sub.assignQueuedTrade(q('inc-sell-xrp').id, PX);
    ok(approx(qtyOf(PX, 'usdc'), 267, 1e-9), 'XRP proceeds land on Production (30 + 237)');
    sub.assignQueuedTrade(q('inc-buy-2').id, PX);
    ok(approx(qtyOf(PX, 'usdc'), 30, 1e-9), 'second buy now fits: 267 − 237 = 30');
    // … then Production borrows Trial's cash (a carve, both indices spliced) …
    const vTrial = valueIndexNow(TX);
    const trialUsdc = db.prepare("SELECT * FROM assets WHERE profile_id = ? AND symbol = 'usdc'").get(TX);
    await sub.carveOut(acct.id, TX, PX, [{ asset_id: trialUsdc.id, qty: 140.27 }]);
    ok(approx(valueIndexNow(TX), vTrial, 1e-6), "Trial's track record untouched by lending its cash");
    sub.assignQueuedTrade(q('inc-buy-1').id, PX);
    ok(Math.abs(qtyOf(PX, 'usdc')) < 1e-8 && approx(qtyOf(PX, 'btc'), 0.1081, 1e-9), 'first buy applies once the cash is booked there');
    si = await sync.syncAccount(acct.id, { client: cX });
    ok(si.unexplained.length === 0, 'books equal the venue — no residual at all');

    // Fee-sized overdraft still applies (the true-up absorbs crumbs), and the
    // log records what ACTUALLY moved so a rewind reverses exactly that.
    db.prepare("UPDATE assets SET quantity = 10 WHERE profile_id = ? AND symbol = 'usdc'").run(PX);
    V.trades.push({ id: 'inc-fee-slack', ts: T0 + 3000, pair: 'btc_usdc', side: 'buy', price: 50_000, deltas: [
      { code: 'btc', delta: 0.0002 }, { code: 'usdc', delta: -10 }, { code: 'usdc', delta: -0.05 }] });
    V.balances = V.balances.map((b) => (b.code === 'btc' ? { code: 'btc', amount: 0.1083 } : b));
    si = await sync.syncAccount(acct.id, { client: cX });
    ok(si.tradesApplied === 1 && si.tradesQueued === 0, 'a fee-sized overdraft (0.05 of 10.05 USDC) still auto-applies');
    const feeLog = sub.listTxnLog(acct.id).find((r) => r.ref === 'inc-fee-slack');
    const loggedUsdc = feeLog.deltas.filter((d) => d.symbol === 'usdc').reduce((s2, d) => s2 + d.delta, 0);
    ok(approx(loggedUsdc, -10, 1e-12) && qtyOf(PX, 'usdc') === 0, 'the clamped leg is logged as applied (−10), not as asked (−10.05)');

    // ---- Resolve: the live damage (phantom 377.27 USDC) fixed from the UI ---
    db.prepare("UPDATE assets SET quantity = 237 WHERE profile_id = ? AND symbol = 'usdc'").run(PX);
    db.prepare("UPDATE assets SET quantity = 140.27458663 WHERE profile_id = ? AND symbol = 'usdc'").run(TX);
    si = await sync.syncAccount(acct.id, { client: cX });
    const flag = si.unexplained.find((u2) => u2.code === 'usdc');
    ok(flag && approx(flag.residual, -377.27, 1e-9), `legacy damage surfaces as a −377.27 USDC residual (${flag && flag.residual})`);

    const refuse = async (args, re, label) => {
      let m = '';
      try { await sub.resolveResidual(acct.id, args); } catch (e) { m = e.message; }
      ok(re.test(m), `${label} (${m.slice(0, 70)})`);
    };
    await refuse({ profileId: TX, code: 'usdc', amount: -377.27, kind: 'trade' }, /holds only 140\.27458663 USDC/, 'resolve refuses to drive a profile negative');
    await refuse({ profileId: PX, code: 'usdc', amount: 5, kind: 'trade' }, /negative amount/, 'resolve refuses the wrong sign');
    await refuse({ profileId: PX, code: 'usdc', amount: -400, kind: 'trade' }, /more than the flagged residual/, 'resolve refuses more than the flag');
    await refuse({ profileId: PX, code: 'btc', amount: -1, kind: 'trade' }, /flagged no BTC residual/, 'resolve refuses an unflagged code');
    await refuse({ profileId: PX, code: 'usdc', amount: -1, kind: 'bogus' }, /kind must be/, 'resolve refuses an unknown kind');

    // Honest repair: Trial's cash was spent by Production → carve it over
    // (splice), then book the dropped spending on Production as a missed
    // trade leg (NO splice: the phantom gain leaves its value index).
    const tU = db.prepare("SELECT * FROM assets WHERE profile_id = ? AND symbol = 'usdc'").get(TX);
    await sub.carveOut(acct.id, TX, PX, [{ asset_id: tU.id, qty: 140.27 }]);
    const relOf = (pid) => {
      const as = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(pid);
      const iu = bal.indexUsdFor(as, PRICES);
      return as.reduce((s2, a) => { const pr = bal.priceAsset(a, iu, PRICES); return s2 + (pr ? a.quantity * pr.rel : 0); }, 0);
    };
    const v0 = valueIndexNow(PX);
    const rel0 = relOf(PX);
    const res = await sub.resolveResidual(acct.id, { profileId: PX, code: 'usdc', amount: flag.residual, kind: 'trade' });
    ok(Math.abs(qtyOf(PX, 'usdc')) < 1e-8, 'missed trade leg removed the phantom USDC from Production');
    ok(approx(valueIndexNow(PX) / v0, relOf(PX) / rel0, 1e-9) && valueIndexNow(PX) < v0, 'booked as P&L: the value index drops by the phantom amount (no splice)');
    let acctRow = db.prepare('SELECT last_sync_note FROM exchange_accounts WHERE id = ?').get(acct.id);
    let n2 = JSON.parse(acctRow.last_sync_note);
    ok(!n2.unexplained.some((u2) => u2.code === 'usdc'), 'the flag clears at once (stored note shifted)');
    ok(Math.abs(n2.perCode.find((r) => r.code === 'usdc').residual) < 1e-8, 'reconcile row reads ~0 residual');
    const resLog = sub.listTxnLog(acct.id).find((r) => r.id === res.txnId);
    ok(resLog.kind === 'residual-trade' && /missed trade leg/.test(resLog.note), 'logged in plain words as a residual resolution');
    si = await sync.syncAccount(acct.id, { client: cX });
    ok(si.unexplained.length === 0, 'the next real sync agrees: books equal the venue');

    // Rewind puts quantity AND flag back; the flow kind splices both ways.
    await sub.rewindTxn(res.txnId);
    ok(approx(qtyOf(PX, 'usdc'), 377.27, 1e-9), 'rewind restores the booked quantity');
    n2 = JSON.parse(db.prepare('SELECT last_sync_note FROM exchange_accounts WHERE id = ?').get(acct.id).last_sync_note);
    const back = n2.unexplained.find((u2) => u2.code === 'usdc');
    ok(back && approx(back.residual, -377.27, 1e-9), 'rewind re-flags the residual until the next sync');
    const vF = valueIndexNow(PX);
    const resF = await sub.resolveResidual(acct.id, { profileId: PX, code: 'usdc', amount: -377.27, kind: 'flow' });
    ok(Math.abs(qtyOf(PX, 'usdc')) < 1e-8 && approx(valueIndexNow(PX), vF, 1e-6), 'flow kind: quantity leaves, value index continuous (spliced)');
    await sub.rewindTxn(resF.txnId);
    ok(approx(qtyOf(PX, 'usdc'), 377.27, 1e-9) && approx(valueIndexNow(PX), vF, 1e-6), 'flow-kind rewind splices back continuously');
    // Split across profiles: part here, the rest elsewhere.
    await sub.resolveResidual(acct.id, { profileId: PX, code: 'usdc', amount: -200, kind: 'trade' });
    n2 = JSON.parse(db.prepare('SELECT last_sync_note FROM exchange_accounts WHERE id = ?').get(acct.id).last_sync_note);
    ok(approx(n2.unexplained.find((u2) => u2.code === 'usdc').residual, -177.27, 1e-9), 'a partial resolve leaves the remainder flagged');
    await sub.resolveResidual(acct.id, { profileId: PX, code: 'usdc', amount: -177.27, kind: 'trade' });
    si = await sync.syncAccount(acct.id, { client: cX });
    ok(si.unexplained.length === 0 && Math.abs(qtyOf(PX, 'usdc')) < 1e-8, 'resolved in two parts, books equal the venue');
  }

  // ---- txn log keyset paging (the "Load older ↓" backend) -------------------
  {
    const total = db.prepare('SELECT COUNT(*) c FROM txn_log WHERE account_id = ?').get(account.id).c;
    ok(total >= 4, `enough txn_log rows accumulated to page over (${total})`);
    const page1 = sub.listTxnLogPage(account.id, { limit: 3 });
    const last = page1[page1.length - 1];
    const rest = sub.listTxnLogPage(account.id, { beforeTs: last.ts, beforeId: last.id, limit: 10_000 });
    const paged = [...page1, ...rest].map((r) => r.id);
    ok(paged.length === total && new Set(paged).size === total, 'keyset pages cover the whole log exactly once, no dupes');
    ok(paged.join(',') === sub.listTxnLog(account.id, 10_000).map((r) => r.id).join(','), 'paged order identical to the one-shot list');
  }

  console.log('test-subaccounts: all assertions passed');
  process.exit(0);
})().catch((err) => {
  console.error('FAIL (exception):', err);
  process.exit(1);
});
