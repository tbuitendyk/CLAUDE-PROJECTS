const db = require('./db');
const { getDailyHistory } = require('./history');

// Ladder Lab (Phase L): a BTC/USD cycle-ladder strategy laboratory.
//
// Strategy family under test (from the user's thesis): ENTRY rungs buy on
// drawdowns from the running all-time high; EXIT rungs sell into strength at
// levels anchored to the high the price fell from; optional DCA flow; a hard
// USD reserve floor. Two assets only: USD and BTC.
//
// BY DESIGN (user's explicit call): parameters are tuned over the ENTIRE
// history — no out-of-sample holdout. The forward test is the scenario grid
// instead: every top configuration is projected across a battery of synthetic
// futures (trend, crash, moonshot, chains, historical bootstraps), with
// rough probabilities estimated from history. The full-history caveat is
// rendered with every result.
//
// Selection philosophy mirrors the tuner: prefer LARGE CONTIGUOUS PLATEAUS in
// configuration space (regions where results stay consistent as parameters
// vary) over isolated peaks — an isolated peak is one path's accident.

const DAY_MS = 86_400_000;
const FEE_RATE = 0.005; // 0.4% fee + 0.1% spread per leg, flat ad-valorem
const START_USD = 10_000;

// ---- deterministic RNG (shared convention with compose) ---------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Box-Muller normal from a uniform RNG.
function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---- the configuration grid -------------------------------------------------
// ~79k combinations (bullet 6: tens of thousands to hundreds of thousands).
const GRID = {
  entryStart: [15, 20, 25, 30, 35, 40], // first buy rung: % drawdown from ATH
  entrySpacing: [10, 15, 20], // % drawdown between successive rungs
  entryCount: [2, 3, 4],
  buyFrac: [0.2, 0.33, 0.5], // fraction of SPENDABLE usd per entry rung
  exitStart: [0.9, 1.0, 1.15], // first sell level as multiple of the fallen-from ATH
  exitSpacing: [0.25, 0.5], // multiple step between successive sell levels
  exitCount: [1, 2, 3],
  sellFrac: [0.2, 0.33, 0.5], // fraction of held BTC per exit rung
  reservePct: [0, 25, 50], // % of initial capital never spent (USD floor)
  dcaMonthlyPct: [0, 1, 2], // monthly buy of this % of initial capital
};
const DIMS = Object.keys(GRID);
const GRID_SIZE = DIMS.reduce((n, d) => n * GRID[d].length, 1);

function configAt(indices) {
  const cfg = {};
  DIMS.forEach((d, i) => {
    cfg[d] = GRID[d][indices[i]];
  });
  return cfg;
}
function describeConfig(cfg) {
  const entries = Array.from({ length: cfg.entryCount }, (_, i) => `-${cfg.entryStart + i * cfg.entrySpacing}%`).join('/');
  const exits = Array.from({ length: cfg.exitCount }, (_, j) => `${(cfg.exitStart + j * cfg.exitSpacing).toFixed(2)}×`).join('/');
  return (
    `buy ${entries} of ATH @ ${Math.round(cfg.buyFrac * 100)}% of spendable · ` +
    `sell ${exits} ATH @ ${Math.round(cfg.sellFrac * 100)}% of held · ` +
    `reserve ${cfg.reservePct}% · DCA ${cfg.dcaMonthlyPct}%/mo`
  );
}

// ---- the simulator ----------------------------------------------------------
// bars: [{ts, price}] oldest→newest. cfg: one grid point. start state may be
// overridden for scenario runs (peak carried in from real history so ladders
// start mid-drawdown exactly as reality does).
function simulateLadder(bars, cfg, { startUsd = START_USD, startBtc = 0, startPeak = null, feeRate = FEE_RATE } = {}) {
  let usd = startUsd;
  let btc = startBtc;
  const reserve = (cfg.reservePct / 100) * startUsd;
  let peak = startPeak != null ? startPeak : bars[0].price;
  let entriesFired = new Set();
  let epochHadEntry = startPeak != null && bars[0].price < startPeak; // mid-drawdown start counts as an open epoch
  let exitLevels = [];
  let exitsFired = new Set();
  // A mid-drawdown scenario start arms the exit ladder against the real ATH.
  if (epochHadEntry && startBtc > 0) {
    exitLevels = Array.from({ length: cfg.exitCount }, (_, j) => (cfg.exitStart + j * cfg.exitSpacing) * peak);
  }

  let trades = 0;
  let feesPaid = 0;
  let reserveLimited = 0;
  let minUsd = usd;
  let peakTotal = 0;
  let maxDD = 0;
  let underwater = 0;
  let maxUnderwater = 0;
  let btcShareSum = 0;
  let lastDcaMonth = -1;
  const totals = new Float64Array(bars.length);

  for (let i = 0; i < bars.length; i++) {
    const price = bars[i].price;

    // EXITS first (absolute anchored levels persist across marginal new highs).
    if (btc > 0 && exitLevels.length) {
      for (let j = 0; j < exitLevels.length; j++) {
        if (!exitsFired.has(j) && price >= exitLevels[j]) {
          const qty = btc * cfg.sellFrac;
          if (qty * price > 1) {
            const gross = qty * price;
            const fee = gross * feeRate;
            btc -= qty;
            usd += gross - fee;
            feesPaid += fee;
            trades++;
          }
          exitsFired.add(j);
        }
      }
    }

    // New all-time high: re-arm the entry ladder for the next drawdown epoch.
    if (price > peak) {
      peak = price;
      entriesFired = new Set();
      epochHadEntry = false;
    }

    // ENTRIES on drawdown rungs from the running peak.
    const ddPct = (1 - price / peak) * 100;
    for (let r = 0; r < cfg.entryCount; r++) {
      const level = cfg.entryStart + r * cfg.entrySpacing;
      if (ddPct >= level && !entriesFired.has(r)) {
        entriesFired.add(r);
        const spendable = usd - reserve;
        if (spendable <= 1) {
          reserveLimited++;
        } else {
          const spend = spendable * cfg.buyFrac;
          const fee = spend * feeRate;
          btc += (spend - fee) / price;
          usd -= spend;
          feesPaid += fee;
          trades++;
        }
        if (!epochHadEntry) {
          // First entry of this epoch: anchor the exit ladder to the high we
          // fell from. Levels are ABSOLUTE and stay armed until hit.
          epochHadEntry = true;
          exitLevels = Array.from({ length: cfg.exitCount }, (_, j) => (cfg.exitStart + j * cfg.exitSpacing) * peak);
          exitsFired = new Set();
        }
      }
    }

    // Monthly DCA (calendar months, capped by the reserve floor).
    if (cfg.dcaMonthlyPct > 0) {
      const month = Math.floor(bars[i].ts / (30 * DAY_MS));
      if (month !== lastDcaMonth) {
        lastDcaMonth = month;
        const want = (cfg.dcaMonthlyPct / 100) * startUsd;
        const spend = Math.min(want, Math.max(0, usd - reserve));
        if (spend > 1) {
          const fee = spend * feeRate;
          btc += (spend - fee) / price;
          usd -= spend;
          feesPaid += fee;
          trades++;
        }
      }
    }

    const total = usd + btc * price;
    totals[i] = total;
    if (usd < minUsd) minUsd = usd;
    if (total > peakTotal) {
      peakTotal = total;
      underwater = 0;
    } else {
      underwater++;
      if (underwater > maxUnderwater) maxUnderwater = underwater;
      if (peakTotal > 0) maxDD = Math.max(maxDD, 1 - total / peakTotal);
    }
    btcShareSum += total > 0 ? (btc * price) / total : 0;
  }

  const startTotal = startUsd + startBtc * bars[0].price;
  const final = totals[bars.length - 1];
  const years = (bars[bars.length - 1].ts - bars[0].ts) / DAY_MS / 365;
  const cagr = years > 0.2 && startTotal > 0 ? Math.pow(final / startTotal, 1 / years) - 1 : 0;
  // Daily-return volatility (annualized) for a crude risk-adjusted view.
  let sum = 0, sum2 = 0, nRet = 0;
  for (let i = 1; i < bars.length; i++) {
    if (totals[i - 1] > 0) {
      const r = Math.log(totals[i] / totals[i - 1]);
      sum += r;
      sum2 += r * r;
      nRet++;
    }
  }
  const vol = nRet > 10 ? Math.sqrt(Math.max(0, sum2 / nRet - (sum / nRet) ** 2)) * Math.sqrt(365) : 0;

  return {
    finalValue: final,
    returnPct: (final / startTotal - 1) * 100,
    cagrPct: cagr * 100,
    maxDDPct: maxDD * 100,
    mar: maxDD > 0.005 ? cagr / maxDD : cagr / 0.005,
    volPct: vol * 100,
    maxUnderwaterDays: maxUnderwater,
    minUsdPctOfStart: (minUsd / startUsd) * 100,
    btcSharePct: (btcShareSum / bars.length) * 100,
    trades,
    feesPct: (feesPaid / startTotal) * 100,
    reserveLimited,
  };
}

// Baselines rendered alongside (never "selected", pure reference).
function baselines(bars) {
  const price0 = bars[0].price;
  const last = bars[bars.length - 1].price;
  // Hold: all-in at bar 0.
  const hold = simulateLadder(bars, { entryStart: 99, entrySpacing: 1, entryCount: 1, buyFrac: 0, exitStart: 99, exitSpacing: 1, exitCount: 1, sellFrac: 0, reservePct: 0, dcaMonthlyPct: 0 }, { startUsd: 0, startBtc: START_USD / price0, startPeak: price0 });
  // Pure DCA: spread the capital evenly over the whole period, monthly.
  const months = Math.max(1, Math.round((bars[bars.length - 1].ts - bars[0].ts) / (30 * DAY_MS)));
  const dcaPct = 100 / months;
  const dca = simulateLadder(bars, { entryStart: 99, entrySpacing: 1, entryCount: 1, buyFrac: 0, exitStart: 99, exitSpacing: 1, exitCount: 1, sellFrac: 0, reservePct: 0, dcaMonthlyPct: dcaPct }, {});
  return [
    { name: 'HOLD BTC (all-in day 1)', ...hold },
    { name: `PURE DCA (${dcaPct.toFixed(2)}%/mo over the whole period)`, ...dca },
    { name: 'HOLD USD (never buy)', finalValue: START_USD, returnPct: 0, cagrPct: 0, maxDDPct: 0, mar: 0, volPct: 0, maxUnderwaterDays: 0, minUsdPctOfStart: 100, btcSharePct: 0, trades: 0, feesPct: 0, reserveLimited: 0, priceNote: `BTC ${price0.toFixed(0)} → ${last.toFixed(0)}` },
  ];
}

// ---- plateau detection ------------------------------------------------------
// Score every grid point, then favor configs whose NEIGHBORS (±1 step in any
// single dimension) also score well: robustScore = min(own, neighbors). Large
// connected regions of high robustScore are the plateaus; their best members
// are the honest picks. An isolated peak scores high alone and dies here.
function neighborsOf(indices) {
  const out = [];
  for (let d = 0; d < DIMS.length; d++) {
    const len = GRID[DIMS[d]].length;
    for (const step of [-1, 1]) {
      const j = indices[d] + step;
      if (j >= 0 && j < len) {
        const n = indices.slice();
        n[d] = j;
        out.push(n);
      }
    }
  }
  return out;
}
const keyOf = (indices) => indices.join(',');

function findPlateaus(scores, indexList, { qualifyFrac = 0.8, maxRegions = 5 } = {}) {
  const byKey = new Map(indexList.map((ix, i) => [keyOf(ix), i]));
  const robust = new Float64Array(indexList.length);
  for (let i = 0; i < indexList.length; i++) {
    let m = scores[i];
    for (const nb of neighborsOf(indexList[i])) {
      const j = byKey.get(keyOf(nb));
      if (j != null && scores[j] < m) m = scores[j];
    }
    robust[i] = m;
  }
  let best = -Infinity;
  for (let i = 0; i < robust.length; i++) if (robust[i] > best) best = robust[i];
  const threshold = best > 0 ? best * qualifyFrac : best / qualifyFrac;
  const qualifies = (i) => robust[i] >= threshold;

  // Connected components over qualifying nodes (BFS, neighbor = ±1 any dim).
  const seen = new Uint8Array(indexList.length);
  const regions = [];
  for (let i = 0; i < indexList.length; i++) {
    if (seen[i] || !qualifies(i)) continue;
    const queue = [i];
    seen[i] = 1;
    const members = [];
    while (queue.length) {
      const cur = queue.pop();
      members.push(cur);
      for (const nb of neighborsOf(indexList[cur])) {
        const j = byKey.get(keyOf(nb));
        if (j != null && !seen[j] && qualifies(j)) {
          seen[j] = 1;
          queue.push(j);
        }
      }
    }
    regions.push(members);
  }
  regions.sort((a, b) => b.length - a.length);

  return {
    robust,
    threshold,
    regions: regions.slice(0, maxRegions).map((members) => {
      // Parameter ranges spanned by the region + its best member by robust score.
      const ranges = {};
      DIMS.forEach((d, di) => {
        const vals = members.map((m) => GRID[d][indexList[m][di]]);
        ranges[d] = [Math.min(...vals), Math.max(...vals)];
      });
      let bestI = members[0];
      for (const m of members) if (robust[m] > robust[bestI]) bestI = m;
      return { size: members.length, ranges, bestIndex: bestI, members };
    }),
    totalQualifying: regions.reduce((s, r) => s + r.length, 0),
    regionCount: regions.length,
  };
}

// ---- scenario engine --------------------------------------------------------
// Synthetic 5-year daily futures for BTC/USD, several archetype families with
// stochastic variation, plus history-derived bootstraps. Each is a price path
// starting at the CURRENT price with the REAL ATH carried in, so ladders begin
// mid-drawdown exactly as reality stands.
const SCENARIO_YEARS = 5;
const SCENARIO_BARS = SCENARIO_YEARS * 365;

function gbmPath(rng, startPrice, legs, nowTs) {
  // legs: [{days, muAnnual, volAnnual}] chained.
  const path = [];
  let p = startPrice;
  let t = nowTs;
  for (const leg of legs) {
    const mu = leg.muAnnual / 365;
    const sd = leg.volAnnual / Math.sqrt(365);
    for (let i = 0; i < leg.days; i++) {
      p *= Math.exp(mu - (sd * sd) / 2 + sd * gauss(rng));
      t += DAY_MS;
      path.push({ ts: t, price: p });
    }
  }
  return path;
}

function bootstrapPath(rng, startPrice, dailyReturns, nowTs, blockDays = 90) {
  const path = [];
  let p = startPrice;
  let t = nowTs;
  while (path.length < SCENARIO_BARS) {
    const start = Math.floor(rng() * Math.max(1, dailyReturns.length - blockDays));
    for (let i = start; i < start + blockDays && path.length < SCENARIO_BARS; i++) {
      p *= Math.exp(dailyReturns[i]);
      t += DAY_MS;
      path.push({ ts: t, price: p });
    }
  }
  return path;
}

const ARCHETYPES = [
  { key: 'steady_bull', name: 'Steady bull', legs: () => [{ days: SCENARIO_BARS, muAnnual: 0.45, volAnnual: 0.55 }] },
  { key: 'moonshot_crash', name: 'Moonshot then crash', legs: () => [
      { days: 540, muAnnual: 1.6, volAnnual: 0.7 },
      { days: 365, muAnnual: -1.1, volAnnual: 0.8 },
      { days: SCENARIO_BARS - 905, muAnnual: 0.3, volAnnual: 0.55 },
    ] },
  { key: 'plummet_flat', name: 'Plummet then flat', legs: () => [
      { days: 540, muAnnual: -0.85, volAnnual: 0.65 },
      { days: SCENARIO_BARS - 540, muAnnual: 0.0, volAnnual: 0.4 },
    ] },
  { key: 'crash_recover', name: 'Crash now, then recover', legs: () => [
      { days: 180, muAnnual: -1.6, volAnnual: 0.9 },
      { days: SCENARIO_BARS - 180, muAnnual: 0.55, volAnnual: 0.6 },
    ] },
  { key: 'crab', name: 'Crab / range for years', legs: () => [{ days: SCENARIO_BARS, muAnnual: 0.0, volAnnual: 0.45 }] },
  { key: 'bull_then_bear', name: 'Bull then bear', legs: () => [
      { days: 540, muAnnual: 0.9, volAnnual: 0.6 },
      { days: 365, muAnnual: -0.9, volAnnual: 0.7 },
      { days: SCENARIO_BARS - 905, muAnnual: 0.35, volAnnual: 0.5 },
    ] },
  { key: 'double_cycle', name: 'Two full cycles', legs: () => [
      { days: 420, muAnnual: 1.1, volAnnual: 0.65 },
      { days: 300, muAnnual: -1.0, volAnnual: 0.75 },
      { days: 420, muAnnual: 1.0, volAnnual: 0.65 },
      { days: SCENARIO_BARS - 1140, muAnnual: -0.7, volAnnual: 0.7 },
    ] },
  { key: 'history_echo', name: 'History echo (block bootstrap)', bootstrap: true },
];
const PATHS_PER_ARCHETYPE = 60;

// Rough archetype probabilities: classify a large history-bootstrap ensemble
// by nearest archetype centroid in (log total return, max drawdown) space.
// Estimated from 2017→now daily history — small sample, structural change
// unquantifiable; labeled as rough estimates everywhere they render.
function estimateProbabilities(archetypeStats, ensembleStats) {
  const counts = new Map(archetypeStats.map((a) => [a.key, 0]));
  for (const e of ensembleStats) {
    let bestKey = null;
    let bestDist = Infinity;
    for (const a of archetypeStats) {
      const d = (e.logRet - a.logRet) ** 2 + ((e.maxDD - a.maxDD) * 2) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestKey = a.key;
      }
    }
    counts.set(bestKey, counts.get(bestKey) + 1);
  }
  const total = ensembleStats.length || 1;
  const out = {};
  for (const [k, c] of counts) out[k] = c / total;
  return out;
}

function pathStats(path, startPrice) {
  let peak = startPrice;
  let maxDD = 0;
  for (const b of path) {
    if (b.price > peak) peak = b.price;
    else if (peak > 0) maxDD = Math.max(maxDD, 1 - b.price / peak);
  }
  return { logRet: Math.log(path[path.length - 1].price / startPrice), maxDD };
}

// ---- reasoning --------------------------------------------------------------
// membership: {kind:'best'|'member'|'outside', rank?, size?, robust?, threshold?}
// — every pick states its plateau standing explicitly, so a best-in-tier pick
// that lives outside the stable regions is never mistaken for plateau-backed.
function reasonFor(pick, holdBase, membership, scenarioRow) {
  const parts = [];
  if (membership && membership.kind === 'best') {
    parts.push(
      `the BEST member of the ${membership.rank === 0 ? 'largest' : `#${membership.rank + 1}`} stability plateau ` +
        `(${membership.size} neighboring configs perform within ${Math.round((1 - membership.qualifyFrac) * 100)}% — ` +
        `this is a broad region, not a lucky spike)`
    );
  } else if (membership && membership.kind === 'member') {
    parts.push(
      `sits inside stability plateau #${membership.rank + 1} (${membership.size} configs — broad-region-backed, ` +
        `just not the region's single best point)`
    );
  } else if (membership && membership.kind === 'outside') {
    parts.push(
      `OUTSIDE the detected plateaus (robust score ${membership.robust.toFixed(2)} vs qualification bar ` +
        `${membership.threshold.toFixed(2)} — some one-step neighbor performs materially worse; ` +
        `treat as best-available-in-tier, not broad-region-backed)`
    );
  }
  parts.push(
    `full-period CAGR ${pick.cagrPct.toFixed(1)}% at max drawdown ${pick.maxDDPct.toFixed(0)}% ` +
      `(hold-BTC: ${holdBase.cagrPct.toFixed(1)}% at ${holdBase.maxDDPct.toFixed(0)}%) — ` +
      `MAR ${pick.mar.toFixed(2)} vs hold's ${holdBase.mar.toFixed(2)}`
  );
  if (pick.minUsdPctOfStart > 1) {
    parts.push(`USD floor held: reserves never fell below ${pick.minUsdPctOfStart.toFixed(0)}% of starting capital`);
  }
  if (scenarioRow) {
    const worst = Object.entries(scenarioRow.byArchetype).reduce((w, [k, v]) => (v.median < w.v ? { k, v: v.median } : w), { k: null, v: Infinity });
    const med = scenarioRow.probWeightedMedian;
    parts.push(
      `across synthetic futures: probability-weighted median ${med >= 0 ? '+' : ''}${med.toFixed(0)}%, ` +
        `worst archetype (${worst.k}) median ${worst.v >= 0 ? '+' : ''}${worst.v.toFixed(0)}%`
    );
  }
  parts.push(`${pick.trades} trades in ${pick.years.toFixed(1)}y, fees ${pick.feesPct.toFixed(1)}% of capital`);
  return parts.join('; ') + '.';
}

// ---- the sweep (IO wrapper the job runner calls) ----------------------------
async function runLadderSweep({ fast = false, seed = 424242 } = {}, setProgress = () => {}) {
  setProgress('loading deep BTC history…', 1);
  const rows = await getDailyHistory('bitcoin', 3650, 'btc');
  if (rows.length < 1000) throw new Error(`only ${rows.length} BTC daily bars available — load data first`);
  const bars = rows.map((r) => ({ ts: r.ts, price: r.usd_price }));
  const years = (bars[bars.length - 1].ts - bars[0].ts) / DAY_MS / 365;

  // Enumerate the grid (optionally subsampled for a fast pass).
  const indexList = [];
  const counters = new Array(DIMS.length).fill(0);
  const lens = DIMS.map((d) => GRID[d].length);
  let n = 0;
  for (;;) {
    if (!fast || n % 3 === 0) indexList.push(counters.slice());
    n++;
    let d = DIMS.length - 1;
    while (d >= 0) {
      counters[d]++;
      if (counters[d] < lens[d]) break;
      counters[d] = 0;
      d--;
    }
    if (d < 0) break;
  }

  // Service-wide CPU cap (lib/throttle.js): the sweep honors the same live
  // duty-cycle setting as the comp-lab searches and the tuner.
  const yieldLoop = require('./throttle').makeYielder();
  const scores = new Float64Array(indexList.length);
  const results = new Array(indexList.length);
  for (let i = 0; i < indexList.length; i++) {
    const cfg = configAt(indexList[i]);
    const sim = simulateLadder(bars, cfg);
    results[i] = sim;
    // Score = MAR (risk-adjusted growth). Pure CAGR would crown max-leverage
    // configs; pure low-DD would crown "never buy". MAR balances both and the
    // plateau logic guards it against single-point luck.
    scores[i] = sim.mar;
    if (i % 2000 === 0) {
      setProgress(`sweeping configurations: ${i.toLocaleString()} / ${indexList.length.toLocaleString()}`, 2 + (i / indexList.length) * 70);
      await yieldLoop();
    }
  }

  setProgress('detecting plateaus…', 74);
  const plat = findPlateaus(scores, indexList);
  await yieldLoop();

  // Risk tiers by max drawdown: conservative <30%, balanced 30–50%, aggressive >50%.
  const tierOf = (r) => (r.maxDDPct < 30 ? 'conservative' : r.maxDDPct <= 50 ? 'balanced' : 'aggressive');

  // Picks: best member of each top plateau + best robust config per risk tier.
  const pickSet = new Map(); // index -> {plateauRank|null, tier|null}
  plat.regions.forEach((region, rank) => {
    if (!pickSet.has(region.bestIndex)) pickSet.set(region.bestIndex, {});
    pickSet.get(region.bestIndex).plateauRank = rank;
    pickSet.get(region.bestIndex).plateauSize = region.size;
  });
  for (const tier of ['conservative', 'balanced', 'aggressive']) {
    let bestI = -1;
    for (let i = 0; i < indexList.length; i++) {
      if (tierOf(results[i]) !== tier) continue;
      if (bestI === -1 || plat.robust[i] > plat.robust[bestI]) bestI = i;
    }
    if (bestI >= 0) {
      if (!pickSet.has(bestI)) pickSet.set(bestI, {});
      pickSet.get(bestI).tier = tier;
    }
  }

  const base = baselines(bars);
  const holdBase = base[0];

  // Scenario engine over the picks + baselines.
  setProgress('generating synthetic futures…', 78);
  const rng = mulberry32(seed);
  const lastPrice = bars[bars.length - 1].price;
  const realATH = Math.max(...bars.map((b) => b.price));
  const nowTs = bars[bars.length - 1].ts;
  const dailyReturns = [];
  for (let i = 1; i < bars.length; i++) dailyReturns.push(Math.log(bars[i].price / bars[i - 1].price));

  const archPaths = new Map();
  const archStats = [];
  for (const a of ARCHETYPES) {
    const paths = [];
    for (let k = 0; k < PATHS_PER_ARCHETYPE; k++) {
      paths.push(a.bootstrap ? bootstrapPath(rng, lastPrice, dailyReturns, nowTs) : gbmPath(rng, lastPrice, a.legs(), nowTs));
    }
    archPaths.set(a.key, paths);
    const st = paths.map((p) => pathStats(p, lastPrice));
    archStats.push({
      key: a.key,
      logRet: st.reduce((s, x) => s + x.logRet, 0) / st.length,
      maxDD: st.reduce((s, x) => s + x.maxDD, 0) / st.length,
    });
  }
  // Probability ensemble: 2000 pure-history bootstraps classified by nearest archetype.
  const ensemble = [];
  for (let k = 0; k < 2000; k++) {
    ensemble.push(pathStats(bootstrapPath(rng, lastPrice, dailyReturns, nowTs), lastPrice));
    if (k % 200 === 0) await yieldLoop();
  }
  const probabilities = estimateProbabilities(archStats, ensemble);

  setProgress('projecting picks across futures…', 86);
  const median = (xs) => {
    const s = xs.slice().sort((a, b) => a - b);
    return s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2;
  };
  const quantile = (xs, q) => {
    const s = xs.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  };
  const projectRow = (simFn) => {
    const byArchetype = {};
    let pwNum = 0, pwDen = 0;
    for (const a of ARCHETYPES) {
      const rets = archPaths.get(a.key).map((p) => simFn(p).returnPct);
      const m = median(rets);
      byArchetype[a.key] = { median: m, p10: quantile(rets, 0.1), p90: quantile(rets, 0.9) };
      const prob = probabilities[a.key] || 0;
      pwNum += m * prob;
      pwDen += prob;
    }
    return { byArchetype, probWeightedMedian: pwDen > 0 ? pwNum / pwDen : 0 };
  };

  const picks = [];
  for (const [idx, tags] of pickSet) {
    const cfg = configAt(indexList[idx]);
    const scenarioRow = projectRow((path) => simulateLadder(path, cfg, { startPeak: realATH }));
    // Actual region membership (not just "is the best member"): a tier pick
    // can sit inside a plateau without being its single best point, and the
    // reasoning must say which it is instead of leaving it ambiguous.
    const memberRank = plat.regions.findIndex((rg) => rg.members.includes(idx));
    const membership =
      tags.plateauRank != null
        ? { kind: 'best', rank: tags.plateauRank, size: plat.regions[tags.plateauRank].size, qualifyFrac: 0.8 }
        : memberRank >= 0
          ? { kind: 'member', rank: memberRank, size: plat.regions[memberRank].size }
          : { kind: 'outside', robust: plat.robust[idx], threshold: plat.threshold };
    picks.push({
      config: cfg,
      label: describeConfig(cfg),
      plateauRank: tags.plateauRank ?? null,
      plateauSize: tags.plateauSize ?? null,
      plateauMemberRank: memberRank >= 0 ? memberRank : null,
      plateauMemberSize: memberRank >= 0 ? plat.regions[memberRank].size : null,
      tier: tags.tier ?? tierOf(results[idx]),
      ...results[idx],
      years,
      robustScore: plat.robust[idx],
      scenarios: scenarioRow,
      reasoning: reasonFor({ ...results[idx], years }, holdBase, membership, scenarioRow),
    });
    await yieldLoop();
  }
  picks.sort((a, b) => b.robustScore - a.robustScore);

  setProgress('projecting baselines across futures…', 94);
  const baseRows = base.map((b) => {
    let scen = null;
    if (b.name.startsWith('HOLD BTC')) {
      scen = projectRow((path) => simulateLadder(path, { entryStart: 99, entrySpacing: 1, entryCount: 1, buyFrac: 0, exitStart: 99, exitSpacing: 1, exitCount: 1, sellFrac: 0, reservePct: 0, dcaMonthlyPct: 0 }, { startUsd: 0, startBtc: START_USD / lastPrice, startPeak: realATH }));
    } else if (b.name.startsWith('PURE DCA')) {
      scen = projectRow((path) => simulateLadder(path, { entryStart: 99, entrySpacing: 1, entryCount: 1, buyFrac: 0, exitStart: 99, exitSpacing: 1, exitCount: 1, sellFrac: 0, reservePct: 0, dcaMonthlyPct: 100 / 60 }, {}));
    }
    return { ...b, scenarios: scen };
  });

  // Marginal heat grid for the two most decision-relevant dims (easy overview).
  const heat = {};
  for (const dim of ['entryStart', 'buyFrac']) {
    heat[dim] = GRID[dim].map((v, vi) => {
      const di = DIMS.indexOf(dim);
      let s = 0, c = 0;
      for (let i = 0; i < indexList.length; i++) {
        if (indexList[i][di] === vi) {
          s += scores[i];
          c++;
        }
      }
      return { value: v, meanMar: c ? s / c : 0 };
    });
  }

  setProgress('done', 100);
  return {
    result: {
      window: { bars: bars.length, from: bars[0].ts, to: bars[bars.length - 1].ts, years, priceFrom: bars[0].price, priceTo: lastPrice, ath: realATH },
      grid: { dims: GRID, totalConfigs: indexList.length, fast },
      plateaus: plat.regions.map((r, i) => ({ rank: i, size: r.size, ranges: r.ranges, best: { config: configAt(indexList[r.bestIndex]), ...results[r.bestIndex] } })),
      plateauThreshold: plat.threshold,
      picks,
      baselines: baseRows,
      heat,
      scenarios: {
        years: SCENARIO_YEARS,
        pathsPerArchetype: PATHS_PER_ARCHETYPE,
        archetypes: ARCHETYPES.map((a) => ({ key: a.key, name: a.name, probability: probabilities[a.key] || 0 })),
        probabilityNote:
          'Probabilities are ROUGH estimates: 2,000 block-bootstrap resamples of 2017→now daily history, classified by nearest archetype in (return, drawdown) space. History this short cannot price structural change.',
      },
      caveat:
        'BY DESIGN this sweep fits the ENTIRE history with no out-of-sample holdout (your call, stated openly). ' +
        'Every number describes the past; the scenario grid is the forward test. Costs 0.5%/leg are included throughout.',
    },
    params: { fast, seed, gridSize: GRID_SIZE },
  };
}

async function dataStatus() {
  const row = db
    .prepare("SELECT COUNT(*) AS n, MIN(ts) AS f, MAX(ts) AS t FROM daily_prices WHERE coingecko_id = 'bitcoin'")
    .get();
  return { rows: row.n || 0, from: row.f || null, to: row.t || null };
}

module.exports = {
  simulateLadder,
  baselines,
  findPlateaus,
  runLadderSweep,
  dataStatus,
  configAt,
  describeConfig,
  gbmPath,
  bootstrapPath,
  mulberry32,
  GRID,
  DIMS,
  GRID_SIZE,
  ARCHETYPES,
  FEE_RATE,
  START_USD,
};
