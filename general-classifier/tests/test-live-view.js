// Per-setup view + fidelity (plan phase 6): synthetic box journals feed the
// derivation; real and paper ledgers stay separate; fidelity aggregates the
// numbers the pilot exists to measure.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const view = require('../lib/live/view');

function withJournal(events, fn) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-live-j-')), 'journal.jsonl');
  fs.writeFileSync(f, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return fn(f);
}

module.exports.realBookDerivesOpenClosedAndRealized = function () {
  withJournal([
    { event: 'ENTRY_FILL', setup_id: 'a', chunk_start: 'c1', side: 'LONG', qty: 0.2, price: 100, fee_quote: 0.01, fill_deviation: 0.001, exit_due_ts: 2e9 },
    { event: 'PNL_MTM', price: 105 },
    { event: 'ENTRY_FILL', setup_id: 'a', chunk_start: 'c2', side: 'LONG', qty: 0.2, price: 100, fee_quote: 0.01, fill_deviation: 0.002, exit_due_ts: 3e9 },
    { event: 'EXIT_FILL', setup_id: 'a', chunk_start: 'c1', side: 'LONG', qty: 0.2, price: 110, fee_quote: 0.01, pnl: 1.98 },
  ], (f) => {
    const b = view.deriveSetup(view.readJournal(f).events, 'a');
    assert.strictEqual(b.openPositions.length, 1, 'c2 still open, c1 closed');
    assert.strictEqual(b.openPositions[0].chunk_start, 'c2');
    assert.ok(Math.abs(b.realizedPnl - 1.98) < 1e-9);
    assert.strictEqual(b.markPrice, 105);
    // unrealized on the open c2: (105-100)*0.2 = 1.0
    assert.ok(Math.abs(b.unrealizedPnl - 1.0) < 1e-9);
    assert.strictEqual(b.fidelity.fills, 2, 'both entries counted for fidelity');
    assert.ok(Math.abs(b.fidelity.fillDeviationAvg - 0.0015) < 1e-9);
  });
};

module.exports.paperAndRealLedgersNeverMix = function () {
  withJournal([
    { event: 'ENTRY_FILL', setup_id: 'real', chunk_start: 'r1', side: 'LONG', qty: 0.2, price: 100, exit_due_ts: 2e9 },
    { event: 'EXIT_FILL', setup_id: 'real', chunk_start: 'r1', side: 'LONG', qty: 0.2, price: 110, pnl: 2.0 },
    { event: 'PAPER_ENTRY_FILL', setup_id: 'pap', chunk_start: 'p1', side: 'LONG', qty: 0.2, price: 100, exit_due_ts: 2e9 },
    { event: 'PAPER_EXIT_FILL', setup_id: 'pap', chunk_start: 'p1', side: 'LONG', qty: 0.2, price: 90, pnl: -2.05 },
  ], (f) => {
    const ev = view.readJournal(f).events;
    const real = view.deriveSetup(ev, 'real');
    const pap = view.deriveSetup(ev, 'pap');
    assert.ok(Math.abs(real.realizedPnl - 2.0) < 1e-9);
    assert.strictEqual(real.paperRealizedPnl, 0, 'a real setup has no paper P&L');
    assert.ok(Math.abs(pap.paperRealizedPnl - (-2.05)) < 1e-9);
    assert.strictEqual(pap.realizedPnl, 0, 'a paper setup never books real P&L');
    assert.ok(pap.closedRecent[0].paper === true);
  });
};

module.exports.eventsOfOtherSetupsAreIgnored = function () {
  withJournal([
    { event: 'ENTRY_FILL', setup_id: 'a', chunk_start: 'c1', side: 'LONG', qty: 0.2, price: 100, exit_due_ts: 2e9 },
    { event: 'ENTRY_FILL', setup_id: 'b', chunk_start: 'c1', side: 'SHORT', qty: 0.2, price: 100, exit_due_ts: 2e9 },
  ], (f) => {
    const b = view.deriveSetup(view.readJournal(f).events, 'a');
    assert.strictEqual(b.openPositions.length, 1);
    assert.strictEqual(b.openPositions[0].side, 'LONG', 'only this setup\'s position');
  });
};

module.exports.setupStatusMergesRegistryAndBook = function () {
  withJournal([
    { event: 'ENTRY_FILL', setup_id: 's9', chunk_start: 'c1', side: 'LONG', qty: 0.2, price: 100, exit_due_ts: 2e9 },
    { event: 'PNL_MTM', price: 101 },
  ], (f) => {
    const st = view.setupStatus(
      { id: 's9', name: 'nine', state: 'paper', tradedPair: 'LTCUSDT', clipUsd: 20, stopPct: null }, f);
    assert.strictEqual(st.name, 'nine');
    assert.strictEqual(st.paper, true, 'state=paper -> paper flag');
    assert.strictEqual(st.markPrice, 101);
    assert.strictEqual(st.openPositions.length, 1);
    assert.strictEqual(st.journalPresent, true);
  });
};

module.exports.absentJournalIsAStateNotAnError = function () {
  const st = view.setupStatus({ id: 'x', name: 'x', state: 'draft', tradedPair: 'LTCUSDT', clipUsd: 10, stopPct: null },
    '/nonexistent/journal.jsonl');
  assert.strictEqual(st.journalPresent, false);
  assert.strictEqual(st.openPositions.length, 0);
  assert.strictEqual(st.realizedPnl, 0);
};
