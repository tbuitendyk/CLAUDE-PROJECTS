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

module.exports.paperAndRealUnrealizedAreSeparate = function () {
  // R9: after a paper->live transition a setup can hold BOTH books open at once.
  // The summary must keep real unrealized and paper unrealized SEPARATE (as
  // realized already is) — never one mixed number of real + fictional money.
  withJournal([
    { event: 'ENTRY_FILL', setup_id: 'm', chunk_start: 'r1', side: 'LONG', qty: 0.2, price: 100, exit_due_ts: 2e9 },
    { event: 'PAPER_ENTRY_FILL', setup_id: 'm', chunk_start: 'p1', side: 'LONG', qty: 0.4, price: 100, exit_due_ts: 3e9 },
    { event: 'PNL_MTM', price: 110 },
  ], (f) => {
    const b = view.deriveSetup(view.readJournal(f).events, 'm');
    // real open r1: (110-100)*0.2 = 2.0 ; paper open p1: (110-100)*0.4 = 4.0
    assert.ok(Math.abs(b.unrealizedPnl - 2.0) < 1e-9, `real unrealized 2.0, got ${b.unrealizedPnl}`);
    assert.ok(Math.abs(b.paperUnrealizedPnl - 4.0) < 1e-9, `paper unrealized 4.0, got ${b.paperUnrealizedPnl}`);
    assert.strictEqual(b.openPositions.length, 2, 'both books listed');
    assert.strictEqual(b.openPositions.filter((p) => p.paper).length, 1, 'one badged paper');
  });
};

module.exports.fidelityCountsOnlyRealNonRecoveredFills = function () {
  // R16: execution fidelity measures REAL, non-recovered fills vs their decision
  // price. A recovered fill fabricates deviation 0.0 (decision price lost in the
  // crash) and a paper fill is the lab twin — neither belongs in the real average.
  withJournal([
    { event: 'ENTRY_FILL', setup_id: 'f', chunk_start: 'c1', side: 'LONG', qty: 0.2, price: 100, fill_deviation: 0.01, exit_due_ts: 2e9 },
    { event: 'ENTRY_FILL', setup_id: 'f', chunk_start: 'c2', side: 'LONG', qty: 0.2, price: 100, fill_deviation: 0.0, recovered: true, exit_due_ts: 3e9 },
    { event: 'PAPER_ENTRY_FILL', setup_id: 'f', chunk_start: 'p1', side: 'LONG', qty: 0.2, price: 100, fill_deviation: 0.02, exit_due_ts: 4e9 },
  ], (f) => {
    const b = view.deriveSetup(view.readJournal(f).events, 'f');
    assert.strictEqual(b.fidelity.fills, 1, 'only the real non-recovered fill counts for real fidelity');
    assert.ok(Math.abs(b.fidelity.fillDeviationAvg - 0.01) < 1e-9, 'real 0.01, not diluted by a fabricated 0.0');
    assert.strictEqual(b.fidelity.recoveredFills, 1, 'recovered fill counted separately');
    assert.strictEqual(b.fidelity.paperFills, 1, 'paper fill counted separately');
    assert.ok(Math.abs(b.fidelity.paperFillDeviationAvg - 0.02) < 1e-9, 'paper deviation in its own bucket');
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

// THE MERGED LIST HAS TO BE UNMERGED BEFORE IT IS SHOWN. deriveSetup keeps real
// and paper money separate — that is R9, above — and then returns ONE
// openPositions array carrying a per-row paper flag. Every consumer that shows a
// count or a table alongside a branch-selected P&L has to filter it, and none of
// them did: the Trading tab's detail page, its Dashboard cards, and the channel
// summary in lib/live/routes.js all counted both books. On a setup that has
// legally gone paper -> live, the count and the money above it disagreed, with
// fictional positions listed under a real-money heading (audit 2026-08-17).
//
// Watched failing 2026-08-17: dropping any one of the three filters makes its
// own assertion below report 2 where the side has 1.
module.exports.everyConsumerOfTheMergedListFiltersItToOneBook = function () {
  const fs2 = require('fs');
  const path2 = require('path');
  const ROOT2 = path2.join(__dirname, '..');
  const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const LT = strip(fs2.readFileSync(path2.join(ROOT2, 'public', 'trading.html'), 'utf8'));
  const RT = strip(fs2.readFileSync(path2.join(ROOT2, 'lib', 'live', 'routes.js'), 'utf8'));

  const flat = LT.replace(/\s/g, '');
  assert.ok(flat.includes('openHere=(st.openPositions||[]).filter(p=>isP?p.paper:!p.paper)'),
    'the setup detail page no longer filters the merged position list to this side\'s book');
  assert.ok(!/st\.openPositions\.length/.test(LT),
    'something reads the MERGED length again — it must read the filtered list');
  assert.ok(flat.includes('filter(p=>g.f1?!p.paper:(isP?p.paper:!p.paper))'),
    'the Dashboard card counts both books again');
  assert.ok(/c === 'paper' \? !!p\.paper : !p\.paper/.test(RT),
    'the channel summary counts both books again — a paper channel would report the real channel\'s open positions');
};

// And the behaviour the filters exist for, on a real derived book.
module.exports.aSetupHoldingBothBooksReportsOnePositionPerSide = function () {
  withJournal([
    { event: 'ENTRY_FILL', setup_id: 'both', chunk_start: 'r1', side: 'LONG', qty: 0.2, price: 100, exit_due_ts: 2e9 },
    { event: 'PAPER_ENTRY_FILL', setup_id: 'both', chunk_start: 'p1', side: 'SHORT', qty: 0.4, price: 100, exit_due_ts: 3e9 },
    { event: 'PNL_MTM', price: 110 },
  ], (f) => {
    const b = view.deriveSetup(view.readJournal(f).events, 'both');
    const real = b.openPositions.filter((p) => !p.paper);
    const paper = b.openPositions.filter((p) => p.paper);
    assert.strictEqual(real.length, 1, 'the real side holds exactly one position');
    assert.strictEqual(paper.length, 1, 'the paper side holds exactly one position');
    assert.strictEqual(b.openPositions.length, 2,
      'the merged list still carries both — the filtering is the consumer\'s job, and this is why');
    assert.strictEqual(real[0].side, 'LONG');
    assert.strictEqual(paper[0].side, 'SHORT');
  });
};
