// Pure, self-contained task functions for the Bracket lab — the unit of work
// that either the main thread OR a worker thread can execute identically.
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
const { loadSymbol, loadSymbolAll, monthList, deriveShift, MIN_CHUNKS } = require('./pipeline');
const { applyLayout, rotateWithinIntervals } = require('./interlace');
const bracketLib = require('./bracket');
const { REAL_FEE_PER_LEG } = require('./paper');
const { classifierMetrics } = require('./metrics');

// One place that decides whether an execution cell IS the declared/selected
// one. Market cells carry dMult null, so a bare triple-equality on dMult
// would silently never match them; this also keeps the sweep path and the
// null replay from drifting apart, which they previously could.
function matchesDeclared(row, dec) {
  if (!dec) return false;
  const entry = dec.entry || 'breakout';
  if ((row.entry || 'breakout') !== entry) return false;
  if (row.tHours !== dec.tHours) return false;
  if (entry === 'market') return true; // gate is definitionally directional, d irrelevant
  if (row.gate !== dec.gate || row.dMult !== dec.dMult) return false;
  // null (static stop) must match null, not merely be falsy-equal to 0.
  const rt = row.trailMult == null ? null : row.trailMult;
  const dt = dec.trailMult == null ? null : dec.trailMult;
  if (rt !== dt) return false;
  if (dt == null) return true; // arm is meaningless without a trail
  return (row.armMult == null ? null : row.armMult) === (dec.armMult == null ? null : dec.armMult);
}

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
  const rangeKey = p.allLoaded ? 'all' : `${p.startMonth || ''}..${p.endMonth || ''}`;
  const key = `${sym}|${rangeKey}`;
  if (mapCache.has(key)) {
    const v = mapCache.get(key);
    mapCache.delete(key);
    mapCache.set(key, v); // LRU touch
    return v;
  }
  const loaded = p.allLoaded
    ? await loadSymbolAll(sym, () => {})
    : await loadSymbol(sym, monthList(p.startMonth, p.endMonth), () => {});
  if (!loaded.rows.length) throw new Error(`no data for ${sym}`);
  const filled = forwardFill(toHourlyMap(loaded.rows)).map;
  mapCache.set(key, filled);
  if (mapCache.size > MAP_CACHE_MAX) mapCache.delete(mapCache.keys().next().value);
  return filled;
}

const slimViewsFor = (size) => (size === 1 ? ['full', 'prices', 'volume'] : ['full', 'prices', 'volume', 'cross']);

function declaredQuorumFor(dec, members) {
  if (!dec) return null;
  if (dec.quorumRatio) return Math.max(1, Math.min(members, Math.round(dec.quorumRatio * members)));
  return Math.max(1, Math.min(members, dec.quorum || 1));
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
  const { chunks } = bracketLib.buildComboChunks(maps, branch.geometry, branch.weekdaysOnly);
  if (chunks.length < MIN_CHUNKS) throw new Error(`only ${chunks.length} labelable chunks`);
  return { geo, maps, chunks };
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
// Displacement for a rotation applied INSIDE one split window.
//
// pipeline.js's deriveShift is calibrated for a whole series: it needs n >= 20
// and always displaces by at least 8, a guard band so an autocorrelated label
// series is not merely nudged. A 15% holdout window is routinely 18-30 chunks,
// where that rule either throws or eats the whole window. So the guard band is
// scaled to the window (len/8, capped at the original 8) and the requested
// fraction spans what is left. Small windows still get a real permutation
// rather than an exception or a near-identity shift.
function windowShift(len, frac) {
  const lo = Math.max(1, Math.min(Math.floor(len / 8), 8));
  const hi = len - lo;
  if (hi <= lo) return Math.max(1, Math.floor(len / 2));
  return Math.max(1, Math.min(len - 1, Math.round(lo + frac * (hi - lo))));
}

function rotateLabels(chunks, shiftFrac, scope, holdout) {
  const n = chunks.length;
  const src = chunks.map((c) => c.diffPct);
  if (scope !== 'window') {
    const rot = deriveShift(n, shiftFrac);
    for (let i = 0; i < n; i++) chunks[i].diffPct = src[(i + rot) % n];
    return { scope: 'series', rots: [deriveShift(n, shiftFrac)] };
  }
  const { nTrain, nTest, nHold } = splitBounds(n, holdout);
  const ranges = [[0, nTrain], [nTrain, nTrain + nTest], [nTrain + nTest, n]];
  const rots = [];
  for (const [lo, hi] of ranges) {
    const len = hi - lo;
    if (len < 4) { rots.push(0); continue; }
    const rot = windowShift(len, shiftFrac);
    rots.push(rot);
    for (let i = 0; i < len; i++) chunks[lo + i].diffPct = src[lo + ((i + rot) % len)];
  }
  return { scope: 'window', rots };
}

function splitAndLabel(chunks, branch, holdout) {
  const n = chunks.length;
  const { nHold, nTest } = splitBounds(n, holdout);
  const trainChunks = chunks.slice(0, n - nTest - nHold);
  const testChunks = chunks.slice(n - nTest - nHold, n - nHold);
  const holdChunks = nHold ? chunks.slice(n - nHold) : [];
  if (trainChunks.length < MIN_CHUNKS) throw new Error(`only ${trainChunks.length} training chunks after the split`);
  const bandPct = branch.band === 'auto' ? balancedBandPct(trainChunks.map((c) => c.diffPct)) : Math.abs(branch.band);
  for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);
  return { trainChunks, testChunks, holdChunks, bandPct };
}

// QUOTA-FIRST WINDOW LAYOUTS (owner's design, 2026-07-30) — see
// lib/interlace.js for the geometry. This is the layout-aware sibling of
// splitAndLabel: assign chunks by calendar interval, purge the TRAIN side
// only, then band + label exactly as the legacy path does.
function splitByLayout(chunks, branch, geo, layout, p) {
  const seed = Number(p.interlaceSeed) || 0;
  // The purge must cover the EXECUTION path, not just the label window
  // (audit 2026-07-30, confirmed major): a trade entered at entryOffsetH can
  // stay open for the longest timeout on this job's menu plus the 3h
  // gap-scan, far past exitOffsetH — and train chunks whose features sit in
  // that path would let the committee train on candles that price its own
  // evaluation trades.
  const tMax = Math.max(...(Array.isArray(p.tHours) && p.tHours.length ? p.tHours : bracketLib.T_HOURS));
  const opts = { execEndH: geo.entryOffsetH + tMax + 3 };
  const { train, search, hold, meta } = applyLayout(chunks, geo, layout, seed, opts);
  if (train.length < MIN_CHUNKS) throw new Error(`only ${train.length} training chunks under the ${layout} layout`);
  // THE INVARIANT HOLDS ON ACTUAL PERIODS, NOT JUST POTENTIAL ONES. Real
  // data has missing-candle gaps, and the gaps do not fall evenly: the
  // first layout smoke (2026-07-30) found the interlaced arm's eval blocks
  // — which land in older, gappier eras — carrying 501/498 chunks against
  // the chronological arm's gapless 504. So each arm computes BOTH layouts
  // (cheap, deterministic), takes the common per-set count, and trims its
  // OWN eval sets from the end (latest starts dropped first). Both arms
  // reach identical targets independently — no cross-arm communication,
  // same result every time.
  const other = applyLayout(chunks, geo, layout === 'interlaced' ? 'chronological' : 'interlaced', seed, opts);
  const nSearch = Math.min(search.length, other.search.length);
  const nHold = Math.min(hold.length, other.hold.length);
  meta.evalTrimmed = { search: search.length - nSearch, hold: hold.length - nHold };
  search.length = nSearch;
  hold.length = nHold;
  let bandSource = train;
  if (p.sharedBand && branch.band === 'auto') {
    // Shared-band switch for strict arm-to-arm comparisons: the band comes
    // from chunks that are TRAIN IN BOTH layouts — unseen as evaluation by
    // either arm, so sharing leaks nothing while removing the band as a
    // second difference channel between the arms.
    const otherTrain = new Set(other.train.map((c) => c.startTs));
    const common = train.filter((c) => otherTrain.has(c.startTs));
    if (common.length >= MIN_CHUNKS) { bandSource = common; meta.bandFrom = 'common-train'; }
    else meta.bandFrom = 'own-train (common set too small)';
  }
  const bandPct = branch.band === 'auto' ? balancedBandPct(bandSource.map((c) => c.diffPct)) : Math.abs(branch.band);
  for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);
  return { trainChunks: train, testChunks: search, holdChunks: hold, bandPct, layoutMeta: meta };
}

async function trainMembers(specs, views, trainChunks, testChunks, branch, maps, geo) {
  const out = [];
  for (const spec of specs) {
    const { calls, model, picked } = await bracketLib.trainMember({
      model: spec.model,
      viewIdx: views[spec.view],
      trainChunks,
      testChunks,
      decision: branch.decision,
      tradeMap: maps.trade,
      geo,
    });
    // The fitted model rides along instead of dying here — the orchestrator
    // decides what to persist. calls-only was how eleven cycles threw away
    // everything they found (owner, 2026-07-30).
    out.push({ calls, model, picked, spec });
  }
  return out;
}

// The committee: one member per (view x model). The old second "regime"
// dimension (full vs "interlaced") was removed 2026-07-30 on the owner's
// order: it never interlaced anything — it only trimmed ~10% of the same
// contiguous window at internal 49-day seams that protected nothing — so
// half the committee were near-copies of the other half, inflating quorum
// counts without adding an opinion (QC 49). Promoted committees are now 6
// members (singles) / 8 (with contexts), and every vote is a distinct view
// of the data. Real interlacing returns as a WINDOW LAYOUT in phase 2,
// not as a member variant.
function specsFor(size, stage) {
  const specs = [];
  for (const v of slimViewsFor(size)) {
    if (stage === 'slim') specs.push({ model: 'logreg', view: v });
    else for (const model of ['logreg', 'boost']) specs.push({ model, view: v });
  }
  return specs;
}

// TASK 1 — one sweep unit (combo x branch) at the slim or promoted stage.
async function unitTask(task) {
  const { combo, branch, stage, params } = task;
  const p = params;
  // Per-payload shift lets ONE job carry many rotations.
  //
  // THE FALLBACK MUST BE KEYED ON PRESENCE, NOT ON VALUE. It used to read
  // `labelShiftFrac != null ? labelShiftFrac : p.labelShiftFrac`, so a payload
  // that deliberately said "do not rotate this one" by passing null fell
  // straight through to the run-wide setting and got rotated anyway.
  //
  // That silently destroyed cycle 10. The r=0 real arm passed null, inherited
  // the run-wide 0.5, and came out BIT-IDENTICAL to the r=10 scramble — so a
  // scramble was compared against 19 scrambles and unsurprisingly landed
  // mid-pack. The run looked healthy: 3400 units, zero failures, sensible
  // numbers. Only an implausible exact tie gave it away.
  //
  // Presence of the key is now the question, so an explicit null or 0 means
  // NO ROTATION and cannot be overridden by the run-wide default.
  const shiftFrac = Object.prototype.hasOwnProperty.call(task, 'labelShiftFrac')
    ? task.labelShiftFrac
    : p.labelShiftFrac;
  const { geo, maps, chunks } = await buildCombo(combo, branch, p);

  // LABEL ROTATION for an edge census (params.labelShiftFrac). Identical
  // mechanism to the null replay: rotate the OUTCOME side against the
  // features, so autocorrelation, class balance and band calibration all
  // survive while any real feature-to-outcome relationship is destroyed.
  //
  // This exists because "edge > 0 half the time" is an ASSUMPTION, not a
  // known null. A committee whose calls tilt toward the modal class can post
  // positive edge with no skill at all. This project's entire method rests on
  // measuring nulls rather than reasoning about them, and the edge statistic
  // had been getting a reasoned one.
  // WINDOW LAYOUT. A unit-level arm tag (from a 'both' job) wins; otherwise
  // the run-wide setting applies; 'legacy' (the default) is the untouched
  // pre-2026-07-30 path, byte-identical for every existing launcher.
  const layout = task.layoutArm
    || (p.windowLayout && p.windowLayout !== 'legacy' && p.windowLayout !== 'both' ? p.windowLayout : null);
  if (shiftFrac) {
    // Null draws must enjoy exactly the freedoms the real run had: under a
    // layout, outcomes rotate WITHIN each block interval, never across a
    // set boundary; the legacy path keeps its window/series scopes.
    if (layout) rotateWithinIntervals(chunks, layout, p.interlaceSeed, shiftFrac, windowShift);
    else rotateLabels(chunks, shiftFrac, p.labelShiftScope, p.holdout);
  }

  const split = layout
    ? splitByLayout(chunks, branch, geo, layout, p)
    : splitAndLabel(chunks, branch, p.holdout);
  const { trainChunks, testChunks, holdChunks, bandPct } = split;
  const views = bracketLib.comboViews(combo.size, geo.featureHours / 24).views;
  // ONE training pass covers both windows: members predict over search+holdout
  // concatenated, then the calls are split. Training twice would be waste, and
  // worse, an invitation for the two to be fitted differently.
  const predictChunks = holdChunks.length ? [...testChunks, ...holdChunks] : testChunks;
  const members = await trainMembers(specsFor(combo.size, stage), views, trainChunks, predictChunks, branch, maps, geo);
  const allCalls = members.map((m) => m.calls);
  const memberCalls = holdChunks.length ? allCalls.map((c) => c.slice(0, testChunks.length)) : allCalls;
  const holdCalls = holdChunks.length ? allCalls.map((c) => c.slice(testChunks.length)) : null;
  const fee = p.feePerLeg ?? REAL_FEE_PER_LEG;
  // Trailing is a PROMOTE-stage dimension only (see TRAIL_MULTS): 12x the menu
  // in the cheap slim pass would turn a 272-combo sweep into a night's work,
  // and slim ranks combos rather than refining execution.
  const sweepOpts = {
    trailing: stage === 'promoted' && !!p.trailing,
    // Custom grid if the launcher set one; undefined falls back to the
    // library constants inside execSweep.
    dMults: p.dMults, tHours: p.tHours, gates: p.gates, entries: p.entries,
  };

  const streams = [{ quorum: 1, calls: testChunks.map((_, i) => quorumCall(memberCalls, i, 1)) }];
  if (stage === 'promoted') {
    for (let k = 2; k <= memberCalls.length; k++) {
      streams.push({ quorum: k, calls: testChunks.map((_, i) => quorumCall(memberCalls, i, k)) });
    }
  }
  const decQ = declaredQuorumFor(p.declared, memberCalls.length);
  const trainLabels = trainChunks.map((c) => c.label);
  const testLabels = testChunks.map((c) => c.label);
  let best = null;
  let declared = null;
  let controlPnl = null;
  let bestStream = null;
  let declaredStream = null;
  for (const s of streams) {
    const rows = bracketLib.execSweep(testChunks, s.calls, maps.trade, geo, bandPct, fee, sweepOpts);
    if (controlPnl === null) {
      const ctl = bracketLib.bestCell(rows.filter((r) => r.gate === 'always'), 0);
      controlPnl = ctl ? ctl.pnl : null;
    }
    if (p.declared && s.quorum === decQ) {
      const hit = rows.find((r) => matchesDeclared(r, p.declared));
      if (hit) {
        declared = { ...hit, quorum: s.quorum, members: memberCalls.length };
        declaredStream = s.calls;
      }
    }
    const cell = bracketLib.bestCell(rows, p.minTrades);
    if (cell && (!best || cell.pnl > best.pnl)) {
      best = { ...cell, quorum: s.quorum, members: memberCalls.length };
      bestStream = s.calls;
    }
  }
  if (best) best.controlPnl = controlPnl;
  if (declared) declared.controlPnl = controlPnl;

  // CLASSIFICATION METRICS — the general classifier's headline numbers, on
  // the very call stream the winning cell traded. They describe the CALLS,
  // not the execution, so they are a property of the quorum rung rather than
  // of d/t/gate: two cells sharing a quorum share their metrics.
  //
  // WHY bestEdge EXISTS SEPARATELY (below). These metrics belong to whichever
  // quorum won on MONEY, which makes them a P&L-selected sample — useless for
  // asking "does this committee predict anything?", because the selection has
  // already conditioned on the answer's downstream consequence. bestEdge
  // instead takes the rung with the highest classification edge on the SEARCH
  // window and reports what that rung did on the HOLDOUT. Select on search,
  // judge on holdout, and never let money pick the rung you then evaluate as
  // a predictor.
  if (best) best.metrics = classifierMetrics(trainLabels, testLabels, bestStream);
  if (declared) declared.metrics = classifierMetrics(trainLabels, testLabels, declaredStream);

  // DRIFT CONTROLS at each cell's own horizon. "You found an asset that went
  // up" is the standing objection to every number on this board; these are
  // what answer it, so they travel WITH the cell rather than being something
  // to work out later.
  if (best) best.holds = bracketLib.holdControls(testChunks, maps.trade, geo, best.tHours, fee);
  if (declared) declared.holds = bracketLib.holdControls(testChunks, maps.trade, geo, declared.tHours, fee);

  // HOLDOUT — the slice no search has touched. The chosen cell is re-run
  // there exactly as selected (simCell, the same entry point the sweep used),
  // scored ONCE, with its own drift controls and its own classification
  // metrics. No cell is ever picked using these numbers; that is what makes
  // them worth reading.
  const holdLabels = holdChunks.map((c) => c.label);
  const scoreHold = (cell, quorum) => {
    if (!holdChunks.length || !cell) return null;
    const calls = holdChunks.map((_, i) => quorumCall(holdCalls, i, quorum));
    const r = bracketLib.simCell(cell, holdChunks, calls, maps.trade, geo, bandPct, fee);
    const h = bracketLib.holdControls(holdChunks, maps.trade, geo, cell.tHours, fee);
    return {
      periods: holdChunks.length,
      pnl: r.pnl, trades: r.trades, wins: r.wins, stops: r.stops,
      ambiguous: r.ambiguous, trailAmbiguous: r.trailAmbiguous ?? 0,
      grossPerTrade: r.grossPerTrade,
      vsAlwaysLong: r.pnl - h.alwaysLong,
      vsBuyHold: h.buyHold == null ? null : r.pnl - h.buyHold,
      holds: h,
      metrics: classifierMetrics(trainLabels, holdLabels, calls),
    };
  };
  if (best) best.holdout = scoreHold(best, best.quorum);
  if (declared) declared.holdout = scoreHold(declared, declared.quorum);

  // Per-rung classification quality, so prediction can be judged apart from
  // execution. Cheap: every stream is already computed.
  let bestEdge = null;
  for (const st of streams) {
    const mt = classifierMetrics(trainLabels, testLabels, st.calls);
    if (!mt) continue;
    if (!bestEdge || mt.edge > bestEdge.metrics.edge) {
      bestEdge = { quorum: st.quorum, members: memberCalls.length, metrics: mt };
    }
  }
  if (bestEdge && holdChunks.length) {
    const hc = holdChunks.map((_, i) => quorumCall(holdCalls, i, bestEdge.quorum));
    bestEdge.holdoutMetrics = classifierMetrics(trainLabels, holdLabels, hc);
  }

  const out = { best, declared, bestEdge, bandPct, testPeriods: testChunks.length, members: memberCalls.length, layoutMeta: split.layoutMeta || null };

  // MEMBER DUMP — everything the run learned, so it can be kept.
  // "Time is more valuable than storage" (owner, 2026-07-30). Models are
  // saved for the REAL arm; scrambled arms keep votes and scores only (their
  // models are junk by construction, their votes let any agreement threshold
  // be rebuilt without recomputing). The orchestrator writes this to disk —
  // the doc served over HTTP never carries it.
  if (stage === 'promoted') {
    const isReal = !shiftFrac;
    out.memberDump = {
      shiftFrac: shiftFrac ?? null,
      bandPct,
      layout: split.layoutMeta || null,
      specs: members.map((m) => ({ ...m.spec, picked: m.picked })),
      models: isReal ? members.map((m) => m.model) : null,
      votes: {
        search: memberCalls,
        hold: holdCalls,
      },
      labels: {
        search: testLabels,
        hold: holdChunks.length ? holdLabels : null,
      },
      startTs: {
        search: testChunks.map((c) => c.startTs),
        hold: holdChunks.map((c) => c.startTs),
      },
      // Each member scored ALONE, both windows — the committee score hid the
      // individuals for eleven cycles.
      perMember: members.map((m, i) => ({
        spec: m.spec,
        search: classifierMetrics(trainLabels, testLabels, memberCalls[i]),
        hold: holdChunks.length ? classifierMetrics(trainLabels, holdLabels, holdCalls[i]) : null,
      })),
    };
  }

  return out;
}

// TASK 2 — one null rotation for a frozen selection. The rotated world gets
// EVERY freedom the real machine had downstream of the combo: full member
// grid retrained, whole execution menu, all quorum rungs, same best-cell rule.
async function nullRotationTask({ combo, branch, params, shiftIndex, nShifts, selection }) {
  const p = params;
  const { geo, maps, chunks } = await buildCombo(combo, branch, p);
  // THE NULL RUNS THE SAME MACHINE (audit 2026-07-30, two confirmed majors
  // fixed here):
  //  1. It splits exactly as the real run did — same layout, same holdout,
  //     same seed — where it used to split 80/20 legacy regardless, so a
  //     layout-run's null was measured on a different window than sel.pnl.
  //  2. Under a layout, rotation stays inside each block interval, never
  //     crossing a set boundary (contract for layout nulls). Legacy jobs
  //     keep the whole-series rotation their recorded results used.
  const layout = (selection && selection.layoutArm)
    || (p.windowLayout && p.windowLayout !== 'legacy' && p.windowLayout !== 'both' ? p.windowLayout : null);
  const frac = shiftIndex / (nShifts + 1);
  let rot;
  if (layout) {
    rotateWithinIntervals(chunks, layout, p.interlaceSeed, frac, windowShift);
    rot = null;
  } else {
    rot = deriveShift(chunks.length, frac);
    const src = chunks.map((c) => c.diffPct);
    for (let i = 0; i < chunks.length; i++) chunks[i].diffPct = src[(i + rot) % chunks.length];
  }
  const split = layout
    ? splitByLayout(chunks, branch, geo, layout, p)
    : splitAndLabel(chunks, branch, p.holdout);
  const { trainChunks, testChunks, bandPct } = split;
  const views = bracketLib.comboViews(combo.size, geo.featureHours / 24).views;
  // trainMembers returns member OBJECTS ({calls, model, picked, spec}) since
  // L12. This line consumed them as call arrays for weeks — every quorum
  // vote read undefined and the whole null was a committee-free world
  // (audit 2026-07-30, CRITICAL). quorumCall now also throws on that shape.
  const members = await trainMembers(specsFor(combo.size, 'promoted'), views, trainChunks, testChunks, branch, maps, geo);
  const memberCalls = members.map((m) => m.calls);
  const fee = p.feePerLeg ?? REAL_FEE_PER_LEG;
  let bestOfMenu = null;
  let sameCell = null;
  for (let k = 1; k <= memberCalls.length; k++) {
    const stream = testChunks.map((_, i) => quorumCall(memberCalls, i, k));
    const rows = bracketLib.execSweep(testChunks, stream, maps.trade, geo, bandPct, fee,
      { dMults: p.dMults, tHours: p.tHours, gates: p.gates, entries: p.entries });
    const cell = bracketLib.bestCell(rows, p.minTrades);
    if (cell && (!bestOfMenu || cell.pnl > bestOfMenu.pnl)) bestOfMenu = cell;
    if (k === selection.quorum) {
      const same = rows.find((r) => matchesDeclared(r, selection));
      if (same) sameCell = same;
    }
  }
  return {
    rot,
    best: bestOfMenu ? bestOfMenu.pnl : -Infinity,
    same: sameCell ? sameCell.pnl : null,
    sameTrades: sameCell ? sameCell.trades : null,
  };
}

module.exports = { unitTask, nullRotationTask, quorumCall, declaredQuorumFor, matchesDeclared, slimViewsFor, buildCombo, splitAndLabel, splitByLayout, splitBounds, rotateLabels, windowShift, specsFor };
