const db = require('./db');
const { simulate } = require('./backtest');
const { indexUsdFor, priceAsset } = require('./balancer');
const { topCandidates, candidateSeries } = require('./candidates');
const { getDailyHistory, idealTetherSeries } = require('./history');
const { fiatCode } = require('./pricing');
const { getAccountForProfile } = require('./sync');
const kraken = require('./exchanges/kraken');
const bitso = require('./exchanges/bitso');
const regime = require('./regime');
const { makeYielder } = require('./throttle');

// Phase 2.75: composition sweep — an empirical search over asset GROUPS and
// target WEIGHTS for setups where rebalancing genuinely earns its keep.
// Motivated by the live Kraken finding: a ~30% sleeve of terminal decliners
// made every threshold lose to holding; the mix was the problem.
//
// Search shape: seeded random sampling of mixes (subset of candidates +
// constrained weights) scored by a mini threshold sweep on the TRAIN window,
// robust across train halves; greedy refinement (weight jiggling + asset
// swaps) on the survivors; final ranking confirmed OUT-OF-SAMPLE on a
// held-out window the search never saw. The current mix is scored
// identically as the baseline. Advisory only — results feed the existing
// add-asset + targets-editor flow, nothing applies itself.
//
// Honesty rails (non-negotiable): the OOS split, train-half robustness,
// costs always on, and the caveat rendered with every result — a search
// over assets that already performed IS selection bias; the output is a
// candidate mix to consider, never a promise.

const CAVEAT =
  'Backtested on the past, selected because it scored on the past — that is hindsight bias by construction. ' +
  'Judge mixes by the OUT-OF-SAMPLE column (a window the search never optimized on), prefer boring stability ' +
  'over spectacular train numbers, and treat every result as a candidate to consider, not a promise.';

// Weight grid: units of 2.5%. Tether band and per-asset cap per PLAN Phase 4.
const STEP_PCT = 2.5;
const UNITS_TOTAL = 40; // 100%
const CAP_UNITS = 10; // 25%
const MIN_UNITS = 1; // 2.5%
const TETHER_UNITS = [4, 5, 6, 7, 8, 9, 10]; // 10–25%
// Mini sweep for full-fidelity mix scoring — spans the SAME range the
// sensitivity tuner sweeps (up to 30), so a mix whose real optimum is high
// (e.g. the MXN-denominated Bitso mix peaks near X=25) isn't under-scored
// by a grid that stopped at 20.
const MINI_X = [3, 5, 8, 12, 20, 25, 30];
const HOLD_BAND_PP = 0.5;
// Walk-forward validation: the last HOLDOUT_FRAC of the window is an
// untouched confirmation slice; the rest is cut into N_FOLDS sequential
// in-sample windows. A mix is judged on how CONSISTENTLY it harvests across
// those forward windows, not on one regime-boundary split. A fold "counts"
// as harvested when its edge clears MIN_FOLD_EDGE; a RECOMMENDATION needs a
// majority of folds AND a positive holdout.
const N_FOLDS = 4;
const HOLDOUT_FRAC = 0.2;
const MIN_FOLD_EDGE = 0.5; // pp of value above holding for a fold to count as harvested
const RECO_MIN_FOLDS = 3; // of N_FOLDS

// Current-set mode (allocation × sensitivity on the EXACT current holdings):
// a fine 1% grid, every current asset kept present between 4% and 80%. No
// assets added, none removed (no subsets) — only the split moves, and every
// split is scored jointly against the full sensitivity grid.
const CS_STEP_PCT = 1;
const CS_MIN_PCT = 4;
const CS_MAX_PCT = 80;

// Deterministic PRNG so a seed reproduces a search exactly. The internal
// state is exposed (get/setState) so a paused search can CHECKPOINT and a
// resumed one continue the identical draw sequence — the algorithm and the
// sequence are byte-for-byte unchanged.
function mulberry32(seed) {
  let a = seed >>> 0;
  const rng = function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.getState = () => a;
  rng.setState = (v) => {
    a = v >>> 0;
  };
  return rng;
}

// ---- timeline & bars --------------------------------------------------------

const DAY_MS = 86_400_000;

// One shared bar array carrying prices for EVERY pool asset; each simulate()
// call reads only its mix's ids. Candidates must cover (nearly) the whole
// window — every mix is judged on the same bars — with small gaps
// forward-filled.
function buildBars(seriesById, ids, { missTolerance = 0.03 } = {}) {
  // Timeline = the tether/first asset's day set intersected down to days
  // where at least all-but-tolerance assets have data; simpler and fair:
  // take the union of days, keep ids covering >= (1 - missTolerance) of it,
  // forward-fill their gaps.
  const daySet = new Set();
  for (const id of ids) {
    for (const r of seriesById.get(id) || []) daySet.add(r.ts);
  }
  const days = [...daySet].sort((a, b) => a - b);
  if (days.length === 0) return { bars: [], covered: [] };

  const covered = [];
  const priceMaps = new Map();
  for (const id of ids) {
    const rows = seriesById.get(id) || [];
    if (rows.length / days.length >= 1 - missTolerance) {
      covered.push(id);
      priceMaps.set(id, new Map(rows.map((r) => [r.ts, r.usd_price])));
    }
  }

  const bars = [];
  const lastSeen = new Map();
  for (const ts of days) {
    const usd = {};
    let complete = true;
    for (const id of covered) {
      const p = priceMaps.get(id).get(ts);
      if (p > 0) lastSeen.set(id, p);
      const v = lastSeen.get(id);
      if (!(v > 0)) complete = false; // leading gap — asset not live yet
      else usd[id] = v;
    }
    if (complete) bars.push({ ts, usd });
  }
  return { bars, covered };
}

// ---- mix representation -----------------------------------------------------

// A mix: {riskIds: [id], units: Map(id -> units), tetherUnits}
function mixKey(mix) {
  return (
    mix.tetherUnits +
    '|' +
    [...mix.units.entries()]
      .map(([id, u]) => `${id}:${u}`)
      .sort()
      .join(',')
  );
}

function mixToAssets(mix, pool) {
  const assets = [
    { coingecko_id: pool.tether.id, symbol: pool.tether.symbol, target_pct: mix.tetherUnits * STEP_PCT, is_index: 1 },
  ];
  for (const [id, u] of mix.units) {
    assets.push({ coingecko_id: id, symbol: pool.symbolOf.get(id) || id, target_pct: u * STEP_PCT, is_index: 0 });
  }
  return assets;
}

function sampleMix(rng, candidateIds, minAssets, maxAssets, pinnedIds = []) {
  // Pinned assets are in EVERY sampled mix; the random subset fills the
  // remainder. With no pins this reduces to the original sampler (same RNG
  // draw sequence, so unpinned searches stay seed-reproducible).
  let k = minAssets + Math.floor(rng() * (maxAssets - minAssets + 1));
  if (k < pinnedIds.length) k = pinnedIds.length;
  const ids = pinnedIds.length ? candidateIds.filter((id) => !pinnedIds.includes(id)) : [...candidateIds];
  const extra = Math.min(k - pinnedIds.length, ids.length);
  // Fisher–Yates partial shuffle for the subset.
  for (let i = 0; i < extra; i++) {
    const j = i + Math.floor(rng() * (ids.length - i));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const chosen = [...pinnedIds, ...ids.slice(0, extra)];
  const tetherUnits = TETHER_UNITS[Math.floor(rng() * TETHER_UNITS.length)];
  const units = new Map(chosen.map((id) => [id, MIN_UNITS]));
  let remaining = UNITS_TOTAL - tetherUnits - chosen.length * MIN_UNITS;
  // Per-mix cap scales with the asset count: the 25% diversification cap is
  // right for 4+ assets but makes small mixes unfillable (1 asset + tether
  // can't reach 100%), so concentrated mixes get exactly the headroom their
  // count requires — a lone asset absorbs everything the tether doesn't
  // (75–90%), a pair splits within 2.5%..45%, and 4+ keep the 25% cap.
  const capUnits = Math.max(CAP_UNITS, Math.ceil((UNITS_TOTAL - tetherUnits) / chosen.length));
  let guard = 1000;
  while (remaining > 0 && guard-- > 0) {
    const id = chosen[Math.floor(rng() * chosen.length)];
    if (units.get(id) < capUnits) {
      units.set(id, units.get(id) + 1);
      remaining--;
    }
  }
  if (remaining > 0) return null; // caps left units unplaceable — resample
  return { units, tetherUnits };
}

// ---- scoring ----------------------------------------------------------------

// Score a mix on one window: mini X sweep + hold; the best X is the one
// whose harvest is REAL (basket up, value not beaten by holding). The
// display fields (value/x/dd/trades) report that best X; `edge` is the
// SELECTION metric — value growth ABOVE holding, i.e. what rebalancing
// actually added. A mix that merely rose in price has edge ~0 no matter how
// high its absolute return, so the search stops rewarding directional drift
// masquerading as harvesting skill.
function scoreWindow(assets, bars, costs) {
  const hold = simulate(assets, null, { ...costs, bars });
  let best = null;
  for (const x of MINI_X) {
    const r = simulate(assets, x, { ...costs, bars });
    if (r.netBasketGrowthPct <= 0) continue;
    if (r.valueGrowthPct < hold.valueGrowthPct - HOLD_BAND_PP) continue;
    if (!best || r.valueGrowthPct > best.valueGrowthPct) best = r;
  }
  return {
    value: best ? best.valueGrowthPct : hold.valueGrowthPct,
    edge: best ? best.valueGrowthPct - hold.valueGrowthPct : 0,
    basket: best ? best.netBasketGrowthPct : 0,
    x: best ? best.x : null,
    dd: best ? best.maxValueDrawdownPct : hold.maxValueDrawdownPct,
    trades: best ? best.tradeCount : 0,
    hold: hold.valueGrowthPct,
  };
}

function median(xs) {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// --- FOLDS mode (shallow venues, e.g. Bitso): walk-forward across N equal
// sequential in-sample folds + an untouched holdout. ---
function scoreFolds(assets, foldsBars, holdoutBars, costs) {
  const folds = foldsBars.map((b) => scoreWindow(assets, b, costs));
  const robust = median(folds.map((f) => f.edge));
  const positiveFolds = folds.filter((f) => f.edge > MIN_FOLD_EDGE).length;
  const holdout = scoreWindow(assets, holdoutBars, costs);
  return {
    mode: 'folds',
    robust,
    positiveFolds,
    nFolds: folds.length,
    foldEdges: folds.map((f) => f.edge),
    holdout,
    screenScore: robust,
    rankTuple: [positiveFolds, robust, holdout.edge],
    recommended: positiveFolds >= RECO_MIN_FOLDS && holdout.edge > 0,
  };
}

// --- REGIME mode (deep venues, e.g. Kraken 4y): harvest edge measured per
// market-regime type (bull/bear/range), each swath simulated independently,
// then aggregated equal-weighted BY TYPE + an untouched holdout. Two headline
// numbers: `consistency` = worst market type's median edge (works in all
// types), `average` = equal-weighted mean across types (best overall). ---
function scoreRegimes(assets, swaths, inSampleBars, holdoutBars, costs) {
  const byType = { bull: [], bear: [], range: [] };
  for (const s of swaths) {
    const r = scoreWindow(assets, inSampleBars.slice(s.startIdx, s.endIdx + 1), costs);
    byType[s.label].push(r.edge);
  }
  const perType = {};
  for (const t of ['bull', 'bear', 'range']) if (byType[t].length) perType[t] = median(byType[t]);
  const present = Object.keys(perType);
  const vals = present.map((t) => perType[t]);
  const consistency = vals.length ? Math.min(...vals) : 0;
  const average = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const typesPositive = vals.filter((v) => v > MIN_FOLD_EDGE).length;
  const holdout = scoreWindow(assets, holdoutBars, costs);
  return {
    mode: 'regime',
    perType,
    typesPresent: present.length,
    typesPositive,
    consistency,
    average,
    holdout,
    screenScore: consistency,
    // Rank: positive in MORE market types, then steadier worst type, then
    // higher average, then a positive holdout.
    rankTuple: [typesPositive, consistency, average, holdout.edge],
    recommended: typesPositive >= present.length && present.length >= 2 && holdout.edge > 0,
  };
}

// Lexicographic descending compare over rankTuple. <0 => `a` ranks first.
function tupleRank(a, b) {
  const A = a.rankTuple, B = b.rankTuple;
  for (let i = 0; i < A.length; i++) if (B[i] !== A[i]) return B[i] - A[i];
  return 0;
}

// Hold growth in closed form — Σ weight × price relative — so the broad
// pass doesn't burn a whole simulation on the no-trading baseline.
function holdGrowthPct(assets, barsArr) {
  if (barsArr.length < 2) return null;
  const relAt = (bar) => {
    const iu = indexUsdFor(assets, bar.usd);
    return assets.map((a) => {
      const p = priceAsset(a, iu, bar.usd);
      return p ? p.rel : null;
    });
  };
  const r0 = relAt(barsArr[0]);
  const r1 = relAt(barsArr[barsArr.length - 1]);
  let v = 0;
  for (let i = 0; i < assets.length; i++) {
    if (!(r0[i] > 0) || !(r1[i] > 0)) return null;
    v += ((assets[i].target_pct || 0) / 100) * (r1[i] / r0[i]);
  }
  return (v - 1) * 100;
}

// ---- market benchmark + quality gate ---------------------------------------
//
// The composition search ranks by rebalancing HARVEST edge, which is blind to
// whether a mix's underlying assets sank — so it will happily crown a mix that
// harvested well while losing 40%. To surface REAL possibilities (and weed the
// junk we'd never actually hold), each mix is also measured against the market:
// holding BTC over the same window, priced in the profile's index currency
// (NOT the user's current mix — one window's number for that is noise). A mix
// is a "real possibility" only if it roughly keeps up with that market on both
// return and drawdown.
const MKT_LAG_MARGIN = 8; // pp: a real possibility may trail market return by at most this
const MKT_DD_MARGIN = 10; // pp: ...and draw down at most this much more than the market

function maxDrawdownPct(pathVals) {
  let peak = -Infinity;
  let mdd = 0;
  for (const v of pathVals) {
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = 1 - v / peak;
      if (dd > mdd) mdd = dd;
    }
  }
  return mdd * 100;
}

// Market baseline = 1 unit of BTC, valued in the index currency, over `bars`.
// benchmark[i].usd_price is BTC in USD; bars[i].usd[tetherId] is USD per index
// unit, so their ratio is BTC expressed in the index. Returns {return, maxDD}
// in percent, or null when the benchmark/tether can't be aligned (gate off).
function marketBenchmark(benchmark, bars, tetherId) {
  if (!benchmark || benchmark.length !== bars.length || bars.length < 2) return null;
  const path = [];
  for (let i = 0; i < bars.length; i++) {
    const idxUsd = bars[i].usd[tetherId];
    const btcUsd = benchmark[i].usd_price;
    if (!(idxUsd > 0) || !(btcUsd > 0)) return null;
    path.push(btcUsd / idxUsd);
  }
  return { return: (path[path.length - 1] / path[0] - 1) * 100, maxDD: maxDrawdownPct(path) };
}

// Does a mix keep up with the market on both return and drawdown? (Gate off →
// everything passes.) `full` is the mix's whole-window score at its best X.
function beatsMarketOf(full, market) {
  if (!market) return true;
  return full.value >= market.return - MKT_LAG_MARGIN && full.dd <= market.maxDD + MKT_DD_MARGIN;
}

// Display order for the finalists: real possibilities (keep up with the
// market) first, then harvest breadth, then worst-regime edge / fold
// robustness, then raw return. Surfaces good all-round mixes the pure-harvest
// sort buries, and sinks the harvest-well-but-sank junk.
function qualityRank(a, b) {
  if (!!b.beatsMarket !== !!a.beatsMarket) return (b.beatsMarket ? 1 : 0) - (a.beatsMarket ? 1 : 0);
  const ab = a.typesPositive != null ? a.typesPositive : a.positiveFolds || 0;
  const bb = b.typesPositive != null ? b.typesPositive : b.positiveFolds || 0;
  if (bb !== ab) return bb - ab;
  const aw = a.consistency != null ? a.consistency : a.robust || 0;
  const bw = b.consistency != null ? b.consistency : b.robust || 0;
  if (bw !== aw) return bw - aw;
  return (b.full ? b.full.value : 0) - (a.full ? a.full.value : 0);
}

// How many gate-hidden rows a result keeps viewable. Bounded so a persisted
// result stays small; the weededForQuality count still reports the true total.
const HIDDEN_CAP = 40;

// CPU throttling + the ⏸ pause gate live in lib/throttle.js now: ONE
// service-wide setting (changeable live in the UI header) governs the duty
// cycle of every heavy loop — these searches, the tuner, ladder sweeps.
// Timing-only: sampling order and seeds untouched, results identical.

// Intensity-scaled funnel sizes (user-tuned): the broad pass dominates
// wall-clock (>95% at 1M), so wider boards and a much deeper refinement stage
// cost little relative to the stage already being paid for. Boards ×1.25/×1.5
// and refinement ×2/×4 at the standard/intensive tiers; 30 finalists rendered.
function funnelSizes(samples = 100000) {
  const boardScale = samples >= 1_000_000 ? 1.5 : samples >= 100_000 ? 1.25 : 1;
  const refineScale = samples >= 1_000_000 ? 4 : samples >= 100_000 ? 2 : 1;
  return {
    fullTop: Math.round(500 * boardScale),
    retKeep: Math.round(150 * boardScale),
    refineTop: 60 * refineScale,
    refineEvals: 80 * refineScale,
    finalists: 30,
  };
}

// ---- the search -------------------------------------------------------------

async function searchCompositions({
  candidates, // [{id, symbol, rank}] risk candidates (held + top-N), coverage-filtered
  tether, // {id, symbol}
  bars, // shared timeline with prices for every candidate + tether
  currentMix = null, // [{id, symbol, targetPct, isIndex}] incl tether, or null
  feePct = 0.38,
  spreadPct = 0.1,
  lagHours = 6,
  samples = 100000, // broad-pass combination count
  minAssets = 1,
  maxAssets = 8,
  pinned = [], // coingecko ids that must appear in every searched mix
  screenKeep = 16, // candidates surviving the solo screen
  fullTop, // broad-pass contenders promoted to full fidelity (default: intensity-scaled)
  retKeep, // raw-return board size (default: intensity-scaled)
  refineTop,
  refineEvals,
  finalists,
  benchmark = null, // BTC-aligned {ts,usd_price}[] over `bars`, enables regime mode
  seed = 42,
  pauseGate = null, // job runner's cooperative pause gate
  resume = null, // checkpoint loop state (deploy-surviving pause)
  checkpointWrapper = null, // IO wrapper's frozen result metadata, rides in snapshots
  setProgress = () => {},
} = {}) {
  const sized = funnelSizes(samples);
  fullTop = fullTop ?? sized.fullTop;
  retKeep = Math.min(retKeep ?? sized.retKeep, fullTop);
  refineTop = refineTop ?? sized.refineTop;
  refineEvals = refineEvals ?? sized.refineEvals;
  finalists = finalists ?? sized.finalists;
  const costs = { feePct, spreadPct, lagHours };
  const rng = mulberry32(seed);
  const pool = {
    tether,
    symbolOf: new Map(candidates.map((c) => [c.id, c.symbol])),
  };
  if (candidates.length < minAssets) {
    throw new Error(`only ${candidates.length} candidates have full-window history — need at least ${minAssets}`);
  }
  // Pins: must-include ids, restricted to what actually made the candidate
  // pool (the IO wrapper warns about any that didn't). A big pin set widens
  // maxAssets so the pins alone never make sampling infeasible.
  const pinnedIds = pinned.filter((id) => pool.symbolOf.has(id));
  const pinnedSet = new Set(pinnedIds);
  if (pinnedIds.length) maxAssets = Math.max(maxAssets, pinnedIds.length);
  // Long runs must not starve the event loop (polls, syncs, the UI itself).
  const yieldLoop = makeYielder(pauseGate);

  // ---- checkpointing (deploy-surviving pause) -------------------------------
  // A snapshot freezes the search INPUTS (bars, candidates, benchmark, every
  // resolved knob) plus the exact loop position; a resumed run feeds it back
  // via opts.resume and continues draw-for-draw identically. The broad pass
  // (≈95% of wall-clock) resumes exactly; the short post-broad stages re-run
  // deterministically from the completed contender board.
  const serMix = (m) => ({ u: [...m.units.entries()], t: m.tetherUnits });
  const desMix = (s) => ({ units: new Map(s.u), tetherUnits: s.t });
  const inputsSnap = () => ({
    candidates, tether, bars, benchmark, currentMix, feePct, spreadPct, lagHours,
    samples, minAssets, maxAssets, pinned: pinnedIds, screenKeep, fullTop, retKeep,
    refineTop, refineEvals, finalists, seed,
  });

  // Untouched holdout tail (both modes) + the in-sample region.
  const holdoutN = Math.max(30, Math.floor(bars.length * HOLDOUT_FRAC));
  const inSample = bars.slice(0, bars.length - holdoutN);
  const holdoutBars = bars.slice(bars.length - holdoutN);

  // Choose the validation MODE: REGIME (deep, diverse benchmark → evaluate
  // per bull/bear/range market type) or FOLDS (shallow → sequential
  // walk-forward). Regime mode needs the benchmark to span the in-sample
  // region with ≥2 market types present.
  let mode = 'folds';
  let swaths = [];
  let regimeInfo = null;
  if (benchmark && benchmark.length === bars.length) {
    const cls = regime.classify(benchmark.slice(0, inSample.length));
    if (cls.enough) {
      mode = 'regime';
      swaths = cls.swaths;
      regimeInfo = { byType: cls.byType, swaths: cls.swaths.map((s) => ({ label: s.label, days: s.days, from: s.from, to: s.to })) };
    }
  }
  const foldSize = Math.floor(inSample.length / N_FOLDS);
  const foldsBars = [];
  for (let f = 0; f < N_FOLDS; f++) {
    foldsBars.push(inSample.slice(f * foldSize, f === N_FOLDS - 1 ? inSample.length : (f + 1) * foldSize));
  }
  const scoreMix = (assets) =>
    mode === 'regime'
      ? scoreRegimes(assets, swaths, inSample, holdoutBars, costs)
      : scoreFolds(assets, foldsBars, holdoutBars, costs);

  // ---- Stage 0: solo screen. Each candidate is audited ONE ASSET AT A TIME
  // (50/50 vs the tether) to CHARACTERIZE its standalone harvest — shown for
  // context. It does NOT cull on harvest: the ONLY thing dropped is a terminal
  // DECLINER (an asset that structurally collapsed over the window), because
  // rebalancing INTO a value-destroyer is a proven trap. A low-harvest but
  // sound asset — gold and other uncorrelated / contrarian diversifiers — is
  // KEPT: its worth is drawdown reduction and market-keeping inside a MIX, not
  // oscillation against a stable tether, and that only shows up in combination.
  // Trading a few more minutes of permutations for a wider net is the right
  // call on a months-to-years decision; the broad pass + quality gate sort it.
  const DECLINE_FLOOR = -0.75; // lost >75% over the window ⇒ terminal decliner
  const ownReturn = (id) => {
    let first = null, last = null;
    for (const b of inSample) {
      const p = b.usd[id];
      if (p > 0) {
        if (first == null) first = p;
        last = p;
      }
    }
    return first && last ? last / first - 1 : 0;
  };
  let screen;
  let keptIdsArr;
  if (resume) {
    // The screen verdicts were frozen into the checkpoint — reuse them so a
    // resumed run's draws line up exactly with the interrupted one.
    screen = resume.screen;
    keptIdsArr = resume.keptIdsArr;
    setProgress('resuming from checkpoint…');
  } else {
    screen = [];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      setProgress(`solo screen: ${c.symbol.toUpperCase()} (${i + 1}/${candidates.length})`, (i / candidates.length) * 3);
      const solo = [
        { coingecko_id: tether.id, symbol: tether.symbol, target_pct: 50, is_index: 1 },
        { coingecko_id: c.id, symbol: c.symbol, target_pct: 50, is_index: 0 },
      ];
      const sc = scoreMix(solo);
      const ret = ownReturn(c.id);
      screen.push({
        id: c.id,
        symbol: c.symbol,
        soloTrain: sc.screenScore,
        positiveFolds: sc.positiveFolds || sc.typesPositive || 0,
        ownReturnPct: ret * 100,
        // Only terminal decliners are weeded — and a PIN even survives that:
        // the user demanded the asset in every mix, so the search honors it
        // and lets the quality gate judge the result honestly.
        kept: ret > DECLINE_FLOOR || pinnedSet.has(c.id),
        pinned: pinnedSet.has(c.id) || undefined,
      });
      if (i % 4 === 3) await yieldLoop();
    }
    screen.sort((a, b) => b.soloTrain - a.soloTrain);
    keptIdsArr = screen.filter((s) => s.kept).map((s) => s.id);
    // Safety: if weeding decliners would leave too few to form a mix, keep them
    // all rather than starve the search (the quality gate still judges honestly).
    if (keptIdsArr.length < minAssets) {
      for (const s of screen) s.kept = true;
      keptIdsArr = candidates.map((c) => c.id);
    }
  }

  // ---- Stage 1: broad pass — massive seeded random sampling over the
  // screened survivors, cheaply scored by harvest EDGE over the whole
  // in-sample region (two representative X probes) into a bounded contender
  // board, so a million combos fit in memory.
  const CHEAP_X = [6, 22];
  const board = []; // {key, mix, cheap} — best cheap harvest EDGE
  const boardKeys = new Set();
  let cutoff = -Infinity;
  // Second board: best raw RETURN (pure hold). A harvest-ranked board discards
  // the sets that simply made the most money sitting still, so the quality
  // gate would never even see them; this keeps the best pure performers alive
  // into full scoring, where they're labeled honestly.
  const retBoard = []; // {key, mix, hold}
  const retKeys = new Set();
  let retCutoff = -Infinity;
  let broadSampled = 0;
  let rngStateBroadEnd = null;

  if (resume && resume.phase === 'post-broad') {
    // The contender board was complete at pause — stages 2–4 re-run
    // deterministically from it (a few minutes at worst, vs. the broad
    // pass's tens of minutes which the 'broad' phase resumes exactly).
    for (const b of resume.board) board.push({ key: b.key, mix: desMix(b.mix), cheap: b.cheap });
    broadSampled = resume.broadSampled || 0;
    rngStateBroadEnd = resume.rngState;
    rng.setState(resume.rngState);
  } else {
    let broadStart = 0;
    if (resume && resume.phase === 'broad') {
      broadStart = resume.i;
      rng.setState(resume.rngState);
      cutoff = resume.cutoff == null ? -Infinity : resume.cutoff;
      retCutoff = resume.retCutoff == null ? -Infinity : resume.retCutoff;
      broadSampled = resume.broadSampled || 0;
      for (const b of resume.board) {
        board.push({ key: b.key, mix: desMix(b.mix), cheap: b.cheap });
        boardKeys.add(b.key);
      }
      for (const b of resume.retBoard) {
        retBoard.push({ key: b.key, mix: desMix(b.mix), hold: b.hold });
        retKeys.add(b.key);
      }
    }
    const broadSnap = (nextI) => () => ({
      engine: 'compositions',
      wrapper: checkpointWrapper,
      inputs: inputsSnap(),
      loop: {
        phase: 'broad',
        i: nextI,
        rngState: rng.getState(),
        cutoff: Number.isFinite(cutoff) ? cutoff : null,
        retCutoff: Number.isFinite(retCutoff) ? retCutoff : null,
        broadSampled,
        screen,
        keptIdsArr,
        board: board.map((b) => ({ key: b.key, mix: serMix(b.mix), cheap: b.cheap })),
        retBoard: retBoard.map((b) => ({ key: b.key, mix: serMix(b.mix), hold: b.hold })),
      },
    });
    for (let i = broadStart; i < samples; i++) {
      const mix = sampleMix(rng, keptIdsArr, minAssets, Math.min(maxAssets, keptIdsArr.length), pinnedIds);
      if (mix) {
        broadSampled++;
        const assets = mixToAssets(mix, pool);
        const hold = holdGrowthPct(assets, inSample);
        if (hold != null) {
          let bestValue = hold;
          for (const x of CHEAP_X) {
            const r = simulate(assets, x, { ...costs, bars: inSample });
            if (r.netBasketGrowthPct > 0 && r.valueGrowthPct >= hold - HOLD_BAND_PP && r.valueGrowthPct > bestValue) {
              bestValue = r.valueGrowthPct;
            }
          }
          const edge = bestValue - hold;
          const key = mixKey(mix);
          if ((edge > cutoff || board.length < fullTop) && !boardKeys.has(key)) {
            board.push({ key, mix, cheap: edge });
            boardKeys.add(key);
            if (board.length >= fullTop * 2) {
              board.sort((a, b) => b.cheap - a.cheap);
              for (const dropped of board.splice(fullTop)) boardKeys.delete(dropped.key);
              cutoff = board[board.length - 1].cheap;
            }
          }
          if ((hold > retCutoff || retBoard.length < retKeep) && !retKeys.has(key)) {
            retBoard.push({ key, mix, hold });
            retKeys.add(key);
            if (retBoard.length >= retKeep * 2) {
              retBoard.sort((a, b) => b.hold - a.hold);
              for (const dropped of retBoard.splice(retKeep)) retKeys.delete(dropped.key);
              retCutoff = retBoard[retBoard.length - 1].hold;
            }
          }
        }
      }
      if (i % 2000 === 0) {
        setProgress(
          `broad search: ${i.toLocaleString()} / ${samples.toLocaleString()} combos (${board.length} contenders held)`,
          3 + (i / samples) * 77
        );
      }
      if (i % 200 === 199) await yieldLoop(broadSnap(i + 1));
    }
    board.sort((a, b) => b.cheap - a.cheap);
    board.splice(fullTop);
    // Fold the raw-return board into full scoring (deduped against the edge board).
    retBoard.sort((a, b) => b.hold - a.hold);
    const edgeKeys = new Set(board.map((b) => b.key));
    for (const rb of retBoard.slice(0, retKeep)) {
      if (!edgeKeys.has(rb.key)) {
        board.push({ key: rb.key, mix: rb.mix, cheap: 0 });
        edgeKeys.add(rb.key);
      }
    }
    rngStateBroadEnd = rng.getState();
  }

  // Post-broad snapshot: the merged board is final; a resume re-runs stages
  // 2–4 from it with the rng state the original run had at broad-pass end.
  const postSnap = () => ({
    engine: 'compositions',
    wrapper: checkpointWrapper,
    inputs: inputsSnap(),
    loop: {
      phase: 'post-broad',
      rngState: rngStateBroadEnd,
      broadSampled,
      screen,
      keptIdsArr,
      board: board.map((b) => ({ key: b.key, mix: serMix(b.mix), cheap: b.cheap })),
    },
  });

  // ---- Stage 2: full-fidelity scoring of the contender board (regime or
  // walk-forward, per mode).
  const seen = new Map(); // mixKey -> {mix, key, ...score}
  const evalMix = (mix) => {
    const key = mixKey(mix);
    if (seen.has(key)) return seen.get(key);
    const entry = { mix, key, ...scoreMix(mixToAssets(mix, pool)) };
    seen.set(key, entry);
    return entry;
  };
  const fullScored = [];
  for (let i = 0; i < board.length; i++) {
    fullScored.push(evalMix(board[i].mix));
    if (i % 10 === 9) {
      setProgress(`full-fidelity scoring ${i + 1}/${board.length}`, 80 + (i / board.length) * 10);
      await yieldLoop(postSnap);
    }
  }
  const ranked = [...new Map(fullScored.map((s) => [s.key, s])).values()].sort(tupleRank);

  // ---- Stage 3: greedy refinement — keep variants that rank better on the
  // mode's robustness order (weight jiggles, tether moves, asset swaps).
  const survivors = ranked.slice(0, refineTop);
  for (let si = 0; si < survivors.length; si++) {
    setProgress(`refining survivor ${si + 1}/${survivors.length}`, 90 + (si / Math.max(1, survivors.length)) * 7);
    let current = survivors[si];
    for (let e = 0; e < refineEvals; e++) {
      const mix = current.mix;
      const ids = [...mix.units.keys()];
      const variant = { units: new Map(mix.units), tetherUnits: mix.tetherUnits };
      const move = rng();
      // Same count-scaled cap the sampler uses: small mixes are allowed the
      // concentration their asset count requires; 4+ keep the 25% cap.
      const capU = (tu) => Math.max(CAP_UNITS, Math.ceil((UNITS_TOTAL - tu) / ids.length));
      if (move < 0.55) {
        const from = ids[Math.floor(rng() * ids.length)];
        const to = ids[Math.floor(rng() * ids.length)];
        if (from === to || variant.units.get(from) <= MIN_UNITS || variant.units.get(to) >= capU(variant.tetherUnits)) continue;
        variant.units.set(from, variant.units.get(from) - 1);
        variant.units.set(to, variant.units.get(to) + 1);
      } else if (move < 0.8) {
        const id = ids[Math.floor(rng() * ids.length)];
        if (rng() < 0.5) {
          if (variant.tetherUnits <= TETHER_UNITS[0] || variant.units.get(id) >= capU(variant.tetherUnits - 1)) continue;
          variant.tetherUnits--;
          variant.units.set(id, variant.units.get(id) + 1);
        } else {
          if (variant.tetherUnits >= TETHER_UNITS[TETHER_UNITS.length - 1] || variant.units.get(id) <= MIN_UNITS) continue;
          variant.tetherUnits++;
          variant.units.set(id, variant.units.get(id) - 1);
        }
      } else {
        const out = ids[Math.floor(rng() * ids.length)];
        if (pinnedSet.has(out)) continue; // a pinned asset is never swapped out
        const unused = keptIdsArr.filter((c) => !variant.units.has(c));
        if (unused.length === 0) continue;
        const inn = unused[Math.floor(rng() * unused.length)];
        const u = variant.units.get(out);
        variant.units.delete(out);
        variant.units.set(inn, u);
      }
      const cand = evalMix(variant);
      if (tupleRank(cand, current) < 0) current = cand;
      if (e % 20 === 19) await yieldLoop(postSnap);
    }
    survivors[si] = current;
  }

  // ---- Stage 4: finalists. A mix is a RECOMMENDATION (★) only if it cleared
  // the mode's bar — in REGIME mode, harvested in every present market type
  // AND kept a positive holdout edge; in FOLDS mode, a majority of folds +
  // positive holdout. When none qualify, that honest verdict is surfaced as a
  // warning instead of a misleading leaderboard.
  setProgress('holdout confirmation', 98);
  const tetherId = tether.id;
  const market = marketBenchmark(benchmark, bars, tetherId);
  const summarize = (entry, assetsList) => {
    const assets = assetsList || mixToAssets(entry.mix, pool);
    const full = scoreWindow(assets, bars, costs);
    const row = {
      assets: assets.map((a) => ({ id: a.coingecko_id, symbol: a.symbol, pct: a.target_pct, isIndex: !!a.is_index })),
      mode: entry.mode,
      holdout: entry.holdout,
      full,
      netReturn: full.value,
      maxDD: full.dd,
      beatsMarket: beatsMarketOf(full, market),
      recommended: entry.recommended,
    };
    if (entry.mode === 'regime') {
      row.perType = entry.perType;
      row.consistency = entry.consistency;
      row.average = entry.average;
      row.typesPositive = entry.typesPositive;
      row.typesPresent = entry.typesPresent;
    } else {
      row.positiveFolds = entry.positiveFolds;
      row.nFolds = entry.nFolds;
      row.robust = entry.robust;
      row.foldEdges = entry.foldEdges;
    }
    // ★ only for a real possibility (harvests AND keeps up with the market).
    row.recommended = row.recommended && row.beatsMarket;
    return row;
  };
  const allRows = [...new Map(survivors.map((s) => [s.key, s])).values()]
    .map((s) => summarize(s))
    .sort(qualityRank);
  const real = allRows.filter((r) => r.beatsMarket);
  const noRealPossibility = market != null && real.length === 0;
  const rows = (real.length ? real : allRows).slice(0, finalists);
  const weededForQuality = allRows.length - rows.length;
  // The weeded rows stay INSPECTABLE, not erased: everything the gate (or the
  // finalists fold) kept off the board, in the same quality order, capped.
  // Each row carries beatsMarket so the renderer labels laggards honestly.
  const shownSet = new Set(rows);
  const hiddenMixes = allRows.filter((r) => !shownSet.has(r)).slice(0, HIDDEN_CAP);
  const anyRecommended = rows.some((r) => r.recommended);

  // Current mix — scored the SAME way, shown for REFERENCE only. A single
  // window's number is noise, so it is explicitly NOT a bar to beat. Scoring
  // it must never kill the search (e.g. a just-switched index with stale
  // targets) — degrade to "not scorable" with a warning instead.
  let currentScored = null;
  let currentMixWarning = null;
  if (currentMix && currentMix.length > 0) {
    try {
      const assets = currentMix.map((m) => ({
        coingecko_id: m.id, symbol: m.symbol, target_pct: m.targetPct, is_index: m.isIndex ? 1 : 0,
      }));
      currentScored = { ...summarize(scoreMix(assets), assets), reference: true, recommended: false };
    } catch (err) {
      currentMixWarning = `Current mix could not be scored for reference (${err.message}) — likely stale targets after an index switch; use "Set new targets".`;
    }
  }

  const warnings = [];
  if (currentMixWarning) warnings.push(currentMixWarning);
  if (noRealPossibility) {
    warnings.push(
      'No mix kept up with the market (holding BTC, valued in the index currency) on both return and drawdown — ' +
        'showing best-effort harvesters; none is a real upgrade over just holding the market.'
    );
  } else if (!anyRecommended) {
    const base =
      mode === 'regime'
        ? 'No mix harvested across ALL market types (bull/bear/range) with a positive holdout'
        : 'No mix harvested consistently across the walk-forward windows with a positive holdout';
    warnings.push(
      market
        ? `${base} while keeping up with the market — the table ranks real possibilities by robustness, but none clears the ★ bar.`
        : `${base} — on this universe and history, rebalancing does not reliably beat holding. The table is a capital-preservation ranking only, NOT a recommendation.`
    );
  }

  return {
    mixes: rows,
    hiddenMixes,
    currentMix: currentScored,
    mode,
    regime: regimeInfo,
    noHarvest: !anyRecommended,
    market,
    noRealPossibility,
    weededForQuality,
    funnel: { fullTop, retKeep, refineTop, refineEvals },
    warnings,
    screen, // per-asset solo verdicts, kept flag included
    combos: { broadSampled, contenders: board.length, fullScored: seen.size },
    window: {
      bars: bars.length,
      inSampleBars: inSample.length,
      holdoutBars: holdoutBars.length,
      nFolds: N_FOLDS,
      from: bars[0] ? bars[0].ts : null,
      to: bars.length ? bars[bars.length - 1].ts : null,
      holdoutFrom: holdoutBars[0] ? holdoutBars[0].ts : null,
    },
    evaluatedMixes: broadSampled + seen.size,
    caveat: CAVEAT,
  };
}

// ---- current-set search (allocation × sensitivity) --------------------------
//
// Keeps the profile's EXACT current asset set (index + every holding), never
// adding or dropping an asset, and searches only the SPLIT: each asset roams
// 4%–80% on a 1% grid, summing to 100. Every candidate split is scored across
// the full sensitivity grid (the folds/regime scorer sweeps MINI_X per
// window), so allocation and sensitivity permute together — the output is the
// best (split, X) pair, and each finalist carries its whole X sweep so the
// interaction is visible the way the tuner shows its X grid. Ranking and the
// no-harvest verdict are identical to the composition lab (robust harvest
// edge); the current mix is scored for reference only.
async function searchCurrentSet({
  assetSet, // [{id, symbol, isIndex}] — the full current set (index included)
  bars,
  currentMix = null, // [{id, symbol, targetPct, isIndex}]
  feePct = 0.38,
  spreadPct = 0.1,
  lagHours = 6,
  samples = 200000,
  refineTop,
  refineEvals,
  finalists,
  benchmark = null,
  seed = 42,
  pauseGate = null,
  resume = null,
  checkpointWrapper = null,
  setProgress = () => {},
} = {}) {
  const costs = { feePct, spreadPct, lagHours };
  const rng = mulberry32(seed);
  const ids = assetSet.map((a) => a.id);
  const n = ids.length;
  const MINU = CS_MIN_PCT, MAXU = CS_MAX_PCT, TOTAL = 100;
  if (n < 2) throw new Error('need at least 2 current assets (an index + one holding) to search allocations');
  if (n * MINU > TOTAL) {
    throw new Error(
      `${n} assets can't each hold ≥${MINU}% (that needs ${n * MINU}% > 100%) — remove an asset from the profile first`
    );
  }
  const yieldLoop = makeYielder(pauseGate);

  const toAssets = (units) =>
    assetSet.map((a) => ({ coingecko_id: a.id, symbol: a.symbol, target_pct: units.get(a.id), is_index: a.isIndex ? 1 : 0 }));
  const keyOf = (units) => ids.map((id) => `${id}:${units.get(id)}`).join(',');

  // Untouched holdout tail + in-sample region + fold/regime setup — identical
  // to the composition lab so the robustness bar is the same.
  const holdoutN = Math.max(30, Math.floor(bars.length * HOLDOUT_FRAC));
  const inSample = bars.slice(0, bars.length - holdoutN);
  const holdoutBars = bars.slice(bars.length - holdoutN);
  let mode = 'folds';
  let swaths = [];
  let regimeInfo = null;
  if (benchmark && benchmark.length === bars.length) {
    const cls = regime.classify(benchmark.slice(0, inSample.length));
    if (cls.enough) {
      mode = 'regime';
      swaths = cls.swaths;
      regimeInfo = { byType: cls.byType, swaths: cls.swaths.map((s) => ({ label: s.label, days: s.days, from: s.from, to: s.to })) };
    }
  }
  const foldSize = Math.floor(inSample.length / N_FOLDS);
  const foldsBars = [];
  for (let f = 0; f < N_FOLDS; f++) {
    foldsBars.push(inSample.slice(f * foldSize, f === N_FOLDS - 1 ? inSample.length : (f + 1) * foldSize));
  }
  const scoreMix = (assets) =>
    mode === 'regime'
      ? scoreRegimes(assets, swaths, inSample, holdoutBars, costs)
      : scoreFolds(assets, foldsBars, holdoutBars, costs);

  // A random feasible split: every asset floored at MINU, the remainder
  // scattered one unit at a time onto assets still under MAXU.
  const sampleUnits = () => {
    const units = new Map(ids.map((id) => [id, MINU]));
    let remaining = TOTAL - n * MINU;
    let guard = 100000;
    while (remaining > 0 && guard-- > 0) {
      const id = ids[Math.floor(rng() * n)];
      if (units.get(id) < MAXU) {
        units.set(id, units.get(id) + 1);
        remaining--;
      }
    }
    return remaining === 0 ? units : null;
  };

  // ---- Stage 1: broad sampling → TWO contender boards. The primary board
  // keeps the best cheap harvest EDGE; a secondary board keeps the best raw
  // RETURN. Merging both into full scoring means return-good splits (which the
  // pure-harvest board would drop) still get evaluated — that's what lets the
  // quality gate surface real possibilities the harvest sort would bury.
  const CHEAP_X = [6, 22];
  // Intensity-scaled funnel (same tiers as the full-universe search); the
  // current-set base refinement is 40×120 on the finer 1% grid.
  const sizedCS = funnelSizes(samples);
  const csScale = sizedCS.fullTop / 500; // 1 / 1.25 / 1.5
  const csRefineScale = sizedCS.refineTop / 60; // 1 / 2 / 4
  refineTop = refineTop ?? 40 * csRefineScale;
  refineEvals = refineEvals ?? 120 * csRefineScale;
  finalists = finalists ?? sizedCS.finalists;
  const fullTop = Math.min(Math.round(500 * csScale), Math.max(120, Math.floor(samples / 50)));
  const RET_KEEP = Math.min(sizedCS.retKeep, fullTop);

  // Checkpointing (deploy-surviving pause) — same contract as the full lab:
  // exact broad-pass resume, deterministic post-broad redo from the board.
  const serU = (u) => [...u.entries()];
  const desU = (s) => new Map(s);
  const inputsSnap = () => ({
    assetSet, bars, benchmark, currentMix, feePct, spreadPct, lagHours,
    samples, refineTop, refineEvals, finalists, seed,
  });

  const board = [];
  const boardKeys = new Set();
  let cutoff = -Infinity;
  const retBoard = [];
  const retKeys = new Set();
  let retCutoff = -Infinity;
  let broadSampled = 0;
  let rngStateBroadEnd = null;

  if (resume && resume.phase === 'post-broad') {
    for (const b of resume.board) board.push({ key: b.key, units: desU(b.units), cheap: b.cheap });
    broadSampled = resume.broadSampled || 0;
    rngStateBroadEnd = resume.rngState;
    rng.setState(resume.rngState);
    setProgress('resuming from checkpoint…');
  } else {
    let broadStart = 0;
    if (resume && resume.phase === 'broad') {
      broadStart = resume.i;
      rng.setState(resume.rngState);
      cutoff = resume.cutoff == null ? -Infinity : resume.cutoff;
      retCutoff = resume.retCutoff == null ? -Infinity : resume.retCutoff;
      broadSampled = resume.broadSampled || 0;
      for (const b of resume.board) {
        board.push({ key: b.key, units: desU(b.units), cheap: b.cheap });
        boardKeys.add(b.key);
      }
      for (const b of resume.retBoard) {
        retBoard.push({ key: b.key, units: desU(b.units), hold: b.hold });
        retKeys.add(b.key);
      }
      setProgress('resuming from checkpoint…');
    }
    const broadSnap = (nextI) => () => ({
      engine: 'current-set',
      wrapper: checkpointWrapper,
      inputs: inputsSnap(),
      loop: {
        phase: 'broad',
        i: nextI,
        rngState: rng.getState(),
        cutoff: Number.isFinite(cutoff) ? cutoff : null,
        retCutoff: Number.isFinite(retCutoff) ? retCutoff : null,
        broadSampled,
        board: board.map((b) => ({ key: b.key, units: serU(b.units), cheap: b.cheap })),
        retBoard: retBoard.map((b) => ({ key: b.key, units: serU(b.units), hold: b.hold })),
      },
    });
    for (let i = broadStart; i < samples; i++) {
      const units = sampleUnits();
      if (units) {
        broadSampled++;
        const assets = toAssets(units);
        const hold = holdGrowthPct(assets, inSample);
        if (hold != null) {
          const key = keyOf(units);
          let bestValue = hold;
          for (const x of CHEAP_X) {
            const r = simulate(assets, x, { ...costs, bars: inSample });
            if (r.netBasketGrowthPct > 0 && r.valueGrowthPct >= hold - HOLD_BAND_PP && r.valueGrowthPct > bestValue) {
              bestValue = r.valueGrowthPct;
            }
          }
          const edge = bestValue - hold;
          if ((edge > cutoff || board.length < fullTop) && !boardKeys.has(key)) {
            board.push({ key, units, cheap: edge });
            boardKeys.add(key);
            if (board.length >= fullTop * 2) {
              board.sort((a, b) => b.cheap - a.cheap);
              for (const dropped of board.splice(fullTop)) boardKeys.delete(dropped.key);
              cutoff = board[board.length - 1].cheap;
            }
          }
          if ((hold > retCutoff || retBoard.length < RET_KEEP) && !retKeys.has(key)) {
            retBoard.push({ key, units, hold });
            retKeys.add(key);
            if (retBoard.length >= RET_KEEP * 2) {
              retBoard.sort((a, b) => b.hold - a.hold);
              for (const dropped of retBoard.splice(RET_KEEP)) retKeys.delete(dropped.key);
              retCutoff = retBoard[retBoard.length - 1].hold;
            }
          }
        }
      }
      if (i % 2000 === 0) {
        setProgress(
          `allocation search: ${i.toLocaleString()} / ${samples.toLocaleString()} splits (${board.length} contenders held)`,
          3 + (i / samples) * 77
        );
      }
      if (i % 200 === 199) await yieldLoop(broadSnap(i + 1));
    }
    board.sort((a, b) => b.cheap - a.cheap);
    board.splice(fullTop);
    // Fold the return board into full scoring (dedup by key).
    retBoard.sort((a, b) => b.hold - a.hold);
    const boardSet = new Set(board.map((b) => b.key));
    for (const rb of retBoard.slice(0, RET_KEEP)) {
      if (!boardSet.has(rb.key)) {
        board.push({ key: rb.key, units: rb.units, cheap: 0 });
        boardSet.add(rb.key);
      }
    }
    rngStateBroadEnd = rng.getState();
  }

  const postSnap = () => ({
    engine: 'current-set',
    wrapper: checkpointWrapper,
    inputs: inputsSnap(),
    loop: {
      phase: 'post-broad',
      rngState: rngStateBroadEnd,
      broadSampled,
      board: board.map((b) => ({ key: b.key, units: serU(b.units), cheap: b.cheap })),
    },
  });

  // ---- Stage 2: full-fidelity scoring of the contender board.
  const seen = new Map();
  const evalUnits = (units) => {
    const key = keyOf(units);
    if (seen.has(key)) return seen.get(key);
    const entry = { units, key, ...scoreMix(toAssets(units)) };
    seen.set(key, entry);
    return entry;
  };
  const fullScored = [];
  for (let i = 0; i < board.length; i++) {
    fullScored.push(evalUnits(board[i].units));
    if (i % 10 === 9) {
      setProgress(`full-fidelity scoring ${i + 1}/${board.length}`, 80 + (i / board.length) * 10);
      await yieldLoop(postSnap);
    }
  }
  const ranked = [...new Map(fullScored.map((s) => [s.key, s])).values()].sort(tupleRank);

  // ---- Stage 3: greedy refinement — shift 1% from one asset to another,
  // keep the variant only when it ranks better on the robustness order.
  const survivors = ranked.slice(0, refineTop);
  for (let si = 0; si < survivors.length; si++) {
    setProgress(`refining split ${si + 1}/${survivors.length}`, 90 + (si / Math.max(1, survivors.length)) * 7);
    let current = survivors[si];
    for (let e = 0; e < refineEvals; e++) {
      const u = current.units;
      const from = ids[Math.floor(rng() * n)];
      const to = ids[Math.floor(rng() * n)];
      if (from === to || u.get(from) <= MINU || u.get(to) >= MAXU) continue;
      const variant = new Map(u);
      variant.set(from, u.get(from) - 1);
      variant.set(to, u.get(to) + 1);
      const cand = evalUnits(variant);
      if (tupleRank(cand, current) < 0) current = cand;
      if (e % 20 === 19) await yieldLoop(postSnap);
    }
    survivors[si] = current;
  }

  // ---- Stage 4: finalists + the joint allocation × sensitivity sweep. Each
  // finalist carries its FULL X grid over the whole window (value + edge over
  // holding per X), so the split×sensitivity interaction is visible; `full`
  // reports that grid's best real-harvest X.
  setProgress('sensitivity sweep + holdout confirmation', 98);
  const tetherId = (assetSet.find((a) => a.isIndex) || {}).id;
  const market = marketBenchmark(benchmark, bars, tetherId);
  const summarize = (assets, entry, refFlag = false) => {
    const holdF = simulate(assets, null, { ...costs, bars }).valueGrowthPct;
    const xGrid = MINI_X.map((x) => {
      const r = simulate(assets, x, { ...costs, bars });
      return {
        x,
        value: r.valueGrowthPct,
        edge: r.valueGrowthPct - holdF,
        basket: r.netBasketGrowthPct,
        dd: r.maxValueDrawdownPct,
        trades: r.tradeCount,
      };
    });
    let best = null;
    for (const g of xGrid) {
      if (g.basket <= 0) continue;
      if (g.value < holdF - HOLD_BAND_PP) continue;
      if (!best || g.value > best.value) best = g;
    }
    const full = best
      ? { value: best.value, edge: best.edge, basket: best.basket, x: best.x, dd: best.dd, trades: best.trades, hold: holdF }
      : { value: holdF, edge: 0, basket: 0, x: null, dd: xGrid[0] ? xGrid[0].dd : 0, trades: 0, hold: holdF };
    const row = {
      assets: assets.map((a) => ({ id: a.coingecko_id, symbol: a.symbol, pct: a.target_pct, isIndex: !!a.is_index })),
      mode: entry.mode,
      holdout: entry.holdout,
      full,
      xGrid,
      recommended: refFlag ? false : entry.recommended,
    };
    if (entry.mode === 'regime') {
      row.perType = entry.perType;
      row.consistency = entry.consistency;
      row.average = entry.average;
      row.typesPositive = entry.typesPositive;
      row.typesPresent = entry.typesPresent;
    } else {
      row.positiveFolds = entry.positiveFolds;
      row.nFolds = entry.nFolds;
      row.robust = entry.robust;
      row.foldEdges = entry.foldEdges;
    }
    // Quality: whole-window return + drawdown, and whether it keeps up with
    // the market. A mix is only ★ if it harvests AND is a real possibility.
    row.netReturn = full.value;
    row.maxDD = full.dd;
    row.beatsMarket = beatsMarketOf(full, market);
    if (!refFlag) row.recommended = row.recommended && row.beatsMarket;
    if (refFlag) row.reference = true;
    return row;
  };
  // Score every survivor, then order by quality (real possibilities first) and
  // show those — the harvest-well-but-sank junk sinks below the fold and is
  // reported as a weeded count rather than cluttering the board.
  const allRows = [...new Map(survivors.map((s) => [s.key, s])).values()]
    .map((s) => summarize(toAssets(s.units), s))
    .sort(qualityRank);
  const real = allRows.filter((r) => r.beatsMarket);
  const noRealPossibility = market != null && real.length === 0;
  const rows = (real.length ? real : allRows).slice(0, finalists);
  const weededForQuality = allRows.length - rows.length;
  // Weeded rows stay inspectable (same cap and honesty rules as the lab).
  const shownSet = new Set(rows);
  const hiddenMixes = allRows.filter((r) => !shownSet.has(r)).slice(0, HIDDEN_CAP);
  const anyRecommended = rows.some((r) => r.recommended);

  // Current mix — reference only, scored identically (a single window's number
  // is not a bar to beat). Skip if any current asset lacks window coverage;
  // never let scoring it kill the search (e.g. stale targets after an index
  // switch) — degrade to "not scorable" with a warning instead.
  let currentScored = null;
  let currentMixWarning = null;
  if (currentMix && currentMix.length > 0) {
    const idset = new Set(ids);
    if (currentMix.every((m) => idset.has(m.id))) {
      try {
        const assets = currentMix.map((m) => ({
          coingecko_id: m.id, symbol: m.symbol, target_pct: m.targetPct, is_index: m.isIndex ? 1 : 0,
        }));
        currentScored = summarize(assets, scoreMix(assets), true);
      } catch (err) {
        currentMixWarning = `Current mix could not be scored for reference (${err.message}) — likely stale targets after an index switch; use "Set new targets".`;
      }
    }
  }

  const warnings = [];
  if (currentMixWarning) warnings.push(currentMixWarning);
  if (noRealPossibility) {
    warnings.push(
      'No split of your current holdings kept up with the market (holding BTC, valued in your index currency) on both return and drawdown — ' +
        'showing best-effort harvesters; none is a real upgrade over just holding the market.'
    );
  } else if (!anyRecommended) {
    const base =
      mode === 'regime'
        ? 'No split harvested across ALL market types (bull/bear/range) with a positive holdout'
        : 'No split harvested consistently across the walk-forward windows with a positive holdout';
    warnings.push(
      market
        ? `${base} while keeping up with the market — the table ranks real possibilities by robustness, but none clears the ★ bar.`
        : `${base} — on this history, rebalancing this exact set does not reliably beat holding. The table ranks capital preservation only.`
    );
  }

  return {
    mixes: rows,
    hiddenMixes,
    currentMix: currentScored,
    mode,
    regime: regimeInfo,
    noHarvest: !anyRecommended,
    market,
    noRealPossibility,
    weededForQuality,
    warnings,
    screen: [], // no solo screen in current-set mode — the set is fixed
    currentSet: true,
    weightRules: { minPct: MINU, maxPct: MAXU, stepPct: CS_STEP_PCT },
    funnel: { fullTop, retKeep: RET_KEEP, refineTop, refineEvals },
    combos: { broadSampled, contenders: board.length, fullScored: seen.size },
    window: {
      bars: bars.length,
      inSampleBars: inSample.length,
      holdoutBars: holdoutBars.length,
      nFolds: N_FOLDS,
      from: bars[0] ? bars[0].ts : null,
      to: bars.length ? bars[bars.length - 1].ts : null,
      holdoutFrom: holdoutBars[0] ? holdoutBars[0].ts : null,
    },
    evaluatedMixes: broadSampled + seen.size,
    caveat: CAVEAT,
  };
}

// User-curated candidate exclusions (profiles.compose_excluded, JSON array of
// coingecko ids): assets the user unchecked from the candidate pool — weeded
// before ANY search scope runs. The tethered index can never be excluded (every
// mix is denominated in it). Returns a Set of ids; garbage parses to empty.
function parseComposeExclusions(profile, tetherId = null) {
  let ids = [];
  try {
    const parsed = JSON.parse(profile && profile.compose_excluded ? profile.compose_excluded : '[]');
    if (Array.isArray(parsed)) ids = parsed.filter((v) => typeof v === 'string');
  } catch {
    /* unreadable -> no exclusions */
  }
  const set = new Set(ids);
  if (tetherId) set.delete(tetherId);
  return set;
}

// User-pinned MUST-INCLUDE assets (profiles.compose_pinned, JSON array of
// coingecko ids): every searched mix contains all of them — this turns the lab
// into "what works best WITH my core set". The tethered index is stripped
// (every mix holds it anyway); garbage parses to no pins. A pin overrides an
// exclusion for the same asset — the more specific intent wins.
function parseComposePins(profile, tetherId = null) {
  let ids = [];
  try {
    const parsed = JSON.parse(profile && profile.compose_pinned ? profile.compose_pinned : '[]');
    if (Array.isArray(parsed)) ids = parsed.filter((v) => typeof v === 'string');
  } catch {
    /* unreadable -> no pins */
  }
  const set = new Set(ids);
  if (tetherId) set.delete(tetherId);
  return set;
}

// A mix the account can't trade is a fantasy: when the profile has a linked
// exchange account, candidates must be tradable THERE. Kraken = an
// unambiguous SYM/USD pair exists; Bitso = any book with SYM as base
// (btc_mxn counts — the profile trades in MXN). Returns null (no filter)
// when no account is linked.
async function venueTradableFilter(profileId) {
  const account = getAccountForProfile(profileId);
  if (!account) return null;
  if (account.venue === 'kraken') {
    return {
      venue: 'kraken',
      tradable: async (symbol) => Boolean(await kraken.pairForSymbol(symbol).catch(() => null)),
    };
  }
  if (account.venue === 'bitso') {
    // A failed book fetch must NOT degrade to an empty set — that silently
    // marks every candidate "not on bitso" and the search fails with a
    // misleading count (observed live 2026-07-20). Fail with the true cause.
    let books;
    try {
      books = await bitso.availableBooks();
    } catch (err) {
      throw new Error(`Bitso book list unavailable (${err.message}) — the venue filter cannot run; retry the search`);
    }
    if (!Array.isArray(books) || books.length === 0) {
      throw new Error('Bitso returned an empty book list — the venue filter cannot run; retry the search');
    }
    const bases = new Set(books.map((b) => String(b).split('_')[0]));
    return { venue: 'bitso', tradable: async (symbol) => bases.has(String(symbol).toLowerCase()) };
  }
  return null;
}

// The evaluation window adapts to the universe instead of failing: prefer
// the requested window, shrink only as far as needed so a healthy share of
// candidates cover it, never below MIN_WINDOW_DAYS. Returns the window
// start ms given each candidate's earliest available bar.
const MIN_WINDOW_DAYS = 240;
function chooseWindowStart(earliests, requestedStartMs, nowMs) {
  if (earliests.length === 0) return requestedStartMs;
  const sorted = [...earliests].sort((a, b) => a - b);
  // The window must fit at least 70% of candidates (and at least 8 where
  // the universe has that many): it starts where the target-th candidate's
  // history begins. Deeper candidates than that don't shrink anything.
  const target = Math.min(sorted.length, Math.max(Math.min(8, sorted.length), Math.ceil(sorted.length * 0.7)));
  let ws = Math.max(requestedStartMs, sorted[target - 1]);
  const minStart = nowMs - MIN_WINDOW_DAYS * 86_400_000;
  if (ws > minStart) ws = minStart; // young stragglers drop rather than gut the window
  return ws;
}

// ---- IO wrapper for the job runner ------------------------------------------

// Current-set (allocation × sensitivity) IO wrapper: keep the EXACT current
// holdings (index + every position, frozen included — this re-weights what
// you already own), fetch their history, and search the split × sensitivity.
async function runCurrentSetSearch(profileId, ctx, setProgress = () => {}, pauseGate = null) {
  const { profile, assets, tetherAsset, days, samples, seed, idealTether = false } = ctx;
  const nowMs = Date.now();

  // The set: the index + every held/targeted position. No scanner candidates,
  // no venue filter (you already hold and trade these). User-excluded assets
  // are weeded even here — an excluded holding keeps its actual weight in the
  // profile but stays out of the re-weighting study.
  const excluded = parseComposeExclusions(profile, tetherAsset.coingecko_id);
  // A pin overrides an exclusion even here: the set is fixed, so a pin's only
  // effect in current-set mode is keeping a pinned holding in the study.
  const pinnedSet = parseComposePins(profile, tetherAsset.coingecko_id);
  for (const id of pinnedSet) excluded.delete(id);
  const holdings = assets.filter(
    (a) => !a.is_index && (a.target_pct > 0 || a.quantity > 0) && !excluded.has(a.coingecko_id)
  );
  const excludedByUser = assets
    .filter((a) => !a.is_index && (a.target_pct > 0 || a.quantity > 0) && excluded.has(a.coingecko_id))
    .map((a) => a.symbol.toLowerCase());
  if (holdings.length < 1) {
    throw new Error('this profile has no held/targeted assets besides the index — nothing to re-weight (check your candidate-pool exclusions)');
  }
  const universe = holdings.map((a) => ({ id: a.coingecko_id, symbol: a.symbol.toLowerCase(), held: true }));

  setProgress(`fetching history for ${universe.length + 1} current assets…`);
  const seriesById = await candidateSeries(universe, days, { setProgress });
  // The tether needs the symbol hint too — without it the deep-daily (Binance/
  // KuCoin) path never fires and a coin tether (e.g. USDC) silently caps at the
  // ~2y exchange window, dragging the whole study down with it via the clamp.
  seriesById.set(
    tetherAsset.coingecko_id,
    await getDailyHistory(tetherAsset.coingecko_id, days, tetherAsset.symbol ? String(tetherAsset.symbol).toLowerCase() : null)
  );

  // Optional ASSUMPTION toggle: idealize a USD-stable tether to a perfect
  // $1.00 peg (wobbles and depegs erased, stated openly in the stamp). The
  // helper refuses non-USD-stable tethers, so this can never fictionalize a
  // volatile denomination; the refusal is surfaced as a warning.
  let tetherIdealized = false;
  let idealWarning = null;
  if (idealTether) {
    const ideal = idealTetherSeries(seriesById.get(tetherAsset.coingecko_id), days, nowMs, 'daily');
    if (ideal) {
      seriesById.set(tetherAsset.coingecko_id, ideal);
      tetherIdealized = true;
    } else {
      idealWarning =
        'Idealize-tether was requested but the tether is not USD-stable (median off $1 by >3%) — using REAL tether data.';
    }
  }

  // Adaptive window (same rails as the lab): shrink only as far as needed so
  // most current assets cover it, never below MIN_WINDOW_DAYS.
  const earliests = universe
    .map((c) => (seriesById.get(c.id) || [])[0])
    .filter(Boolean)
    .map((r) => r.ts);
  let windowStart = chooseWindowStart(earliests, nowMs - days * 86_400_000, nowMs);
  // Every mix is denominated in the tether, so the window can't begin before
  // the tether's own history does. Crypto now reaches ~4y (deep-daily), but a
  // fiat book (e.g. MXN) is shallower — without this clamp the window opens to
  // the deep crypto span and the tether fails coverage.
  const tetherRows = seriesById.get(tetherAsset.coingecko_id) || [];
  if (tetherRows.length) windowStart = Math.max(windowStart, tetherRows[0].ts);
  // When the window shrank, NAME the binding series (whose history starts at
  // the chosen window start) so the stamp explains itself instead of leaving
  // a bare "auto-shrunk for coverage".
  const windowLimitedBy = [];
  if (windowStart > nowMs - (days - 2) * 86_400_000) {
    const firstOf = (aid) => (((seriesById.get(aid) || [])[0] || {}).ts);
    const near = (ts) => ts && ts >= windowStart - 3 * 86_400_000 && ts <= windowStart + 3 * 86_400_000;
    if (near(firstOf(tetherAsset.coingecko_id))) windowLimitedBy.push(String(tetherAsset.symbol).toLowerCase());
    for (const c of universe) if (near(firstOf(c.id))) windowLimitedBy.push(c.symbol);
  }
  const trimmed = new Map();
  for (const [id, rows] of seriesById) trimmed.set(id, rows.filter((r) => r.ts >= windowStart));

  const { bars, covered } = buildBars(trimmed, [tetherAsset.coingecko_id, ...universe.map((c) => c.id)]);
  if (!covered.includes(tetherAsset.coingecko_id)) {
    throw new Error('the tethered index has no usable history for this window');
  }
  if (bars.length < MIN_WINDOW_DAYS) throw new Error(`not enough overlapping daily history (${bars.length} bars)`);

  const coveredHoldings = universe.filter((c) => covered.includes(c.id));
  const droppedForCoverage = universe.filter((c) => !covered.includes(c.id)).map((c) => c.symbol);
  const assetSet = [
    { id: tetherAsset.coingecko_id, symbol: tetherAsset.symbol, isIndex: true },
    ...coveredHoldings.map((c) => ({ id: c.id, symbol: (assets.find((a) => a.coingecko_id === c.id) || {}).symbol || c.symbol, isIndex: false })),
  ];

  // The tether belongs in the current mix even at 0% target (e.g. right after
  // an index switch, before new targets are set) — simulate() requires an
  // index asset, and a 0% tether honestly represents "not holding it yet".
  const currentMix = assets
    .filter((a) => a.target_pct > 0 || a.is_index)
    .map((a) => ({ id: a.coingecko_id, symbol: a.symbol, targetPct: a.target_pct || 0, isIndex: !!a.is_index }));

  // BTC benchmark aligned to the bars enables regime mode; thin history falls
  // back to walk-forward folds automatically.
  setProgress('classifying market regimes…');
  let benchmark = null;
  try {
    const btc = await getDailyHistory('bitcoin', days, 'btc');
    const byTs = new Map(btc.map((r) => [r.ts, r.usd_price]));
    let last = null;
    benchmark = bars.map((b) => {
      const v = byTs.get(b.ts);
      if (v > 0) last = v;
      return { ts: b.ts, usd_price: last || 0 };
    });
    if (benchmark.some((r) => !(r.usd_price > 0))) benchmark = null;
  } catch (err) {
    console.error('benchmark fetch failed (folds mode):', err.message);
  }

  const account = getAccountForProfile(profileId);
  // Frozen into checkpoints so a resumed run reproduces the stamp verbatim.
  const wrapperMeta = {
    resultExtras: {
      universe: {
        considered: universe.length,
        covered: coveredHoldings.length,
        droppedForCoverage: droppedForCoverage.length,
        droppedNames: droppedForCoverage,
        excludedByUser,
        pinnedByUser: coveredHoldings.filter((c) => pinnedSet.has(c.id)).map((c) => c.symbol),
        venue: account ? account.venue : null,
        notOnVenue: [],
        requestedDays: days,
        windowDays: Math.round((nowMs - windowStart) / 86_400_000),
        windowLimitedBy,
      },
      idealTether: tetherIdealized,
    },
    warnings: idealWarning ? [idealWarning] : [],
    params: { days, samples, seed, currentSet: true, idealTether: tetherIdealized },
  };
  const result = await searchCurrentSet({
    assetSet,
    bars,
    benchmark,
    currentMix: currentMix.length > 0 ? currentMix : null,
    feePct: profile.fee_pct,
    spreadPct: profile.spread_pct,
    samples,
    seed,
    pauseGate,
    checkpointWrapper: wrapperMeta,
    setProgress,
  });
  Object.assign(result, wrapperMeta.resultExtras);
  if (wrapperMeta.warnings.length) result.warnings = [...wrapperMeta.warnings, ...(result.warnings || [])];
  return { result, params: wrapperMeta.params };
}

async function runComposeSearch(profileId, opts = {}, setProgress = () => {}, pauseGate = null) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (!profile) throw new Error('profile not found');
  const nowMs = Date.now();
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profileId);
  const tetherAsset = assets.find((a) => a.is_index);
  if (!tetherAsset) throw new Error('the composition search needs a tethered index asset — checkmark one first');

  // Deep by default now (≈4y) so the regime study has bull/bear/range to work
  // with; the adaptive window shrinks it when the universe can't cover it.
  const days = Number(opts.days) > 0 ? Number(opts.days) : 1460;
  const samples = Number(opts.samples) > 0 ? Math.min(Number(opts.samples), 2_000_000) : 100_000;
  const candidateCount = Number(opts.candidates) > 0 ? Math.min(Number(opts.candidates), 80) : 60;
  const seed = Number(opts.seed) || (Date.now() % 2 ** 31);
  const idealTether = !!opts.idealTether;

  // Current-set mode branches here: it keeps the exact holdings and searches
  // only the split × sensitivity, so it skips the whole candidate-discovery /
  // venue-filter machinery below.
  if (opts.currentSet) {
    return runCurrentSetSearch(
      profileId,
      { profile, assets, tetherAsset, days, samples, seed, idealTether },
      setProgress,
      pauseGate
    );
  }

  // heldOnly (drops-allowed) = search subsets/weights of the CURRENT holdings
  // ONLY: no scanner candidates, no venue filter (you already hold and trade
  // these), and frozen positions ARE included — the whole point is to decide
  // which of your current assets to keep or shed.
  const heldOnly = !!opts.heldOnly;

  // Universe: held risk assets (in the full lab, unfrozen only — a buy-frozen
  // asset must not be recommended INTO) + the CG top-N candidates, RESTRICTED
  // to what the profile's linked venue can trade — a mix the account can't
  // execute is a fantasy.
  setProgress('building candidate universe…');
  const held = assets.filter(
    (a) => !a.is_index && (a.target_pct > 0 || a.quantity > 0) && (heldOnly || !a.buy_frozen || a.freeze_override)
  );
  const pinnedSet = parseComposePins(profile, tetherAsset.coingecko_id);
  const pinWarnings = [];
  let top = [];
  let deepTop = [];
  if (!heldOnly) {
    try {
      // With pins, fetch a deeper market list so a pinned coin that drifted
      // below the search cut can still be injected into the universe.
      deepTop = await topCandidates({ count: pinnedSet.size ? Math.max(candidateCount, 100) : candidateCount });
      top = deepTop.slice(0, candidateCount);
    } catch (err) {
      console.error('topCandidates failed (searching held assets only):', err.message);
    }
  }
  const byId = new Map();
  for (const a of held) byId.set(a.coingecko_id, { id: a.coingecko_id, symbol: a.symbol.toLowerCase(), held: true });
  for (const c of top) {
    if (!byId.has(c.id) && c.id !== tetherAsset.coingecko_id && !fiatCode(c.id)) {
      byId.set(c.id, { id: c.id, symbol: c.symbol, rank: c.rank });
    }
  }
  // Pinned coins below the search cut enter anyway — a pin is an explicit
  // instruction, not a suggestion the rank cut may veto.
  for (const c of deepTop) {
    if (pinnedSet.has(c.id) && !byId.has(c.id) && c.id !== tetherAsset.coingecko_id && !fiatCode(c.id)) {
      byId.set(c.id, { id: c.id, symbol: c.symbol, rank: c.rank });
    }
  }
  let universe = [...byId.values()];

  // User-curated exclusions weed the pool BEFORE anything else runs — held
  // assets included (an unchecked holding keeps its live weight but stays out
  // of the study). Named in the stamp so nothing vanishes silently. A PIN on
  // the same asset overrides the exclusion (the more specific intent wins).
  const userExcluded = parseComposeExclusions(profile, tetherAsset.coingecko_id);
  for (const id of pinnedSet) {
    if (userExcluded.delete(id)) {
      const sym = ((byId.get(id) || {}).symbol || id).toUpperCase();
      pinWarnings.push(`${sym} is both pinned and excluded — the pin wins; it stays in the search.`);
    }
  }
  const excludedByUser = universe.filter((c) => userExcluded.has(c.id)).map((c) => c.symbol);
  universe = universe.filter((c) => !userExcluded.has(c.id));

  // A pin that never made the universe at all is named, not silently ignored.
  const missingPins = [...pinnedSet].filter((id) => !universe.some((c) => c.id === id));
  if (missingPins.length) {
    pinWarnings.push(
      `pinned asset(s) not in this search scope: ${missingPins.join(', ')} — ` +
        (heldOnly ? 'the drops-allowed scope searches current holdings only' : 'not held and not among the market candidates') +
        '; ignored.'
    );
  }

  const venueFilter = heldOnly ? null : await venueTradableFilter(profileId);
  const notOnVenue = [];
  if (venueFilter) {
    setProgress(`filtering ${universe.length} candidates to ${venueFilter.venue}-tradable…`);
    const kept = [];
    for (const c of universe) {
      // Held assets stay regardless — they're already on the account.
      if (c.held || (await venueFilter.tradable(c.symbol))) kept.push(c);
      else {
        notOnVenue.push(c.symbol);
        if (pinnedSet.has(c.id)) {
          pinWarnings.push(
            `pinned ${c.symbol.toUpperCase()} is not tradable on ${venueFilter.venue} — dropped despite the pin (a mix the account can't trade is a fantasy).`
          );
        }
      }
    }
    universe = kept;
  }

  setProgress(`fetching history for ${universe.length + 1} assets…`);
  const seriesById = await candidateSeries(universe, days, { setProgress });
  // The tether needs the symbol hint too — without it the deep-daily (Binance/
  // KuCoin) path never fires and a coin tether (e.g. USDC) silently caps at the
  // ~2y exchange window, dragging the whole study down with it via the clamp.
  seriesById.set(
    tetherAsset.coingecko_id,
    await getDailyHistory(tetherAsset.coingecko_id, days, tetherAsset.symbol ? String(tetherAsset.symbol).toLowerCase() : null)
  );

  // Optional ASSUMPTION toggle: idealize a USD-stable tether to a perfect
  // $1.00 peg (wobbles and depegs erased, stated openly in the stamp). The
  // helper refuses non-USD-stable tethers, so this can never fictionalize a
  // volatile denomination; the refusal is surfaced as a warning.
  let tetherIdealized = false;
  let idealWarning = null;
  if (idealTether) {
    const ideal = idealTetherSeries(seriesById.get(tetherAsset.coingecko_id), days, nowMs, 'daily');
    if (ideal) {
      seriesById.set(tetherAsset.coingecko_id, ideal);
      tetherIdealized = true;
    } else {
      idealWarning =
        'Idealize-tether was requested but the tether is not USD-stable (median off $1 by >3%) — using REAL tether data.';
    }
  }

  // Adaptive window: shrink from the requested span only as far as needed
  // so most of the venue-tradable universe covers it (never below 240d),
  // then trim every series to the chosen start.
  const earliests = universe
    .map((c) => (seriesById.get(c.id) || [])[0])
    .filter(Boolean)
    .map((r) => r.ts);
  let windowStart = chooseWindowStart(earliests, nowMs - days * 86_400_000, nowMs);
  // The window can't begin before the tether's own history: crypto reaches
  // ~4y (deep-daily) but a fiat book (e.g. MXN) is shallower, and every mix is
  // denominated in the tether. Without this the window opens to the deep
  // crypto span and the tether fails coverage.
  const tetherRows = seriesById.get(tetherAsset.coingecko_id) || [];
  if (tetherRows.length) windowStart = Math.max(windowStart, tetherRows[0].ts);
  // When the window shrank, NAME the binding series (whose history starts at
  // the chosen window start) so the stamp explains itself instead of leaving
  // a bare "auto-shrunk for coverage".
  const windowLimitedBy = [];
  if (windowStart > nowMs - (days - 2) * 86_400_000) {
    const firstOf = (aid) => (((seriesById.get(aid) || [])[0] || {}).ts);
    const near = (ts) => ts && ts >= windowStart - 3 * 86_400_000 && ts <= windowStart + 3 * 86_400_000;
    if (near(firstOf(tetherAsset.coingecko_id))) windowLimitedBy.push(String(tetherAsset.symbol).toLowerCase());
    for (const c of universe) if (near(firstOf(c.id))) windowLimitedBy.push(c.symbol);
  }
  const trimmed = new Map();
  for (const [id, rows] of seriesById) trimmed.set(id, rows.filter((r) => r.ts >= windowStart));

  const { bars, covered } = buildBars(trimmed, [tetherAsset.coingecko_id, ...universe.map((c) => c.id)]);
  if (!covered.includes(tetherAsset.coingecko_id)) {
    throw new Error('the tether has no usable history for this window');
  }
  const coveredCandidates = universe.filter((c) => covered.includes(c.id));
  // Venue-tradable candidates that still lacked full-window history — named so
  // the stamp can explain them, not just count them (the silent-drop trap).
  const coverageDroppedNames = universe.filter((c) => !covered.includes(c.id)).map((c) => c.symbol);
  for (const c of universe) {
    if (pinnedSet.has(c.id) && !covered.includes(c.id)) {
      pinWarnings.push(
        `pinned ${c.symbol.toUpperCase()} lacks usable history for the ${Math.round((nowMs - windowStart) / 86_400_000)}d window — dropped despite the pin.`
      );
    }
  }
  const pinnedInSearch = coveredCandidates.filter((c) => pinnedSet.has(c.id));
  if (bars.length < MIN_WINDOW_DAYS) throw new Error(`not enough overlapping daily history (${bars.length} bars)`);

  // Mixes go down to ONE tradable asset, so a single covered candidate is a
  // legal (if minimal) universe; zero is the only hard stop.
  const minReal = 1;
  if (coveredCandidates.length < minReal) {
    throw new Error(
      heldOnly
        ? `none of your holdings have enough history for the ${Math.round((nowMs - windowStart) / 86_400_000)}d window`
        : `no tradable candidates cover the ${Math.round((nowMs - windowStart) / 86_400_000)}d window ` +
            `(${notOnVenue.length} dropped as not on ${venueFilter ? venueFilter.venue : 'the venue'}, ` +
            `${universe.length - coveredCandidates.length} for missing history) — this should not happen with a linked venue; check /api/diagnostics`
    );
  }

  // The tether belongs in the current mix even at 0% target (e.g. right after
  // an index switch, before new targets are set) — simulate() requires an
  // index asset, and a 0% tether honestly represents "not holding it yet".
  const currentMix = assets
    .filter((a) => a.target_pct > 0 || a.is_index)
    .map((a) => ({ id: a.coingecko_id, symbol: a.symbol, targetPct: a.target_pct || 0, isIndex: !!a.is_index }));

  // BTC benchmark aligned to the bars timeline enables regime mode. Forward-
  // fill any missing bar (BTC is deep, so gaps are rare). If BTC history is
  // thin the search falls back to walk-forward folds automatically.
  setProgress('classifying market regimes…');
  let benchmark = null;
  try {
    const btc = await getDailyHistory('bitcoin', days, 'btc');
    const byTs = new Map(btc.map((r) => [r.ts, r.usd_price]));
    let last = null;
    benchmark = bars.map((b) => {
      const v = byTs.get(b.ts);
      if (v > 0) last = v;
      return { ts: b.ts, usd_price: last || 0 };
    });
    if (benchmark.some((r) => !(r.usd_price > 0))) benchmark = null; // leading gap — skip regime mode
  } catch (err) {
    console.error('benchmark fetch failed (folds mode):', err.message);
  }

  // Frozen into checkpoints so a resumed run reproduces the stamp verbatim.
  const accountForMeta = heldOnly ? getAccountForProfile(profileId) : null;
  const wrapperMeta = {
    resultExtras: {
      heldOnly,
      idealTether: tetherIdealized,
      universe: {
        considered: universe.length + notOnVenue.length,
        covered: coveredCandidates.length,
        droppedForCoverage: universe.length - coveredCandidates.length,
        droppedNames: coverageDroppedNames,
        excludedByUser,
        pinnedByUser: pinnedInSearch.map((c) => c.symbol),
        heldExcludedFrozen: heldOnly ? 0 : assets.filter((a) => !a.is_index && a.buy_frozen && !a.freeze_override).length,
        venue: venueFilter ? venueFilter.venue : accountForMeta ? accountForMeta.venue : null,
        notOnVenue,
        requestedDays: days,
        windowDays: Math.round((nowMs - windowStart) / 86_400_000),
        windowLimitedBy,
      },
    },
    warnings: [...pinWarnings, ...(idealWarning ? [idealWarning] : [])],
    params: { days, samples, candidateCount, seed, heldOnly, idealTether: tetherIdealized },
  };
  const result = await searchCompositions({
    candidates: coveredCandidates,
    tether: { id: tetherAsset.coingecko_id, symbol: tetherAsset.symbol },
    bars,
    benchmark,
    currentMix: currentMix.length > 0 ? currentMix : null,
    feePct: profile.fee_pct,
    spreadPct: profile.spread_pct,
    samples,
    // heldOnly: search subsets of the current holdings, down to a single
    // tradable asset (the full lab's sampler also floors at 1).
    minAssets: heldOnly ? 1 : undefined,
    maxAssets: heldOnly ? coveredCandidates.length : undefined,
    pinned: pinnedInSearch.map((c) => c.id),
    seed,
    pauseGate,
    checkpointWrapper: wrapperMeta,
    setProgress,
  });
  Object.assign(result, wrapperMeta.resultExtras);
  if (wrapperMeta.warnings.length) result.warnings = [...wrapperMeta.warnings, ...(result.warnings || [])];
  return { result, params: wrapperMeta.params };
}

// Resume a checkpointed (paused-through-a-deploy) search: the checkpoint's
// frozen inputs + loop state produce the identical result the uninterrupted
// run would have (broad pass exact, post-broad stages redone deterministically
// from the frozen contender board). Market drift since the pause cannot leak
// in — every input the search sees comes from the checkpoint.
async function resumeComposeSearch(cp, setProgress = () => {}, pauseGate = null) {
  if (!cp || !cp.inputs || !cp.loop) throw new Error('malformed checkpoint — cannot resume');
  const search = cp.engine === 'current-set' ? searchCurrentSet : searchCompositions;
  const w = cp.wrapper || {};
  const result = await search({
    ...cp.inputs,
    resume: cp.loop,
    checkpointWrapper: w,
    pauseGate,
    setProgress,
  });
  Object.assign(result, w.resultExtras || {});
  if (w.warnings && w.warnings.length) result.warnings = [...w.warnings, ...(result.warnings || [])];
  return { result, params: w.params || {} };
}

module.exports = {
  funnelSizes,
  searchCompositions,
  searchCurrentSet,
  buildBars,
  runComposeSearch,
  resumeComposeSearch,
  chooseWindowStart,
  mulberry32,
  parseComposeExclusions,
  parseComposePins,
  venueTradableFilter,
  MINI_X,
  CAVEAT,
};
