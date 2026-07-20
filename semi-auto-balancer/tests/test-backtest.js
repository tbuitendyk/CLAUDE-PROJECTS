// Phase 2 threshold sweep: PLAN.md's validation battery — sinusoid gives an
// interior optimum where basket & value agree; a pure downtrend makes them
// diverge (warning, no recommendation); higher cost pushes the optimum
// looser; the simulator's emitted trades match the production engine's
// breach math exactly; and the staleness hash tracks target changes.
process.env.EXCHANGE_MARKET_DATA = 'off';
const { freshDb, ok, approx } = require('./helpers');
freshDb('backtest');

const pricing = require('../lib/pricing');
let PRICES = {};
pricing.fetchUsdPrices = async () => PRICES;

const db = require('../lib/db');
const bal = require('../lib/balancer');
const bt = require('../lib/backtest');

const DAY = 86_400_000;
const t0 = 1_700_000_000_000 - (1_700_000_000_000 % DAY);
const ASSETS = [
  { coingecko_id: 'tether', symbol: 'usdt', target_pct: 50, is_index: 1 },
  { coingecko_id: 'bitcoin', symbol: 'btc', target_pct: 50, is_index: 0 },
];
const mkBars = (n, priceFn) =>
  Array.from({ length: n }, (_, i) => ({ ts: t0 + i * DAY, usd: { tether: 1, bitcoin: priceFn(i) } }));

(async () => {
  // --- sinusoid: mean-reverting market -> interior optimum, both curves agree ---
  const sinBars = mkBars(720, (i) => 100 * (1 + 0.3 * Math.sin((2 * Math.PI * i) / 90)));
  const sin = bt.sweep(ASSETS, sinBars, { feePct: 0.3, spreadPct: 0.1 });
  ok(sin.recommendation != null, 'sinusoid: basket & value agree -> a recommendation exists');
  ok(sin.recommendation.x < 30, 'sinusoid: optimum is interior, not "never trade"');
  const sinBest = Math.max(...sin.grid.map((r) => r.netBasketGrowthPct));
  ok(sinBest > 0, `sinusoid: harvesting grows the basket (+${sinBest.toFixed(2)}pp)`);
  const atReco = sin.grid.find((r) => r.x === sin.recommendation.x);
  ok(atReco.tradeCount > 0, 'sinusoid: the recommended X actually trades');
  const x30 = sin.grid.find((r) => r.x === 30);
  ok(x30.tradeCount <= atReco.tradeCount, 'looser X trades less often');
  ok(atReco.valueGrowthPct > sin.hold.valueGrowthPct - 0.5, 'sinusoid: recommended X does not lose to holding');

  // --- pure downtrend: basket-positive but value-negative -> warning path ---
  const downBars = mkBars(400, (i) => 100 * Math.pow(0.998, i));
  const down = bt.sweep(ASSETS, downBars, { feePct: 0.3, spreadPct: 0.1 });
  ok(down.recommendation == null, 'downtrend: no recommendation when basket and value diverge');
  ok(
    down.warnings.some((w) => /underperforms simply holding|diverge/i.test(w)),
    'downtrend: divergence/underperforms-hold warning rendered'
  );
  const bestBasketRow = down.grid.reduce((a, b) => (b.netBasketGrowthPct > a.netBasketGrowthPct ? b : a));
  ok(bestBasketRow.netBasketGrowthPct > 0, 'downtrend: buying weakness DOES grow units (the trap)');
  const tight = down.grid.find((r) => r.x === 1);
  const loose = down.grid.find((r) => r.x === 30);
  ok(tight.valueGrowthPct < loose.valueGrowthPct, 'downtrend: tighter trading bleeds more value');
  ok(down.grid.every((r) => r.valueGrowthPct < down.hold.valueGrowthPct), 'downtrend: every X loses to holding');

  // --- higher cost -> looser optimum ---
  const cheap = bt.sweep(ASSETS, sinBars, { feePct: 0, spreadPct: 0 });
  const dear = bt.sweep(ASSETS, sinBars, { feePct: 2, spreadPct: 0.5 });
  ok(cheap.recommendation != null && dear.recommendation != null, 'both cost levels still recommend on a sinusoid');
  ok(dear.recommendation.x >= cheap.recommendation.x, `higher cost loosens the optimum (${cheap.recommendation.x}% -> ${dear.recommendation.x}%)`);

  // --- simulator trades == production trades (shared breach math) ---
  // Two flat bars then a +20% move: the sim signals at bar 1; the production
  // engine, fed the same state and prices, must emit the same trade.
  const parityBars = [
    { ts: t0, usd: { tether: 1, bitcoin: 100 } },
    { ts: t0 + DAY, usd: { tether: 1, bitcoin: 120 } },
  ];
  const simRun = bt.simulate(ASSETS, 10, { feePct: 0.4, spreadPct: 0.1, lagHours: 6, bars: parityBars });
  ok(simRun.signals.length === 1, 'parity: one trade set signalled');
  const sig = simRun.signals[0].trades[0];
  ok(sig.side === 'SELL' && sig.symbol === 'btc', 'parity: overweight big-mover -> SELL');

  db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('P', 10, 15, 0)").run();
  const add = db.prepare(
    'INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index, basket_units) VALUES (1, ?, ?, ?, ?, ?, ?)'
  );
  // Same pre-trade state the sim had at bar 1: started at target weights on
  // bar 0 (usdt 500, btc 500/100 = 5).
  add.run('tether', 'usdt', 500, 50, 1, 500);
  add.run('bitcoin', 'btc', 5, 50, 0, 5);
  PRICES = { tether: 1, bitcoin: 120 };
  const profile = db.prepare('SELECT * FROM profiles WHERE id = 1').get();
  const evalResult = bal.evaluateProfile(profile, PRICES, t0 + DAY);
  ok(evalResult.breaches.length === 1, 'parity: production engine breaches on the same bar');
  const b = evalResult.breaches[0];
  ok(b.action === 'SELL' && b.asset.symbol === 'btc', 'parity: same action, same asset');
  ok(approx(b.quantity, sig.qty, 1e-9), `parity: same trade quantity (${b.quantity} == ${sig.qty})`);

  // --- recent-window tabulation: half/quarter slices of the SAME bars, each
  // with a full X grid + hold, so per-window behaviour is inspectable ---
  const rec = bt.recentWindows(ASSETS, sinBars, { feePct: 0.3, spreadPct: 0.1, lagHours: 6 });
  ok(rec.half && rec.quarter, 'half and quarter windows tabulated');
  ok(rec.half.bars === Math.ceil(sinBars.length / 2) || Math.abs(rec.half.bars - sinBars.length / 2) <= 1, `half window is half the bars (${rec.half.bars}/${sinBars.length})`);
  ok(Math.abs(rec.quarter.bars - sinBars.length / 4) <= 1, `quarter window is a quarter of the bars (${rec.quarter.bars})`);
  ok(rec.half.to === sinBars[sinBars.length - 1].ts && rec.quarter.to === sinBars[sinBars.length - 1].ts, 'both recent windows end at the MOST RECENT bar');
  ok(rec.quarter.from > rec.half.from, 'quarter starts later than half (nested recency)');
  ok(rec.half.grid.length === bt.X_GRID.length && rec.half.grid.every((g) => Number.isFinite(g.valueGrowthPct)), 'half window carries the full X grid');
  ok(Number.isFinite(rec.half.hold.valueGrowthPct) && Number.isFinite(rec.quarter.hold.valueGrowthPct), 'each recent window carries its own hold baseline');

  // --- staleness hash: targets in, quantities out ---
  const h1 = bt.computeTargetsHash(ASSETS);
  const h2 = bt.computeTargetsHash(ASSETS.map((a) => ({ ...a, target_pct: a.is_index ? 40 : 60 })));
  const h3 = bt.computeTargetsHash(ASSETS.map((a) => ({ ...a, quantity: 999 })));
  ok(h1 !== h2, 'hash changes when targets change');
  ok(h1 === h3, 'hash ignores quantities (sim starts at target weights)');

  console.log('backtest sweep tests pass');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
