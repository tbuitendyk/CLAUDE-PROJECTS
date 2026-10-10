// Cash-out / cash-in re-booking + withdrawal routing (live incident
// 2026-10-05, Bitso MAIN): a strategy profile with cash at 0% target sold
// BTC for MXN in three fills and the MXN was withdrawn in the same sync.
// Before: the fills read as an 18% basket loss, the withdrawal auto-applied
// to the pool (which also held MXN), and the strategy's books kept the gone
// cash for days, alerting "BTC underweight". Gate: the withdrawal is routed
// to the profile that received the proceeds and HELD (no auto-apply, notice
// logged, alerts paused); the fills carry exact index stamps; re-booking the
// order puts basket AND value index back exactly where a splice would have;
// legacy (unstamped) fills reconstruct from poll snapshots; everything is
// rewindable and guarded.
process.env.EXCHANGE_MARKET_DATA = 'off';
const { freshDb, ok, approx } = require('./helpers');
freshDb('funding');

const pricing = require('../lib/pricing');
const PRICES = { 'usd-coin': 1, bitcoin: 50_000, ripple: 2.5, 'pax-gold': 3000, 'fiat:mxn': 0.05 };
pricing.fetchUsdPrices = async () => PRICES;

const db = require('../lib/db');
const bal = require('../lib/balancer');
const sync = require('../lib/sync');
const sub = require('../lib/subaccounts');

const qtyOf = (pid, sym) =>
  (db.prepare('SELECT quantity FROM assets WHERE profile_id = ? AND symbol = ?').get(pid, sym) || {}).quantity;
const prof = (pid) => db.prepare('SELECT * FROM profiles WHERE id = ?').get(pid);
const assetsOf = (pid) => db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(pid);
const basketNow = (pid) => bal.computeBasket(assetsOf(pid), prof(pid).basket_base);
const valueNow = (pid) => {
  const assets = assetsOf(pid);
  const iu = bal.indexUsdFor(assets, PRICES);
  const total = assets.reduce((s, a) => {
    const pr = bal.priceAsset(a, iu, PRICES);
    return s + (pr ? a.quantity * pr.rel : 0);
  }, 0);
  return bal.computeValueIndex(prof(pid), total);
};
const tick = () => new Promise((r) => setTimeout(r, 5));

const VENUE = { balances: [], trades: [], flows: [] };
const client = {
  venue: 'test',
  fetchBalances: async () => VENUE.balances,
  fetchTradesSince: async (since) => VENUE.trades.filter((t) => t.ts > since),
  fetchFlowsSince: async (since) => VENUE.flows.filter((f) => f.ts > since),
};

(async () => {
  // Production: BTC 75% / XRP 25%, its USDC tether and (later) MXN at 0% —
  // the live shape. Trial: USDC 50% / PAXG 50%.
  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('Production', 10, 15, 0)").run();
  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('Trial', 10, 15, 0)").run();
  const add = db.prepare(
    'INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  add.run(1, 'usd-coin', 'usdc', 0, 0, 1, 0);
  add.run(1, 'bitcoin', 'BTC', 0.3, 75, 0, 0.3); // 15,000 USD = 75%
  add.run(1, 'ripple', 'XRP', 2000, 25, 0, 2000); // 5,000 USD = 25%
  add.run(2, 'usd-coin', 'usdc', 1000, 50, 1, 1000);
  add.run(2, 'pax-gold', 'paxg', 1 / 3, 50, 0, 1 / 3);

  const account = sync.createAccount(1, 'bitso', 'k', 's');
  sub.linkProfile(1, account.id);
  sub.linkProfile(2, account.id);
  const shell = sub.ensureShell(account.id);
  db.prepare(
    "INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index) VALUES (?, 'fiat:mxn', 'mxn', 100000, 0, 1)"
  ).run(shell.id);
  db.prepare('UPDATE exchange_accounts SET auto_flows = 1 WHERE id = ?').run(account.id);
  VENUE.balances = [
    { code: 'btc', amount: 0.3 },
    { code: 'xrp', amount: 2000 },
    { code: 'usdc', amount: 1000 },
    { code: 'paxg', amount: 1 / 3 },
    { code: 'mxn', amount: 100000 },
  ];
  let s = await sync.syncAccount(account.id, { client });
  ok(s.multi && s.unexplained.length === 0, 'group settles clean before the cash-out');
  await bal.pollProfiles({ force: true }); // anchors value indices + the pre-cash-out snapshot
  ok(approx(valueNow(1), 1) && approx(basketNow(1), 1), 'Production starts at basket 1, value 1');
  await tick();

  // ---- the cash-out: three BTC→MXN fills + the withdrawal, one sync ---------
  // 1 BTC = 1,000,000 MXN at these prices; fees in MXN.
  const tc = Date.now();
  VENUE.trades = [
    { id: 'co-1', ts: tc, pair: 'btc_mxn', side: 'sell', price: 1e6, deltas: [
      { code: 'btc', delta: -0.02 }, { code: 'mxn', delta: 20000 }, { code: 'mxn', delta: -150 }] },
    { id: 'co-2', ts: tc + 1, pair: 'btc_mxn', side: 'sell', price: 1e6, deltas: [
      { code: 'btc', delta: -0.01 }, { code: 'mxn', delta: 10000 }, { code: 'mxn', delta: -75 }] },
    { id: 'co-3', ts: tc + 2, pair: 'btc_mxn', side: 'sell', price: 1e6, deltas: [
      { code: 'btc', delta: -0.01 }, { code: 'mxn', delta: 10000 }, { code: 'mxn', delta: -75 }] },
  ];
  VENUE.flows = [{ id: 'wd-1', ts: tc + 3, kind: 'withdrawal', code: 'mxn', amount: -39700 }];
  VENUE.balances = [
    { code: 'btc', amount: 0.26 },
    { code: 'xrp', amount: 2000 },
    { code: 'usdc', amount: 1000 },
    { code: 'paxg', amount: 1 / 3 },
    { code: 'mxn', amount: 100000 },
  ];
  await tick();
  s = await sync.syncAccount(account.id, { client });
  ok(s.attribution.t1 === 3, 'all three fills auto-attributed to Production (only BTC holder)');
  ok(approx(qtyOf(1, 'mxn'), 39700, 1e-9), 'Production booked the 39,700 MXN proceeds');
  const fills = db.prepare("SELECT * FROM txn_log WHERE kind = 'trade-auto-t1' ORDER BY id").all();
  ok(fills.length === 3 && fills.every((f) => f.idx), 'every applied fill carries an index stamp');
  const st = JSON.parse(fills[0].idx);
  ok(approx(st.b0, 1) && approx(st.b1, 0.95), `first fill's exact basket effect stamped (1 → ${st.b1})`);
  ok(approx(st.v0, 1) && approx(st.v1, (20000 - 7.5) / 20000), 'first fill stamps only its fee on the value index');

  // Routing: the pool also holds MXN, but Production holds fresh proceeds.
  const wd = db.prepare("SELECT * FROM pending_flows WHERE venue_ref = 'wd-1'").get();
  ok(wd.profile_id === 1, 'withdrawal suggested to Production (it received the MXN), not the pool');
  ok(wd.status === 'pending' && /received from its own trades/.test(wd.hold_reason || ''), 'held for a human despite auto-apply');
  ok(s.heldFlows.length === 1 && s.autoAppliedFlows === 0, 'summary reports the hold; nothing auto-applied');
  ok(approx(qtyOf(shell.id, 'mxn'), 100000, 1e-9), "the pool's MXN untouched");
  ok(s.unexplained.length === 0, 'reconcile stays clean while the flow waits (pending counts)');
  const notice = db.prepare("SELECT message FROM alert_log WHERE profile_id = 1 AND message LIKE '%NOT auto-applied%'").get();
  ok(notice && /alerts .* are paused/.test(notice.message), 'held-flow notice logged on Production, says alerts pause');

  // Alerts pause while held: the books still count the withdrawn MXN.
  let poll = await bal.pollProfiles({ force: true });
  ok(!poll.events.some((e) => e.profile.id === 1), 'no rebalance alert off the withdrawn cash while the flow is held');
  ok(db.prepare('SELECT COUNT(*) n FROM alloc_alerts').get().n === 0, 'nothing marked active while paused');
  ok(approx(basketNow(1), 0.9), 'the cash-out still reads as a basket loss (0.90) — the bug being fixed');

  await sync.applyPendingFlow(wd.id);
  ok(approx(qtyOf(1, 'mxn'), 0, 1e-9), 'confirming books the withdrawal on Production');
  poll = await bal.pollProfiles({ force: true });
  ok(poll.events.some((e) => e.profile.id === 1), 'alerts resume once the books settle (BTC really is underweight now)');
  const vBefore = valueNow(1);
  ok(approx(vBefore, (20000 - 15) / 20000), 'value index carries only the fees');

  // ---- re-book the order as a cash-out (exact path) --------------------------
  const plan = await sub.rebookAsFunding(fills[1].id, { preview: true });
  ok(plan.fills.length === 3 && plan.what === 'cash-out', 'clicking ONE fill plans the whole order (3 sibling fills)');
  ok(approx(plan.basket.after, 1) && approx(plan.value.after, 1), 'plan: basket and value return exactly to pre-cash-out levels');
  ok(approx(basketNow(1), 0.9), 'preview changes nothing');
  await sub.rebookAsFunding(fills[1].id);
  ok(approx(basketNow(1), 1) && approx(valueNow(1), 1), 'applied: basket 0.90 → 1, value back to 1 (fees were the cash-out cost)');
  const log = sub.listTxnLog(account.id);
  ok(log.filter((r) => r.kind === 'funding').length === 3, 'one rewindable funding row per fill');
  ok(fills.every((f) => log.find((r) => r.id === f.id).funding_id), 'trade rows show they are re-booked');
  let threw = null;
  try { await sub.rebookAsFunding(fills[0].id); } catch (e) { threw = e.message; }
  ok(/already re-booked/.test(threw || ''), 'double re-booking refused');
  threw = null;
  try { await sub.rewindTxn(fills[0].id); } catch (e) { threw = e.message; }
  ok(/log entry first/.test(threw || ''), 'rewinding a re-booked fill refused (would remove the jump twice)');
  ok(/Snapshots between the fill and now/.test(
    db.prepare("SELECT message FROM alert_log WHERE profile_id = 1 AND message LIKE '%re-booked as a cash-out%'").get().message
  ), 'index-honesty annotation on the profile');

  // Rewind one marking → exactly that fill's effect comes back; re-book it alone.
  const fund2 = log.find((r) => r.kind === 'funding' && r.reclass_of === fills[1].id);
  await sub.rewindTxn(fund2.id);
  ok(approx(basketNow(1), 0.925 / 0.95), "rewinding one marking restores exactly that fill's jump");
  const p2 = await sub.rebookAsFunding(fills[1].id);
  ok(p2.fills.length === 1 && approx(basketNow(1), 1), 'siblings already marked are skipped; re-booking it alone restores 1');

  // ---- legacy path: fills from before stamping ------------------------------
  for (const r of db.prepare("SELECT id FROM txn_log WHERE kind = 'funding' AND rewound_by IS NULL").all()) await sub.rewindTxn(r.id);
  ok(approx(basketNow(1), 0.9) && approx(valueNow(1), (20000 - 15) / 20000), 'all markings rewound → back to the raw cash-out levels');
  db.prepare("UPDATE txn_log SET idx = NULL WHERE kind = 'trade-auto-t1'").run();
  const lp = await sub.rebookAsFunding(fills[2].id, { preview: true });
  ok(lp.fills.length === 3 && lp.fills.every((f) => f.legacy), 'unstamped fills reconstruct from the poll snapshots');
  ok(approx(lp.basket.after, 1, 1e-9) && approx(lp.value.after, 1, 1e-9), 'legacy reconstruction is exact for the cash-out shape');
  await sub.rebookAsFunding(fills[2].id);
  ok(approx(basketNow(1), 1, 1e-9) && approx(valueNow(1), 1, 1e-9), 'legacy re-booking applied');

  // ---- guards -----------------------------------------------------------------
  threw = null;
  const flowRow = db.prepare("SELECT id FROM txn_log WHERE kind = 'flow-apply'").get();
  try { await sub.rebookAsFunding(flowRow.id); } catch (e) { threw = e.message; }
  ok(/only synced fills/.test(threw || ''), 'only fills can be re-booked');

  // ---- routing: the pool's own withdrawal still auto-applies to the pool ----
  await tick();
  VENUE.trades = [];
  VENUE.flows.push({ id: 'wd-2', ts: Date.now(), kind: 'withdrawal', code: 'mxn', amount: -5000 });
  VENUE.balances = VENUE.balances.map((b) => (b.code === 'mxn' ? { ...b, amount: 95000 } : b));
  s = await sync.syncAccount(account.id, { client });
  const wd2 = db.prepare("SELECT * FROM pending_flows WHERE venue_ref = 'wd-2'").get();
  ok(wd2.profile_id === shell.id && !wd2.hold_reason && wd2.status === 'applied', "no fresh strategy proceeds → the pool's withdrawal auto-applies as before");
  ok(approx(qtyOf(shell.id, 'mxn'), 95000, 1e-9), 'pool paid it');

  // ---- routing: default can't cover → the profile that can, held -------------
  await tick();
  VENUE.flows.push({ id: 'wd-3', ts: Date.now(), kind: 'withdrawal', code: 'usdc', amount: -400 });
  VENUE.balances = VENUE.balances.map((b) => (b.code === 'usdc' ? { ...b, amount: 600 } : b));
  s = await sync.syncAccount(account.id, { client });
  const wd3 = db.prepare("SELECT * FROM pending_flows WHERE venue_ref = 'wd-3'").get();
  ok(wd3.profile_id === 2 && /can cover it/.test(wd3.hold_reason || '') && wd3.status === 'pending',
    'USDC withdrawal the pool cannot pay → suggested to Trial (the only one that can), held');
  ok(!(await bal.pollProfiles({ force: true })).events.some((e) => e.profile.id === 2), "Trial's alerts pause too");
  sync.dismissPendingFlow(wd3.id);

  // ---- routing: unassigned proceeds in the inbox → held ----------------------
  await tick();
  db.prepare(
    `INSERT INTO attribution_queue (account_id, kind, venue_ref, ts, pair, side, price, deltas, suggested_profile_id, reason)
     VALUES (?, 'trade', 'q-1', ?, 'xrp_mxn', 'sell', 25, ?, 1, 'test')`
  ).run(account.id, Date.now(), JSON.stringify([{ code: 'mxn', delta: 100 }]));
  VENUE.flows.push({ id: 'wd-4', ts: Date.now(), kind: 'withdrawal', code: 'mxn', amount: -100 });
  s = await sync.syncAccount(account.id, { client });
  const wd4 = db.prepare("SELECT * FROM pending_flows WHERE venue_ref = 'wd-4'").get();
  ok(wd4.status === 'pending' && /attribution inbox/.test(wd4.hold_reason || ''), 'MXN proceeds still in the inbox → withdrawal held');

  // Assigned fills are stamped too.
  const q = db.prepare("SELECT id FROM attribution_queue WHERE venue_ref = 'q-1'").get();
  sub.assignQueuedTrade(q.id, 1);
  const as = db.prepare("SELECT idx FROM txn_log WHERE kind = 'trade-assign' AND ref = 'q-1'").get();
  const ai = JSON.parse(as.idx);
  ok(approx(ai.b0, ai.b1) && ai.v1 > ai.v0, 'assigned fills carry a stamp (untargeted cash: basket flat, value up)');

  // ---- routing: a sole holder leaves no doubt — auto-applies as before ------
  sync.dismissPendingFlow(wd4.id);
  await tick();
  const tb = Date.now();
  VENUE.trades.push({ id: 'xb-1', ts: tb, pair: 'xrp_mxn', side: 'buy', price: 2.5, deltas: [
    { code: 'xrp', delta: 40 }, { code: 'mxn', delta: -100 }] });
  VENUE.flows.push({ id: 'wd-5', ts: tb + 1, kind: 'withdrawal', code: 'xrp', amount: -40 });
  s = await sync.syncAccount(account.id, { client });
  const wd5 = db.prepare("SELECT * FROM pending_flows WHERE venue_ref = 'wd-5'").get();
  ok(wd5.profile_id === 1 && !wd5.hold_reason && wd5.status === 'applied',
    'sole XRP holder with fresh XRP proceeds → no doubt whose money, auto-applies as before');

  console.log('test-funding: all assertions passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
