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

// The live decision needs the CURRENT chunk, whose +138h outcome window has not
// completed. buildComboChunks must keep it when includeUnlabeled is set and drop
// it otherwise — the difference between deciding today and deciding six days late.
module.exports.includeUnlabeledKeepsTheCurrentOutcomelessChunk = function () {
  const bracketLib = require('../lib/bracket');
  const HOUR = 3600000;
  const t0 = Date.parse('2026-06-01T00:00:00Z'); // a UTC day boundary
  // hourly candles from day0 00:00 to +140h — enough to LABEL the day0 chunk
  // (+138h) but not the day1 chunk (+162h), which is therefore outcomeless.
  const map = new Map();
  for (let h = 0; h <= 140; h++) {
    const ts = t0 + h * HOUR;
    const px = 100 + Math.sin(h / 5); // some movement so features aren't degenerate
    map.set(ts, { ts, open: px, high: px + 0.5, low: px - 0.5, close: px, quoteVolume: 1000 });
  }
  const maps = { trade: map, ctx1: map, ctx2: map };
  const labeled = bracketLib.buildComboChunks(maps, 'daily-4d', false, false).chunks;
  const withUnlabeled = bracketLib.buildComboChunks(maps, 'daily-4d', false, true).chunks;
  assert.strictEqual(withUnlabeled.length > labeled.length, true,
    'includeUnlabeled must keep more chunks than the labelled-only build');
  const newest = withUnlabeled[withUnlabeled.length - 1];
  assert.strictEqual(newest.label, null,
    'the newest kept chunk is the current outcomeless one (label null) — the live decision');
  // and the labelled-only build must NOT contain that outcomeless chunk
  assert.strictEqual(labeled.some((c) => c.startTs === newest.startTs), false,
    'the labelled-only path (every existing caller) is unchanged: no outcomeless chunk');
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

module.exports.chooseEntryOpenPrefersCacheThenLiveThenNull = function () {
  assert.strictEqual(ps.chooseEntryOpen(100, 101), 100, 'closed-cache open wins when present');
  assert.strictEqual(ps.chooseEntryOpen(null, 101), 101, 'live open used when cache is absent');
  assert.strictEqual(ps.chooseEntryOpen(undefined, 101), 101, 'undefined cache -> live');
  assert.strictEqual(ps.chooseEntryOpen(null, null), null, 'neither -> null (the signal waits)');
  assert.strictEqual(ps.chooseEntryOpen(0, 0), null, 'zero is not a real price -> null');
  assert.strictEqual(ps.chooseEntryOpen(-5, 101), 101, 'a bad cache value falls through to live');
};
