// Inherited engine invariants: the chained basket and value index stay
// continuous across target changes, flows, and index switches — only trading
// and market moves ever move them. value_started_at survives every splice.
const { freshDb, ok, approx } = require('./helpers');
freshDb('engine');

const pricing = require('../lib/pricing');
let PRICES = {};
pricing.fetchUsdPrices = async () => PRICES;

const db = require('../lib/db');
const bal = require('../lib/balancer');

function totalRelNow(pid) {
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(pid);
  const iu = bal.indexUsdFor(assets, PRICES);
  return assets.reduce((s, a) => {
    const p = bal.priceAsset(a, iu, PRICES);
    return s + (p ? a.quantity * p.rel : 0);
  }, 0);
}

(async () => {
  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('P', 10, 15, 0)").run();
  const pid = 1;
  const add = db.prepare(
    'INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  add.run(pid, 'tether', 'usdt', 5000, 40, 1, 5000);
  add.run(pid, 'bitcoin', 'btc', 0.1, 40, 0, 0.1);
  add.run(pid, 'fiat:mxn', 'mxn', 100000, 20, 0, 100000);
  PRICES = { tether: 1, bitcoin: 50000, 'fiat:mxn': 0.05 };

  await bal.pollProfiles({ force: true });
  let p = db.prepare('SELECT * FROM profiles WHERE id = ?').get(pid);
  ok(p.value_started_at != null, 'value_started_at stamped on first anchor');
  const startAt = p.value_started_at;
  ok(approx(bal.computeValueIndex(p, totalRelNow(pid)), 1), 'value index anchors at 1.0');

  let assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(pid);
  ok(approx(bal.computeBasket(assets, p.basket_base), 1), 'basket starts at 1.0');

  // Target change: basket continuous (splice), start preserved.
  bal.setTargets(pid, [
    { asset_id: 1, target_pct: 30 },
    { asset_id: 2, target_pct: 50 },
    { asset_id: 3, target_pct: 20 },
  ]);
  p = db.prepare('SELECT * FROM profiles WHERE id = ?').get(pid);
  assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(pid);
  ok(approx(bal.computeBasket(assets, p.basket_base), 1), 'basket continuous across target change');
  ok(p.value_started_at === startAt, 'start preserved across target change');

  // Flow: deposit BTC — neither basket nor value index moves.
  const viBefore = bal.computeValueIndex(p, totalRelNow(pid));
  await bal.recordFlow(pid, [{ asset_id: 2, delta: 0.05 }], 'test deposit');
  p = db.prepare('SELECT * FROM profiles WHERE id = ?').get(pid);
  assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(pid);
  ok(approx(bal.computeBasket(assets, p.basket_base), 1, 1e-6), 'basket continuous across deposit');
  ok(approx(bal.computeValueIndex(p, totalRelNow(pid)), viBefore, 1e-6), 'value index continuous across deposit');
  ok(p.value_started_at === startAt, 'start preserved across deposit');

  // Index switch USDT -> MXN: value index continuous, basket untouched.
  await bal.setIndexAsset(pid, 3);
  p = db.prepare('SELECT * FROM profiles WHERE id = ?').get(pid);
  ok(approx(bal.computeValueIndex(p, totalRelNow(pid)), viBefore, 1e-4), 'value index continuous across index switch');
  ok(p.value_started_at === startAt, 'start preserved across index switch');

  // Market move DOES move the value index (that's the point).
  PRICES = { tether: 1, bitcoin: 100000, 'fiat:mxn': 0.05 };
  const viAfterPump = bal.computeValueIndex(p, totalRelNow(pid));
  ok(viAfterPump > viBefore * 1.2, 'market gain moves the value index');

  // Trading DOES move the basket: sell high (BTC above snapshot) into tether.
  assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(pid);
  const btc = assets.find((a) => a.symbol === 'btc');
  const usdt = assets.find((a) => a.symbol === 'usdt');
  db.prepare('UPDATE assets SET quantity = ? WHERE id = ?').run(btc.quantity - 0.02, btc.id);
  db.prepare('UPDATE assets SET quantity = ? WHERE id = ?').run(usdt.quantity + 0.02 * 100000, usdt.id);
  assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(pid);
  const basketAfterTrade = bal.computeBasket(assets, p.basket_base);
  ok(basketAfterTrade > 1, `trading (sell-high) grows the basket (${basketAfterTrade.toFixed(6)})`);

  // Fresh-profile path (assets added via the app carry basket_units from
  // day one): no targets -> basket is null, and the FIRST setTargets starts
  // the track record at 1.0 rather than freezing in a zero base.
  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('Fresh', 10, 15, 0)").run();
  const p2 = 2;
  add.run(p2, 'tether', 'usdt', 1000, 0, 1, 1000);
  add.run(p2, 'bitcoin', 'btc', 0.5, 0, 0, 0.5);
  let fAssets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(p2);
  ok(bal.computeBasket(fAssets, 1) === null, 'no targets yet -> basket null (not 0)');
  bal.setTargets(p2, fAssets.map((a, i) => ({ asset_id: a.id, target_pct: i === 0 ? 60 : 40 })));
  const fp = db.prepare('SELECT * FROM profiles WHERE id = ?').get(p2);
  fAssets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(p2);
  ok(approx(bal.computeBasket(fAssets, fp.basket_base), 1), 'first setTargets on a fresh profile starts the basket at 1.0');

  console.log('engine continuity tests pass');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
