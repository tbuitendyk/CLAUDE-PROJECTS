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
  // THE MODEL FEE IS SCALED TO THE CLIP. lib/paper.js quotes the lab assumption
  // as $0.125 per leg AT $100 SIZE — 0.125% of notional. The pilot trades a $10
  // clip, so the like-for-like figure is $0.0125. Publishing the $100 number
  // beside the fee actually paid on $10 made live execution look ten times
  // cheaper than modelled; the RATE is the invariant and must be published with
  // it (owner, 2026-08-18).
  assert.strictEqual(st.modelFeePerLeg, 0.0125,
    'the model fee must be the lab rate scaled to the clip this pilot actually trades');
  assert.strictEqual(st.modelFeeRate, 0.00125, 'and the rate itself must be published, since that is what compares');
  assert.strictEqual(st.clipUsd, 10, 'with the clip it was scaled by, so the two numbers can be checked');
  const { REAL_FEE_PER_LEG } = require('../lib/paper');
  assert.strictEqual(st.modelFeeRate, REAL_FEE_PER_LEG / 100,
    'the rate must be DERIVED from the lab constant, not a second copy of it that can drift');
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

module.exports.schema2EventsNeverCorruptTheF1View = function () {
  // R6: schema-2 (generalized setup) events share the one journal but carry a
  // setup_id. The F1 screen must ignore them entirely — never fold their P&L into
  // F1 realized, never overwrite an F1 row on the same chunk_start, never bump F1's
  // reject streak. (The plan's 10.4 paper twin produces byte-identical chunk_starts,
  // so the collision is the run's stated goal, not a corner case.)
  const st = derive([
    // F1 (schema-1) opens a LONG on chunk c1 and it stays open
    { event: 'INTENT_SEEN', chunk_start: 'c1', side: 'LONG', decision_price: 100 },
    { event: 'ENTRY_FILL', chunk_start: 'c1', side: 'LONG', qty: 0.1, price: 100, fee_quote: 0.01, exit_due_ts: 2e9 },
    // schema-2 events on the SAME chunk_start — must be invisible to the F1 view
    { event: 'INTENT_SEEN', chunk_start: 'c1', side: 'LONG', decision_price: 100, setup_id: 's-x', paper: true },
    { event: 'ENTRY_FILL', chunk_start: 'c1', side: 'LONG', qty: 0.2, price: 100, exit_due_ts: 2e9, setup_id: 's-x' },
    { event: 'EXIT_FILL', chunk_start: 'c1', side: 'LONG', qty: 0.2, price: 200, pnl: 99.0, setup_id: 's-x' },
    { event: 'ORDER_REJECT', action: 'ENTRY', setup_id: 's-x' },
    { event: 'ORDER_REJECT', action: 'ENTRY', setup_id: 's-x' },
  ]);
  assert.strictEqual(st.openPositions.length, 1, 'F1 position stays open; a schema-2 exit must not close it');
  assert.strictEqual(st.realizedPnl, 0, 'schema-2 P&L must never enter F1 realized');
  assert.strictEqual(st.closedRecent.length, 0, 'a schema-2 close must not appear in F1 closed');
  assert.strictEqual(st.consecutiveRejects, 0, 'schema-2 rejects must not bump F1 reject streak');
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

module.exports.standDownRecordsFillTheHistoryTheJournalCannot = function () {
  // Owner 2026-08-13: FLAT calls ship no intent, so the box journal — the only
  // source the history read — carried nothing for stand-down days and the daily
  // history showed only trade days. VPS-side stand-down records are merged in;
  // the journal always wins on a key collision (it is the record).
  const st = pv.derive([
    { event: 'INTENT_SEEN', utc: 't1', chunk_start: '2026-08-08T00:00Z', side: 'LONG',
      per_member: [0, 0, 1, 0], quorum: 1, decision_price: 45.59, input_hash: 'aa' },
    { event: 'ENTRY_FILL', utc: 't2', chunk_start: '2026-08-08T00:00Z', side: 'LONG',
      qty: 0.2, price: 45.6, exit_due_ts: 2e9 },
  ], { standDowns: [
    { chunk_start: '2026-08-09T00:00Z', side: 'FLAT', per_member: [0, 0, 0, 0], quorum: 1,
      produced_utc: 'p1' },
    { chunk_start: '2026-08-10T00:00Z', side: 'FLAT', per_member: [0, -1, 0, 0], quorum: 1,
      produced_utc: 'p2', backfilled: true },
    // collision: the journal already carries 08-08 as a filled LONG — the
    // stand-down record must NOT overwrite it
    { chunk_start: '2026-08-08T00:00Z', side: 'FLAT', per_member: [0, 0, 0, 0], quorum: 1 },
  ] });
  assert.strictEqual(st.decisions.length, 3, 'stand-down days join the history');
  assert.strictEqual(st.decisions[0].chunk_start, '2026-08-10T00:00Z', 'newest first');
  assert.strictEqual(st.decisions[0].fate, 'stand down', 'no provenance jargon on screen (owner 2026-08-13)');
  assert.deepStrictEqual(st.decisions[0].votes, [0, -1, 0, 0], 'stand-down votes surface');
  assert.strictEqual(st.decisions[1].fate, 'stand down');
  assert.strictEqual(st.decisions[2].side, 'LONG', 'journal wins the collision');
  assert.strictEqual(st.decisions[2].fate, 'filled');
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

module.exports.liveStatusEvaluatesAtWindowCloseNotAtEntry = function () {
  // owner 2026-08-12 timing fix: the committee EVALUATES when the 96h feature
  // window CLOSES, at 00:00 UTC — one clear hour BEFORE the 01:00 entry fires. The
  // "Evaluate the next entry" item must count down to 00:00 (window close), NOT to
  // the entry/execution time at 01:00.
  const st = pv.derive([{ event: 'ARM_SET', source: 'owner' }]);
  const ls = pv.liveStatus(st, Date.UTC(2026, 7, 11, 12, 0, 0)); // 2026-08-11 12:00 UTC
  assert.strictEqual(ls.armed, true);
  assert.strictEqual(ls.nextEntryUtc, '2026-08-12T01:00:00.000Z', 'entry (execution) is the next 01:00 UTC');
  assert.strictEqual(ls.nextEvalUtc, '2026-08-12T00:00:00.000Z', 'evaluation is the next 00:00 UTC — 1h before the entry');
  const evalItem = ls.items.find((i) => i.what.startsWith('Evaluate the next entry'));
  assert.ok(evalItem && evalItem.whenUtc === '2026-08-12T00:00:00.000Z',
    'evaluate item counts down to window close (00:00), NOT the entry time (01:00)');
};

module.exports.ltcPositionNetsLongMinusShort = function () {
  const st = pv.derive([
    { event: 'ENTRY_FILL', chunk_start: 'c1', side: 'LONG', qty: 0.22, price: 45, exit_due_ts: 2e9 },
    { event: 'ENTRY_FILL', chunk_start: 'c2', side: 'SHORT', qty: 0.10, price: 46, exit_due_ts: 2e9 },
  ]);
  assert.ok(Math.abs(st.ltcPosition.longLtc - 0.22) < 1e-9, 'long total');
  assert.ok(Math.abs(st.ltcPosition.shortLtc - 0.10) < 1e-9, 'short total');
  assert.ok(Math.abs(st.ltcPosition.netLtc - 0.12) < 1e-9, 'net LTC = long - short');
  assert.strictEqual(st.ltcPosition.longCount, 1);
  assert.strictEqual(st.ltcPosition.shortCount, 1);
};

module.exports.markPriceAndUnrealizedComeFromPnlMtm = function () {
  const st = pv.derive([
    { event: 'ENTRY_FILL', chunk_start: 'c1', side: 'LONG', qty: 0.2, price: 45, exit_due_ts: 2e9 },
    { event: 'ENTRY_FILL', chunk_start: 'c2', side: 'SHORT', qty: 0.1, price: 50, exit_due_ts: 2e9 },
    { event: 'PNL_MTM', price: 46, mark_to_market: 1.2, open_legs: 2, utc: '2026-08-12T01:10:16Z' },
  ]);
  assert.strictEqual(st.markPrice, 46, 'mark price from the latest PNL_MTM');
  assert.strictEqual(st.markUtc, '2026-08-12T01:10:16Z');
  // LONG (46-45)*0.2 = +0.2 ; SHORT (46-50)*0.1 negated = +0.4 ; total +0.6
  assert.ok(Math.abs(st.unrealizedPnl - 0.6) < 1e-9, 'net unrealized = long +0.2 + short +0.4');
  const long = st.openPositions.find((p) => p.side === 'LONG');
  const short = st.openPositions.find((p) => p.side === 'SHORT');
  assert.ok(Math.abs(long.unrealized - 0.2) < 1e-9, 'long gains as price rises above entry');
  assert.ok(Math.abs(short.unrealized - 0.4) < 1e-9, 'short gains as price falls below entry');
  assert.strictEqual(long.markPrice, 46, 'each open row carries the mark price');
};

module.exports.noPnlMtmLeavesMarkAndUnrealizedNull = function () {
  const st = pv.derive([{ event: 'ENTRY_FILL', chunk_start: 'c1', side: 'LONG', qty: 0.2, price: 45, exit_due_ts: 2e9 }]);
  assert.strictEqual(st.markPrice, null, 'no PNL_MTM -> no mark price (screen shows "—")');
  assert.strictEqual(st.unrealizedPnl, null);
  assert.strictEqual(st.openPositions[0].unrealized, null);
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

module.exports.dataFreshnessMeasuresFromCandleCloseNotOpenStamp = function () {
  const now = Date.UTC(2026, 7, 12, 1, 0, 0); // 2026-08-12 01:00 UTC
  const H = 3600000;
  const df = pv.dataFreshness([
    { symbol: 'LTCUSDT', ts: now - 1 * H },   // opened 1h ago, closes now -> fresh (close-age 0)
    { symbol: 'XRPUSDT', ts: now - 2.5 * H }, // open-age 2.5h BUT closed only 1.5h ago -> still fresh
    { symbol: 'BCHUSDT', ts: now - 5 * H },   // closed 4h ago -> stale
    { symbol: 'DOGEUSDT', ts: null },         // missing -> stale
  ], now);
  assert.strictEqual(df[0].stale, false, 'just-closed candle is fresh');
  assert.strictEqual(df[0].throughUtc, new Date(now).toISOString(), 'complete-through = open stamp + 1h');
  assert.ok(Math.abs(df[0].closedAgeHours - 0) < 1e-9, 'closed-age measured from the candle close');
  assert.strictEqual(df[1].stale, false, 'open-age 2.5h but closed only 1.5h ago -> fresh (the artifact fix)');
  assert.ok(Math.abs(df[1].closedAgeHours - 1.5) < 1e-9);
  assert.strictEqual(df[2].stale, true, 'closed 4h ago -> stale');
  assert.strictEqual(df[3].stale, true, 'missing -> stale');
  assert.strictEqual(df[3].throughUtc, null, 'missing -> null through-time');
};

// "What happens next" must show what actually happens next (owner, 2026-08-19).
//
// Three faults, all in the same panel, all of the same kind — the screen
// answering a question with less than the truth:
//   * it said "opened <chunk_start>", the FEATURE WINDOW's start, not the fill.
//     A position filled 2026-08-18 01:00 read as 2026-08-14 00:00.
//   * it listed only the SOONEST exit, so a second open position was invisible
//     on the one panel whose job is to enumerate what is coming.
//   * the hourly recompute sat last with no clock, reading as an aside, when it
//     is the thing that happens soonest and most often.
module.exports.whatHappensNextShowsEveryOpenPositionAndTheRealFillTime = function () {
  const pv = require('../lib/pilotview');
  const now = Date.UTC(2026, 7, 19, 14, 30, 0);
  const st = {
    armed: true,
    halted: false,
    openPositions: [
      { side: 'SHORT', chunk_start: '2026-08-14T00:00:00.000Z',
        entry_ts: Date.UTC(2026, 7, 18, 1, 0, 0) / 1000,
        exit_due_ts: Date.UTC(2026, 7, 23, 18, 10, 0) / 1000 },
      { side: 'SHORT', chunk_start: '2026-08-18T00:00:00.000Z',
        entry_ts: Date.UTC(2026, 7, 19, 1, 0, 0) / 1000,
        exit_due_ts: Date.UTC(2026, 7, 24, 18, 10, 0) / 1000 },
    ],
  };
  const items = pv.liveStatus(st, now).items || [];

  const closes = items.filter((i) => /^Close the /.test(i.what));
  assert(closes.length === 2,
    `both open positions must be listed; got ${closes.length} of 2`);
  assert(/opened 2026-08-18 01:00/.test(closes[0].what),
    `the fill time must be shown, not the feature window: "${closes[0].what}"`);
  assert(!/2026-08-14/.test(closes[0].what),
    'the chunk_start is being shown as the open time again');
  assert(closes[0].whenUtc < closes[1].whenUtc, 'exits must be soonest-first');

  const recompute = items.findIndex((i) => /^Recompute the live signal/.test(i.what));
  assert(recompute === 0, `the hourly recompute must lead the list; it is at ${recompute}`);
  assert(items[recompute].whenUtc, 'the recompute must carry a clock like every other item');
  assert(/15:05/.test(items[recompute].whenUtc),
    `the recompute clock must be the next :05 tick, got ${items[recompute].whenUtc}`);
};

// A position with no recorded fill time must SAY the value is a window start,
// not quietly present it as the open time — that is the original bug's shape.
module.exports.aPositionWithNoFillTimeSaysSoRatherThanPretending = function () {
  const pv = require('../lib/pilotview');
  const now = Date.UTC(2026, 7, 19, 14, 30, 0);
  const st = { armed: true, halted: false,
    openPositions: [{ side: 'LONG', chunk_start: '2026-08-14T00:00:00.000Z',
      exit_due_ts: Date.UTC(2026, 7, 23, 18, 10, 0) / 1000 }] };
  const close = (pv.liveStatus(st, now).items || []).find((i) => /^Close the /.test(i.what));
  assert(close && /window start/.test(close.what),
    `a missing fill time must be labelled, not shown as the open: "${close && close.what}"`);
};
