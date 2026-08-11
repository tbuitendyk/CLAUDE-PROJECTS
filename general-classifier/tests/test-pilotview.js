// Pilot view: the journal is the record, and this module turns it into what the
// live screen shows. These tests feed synthetic journals (no box, no network)
// and pin the derived state, including the execution-fidelity aggregates.
const { assert } = require('./helpers');
const pv = require('../lib/pilotview');

function derive(lines) { return pv.derive(lines); }

module.exports.openThenExitLeavesNoOpenAndBanksPnl = function () {
  const st = derive([
    { event: 'ENTRY_FILL', chunk_start: 'c1', side: 'LONG', qty: 0.1, price: 100, fee_quote: 0.01, exit_due_ts: 2e9 },
    { event: 'EXIT_FILL', chunk_start: 'c1', side: 'LONG', qty: 0.1, price: 101, pnl: 0.09, fee_quote: 0.01 },
  ]);
  assert.strictEqual(st.openPositions.length, 0, 'closed position must not remain open');
  assert.strictEqual(st.closedRecent.length, 1, 'closed trade is recorded');
  assert.strictEqual(st.realizedPnl, 0.09, 'realized P&L accumulates from EXIT_FILL');
};

module.exports.openPositionIsListedWhileUnclosed = function () {
  const st = derive([
    { event: 'ENTRY_FILL', chunk_start: 'c2', side: 'SHORT', qty: 0.1, price: 100, fee_quote: 0.01, exit_due_ts: 2e9 },
  ]);
  assert.strictEqual(st.openPositions.length, 1, 'unclosed entry is an open position');
  assert.strictEqual(st.openPositions[0].side, 'SHORT');
};

module.exports.realizedFeePerLegAveragesFillCosts = function () {
  const st = derive([
    { event: 'ENTRY_FILL', chunk_start: 'c3', side: 'LONG', qty: 0.1, price: 100, fee_quote: 0.02, exit_due_ts: 2e9 },
    { event: 'EXIT_FILL', chunk_start: 'c3', side: 'LONG', qty: 0.1, price: 100, pnl: -0.04, fee_quote: 0.04 },
  ]);
  assert.strictEqual(st.realizedFeePerLegAvg, 0.03, 'fee/leg is the mean of the two legs (0.02, 0.04)');
  assert.strictEqual(st.modelFeePerLeg, 0.125, 'the model assumption the pilot measures against is fixed');
};

module.exports.incidentsSurfaceKillsAndHalts = function () {
  const st = derive([
    { event: 'KILL_PRICE_DRIFT', utc: '2026-08-11T01:00:00Z', chunk_start: 'c4', deviation: 0.11 },
    { event: 'HALT_SET', utc: '2026-08-11T01:00:01Z', source: 'executor', reason: 'drift' },
  ]);
  assert.strictEqual(st.incidents.length, 2, 'both the kill and the halt surface as incidents');
  assert.strictEqual(st.incidents[0].kind, 'HALT_SET', 'incidents are newest-first');
};

module.exports.rejectStreakIsCountedAndResetByAck = function () {
  let st = derive([{ event: 'ORDER_REJECT' }, { event: 'ORDER_REJECT' }]);
  assert.strictEqual(st.consecutiveRejects, 2, 'consecutive rejects counted');
  st = derive([{ event: 'ORDER_REJECT' }, { event: 'ORDER_ACK' }]);
  assert.strictEqual(st.consecutiveRejects, 0, 'an ack resets the streak');
};

module.exports.absentJournalIsAStateNotAnError = function () {
  const s = pv.status('/nonexistent/path/journal.jsonl');
  assert.strictEqual(s.present, false, 'a missing journal reports present:false, never throws');
};

module.exports.runStatusCarriesTheMasterSwitchState = function () {
  let st = derive([{ event: 'RUN_STATUS', armed: true, halted: false, open: 0 }]);
  assert.strictEqual(st.armed, true, 'armed state comes from the latest RUN_STATUS');
  st = derive([
    { event: 'RUN_STATUS', armed: true, halted: false },
    { event: 'ARM_CLEAR', source: 'owner' },
  ]);
  assert.strictEqual(st.armed, false, 'a later ARM_CLEAR turns the switch off');
};

module.exports.fullLogIsNewestFirstAndFlattened = function () {
  const st = derive([
    { event: 'ARM_SET', utc: 't1', source: 'owner' },
    { event: 'ENTRY_FILL', utc: 't2', chunk_start: 'c1', side: 'LONG', qty: 0.1, price: 100, exit_due_ts: 2e9 },
  ]);
  assert.strictEqual(st.log[0].event, 'ENTRY_FILL', 'log is newest-first');
  assert.strictEqual(st.log[0].detail.side, 'LONG', 'log flattens the event fields into detail');
};

module.exports.anatomyIsReadFromTheEngineNotTypedIn = function () {
  const a = pv.anatomy();
  const cv = require('../lib/bracket').comboViews(3, 4);
  assert.strictEqual(a.features.totalVector, cv.featureCount,
    'total feature count must equal the engine\'s comboViews figure');
  assert.strictEqual(a.committee.length, 4, 'four members, as frozen');
  const byView = Object.fromEntries(a.committee.map((m) => [m.view, m.featuresSeen]));
  for (const v of ['full', 'prices', 'volume', 'cross']) {
    assert.strictEqual(byView[v], cv.views[v].length,
      `member view '${v}' must report the engine's real feature count`);
  }
  assert.ok(a.features.crossNames.includes('ret_correlation'),
    'the cross features (how comparison assets enter) are listed by name');
  assert.strictEqual(a.voting.quorum, 1, 'voting rule shows the frozen 1-of-4 quorum');
  assert.strictEqual(a.pipeline.length, 6, 'the pipeline explains all six stages');
};

module.exports.decisionsCarryVotesAndTheirFate = function () {
  const st = derive([
    { event: 'INTENT_SEEN', utc: 't1', chunk_start: '2026-08-10T00:00Z', side: 'LONG',
      per_member: [1, 0, 0, 1], quorum: 1, decision_price: 100.1, input_hash: 'aa' },
    { event: 'ENTRY_FILL', utc: 't2', chunk_start: '2026-08-10T00:00Z', side: 'LONG',
      qty: 0.1, price: 100.2, exit_due_ts: 2e9 },
    { event: 'INTENT_SEEN', utc: 't3', chunk_start: '2026-08-11T00:00Z', side: 'FLAT',
      per_member: [0, 0, 0, 0], quorum: 1, decision_price: 101 },
  ]);
  assert.strictEqual(st.decisions.length, 2, 'every seen intent is a decision row');
  assert.strictEqual(st.decisions[0].chunk_start, '2026-08-11T00:00Z', 'newest decision first');
  assert.strictEqual(st.decisions[0].fate, 'flat — no trade');
  assert.deepStrictEqual(st.decisions[1].votes, [1, 0, 0, 1], 'per-member votes surface for the screen');
  assert.strictEqual(st.decisions[1].fate, 'filled', 'a decision that traded says so');
};

module.exports.configReportsTheTestedF1SpecFromTheAuthoritativeSource = function () {
  const c = pv.config();
  assert.strictEqual(c.model.tradedPair, 'LTCUSDT', 'config shows the traded pair from forwardbook');
  assert.strictEqual(c.model.quorum, 1, 'quorum matches the F1 book');
  assert.strictEqual(c.model.holdHours, 137, 'hold matches the F1 cell');
  assert.strictEqual(c.model.entryOffsetH, 97, 'entry offset comes from the daily-4d geometry');
  assert.strictEqual(c.execution.clipUsd, 10, 'clip size is shown for the owner');
};

module.exports.haltSetReflectsImmediatelyAndClears = function () {
  let st = derive([{ event: 'HALT_SET', source: 'executor', reason: 'x' }]);
  assert.strictEqual(st.halted, true, 'HALT_SET reflects the halt at once (not a cycle later)');
  st = derive([{ event: 'HALT_SET' }, { event: 'HALT_CLEAR' }]);
  assert.strictEqual(st.halted, false, 'HALT_CLEAR lifts it');
};
