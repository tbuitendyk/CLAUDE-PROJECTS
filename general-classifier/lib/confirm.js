// MINUTE CONFIRMATION — re-run one chosen cell against the real intra-bar
// path instead of an assumption about it.
//
// THE PROBLEM IT SOLVES. On hourly candles a bracket knows only OHLC, so when
// a bar both makes a new extreme and touches the stop, nothing in the data
// says which happened first. simBracket takes the pessimistic order and
// counts every such bar in trailAmbiguous. For a static stop that is rare
// (only a bar spanning both entry rails). For a TRAILING stop it fires on any
// bar that extends and retraces, which is most interesting bars — so an
// hourly trailing result is an estimate resting on an assumption, and the
// count is how much of it rests there.
//
// Minute candles do not remove the ambiguity, they shrink it by 60x: the same
// question now only arises inside a single minute. That is the honest framing
// — this is a much tighter bound, not proof.
//
// WHAT IS DELIBERATELY HELD FIXED. Same cell, same calls, same fees, same
// rules; only the bar size changes. A minute run that also altered the fill
// logic would confirm nothing.
//
// THE SELF-CHECK. Before comparing anything, the unit is rebuilt and the cell
// re-scored on HOURLY bars, and that must reproduce the number already on
// record. If it does not, the minute figure is being compared against a
// different trade than the one selected, and this reports the mismatch rather
// than a delta nobody can interpret.
const bracketLib = require('./bracket');
const { loadMinuteWindow } = require('./minute');
const { HOUR_MS } = require('./binance');
const { buildCombo, splitAndLabel, splitByLayout, specsFor, quorumCall, declaredQuorumFor } = require('./bracketwork');
const { REAL_FEE_PER_LEG } = require('./paper');
const { GEOMETRIES } = require('./dataset');

async function confirmCell({ combo, branch, cell, quorum, params, layoutArm = null, onProgress = () => {} }) {
  const p = params;
  const fee = p.feePerLeg ?? REAL_FEE_PER_LEG;
  const geo = GEOMETRIES[branch.geometry];

  onProgress('rebuilding the unit on hourly data');
  const built = await buildCombo(combo, branch, p);
  // The rebuild must split exactly as the original unit did — layout runs
  // included — or the self-check below refuses (audit 2026-07-30): a layout
  // row rebuilt on the legacy split is a different trade, and comparing its
  // minute path would confirm nothing.
  const layout = layoutArm
    || (p.windowLayout && p.windowLayout !== 'legacy' && p.windowLayout !== 'both' ? p.windowLayout : null);
  const { trainChunks, testChunks, holdChunks, bandPct } = layout
    ? splitByLayout(built.chunks, branch, geo, layout, p)
    : splitAndLabel(built.chunks, branch, p.holdout);
  const views = bracketLib.comboViews(combo.size, geo.featureHours / 24).views;
  const predictChunks = holdChunks.length ? [...testChunks, ...holdChunks] : testChunks;

  const specs = specsFor(combo.size, 'promoted');
  const memberCalls = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    onProgress(`member ${i + 1}/${specs.length} (${spec.model}/${spec.view})`);
    const { calls } = await bracketLib.trainMember({
      model: spec.model,
      viewIdx: views[spec.view],
      trainChunks,
      testChunks: predictChunks,
      decision: branch.decision,
      tradeMap: built.maps.trade,
      geo,
    });
    memberCalls.push(calls);
  }
  const q = quorum || declaredQuorumFor(p.declared, memberCalls.length) || 1;
  const searchCalls = memberCalls.map((c) => c.slice(0, testChunks.length));
  const calls = testChunks.map((_, i) => quorumCall(searchCalls, i, q));

  // ---- self-check on hourly ----------------------------------------------
  onProgress('hourly re-score (self-check)');
  const hourly = bracketLib.simCell(cell, testChunks, calls, built.maps.trade, geo, bandPct, fee, HOUR_MS);

  // ---- the minute window --------------------------------------------------
  // From the first entry to the last exit, plus the 3h gap tolerance the
  // simulator allows either side.
  const firstTs = testChunks[0].startTs + geo.entryOffsetH * HOUR_MS;
  const lastTs = testChunks[testChunks.length - 1].startTs + geo.entryOffsetH * HOUR_MS
    + cell.tHours * HOUR_MS + 3 * HOUR_MS;
  const minute = await loadMinuteWindow(combo.trade, firstTs, lastTs, onProgress);

  onProgress(`minute re-score over ${minute.candles.toLocaleString()} candles`);
  const fine = bracketLib.simCell(cell, testChunks, calls, minute.map, geo, bandPct, fee, 60_000);

  const coverage = minute.expected ? minute.candles / minute.expected : 0;
  return {
    quorum: q,
    members: memberCalls.length,
    bandPct,
    periods: testChunks.length,
    hourly,
    minute: fine,
    delta: {
      pnl: fine.pnl - hourly.pnl,
      trades: fine.trades - hourly.trades,
      stops: fine.stops - hourly.stops,
    },
    data: {
      symbol: combo.trade,
      months: minute.months,
      candles: minute.candles,
      expected: minute.expected,
      coverage,
      missingMonths: minute.missingMonths,
      fromMs: firstTs,
      toMs: lastTs,
    },
    // Coverage below this and the comparison is between two different
    // datasets rather than two resolutions of one.
    usable: coverage >= 0.95 && fine.unpriced <= hourly.unpriced + testChunks.length * 0.02,
  };
}

module.exports = { confirmCell };
