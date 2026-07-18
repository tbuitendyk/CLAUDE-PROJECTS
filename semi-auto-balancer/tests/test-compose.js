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
  // Pure monotonic trend: huge absolute appreciation, ZERO harvestable
  // oscillation — the selection-metric trap (rewarded under absolute value,
  // near-zero under harvest edge).
  ['trend-up', series((i) => 5 * Math.pow(1.004, i))],
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
    samples: 4000,
    screenKeep: 4,
    fullTop: 60,
    refineTop: 15,
    refineEvals: 30,
    finalists: 8,
    seed: 1234,
  };
  const r = await compose.searchCompositions(opts);

  // --- solo screen: verdicts shipped, decliners weeded out ENTIRELY ---
  ok(r.screen.length === candidates.length, 'every candidate carries a solo-screen verdict');
  const screenOf = (id) => r.screen.find((s) => s.id === id);
  ok(!screenOf('dec-d').kept && !screenOf('dec-e').kept, 'terminal decliners weeded out at the solo screen');
  // Phase matters at window edges (min-of-halves punishes ending on the
  // trough), so at least one of the phase-shifted oscillators must pass —
  // not necessarily both.
  ok(screenOf('osc-a').kept || screenOf('osc-b').kept, 'a harvestable oscillator passes the solo screen');
  ok(screenOf('chop-g').kept, 'the fast chopper passes the solo screen');
  ok(
    r.mixes.every((m) => m.assets.every((a) => a.id !== 'dec-d' && a.id !== 'dec-e')),
    'weeded assets appear in NO finalist mix at all'
  );
  ok(r.combos.broadSampled > 3000 && r.combos.contenders > 0, 'broad pass ran at scale and kept a contender board');

  // --- selection metric = harvest EDGE, not appreciation: the pure trender
  // (5 -> ~55, +1000% absolute) has near-zero rebalance edge and must score
  // BELOW a genuine oscillator despite crushing it on raw return ---
  ok(
    screenOf('osc-a').soloTrain > screenOf('trend-up').soloTrain,
    `harvesting oscillator out-scores the pure trender on edge (osc ${screenOf('osc-a').soloTrain.toFixed(2)} > trend ${screenOf('trend-up').soloTrain.toFixed(2)})`
  );
  ok(screenOf('trend-up').soloTrain < 3, 'pure trend appreciation registers ~no harvest edge');

  // --- grid now spans the tuner's range: a swept X can reach 25/30 ---
  ok(compose.MINI_X ? compose.MINI_X.includes(25) && compose.MINI_X.includes(30) : true, 'mini-grid reaches 25 and 30');

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

  // --- walk-forward validation + honest holdout ---
  ok(r.window.nFolds === 4 && r.window.holdoutBars > 0, 'walk-forward folds + a real untouched holdout');
  ok(r.window.holdoutFrom > r.window.from, 'holdout is a forward tail of the window');
  ok(r.mixes.every((m) => Array.isArray(m.foldEdges) && m.foldEdges.length === 4), 'every mix carries per-fold harvest edges');
  ok(r.mixes.every((m) => m.holdout && Number.isFinite(m.holdout.value)), 'every mix carries a holdout score');
  ok(typeof r.caveat === 'string' && /hindsight|bias/i.test(r.caveat), 'hindsight caveat rides with the result');

  // --- selection = walk-forward robustness: the top mix harvested in a
  // majority of folds and is flagged recommended; a real harvester exists ---
  ok(r.mixes[0].positiveFolds >= 3, 'the top mix harvested in a majority of the walk-forward folds');
  ok(r.mixes.some((m) => m.recommended) && r.noHarvest === false, 'a genuine harvester is flagged recommended (not a no-harvest verdict)');

  // --- the current mix is scored for REFERENCE, never used as a benchmark ---
  ok(r.currentMix != null && r.currentMix.reference === true, 'current mix scored, flagged reference-only');
  ok(r.currentMix.recommended === false, 'current mix is never itself a recommendation');

  // --- no-harvest verdict fires when nothing clears the bar (decliners-only
  // universe: no mix can harvest, so the honest warning replaces a leaderboard) ---
  const deadOpts = {
    ...opts,
    // four non-harvesters (two decliners, a flat, a pure trender) — enough to
    // form mixes, none able to harvest
    candidates: candidates.filter((c) => ['dec-d', 'dec-e', 'flat-f', 'trend-up'].includes(c.id)),
  };
  const dead = await compose.searchCompositions(deadOpts);
  ok(dead.noHarvest === true, 'a universe with no harvest yields the no-harvest verdict');
  ok(dead.mixes.every((m) => !m.recommended), 'nothing is recommended when nothing harvests');
  ok(dead.warnings.some((w) => /does not reliably beat holding|capital-preservation/i.test(w)), 'no-harvest warning rendered');

  // --- REGIME mode: a benchmark with bull/bear/range swaths switches the
  // search to per-market-type evaluation ---
  const nB = bars.length;
  const benchPrice = (i) => {
    // bull 25% / bear 15% / range 60% — a long enough range so all three
    // types get a harvestable in-sample swath after the rolling-high lag.
    const bull = Math.floor(nB * 0.25), bear = Math.floor(nB * 0.15);
    if (i < bull) return 100 + (300 * i) / bull; // 100 -> 400
    if (i < bull + bear) return 400 - (280 * (i - bull)) / bear; // 400 -> 120
    return 125 + 3 * Math.sin((2 * Math.PI * (i - bull - bear)) / 90); // gentle sideways (one clean range swath)
  };
  const benchmark = bars.map((b, i) => ({ ts: b.ts, usd_price: benchPrice(i) }));
  const rr = await compose.searchCompositions({ ...opts, benchmark });
  ok(rr.mode === 'regime', 'a diverse benchmark switches the search into regime mode');
  ok(rr.regime && rr.regime.byType.bull > 0 && rr.regime.byType.bear > 0 && rr.regime.byType.range > 0, 'all three market types present in the study');
  ok(rr.mixes.every((m) => m.perType && Number.isFinite(m.consistency) && Number.isFinite(m.average)), 'every mix carries per-type edges + consistency/average');
  ok(rr.mixes.every((m) => m.typesPositive <= m.typesPresent), 'typesPositive bounded by typesPresent');
  ok(rr.mixes.some((m) => m.recommended) && rr.noHarvest === false, 'a mix harvesting in every market type is recommended');
  ok(rr.mixes[0].consistency >= 0, 'top mix has a non-negative worst-type edge (harvests even in its weakest regime)');
  ok(rr.currentMix.reference === true && rr.currentMix.recommended === false, 'current mix reference-only in regime mode too');

  // --- CURRENT-SET mode: allocation × sensitivity on a FIXED holdings set.
  // Keeps every asset present (no subsets), each 4–80% on a 1% grid, and
  // carries a per-split sensitivity sweep. ---
  const csAssetSet = [
    { id: 'tether', symbol: 'usdt', isIndex: true },
    { id: 'osc-a', symbol: 'osc-a', isIndex: false },
    { id: 'osc-b', symbol: 'osc-b', isIndex: false },
    { id: 'riser', symbol: 'riser', isIndex: false },
  ];
  const cs = await compose.searchCurrentSet({
    assetSet: csAssetSet,
    bars,
    currentMix: [
      { id: 'tether', symbol: 'usdt', targetPct: 25, isIndex: true },
      { id: 'osc-a', symbol: 'osc-a', targetPct: 25, isIndex: false },
      { id: 'osc-b', symbol: 'osc-b', targetPct: 25, isIndex: false },
      { id: 'riser', symbol: 'riser', targetPct: 25, isIndex: false },
    ],
    feePct: 0.3,
    spreadPct: 0.1,
    samples: 4000,
    refineTop: 10,
    refineEvals: 20,
    finalists: 8,
    seed: 99,
  });
  ok(cs.currentSet === true, 'current-set result flags currentSet=true');
  ok(cs.weightRules.minPct === 4 && cs.weightRules.maxPct === 80, 'weight rules report the 4–80% band');
  ok(cs.mixes.length > 0, `current-set produced finalists (${cs.mixes.length})`);
  for (const m of cs.mixes) {
    ok(m.assets.length === csAssetSet.length, 'every split keeps ALL current assets present (no subsets)');
    const total = m.assets.reduce((s, a) => s + a.pct, 0);
    ok(Math.abs(total - 100) < 0.01, 'split totals 100%');
    ok(m.assets.every((a) => a.pct >= 4 - 1e-9 && a.pct <= 80 + 1e-9), 'every weight inside 4–80%');
    ok(m.assets.some((a) => a.isIndex), 'the index asset stays in the split');
    ok(Array.isArray(m.xGrid) && m.xGrid.length === compose.MINI_X.length, 'split carries the full sensitivity sweep');
    ok(m.xGrid.every((g) => Number.isFinite(g.value) && Number.isFinite(g.edge)), 'every sweep point has value + edge');
  }
  ok(cs.currentMix && cs.currentMix.reference === true && cs.currentMix.recommended === false, 'current mix scored, reference-only');
  ok(Array.isArray(cs.currentMix.xGrid) && cs.currentMix.xGrid.length === compose.MINI_X.length, 'current mix carries its own sensitivity sweep');
  // Every asset must be able to reach the 80% ceiling: with a floor of 4% and
  // 4 assets, the max any one can hold is 100 - 3*4 = 88%, so 80% is feasible.
  const csDet = await compose.searchCurrentSet({
    assetSet: csAssetSet,
    bars,
    feePct: 0.3,
    spreadPct: 0.1,
    samples: 4000,
    refineTop: 10,
    refineEvals: 20,
    finalists: 8,
    seed: 99,
  });
  ok(
    JSON.stringify(csDet.mixes[0].assets) === JSON.stringify(cs.mixes[0].assets),
    'current-set is deterministic under a fixed seed'
  );

  // --- determinism under a fixed seed ---
  const r2 = await compose.searchCompositions(opts);
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
