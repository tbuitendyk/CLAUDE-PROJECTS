// Pilot signal: the live half of PILOT-F1. These tests pin the NOVEL logic —
// which chunk is "actionable right now" — without touching the network, and
// prove the module mirrors the F1 forward book's frozen spec rather than
// inventing a parallel one.
const { assert } = require('./helpers');
const fs = require('fs');
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
  // Stage C (2026-08-19): the pilot's rule is RESOLVED, not read from a source
  // file at module load. With no deployment designated it still resolves to the
  // hardcoded F1 — so the armed engine is undisturbed — and this test now pins
  // both halves: the resolved rule is F1, AND it announces that it came from
  // code rather than data, so the remaining gap cannot go quiet.
  const f1 = fb.BOOKS.find((b) => b.id === 'F1');
  // AMBIENT STATE MUST NOT DECIDE THIS. resolveRule reads data/pilot/rule.json,
  // so a pointer left on the box — or staged locally while measuring — would
  // silently turn this into a different test. Move it aside for the duration.
  const ptrFile = require('path').join(__dirname, '..', 'data', 'pilot', 'rule.json');
  const hadPtr = fs.existsSync(ptrFile) ? fs.readFileSync(ptrFile) : null;
  if (hadPtr) fs.unlinkSync(ptrFile);
  try {
  const rule = ps.currentRule();
  // The NAME is deliberately not asserted. "F1" was invented by a session with
  // no meaning to the owner ("that name was just something that you came up
  // with no context for me", 2026-08-19) and is on its way out. What must hold
  // is the INSTRUMENT and where the rule came from — checked below — not a
  // label. Asserting the label would pin the very thing being removed.
  assert.strictEqual(rule.combo.trade, f1.combo.trade, 'traded pair must match F1');
  assert.strictEqual(rule.combo.trade, 'LTCUSDT', 'and F1 trades LTCUSDT only');
  assert.strictEqual(rule.cell.quorum, f1.cell.quorum, 'quorum must match F1');
  assert.strictEqual(rule.cell.entry, 'market', 'F1 is the market-entry cell');
  assert.strictEqual(rule.cell.tHours, 137, 'hold must match F1');
  assert.strictEqual(rule.__source, 'code',
    'with no deployment designated the rule must come from code AND say so — a '
    + 'silent fallback is how the hardcoded rule survives forever');
  } finally {
    if (hadPtr) fs.writeFileSync(ptrFile, hadPtr);
  }
};

module.exports.chooseEntryOpenPrefersCacheThenLiveThenNull = function () {
  assert.strictEqual(ps.chooseEntryOpen(100, 101), 100, 'closed-cache open wins when present');
  assert.strictEqual(ps.chooseEntryOpen(null, 101), 101, 'live open used when cache is absent');
  assert.strictEqual(ps.chooseEntryOpen(undefined, 101), 101, 'undefined cache -> live');
  assert.strictEqual(ps.chooseEntryOpen(null, null), null, 'neither -> null (the signal waits)');
  assert.strictEqual(ps.chooseEntryOpen(0, 0), null, 'zero is not a real price -> null');
  assert.strictEqual(ps.chooseEntryOpen(-5, 101), 101, 'a bad cache value falls through to live');
};

module.exports.previewableIsTheChunkWithFeaturesClosedAndEntryPending = function () {
  const chunks = [];
  for (let d = 1; d <= 12; d++) chunks.push(chunkAt(`2026-08-${String(d).padStart(2, '0')}T00:00:00Z`));
  const aug5 = Date.parse('2026-08-05T00:00:00Z'); // features close +96h (Aug 9 00:00); entry +97h (Aug 9 01:00)
  const now = aug5 + 96 * HOUR + 5 * 60000; // Aug 9 00:05 — window closed, entry pending
  const got = ps.previewableChunk(chunks, GEO, now);
  assert.ok(got && new Date(got.startTs).toISOString() === '2026-08-05T00:00:00.000Z',
    'previewable = the chunk whose 96h window has closed and whose entry is still ahead');
};

module.exports.previewableIsNullBeforeFeatureWindowCloses = function () {
  const chunks = [chunkAt('2026-08-05T00:00:00Z')];
  const now = Date.parse('2026-08-05T00:00:00Z') + 90 * HOUR; // before +96h
  assert.strictEqual(ps.previewableChunk(chunks, GEO, now), null, 'nothing to preview until the window closes');
};

module.exports.previewableIsNullOnceEntryHasArrived = function () {
  const chunks = [chunkAt('2026-08-05T00:00:00Z')];
  const now = Date.parse('2026-08-05T00:00:00Z') + 97 * HOUR + 10 * 60000; // just past entry
  assert.strictEqual(ps.previewableChunk(chunks, GEO, now), null, 'past the entry hour it is actionable, not previewable');
};
