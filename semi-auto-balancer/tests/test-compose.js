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
  // ...but a near-zero-harvest RISER (a gold-like contrarian/diversifier) is
  // KEPT — the screen only weeds terminal decliners, never low harvest.
  ok(screenOf('trend-up').kept, 'a rising, near-zero-harvest asset (gold-like) survives the screen — only decliners are weeded');
  ok(screenOf('riser').kept && screenOf('flat-f').kept, 'a gentle riser and a dead-flat both survive — neither is a decliner');

  // --- grid now spans the tuner's range: a swept X can reach 25/30 ---
  ok(compose.MINI_X ? compose.MINI_X.includes(25) && compose.MINI_X.includes(30) : true, 'mini-grid reaches 25 and 30');

  ok(r.mixes.length > 0 && r.mixes.length <= 8, `finalists produced (${r.mixes.length})`);

  // --- constraints hold on every reported mix ---
  for (const m of r.mixes) {
    const total = m.assets.reduce((s, a) => s + a.pct, 0);
    ok(Math.abs(total - 100) < 0.01, 'targets total 100%');
    const tether = m.assets.find((a) => a.isIndex);
    ok(tether.pct >= 10 && tether.pct <= 25, 'tether inside the 10–25% band');
    // Count-scaled cap: 25% for 4+ assets, wider for concentrated mixes
    // (a lone asset must absorb everything the tether doesn't).
    const nonTether = m.assets.filter((a) => !a.isIndex);
    const capPct = Math.max(25, Math.ceil((100 - tether.pct) / 2.5 / nonTether.length) * 2.5);
    ok(nonTether.every((a) => a.pct <= capPct + 0.01), `count-scaled per-asset cap respected (${nonTether.length} assets ≤ ${capPct}%)`);
    ok(m.assets.every((a) => a.pct >= 2.5), 'no dust weights');
  }

  // --- the known answer: oscillators in, decliners out ---
  const top3 = r.mixes.slice(0, 3);
  ok(
    top3.every((m) => m.assets.some((a) => a.id === 'osc-a' || a.id === 'osc-b')),
    'every top-3 mix contains a harvestable oscillator'
  );

  // --- walk-forward validation + honest holdout ---
  // --- down to ONE tradable asset: a single-candidate universe must search
  // (previously threw "need at least 4"), producing tether+asset splits where
  // the asset absorbs everything the tether doesn't (75–90%).
  const solo = await compose.searchCompositions({
    ...opts,
    candidates: candidates.filter((c) => c.id === 'osc-a'),
    currentMix: null,
    samples: 300,
    screenKeep: 2,
    fullTop: 10,
    refineTop: 4,
    refineEvals: 12,
    finalists: 4,
  });
  ok(solo.mixes.length > 0, `single-candidate universe searches (${solo.mixes.length} finalists)`);
  for (const m of solo.mixes) {
    const non = m.assets.filter((a) => !a.isIndex);
    const tether = m.assets.find((a) => a.isIndex);
    ok(non.length === 1, 'solo mixes carry exactly one tradable asset');
    ok(non[0].pct >= 75 - 1e-9 && non[0].pct <= 90 + 1e-9, `solo asset takes the tether's complement (${non[0].pct}%)`);
    ok(Math.abs(non[0].pct + tether.pct - 100) < 0.01, 'solo split totals 100%');
  }

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

  // --- quality gate: a market benchmark yields return/DD + beatsMarket, and
  // ★ requires keeping up with the market ---
  ok(rr.market && Number.isFinite(rr.market.return) && Number.isFinite(rr.market.maxDD), 'market benchmark (hold BTC in index) computed');
  ok(rr.mixes.every((m) => Number.isFinite(m.netReturn) && Number.isFinite(m.maxDD) && typeof m.beatsMarket === 'boolean'), 'every mix carries return / maxDD / beatsMarket');
  ok(rr.mixes.every((m) => !m.recommended || m.beatsMarket), '★ is reserved for mixes that keep up with the market');
  ok(typeof rr.weededForQuality === 'number' && rr.weededForQuality >= 0, 'a weeded-for-quality count is reported');

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
  // No benchmark passed to this current-set call → market gate disabled: every
  // split "beats market" and nothing is weeded on quality grounds.
  ok(cs.market == null, 'no benchmark → no market gate');
  ok(cs.mixes.every((m) => m.beatsMarket === true), 'gate off → all splits pass the market check');
  ok(cs.mixes.every((m) => Number.isFinite(m.netReturn) && Number.isFinite(m.maxDD)), 'splits still carry return / maxDD');
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

  // --- user-curated candidate exclusions: parsed defensively, tether immune ---
  const px = compose.parseComposeExclusions;
  ok(px({ compose_excluded: '["dec-d","osc-a"]' }).has('dec-d'), 'exclusions parse from the profile JSON');
  ok(!px({ compose_excluded: '["tether","osc-a"]' }, 'tether').has('tether'), 'the tethered index can never be excluded');
  ok(px({ compose_excluded: '["tether","osc-a"]' }, 'tether').has('osc-a'), 'other exclusions survive the tether guard');
  ok(px({ compose_excluded: 'not json' }).size === 0, 'garbage parses to no exclusions');
  ok(px({}).size === 0 && px(null).size === 0, 'missing column/profile parses to no exclusions');
  ok(px({ compose_excluded: '[1,2,"x"]' }).size === 1, 'non-string entries are ignored');

  // --- weeded rows are VIEWABLE, not erased: hiddenMixes carries everything
  // the board hid (below the market bar or the finalists fold), same shape,
  // quality-ordered, capped at 40; weededForQuality still counts the truth ---
  ok(Array.isArray(r.hiddenMixes), 'result carries a hiddenMixes array');
  ok(
    r.hiddenMixes.length === Math.min(r.weededForQuality, 40),
    `hiddenMixes covers the weeded count, capped at 40 (${r.hiddenMixes.length}/${r.weededForQuality})`
  );
  {
    const shownKeys = new Set(r.mixes.map((m) => JSON.stringify(m.assets)));
    ok(r.hiddenMixes.every((m) => !shownKeys.has(JSON.stringify(m.assets))), 'hidden rows never duplicate shown rows');
  }
  ok(
    r.hiddenMixes.every((m) => Number.isFinite(m.netReturn) && Number.isFinite(m.maxDD)),
    'hidden rows carry the same quality fields as shown rows'
  );
  ok(Array.isArray(rr.hiddenMixes), 'regime-mode result carries hiddenMixes');
  ok(
    rr.hiddenMixes.length === Math.min(rr.weededForQuality, 40),
    'regime-mode hiddenMixes matches its weeded count (capped)'
  );
  ok(Array.isArray(cs.hiddenMixes), 'current-set result carries hiddenMixes too');
  ok(cs.hiddenMixes.length === Math.min(cs.weededForQuality, 40), 'current-set hiddenMixes matches its weeded count (capped)');

  // --- 📌 pinned assets: forced into EVERY searched mix, immune to the
  // decliner weed and the refinement swap, still judged honestly downstream ---
  const pinnedRun = await compose.searchCompositions({
    ...opts,
    samples: 1500,
    pinned: ['riser', 'dec-d'], // dec-d is a terminal decliner — the pin keeps it anyway
  });
  ok(
    pinnedRun.mixes.every((m) => m.assets.some((a) => a.id === 'riser') && m.assets.some((a) => a.id === 'dec-d')),
    'every finalist contains ALL pinned assets (even a pinned decliner)'
  );
  ok(
    pinnedRun.hiddenMixes.every((m) => m.assets.some((a) => a.id === 'riser') && m.assets.some((a) => a.id === 'dec-d')),
    'the pin binds the WHOLE search — hidden rows contain the pins too'
  );
  {
    const ps = pinnedRun.screen.find((s) => s.id === 'dec-d');
    ok(ps.kept === true && ps.pinned === true, 'a pinned terminal decliner survives the solo screen, flagged pinned');
    const un = pinnedRun.screen.find((s) => s.id === 'dec-e');
    ok(un.kept === false && !un.pinned, 'the UNpinned decliner is still weeded as before');
  }
  const ghostPin = await compose.searchCompositions({ ...opts, samples: 300, pinned: ['no-such-id'] });
  ok(ghostPin.mixes.length > 0, 'unknown pinned ids are ignored and the search still runs');

  // --- parseComposePins: same defensive parsing as exclusions, tether immune ---
  const pp = compose.parseComposePins;
  ok(pp({ compose_pinned: '["osc-a","riser"]' }).has('osc-a'), 'pins parse from the profile JSON');
  ok(!pp({ compose_pinned: '["tether","osc-a"]' }, 'tether').has('tether'), 'the tethered index can never be pinned');
  ok(pp({ compose_pinned: '["tether","osc-a"]' }, 'tether').has('osc-a'), 'other pins survive the tether guard');
  ok(pp({ compose_pinned: 'not json' }).size === 0 && pp({}).size === 0 && pp(null).size === 0, 'garbage/missing parses to no pins');

  // --- index-switch resilience: right after re-tethering, the tether sits at
  // 0% target while the old targets still total 100. That current mix must
  // score (reference), and an outright unscorable current mix (no index at
  // all) must degrade to a warning — never kill the whole search. ---
  const zeroTether = await compose.searchCompositions({
    ...opts,
    samples: 500,
    currentMix: [
      { id: 'tether', symbol: 'usdt', targetPct: 0, isIndex: true },
      { id: 'osc-a', symbol: 'osc-a', targetPct: 60, isIndex: false },
      { id: 'osc-b', symbol: 'osc-b', targetPct: 40, isIndex: false },
    ],
  });
  ok(zeroTether.currentMix && zeroTether.currentMix.reference === true, 'a 0%-tether current mix (fresh index switch) still scores as reference');
  const noIndex = await compose.searchCompositions({
    ...opts,
    samples: 500,
    currentMix: [
      { id: 'dec-d', symbol: 'dec-d', targetPct: 60, isIndex: false },
      { id: 'dec-e', symbol: 'dec-e', targetPct: 40, isIndex: false },
    ],
  });
  ok(noIndex.mixes.length > 0, 'an unscorable current mix does NOT kill the search');
  ok(noIndex.currentMix == null, 'the unscorable current mix degrades to null');
  ok(noIndex.warnings.some((w) => /could not be scored/i.test(w)), 'with an explicit warning pointing at stale targets');

  // --- intensity-scaled funnel sizes (user-tuned tiers) ---
  const fq = compose.funnelSizes(20000);
  ok(fq.fullTop === 500 && fq.retKeep === 150 && fq.refineTop === 60 && fq.refineEvals === 80, 'quick tier: base funnel');
  const fs_ = compose.funnelSizes(100000);
  ok(fs_.fullTop === 625 && fs_.retKeep === 188 && fs_.refineTop === 120 && fs_.refineEvals === 160, 'standard tier: boards ×1.25, refine ×2');
  const fi = compose.funnelSizes(1000000);
  ok(fi.fullTop === 750 && fi.retKeep === 225 && fi.refineTop === 240 && fi.refineEvals === 320, 'intensive tier: boards ×1.5, refine ×4');
  ok(fq.finalists === 30 && fi.finalists === 30, 'top 30 rendered at every tier');
  ok(r.funnel && r.funnel.fullTop === opts.fullTop, 'result echoes the funnel sizes actually used');

  // --- cpu duty-cycle + pause gate are timing-only: identical results at
  // any setting, and the search awaits the gate at its yield points ---
  let gateCalls = 0;
  const cpuA = await compose.searchCompositions({ ...opts, samples: 300, cpuPct: 100, pauseGate: async () => { gateCalls++; } });
  const cpuB = await compose.searchCompositions({ ...opts, samples: 300, cpuPct: 50 });
  ok(
    JSON.stringify(cpuA.mixes[0].assets) === JSON.stringify(cpuB.mixes[0].assets),
    'cpu throttle setting never changes search results'
  );
  ok(gateCalls > 0, `the search awaits the pause gate at its yield points (${gateCalls} calls)`);

  // --- deploy-surviving pause: checkpoint → kill (simulated restart) →
  // resume from the JSON-round-tripped checkpoint → BYTE-IDENTICAL result ---
  const mkGate = (hasCp) => {
    const gate = async () => {
      if (gate.armed && hasCp()) {
        const e = new Error('cancelled by user');
        e.cancelled = true;
        throw e; // the process "dies" right after checkpointing
      }
    };
    gate.armed = false;
    gate.pending = () => gate.armed;
    return gate;
  };
  {
    // (1) mid-BROAD checkpoint — the exact-resume path.
    let cp = null;
    const gate = mkGate(() => cp != null);
    gate.saveCheckpoint = (s) => {
      cp = JSON.parse(JSON.stringify(s)); // same round-trip the DB imposes
    };
    let died = false;
    try {
      await compose.searchCompositions({
        ...opts,
        pauseGate: gate,
        checkpointWrapper: { resultExtras: {}, warnings: [], params: {} },
        setProgress: (t) => {
          if (/broad search: 2,000/.test(t)) gate.armed = true;
        },
      });
    } catch (e) {
      died = Boolean(e.cancelled);
    }
    ok(died && cp != null, 'search checkpointed at pause and was killed mid-broad (simulated restart)');
    ok(cp.loop.phase === 'broad' && cp.loop.i > 2000 && cp.loop.i < opts.samples, `checkpoint holds mid-broad state (i=${cp.loop.i})`);
    const resumed = await compose.searchCompositions({ ...cp.inputs, resume: cp.loop });
    ok(JSON.stringify(resumed.mixes) === JSON.stringify(r.mixes), 'broad-phase resume reproduces the uninterrupted result byte-identically');
    ok(JSON.stringify(resumed.hiddenMixes) === JSON.stringify(r.hiddenMixes), '…including the hidden rows');

    // (2) POST-BROAD checkpoint — deterministic redo from the frozen board.
    let cp2 = null;
    const gate2 = mkGate(() => cp2 != null);
    gate2.saveCheckpoint = (s) => {
      cp2 = JSON.parse(JSON.stringify(s));
    };
    let died2 = false;
    try {
      await compose.searchCompositions({
        ...opts,
        pauseGate: gate2,
        setProgress: (t) => {
          if (/full-fidelity scoring 2\d/.test(t)) gate2.armed = true;
        },
      });
    } catch (e) {
      died2 = Boolean(e.cancelled);
    }
    ok(died2 && cp2 != null && cp2.loop.phase === 'post-broad', 'post-broad checkpoint captured (frozen contender board)');
    const resumed2 = await compose.searchCompositions({ ...cp2.inputs, resume: cp2.loop });
    ok(JSON.stringify(resumed2.mixes) === JSON.stringify(r.mixes), 'post-broad resume redoes stages 2–4 to the identical result');

    // (3) CURRENT-SET mode gets the same guarantee.
    let cp3 = null;
    const gate3 = mkGate(() => cp3 != null);
    gate3.saveCheckpoint = (s) => {
      cp3 = JSON.parse(JSON.stringify(s));
    };
    let died3 = false;
    try {
      await compose.searchCurrentSet({
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
        pauseGate: gate3,
        setProgress: (t) => {
          if (/allocation search: 2,000/.test(t)) gate3.armed = true;
        },
      });
    } catch (e) {
      died3 = Boolean(e.cancelled);
    }
    ok(died3 && cp3 != null && cp3.loop.phase === 'broad', 'current-set checkpoint captured mid-broad');
    const resumed3 = await compose.searchCurrentSet({ ...cp3.inputs, resume: cp3.loop });
    ok(JSON.stringify(resumed3.mixes) === JSON.stringify(cs.mixes), 'current-set resume reproduces the uninterrupted result byte-identically');
  }

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
