const db = require('./db');
const { simulate } = require('./backtest');
const { indexUsdFor, priceAsset } = require('./balancer');
const { topCandidates, candidateSeries } = require('./candidates');
const { getDailyHistory } = require('./history');
const { fiatCode } = require('./pricing');
const { getAccountForProfile } = require('./sync');
const kraken = require('./exchanges/kraken');
const bitso = require('./exchanges/bitso');
const regime = require('./regime');

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

// Deterministic PRNG so a seed reproduces a search exactly.
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

function sampleMix(rng, candidateIds, minAssets, maxAssets) {
  const k = minAssets + Math.floor(rng() * (maxAssets - minAssets + 1));
  const ids = [...candidateIds];
  // Fisher–Yates partial shuffle for the subset.
  for (let i = 0; i < Math.min(k, ids.length); i++) {
    const j = i + Math.floor(rng() * (ids.length - i));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const chosen = ids.slice(0, Math.min(k, ids.length));
  const tetherUnits = TETHER_UNITS[Math.floor(rng() * TETHER_UNITS.length)];
  const units = new Map(chosen.map((id) => [id, MIN_UNITS]));
  let remaining = UNITS_TOTAL - tetherUnits - chosen.length * MIN_UNITS;
  let guard = 1000;
  while (remaining > 0 && guard-- > 0) {
    const id = chosen[Math.floor(rng() * chosen.length)];
    if (units.get(id) < CAP_UNITS) {
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
  minAssets = 4,
  maxAssets = 8,
  screenKeep = 16, // candidates surviving the solo screen
  fullTop = 500, // broad-pass contenders promoted to full fidelity
  refineTop = 60,
  refineEvals = 80,
  finalists = 20,
  benchmark = null, // BTC-aligned {ts,usd_price}[] over `bars`, enables regime mode
  seed = 42,
  setProgress = () => {},
} = {}) {
  const costs = { feePct, spreadPct, lagHours };
  const rng = mulberry32(seed);
  const pool = {
    tether,
    symbolOf: new Map(candidates.map((c) => [c.id, c.symbol])),
  };
  if (candidates.length < minAssets) {
    throw new Error(`only ${candidates.length} candidates have full-window history — need at least ${minAssets}`);
  }
  // Long runs must not starve the event loop (polls, syncs, the UI itself).
  const yieldLoop = () => new Promise((r) => setImmediate(r));

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

  // ---- Stage 0: solo screen — every candidate audited ONE ASSET AT A TIME
  // (50/50 vs the tether), scored by its screen metric (regime consistency,
  // or fold median). Bad assets are weeded out before any combinatorics.
  const screen = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    setProgress(`solo screen: ${c.symbol.toUpperCase()} (${i + 1}/${candidates.length})`, (i / candidates.length) * 3);
    const solo = [
      { coingecko_id: tether.id, symbol: tether.symbol, target_pct: 50, is_index: 1 },
      { coingecko_id: c.id, symbol: c.symbol, target_pct: 50, is_index: 0 },
    ];
    const sc = scoreMix(solo);
    screen.push({ id: c.id, symbol: c.symbol, soloTrain: sc.screenScore, positiveFolds: sc.positiveFolds || sc.typesPositive || 0 });
    if (i % 4 === 3) await yieldLoop();
  }
  screen.sort((a, b) => b.soloTrain - a.soloTrain);
  const keepN = Math.max(minAssets, Math.min(screenKeep, screen.length));
  const keptIds = new Set(screen.slice(0, keepN).map((s) => s.id));
  for (const s of screen) s.kept = keptIds.has(s.id);
  const keptIdsArr = [...keptIds];

  // ---- Stage 1: broad pass — massive seeded random sampling over the
  // screened survivors, cheaply scored by harvest EDGE over the whole
  // in-sample region (two representative X probes) into a bounded contender
  // board, so a million combos fit in memory.
  const CHEAP_X = [6, 22];
  const board = []; // {key, mix, cheap}
  const boardKeys = new Set();
  let cutoff = -Infinity;
  let broadSampled = 0;
  for (let i = 0; i < samples; i++) {
    const mix = sampleMix(rng, keptIdsArr, minAssets, Math.min(maxAssets, keptIdsArr.length));
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
        if (edge > cutoff || board.length < fullTop) {
          const key = mixKey(mix);
          if (!boardKeys.has(key)) {
            board.push({ key, mix, cheap: edge });
            boardKeys.add(key);
            if (board.length >= fullTop * 2) {
              board.sort((a, b) => b.cheap - a.cheap);
              for (const dropped of board.splice(fullTop)) boardKeys.delete(dropped.key);
              cutoff = board[board.length - 1].cheap;
            }
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
    if (i % 200 === 199) await yieldLoop();
  }
  board.sort((a, b) => b.cheap - a.cheap);
  board.splice(fullTop);

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
      await yieldLoop();
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
      if (move < 0.55) {
        const from = ids[Math.floor(rng() * ids.length)];
        const to = ids[Math.floor(rng() * ids.length)];
        if (from === to || variant.units.get(from) <= MIN_UNITS || variant.units.get(to) >= CAP_UNITS) continue;
        variant.units.set(from, variant.units.get(from) - 1);
        variant.units.set(to, variant.units.get(to) + 1);
      } else if (move < 0.8) {
        const id = ids[Math.floor(rng() * ids.length)];
        if (rng() < 0.5) {
          if (variant.tetherUnits <= TETHER_UNITS[0] || variant.units.get(id) >= CAP_UNITS) continue;
          variant.tetherUnits--;
          variant.units.set(id, variant.units.get(id) + 1);
        } else {
          if (variant.tetherUnits >= TETHER_UNITS[TETHER_UNITS.length - 1] || variant.units.get(id) <= MIN_UNITS) continue;
          variant.tetherUnits++;
          variant.units.set(id, variant.units.get(id) - 1);
        }
      } else {
        const out = ids[Math.floor(rng() * ids.length)];
        const unused = keptIdsArr.filter((c) => !variant.units.has(c));
        if (unused.length === 0) continue;
        const inn = unused[Math.floor(rng() * unused.length)];
        const u = variant.units.get(out);
        variant.units.delete(out);
        variant.units.set(inn, u);
      }
      const cand = evalMix(variant);
      if (tupleRank(cand, current) < 0) current = cand;
      if (e % 20 === 19) await yieldLoop();
    }
    survivors[si] = current;
  }

  // ---- Stage 4: finalists. A mix is a RECOMMENDATION (★) only if it cleared
  // the mode's bar — in REGIME mode, harvested in every present market type
  // AND kept a positive holdout edge; in FOLDS mode, a majority of folds +
  // positive holdout. When none qualify, that honest verdict is surfaced as a
  // warning instead of a misleading leaderboard.
  setProgress('holdout confirmation', 98);
  const summarize = (entry, assetsList) => {
    const assets = assetsList || mixToAssets(entry.mix, pool);
    const row = {
      assets: assets.map((a) => ({ id: a.coingecko_id, symbol: a.symbol, pct: a.target_pct, isIndex: !!a.is_index })),
      mode: entry.mode,
      holdout: entry.holdout,
      full: scoreWindow(assets, bars, costs),
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
    return row;
  };
  const uniqueFinal = [...new Map(survivors.map((s) => [s.key, s])).values()].sort(tupleRank).slice(0, finalists);
  const rows = uniqueFinal.map((s) => summarize(s));
  const anyRecommended = rows.some((r) => r.recommended);

  // Current mix — scored the SAME way, shown for REFERENCE only. A single
  // window's number is noise, so it is explicitly NOT a bar to beat.
  let currentScored = null;
  if (currentMix && currentMix.length > 0) {
    const assets = currentMix.map((m) => ({
      coingecko_id: m.id, symbol: m.symbol, target_pct: m.targetPct, is_index: m.isIndex ? 1 : 0,
    }));
    currentScored = { ...summarize(scoreMix(assets), assets), reference: true, recommended: false };
  }

  const warnings = [];
  if (!anyRecommended) {
    warnings.push(
      mode === 'regime'
        ? 'No mix harvested across ALL market types (bull/bear/range) with a positive holdout — on this universe and history, ' +
            'no rebalancing setup reliably beats holding in every regime. The table is a robustness ranking only, NOT a recommendation.'
        : 'No mix harvested consistently across the walk-forward windows with a positive holdout — on this universe and history, ' +
            'rebalancing does not reliably beat holding. The table is a capital-preservation ranking only, NOT a recommendation.'
    );
  }

  return {
    mixes: rows,
    currentMix: currentScored,
    mode,
    regime: regimeInfo,
    noHarvest: !anyRecommended,
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
    const books = await bitso.availableBooks().catch(() => []);
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

async function runComposeSearch(profileId, opts = {}, setProgress = () => {}) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (!profile) throw new Error('profile not found');
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profileId);
  const tetherAsset = assets.find((a) => a.is_index);
  if (!tetherAsset) throw new Error('the composition search needs a tethered index asset — checkmark one first');

  // Deep by default now (≈4y) so the regime study has bull/bear/range to work
  // with; the adaptive window shrinks it when the universe can't cover it.
  const days = Number(opts.days) > 0 ? Number(opts.days) : 1460;
  const samples = Number(opts.samples) > 0 ? Math.min(Number(opts.samples), 2_000_000) : 100_000;
  const candidateCount = Number(opts.candidates) > 0 ? Math.min(Number(opts.candidates), 60) : 40;
  const seed = Number(opts.seed) || (Date.now() % 2 ** 31);

  // Universe: held risk assets (unfrozen — a buy-frozen asset must not be
  // recommended INTO) + the CG top-N candidates, RESTRICTED to what the
  // profile's linked venue can actually trade — a mix the account can't
  // execute is a fantasy.
  setProgress('building candidate universe…');
  const held = assets.filter(
    (a) => !a.is_index && (a.target_pct > 0 || a.quantity > 0) && (!a.buy_frozen || a.freeze_override)
  );
  let top = [];
  try {
    top = await topCandidates({ count: candidateCount });
  } catch (err) {
    console.error('topCandidates failed (searching held assets only):', err.message);
  }
  const byId = new Map();
  for (const a of held) byId.set(a.coingecko_id, { id: a.coingecko_id, symbol: a.symbol.toLowerCase(), held: true });
  for (const c of top) {
    if (!byId.has(c.id) && c.id !== tetherAsset.coingecko_id && !fiatCode(c.id)) {
      byId.set(c.id, { id: c.id, symbol: c.symbol, rank: c.rank });
    }
  }
  let universe = [...byId.values()];

  const venueFilter = await venueTradableFilter(profileId);
  const notOnVenue = [];
  if (venueFilter) {
    setProgress(`filtering ${universe.length} candidates to ${venueFilter.venue}-tradable…`);
    const kept = [];
    for (const c of universe) {
      // Held assets stay regardless — they're already on the account.
      if (c.held || (await venueFilter.tradable(c.symbol))) kept.push(c);
      else notOnVenue.push(c.symbol);
    }
    universe = kept;
  }

  setProgress(`fetching history for ${universe.length + 1} assets…`);
  const seriesById = await candidateSeries(universe, days, { setProgress });
  seriesById.set(tetherAsset.coingecko_id, await getDailyHistory(tetherAsset.coingecko_id, days));

  // Adaptive window: shrink from the requested span only as far as needed
  // so most of the venue-tradable universe covers it (never below 240d),
  // then trim every series to the chosen start.
  const nowMs = Date.now();
  const earliests = universe
    .map((c) => (seriesById.get(c.id) || [])[0])
    .filter(Boolean)
    .map((r) => r.ts);
  const windowStart = chooseWindowStart(earliests, nowMs - days * 86_400_000, nowMs);
  const trimmed = new Map();
  for (const [id, rows] of seriesById) trimmed.set(id, rows.filter((r) => r.ts >= windowStart));

  const { bars, covered } = buildBars(trimmed, [tetherAsset.coingecko_id, ...universe.map((c) => c.id)]);
  if (!covered.includes(tetherAsset.coingecko_id)) {
    throw new Error('the tether has no usable history for this window');
  }
  const coveredCandidates = universe.filter((c) => covered.includes(c.id));
  if (bars.length < MIN_WINDOW_DAYS) throw new Error(`not enough overlapping daily history (${bars.length} bars)`);

  if (coveredCandidates.length < 4) {
    throw new Error(
      `only ${coveredCandidates.length} tradable candidates cover the ${Math.round((nowMs - windowStart) / 86_400_000)}d window ` +
        `(${notOnVenue.length} dropped as not on ${venueFilter ? venueFilter.venue : 'the venue'}, ` +
        `${universe.length - coveredCandidates.length} for missing history) — this should not happen with a linked venue; check /api/diagnostics`
    );
  }

  const currentMix = assets
    .filter((a) => a.target_pct > 0)
    .map((a) => ({ id: a.coingecko_id, symbol: a.symbol, targetPct: a.target_pct, isIndex: !!a.is_index }));

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

  const result = await searchCompositions({
    candidates: coveredCandidates,
    tether: { id: tetherAsset.coingecko_id, symbol: tetherAsset.symbol },
    bars,
    benchmark,
    currentMix: currentMix.length > 0 ? currentMix : null,
    feePct: profile.fee_pct,
    spreadPct: profile.spread_pct,
    samples,
    seed,
    setProgress,
  });
  result.universe = {
    considered: universe.length + notOnVenue.length,
    covered: coveredCandidates.length,
    droppedForCoverage: universe.length - coveredCandidates.length,
    heldExcludedFrozen: assets.filter((a) => !a.is_index && a.buy_frozen && !a.freeze_override).length,
    venue: venueFilter ? venueFilter.venue : null,
    notOnVenue,
    requestedDays: days,
    windowDays: Math.round((nowMs - windowStart) / 86_400_000),
  };
  return { result, params: { days, samples, candidateCount, seed } };
}

module.exports = { searchCompositions, buildBars, runComposeSearch, chooseWindowStart, mulberry32, MINI_X, CAVEAT };
