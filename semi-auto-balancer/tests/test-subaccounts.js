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

  // ---- dust snap lands in the SHELL -----------------------------------------
  const dust = 0.00002; // within 0.05% of 0.3 btc
  VENUE.trades = [];
  VENUE.balances = [
    { code: 'usdc', amount: 7_350 },
    { code: 'btc', amount: 0.3 + dust },
    { code: 'xrp', amount: 1_260 },
    { code: 'paxg', amount: 1.0 },
  ];
  s = await sync.syncAccount(account.id, { client });
  ok(s.snapped.length === 1, 'dust within tolerance snapped');
  ok(approx(qtyOf(shell.id, 'btc'), dust, 1e-12), 'the SHELL absorbed the dust, not a strategy profile');
  ok(approx(qtyOf(1, 'btc'), 0.3, 1e-12), 'Main btc clean');

  // ---- baseline adoption: sole holder only ----------------------------------
  VENUE.balances.push({ code: 'sol', amount: 5 });
  s = await sync.syncAccount(account.id, { client });
  ok(s.adopted.length === 1 && s.adopted[0].symbol === 'sol', 'sole-holder zero-quantity balance adopted');
  ok(approx(qtyOf(2, 'sol'), 5, 1e-9), 'adoption landed on the only holder (Trial)');
  ok(sub.listTxnLog(account.id).some((r) => r.kind === 'adopt'), 'adoption logged');

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
  ok(approx(qtyOf(shell.id, 'btc'), dust + 0.05, 1e-9), 'shell received the carved btc');
  ok(approx(valueIndexNow(1), v1, 1e-6), 'carve-out did not move the source value index (splice-continuous)');
  const carveLegs = sub.listTxnLog(account.id).filter((r2) => r2.ref === carve.ref);
  ok(carveLegs.length === 2, 'carve-out logged as a pair');
  await sub.rewindTxn(carveLegs[0].id);
  ok(approx(qtyOf(shell.id, 'btc'), dust, 1e-9) && approx(qtyOf(1, 'btc'), btcAsset.quantity, 1e-9), 'rewinding one leg reversed BOTH');

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

  console.log('test-subaccounts: all assertions passed');
  process.exit(0);
})().catch((err) => {
  console.error('FAIL (exception):', err);
  process.exit(1);
});
