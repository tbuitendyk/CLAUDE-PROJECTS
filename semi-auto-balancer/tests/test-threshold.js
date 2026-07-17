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

console.log('threshold calibration tests pass');
