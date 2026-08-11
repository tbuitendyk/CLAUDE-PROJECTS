// Phase 1: weight-normalized threshold calibration.
// The whole point: every asset triggers at ~the same own-price move X,
// regardless of its weight.
const { freshDb, ok, approx } = require('./helpers');
freshDb('threshold');

// Stub pricing BEFORE requiring balancer (it destructures at module load).
const pricing = require('../lib/pricing');
let PRICES = {};
pricing.fetchUsdPrices = async () => PRICES;

const db = require('../lib/db');
const bal = require('../lib/balancer');

// --- effectiveThreshold math ---
ok(approx(bal.effectiveThreshold(0.10, 0.04), (0.10 * 0.96) / 1.004), 'T(10%, w=4%) = 9.56% drift');
ok(approx(bal.effectiveThreshold(0.10, 0.56), (0.10 * 0.44) / 1.056), 'T(10%, w=56%) = 4.17% drift');
ok(bal.effectiveThreshold(0.10, 1.0) === null, 'w=1 (pinned share) -> null, never triggers');
ok(bal.effectiveThreshold(0.10, 1.5) === null, 'w>1 -> null');
ok(bal.effectiveThreshold(0, 0.5) === null, 'X=0 -> null');
ok(bal.effectiveThreshold(-1, 0.5) === null, 'X<0 -> null');

// --- end-to-end calibration through evaluateProfile ---
// Pool: USDT tether 40%, BIG coin 56%, SMALL coin 4%. X = 10%.
db.prepare(
  "INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('P', 10, 15, 0)"
).run();
const pid = 1;
const addAsset = db.prepare(
  'INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
addAsset.run(pid, 'tether', 'usdt', 4000, 40, 1, 4000);
addAsset.run(pid, 'bigcoin', 'big', 56, 56, 0, 56); // $100 each -> 5600 = 56%
addAsset.run(pid, 'smallcoin', 'sml', 4, 4, 0, 4); // $100 each -> 400 = 4%

function evalWith(prices) {
  PRICES = prices;
  db.prepare('DELETE FROM alloc_alerts').run();
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(pid);
  return bal.evaluateProfile(profile, PRICES, Date.now());
}

const BASE = { tether: 1, bigcoin: 100, smallcoin: 100 };

// At target: no breach anywhere.
let r = evalWith(BASE);
ok(r.breaches.length === 0, 'no breach at target weights');

// SMALL asset (w=4%): +9.5% price move -> under trigger; +10.5% -> over.
r = evalWith({ ...BASE, smallcoin: 109.5 });
ok(!r.breaches.some((b) => b.asset.symbol === 'sml'), 'w=4%: +9.5% move does NOT trigger (X=10%)');
r = evalWith({ ...BASE, smallcoin: 110.5 });
ok(r.breaches.some((b) => b.asset.symbol === 'sml'), 'w=4%: +10.5% move DOES trigger');

// BIG asset (w=56%): same price moves, same outcome — the calibration point.
// (Old flat-threshold design needed a ~26% move here.)
r = evalWith({ ...BASE, bigcoin: 109.5 });
ok(!r.breaches.some((b) => b.asset.symbol === 'big'), 'w=56%: +9.5% move does NOT trigger');
r = evalWith({ ...BASE, bigcoin: 110.5 });
ok(r.breaches.some((b) => b.asset.symbol === 'big'), 'w=56%: +10.5% move DOES trigger — same X as the 4% asset');
const bigBreach = r.breaches.find((b) => b.asset.symbol === 'big');
ok(bigBreach.action === 'SELL', 'overweight big asset -> SELL');
ok(bigBreach.thresholdPct != null && approx(bigBreach.thresholdPct, 4.1666666, 1e-3), 'breach carries its effective threshold (~4.17% drift)');

// Stale-proof advice: the breach carries the holding's current value and its
// target value (target% × pool) in the index currency, and the message shows
// both — an hour later "trade until the position reads ≈ target" still works.
{
  const pool = 4000 + 56 * 110.5 + 4 * 100; // usdt + big + sml at these prices
  ok(approx(bigBreach.holdRel, 56 * 110.5, 1e-9), 'breach carries the current holding value');
  ok(approx(bigBreach.targetRel, 0.56 * pool, 1e-9), 'breach carries the target value (target% × pool)');
  ok(r.indexNote && approx(r.indexNote.targetRel, 0.40 * pool, 1e-9), 'tether note carries its target value too');
  const mailer = require('../lib/mailer');
  const text = mailer.buildText({
    profile: db.prepare('SELECT * FROM profiles WHERE id = 1').get(),
    alerts: [bigBreach],
    indexNote: r.indexNote,
  });
  ok(/-> SELL .*holding ≈ 6188\.00 \S+, target ≈ 5929\.28/.test(text), 'advice line shows holding and target index values');
  const noteHalf = text.split('Note:')[1] || '';
  ok(/holding ≈ 4000\.00 \S+, target ≈ 4235\.20/.test(noteHalf), 'tether note shows holding and target too');
}

// Tether: never trades, note only — even when its share drifts.
r = evalWith({ ...BASE, bigcoin: 60, smallcoin: 60 }); // crypto crashes, tether overweight
ok(!r.breaches.some((b) => b.asset.symbol === 'usdt'), 'tether never breaches (note only)');
ok(r.indexNote && r.indexNote.symbol === 'usdt', 'index note present for tether');

// Zero-target asset: excluded from evaluation entirely.
addAsset.run(pid, 'fringe', 'frg', 100, 0, 0, null);
r = evalWith({ ...BASE, fringe: 1 });
ok(!r.breaches.some((b) => b.asset.symbol === 'frg'), '0-target asset never breaches');
db.prepare("DELETE FROM assets WHERE symbol = 'frg'").run();

// w=100% degenerate profile: never alerts, no crash.
db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('Solo', 10, 15, 0)").run();
addAsset.run(2, 'bigcoin', 'big', 10, 100, 0, 10);
PRICES = { bigcoin: 100 };
const solo = db.prepare('SELECT * FROM profiles WHERE id = 2').get();
const rs = bal.evaluateProfile(solo, PRICES, Date.now());
ok(rs.breaches.length === 0, 'w=100% profile never alerts (T would be 0)');

// --- per-ASSET quiet period (1b): a breach on an asset NOT in the notified
// set sends even while the profile is quiet; repeats stay silent. ---
db.prepare("UPDATE profiles SET notify_state = 'notified' WHERE id = 1").run();
{
  const p1 = db.prepare('SELECT * FROM profiles WHERE id = 1').get();
  const a = db.prepare('SELECT * FROM assets WHERE profile_id = 1 LIMIT 1').get();
  const breach = { asset: a, side: 'BUY', driftRelPct: -50 };
  const rNew = bal.decideNotification(p1, { breaches: [breach], newBreaches: [breach], indexNote: null }, false, Date.now());
  ok(rNew && rNew.alerts.length === 1, 'per-asset quiet: a NEW breach notifies during the quiet period');
  const p1b = db.prepare('SELECT * FROM profiles WHERE id = 1').get();
  ok(p1b.notify_state === 'notified', 'sending re-stamps the notified state');
  const rRep = bal.decideNotification(p1b, { breaches: [breach], newBreaches: [], indexNote: null }, false, Date.now());
  ok(rRep === null, 'per-asset quiet: repeats of already-notified breaches stay silent');
}

// --- account-wide context for grouped (sub-account) profiles ---
// The venue screen shows the SUM across sub-accounts; a shared asset's
// advice must carry that number and the value the screen should read after
// this profile's trade. Sole-holder assets stay clean (no duplicate line).
{
  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('G1', 10, 15, 0)").run();
  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('G2', 10, 15, 0)").run();
  const g1 = db.prepare("SELECT id FROM profiles WHERE name = 'G1'").get().id;
  const g2 = db.prepare("SELECT id FROM profiles WHERE name = 'G2'").get().id;
  const acct = db
    .prepare(
      "INSERT INTO exchange_accounts (profile_id, venue, api_key, api_secret, last_trade_ts, last_ledger_ts, created_at) VALUES (?, 'kraken', 'k', 's', 0, 0, 0)"
    )
    .run(g1).lastInsertRowid;
  db.prepare('UPDATE profiles SET exchange_account_id = ? WHERE id IN (?, ?)').run(acct, g1, g2);
  addAsset.run(g1, 'tether', 'usdt', 500, 50, 1, 500);
  addAsset.run(g1, 'bigcoin', 'big', 5, 50, 0, 5);
  addAsset.run(g2, 'bigcoin', 'big', 20, 100, 0, 20); // sibling slice of the same coin
  PRICES = { tether: 1, bigcoin: 130 }; // G1: big 650 of 1150 pool → overweight
  const gp = db.prepare('SELECT * FROM profiles WHERE id = ?').get(g1);
  const rg = bal.evaluateProfile(gp, PRICES, Date.now());
  const gb = rg.breaches.find((b) => b.asset.symbol === 'big');
  ok(gb && gb.action === 'SELL', 'grouped fixture: shared asset breaches');
  ok(approx(gb.accountHoldRel, 25 * 130, 1e-9), 'account-wide holding sums across linked profiles (25 big)');
  ok(approx(gb.accountAfterRel, 25 * 130 + (575 - 650), 1e-9), "account-wide after = account now + this profile's delta");
  ok(rg.indexNote && rg.indexNote.accountHoldRel == null, 'sole-holder tether: no account-wide context attached');
  const mailer = require('../lib/mailer');
  const text = mailer.buildText({ profile: gp, alerts: [gb], indexNote: rg.indexNote });
  ok(/account-wide BIG ≈ 3250\.00 \S+ now → trade until ≈ 3175\.00/.test(text), 'message shows account-wide now → trade-until');
  ok((text.match(/account-wide/g) || []).length === 1, 'sole-holder assets do not grow the extra line');
}

console.log('threshold calibration tests pass');
