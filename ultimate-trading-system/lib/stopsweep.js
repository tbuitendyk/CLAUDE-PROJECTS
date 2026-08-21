// stopsweep.js -- determine the tightest protective FIXED stop for a prospective
// live setup, over its FULL price history, by replaying the SAME frozen committee
// the live engine trades and tuning the stop on the entries it actually takes.
//
// Owner spec (2026-08-11): only for setups WITHOUT an existing protective stop.
// A market-entry cell (entry:'market', trailMult null) has no stop; a breakout
// cell's opposite rail already IS its stop, so it is excluded. The tune runs
// start->end of history (no holdout, in-sample included on purpose -- a protective
// stop wants the deepest a winner ever dipped across ALL data, not a performance
// estimate), and the result is fed to the engine as FIXED_STOP_PCT.
//
// Correctness anchor: the entries MUST be the ones the live engine trades. The
// live producer (pilotsignal.js) builds the F1 committee from buildCombo ->
// (frozen) trainMembers -> quorumCall at entryOffsetH; this module replays that
// exact chain over EVERY chunk (not just the forward window) so the stop is tuned
// on the live setup's own calls.
const { buildCombo, trainMembers, quorumCall } = require('./bracketwork');
const bracketLib = require('./bracket');
const { scoreDiff } = require('./dataset');
const { splitFrozen } = require('./freeze');
const { REAL_FEE_PER_LEG, NOTIONAL } = require('./paper');
const { tuneFixedStop } = require('./stoptuner');
const { HOUR_MS } = require('./binance');

// A setup carries an existing protective stop unless it is a market entry with no
// trailing stop. Breakout/other entries stop at the opposite rail already.
function hasExistingStop(cell) {
  if (!cell) return true;
  return cell.entry !== 'market' || cell.trailMult != null;
}

// Pure: turn per-chunk quorum calls (1/-1/0) into market entries {entryTs, side}.
function entriesFromCalls(chunks, calls, geo) {
  const off = (geo.entryOffsetH || 0) * HOUR_MS;
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = calls[i];
    if (c === 1 || c === -1) {
      out.push({ entryTs: chunks[i].startTs + off, side: c === 1 ? 'LONG' : 'SHORT' });
    }
  }
  return out;
}

// Replay a forward-book's FROZEN committee over its whole history and tune the
// tightest fixed stop that loses no winner. Async: buildCombo loads candle data.
// THE FREEZE IS THE CALLER'S TO STATE (owner, 2026-08-19: "generalizing it all
// so that ALL of the functionality -- DATA AND CODE" belongs to the profile).
//
// This module used to default its training cutoff to TRAIN_THROUGH/SCORE_FROM
// imported from lib/forwardbook.js. Those constants are the frozen dates of a
// PRE-REGISTERED RESEARCH RECORD — three books committed with their cutoffs
// before any number existed. They are correct for that record and meaningless
// for anyone else. Inheriting them meant a profile's stop was tuned against a
// stranger's training window, silently and with a plausible-looking number
// coming out the far end: the exact shape of every instrumentation defect in
// this project.
//
// So there is no default any more. A caller states the cutoff or gets an error
// naming what is missing — the same contract splitFrozen already enforces one
// level down, for the same reason.
function requireFreeze(book, opts) {
  const t = opts && opts.trainThrough;
  const f = opts && opts.scoreFrom;
  if (!Number.isFinite(t)) {
    throw new Error(`setup ${(book && book.id) || '?'}: no training cutoff was stated for this scan. `
      + 'A cutoff must come from the thing being scanned — a profile\'s trainPolicy, or the fire time of '
      + 'the run a lab row was selected from — never inherited from another record\'s frozen dates.');
  }
  // scoreFrom only splits train from score; the sweep re-unions both halves, so
  // an unstated one is not ambiguous the way the cutoff is. Default it to the
  // instant after the cutoff and say so, rather than reaching for a constant.
  return { trainThrough: t, scoreFrom: Number.isFinite(f) ? f : t + 1 };
}

async function computeSetupStop(book, opts = {}) {
  // CHECK THE CUTOFF FIRST. buildCombo below loads full history and takes
  // minutes; refusing after that is a slow way to say something that is knowable
  // instantly, and the error that surfaced was whatever the data loader hit
  // rather than the real cause.
  const freeze = requireFreeze(book, opts);
  if (hasExistingStop(book.cell)) {
    throw new Error(`setup ${book.id} already has a protective stop `
      + `(entry=${book.cell.entry}, trailMult=${book.cell.trailMult}) — stop tuning does not apply`);
  }
  // REAL_FEE_PER_LEG is DOLLARS on the $NOTIONAL paper clip ($0.125 on $100 =
  // 0.125%). The stop tuner works in FRACTIONAL returns, so the fee must be a
  // fraction too: $0.125/$100 = 0.00125. (Passing the dollar 0.125 straight in
  // made a 25% round-trip hurdle instead of 0.25% and misclassified almost every
  // trade as a loser — caught 2026-08-11 by the owner asking why F1 'won' 2.7%.)
  const feeUsd = opts.feePerLegUsd ?? REAL_FEE_PER_LEG;
  const feeFrac = opts.feePerLeg ?? (feeUsd / NOTIONAL);
  const params = { allLoaded: true, feePerLeg: feeUsd };
  const { geo, maps, chunks } = await buildCombo(book.combo, book.branch, params);

  // frozen band + labels, exactly as scoreBook (never re-derived on new data)
  const bandPct = Math.abs(book.branch.band);
  for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);

  // train the LIVE frozen members on the frozen train window, then predict them
  // across the WHOLE history. We score the UNION of the two production-proven,
  // feature-complete chunk sets — trainChunks (used to fit the members, so they
  // have features) and fwdChunks (scored live) — rather than the raw chunk list,
  // whose earliest entries lack a complete feature window and would make a member
  // emit a non-vote that quorumCall (correctly) refuses. In-sample prediction on
  // the train chunks is deliberate: the owner wants the deepest a winner ever
  // dipped across ALL data, which is a robustness estimate, not a performance one.
  const outcomeMs = (geo.exitOffsetH || 0) * 3600000;
  const { trainChunks, fwdChunks } = splitFrozen(
    chunks, freeze.trainThrough, freeze.scoreFrom, outcomeMs,
  );
  if (!trainChunks.length) throw new Error(`setup ${book.id}: no training chunks at/before the freeze date`);
  const scoreChunks = [...trainChunks, ...fwdChunks].sort((a, b) => a.startTs - b.startTs);
  const views = bracketLib.comboViews(book.combo.size, geo.featureHours / 24).views;
  const members = await trainMembers(book.members, views, trainChunks, scoreChunks, book.branch, maps, geo, feeUsd);
  const memberCalls = members.map((m) => m.calls);
  const calls = scoreChunks.map((_, i) => quorumCall(memberCalls, i, book.cell.quorum));

  const entries = entriesFromCalls(scoreChunks, calls, geo);
  const tune = tuneFixedStop(entries, maps.trade, {
    holdHours: book.cell.tHours,
    feePerLeg: feeFrac,
    marginFrac: opts.marginFrac || 0,
  });
  return {
    setup: { id: book.id, combo: book.combo, cell: book.cell, holdHours: book.cell.tHours },
    trainThrough: freeze.trainThrough,
    fullHistory: {
      chunks: scoreChunks.length,
      firstChunkUtc: scoreChunks.length ? new Date(scoreChunks[0].startTs).toISOString() : null,
      lastChunkUtc: scoreChunks.length ? new Date(scoreChunks[scoreChunks.length - 1].startTs).toISOString() : null,
    },
    ...tune,
  };
}

module.exports = { computeSetupStop, entriesFromCalls, hasExistingStop };
