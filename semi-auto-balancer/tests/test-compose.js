// Phase 2.75 composition search: on a synthetic universe with a known
// answer — harvestable oscillators + one trender vs terminal decliners and
// dead flats — the search must surface the oscillators, exile the
// decliners, respect every weight constraint, score the current mix as a
// baseline, and reproduce exactly under a fixed seed.
process.env.EXCHANGE_MARKET_DATA = 'off';
const { freshDb, ok, approx } = require('./helpers');
freshDb('compose');

const compose = require('../lib/compose');

const DAY = 86_400_000;
const t0 = 1_700_000_000_000 - (1_700_000_000_000 % DAY);
const N = 600;

function series(priceFn) {
  return Array.from({ length: N }, (_, i) => ({ ts: t0 + i * DAY, usd_price: priceFn(i) }));
}

// The universe: A/B phase-shifted sinusoids (the harvest), C gentle riser,
// D/E terminal decliners, F dead flat, G choppy-flat, H late-start (coverage
// dropout).
const seriesById = new Map([
  ['tether', series(() => 1)],
  ['osc-a', series((i) => 100 * (1 + 0.3 * Math.sin((2 * Math.PI * i) / 80)))],
  ['osc-b', series((i) => 50 * (1 + 0.3 * Math.sin((2 * Math.PI * i) / 80 + Math.PI)))],
  ['riser', series((i) => 10 * (1 + 0.001 * i + 0.1 * Math.sin((2 * Math.PI * i) / 60)))],
  ['dec-d', series((i) => 100 * Math.pow(0.9955, i))],
  ['dec-e', series((i) => 20 * Math.pow(0.995, i))],
  ['flat-f', series(() => 5)],
  ['chop-g', series((i) => 8 * (1 + 0.15 * Math.sin((2 * Math.PI * i) / 30)))],
  ['late-h', series((i) => (i < 200 ? 0 : 3)).filter((r) => r.usd_price > 0)],
]);
const IDS = [...seriesById.keys()];

(async () => {
  // --- shared timeline: coverage filter + forward-fill ---
  const { bars, covered } = compose.buildBars(seriesById, IDS);
  ok(!covered.includes('late-h'), 'late-start asset dropped for missing coverage');
  ok(covered.length === IDS.length - 1, 'everything else covers the window');
  ok(bars.length >= N - 2, `shared timeline spans the window (${bars.length} bars)`);

  const candidates = covered
    .filter((id) => id !== 'tether')
    .map((id) => ({ id, symbol: id.slice(0, 5) }));

  const opts = {
    candidates,
    tether: { id: 'tether', symbol: 'usdt' },
    bars,
    currentMix: [
      { id: 'tether', symbol: 'usdt', targetPct: 20, isIndex: true },
      { id: 'dec-d', symbol: 'dec-d', targetPct: 40, isIndex: false },
      { id: 'dec-e', symbol: 'dec-e', targetPct: 40, isIndex: false },
    ],
    feePct: 0.3,
    spreadPct: 0.1,
    samples: 600,
    refineTop: 15,
    refineEvals: 30,
    finalists: 8,
    seed: 1234,
  };
  const r = compose.searchCompositions(opts);

  ok(r.mixes.length > 0 && r.mixes.length <= 8, `finalists produced (${r.mixes.length})`);

  // --- constraints hold on every reported mix ---
  for (const m of r.mixes) {
    const total = m.assets.reduce((s, a) => s + a.pct, 0);
    ok(Math.abs(total - 100) < 0.01, 'targets total 100%');
    const tether = m.assets.find((a) => a.isIndex);
    ok(tether.pct >= 10 && tether.pct <= 25, 'tether inside the 10–25% band');
    ok(m.assets.every((a) => a.isIndex || a.pct <= 25.01), 'per-asset cap respected');
    ok(m.assets.every((a) => a.pct >= 2.5), 'no dust weights');
  }

  // --- the known answer: oscillators in, decliners out ---
  const top3 = r.mixes.slice(0, 3);
  ok(
    top3.every((m) => m.assets.some((a) => a.id === 'osc-a' || a.id === 'osc-b')),
    'every top-3 mix contains a harvestable oscillator'
  );
  const declinerWeight = (m) =>
    m.assets.filter((a) => a.id === 'dec-d' || a.id === 'dec-e').reduce((s, a) => s + a.pct, 0);
  ok(top3.every((m) => declinerWeight(m) <= 10), 'terminal decliners carry no meaningful weight in the top mixes');

  // --- out-of-sample honesty ---
  ok(r.mixes.every((m) => m.oos && Number.isFinite(m.oos.value)), 'every mix carries an OOS score');
  ok(r.window.oosBars > 0 && r.window.splitAt > r.window.from, 'OOS window is a real held-out tail');
  ok(typeof r.caveat === 'string' && /hindsight|bias/i.test(r.caveat), 'hindsight caveat rides with the result');

  // --- the current (bad) mix is scored as the baseline and loses ---
  ok(r.currentMix != null, 'current mix scored');
  ok(r.mixes[0].oos.value > r.currentMix.oos.value, 'best found mix beats the decliner-heavy current mix OOS');

  // --- determinism under a fixed seed ---
  const r2 = compose.searchCompositions(opts);
  ok(
    JSON.stringify(r2.mixes[0].assets) === JSON.stringify(r.mixes[0].assets),
    'same seed reproduces the same top mix'
  );

  // --- adaptive window: shrink only as needed, floor at 240d, drop stragglers ---
  const DAYN = 86_400_000;
  const nowMs = Date.now();
  const req = nowMs - 720 * DAYN;
  // 10 candidates: 8 deep (720d), 2 young (150d) — window stays at requested.
  let earliests = [...Array.from({ length: 8 }, () => req), nowMs - 150 * DAYN, nowMs - 150 * DAYN];
  ok(compose.chooseWindowStart(earliests, req, nowMs) === req, 'deep majority keeps the requested window');
  // 10 candidates: 3 deep, 7 at 365d — window shrinks to ~365d (keeps 70%).
  earliests = [...Array.from({ length: 3 }, () => req), ...Array.from({ length: 7 }, () => nowMs - 365 * DAYN)];
  const ws = compose.chooseWindowStart(earliests, req, nowMs);
  ok(approx((nowMs - ws) / DAYN, 365, 1e-6), 'shallow majority shrinks the window to what most can cover');
  // Everyone young: floor at 240d rather than gutting the window.
  earliests = Array.from({ length: 10 }, () => nowMs - 100 * DAYN);
  ok(approx((nowMs - compose.chooseWindowStart(earliests, req, nowMs)) / DAYN, 240, 1e-6), 'window never shrinks below 240d');

  console.log('composition search tests pass');
  process.exit(0);
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
