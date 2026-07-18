const db = require('./db');
const { simulate } = require('./backtest');
const { topCandidates, candidateSeries } = require('./candidates');
const { getDailyHistory } = require('./history');
const { fiatCode } = require('./pricing');

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
const MINI_X = [3, 5, 8, 12, 20]; // coarse sweep for scoring mixes
const HOLD_BAND_PP = 0.5;

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

// Score a mix on one window: mini X sweep + hold; the mix's score is the
// best value growth among Xs whose harvest is REAL (basket up, value not
// beaten by holding). A mix where no X qualifies scores as its hold value —
// still comparable, honestly labelled x=null.
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
    basket: best ? best.netBasketGrowthPct : 0,
    x: best ? best.x : null,
    dd: best ? best.maxValueDrawdownPct : hold.maxValueDrawdownPct,
    trades: best ? best.tradeCount : 0,
    hold: hold.valueGrowthPct,
  };
}

// Train score = the WORSE of the two train halves (regime robustness): a mix
// must work in both halves, not average its way in on one lucky regime.
function trainScore(assets, half1, half2, costs) {
  const a = scoreWindow(assets, half1, costs);
  const b = scoreWindow(assets, half2, costs);
  return { score: Math.min(a.value, b.value), halves: [a, b] };
}

// ---- the search -------------------------------------------------------------

function searchCompositions({
  candidates, // [{id, symbol, rank}] risk candidates (held + top-N), coverage-filtered
  tether, // {id, symbol}
  bars, // shared timeline with prices for every candidate + tether
  currentMix = null, // [{id, symbol, targetPct, isIndex}] incl tether, or null
  feePct = 0.38,
  spreadPct = 0.1,
  lagHours = 6,
  samples = 3000,
  minAssets = 4,
  maxAssets = 8,
  refineTop = 40,
  refineEvals = 60,
  finalists = 15,
  trainFraction = 0.6,
  seed = 42,
  setProgress = () => {},
} = {}) {
  const costs = { feePct, spreadPct, lagHours };
  const rng = mulberry32(seed);
  const pool = {
    tether,
    symbolOf: new Map(candidates.map((c) => [c.id, c.symbol])),
  };
  const candidateIds = candidates.map((c) => c.id);
  if (candidateIds.length < minAssets) {
    throw new Error(`only ${candidateIds.length} candidates have full-window history — need at least ${minAssets}`);
  }

  const nTrain = Math.floor(bars.length * trainFraction);
  const train = bars.slice(0, nTrain);
  const oos = bars.slice(nTrain);
  const half1 = train.slice(0, Math.floor(train.length / 2));
  const half2 = train.slice(Math.floor(train.length / 2));

  const seen = new Map(); // mixKey -> {mix, train}
  const evalMix = (mix) => {
    const key = mixKey(mix);
    if (seen.has(key)) return seen.get(key);
    const entry = { mix, key, train: trainScore(mixToAssets(mix, pool), half1, half2, costs) };
    seen.set(key, entry);
    return entry;
  };

  // Stage 1: seeded random sampling over groups + weights.
  let ranked = [];
  for (let i = 0; i < samples; i++) {
    if (i % 250 === 0) setProgress(`sampling mixes ${i}/${samples} (${seen.size} unique)`);
    const mix = sampleMix(rng, candidateIds, minAssets, Math.min(maxAssets, candidateIds.length));
    if (mix) evalMix(mix);
  }
  ranked = [...seen.values()].sort((a, b) => b.train.score - a.train.score);

  // Stage 2: greedy refinement of the survivors — weight jiggling (move one
  // 2.5% unit between assets or the tether) and asset swaps (replace one
  // member with an unused candidate), keeping improvements.
  const survivors = ranked.slice(0, refineTop);
  survivors.forEach((s, si) => {
    setProgress(`refining survivor ${si + 1}/${survivors.length}`);
    let current = s;
    for (let e = 0; e < refineEvals; e++) {
      const mix = current.mix;
      const ids = [...mix.units.keys()];
      const variant = { units: new Map(mix.units), tetherUnits: mix.tetherUnits };
      const move = rng();
      if (move < 0.55) {
        // move one unit between two risk assets
        const from = ids[Math.floor(rng() * ids.length)];
        const to = ids[Math.floor(rng() * ids.length)];
        if (from === to || variant.units.get(from) <= MIN_UNITS || variant.units.get(to) >= CAP_UNITS) continue;
        variant.units.set(from, variant.units.get(from) - 1);
        variant.units.set(to, variant.units.get(to) + 1);
      } else if (move < 0.8) {
        // move one unit between tether and a risk asset
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
        // swap one asset for an unused candidate, keeping its units
        const out = ids[Math.floor(rng() * ids.length)];
        const unused = candidateIds.filter((c) => !variant.units.has(c));
        if (unused.length === 0) continue;
        const inn = unused[Math.floor(rng() * unused.length)];
        const u = variant.units.get(out);
        variant.units.delete(out);
        variant.units.set(inn, u);
      }
      const cand = evalMix(variant);
      if (cand.train.score > current.train.score) current = cand;
    }
    survivors[si] = current;
  });

  // Stage 3: out-of-sample confirmation of the finalists — the column that
  // actually matters.
  const uniqueFinal = [...new Map(survivors.map((s) => [s.key, s])).values()]
    .sort((a, b) => b.train.score - a.train.score)
    .slice(0, finalists);
  setProgress('out-of-sample confirmation');
  const rows = uniqueFinal.map((s) => {
    const assets = mixToAssets(s.mix, pool);
    return {
      assets: assets.map((a) => ({ id: a.coingecko_id, symbol: a.symbol, pct: a.target_pct, isIndex: !!a.is_index })),
      train: { score: s.train.score, halves: s.train.halves },
      oos: scoreWindow(assets, oos, costs),
      full: scoreWindow(assets, bars, costs),
    };
  });
  rows.sort((a, b) => b.oos.value - a.oos.value);

  // Baseline: the profile's current mix, scored with the same machinery.
  let currentScored = null;
  if (currentMix && currentMix.length > 0) {
    const assets = currentMix.map((m) => ({
      coingecko_id: m.id,
      symbol: m.symbol,
      target_pct: m.targetPct,
      is_index: m.isIndex ? 1 : 0,
    }));
    currentScored = {
      assets: currentMix.map((m) => ({ id: m.id, symbol: m.symbol, pct: m.targetPct, isIndex: !!m.isIndex })),
      train: trainScore(assets, half1, half2, costs),
      oos: scoreWindow(assets, oos, costs),
      full: scoreWindow(assets, bars, costs),
    };
  }

  return {
    mixes: rows,
    currentMix: currentScored,
    window: {
      bars: bars.length,
      trainBars: train.length,
      oosBars: oos.length,
      from: bars[0] ? bars[0].ts : null,
      to: bars.length ? bars[bars.length - 1].ts : null,
      splitAt: oos[0] ? oos[0].ts : null,
    },
    evaluatedMixes: seen.size,
    caveat: CAVEAT,
  };
}

// ---- IO wrapper for the job runner ------------------------------------------

async function runComposeSearch(profileId, opts = {}, setProgress = () => {}) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (!profile) throw new Error('profile not found');
  const assets = db.prepare('SELECT * FROM assets WHERE profile_id = ?').all(profileId);
  const tetherAsset = assets.find((a) => a.is_index);
  if (!tetherAsset) throw new Error('the composition search needs a tethered index asset — checkmark one first');

  const days = Number(opts.days) > 0 ? Number(opts.days) : 720;
  const samples = Number(opts.samples) > 0 ? Math.min(Number(opts.samples), 20000) : 3000;
  const candidateCount = Number(opts.candidates) > 0 ? Math.min(Number(opts.candidates), 60) : 40;
  const seed = Number(opts.seed) || (Date.now() % 2 ** 31);

  // Universe: held risk assets (unfrozen — a buy-frozen asset must not be
  // recommended INTO) + the CG top-N candidates.
  setProgress('building candidate universe…');
  const held = assets.filter((a) => !a.is_index && (a.target_pct > 0 || a.quantity > 0) && !a.buy_frozen);
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
  const universe = [...byId.values()];

  setProgress(`fetching history for ${universe.length + 1} assets…`);
  const seriesById = await candidateSeries(universe.map((c) => c.id), days, { setProgress });
  seriesById.set(tetherAsset.coingecko_id, await getDailyHistory(tetherAsset.coingecko_id, days));

  const { bars, covered } = buildBars(seriesById, [tetherAsset.coingecko_id, ...universe.map((c) => c.id)]);
  if (!covered.includes(tetherAsset.coingecko_id)) {
    throw new Error('the tether has no usable history for this window');
  }
  const coveredCandidates = universe.filter((c) => covered.includes(c.id));
  if (bars.length < 240) throw new Error(`not enough overlapping daily history (${bars.length} bars)`);

  const currentMix = assets
    .filter((a) => a.target_pct > 0)
    .map((a) => ({ id: a.coingecko_id, symbol: a.symbol, targetPct: a.target_pct, isIndex: !!a.is_index }));

  const result = searchCompositions({
    candidates: coveredCandidates,
    tether: { id: tetherAsset.coingecko_id, symbol: tetherAsset.symbol },
    bars,
    currentMix: currentMix.length > 0 ? currentMix : null,
    feePct: profile.fee_pct,
    spreadPct: profile.spread_pct,
    samples,
    seed,
    setProgress,
  });
  result.universe = {
    considered: universe.length,
    covered: coveredCandidates.length,
    droppedForCoverage: universe.length - coveredCandidates.length,
    heldExcludedFrozen: assets.filter((a) => !a.is_index && a.buy_frozen).length,
  };
  return { result, params: { days, samples, candidateCount, seed } };
}

module.exports = { searchCompositions, buildBars, runComposeSearch, mulberry32, CAVEAT };
