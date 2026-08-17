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

// How many members must agree, for THIS committee.
//
// Committees come in two sizes and only two: 6 for a single coin (3 data
// views x 2 model types), 8 with one or two context coins (a fourth view
// appears). A declaration may therefore name a count PER SIZE — owner,
// 2026-07-31 — because one number cannot mean the same thing on both: an
// exact 7 is 7-of-8 on a context combo and silently unanimous on a single.
//
// `size` is the combo size (1 = single). Older declarations carrying a
// single ratio or count still work exactly as before.
function declaredQuorumFor(dec, members, size = null) {
  if (!dec) return null;
  const clamp = (v) => Math.max(1, Math.min(members, v));
  if (dec.quorumSingles != null || dec.quorumContexts != null) {
    // Fall back to whichever was declared if this run mixes sizes and only
    // one was named — clamped, never guessed at.
    const isSingle = size != null ? size === 1 : members <= 6;
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
  const { chunks } = bracketLib.buildComboChunks(maps, branch.geometry, branch.weekdaysOnly, p.includeUnlabeled);
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
// (splitByLayout and the quota layouts were purged 2026-08-03 on the
// owner's order: the interlaced construction broke the signal it was
// meant to test. Historical quota-layout docs remain viewable; nothing
// can run them. lib/interlace.js survives for the research tab and the
// retired walk-forward module only.)

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
  // WINDOW LAYOUT (owner ruling, 2026-08-03): three explicit options, all
  // percentage splits on the same battle-tested path. legacy80 = 80/20;
  // split70 = 70/15/15; reserve61 = seal the FINAL 13% of chunks (stamped,
  // untouched by this run — a later History Tuning winner's binding grade
  // happens there), then 70/15/15 on the rest. The quota layouts
  // (chronological/interlaced/both) are purged from new runs; task.layoutArm
  // exists only on historical docs, which never re-run through here.
  let workChunks = chunks;
  let reserveMeta = null;
  if (p.windowLayout === 'reserve61') {
    const nReserve = Math.max(2, Math.round(workChunks.length * 0.13));
    const sealed = workChunks.slice(workChunks.length - nReserve);
    reserveMeta = { chunks: nReserve, fromTs: sealed[0].startTs, toTs: sealed[sealed.length - 1].endTs };
    workChunks = workChunks.slice(0, workChunks.length - nReserve);
  }
  // (Label rotation retired 2026-08-03, register 66: null boards now deal
  // votes AFTER training — see below. task.shiftFrac survives only on
  // historical docs and is never re-run.)
  const split = splitAndLabel(workChunks, branch, p.holdout);
  if (reserveMeta) split.reserve = reserveMeta;
  const { trainChunks, testChunks, holdChunks, bandPct } = split;
  const views = bracketLib.comboViews(combo.size, geo.featureHours / 24).views;
  // ONE training pass covers both windows: members predict over search+holdout
  // concatenated, then the calls are split. Training twice would be waste, and
  // worse, an invitation for the two to be fitted differently.
  const predictChunks = holdChunks.length ? [...testChunks, ...holdChunks] : testChunks;
  const members = await trainMembers(specsFor(combo.size, stage), views, trainChunks, predictChunks, branch, maps, geo);
  // Null-board arm (register 66 deal construction): the member's real vote
  // mix, dealt onto random days — independently per member, per draw, per
  // unit, and PER SLICE.
  //
  // Per slice matters, and getting it wrong is QC 80. Dealing across the
  // concatenated test+hold span (the construction here until 1.42.0) hands
  // each null arm the POOLED vote mix of both windows, while the real arm
  // keeps each window's own mix. In a one-directional hold window that gap
  // is worth money to whichever arm is less wrong-way — so the real arm was
  // being credited for its overall directional lean, not just its timing,
  // and no amount of extra draws could have revealed it. Slice-local deals
  // remove timing information ONLY, which is what the null is for.
  // lib/walkforward.js has always done it this way; this brings the board
  // path into line with it.
  const allCalls = members.map((m) => m.calls);
  let memberCalls = holdChunks.length ? allCalls.map((c) => c.slice(0, testChunks.length)) : allCalls;
  let holdCalls = holdChunks.length ? allCalls.map((c) => c.slice(testChunks.length)) : null;
  if (task.nullDealSeed) {
    const { nullRng } = require('./walkforward');
    const unitKey = `${combo.trade}|${branch.geometry}|${branch.decision}|${stage}`;
    // ONE permutation per slice, applied to EVERY member — QC 81.
    //
    // Dealing each member independently (the construction here until 1.43.0)
    // destroys the AGREEMENT between members as well as the timing. That is
    // one thing too many. The committee only takes a position when its members
    // are not tied, so independent deals break ties apart and the null arm
    // trades less often than the real arm — for reasons that have nothing to
    // do with skill. Measured on run D's candidate: the real arm traded 310 of
    // 364 periods while all nineteen independent-deal draws traded 255-296. A
    // real arm cannot be judged against a control it out-participates by
    // construction.
    //
    // Permuting every member by the SAME order moves the committee's whole
    // vote pattern through time without changing it: the multiset of quorum
    // calls is preserved exactly, so trade count and direction mix match the
    // real arm by construction and the ONLY thing destroyed is alignment with
    // what the market actually did. That is the question the null exists to
    // ask.
    const dealTogether = (arrs, slice) => {
      if (!arrs.length || !arrs[0].length) return arrs;
      const rng = nullRng(task.nullDealSeed, unitKey, 0, 0, slice);
      const order = arrs[0].map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const t = order[i]; order[i] = order[j]; order[j] = t;
      }
      return arrs.map((calls) => order.map((k) => calls[k]));
    };
    memberCalls = dealTogether(memberCalls, 'test');
    if (holdCalls) holdCalls = dealTogether(holdCalls, 'hold');
  }
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
  const decQ = declaredQuorumFor(p.declared, memberCalls.length, combo.size);
  const trainLabels = trainChunks.map((c) => c.label);
  const testLabels = testChunks.map((c) => c.label);
  let best = null;
  let declared = null;
  let controlPnl = null;
  let bestStream = null;
  let declaredStream = null;
  // WIDEST REGION (owner, 2026-08-17). The single best cell is the best of ~1,260
  // tries and looks good on noise; a REGION of neighbouring settings that all
  // work does not. Every cell is already computed here and thrown away after
  // bestCell picks the winner, so collecting them costs a push per row and the
  // region is a second reading of work already done. Quorum is one of the
  // ordered axes, so the rows are pooled ACROSS streams before the region is cut.
  const allCells = [];
  for (const s of streams) {
    const rows = bracketLib.execSweep(testChunks, s.calls, maps.trade, geo, bandPct, fee, sweepOpts);
    for (const r of rows) allCells.push({ ...r, quorum: s.quorum });
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
  // THE DECLARED SET (owner, 2026-08-17). With the replication boxes permuted the
  // run declares many configs instead of one, and each is scored on this asset.
  // No extra compute: every cell is already in allCells, so each config is a
  // lookup. `declared` above is untouched, so a run with no permute tick behaves
  // exactly as it always has.
  let declaredSet = null;
  if (Array.isArray(p.declaredSet) && p.declaredSet.length) {
    declaredSet = [];
    for (const cfg of p.declaredSet) {
      const q = declaredQuorumFor(cfg, memberCalls.length, combo.size);
      const hit = allCells.find((r) => r.quorum === q && matchesDeclared(r, cfg));
      declaredSet.push({
        label: cfg.label,
        config: cfg,
        cell: hit ? { ...hit, quorum: q, members: memberCalls.length, controlPnl } : null,
      });
    }
  }
  // Cut the region from the pooled cells. minTrades matches the board's own
  // qualifier so a cell that never traded cannot pad a region into looking wide.
  const region = require('./plateau').widestRegion(allCells, { minTrades: p.minTrades || 1 });

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
  // Each config in the declared SET gets its own held-back score — the
  // replication tiles read HOLDOUT, so a set member without one could not be
  // counted and would silently shrink the denominator.
  if (declaredSet) {
    for (const d of declaredSet) {
      if (d.cell) {
        d.cell.holdout = scoreHold(d.cell, d.cell.quorum);
        d.cell.holds = bracketLib.holdControls(testChunks, maps.trade, geo, d.cell.tHours, fee);
      }
    }
  }

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

  const out = { best, declared, declaredSet, bestEdge, region, bandPct, testPeriods: testChunks.length, members: memberCalls.length, layoutMeta: split.layoutMeta || null,
    // Window stamps (review finding 9): the run's ACTUAL boundaries, so a
    // later History Tuning launch reads the recorded truth instead of
    // recomputing it from a cache that has since grown.
    windowStamps: {
      testStartTs: testChunks[0] ? testChunks[0].startTs : null,
      holdStartTs: holdChunks[0] ? holdChunks[0].startTs : null,
      reserveFromTs: split.reserve ? split.reserve.fromTs : null,
      reserveToTs: split.reserve ? split.reserve.toTs : null,
    } };

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
  // Quota-layout survivors (historical docs) can no longer fire replays:
  // the interlaced machinery is purged (owner, 2026-08-03) and a null that
  // exercises retired machinery calibrates nothing. Old boards stay
  // viewable; only their replay button refuses.
  if (selection && selection.layoutArm) {
    throw new Error('null replay unavailable: this survivor came from a retired quota-layout run '
      + '(interlaced purge, 2026-08-03). Re-run the setup under a current layout first.');
  }
  // reserve61: the null must see exactly the data the real run saw — the
  // sealed reserve stays sealed here too.
  let workChunks = chunks;
  if (p.windowLayout === 'reserve61') {
    const nReserve = Math.max(2, Math.round(workChunks.length * 0.13));
    workChunks = workChunks.slice(0, workChunks.length - nReserve);
  }
  // REBUILT NULL (register 66, 2026-08-03): no more label rotation — that
  // construction leaked market knowledge at small offsets (day-stepping
  // chunks overlap). Members train on the REAL data exactly as the real run
  // did; each member's TEST CALLS are then dealt onto random days (real
  // vote mix, zero date knowledge), independently per member per round.
  const split = splitAndLabel(workChunks, branch, p.holdout);
  const { trainChunks, testChunks, bandPct } = split;
  const views = bracketLib.comboViews(combo.size, geo.featureHours / 24).views;
  // trainMembers returns member OBJECTS ({calls, model, picked, spec}) since
  // L12. This line consumed them as call arrays for weeks — every quorum
  // vote read undefined and the whole null was a committee-free world
  // (audit 2026-07-30, CRITICAL). quorumCall now also throws on that shape.
  const members = await trainMembers(specsFor(combo.size, 'promoted'), views, trainChunks, testChunks, branch, maps, geo);
  const { nullRng, dealVotes } = require('./walkforward');
  const memberCalls = members.map((m, mI) => dealVotes(m.calls,
    nullRng(shiftIndex + 1, `${combo.trade}|${branch.geometry}|${branch.decision}`, 0, mI, 'replay')));
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
    // `rot` (the retired rotation fraction) died with the label-rotation
    // construction, but its name survived here — an undeclared identifier
    // in a return object throws on EVERY call, so Tool 1's replay was dead
    // on arrival. The consumer keys on shiftIndex alone. Executed end to
    // end by tests/test-gatepipe.js on the fabricated pair.
    shiftIndex,
    best: bestOfMenu ? bestOfMenu.pnl : -Infinity,
    same: sameCell ? sameCell.pnl : null,
    sameTrades: sameCell ? sameCell.trades : null,
  };
}

// TASK 3 — the FULL menu grid for one promoted unit, from its stored votes
// (owner order, 2026-08-04: "we need to see the whole results ... zillions of
// permutations"). No retraining: the model dump recorded every member's
// test-window calls, so the whole execution menu re-scores from the record.
// TEST WINDOW ONLY, on purpose: printing held-back money for thousands of
// cells would turn the graded window into another shopping window.
// SELF-CHECKING: the reconstructed test chunks must match the dump's recorded
// chunk timestamps and band exactly, or the grid refuses — a grid silently
// scored on a different data cut is the classic instrument lie.
async function menuGridTask({ combo, branch, params, dump }) {
  const p = params;
  if (!dump || !dump.votes || !Array.isArray(dump.votes.search)) {
    throw new Error('this row\'s stored record carries no member votes — grids need a promoted row from an engine 1.29+ run');
  }
  const { geo, maps, chunks } = await buildCombo(combo, branch, p);
  let workChunks = chunks;
  if (p.windowLayout === 'reserve61') {
    const nReserve = Math.max(2, Math.round(workChunks.length * 0.13));
    workChunks = workChunks.slice(0, workChunks.length - nReserve);
  }
  const split = splitAndLabel(workChunks, branch, p.holdout);
  const { testChunks, bandPct } = split;
  const st = dump.startTs && dump.startTs.search;
  if (!st || st.length !== testChunks.length || st[0] !== testChunks[0].startTs
      || st[st.length - 1] !== testChunks[testChunks.length - 1].startTs) {
    throw new Error('the stored votes do not line up with today\'s data cut (the cache changed since this run) — re-run the sweep; a grid on shifted windows would be fiction');
  }
  const gridBand = dump.bandPct ?? bandPct;
  if (dump.bandPct != null && Math.abs(dump.bandPct - bandPct) > 1e-9) {
    throw new Error('the recorded band no longer matches a fresh cut of the same data — re-run the sweep');
  }
  const calls = dump.votes.search;
  const fee = p.feePerLeg ?? REAL_FEE_PER_LEG;
  const cells = [];
  for (let k = 1; k <= calls.length; k++) {
    const stream = testChunks.map((_, i) => quorumCall(calls, i, k));
    const rows = bracketLib.execSweep(testChunks, stream, maps.trade, geo, gridBand, fee, {
      dMults: p.dMults, tHours: p.tHours, gates: p.gates, entries: p.entries,
      trailing: !!p.trailing,
    });
    for (const r of rows) cells.push({ quorum: k, members: calls.length, ...r });
  }
  // HELD-BACK AGGREGATE ONLY (owner order, 2026-08-04): every cell is scored
  // once on the hold window from the stored hold votes, but individual
  // held-back numbers NEVER leave this function — only their average and the
  // share positive. Printing them per cell would turn the graded window into
  // another shopping window; an average cannot be shopped from.
  let holdAvg = null;
  let holdPosShare = null;
  let holdCellCount = 0;
  const { holdChunks } = split;
  const holdCalls = dump.votes.hold;
  // Same alignment rule as the test window above: stored hold votes applied
  // to shifted hold windows would be fiction with the right units.
  const hst = dump.startTs && dump.startTs.hold;
  if (holdChunks.length && Array.isArray(hst)
      && (hst.length !== holdChunks.length || hst[0] !== holdChunks[0].startTs
          || hst[hst.length - 1] !== holdChunks[holdChunks.length - 1].startTs)) {
    throw new Error('the stored HOLD votes do not line up with today\'s data cut — re-run the sweep; a hold average on shifted windows would be fiction');
  }
  if (holdChunks.length && Array.isArray(holdCalls) && holdCalls.length === calls.length) {
    // COMPOSITION MATTERS (review 2026-08-04 MODERATE): cells that never
    // traded contribute exactly $0 and always-gate cells ignore the votes,
    // so the identical always row repeats once per agreement level. Both
    // dilute the average toward zero and flatter any trading candidate. The
    // aggregate is therefore taken over cells that TRADED, with always-gate
    // cells counted once, and both denominators are disclosed.
    let sum = 0;
    let pos = 0;
    let allCells = 0;
    for (let k = 1; k <= holdCalls.length; k++) {
      const stream = holdChunks.map((_, i) => quorumCall(holdCalls, i, k));
      const rows = bracketLib.execSweep(holdChunks, stream, maps.trade, geo, gridBand, fee, {
        dMults: p.dMults, tHours: p.tHours, gates: p.gates, entries: p.entries,
        trailing: !!p.trailing,
      });
      for (const r of rows) {
        allCells++;
        if (r.gate === 'always' && k > 1) continue; // identical to k=1: count once
        if (!r.trades) continue;                     // never traded: $0 by absence, not skill
        holdCellCount++;
        sum += r.pnl;
        if (r.pnl > 0) pos++;
      }
    }
    holdAvg = holdCellCount ? sum / holdCellCount : null;
    holdPosShare = holdCellCount ? pos / holdCellCount : null;
    var holdAllCellCount = allCells;
  }
  return {
    window: 'test',
    testChunkCount: testChunks.length,
    holdChunkCount: holdChunks.length,
    bandPct: gridBand,
    quorums: calls.length,
    cells,
    holdAvg,
    holdPosShare,
    holdCellCount,
    holdAllCellCount: typeof holdAllCellCount !== 'undefined' ? holdAllCellCount : 0,
  };
}

module.exports = { unitTask, nullRotationTask, menuGridTask, quorumCall, trainMembers, declaredQuorumFor, matchesDeclared, slimViewsFor, buildCombo, splitAndLabel, splitBounds, rotateLabels, windowShift, specsFor };
