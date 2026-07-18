// Phase 3 safety rails: recovered-drawdown envelope math (1.25×, clamps,
// skip rules), fast-crash trigger, engine-level BUY suppression (SELLs
// pass; no alloc_alert, no armed-state consumption), auto-unfreeze at
// 0.75×, and the latched depeg watch.
process.env.EXCHANGE_MARKET_DATA = 'off';
const { freshDb, ok, approx } = require('./helpers');
freshDb('safety');

const pricing = require('../lib/pricing');
let PRICES = {};
pricing.fetchUsdPrices = async () => PRICES;

const db = require('../lib/db');
const bal = require('../lib/balancer');
const safety = require('../lib/safety');
const exsource = require('../lib/exsource');

const DAY = 86_400_000;
const t0 = 1_700_000_000_000 - (1_700_000_000_000 % DAY);

function seedDaily(id, prices) {
  const ins = db.prepare('INSERT OR REPLACE INTO daily_prices (coingecko_id, ts, usd_price) VALUES (?, ?, ?)');
  prices.forEach((p, i) => ins.run(id, t0 + i * DAY, p));
}

(async () => {
  // --- envelope math on synthetic paths ---
  // 300 days: 100 -> drop to 60 (40% dd) -> recover to 105 -> stable.
  const recovered40 = [
    ...Array.from({ length: 50 }, () => 100),
    ...Array.from({ length: 50 }, (_, i) => 100 - (i + 1) * 0.8), // to 60
    ...Array.from({ length: 100 }, (_, i) => 60 + (i + 1) * 0.45), // past 100
    ...Array.from({ length: 100 }, () => 105),
  ];
  const env = safety.computeEnvelope(recovered40);
  ok(approx(env, 50, 1e-6), 'envelope = 1.25 × deepest recovered dd (40% -> 50%)');

  const deep = recovered40.map((p, i) => (i < 100 ? p : p)); // reuse then add a 70% recovered dd
  const recovered70 = [...recovered40, ...Array.from({ length: 60 }, (_, i) => 105 - i * 1.2), ...Array.from({ length: 80 }, (_, i) => 33 + i * 1)];
  const env70 = safety.computeEnvelope(recovered70);
  ok(env70 <= 85.000001, 'envelope clamps at 85%');

  ok(safety.computeEnvelope(recovered40.slice(0, 100)) === null, 'skipped under 180d of history');
  const shallow = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 10) * 5); // max dd ~10%
  ok(safety.computeEnvelope(shallow) === null, 'skipped when no recovered dd ≥ 20% exists');

  // Right-censored (unrecovered) drawdowns don't set the envelope.
  const unrecovered = [...Array.from({ length: 200 }, () => 100), ...Array.from({ length: 100 }, (_, i) => 100 - i * 0.9)];
  ok(safety.computeEnvelope(unrecovered) === null, 'open (unrecovered) drawdown alone sets no envelope');

  // --- fast crash ---
  const calm = Array.from({ length: 200 }, () => 100);
  const crash = safety.currentStress([...calm, 100, 98, 90, 70, 58], null);
  ok(crash.fastCrash, '≥40% drop inside 7 days flags a fast crash');
  const slow = safety.currentStress([...calm, ...Array.from({ length: 30 }, (_, i) => 100 - i * 1.5)], null);
  ok(!slow.fastCrash, 'a slow grind is not a fast crash');

  // --- engine suppression: frozen BUY silenced, SELL passes ---
  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('P', 10, 15, 0)").run();
  const add = db.prepare(
    'INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (1, ?, ?, ?, ?, ?, ?)'
  );
  add.run('tether', 'usdt', 1000, 40, 1, 1000);
  add.run('bitcoin', 'btc', 0.02, 30, 0, 0.02); // will be UNDERWEIGHT -> BUY
  add.run('ripple', 'xrp', 3000, 30, 0, 3000); // will be OVERWEIGHT -> SELL
  PRICES = { tether: 1, bitcoin: 20000, ripple: 0.5 };
  // totals: usdt 1000 + btc 400 + xrp 1500 = 2900; btc 13.8% vs 30 (BUY), xrp 51.7% vs 30 (SELL)

  const profile = db.prepare('SELECT * FROM profiles WHERE id = 1').get();
  let result = bal.evaluateProfile({ ...profile }, PRICES, t0);
  ok(result.breaches.some((b) => b.action === 'BUY' && b.asset.symbol === 'btc'), 'unfrozen: BUY breach present');

  db.prepare("UPDATE assets SET buy_frozen = 1, freeze_reason = 'test' WHERE symbol = 'btc'").run();
  db.prepare('DELETE FROM alloc_alerts').run();
  result = bal.evaluateProfile({ ...profile }, PRICES, t0 + 1000);
  ok(!result.breaches.some((b) => b.asset.symbol === 'btc'), 'frozen: BUY breach suppressed at the engine');
  ok(result.breaches.some((b) => b.action === 'SELL' && b.asset.symbol === 'xrp'), 'frozen elsewhere: SELL still passes');
  ok(!result.newBreaches.some((b) => b.asset.symbol === 'btc'), 'suppressed BUY is not a new breach either');
  const marked = db.prepare('SELECT asset_id FROM alloc_alerts').all();
  ok(!marked.some((m) => m.asset_id === 2), 'suppressed BUY never marks alloc_alerts');

  // Freeze override: status stays frozen, suppression stands down.
  db.prepare("UPDATE assets SET freeze_override = 1 WHERE symbol = 'btc'").run();
  result = bal.evaluateProfile({ ...profile }, PRICES, t0 + 2000);
  ok(
    result.breaches.some((b) => b.action === 'BUY' && b.asset.symbol === 'btc'),
    'freeze_override: BUY breach flows again while still frozen'
  );
  ok(db.prepare("SELECT buy_frozen FROM assets WHERE symbol = 'btc'").get().buy_frozen === 1, 'override does not clear the frozen status');
  db.prepare("UPDATE assets SET freeze_override = 0 WHERE symbol = 'btc'").run();

  // ---- Phase 3.5: market-relative freeze ----
  // A market coin: peak then a decline to `ddPct` drawdown (≥180d).
  function mktSeries(ddPct, n = 210) {
    const end = 100 * (1 - ddPct / 100);
    const h = Math.floor(n / 2);
    return [
      ...Array.from({ length: h }, () => 100),
      ...Array.from({ length: n - h }, (_, i) => 100 + (end - 100) * ((i + 1) / (n - h))),
    ];
  }
  // A risk asset with an envelope-setting history (recovered 50% dd -> envelope
  // 62.5%) THEN a terminal decline to `finalDDPct` from its trailing high.
  function envDeclineSeries(finalDDPct) {
    const env = [
      ...Array.from({ length: 60 }, () => 100),
      ...Array.from({ length: 40 }, (_, i) => 100 - (i + 1) * 1.25), // -> 50 (recovered 50% dd)
      ...Array.from({ length: 100 }, (_, i) => 50 + (i + 1) * 0.62), // -> ~112
      ...Array.from({ length: 40 }, () => 110),
    ];
    const peak = Math.max(...env);
    const end = peak * (1 - finalDDPct / 100);
    return [...env, ...Array.from({ length: 60 }, (_, i) => 110 + (end - 110) * ((i + 1) / 60))];
  }
  const MKTS = ['mkt1', 'mkt2', 'mkt3', 'mkt4', 'mkt5', 'mkt6', 'mkt7', 'mkt8'];
  const seedMarket = (ddPct) => MKTS.forEach((id) => seedDaily(id, mktSeries(ddPct)));
  const addRisk = db.prepare(
    "INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (1, ?, ?, 1, 50, 0, 1)"
  );
  const frozenOf = (sym) => db.prepare('SELECT buy_frozen FROM assets WHERE symbol = ?').get(sym).buy_frozen;
  const findT = (ts, sym) => ts.find((t) => t.asset && t.asset.symbol === sym);

  // Scenario 1 — idiosyncratic collapse while the market is CALM: freeze.
  db.prepare('DELETE FROM daily_prices').run();
  addRisk.run('testcoin', 'tst');
  seedDaily('testcoin', envDeclineSeries(72)); // 72% dd, past its 62.5% envelope
  seedMarket(0); // calm market
  let transitions = safety.evaluateFreezes();
  ok(findT(transitions, 'tst') && findT(transitions, 'tst').kind === 'freeze', 'idiosyncratic collapse (calm market) freezes');
  ok(/idiosyncratic/.test(findT(transitions, 'tst').reason), 'freeze reason names it idiosyncratic vs the market');
  ok(frozenOf('tst') === 1, 'idiosyncratic freeze persisted');
  ok(safety.evaluateFreezes().every((t) => !(t.asset && t.asset.symbol === 'tst')), 'freeze latched (no repeat)');

  // Scenario 2 — the whole MARKET falls to the asset's level: the excess
  // vanishes, so it UNFREEZES and rejoins harvesting (the core 3.5 win).
  seedMarket(65); // market now ~65% down too; testcoin still ~72% -> excess ~7pp
  transitions = safety.evaluateFreezes();
  const un = findT(transitions, 'tst');
  ok(un && un.kind === 'unfreeze', 'when the market catches up, the frozen asset unfreezes');
  ok(un.via === 'caught up to the market', 'unfreeze attributed to catching up to the market (not absolute recovery)');
  ok(frozenOf('tst') === 0, 'relative unfreeze persisted');

  // Scenario 3 — an asset falling WITH a broad market never freezes at all
  // (tandem drawdown keeps the pool trading).
  db.prepare('DELETE FROM daily_prices').run();
  addRisk.run('tandemcoin', 'tnd');
  seedDaily('tandemcoin', envDeclineSeries(70));
  seedMarket(66); // broad deep market from the start; excess ~4pp
  transitions = safety.evaluateFreezes();
  ok(!findT(transitions, 'tnd'), 'asset falling with the market is never frozen');
  ok(frozenOf('tnd') === 0, 'tandem asset stays tradable');

  // Scenario 4 — absolute catastrophe (>90%) freezes even inside a deep
  // market crash, where the excess alone wouldn't trigger.
  db.prepare('DELETE FROM daily_prices').run();
  addRisk.run('deadcoin', 'ded');
  seedDaily('deadcoin', envDeclineSeries(96));
  seedMarket(92); // market also deep; excess only ~4pp -> not idiosyncratic
  transitions = safety.evaluateFreezes();
  ok(findT(transitions, 'ded') && findT(transitions, 'ded').kind === 'freeze', 'catastrophe freezes even when the market is also deep');
  ok(/catastroph/i.test(findT(transitions, 'ded').reason), 'catastrophe backstop names itself');

  // Scenario 5 — blended benchmark math: mean(BTC dd, median-of-universe dd),
  // stablecoins excluded.
  db.prepare('DELETE FROM daily_prices').run();
  seedDaily('bitcoin', mktSeries(60)); // BTC 60% dd
  ['m1', 'm2', 'm3'].forEach((id) => seedDaily(id, mktSeries(20))); // three at 20%
  let md = safety.marketDrawdown();
  ok(approx(md.btcPct, 60, 1e-6), 'BTC drawdown measured');
  ok(approx(md.medianPct, 20, 1e-6), 'median across the universe');
  ok(approx(md.blendPct, 40, 1e-6), 'blend = mean(BTC, median)');
  ok(md.n === 4, 'benchmark set size counts every eligible coin');
  seedDaily('tether', mktSeries(30)); // a stablecoin...
  md = safety.marketDrawdown();
  ok(md.n === 4, 'stablecoins are excluded from the benchmark');

  // --- depeg watch: latched both ways, valuation untouched ---
  exsource.usdPrices = async () => ({ tether: 0.965 });
  let depegs = await safety.evaluateDepegs();
  ok(depegs.some((t) => t.kind === 'depeg' && t.asset.symbol === 'usdt'), 'peg break below $0.98 latches');
  depegs = await safety.evaluateDepegs();
  ok(depegs.length === 0, 'depeg notice latched (no repeat while broken)');
  exsource.usdPrices = async () => ({ tether: 0.995 });
  depegs = await safety.evaluateDepegs();
  ok(depegs.some((t) => t.kind === 'repeg'), 'recovery inside the band latches the all-clear');

  console.log('safety rail tests pass');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
