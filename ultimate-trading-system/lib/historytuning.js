// History Tuning — the engine (design ledger DESIGN-HISTORY-TUNING.md,
// all rulings closed 2026-08-03; WORKFLOW.md step 5).
//
// One selected survivor SETUP, everything about it carried unchanged; only
// the two dials vary. 35 passes per split (5 age settings x 7 retune
// settings), three expanding-training splits, reference pass first.
// Vocabulary per GLOSSARY.md: pass, split, reference pass, retune,
// decision trail, training floor, effective training days.

const bracketLib = require('./bracket');
const H = require('./history');

const DAY_MS = H.DAY_MS;
const WEEK_MS = 7 * DAY_MS;

// ---- the dial grid ---------------------------------------------------------

// Age dial (owner): smooth per-day half-life discount + calendar-anchored
// member retraining at the half-life interval (ruling A). 'none' = the
// control: trained once, never retrained, no discount.
const AGE_SETTINGS = [
  { key: 'none', halfLifeDays: null, label: 'no discount (control)' },
  { key: '6mo', halfLifeDays: 182.5, label: '6-month half-life' },
  { key: '12mo', halfLifeDays: 365, label: '12-month half-life' },
  { key: '24mo', halfLifeDays: 730, label: '24-month half-life' },
  { key: '36mo', halfLifeDays: 1095, label: '36-month half-life' },
];

// Retune dial (owner): all five trade variables re-picked every R weeks on
// an m x R week lookback; m auto-permutes {1,2}. 'never' = the control:
// the survivor's declared cell holds for the whole walk.
const RETUNE_SETTINGS = [
  { key: 'never', weeks: null, m: null, label: 'never retuned (control)' },
  { key: 'r4m1', weeks: 4, m: 1, label: 'every 4 weeks, 4-week lookback' },
  { key: 'r4m2', weeks: 4, m: 2, label: 'every 4 weeks, 8-week lookback' },
  { key: 'r8m1', weeks: 8, m: 1, label: 'every 8 weeks, 8-week lookback' },
  { key: 'r8m2', weeks: 8, m: 2, label: 'every 8 weeks, 16-week lookback' },
  { key: 'r12m1', weeks: 12, m: 1, label: 'every 12 weeks, 12-week lookback' },
  { key: 'r12m2', weeks: 12, m: 2, label: 'every 12 weeks, 24-week lookback' },
];

// Reference pass FIRST (review finding: without it "did tuning beat not
// tuning" has no answer; running it first also shakes out the machinery
// before the other passes spend anything).
function dialGrid() {
  const grid = [];
  for (const age of AGE_SETTINGS) {
    for (const retune of RETUNE_SETTINGS) {
      grid.push({ age, retune, reference: age.key === 'none' && retune.key === 'never' });
    }
  }
  grid.sort((a, b) => (b.reference ? 1 : 0) - (a.reference ? 1 : 0));
  return grid;
}

// ---- the declared reading rules (owner-approved 2026-08-03) ---------------
// Stored in the run doc BEFORE anything computes; the results view prints
// its verdict THROUGH these sentences; they bind the instrument and the
// session, never the owner.
const READING_RULES = {
  picking: {
    label: 'DERIVED',
    text: 'The picking metric is net paper dollars per $100 book after fees — the same money metric '
      + 'every board uses. Accuracy and edge are descriptive columns, never pickers.',
  },
  combining: {
    label: 'GUESSED',
    text: 'A dial pair’s test score is the SUM of its net dollars across the three test windows. '
      + 'The audit must check the winner is not carried by one split alone.',
  },
  hold: {
    label: 'GUESSED',
    text: 'The winning pass beats the reference pass on combined hold dollars AND in at least two of '
      + 'the three hold windows individually; otherwise the finding is "tuning did not strengthen this '
      + 'survivor". Replication is still required either way.',
  },
  nullRule: {
    label: 'GUESSED (count) / DERIVED (construction)',
    text: 'The winner’s combined hold result must exceed every null draw’s equivalent '
      + '(best-of-grid on the same schedule, each draw picking its own winners). The resolution floor '
      + 'is printed: N draws can never claim finer than 1 in N+1.',
  },
};

// ---- split geometry (ruling D) ---------------------------------------------
// Expanding training: the usable span's back stretch is carved into six
// equal, disjoint test/hold windows; training is ALL history before each
// split's test window. usable = loaded history minus the original run's
// test+hold months (ruling B truncation) or minus the sealed reserve.

const MIN_TRAIN_DAYS = 425; // ~14 months: the early split's floor margin (ruling D arithmetic)
const MIN_WINDOW_DAYS = 112; // 16 weeks, GUESSED: room for at least one 12-week retune + trades

function splitGeometry(usableStartTs, usableEndTs) {
  const spanDays = (usableEndTs - usableStartTs) / DAY_MS;
  const windowDays = Math.floor((spanDays - MIN_TRAIN_DAYS) / 6);
  if (!(windowDays >= MIN_WINDOW_DAYS)) {
    return {
      refusal: `refused: the usable span is ${spanDays.toFixed(0)} days; after the minimum training `
        + `run-up (${MIN_TRAIN_DAYS}) the six test/hold windows would be ${windowDays} days each, below `
        + `the ${MIN_WINDOW_DAYS}-day minimum (GUESSED). Load more history or free more span.`,
    };
  }
  const W = windowDays * DAY_MS;
  const backStart = usableEndTs - 6 * W;
  const splits = [0, 1, 2].map((k) => ({
    name: ['early', 'middle', 'late'][k],
    trainStartTs: usableStartTs,
    testStartTs: backStart + k * 2 * W,
    testEndTs: backStart + (k * 2 + 1) * W,
    holdStartTs: backStart + (k * 2 + 1) * W,
    holdEndTs: backStart + (k * 2 + 2) * W,
  }));
  return { splits, windowDays, refusal: null };
}

// ---- the walking pass -------------------------------------------------------
// One dial setting walked through one split. Returns money + the decision
// trail. All look-back only: retunes score STORED walked calls, never
// re-predictions (review fix 2); every boundary purged by reach (fix 1 +
// ruling C per-cell edge rule).

function reachMsFor(geo, tHours) {
  return (geo.entryOffsetH + tHours + 3) * 3600 * 1000;
}

async function runPass({
  chunks, geo, maps, branch, comboSize, dial, split, declaredCell, menuOpts,
  feePerLeg, minTradesPerLookbackWeek, nullShiftSeed = null, onProgress = () => {},
}) {
  const { age, retune } = dial;
  const trail = { retrains: [], retunes: [], segments: [] };
  const tMaxMenu = Math.max(...(menuOpts.tHours || bracketLib.T_HOURS));
  const menuReach = reachMsFor(geo, tMaxMenu);
  // Training purge covers EVERYTHING a chunk can know: its features, its
  // label resolution, and the longest menu trade (review: menuReach alone
  // leaks under short menus — the label resolves at exitOffset regardless).
  const trainReach = Math.max(geo.featureHours, (geo.exitOffsetH ?? 0) + 3, geo.entryOffsetH + tMaxMenu + 3) * 3600 * 1000;

  // Generations: opening training at testStart + every calendar milestone
  // (from the START of usable history, ruling A) that lands inside the walk.
  const milestones = H.retrainMilestones(split.trainStartTs, split.holdEndTs, age.halfLifeDays)
    .filter((t) => t > split.testStartTs);
  const genDates = [split.testStartTs, ...milestones];

  // Walk chunks: everything with a decision date inside test+hold.
  const walkChunks = chunks.filter((c) => c.startTs >= split.testStartTs && c.startTs < split.holdEndTs);
  if (!walkChunks.length) return { skipped: 'no walk chunks in this split' };

  // Train each generation; predict the walk chunks it owns; stitch calls.
  const views = bracketLib.comboViews(comboSize, geo.featureHours / 24).views;
  const specs = require('./bracketwork').specsFor(comboSize, 'promoted');
  const nMembers = specs.length;
  const memberCalls = specs.map(() => new Array(walkChunks.length).fill(0));
  let effectiveDaysOpening = null;

  for (let gi = 0; gi < genDates.length; gi++) {
    const gAt = genDates[gi];
    const gEnd = genDates[gi + 1] ?? split.holdEndTs;
    // Purge: train only on chunks whose full execution reach settles before
    // the generation date (QC 58 class; review fix 1).
    const trainSet = chunks.filter((c) => c.startTs + trainReach <= gAt);
    const { weights, effectiveDays } = H.ageWeights(
      trainSet.map((c) => ({ endTs: c.startTs })), gAt, age.halfLifeDays,
    );
    if (gi === 0) {
      effectiveDaysOpening = effectiveDays;
      const refusal = H.floorRefusal(effectiveDays, `${split.name} split, ${age.label}`);
      if (refusal) return { refused: refusal, effectiveDays };
    }
    const ownIdx = [];
    for (let i = 0; i < walkChunks.length; i++) {
      if (walkChunks[i].startTs >= gAt && walkChunks[i].startTs < gEnd) ownIdx.push(i);
    }
    if (!ownIdx.length) { trail.retrains.push({ at: gAt, effectiveDays, chunks: trainSet.length, idle: true }); continue; }
    onProgress(`${split.name}: training generation ${gi + 1}/${genDates.length} (${trainSet.length} chunks, ${effectiveDays.toFixed(0)} effective days)`);
    for (let s = 0; s < specs.length; s++) {
      const { calls } = await bracketLib.trainMember({
        model: specs[s].model,
        viewIdx: views[specs[s].view],
        trainChunks: trainSet,
        testChunks: ownIdx.map((i) => walkChunks[i]),
        decision: branch.decision,
        tradeMap: maps.trade,
        geo,
        ageWeights: age.halfLifeDays ? weights : null,
      });
      for (let k = 0; k < ownIdx.length; k++) memberCalls[s][ownIdx[k]] = calls[k];
    }
    trail.retrains.push({ at: gAt, effectiveDays, chunks: trainSet.length });
  }

  // NULL ARM (QC 66 construction): each member's real mix of walk calls is
  // dealt onto random days — independently per member, per dial cell, per
  // split (review fix 3: informationless votes are untrained, so without a
  // per-cell deal the null grid would collapse to far fewer distinguishable
  // options than the real grid and under-price the shopping). The null
  // inherits DATES AND LOOKBACKS only; every retune below picks its own
  // winners on these dealt calls.
  if (nullShiftSeed) {
    const { nullRng, dealVotes } = require('./walkforward');
    // Deal WITHIN each (generation x test/hold bucket) segment — the design's
    // own construction: each segment keeps its real vote mix, dates destroyed,
    // and neither generations' habits nor the test/hold boundary get smeared
    // (review finding 4; matches the walkforward per-slice dealing).
    const segOf = (i) => {
      const ts = walkChunks[i].startTs;
      let g = 0;
      for (let k = 1; k < genDates.length; k++) if (ts >= genDates[k]) g = k;
      return `${g}|${ts < split.testEndTs ? 'test' : 'hold'}`;
    };
    const segments = new Map();
    for (let i = 0; i < walkChunks.length; i++) {
      const key = segOf(i);
      if (!segments.has(key)) segments.set(key, []);
      segments.get(key).push(i);
    }
    for (let s2 = 0; s2 < memberCalls.length; s2++) {
      for (const [segKey, idx] of segments) {
        const rng = nullRng(nullShiftSeed, `${dial.age.key}|${dial.retune.key}|${split.name}|${segKey}`, 0, s2, 'walk');
        const dealt = dealVotes(idx.map((i) => memberCalls[s2][i]), rng);
        idx.forEach((i, k) => { memberCalls[s2][i] = dealt[k]; });
      }
    }
  }

  // Quorum streams once (agreement level is one of the retunable five).
  const { quorumCall } = require('./bracketwork');
  const streams = new Map();
  for (let q = 1; q <= nMembers; q++) {
    streams.set(q, walkChunks.map((_, i) => quorumCall(memberCalls, i, q)));
  }

  // The walk: segments bounded by retune dates (retunes continue through
  // hold — they are the machine, not the pick). Initial cell = the
  // survivor's declared cell (review fix: no undefined pre-first-retune state).
  const retuneDates = [];
  if (retune.weeks) {
    for (let t = split.testStartTs + retune.weeks * WEEK_MS; t < split.holdEndTs; t += retune.weeks * WEEK_MS) {
      retuneDates.push(t);
    }
  }
  const bounds = [split.testStartTs, ...retuneDates, split.holdEndTs];
  let cell = { ...declaredCell };
  let testPnl = 0;
  let holdPnl = 0;
  let trades = 0;

  const scoreWindow = (fromTs, toTs, theCell) => {
    // Per-cell edge purge (ruling C): no entry whose own reach crosses the
    // WINDOW end (test end for test money, hold end for hold money).
    const cellReach = reachMsFor(geo, theCell.tHours);
    const windowEnd = toTs <= split.testEndTs ? split.testEndTs : split.holdEndTs;
    const idx = [];
    for (let i = 0; i < walkChunks.length; i++) {
      const ts = walkChunks[i].startTs;
      if (ts >= fromTs && ts < toTs && ts + cellReach <= windowEnd) idx.push(i);
    }
    if (!idx.length) return { pnl: 0, trades: 0 };
    const periods = idx.map((i) => walkChunks[i]);
    const calls = idx.map((i) => streams.get(theCell.quorum || 1)[i]);
    const r = bracketLib.simCell(theCell, periods, calls, maps.trade, geo, theCell.bandPct, feePerLeg);
    return { pnl: r.pnl, trades: r.trades };
  };

  for (let b = 0; b < bounds.length - 1; b++) {
    const segStart = bounds[b];
    const segEnd = bounds[b + 1];
    // Money for this segment, split across the test/hold boundary if it straddles.
    for (const [wFrom, wTo, bucket] of [
      [Math.max(segStart, split.testStartTs), Math.min(segEnd, split.testEndTs), 'test'],
      [Math.max(segStart, split.holdStartTs), Math.min(segEnd, split.holdEndTs), 'hold'],
    ]) {
      if (wTo <= wFrom) continue;
      const r = scoreWindow(wFrom, wTo, cell);
      if (bucket === 'test') testPnl += r.pnl; else holdPnl += r.pnl;
      trades += r.trades;
      trail.segments.push({ from: wFrom, to: wTo, bucket, cell: { ...cell }, pnl: r.pnl, trades: r.trades });
    }
    // Retune at segEnd (if it is a retune date): all five variables
    // re-picked on the lookback of STORED walked calls only (review fix 2),
    // lookback end pulled one menu-reach early (fix: no look-ahead at the
    // near edge), gates restricted to vote-using (review fix 8).
    if (b + 1 < bounds.length - 1) {
      const at = bounds[b + 1];
      const lbFrom = at - retune.m * retune.weeks * WEEK_MS;
      const lbTo = at - menuReach;
      const lookIdx = [];
      for (let i = 0; i < walkChunks.length; i++) {
        const ts = walkChunks[i].startTs;
        if (ts >= lbFrom && ts < lbTo && ts >= split.testStartTs) lookIdx.push(i);
      }
      const effFrom = Math.max(lbFrom, split.testStartTs);
      const lookWeeks = Math.max(1, (lbTo - effFrom) / WEEK_MS);
      const minTrades = Math.max(1, Math.round(minTradesPerLookbackWeek * lookWeeks));
      let picked = null;
      if (lookIdx.length) {
        const periods = lookIdx.map((i) => walkChunks[i]);
        let bestRow = null;
        let bestQ = null;
        for (let q = 1; q <= nMembers; q++) {
          const calls = lookIdx.map((i) => streams.get(q)[i]);
          const rows = bracketLib.execSweep(periods, calls, maps.trade, geo, cell.bandPct, feePerLeg, {
            ...menuOpts, gates: (menuOpts.gates || bracketLib.GATES).filter((g) => g !== 'always'),
          });
          const best = bracketLib.bestCell(rows, minTrades);
          if (best && (!bestRow || best.pnl > bestRow.pnl)) { bestRow = best; bestQ = q; }
        }
        if (bestRow) {
          picked = {
            quorum: bestQ, gate: bestRow.gate, entry: bestRow.entry, dMult: bestRow.dMult,
            tHours: bestRow.tHours,
            // TRAILING IS HELD FIXED ON PURPOSE (design fix 10): the retune
            // menu never sweeps it, and the declared cell's trailing setting
            // carries through every retuned cell unchanged — it must not
            // silently switch off at the first retune (review finding).
            // Revisit: with the first replication round.
            trailMult: declaredCell.trailMult ?? null, armMult: declaredCell.armMult ?? null,
            bandPct: cell.bandPct,
          };
        }
      }
      trail.retunes.push({
        at, lookbackFromTs: lbFrom, lookbackEffFromTs: effFrom, lookbackToTs: lbTo, lookbackChunks: lookIdx.length,
        minTrades, picked: picked ? { ...picked } : null, kept: !picked,
      });
      if (picked) cell = picked; // no candidate cleared the floor -> incumbent stays (review fix 7b)
    }
  }

  return {
    testPnl, holdPnl, trades, effectiveDays: effectiveDaysOpening, trail,
    retrains: trail.retrains.length, retunes: trail.retunes.length,
  };
}

module.exports = {
  AGE_SETTINGS,
  RETUNE_SETTINGS,
  READING_RULES,
  MIN_TRAIN_DAYS,
  MIN_WINDOW_DAYS,
  dialGrid,
  splitGeometry,
  runPass,
  reachMsFor,
};

// ---- worker entry -----------------------------------------------------------
// One payload = one dial pair walked through one split. Serializable in,
// serializable out; the orchestrator (lib/batch.js) owns the doc.
async function htPassTask(payload) {
  const { combo, branch, dial, split, params: p } = payload;
  const { buildCombo } = require('./bracketwork');
  const { scoreDiff } = require('./dataset');
  const { geo, maps, chunks } = await buildCombo(combo, branch, p);
  // Ruling B: the usable span was computed at launch (selection-window
  // truncation or reserve seal). Everything outside it does not exist for
  // this run.
  const usable = chunks.filter((c) => c.startTs >= p.usableStartTs && c.startTs < p.usableEndTs);
  // The setup is carried UNCHANGED (design ledger): the survivor's recorded
  // band labels every chunk, exactly as its board run labeled them.
  const bandPct = p.declaredCell.bandPct;
  for (const c of usable) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);
  return runPass({
    chunks: usable,
    geo,
    maps,
    branch,
    comboSize: combo.size,
    dial,
    split,
    declaredCell: p.declaredCell,
    menuOpts: { dMults: p.dMults, tHours: p.tHours, gates: p.gates, entries: p.entries },
    feePerLeg: p.feePerLeg,
    minTradesPerLookbackWeek: p.minTradesPerLookbackWeek,
    nullShiftSeed: p.nullShiftSeed || null,
  });
}

module.exports.htPassTask = htPassTask;
