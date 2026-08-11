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

module.exports.clockSyncAloneIsNotALiveHeartbeat = function () {
  // RE-REVIEW LIVENESS L1: a box that hangs after stepping its clock keeps
  // emitting CLOCK_SYNC while placing/closing nothing. That must NOT read as a
  // live heartbeat, or the screen shows a dead executor as green.
  let st = derive([
    { event: 'CLOCK_SYNC', utc: 't-clock', drift_ms: 4 },
    { event: 'CLOCK_SYNC', utc: 't-clock2', drift_ms: 5 },
  ]);
  assert.strictEqual(st.lastHeartbeatUtc, null,
    'CLOCK_SYNC alone (no authed round-trip) is not a heartbeat');
  // a BALANCE — the end-of-loop snapshot — is a live heartbeat.
  st = derive([
    { event: 'CLOCK_SYNC', utc: 't-clock', drift_ms: 4 },
    { event: 'BALANCE', utc: 't-balance', free: 42 },
  ]);
  assert.strictEqual(st.lastHeartbeatUtc, 't-balance',
    'a completed BALANCE round-trip is a live heartbeat');
};

module.exports.reconcileOkIsNotAHeartbeatButRunStatusIs = function () {
  // RE-REVIEW LIVENESS: RECONCILE_OK fires at step 1, BEFORE due exits (step 3), so
  // a box that reconciles then dies in the exit loop would read green off a stale
  // RECONCILE_OK while exits never fire. RUN_STATUS is journaled AFTER the exit
  // loop, so IT certifies exits ran.
  let st = derive([
    { event: 'CLOCK_SYNC', utc: 't-clock' },
    { event: 'RECONCILE_OK', utc: 't-recon', free_base: 0 },
  ]);
  assert.strictEqual(st.lastHeartbeatUtc, null,
    'RECONCILE_OK fires before exits — it is no longer a heartbeat');
  st = derive([
    { event: 'RECONCILE_OK', utc: 't-recon', free_base: 0 },
    { event: 'RUN_STATUS', utc: 't-status', armed: true, halted: false },
  ]);
  assert.strictEqual(st.lastHeartbeatUtc, 't-status',
    'RUN_STATUS (post-exit) is the live heartbeat');
};

module.exports.armRefusalEventsSurfaceAsIncidents = function () {
  // RE-REVIEW A1/A4: a START the box REFUSES (stale/future, replay, no secret, bad
  // HMAC) must be visible on the screen, not a silent forever-pending arm.
  for (const kind of ['ARM_STALE_REQUEST', 'ARM_REPLAY_REJECTED', 'ARM_NO_SECRET', 'ARM_HMAC_INVALID']) {
    const st = derive([{ event: kind, utc: 't1', source: 'owner' }]);
    assert.strictEqual(st.incidents.length, 1, `${kind} must surface as an incident`);
    assert.strictEqual(st.incidents[0].kind, kind, `${kind} incident carries its kind`);
  }
};

module.exports.runStatusCarriesTheFixedStopBeingApplied = function () {
  const st = derive([
    { event: 'RUN_STATUS', armed: false, halted: false, fixed_stop_pct: 0.073 },
  ]);
  assert.strictEqual(st.fixedStopPct, 0.073, 'the box-applied fixed stop surfaces for the screen');
  const none = derive([{ event: 'RUN_STATUS', armed: false, halted: false }]);
  assert.strictEqual(none.fixedStopPct, null, 'no stop reported -> null (screen shows none set)');
};

module.exports.fixedStopSurfacesAsIncident = function () {
  // a hard fixed-stop close is a real money event — it must show on the screen.
  const st = derive([
    { event: 'FIXED_STOP', utc: 't1', chunk_start: 'c1', side: 'LONG',
      entry_price: 100, price: 94, stop_pct: 0.05, adverse_pct: 0.06 },
  ]);
  assert.strictEqual(st.incidents.length, 1, 'FIXED_STOP surfaces as an incident');
  assert.strictEqual(st.incidents[0].kind, 'FIXED_STOP');
};

module.exports.haltSetReflectsImmediatelyAndClears = function () {
  let st = derive([{ event: 'HALT_SET', source: 'executor', reason: 'x' }]);
  assert.strictEqual(st.halted, true, 'HALT_SET reflects the halt at once (not a cycle later)');
  st = derive([{ event: 'HALT_SET' }, { event: 'HALT_CLEAR' }]);
  assert.strictEqual(st.halted, false, 'HALT_CLEAR lifts it');
};

module.exports.balanceSnapshotSurfacesUsdtAndLtcFromTheLatestBalanceEvent = function () {
  const st = derive([
    { event: 'BALANCE', utc: '2026-08-11T22:00:00Z', base_net: '0.001', base_free: '0.001', quote_free: '150.5', quote_net: '150.5' },
    { event: 'BALANCE', utc: '2026-08-11T23:00:00Z', base_net: '0.00133575', base_free: '0.00133575', quote_free: '199.87083761', quote_net: '199.87083761' },
  ]);
  assert.ok(st.walletBalance, 'a BALANCE event populates walletBalance');
  assert.strictEqual(st.walletBalance.utc, '2026-08-11T23:00:00Z', 'the LATEST snapshot wins');
  assert.ok(Math.abs(st.walletBalance.usdtFree - 199.87083761) < 1e-8, 'USDT free parsed');
  assert.ok(Math.abs(st.walletBalance.ltcFree - 0.00133575) < 1e-8, 'LTC free parsed');
  assert.ok(Math.abs(st.walletBalance.usdtNet - 199.87083761) < 1e-8, 'USDT net parsed');
};

module.exports.noBalanceEventLeavesWalletBalanceNull = function () {
  const st = derive([
    { event: 'RUN_STATUS', armed: false, halted: false },
  ]);
  assert.strictEqual(st.walletBalance, null, 'no BALANCE -> null (screen shows "no snapshot yet")');
};

module.exports.liveStatusStoppedFlatBlocksEntryAndSchedulesNextEntryAt0100Utc = function () {
  const st = pv.derive([{ event: 'RUN_STATUS', armed: false, halted: false }]);
  const ls = pv.liveStatus(st, Date.UTC(2026, 7, 11, 12, 0, 0)); // 2026-08-11 12:00 UTC
  assert.strictEqual(ls.openPositions, 0, 'no open positions');
  assert.strictEqual(ls.armed, false);
  assert.strictEqual(ls.nextEntryUtc, '2026-08-12T01:00:00.000Z', 'next entry is the NEXT 01:00 UTC (noon is past today 01:00)');
  const entry = ls.items.find((i) => i.what.startsWith('Open a new position'));
  assert.ok(entry && entry.whenUtc === null && /STOPPED/.test(entry.why), 'entry is BLOCKED while stopped');
  assert.ok(ls.items.some((i) => /Recompute the live signal/.test(i.what)), 'recompute item always present');
  assert.ok(!ls.items.some((i) => /^Close the/.test(i.what)), 'no exit item when flat');
};

module.exports.liveStatusRunningSchedulesNextEntryToday = function () {
  const st = pv.derive([{ event: 'ARM_SET', source: 'owner' }]);
  const ls = pv.liveStatus(st, Date.UTC(2026, 7, 11, 0, 30, 0)); // 00:30 UTC -> today 01:00
  assert.strictEqual(ls.armed, true);
  assert.strictEqual(ls.nextEntryUtc, '2026-08-11T01:00:00.000Z');
  const entry = ls.items.find((i) => i.what.startsWith('Evaluate the next entry'));
  assert.ok(entry && entry.whenUtc === '2026-08-11T01:00:00.000Z', 'running: entry scheduled at 01:00 UTC');
};

module.exports.liveStatusCountsPositionsAndSchedulesNextExit = function () {
  const now = 1786500000000;
  const exitTs = Math.floor(now / 1000) + 3600 * 10; // 10h out, in seconds (journal convention)
  const st = pv.derive([
    { event: 'ENTRY_FILL', chunk_start: '2026-08-10T00:00Z', side: 'LONG', qty: 0.1, price: 100, exit_due_ts: exitTs },
    { event: 'ARM_SET', source: 'owner' },
  ]);
  const ls = pv.liveStatus(st, now);
  assert.strictEqual(ls.openLong, 1, 'one long open');
  assert.strictEqual(ls.openShort, 0);
  assert.strictEqual(ls.nextExitUtc, new Date(exitTs * 1000).toISOString(), 'next exit is the position exit_due_ts (seconds->ms)');
  const exit = ls.items.find((i) => i.what.startsWith('Close the LONG'));
  assert.ok(exit && exit.whenUtc === new Date(exitTs * 1000).toISOString(), 'exit item carries the absolute exit time');
};
