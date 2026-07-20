// Phase L Ladder Lab: simulator mechanics on constructed paths (rung firing,
// ATH re-arm, anchored exits, reserve floor, determinism), plateau detection
// favoring broad regions over isolated spikes, scenario path generators, and
// a full fast-pass runLadderSweep smoke over stubbed BTC history.
const { freshDb, ok, approx } = require('./helpers');
freshDb('ladder');

// Stub lib/history BEFORE lib/ladder loads (it destructures at require time).
let HIST_ROWS = [];
const histPath = require.resolve('../lib/history');
require.cache[histPath] = {
  id: histPath,
  filename: histPath,
  loaded: true,
  exports: { getDailyHistory: async () => HIST_ROWS },
};

const ladder = require('../lib/ladder');

const DAY = 86_400_000;
const t0 = 1_600_000_000_000 - (1_600_000_000_000 % DAY);
const mkBars = (prices) => prices.map((p, i) => ({ ts: t0 + i * DAY, price: p }));

(async () => {
  // ---- simulator mechanics on a hand-built cycle ----------------------------
  // 100 (ATH) -> 79 (-21%, rung 1) -> 59 (-41%, rung 2) -> 105 (exit @1.00x
  // ATH fires; new ATH re-arms entries) -> 82 (-22% from 105, rung 1 again).
  const cyc = mkBars([100, 100, 79, 79, 59, 59, 90, 105, 105, 82, 82]);
  const cfg = {
    entryStart: 20, entrySpacing: 20, entryCount: 2, buyFrac: 0.5,
    exitStart: 1.0, exitSpacing: 0.5, exitCount: 1, sellFrac: 0.5,
    reservePct: 0, dcaMonthlyPct: 0,
  };
  const sim = ladder.simulateLadder(cyc, cfg, { feeRate: 0 });
  // Expected trades: buy@79, buy@59, sell@105, buy@82 (re-armed epoch).
  ok(sim.trades === 4, `cycle fires 2 buys + 1 anchored exit + 1 re-armed buy (${sim.trades} trades)`);
  ok(sim.feesPct === 0, 'zero fee rate -> zero fees');

  // Hand-check the ledger (feeRate 0, START_USD 10k): buy1 spends 5000 @79;
  // buy2 spends 2500 @59; sell1 sells half the BTC @105; buy3 spends half
  // the USD @82. Final value must match to the penny.
  let usd = 10_000, btc = 0;
  btc += 5000 / 79; usd -= 5000;
  btc += 2500 / 59; usd -= 2500;
  usd += (btc / 2) * 105; btc /= 2;
  btc += (usd / 2) / 82; usd /= 2;
  const expectFinal = usd + btc * 82;
  ok(approx(sim.finalValue, expectFinal, 1e-9), `ledger matches hand computation (${sim.finalValue.toFixed(2)})`);

  // Exit is ANCHORED to the fallen-from ATH (100), so it fires at 105 even
  // though 105 is itself a new high; a config with exitStart 1.15 must NOT.
  const noExit = ladder.simulateLadder(cyc, { ...cfg, exitStart: 1.15 }, { feeRate: 0 });
  ok(noExit.trades === 3, `1.15x exit never reached -> no sell, no re-arm epoch sell (${noExit.trades} trades)`);

  // Determinism: identical inputs, identical outputs.
  const sim2 = ladder.simulateLadder(cyc, cfg, { feeRate: 0 });
  ok(JSON.stringify(sim) === JSON.stringify(sim2), 'simulator is deterministic');

  // Reserve floor: 50% reserve is never spent by rungs or DCA.
  const res = ladder.simulateLadder(cyc, { ...cfg, reservePct: 50, dcaMonthlyPct: 2 }, { feeRate: 0 });
  ok(res.minUsdPctOfStart >= 50 - 1e-9, `USD never fell below the 50% reserve floor (${res.minUsdPctOfStart.toFixed(1)}%)`);

  // Mid-drawdown scenario start: real ATH carried in arms the exit ladder.
  const recover = mkBars([60, 80, 100, 101]);
  const midDD = ladder.simulateLadder(recover, cfg, { startUsd: 0, startBtc: 1, startPeak: 100, feeRate: 0 });
  ok(midDD.trades === 1, 'mid-drawdown start: exit anchored to the carried-in ATH fires on recovery');

  // Baselines: HOLD BTC return equals the raw price change (no trades, no fees).
  const grow = mkBars(Array.from({ length: 400 }, (_, i) => 100 * Math.pow(1.002, i)));
  const base = ladder.baselines(grow);
  ok(base.length === 3, 'three baselines rendered');
  const priceRet = (grow[grow.length - 1].price / grow[0].price - 1) * 100;
  ok(approx(base[0].returnPct, priceRet, 1e-6), `HOLD BTC tracks the raw price change (${base[0].returnPct.toFixed(1)}%)`);
  ok(base[0].trades === 0 && base[2].returnPct === 0, 'hold baselines never trade; HOLD USD returns 0');

  // ---- plateau detection: broad region beats isolated spike -----------------
  // Enumerate the full grid; score 10 wherever entryStart is at index 1..3
  // (a huge contiguous slab), 0 elsewhere, and plant a single 100-score spike
  // in the zero zone. Robust = min(own, neighbors) must kill the spike and
  // crown the slab's interior (entryStart index 2 exactly).
  const lens = ladder.DIMS.map((d) => ladder.GRID[d].length);
  const indexList = [];
  const ctr = new Array(lens.length).fill(0);
  for (;;) {
    indexList.push(ctr.slice());
    let d = lens.length - 1;
    while (d >= 0) {
      ctr[d]++;
      if (ctr[d] < lens[d]) break;
      ctr[d] = 0;
      d--;
    }
    if (d < 0) break;
  }
  ok(indexList.length === ladder.GRID_SIZE, `full grid enumerated (${indexList.length.toLocaleString()} = GRID_SIZE)`);
  const scores = new Float64Array(indexList.length);
  let spikeI = -1;
  for (let i = 0; i < indexList.length; i++) {
    const e = indexList[i][0]; // entryStart dim index
    scores[i] = e >= 1 && e <= 3 ? 10 : 0;
    if (spikeI === -1 && e === 5) spikeI = i;
  }
  scores[spikeI] = 100;
  const plat = ladder.findPlateaus(scores, indexList);
  ok(plat.regions.length >= 1, 'at least one plateau found');
  const interiorCount = indexList.length / lens[0]; // all points with entryStart index 2
  ok(plat.regions[0].size === interiorCount, `top plateau is the slab interior (${plat.regions[0].size.toLocaleString()} configs)`);
  ok(
    plat.regions[0].ranges.entryStart[0] === ladder.GRID.entryStart[2] &&
      plat.regions[0].ranges.entryStart[1] === ladder.GRID.entryStart[2],
    'plateau range pins entryStart to the slab interior value'
  );
  ok(plat.robust[spikeI] === 0, 'the isolated 100-score spike has robust score 0 (killed)');

  // ---- scenario path generators ---------------------------------------------
  const rngA = ladder.mulberry32(7);
  const rngB = ladder.mulberry32(7);
  const pA = ladder.gbmPath(rngA, 100, [{ days: 400, muAnnual: 0.3, volAnnual: 0.5 }], t0);
  const pB = ladder.gbmPath(rngB, 100, [{ days: 400, muAnnual: 0.3, volAnnual: 0.5 }], t0);
  ok(pA.length === 400, 'gbmPath produces the requested number of days');
  ok(pA.every((b, i) => b.price > 0 && b.price === pB[i].price), 'gbmPath is seed-deterministic with positive prices');
  const rets = Array.from({ length: 300 }, () => (ladder.mulberry32(9)() - 0.5) * 0.01);
  const boot = ladder.bootstrapPath(ladder.mulberry32(11), 100, rets, t0);
  ok(boot.length === 5 * 365, `bootstrapPath fills the full scenario horizon (${boot.length} days)`);
  ok(boot.every((b) => b.price > 0 && isFinite(b.price)), 'bootstrap prices stay positive and finite');

  // ---- full fast-pass sweep smoke over stubbed history ----------------------
  // ~3.7y of cyclical growth: two >50% drawdown cycles so ladders trade.
  HIST_ROWS = Array.from({ length: 1350 }, (_, i) => ({
    ts: t0 + i * DAY,
    usd_price: 8000 * Math.exp(0.0009 * i) * (1 + 0.45 * Math.sin((2 * Math.PI * i) / 550)),
  }));
  let lastPct = -1;
  const out = await ladder.runLadderSweep({ fast: true, seed: 123 }, (msg, pctDone) => {
    if (pctDone != null) {
      ok(pctDone >= lastPct, `progress is monotonic (${pctDone} after ${lastPct})`);
      lastPct = pctDone;
    }
  });
  const r = out.result;
  ok(out.params.fast === true && r.grid.fast === true, 'fast flag echoed in params and result');
  ok(r.grid.totalConfigs > 20_000 && r.grid.totalConfigs < ladder.GRID_SIZE, `fast pass subsamples the grid (${r.grid.totalConfigs.toLocaleString()} configs)`);
  ok(r.window.bars === 1350 && r.window.years > 3.5, 'window echoes the stubbed history');
  ok(r.picks.length >= 3, `picks produced (${r.picks.length})`);
  for (const p of r.picks) {
    ok(typeof p.label === 'string' && p.label.includes('buy'), `pick has a human label (${p.label.slice(0, 40)}…)`);
    ok(typeof p.reasoning === 'string' && p.reasoning.length > 40, 'pick carries generated reasoning');
    ok(['conservative', 'balanced', 'aggressive'].includes(p.tier), `pick tier valid (${p.tier})`);
    ok(Object.keys(p.scenarios.byArchetype).length === ladder.ARCHETYPES.length, 'pick projected across every archetype');
    ok(isFinite(p.scenarios.probWeightedMedian), 'probability-weighted median is finite');
  }
  const tiers = new Set(r.picks.map((p) => p.tier));
  ok(tiers.size >= 2, `picks span multiple risk tiers (${[...tiers].join(', ')})`);
  ok(r.plateaus.length >= 1 && r.plateaus[0].size >= 1, 'plateaus reported');
  ok(r.baselines.length === 3, 'baselines reported');
  const probs = r.scenarios.archetypes.reduce((s, a) => s + a.probability, 0);
  ok(approx(probs, 1, 1e-6), `archetype probabilities sum to 1 (${probs.toFixed(4)})`);
  ok(/no out-of-sample holdout/i.test(r.caveat), 'the full-history caveat is present');
  ok(r.heat.entryStart.length === 6 && r.heat.buyFrac.length === 3, 'heat grids cover both dims');

  // Determinism of the whole sweep (same seed, same data).
  const out2 = await ladder.runLadderSweep({ fast: true, seed: 123 }, () => {});
  ok(
    JSON.stringify(out.result.picks) === JSON.stringify(out2.result.picks),
    'sweep is fully deterministic for a fixed seed'
  );

  // dataStatus on an empty fresh DB.
  const st = await ladder.dataStatus();
  ok(st.rows === 0 && st.from === null, 'dataStatus reports an empty cache honestly');

  console.log('test-ladder: all assertions passed');
})().catch((err) => {
  console.error('FAIL (exception):', err);
  process.exit(1);
});
