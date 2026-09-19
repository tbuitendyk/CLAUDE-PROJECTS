// Pure, self-contained helpers for the stage engine's unit of work — the
// labelling, the committee's readings and the agreement call — which either
// the main thread OR a worker thread can run identically.
//
// WHY THIS MODULE EXISTS: parallelism is only safe here because each task is
// a pure function of its inputs. Nothing below touches a batch doc, a
// counter, or any shared state; a task takes a plain descriptor and returns a
// plain result. The orchestrator in batch.js keeps ALL mutation (progress,
// leaders, saveBatch) on the main thread, so results are accumulated in one
// place regardless of which thread produced them.
//
// DETERMINISM: every function here is deterministic given its descriptor.
// Two runs of the same descriptor produce byte-identical numbers whether they
// run on the main thread, in a worker, or interleaved with others. That is
// the property the whole project's credibility rests on, and it is why the
// parallel path is verified against a known fixture (DOT row 9 = +$185.08)
// before it is trusted.

const { toHourlyMap, forwardFill, scoreDiff, balancedBandPct, GEOMETRIES } = require('./dataset');
const { loadSymbol, loadSymbolAll, loadSymbolPinned, monthList, MIN_CHUNKS } = require('./pipeline');
const bracketLib = require('./bracket');
const { feeFracOf } = require('./paper');

// Per-thread symbol cache. Each worker keeps its own; hourly data is small
// (~7 years of one symbol is on the order of 60k candles, tens of MB), so a
// handful of duplicates across 3-4 threads is a non-issue. Minute data would
// NOT be — revisit before Phase 1.5 pulls 1m klines.
const mapCache = new Map();
const MAP_CACHE_MAX = 4; // x poolSize; keep total map memory ~200MB, not ~400MB

async function getMap(sym, p) {
  // The cache key MUST include the date range. Keyed on symbol alone, a
  // process that loaded one range and then requested another silently got the
  // first — it broke a split-boundary diagnostic on 2026-07-30 by reporting
  // two different runs as identical. Per-job worker pools masked it in real
  // jobs; that is luck, not protection.
  // A PINNED RUN READS ITS OWN FILES (3.84.0), and the key says which files,
  // or a worker that priced one run's unit would hand the next run the map
  const pin = p.pinnedFiles && Array.isArray(p.pinnedFiles[sym]) ? p.pinnedFiles[sym] : null;
  const rangeKey = pin ? `pin:${require('crypto').createHash('sha256').update(pin.join('\n')).digest('hex').slice(0, 16)}`
    : (p.allLoaded ? 'all' : `${p.startMonth || ''}..${p.endMonth || ''}`);
  const key = `${sym}|${rangeKey}`;
  if (mapCache.has(key)) {
    const v = mapCache.get(key);
    mapCache.delete(key);
    mapCache.set(key, v); // LRU touch
    return v;
  }
  const loaded = pin
    ? loadSymbolPinned(sym, pin, () => {})
    : (p.allLoaded
      ? await loadSymbolAll(sym, () => {})
      : await loadSymbol(sym, monthList(p.startMonth, p.endMonth), () => {}));
  if (!loaded.rows.length) throw new Error(`no data for ${sym}`);
  const filled = forwardFill(toHourlyMap(loaded.rows)).map;
  mapCache.set(key, filled);
  if (mapCache.size > MAP_CACHE_MAX) mapCache.delete(mapCache.keys().next().value);
  return filled;
}

// THE READINGS A MEMBER IS TRAINED ON (owner order, 2026-08-28: add the
// fourth reading, so a coin judged on its own has 8 members too).
// 'pricevol' is price and volume TOGETHER — numbers neither narrow reading
// can express and a straight-line model can never build for itself.
// EVERY EXTRA BAND, CHECKED BEFORE ANY LABEL IS WRITTEN (3.183.0). A band that
// is not a number would silently label every chunk sit-out, which is the one
// failure this design must not have.
function extraBandsOrRefuse(bands) {
  return (bands || []).map((b, i) => {
    const v = Math.abs(Number(b));
    if (!Number.isFinite(v) || !(v > 0)) {
      throw new Error(`extra ${i + 1}'s band is ${JSON.stringify(b)} — an extra's band is a declared number above nought, never auto`);
    }
    return v;
  });
}

// THE COMMITTEE, AS A LIST THE UNIT CARRIES (3.183.0, owner order 2026-09-19:
// "code it in such a way that if we add another voting member in the future ...
// then we can add another voting member when we need to").
//
// The base members are what they have always been, one per slice of the
// numbers. Each extra adds ONE more, reading its own block and marked against
// its own labels. A second extra is one more entry in the unit's list -- there
// is no branch here that knows how many there are, which is the whole point.
//
// `from` says which numbers a member reads; a spec without one is a base
// member, which is how every record written before this reads correctly.
const memberSpecs = (model, size, nExtras = 0) => [
  ...slimViewsFor(size).map((view) => ({ model, view, from: 'own' })),
  ...Array.from({ length: Math.max(0, Math.floor(Number(nExtras) || 0)) },
    (_, i) => ({ model, view: `extra${i}`, from: `extra${i}`, at: i })),
];

const slimViewsFor = (size) => (size === 1
  ? ['full', 'prices', 'volume', 'pricevol']
  : ['full', 'prices', 'volume', 'pricevol', 'cross']);

// How many members must agree, for THIS committee.
//
// A declaration may name a count PER SIZE — owner, 2026-07-31 — because one
// number cannot mean the same thing on both: an exact 7 is 7-of-8 on a context
// combo and silently unanimous on a single.
//
// THE COUNTS IN THE COMMENT THAT USED TO BE HERE WERE WRONG (3.184.0). It said
// committees are 6 and 8, from 3 slices and 2 model types. slimViewsFor gives
// FOUR slices for a single and FIVE alongside others, so they have been 8 and
// 10 for a long time. Now they are not fixed at all: a unit carrying an extra
// trains one more member per extra per stage, so the count is 9, 11, or more.
//
// SO THE SIZE IS TAKEN, NEVER GUESSED. It used to fall back to `members <= 6`
// when the caller did not pass one, which was already wrong at 8 and is wronger
// now. `members` is the real count and is still what a declared number is
// clamped to.
//
// `size` is the combo size (1 = single). Older declarations carrying a
// single ratio or count still work exactly as before.
function declaredQuorumFor(dec, members, size = null) {
  if (!dec) return null;
  const clamp = (v) => Math.max(1, Math.min(members, v));
  if (dec.quorumSingles != null || dec.quorumContexts != null) {
    // Fall back to whichever was declared if this run mixes sizes and only
    // one was named — clamped, never guessed at.
    if (size == null) {
      throw new Error('a per-size quorum needs to know the combo size — committee sizes are not fixed any more, so it cannot be read back from the member count');
    }
    const isSingle = size === 1;
    const pick = isSingle
      ? (dec.quorumSingles ?? dec.quorumContexts)
      : (dec.quorumContexts ?? dec.quorumSingles);
    return clamp(pick);
  }
  if (dec.quorumRatio) return clamp(Math.round(dec.quorumRatio * members));
  return clamp(dec.quorum || 1);
}

// Net-direction quorum call (owner's rule): majority side wins; it trades at
// rung k once its ABSOLUTE count reaches k; a tie stands aside everywhere.
function quorumCall(callArrays, i, k) {
  let up = 0;
  let down = 0;
  for (const calls of callArrays) {
    const c = calls[i];
    // LOUD ON SHAPE ERRORS. The null replay passed member OBJECTS here for
    // weeks (audit 2026-07-30, critical): every vote read undefined, every
    // committee stood aside, and the "null distribution" was a committee-
    // free world — silently. A wrong shape must crash, not abstain.
    if (c !== 1 && c !== -1 && c !== 0) {
      throw new Error(`quorumCall got a non-vote (${c === undefined ? 'undefined' : typeof c}) — pass call ARRAYS, not member objects`);
    }
    if (c === 1) up++;
    else if (c === -1) down++;
  }
  if (up === down) return 0;
  const winner = up > down ? 1 : -1;
  return Math.max(up, down) >= k ? winner : 0;
}

// Build one combo's chunks. Split/label happens separately because the null
// path must ROTATE labels between the two steps — building once and labelling
// after keeps the two paths sharing identical geometry code.
async function buildCombo(combo, branch, p) {
  const geo = GEOMETRIES[branch.geometry];
  const maps = {
    trade: await getMap(combo.trade, p),
    ctx1: combo.ctx1 ? await getMap(combo.ctx1, p) : null,
    ctx2: combo.ctx2 ? await getMap(combo.ctx2, p) : null,
  };
  const { chunks, tooEarly } = bracketLib.buildComboChunks(
    maps, branch.geometry, branch.weekdaysOnly, p.includeUnlabeled, p.extras || []);
  if (chunks.length < MIN_CHUNKS) {
    throw new Error(`only ${chunks.length} labelable chunks`
      + (tooEarly ? ` — ${tooEarly} more went to the extra look-back's warm-up` : ''));
  }
  return { geo, maps, chunks, tooEarly: tooEarly || 0 };
}

// Chronological split, band calibrated on TRAINING chunks only, then every
// chunk relabelled at that band.
//
// Default is 80/20 — unchanged, so every board recorded so far stays
// comparable. With holdout on it becomes 70/15/15 and the last slice is
// NEVER searched: the sweep picks its cell in the 15% search window, and the
// chosen cell is scored once on the holdout. That distinction is the whole
// point. Today's "test" window is what cell selection shops IN, so it is not
// held back at all once a menu has been swept over it; only a slice no
// search has touched can answer "does this work out of sample".
// The split boundaries, as their own function so the label rotation below can
// respect exactly the same windows splitAndLabel will use. Deriving them twice
// from duplicated arithmetic is how the two silently drift apart.
function splitBounds(n, holdout) {
  const nHold = holdout ? Math.max(2, Math.round(n * 0.15)) : 0;
  const nTest = Math.max(2, Math.round(n * (holdout ? 0.15 : 0.2)));
  return { nTrain: n - nTest - nHold, nTest, nHold };
}

// THE SHARE OF THE WHOLE SPAN THAT IS SEALED OFF AS THE RESERVE, and the only
// place in the system that says what it is (owner order, 2026-09-12: "That
// thirteen at the end is always gonna exist ... just do it once in one place,
// like good code design").
//
// IT IS NOT A CONTROL, deliberately. The owner's ruling: it is a fixed property
// of how the history is divided, not a setting. What it must not be is FOUR
// copies -- it was typed twice in `lib/stagework.js`, once as a named constant
// in `lib/stages.js`, and once here, and nothing kept the four in step.
const RESERVE_SHARE = 0.13;

// HOW MANY PERIODS COME OFF THE END AS THE SEALED RESERVE, before the split
// above is taken of what is left. Here beside `splitBounds` because it is the
// same arithmetic one step earlier.
function reserveChunks(n) {
  return Math.max(2, Math.round(n * RESERVE_SHARE));
}

// LABEL ROTATION, in two scopes.
//
// 'series' (the original): rotate diffPct across the whole series, then split.
// Autocorrelation and the overall class mix survive, and the feature-to-outcome
// link dies. But the split is POSITIONAL, so each rotation hands the holdout
// window outcomes from a different market epoch. Measured on BTC/ZEC daily-3d
// over 908 chunks, the majority baseline that `edge` is scored against ranged
// from 0.265 to 0.419 across seven rotations, with the real (unrotated) run at
// 0.353. Since edge = accuracy - baseline, draws measured against a baseline
// 9 points softer than the real run's are not draws of the same statistic, and
// pooling them produces a "null" that is really a mixture over baselines.
//
// 'window': rotate WITHIN each of train / search / holdout separately. Each
// window keeps its own diffPct multiset exactly, so the band calibrated on
// train is unchanged, every window's class balance is unchanged, and the
// majority baseline is identical in every draw AND identical to the real run's.
// The feature-to-outcome pairing is still destroyed inside each window, which
// is the thing the null is supposed to break. This is the scope to use when
// the question is "is this edge real", because it is the only one where the
// null and the measurement are scored against the same yardstick.
//
// 'series' is kept as the default so every board recorded so far still means
// what it meant when it was recorded.
function splitAndLabel(chunks, branch, holdout, extraBands = []) {
  const n = chunks.length;
  const { nHold, nTest } = splitBounds(n, holdout);
  const trainChunks = chunks.slice(0, n - nTest - nHold);
  const testChunks = chunks.slice(n - nTest - nHold, n - nHold);
  const holdChunks = nHold ? chunks.slice(n - nHold) : [];
  if (trainChunks.length < MIN_CHUNKS) throw new Error(`only ${trainChunks.length} training chunks after the split`);
  const bandPct = branch.band === 'auto' ? balancedBandPct(trainChunks.map((c) => c.diffPct)) : Math.abs(branch.band);
  for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);
  // AND ONE MORE SET OF ANSWERS PER EXTRA BAND (3.183.0,
  // ADDITIONAL-MEMBER-DESIGN.md section C). Same chunks, same figures, same
  // comparison -- only the threshold differs, so this costs nothing but the
  // comparison itself. Positional: altLabels[i] belongs to the unit's i-th
  // extra, in the order the unit carries them.
  //
  // AN EXTRA BAND IS ALWAYS A DECLARED NUMBER, NEVER `auto`. The band above may
  // be fitted from train because it is the engine choosing for itself; an
  // extra's band arrives from the walk, fixed in advance and held across train,
  // test and held alike, which is what the typed band % has always been.
  const extraBandPcts = extraBandsOrRefuse(extraBands);
  if (extraBandPcts.length) {
    for (const c of chunks) c.altLabels = extraBandPcts.map((b) => scoreDiff(c.diffPct / 100, b / 100));
  }
  return { trainChunks, testChunks, holdChunks, bandPct, extraBandPcts };
}

// THE SAME LABELLING AGAIN, WITH A JUDGE STRETCH THE CALLER SIZES (3.111.0,
// VERIFY-DESIGN.md Part 1): the five passes need a third stretch at a stated
// boundary, because a pass is judged on the stretch immediately after its own
// test slice. (A splitter with no held-back slice at all, splitAndLabelAt, sat
// here for the 72% retrain layout from 3.94.0 to 3.142.0; both went together.)
//
// THE BAND COMES FROM THE TRAINING SLICE AND NEVER FROM THE JUDGE. That is not
// a nicety: the band decides what counts as a move worth trading, so a band
// fitted with the judging stretch in hand has read the answer before the
// question. splitAndLabel takes it from train; so does this, and the judging
// chunks are labelled with it afterwards like every other chunk.
//
// `chunks` is everything up to and including the judge -- the caller has already
// cut the sealed reserve off the end, so nothing here can reach it.
function splitAndLabelPass(chunks, branch, nTrain, nJudge, extraBands = []) {
  const n = chunks.length;
  const judge = Math.max(1, Math.min(n - MIN_CHUNKS - 1, Math.floor(Number(nJudge) || 0)));
  const keep = Math.max(0, Math.min(n - judge - 1, Math.floor(Number(nTrain) || 0)));
  const trainChunks = chunks.slice(0, keep);
  const testChunks = chunks.slice(keep, n - judge);
  const holdChunks = chunks.slice(n - judge);
  if (trainChunks.length < MIN_CHUNKS) throw new Error(`only ${trainChunks.length} training chunks in this pass`);
  if (!testChunks.length) throw new Error('this pass has no test slice between its training slice and its judging stretch');
  const bandPct = branch.band === 'auto' ? balancedBandPct(trainChunks.map((c) => c.diffPct)) : Math.abs(branch.band);
  for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);
  // AND ONE MORE SET OF ANSWERS PER EXTRA BAND (3.183.0,
  // ADDITIONAL-MEMBER-DESIGN.md section C). Same chunks, same figures, same
  // comparison -- only the threshold differs, so this costs nothing but the
  // comparison itself. Positional: altLabels[i] belongs to the unit's i-th
  // extra, in the order the unit carries them.
  //
  // AN EXTRA BAND IS ALWAYS A DECLARED NUMBER, NEVER `auto`. The band above may
  // be fitted from train because it is the engine choosing for itself; an
  // extra's band arrives from the walk, fixed in advance and held across train,
  // test and held alike, which is what the typed band % has always been.
  const extraBandPcts = extraBandsOrRefuse(extraBands);
  if (extraBandPcts.length) {
    for (const c of chunks) c.altLabels = extraBandPcts.map((b) => scoreDiff(c.diffPct / 100, b / 100));
  }
  return { trainChunks, testChunks, holdChunks, bandPct, extraBandPcts };
}

// (splitByLayout and the quota window layouts were purged 2026-08-03 on the
// owner's order: the interlaced construction broke the signal it was meant to
// test. Nothing can run them; lib/rng.js keeps the one function that outlived
// their module.)

module.exports = { quorumCall, declaredQuorumFor, slimViewsFor, memberSpecs, extraBandsOrRefuse, buildCombo, splitAndLabel, splitAndLabelPass, splitBounds, reserveChunks, RESERVE_SHARE };
