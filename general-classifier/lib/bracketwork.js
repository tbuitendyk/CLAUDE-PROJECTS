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
const { loadSymbol, loadSymbolAll, monthList, deriveShift, interlacedPurge, MIN_CHUNKS } = require('./pipeline');
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
  if (mapCache.has(sym)) {
    const v = mapCache.get(sym);
    mapCache.delete(sym);
    mapCache.set(sym, v); // LRU touch
    return v;
  }
  const loaded = p.allLoaded
    ? await loadSymbolAll(sym, () => {})
    : await loadSymbol(sym, monthList(p.startMonth, p.endMonth), () => {});
  if (!loaded.rows.length) throw new Error(`no data for ${sym}`);
  const filled = forwardFill(toHourlyMap(loaded.rows)).map;
  mapCache.set(sym, filled);
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
function splitAndLabel(chunks, branch, holdout) {
  const n = chunks.length;
  const nHold = holdout ? Math.max(2, Math.round(n * 0.15)) : 0;
  const nTest = Math.max(2, Math.round(n * (holdout ? 0.15 : 0.2)));
  const trainChunks = chunks.slice(0, n - nTest - nHold);
  const testChunks = chunks.slice(n - nTest - nHold, n - nHold);
  const holdChunks = nHold ? chunks.slice(n - nHold) : [];
  if (trainChunks.length < MIN_CHUNKS) throw new Error(`only ${trainChunks.length} training chunks after the split`);
  const bandPct = branch.band === 'auto' ? balancedBandPct(trainChunks.map((c) => c.diffPct)) : Math.abs(branch.band);
  for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);
  return { trainChunks, testChunks, holdChunks, bandPct };
}

async function trainMembers(specs, views, trainChunks, testChunks, branch, maps, geo) {
  const out = [];
  for (const spec of specs) {
    const fit = spec.regime === 'interlaced' ? interlacedPurge(trainChunks, geo) : trainChunks;
    const { calls } = await bracketLib.trainMember({
      model: spec.model,
      viewIdx: views[spec.view],
      trainChunks: fit,
      testChunks,
      decision: branch.decision,
      tradeMap: maps.trade,
      geo,
    });
    out.push(calls);
  }
  return out;
}

function specsFor(size, stage) {
  const specs = [];
  for (const v of slimViewsFor(size)) {
    if (stage === 'slim') specs.push({ model: 'logreg', view: v, regime: 'full' });
    else for (const model of ['logreg', 'boost']) for (const regime of ['full', 'interlaced']) specs.push({ model, view: v, regime });
  }
  return specs;
}

// TASK 1 — one sweep unit (combo x branch) at the slim or promoted stage.
async function unitTask({ combo, branch, stage, params }) {
  const p = params;
  const { geo, maps, chunks } = await buildCombo(combo, branch, p);
  const { trainChunks, testChunks, holdChunks, bandPct } = splitAndLabel(chunks, branch, p.holdout);
  const views = bracketLib.comboViews(combo.size, geo.featureHours / 24).views;
  // ONE training pass covers both windows: members predict over search+holdout
  // concatenated, then the calls are split. Training twice would be waste, and
  // worse, an invitation for the two to be fitted differently.
  const predictChunks = holdChunks.length ? [...testChunks, ...holdChunks] : testChunks;
  const allCalls = await trainMembers(specsFor(combo.size, stage), views, trainChunks, predictChunks, branch, maps, geo);
  const memberCalls = holdChunks.length ? allCalls.map((c) => c.slice(0, testChunks.length)) : allCalls;
  const holdCalls = holdChunks.length ? allCalls.map((c) => c.slice(testChunks.length)) : null;
  const fee = p.feePerLeg ?? REAL_FEE_PER_LEG;
  // Trailing is a PROMOTE-stage dimension only (see TRAIL_MULTS): 12x the menu
  // in the cheap slim pass would turn a 272-combo sweep into a night's work,
  // and slim ranks combos rather than refining execution.
  const sweepOpts = { trailing: stage === 'promoted' && !!p.trailing };

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

  const out = { best, declared, bandPct, testPeriods: testChunks.length, members: memberCalls.length };

  // CALL EXPORT — off by default because it is per-period data and a
  // 272-combo sweep would bloat the doc. On, it is what lets a bracket result
  // seed a paper book or be re-scored later without re-running anything.
  if (p.emitCalls) {
    const stream = declaredStream || bestStream;
    if (stream) {
      out.callSeries = {
        quorum: (declared || best).quorum,
        members: memberCalls.length,
        startTs: testChunks.map((c) => c.startTs),
        calls: stream.slice(),
        labels: testLabels.slice(),
      };
    }
  }
  return out;
}

// TASK 2 — one null rotation for a frozen selection. The rotated world gets
// EVERY freedom the real machine had downstream of the combo: full member
// grid retrained, whole execution menu, all quorum rungs, same best-cell rule.
async function nullRotationTask({ combo, branch, params, shiftIndex, nShifts, selection }) {
  const p = params;
  const { geo, maps, chunks } = await buildCombo(combo, branch, p);
  const rot = deriveShift(chunks.length, shiftIndex / (nShifts + 1));
  const src = chunks.map((c) => c.diffPct);
  for (let i = 0; i < chunks.length; i++) chunks[i].diffPct = src[(i + rot) % chunks.length];
  const { trainChunks, testChunks, bandPct } = splitAndLabel(chunks, branch);
  const views = bracketLib.comboViews(combo.size, geo.featureHours / 24).views;
  const memberCalls = await trainMembers(specsFor(combo.size, 'promoted'), views, trainChunks, testChunks, branch, maps, geo);
  const fee = p.feePerLeg ?? REAL_FEE_PER_LEG;
  let bestOfMenu = null;
  let sameCell = null;
  for (let k = 1; k <= memberCalls.length; k++) {
    const stream = testChunks.map((_, i) => quorumCall(memberCalls, i, k));
    const rows = bracketLib.execSweep(testChunks, stream, maps.trade, geo, bandPct, fee);
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

module.exports = { unitTask, nullRotationTask, quorumCall, declaredQuorumFor, matchesDeclared, slimViewsFor, buildCombo, splitAndLabel, specsFor };
