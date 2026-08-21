// WALK-FORWARD — the stacked train/test/hold instrument
// (reports/DESIGN-WALKFORWARD.md on the vps-access branch, owner-approved
// 2026-07-31). Replaces single-draw holdout verdicts (QC 57).
//
// THE FOLD. At fold time t:
//   TRAIN  every chunk whose candles end safely before t (purged by the
//          full execution reach). Recency weighting (the ~1-year member
//          half-life measured in H1a) is deliberately ABSENT: the first
//          cut implemented it by duplicating the trailing 104 weeks, which
//          put byte-copies of training rows into the members' validation
//          slice and tuned lambda / boost rounds / tau in-sample (QC 58).
//          It returns only as true per-row sample weights, never by
//          repeating rows.
//   TEST   the next 8 weeks: members vote, and the assembly — agreement
//          level x execution cell — is picked HERE, fresh, per fold.
//          Chunks whose trades could run into the hold slice are excluded
//          from the pick, so selection never touches hold candles.
//   HOLD   the 8 weeks after that: the picked assembly scored ONCE.
// Step 8 weeks; hold slices tile all of history after the warm-up. Slice
// and step sizes are UNIFORM across coins (the count invariant); what may
// later personalize per coin is the temporal treatment inside folds, via
// the calibration ledgers this instrument's own output feeds.
//
// Every fold also records each member's solo held-back edge — the
// block-scored skill series the per-coin calibration ledger is built from.
//
// Pure module in the bracketwork mold: tasks are pure functions of their
// payloads; all doc mutation stays in batch.js on the main thread.
const bracketLib = require('./bracket');
const { buildCombo, specsFor, quorumCall } = require('./bracketwork');
const { balancedBandPct, scoreDiff, GEOMETRIES } = require('./dataset');
const { REAL_FEE_PER_LEG } = require('./paper');
const { classifierMetrics } = require('./metrics');
const { MIN_CHUNKS } = require('./pipeline');

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const TEST_WEEKS = 8; // derived: assembly transfer is strong only at <6mo gaps
const HOLD_WEEKS = 8;
const STEP_WEEKS = 8; // hold slices tile history exactly
const WARMUP_WEEKS = 52; // minimum training history before the first fold [GUESSED]

// The uniform fold grid over a coin's chunk span. Same arithmetic for every
// coin: identical spans yield identical grids (the count invariant).
function foldGrid(firstTs, lastTs) {
  const folds = [];
  let t = firstTs + WARMUP_WEEKS * WEEK_MS;
  while (t + (TEST_WEEKS + HOLD_WEEKS) * WEEK_MS <= lastTs + DAY_MS) {
    folds.push({
      testStart: t,
      holdStart: t + TEST_WEEKS * WEEK_MS,
      holdEnd: t + (TEST_WEEKS + HOLD_WEEKS) * WEEK_MS,
    });
    t += STEP_WEEKS * WEEK_MS;
  }
  return folds;
}

// One chunk's full candle reach past its start: features, label window, or
// the longest possible execution path — same arithmetic the layout purge
// used (QC 52). The +3 on the exit offset covers every shape: the weekly
// label averages a 6h window whose last candle closes 3h past the offset,
// and a point exit's own candle still has to close.
function reachMs(geo, tHoursMenu) {
  const tMax = Math.max(...(Array.isArray(tHoursMenu) && tHoursMenu.length ? tHoursMenu : bracketLib.T_HOURS));
  return Math.max(geo.featureHours, geo.exitOffsetH + 3, geo.entryOffsetH + tMax + 3) * HOUR_MS;
}

// The three slices of one fold, each purged so nothing trained or picked can
// touch a later slice's candles. Pure and exported so the purge arithmetic
// is testable on its own — the review caught the inline version training on
// duplicated rows, which no test could see (QC 58).
function foldSlices(chunks, f, reach) {
  return {
    trainChunks: chunks.filter((c) => c.startTs + reach <= f.testStart),
    testChunks: chunks.filter((c) => c.startTs >= f.testStart && c.startTs + reach <= f.holdStart),
    holdChunks: chunks.filter((c) => c.startTs >= f.holdStart && c.startTs < f.holdEnd),
  };
}

// ---- the NULL RUN (QC 66, owner-redesigned 2026-08-01) ----------------------
// The zero-knowledge baseline. The FIRST construction slid each fold's
// votes off their dates by a common rotation — and the owner caught the
// flaw from first principles: chunks step one day apart and overlap, so a
// slide landing within a few days of its origin (a regular occurrence at
// both ends of the window) still reads largely the same market. That
// yardstick was part-informed, and any keep-out patch would have needed a
// GUESSED "relevance distance".
//
// The rebuilt construction: per fold, per member, per slice, the member's
// REAL vote mix — the exact multiset of ups/downs/stand-asides it actually
// produced — is DEALT onto random days (a seeded shuffle). Zero date
// knowledge by construction: no vote retains any tie to the day it was
// formed for, so there is no distance to assume. Vote habits are preserved
// statistically (same mix per member); the committee's day-by-day
// agreement structure is deliberately NOT preserved — that is part of what
// gets randomized, per the owner's design.
//
// Deterministic in (seed, unit, fold, member, slice): reruns are
// byte-identical, and different seeds give independent luck draws.
const { mulberry32 } = require('./rng');

function nullRng(seed, unitKey, foldIdx, memberIdx, slice) {
  let h = (Number(seed) >>> 0) || 1;
  const s = `${unitKey}|${foldIdx}|${memberIdx}|${slice}`;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761) >>> 0;
  return mulberry32(h);
}

// Seeded Fisher-Yates: the same votes, dealt onto random positions.
function dealVotes(calls, rng) {
  const out = calls.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

// All folds for one (coin, shape, decision) unit. Serial inside the task;
// units parallelize across workers.
async function wfUnitTask({ combo, branch, params }) {
  const p = params;
  // Arm safety at the task level too, not only in wfParams: a direct
  // caller passing 0/NaN must not silently run the REAL arm under a null
  // flag (review 2026-08-01) — refusing to guess which arm this is.
  if (p.nullShiftSeed !== undefined && (!Number.isInteger(p.nullShiftSeed) || p.nullShiftSeed < 1)) {
    throw new Error(`nullShiftSeed is present but not a whole number >= 1 (${JSON.stringify(p.nullShiftSeed)}) — which arm is this?`);
  }
  const { geo, maps, chunks } = await buildCombo(combo, branch, p);
  const fee = p.feePerLeg ?? REAL_FEE_PER_LEG;
  const reach = reachMs(geo, p.tHours);
  const minTrades = p.minTradesSlice ?? 5; // floor per 8-week slice [GUESSED]
  const grid = foldGrid(chunks[0].startTs, chunks[chunks.length - 1].startTs);
  const specs = specsFor(combo.size, 'promoted');
  const views = bracketLib.comboViews(combo.size, geo.featureHours / 24).views;
  const folds = [];

  for (const f of grid) {
    const { trainChunks, testChunks, holdChunks } = foldSlices(chunks, f, reach);
    if (trainChunks.length < MIN_CHUNKS) {
      folds.push({ testStart: f.testStart, skipped: 'insufficient train history' });
      continue;
    }
    // Honest skip reasons: a thin hold slice can only be missing data, but a
    // thin test slice can also be the execution purge eating its tail.
    if (holdChunks.length < 8) {
      folds.push({ testStart: f.testStart, skipped: 'hold slice too thin (data gap)' });
      continue;
    }
    if (testChunks.length < 8) {
      folds.push({ testStart: f.testStart, skipped: 'test slice too thin (data gap or execution purge)' });
      continue;
    }
    // Band on this fold's training data only, then every chunk relabeled.
    const bandPct = branch.band === 'auto'
      ? balancedBandPct(trainChunks.map((c) => c.diffPct))
      : Math.abs(branch.band);
    for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);

    const predict = [...testChunks, ...holdChunks];
    const members = [];
    for (const spec of specs) {
      members.push(await bracketLib.trainMember({
        model: spec.model, viewIdx: views[spec.view], trainChunks,
        testChunks: predict, decision: branch.decision, feePerLeg: fee, tradeMap: maps.trade, geo,
      }));
    }
    const testCalls = members.map((m) => m.calls.slice(0, testChunks.length));
    const holdCalls = members.map((m) => m.calls.slice(testChunks.length));
    if (p.nullShiftSeed) {
      // Null run (QC 66 construction): each member's real vote mix, dealt
      // onto random days, per slice. memberHoldEdges below are computed
      // from the dealt calls too — in a null doc every number is a null
      // number.
      const unitKey = `${combo.trade}|${branch.geometry}|${branch.decision}`;
      for (let mI = 0; mI < members.length; mI++) {
        testCalls[mI] = dealVotes(testCalls[mI], nullRng(p.nullShiftSeed, unitKey, folds.length, mI, 'test'));
        holdCalls[mI] = dealVotes(holdCalls[mI], nullRng(p.nullShiftSeed, unitKey, folds.length, mI, 'hold'));
      }
    }

    // Pick the assembly on the test slice: every agreement level, whole menu.
    let best = null;
    for (let k = 1; k <= members.length; k++) {
      const stream = testChunks.map((_, i) => quorumCall(testCalls, i, k));
      const rows = bracketLib.execSweep(testChunks, stream, maps.trade, geo, bandPct, fee,
        { dMults: p.dMults, tHours: p.tHours, gates: p.gates, entries: p.entries });
      const cell = bracketLib.bestCell(rows, minTrades);
      if (cell && (!best || cell.pnl > best.pnl)) best = { ...cell, quorum: k };
    }
    if (!best) {
      folds.push({ testStart: f.testStart, skipped: 'no cell cleared the trade floor' });
      continue;
    }
    // Score once on hold, with the valid controls (slices are contiguous, so
    // always-long AND buy-hold both mean what they say here — unlike under
    // the scattered layout, QC 54).
    const hstream = holdChunks.map((_, i) => quorumCall(holdCalls, i, best.quorum));
    const r = bracketLib.simCell(best, holdChunks, hstream, maps.trade, geo, bandPct, fee);
    const ctl = bracketLib.holdControls(holdChunks, maps.trade, geo, best.tHours, fee);
    const trainLabels = trainChunks.map((c) => c.label);
    const holdLabels = holdChunks.map((c) => c.label);
    folds.push({
      testStart: f.testStart,
      bandPct,
      cell: {
        entry: best.entry || 'breakout', gate: best.gate ?? null, dMult: best.dMult ?? null,
        tHours: best.tHours, trailMult: best.trailMult ?? null, armMult: best.armMult ?? null,
        quorum: best.quorum,
      },
      testPnl: best.pnl, testTrades: best.trades,
      holdPnl: r.pnl, holdTrades: r.trades, holdWins: r.wins, holdStops: r.stops,
      holdAmbiguous: r.ambiguous, holdPeriods: holdChunks.length, testPeriods: testChunks.length,
      alwaysLong: ctl.alwaysLong, buyHold: ctl.buyHold,
      // the calibration ledger's raw material: each member's solo held-back
      // edge for this slice
      memberHoldEdges: holdCalls.map((c) => {
        const m = classifierMetrics(trainLabels, holdLabels, c);
        return m ? m.edge : null;
      }),
    });
  }

  const scored = folds.filter((f) => !f.skipped);
  const pnls = scored.map((f) => f.holdPnl).sort((a, b) => a - b);
  // Drift-adjusted skill series (audit 9b): per fold, holdout money minus
  // always-going-long the same slice — the rank key the stated question
  // actually asks about. The raw money quantiles stay reported beside it
  // (QC 21c: the old measure keeps being printed next to the new one).
  const skills = scored.map((f) => f.holdPnl - (f.alwaysLong || 0)).sort((a, b) => a - b);
  // Interpolated quantile: the old floor(f*n) rank sat one element high on
  // even-length sets, biasing every reported median upward or downward by
  // luck of parity.
  const q = (arr, f) => {
    if (!arr.length) return null;
    const x = f * (arr.length - 1);
    const lo = Math.floor(x);
    const hi = Math.ceil(x);
    return arr[lo] + (arr[hi] - arr[lo]) * (x - lo);
  };
  return {
    folds,
    agg: {
      foldsPlanned: grid.length,
      foldsScored: scored.length,
      holdTotal: scored.reduce((s, f) => s + f.holdPnl, 0),
      holdMedian: q(pnls, 0.5),
      iqrLo: q(pnls, 0.25), iqrHi: q(pnls, 0.75),
      foldsPositive: scored.filter((f) => f.holdPnl > 0).length,
      skillMedian: q(skills, 0.5),
      skillLo: q(skills, 0.25), skillHi: q(skills, 0.75),
      skillPositive: scored.filter((f) => f.holdPnl - (f.alwaysLong || 0) > 0).length,
      holdTrades: scored.reduce((s, f) => s + f.holdTrades, 0),
      holdWins: scored.reduce((s, f) => s + f.holdWins, 0),
      alwaysLongTotal: scored.reduce((s, f) => s + (f.alwaysLong || 0), 0),
    },
  };
}

module.exports = { wfUnitTask, foldGrid, foldSlices, reachMs, nullRng, dealVotes, TEST_WEEKS, HOLD_WEEKS, STEP_WEEKS, WARMUP_WEEKS };
