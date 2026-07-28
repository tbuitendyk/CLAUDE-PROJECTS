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

// Per-thread symbol cache. Each worker keeps its own; hourly data is small
// (~7 years of one symbol is on the order of 60k candles, tens of MB), so a
// handful of duplicates across 3-4 threads is a non-issue. Minute data would
// NOT be — revisit before Phase 1.5 pulls 1m klines.
const mapCache = new Map();
const MAP_CACHE_MAX = 8;

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

// Chronological 80/20 split, band calibrated on TRAINING chunks only, then
// every chunk relabelled at that band.
function splitAndLabel(chunks, branch) {
  const nTest = Math.max(2, Math.round(chunks.length * 0.2));
  const trainChunks = chunks.slice(0, chunks.length - nTest);
  const testChunks = chunks.slice(chunks.length - nTest);
  const bandPct = branch.band === 'auto' ? balancedBandPct(trainChunks.map((c) => c.diffPct)) : Math.abs(branch.band);
  for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);
  return { trainChunks, testChunks, bandPct };
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
  const { trainChunks, testChunks, bandPct } = splitAndLabel(chunks, branch);
  const views = bracketLib.comboViews(combo.size, geo.featureHours / 24).views;
  const memberCalls = await trainMembers(specsFor(combo.size, stage), views, trainChunks, testChunks, branch, maps, geo);
  const fee = p.feePerLeg ?? REAL_FEE_PER_LEG;

  const streams = [{ quorum: 1, calls: testChunks.map((_, i) => quorumCall(memberCalls, i, 1)) }];
  if (stage === 'promoted') {
    for (let k = 2; k <= memberCalls.length; k++) {
      streams.push({ quorum: k, calls: testChunks.map((_, i) => quorumCall(memberCalls, i, k)) });
    }
  }
  const decQ = declaredQuorumFor(p.declared, memberCalls.length);
  let best = null;
  let declared = null;
  let controlPnl = null;
  for (const s of streams) {
    const rows = bracketLib.execSweep(testChunks, s.calls, maps.trade, geo, bandPct, fee);
    if (controlPnl === null) {
      const ctl = bracketLib.bestCell(rows.filter((r) => r.gate === 'always'), 0);
      controlPnl = ctl ? ctl.pnl : null;
    }
    if (p.declared && s.quorum === decQ) {
      const hit = rows.find((r) => r.gate === p.declared.gate && r.dMult === p.declared.dMult && r.tHours === p.declared.tHours);
      if (hit) declared = { ...hit, quorum: s.quorum, members: memberCalls.length };
    }
    const cell = bracketLib.bestCell(rows, p.minTrades);
    if (cell && (!best || cell.pnl > best.pnl)) best = { ...cell, quorum: s.quorum, members: memberCalls.length };
  }
  if (best) best.controlPnl = controlPnl;
  if (declared) declared.controlPnl = controlPnl;
  return { best, declared, bandPct, testPeriods: testChunks.length, members: memberCalls.length };
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
      const same = rows.find((r) => r.gate === selection.gate && r.dMult === selection.dMult && r.tHours === selection.tHours);
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

module.exports = { unitTask, nullRotationTask, quorumCall, declaredQuorumFor, slimViewsFor, buildCombo, splitAndLabel, specsFor };
