// Master-pool rules (user's call 2026-10-16) for multi-profile accounts:
// (1) every deposit lands on the master, booked BEFORE the sync's fills;
// (2) a sale nobody can claim is the master's when the master holds enough
// of the coin and no strategy profile has an open buy/sell alert on it from
// the past week. The user's routine — deposit XRP, sell it in pieces,
// withdraw the pesos — must book itself with no inbox, while a strategy's
// open alert keeps an ambiguous sale in the inbox and its advised fill still
// matches the strategy.
process.env.EXCHANGE_MARKET_DATA = 'off';
const { freshDb, ok, approx } = require('./helpers');
freshDb('master-rules');

const pricing = require('../lib/pricing');
const PRICES = { 'usd-coin': 1, bitcoin: 50_000, ripple: 1.35, 'pax-gold': 3000, 'fiat:mxn': 0.055 };
pricing.fetchUsdPrices = async () => PRICES;

const db = require('../lib/db');
const bal = require('../lib/balancer');
const sync = require('../lib/sync');
const sub = require('../lib/subaccounts');

const qtyOf = (pid, sym) =>
  (db.prepare('SELECT quantity FROM assets WHERE profile_id = ? AND LOWER(symbol) = ?').get(pid, sym) || {}).quantity;
const tick = () => new Promise((r) => setTimeout(r, 5));
const VENUE = { balances: [], trades: [], flows: [] };
const client = {
  venue: 'test',
  fetchBalances: async () => VENUE.balances,
  fetchTradesSince: async (since) => VENUE.trades.filter((t) => t.ts > since),
  fetchFlowsSince: async (since) => VENUE.flows.filter((f) => f.ts > since),
};
const setBal = (code, amount) => {
  const b = VENUE.balances.find((x) => x.code === code);
  if (b) b.amount = amount;
  else VENUE.balances.push({ code, amount });
};

(async () => {
  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('Production', 12.5, 15, 0)").run();
  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('Trial', 10, 15, 0)").run();
  const add = db.prepare(
    'INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  add.run(1, 'usd-coin', 'usdc', 0, 0, 1, 0);
  add.run(1, 'bitcoin', 'BTC', 0.1, 73, 0, 0.1);
  add.run(1, 'ripple', 'XRP', 1500, 27, 0, 1500);
  add.run(2, 'usd-coin', 'usdc', 1000, 50, 1, 1000);
  add.run(2, 'pax-gold', 'paxg', 1 / 3, 50, 0, 1 / 3);
  const account = sync.createAccount(1, 'bitso', 'k', 's');
  sub.linkProfile(1, account.id);
  sub.linkProfile(2, account.id);
  const shell = sub.ensureShell(account.id);
  db.prepare("INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index) VALUES (?, 'fiat:mxn', 'mxn', 100000, 0, 1)").run(shell.id);
  db.prepare("INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index) VALUES (?, 'ripple', 'XRP', 462, 0, 0)").run(shell.id);
  db.prepare('UPDATE exchange_accounts SET auto_flows = 1 WHERE id = ?').run(account.id);
  VENUE.balances = [
    { code: 'btc', amount: 0.1 }, { code: 'xrp', amount: 1962 }, { code: 'usdc', amount: 1000 },
    { code: 'paxg', amount: 1 / 3 }, { code: 'mxn', amount: 100000 },
  ];
  let s = await sync.syncAccount(account.id, { client });
  ok(s.multi && s.unexplained.length === 0, 'group settles clean');
  await bal.pollProfiles({ force: true });
  await tick();

  // ---- the routine, ONE sync: deposit XRP, sell it in two pieces, withdraw --
  const t0 = Date.now();
  VENUE.flows.push({ id: 'dep-1', ts: t0, kind: 'deposit', code: 'xrp', amount: 480 });
  VENUE.trades.push(
    { id: 's-1', ts: t0 + 1, pair: 'xrp_mxn', side: 'sell', price: 25, deltas: [
      { code: 'xrp', delta: -479 }, { code: 'mxn', delta: 11975 }, { code: 'mxn', delta: -90 }] },
    { id: 's-2', ts: t0 + 2, pair: 'xrp_mxn', side: 'sell', price: 25, deltas: [
      { code: 'xrp', delta: -1 }, { code: 'mxn', delta: 25 }, { code: 'mxn', delta: -0.2 }] }
  );
  VENUE.flows.push({ id: 'wd-1', ts: t0 + 3, kind: 'withdrawal', code: 'mxn', amount: -11909.8 });
  await tick();
  s = await sync.syncAccount(account.id, { client });
  const dep = db.prepare("SELECT * FROM pending_flows WHERE venue_ref = 'dep-1'").get();
  ok(dep.profile_id === shell.id && dep.status === 'applied', 'deposit booked on the master, automatically');
  ok(s.attribution.master === 2 && s.tradesQueued === 0, 'both sale pieces filed to the master — nothing in the inbox');
  ok(db.prepare("SELECT COUNT(*) n FROM txn_log WHERE kind = 'trade-auto-master'").get().n === 2, 'logged as master fills (rewindable)');
  const wd = db.prepare("SELECT * FROM pending_flows WHERE venue_ref = 'wd-1'").get();
  ok(wd.profile_id === shell.id && wd.status === 'applied' && !wd.hold_reason, 'pesos withdrawal booked on the master, automatically');
  ok(approx(qtyOf(shell.id, 'xrp'), 462, 1e-9) && approx(qtyOf(shell.id, 'mxn'), 100000, 1e-6), 'master back to its own 462 XRP / 100,000 MXN');
  ok(approx(qtyOf(1, 'xrp'), 1500, 1e-9), "Production's XRP untouched");
  ok(s.unexplained.length === 0, 'books match the venue');

  // ---- a deposit of a coin only a strategy holds still goes to the master ----
  await tick();
  VENUE.flows.push({ id: 'dep-2', ts: Date.now(), kind: 'deposit', code: 'paxg', amount: 0.1 });
  setBal('paxg', 1 / 3 + 0.1);
  s = await sync.syncAccount(account.id, { client });
  const dep2 = db.prepare("SELECT * FROM pending_flows WHERE venue_ref = 'dep-2'").get();
  ok(dep2.profile_id === shell.id && dep2.status === 'applied', 'PAXG deposit (only Trial held PAXG) lands on the master');
  ok(approx(qtyOf(2, 'paxg'), 1 / 3, 1e-12) && approx(qtyOf(shell.id, 'paxg'), 0.1, 1e-12), "Trial's track record untouched; master holds it");

  // ---- an OPEN strategy alert on the coin keeps an ambiguous sale in the inbox
  db.prepare("INSERT INTO advice_log (profile_id, ts, symbol, side, quantity) VALUES (1, ?, 'xrp', 'SELL', 300)").run(Date.now());
  const prodXrp = db.prepare("SELECT id FROM assets WHERE profile_id = 1 AND symbol = 'XRP'").get().id;
  db.prepare('INSERT OR REPLACE INTO alloc_alerts (asset_id, triggered_at, drift_rel_pct) VALUES (?, ?, ?)').run(prodXrp, Date.now(), 13.4);
  ok(sub.openAdvice(account.id, 'xrp', Date.now() - 86_400_000).length === 1, 'Production has an open XRP alert');
  await tick();
  VENUE.trades.push({ id: 's-3', ts: Date.now(), pair: 'xrp_mxn', side: 'sell', price: 25, deltas: [
    { code: 'xrp', delta: -50 }, { code: 'mxn', delta: 1250 }] });
  setBal('xrp', 1962 - 50);
  setBal('mxn', 100000 + 1250);
  s = await sync.syncAccount(account.id, { client });
  ok(s.tradesQueued === 1 && s.attribution.master === 0, 'open strategy alert on XRP → the unmatched sale waits in the inbox');
  ok(approx(qtyOf(shell.id, 'xrp'), 462, 1e-9), 'master not charged for it');
  // …while the advised sale itself still goes to the strategy (T2).
  await tick();
  VENUE.trades.push({ id: 's-4', ts: Date.now(), pair: 'xrp_mxn', side: 'sell', price: 25, deltas: [
    { code: 'xrp', delta: -300 }, { code: 'mxn', delta: 7500 }] });
  setBal('xrp', 1962 - 50 - 300);
  setBal('mxn', 100000 + 1250 + 7500);
  s = await sync.syncAccount(account.id, { client });
  ok(s.attribution.t2 === 1 && approx(qtyOf(1, 'xrp'), 1200, 1e-9), "the advised 300 XRP sale is Production's (alert match)");
  const q3 = db.prepare("SELECT id FROM attribution_queue WHERE venue_ref = 's-3' AND status = 'pending'").get();
  sub.assignQueuedTrade(q3.id, shell.id);

  // ---- alert cleared (traded back / new targets) → master can claim again ----
  db.prepare('DELETE FROM alloc_alerts').run();
  ok(sub.openAdvice(account.id, 'xrp', Date.now() - 86_400_000).length === 0, 'a cleared alert is no longer open');
  await tick();
  VENUE.trades.push({ id: 's-5', ts: Date.now(), pair: 'xrp_mxn', side: 'sell', price: 25, deltas: [
    { code: 'xrp', delta: -40 }, { code: 'mxn', delta: 1000 }] });
  setBal('xrp', 1962 - 50 - 300 - 40);
  setBal('mxn', 100000 + 1250 + 7500 + 1000);
  s = await sync.syncAccount(account.id, { client });
  ok(s.attribution.master === 1 && approx(qtyOf(shell.id, 'xrp'), 462 - 50 - 40, 1e-9), 'no open alert → the sale is the master’s');

  // ---- the master can't cover it → inbox, never a silent overdraft ----------
  await tick();
  VENUE.trades.push({ id: 's-6', ts: Date.now(), pair: 'xrp_mxn', side: 'sell', price: 25, deltas: [
    { code: 'xrp', delta: -1000 }, { code: 'mxn', delta: 25000 }] });
  setBal('xrp', 1962 - 50 - 300 - 40 - 1000);
  setBal('mxn', 100000 + 1250 + 7500 + 1000 + 25000);
  s = await sync.syncAccount(account.id, { client });
  ok(s.attribution.master === 0 && s.tradesQueued === 1, 'a sale bigger than the master holds waits in the inbox');

  // ---- deposits without auto-apply: pending on the master, sale queues -------
  db.prepare('UPDATE exchange_accounts SET auto_flows = 0 WHERE id = ?').run(account.id);
  await tick();
  const t9 = Date.now();
  VENUE.flows.push({ id: 'dep-3', ts: t9, kind: 'deposit', code: 'btc', amount: 0.01 });
  s = await sync.syncAccount(account.id, { client });
  const dep3 = db.prepare("SELECT * FROM pending_flows WHERE venue_ref = 'dep-3'").get();
  ok(dep3.profile_id === shell.id && dep3.status === 'pending', 'auto-apply off: the deposit waits, suggested to the master');

  console.log('test-master-rules: all assertions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
