// WALK-FORWARD — the stacked train/test/hold instrument
// (reports/DESIGN-WALKFORWARD.md on the vps-access branch, owner-approved
// 2026-07-31). Replaces single-draw holdout verdicts (QC 57).
//
// THE FOLD. At fold time t:
//   TRAIN  every chunk whose candles end safely before t (purged by the
//          full execution reach), with the trailing 104 weeks counted
//          TWICE — the recency weighting derived from the ~1-year member
//          half-life measured in H1a. [weight factor 2 is GUESSED; a knob]
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
const RECENCY_WEEKS = 104; // trailing window counted twice [derived scale, GUESSED factor]

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
// used (QC 52).
function reachMs(geo, tHoursMenu) {
  const tMax = Math.max(...(Array.isArray(tHoursMenu) && tHoursMenu.length ? tHoursMenu : bracketLib.T_HOURS));
  return Math.max(geo.featureHours, geo.exitOffsetH, geo.entryOffsetH + tMax + 3) * HOUR_MS;
}

// All folds for one (coin, shape, decision) unit. Serial inside the task;
// units parallelize across workers.
async function wfUnitTask({ combo, branch, params }) {
  const p = params;
  const { geo, maps, chunks } = await buildCombo(combo, branch, p);
  const fee = p.feePerLeg ?? REAL_FEE_PER_LEG;
  const reach = reachMs(geo, p.tHours);
  const minTrades = p.minTradesSlice ?? 5; // floor per 8-week slice [GUESSED]
  const grid = foldGrid(chunks[0].startTs, chunks[chunks.length - 1].startTs);
  const specs = specsFor(combo.size, 'promoted');
  const views = bracketLib.comboViews(combo.size, geo.featureHours / 24).views;
  const folds = [];

  for (const f of grid) {
    // TRAIN: strictly pre-test, purged by the full reach, recent 104w twice.
    const trainBase = chunks.filter((c) => c.startTs + reach <= f.testStart);
    const recent = trainBase.filter((c) => c.startTs >= f.testStart - RECENCY_WEEKS * WEEK_MS);
    const trainChunks = [...trainBase, ...recent];
    if (trainBase.length < MIN_CHUNKS) {
      folds.push({ testStart: f.testStart, skipped: 'insufficient train history' });
      continue;
    }
    // TEST for picking: trades must not be able to touch hold candles.
    const testChunks = chunks.filter((c) => c.startTs >= f.testStart && c.startTs + reach <= f.holdStart);
    const holdChunks = chunks.filter((c) => c.startTs >= f.holdStart && c.startTs < f.holdEnd);
    if (testChunks.length < 8 || holdChunks.length < 8) {
      folds.push({ testStart: f.testStart, skipped: 'slice too thin (data gap)' });
      continue;
    }
    // Band on this fold's training data only, then every chunk relabeled.
    const bandPct = branch.band === 'auto'
      ? balancedBandPct(trainBase.map((c) => c.diffPct))
      : Math.abs(branch.band);
    for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);

    const predict = [...testChunks, ...holdChunks];
    const members = [];
    for (const spec of specs) {
      members.push(await bracketLib.trainMember({
        model: spec.model, viewIdx: views[spec.view], trainChunks,
        testChunks: predict, decision: branch.decision, tradeMap: maps.trade, geo,
      }));
    }
    const testCalls = members.map((m) => m.calls.slice(0, testChunks.length));
    const holdCalls = members.map((m) => m.calls.slice(testChunks.length));

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
    const trainLabels = trainBase.map((c) => c.label);
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
  const q = (arr, f) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(f * arr.length))] : null);
  return {
    folds,
    agg: {
      foldsPlanned: grid.length,
      foldsScored: scored.length,
      holdTotal: scored.reduce((s, f) => s + f.holdPnl, 0),
      holdMedian: q(pnls, 0.5),
      iqrLo: q(pnls, 0.25), iqrHi: q(pnls, 0.75),
      foldsPositive: scored.filter((f) => f.holdPnl > 0).length,
      holdTrades: scored.reduce((s, f) => s + f.holdTrades, 0),
      holdWins: scored.reduce((s, f) => s + f.holdWins, 0),
      alwaysLongTotal: scored.reduce((s, f) => s + (f.alwaysLong || 0), 0),
    },
  };
}

module.exports = { wfUnitTask, foldGrid, reachMs, TEST_WEEKS, HOLD_WEEKS, STEP_WEEKS, WARMUP_WEEKS, RECENCY_WEEKS };
