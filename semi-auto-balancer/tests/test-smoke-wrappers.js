// End-to-end SMOKE test for the analysis IO wrappers — the code the API
// endpoints actually invoke: runComposeSearch (full universe / current-set /
// drops-allowed) and runTuneSweep (profile mix / hypothetical mix), across the
// idealize-tether toggle. The engine internals have their own deep tests; this
// file exists because wrapper-level wiring bugs (the nowMs TDZ crash, missing
// fields, stale-target index switches) shipped while the engine suite stayed
// green. Every combination here must COMPLETE and return a sane shape.
process.env.EXCHANGE_MARKET_DATA = 'off';
const { freshDb, ok } = require('./helpers');
freshDb('smoke-wrappers');

// ---- CoinGecko stub (installed before any module load) ----------------------
const cg = require('../lib/cg');
const DAY = 86_400_000;
const today = Math.floor(Date.now() / DAY) * DAY;
const N = 370;

// Deterministic daily series per id. bitcoin gets a bull→crash→range shape so
// the regime classifier finds diversity; risk coins get phase-shifted waves;
// stable-usd hugs $1; vol-tether oscillates hard (must REFUSE idealization).
function seriesFor(id) {
  const prices = [];
  for (let i = 0; i < N; i++) {
    const ts = today - (N - 1 - i) * DAY;
    let p;
    if (id === 'bitcoin') {
      if (i < 150) p = 100 + (200 * i) / 150;
      else if (i < 250) p = 300 - (160 * (i - 150)) / 100;
      else p = 138 + 6 * Math.sin((2 * Math.PI * (i - 250)) / 60);
    } else if (id === 'stable-usd') {
      p = 1 + 0.002 * Math.sin(i / 9);
    } else if (id === 'vol-tether') {
      p = 100 * (1 + 0.4 * Math.sin(i / 15));
    } else {
      let h = 0;
      for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 997;
      p = 10 + (h % 50) + 3 * Math.sin((2 * Math.PI * i) / (40 + (h % 40)) + h);
    }
    prices.push([ts, p]);
  }
  return { prices };
}

const MARKETS = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1 },
  { id: 'coin-a', symbol: 'aaa', name: 'Coin A', market_cap_rank: 2 },
  { id: 'coin-b', symbol: 'bbb', name: 'Coin B', market_cap_rank: 3 },
  { id: 'coin-c', symbol: 'ccc', name: 'Coin C', market_cap_rank: 4 },
  { id: 'coin-d', symbol: 'ddd', name: 'Coin D', market_cap_rank: 5 },
  { id: 'coin-e', symbol: 'eee', name: 'Coin E', market_cap_rank: 6 },
];
cg.getJson = async (path) => {
  if (path.includes('category=')) return [];
  if (path.startsWith('/coins/markets')) return MARKETS;
  if (path.startsWith('/search')) return { coins: [] };
  const m = path.match(/^\/coins\/([^/]+)\/market_chart/);
  if (m) return seriesFor(decodeURIComponent(m[1]));
  throw new Error(`unexpected CG path in smoke stub: ${path}`);
};

const db = require('../lib/db');
const { runComposeSearch } = require('../lib/compose');
const { runTuneSweep } = require('../lib/backtest');

// ---- fixture profiles -------------------------------------------------------
// Profile 1: USD-stable tether + three held risk assets (targets total 100).
db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('Smoke', 6, 15, 0)").run();
const ins = db.prepare(
  'INSERT INTO assets (profile_id, coingecko_id, symbol, quantity, target_pct, is_index) VALUES (?, ?, ?, ?, ?, ?)'
);
ins.run(1, 'stable-usd', 'usds', 1000, 20, 1);
ins.run(1, 'coin-a', 'aaa', 10, 30, 0);
ins.run(1, 'coin-b', 'bbb', 10, 30, 0);
ins.run(1, 'coin-c', 'ccc', 10, 20, 0);
// Profile 2: a VOLATILE tether — idealize must refuse.
db.prepare("INSERT INTO profiles (name, threshold_pct, poll_minutes, created_at) VALUES ('Volatile', 6, 15, 0)").run();
ins.run(2, 'vol-tether', 'vlt', 100, 20, 1);
ins.run(2, 'coin-d', 'ddd', 10, 40, 0);
ins.run(2, 'coin-e', 'eee', 10, 40, 0);

const OPTS = { days: 365, samples: 300, seed: 7 };

function sane(r, label) {
  ok(r && Array.isArray(r.mixes), `${label}: returns a mixes array (${r.mixes.length})`);
  ok(r.window && r.window.bars >= 240, `${label}: window has real depth (${r.window.bars} bars)`);
  ok(r.universe && typeof r.universe.covered === 'number', `${label}: universe accounting present`);
  ok(Array.isArray(r.warnings), `${label}: warnings array present`);
  ok(r.mode === 'regime' || r.mode === 'folds', `${label}: mode set (${r.mode})`);
}

(async () => {
  // 1) Full universe, real tether.
  let out = await runComposeSearch(1, { ...OPTS });
  sane(out.result, 'full universe');
  ok(out.result.idealTether === false, 'full universe: tether not idealized by default');

  // 2) Full universe + idealize — the exact combination that TDZ-crashed live.
  out = await runComposeSearch(1, { ...OPTS, idealTether: true });
  sane(out.result, 'full universe + idealize');
  ok(out.result.idealTether === true, 'full universe + idealize: stable tether idealized');
  ok(out.params.idealTether === true, 'params echo the applied assumption');

  // 3) Current-set (re-weight) + idealize.
  out = await runComposeSearch(1, { ...OPTS, currentSet: true, idealTether: true });
  sane(out.result, 'current-set + idealize');
  ok(out.result.currentSet === true, 'current-set flagged');
  ok(out.result.idealTether === true, 'current-set + idealize: applied');

  // 4) Drops-allowed scope.
  out = await runComposeSearch(1, { ...OPTS, heldOnly: true });
  sane(out.result, 'drops-allowed');
  ok(out.result.heldOnly === true, 'drops-allowed flagged');

  // 5) Volatile tether refuses idealization but the run completes on real data.
  out = await runComposeSearch(2, { ...OPTS, currentSet: true, idealTether: true });
  sane(out.result, 'volatile tether + idealize');
  ok(out.result.idealTether === false, 'volatile tether: idealization refused');
  ok(out.result.warnings.some((w) => /not USD-stable/i.test(w)), 'refusal surfaced as a warning');

  // 6) Tuner, profile mix (daily).
  let tune = await runTuneSweep(1, { days: 365 });
  ok(Array.isArray(tune.result.grid) && tune.result.grid.length > 10, `tuner: X grid present (${tune.result.grid.length})`);
  ok(tune.result.recent && tune.result.recent.half && tune.result.recent.quarter, 'tuner: ½/¼ recent windows present');
  ok(tune.result.stamp.hypothetical === false, 'tuner: profile sweep not hypothetical');
  ok(tune.result.stamp.indexSymbol === 'usds', 'tuner: stamp carries the index symbol');

  // 7) Tuner, hypothetical mix + idealize (the ⇢ tuner path).
  tune = await runTuneSweep(1, {
    days: 365,
    idealTether: true,
    mix: [
      { id: 'stable-usd', symbol: 'usds', targetPct: 15, isIndex: true },
      { id: 'coin-a', symbol: 'aaa', targetPct: 45, isIndex: false },
      { id: 'coin-d', symbol: 'ddd', targetPct: 40, isIndex: false }, // not held — needs its own fetch
    ],
  });
  ok(tune.result.stamp.hypothetical === true, 'tuner: lab mix flagged hypothetical');
  ok(tune.result.stamp.idealTether === true, 'tuner: idealize applied to the hypothetical sweep');
  ok(tune.result.stamp.targets.join(',').includes('DDD:40'), 'tuner: stamp lists the hypothetical targets');
  ok(Array.isArray(tune.result.grid) && tune.result.grid.length > 10, 'tuner: hypothetical sweep produced the grid');

  console.log('wrapper smoke tests pass');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
