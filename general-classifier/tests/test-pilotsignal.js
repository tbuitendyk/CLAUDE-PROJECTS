// Pilot signal: the live half of PILOT-F1. These tests pin the NOVEL logic —
// which chunk is "actionable right now" — without touching the network, and
// prove the module mirrors the F1 forward book's frozen spec rather than
// inventing a parallel one.
const { assert } = require('./helpers');
const ps = require('../lib/pilotsignal');
const fb = require('../lib/forwardbook');

const HOUR = 3600000;
// daily-4d as the engine defines it: entry +97h, hold governed by the cell.
const GEO = { entryOffsetH: 97, exitOffsetH: 138, featureHours: 96 };
const T_HOURS = 137; // F1 cell

function chunkAt(iso) { return { startTs: Date.parse(iso) }; }

// A window laid out as consecutive daily chunks; "now" is chosen relative to
// one chunk's entry hour so the expected answer is unambiguous.
module.exports.actionableIsTheChunkWhoseEntryHasArrivedAndHoldIsOpen = function () {
  const chunks = [];
  for (let d = 1; d <= 12; d++) chunks.push(chunkAt(`2026-08-${String(d).padStart(2, '0')}T00:00:00Z`));
  // pick chunk for Aug 5: entry at Aug 5 + 97h = Aug 9 01:00; exit at +137h = Aug 14 18:00.
  const aug5 = Date.parse('2026-08-05T00:00:00Z');
  const now = aug5 + 97 * HOUR + 3 * HOUR; // 3h after entry, well inside the hold
  const got = ps.actionableChunk(chunks, GEO, T_HOURS, now);
  assert.strictEqual(new Date(got.startTs).toISOString(), '2026-08-05T00:00:00.000Z',
    'the actionable chunk is the newest one whose entry has arrived and whose hold is still open');
};

module.exports.beforeEntryHourNothingIsActionable = function () {
  const chunks = [chunkAt('2026-08-10T00:00:00Z')];
  const start = Date.parse('2026-08-10T00:00:00Z');
  const now = start + 50 * HOUR; // entry is at +97h, not yet reached
  assert.strictEqual(ps.actionableChunk(chunks, GEO, T_HOURS, now), null,
    'a chunk whose entry hour has not arrived is not actionable');
};

module.exports.afterHoldClosesTheChunkIsNoLongerActionable = function () {
  const chunks = [chunkAt('2026-08-01T00:00:00Z')];
  const start = Date.parse('2026-08-01T00:00:00Z');
  const now = start + (97 + T_HOURS + 1) * HOUR; // one hour past the exit
  assert.strictEqual(ps.actionableChunk(chunks, GEO, T_HOURS, now), null,
    'once the hold has closed the position is already out; nothing to open');
};

module.exports.newestOpenChunkWinsWhenSeveralOverlap = function () {
  // With a 137h hold and 24h step, several chunks are simultaneously open;
  // the live decision is the NEWEST — older ones are already positions.
  const chunks = [];
  for (let d = 1; d <= 10; d++) chunks.push(chunkAt(`2026-08-${String(d).padStart(2, '0')}T00:00:00Z`));
  const now = Date.parse('2026-08-09T00:00:00Z') + 97 * HOUR + HOUR; // just after Aug 9 entry
  const got = ps.actionableChunk(chunks, GEO, T_HOURS, now);
  assert.strictEqual(new Date(got.startTs).toISOString(), '2026-08-09T00:00:00.000Z',
    'among overlapping open chunks the newest (the one entering now) is the decision');
};

// The pilot must ride the SAME frozen instrument as the F1 forward book; if the
// two ever point at different coins or cells, the live fills stop being twins
// of the paper record. This makes that drift tamper-evident.
module.exports.pilotTradesExactlyTheF1ForwardBookInstrument = function () {
  const f1 = fb.BOOKS.find((b) => b.id === 'F1');
  assert.strictEqual(ps.F1.id, 'F1', 'pilot must reference the F1 book');
  assert.strictEqual(ps.F1.combo.trade, f1.combo.trade, 'traded pair must match F1');
  assert.strictEqual(ps.F1.combo.trade, 'LTCUSDT', 'and F1 trades LTCUSDT only');
  assert.strictEqual(ps.F1.cell.quorum, f1.cell.quorum, 'quorum must match F1');
  assert.strictEqual(ps.F1.cell.entry, 'market', 'F1 is the market-entry cell');
  assert.strictEqual(ps.F1.cell.tHours, 137, 'hold must match F1');
};
