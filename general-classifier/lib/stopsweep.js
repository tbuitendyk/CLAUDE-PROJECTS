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
const { splitFrozen, TRAIN_THROUGH, SCORE_FROM } = require('./forwardbook');
const { REAL_FEE_PER_LEG } = require('./paper');
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
async function computeSetupStop(book, opts = {}) {
  if (hasExistingStop(book.cell)) {
    throw new Error(`setup ${book.id} already has a protective stop `
      + `(entry=${book.cell.entry}, trailMult=${book.cell.trailMult}) — stop tuning does not apply`);
  }
  const fee = opts.feePerLeg ?? REAL_FEE_PER_LEG;
  const params = { allLoaded: true, feePerLeg: fee };
  const { geo, maps, chunks } = await buildCombo(book.combo, book.branch, params);

  // frozen band + labels, exactly as scoreBook (never re-derived on new data)
  const bandPct = Math.abs(book.branch.band);
  for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);

  // train the LIVE frozen members on the frozen train window, then predict them
  // on EVERY chunk so we get the setup's calls across the WHOLE history.
  const outcomeMs = (geo.exitOffsetH || 0) * 3600000;
  const { trainChunks } = splitFrozen(
    chunks, opts.trainThrough ?? TRAIN_THROUGH, opts.scoreFrom ?? SCORE_FROM, outcomeMs,
  );
  if (!trainChunks.length) throw new Error(`setup ${book.id}: no training chunks at/before the freeze date`);
  const views = bracketLib.comboViews(book.combo.size, geo.featureHours / 24).views;
  const members = await trainMembers(book.members, views, trainChunks, chunks, book.branch, maps, geo);
  const memberCalls = members.map((m) => m.calls);
  const calls = chunks.map((_, i) => quorumCall(memberCalls, i, book.cell.quorum));

  const entries = entriesFromCalls(chunks, calls, geo);
  const tune = tuneFixedStop(entries, maps.trade, {
    holdHours: book.cell.tHours,
    feePerLeg: fee,
    marginFrac: opts.marginFrac || 0,
  });
  return {
    setup: { id: book.id, combo: book.combo, cell: book.cell, holdHours: book.cell.tHours },
    trainThrough: opts.trainThrough ?? TRAIN_THROUGH,
    fullHistory: {
      chunks: chunks.length,
      firstChunkUtc: chunks.length ? new Date(chunks[0].startTs).toISOString() : null,
      lastChunkUtc: chunks.length ? new Date(chunks[chunks.length - 1].startTs).toISOString() : null,
    },
    ...tune,
  };
}

module.exports = { computeSetupStop, entriesFromCalls, hasExistingStop };
