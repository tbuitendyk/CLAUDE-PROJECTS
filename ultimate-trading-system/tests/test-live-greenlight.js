// Greenlight + shuttle (plan phase 4): config construction from the lab's own
// selection anchor, freeze rules, provenance chain integrity, and the
// no-hand-built-configs door. Synthetic lab docs; scratch dirs for both
// registries.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.GC_SETUPS_DIR = process.env.GC_SETUPS_DIR
  || fs.mkdtempSync(path.join(os.tmpdir(), 'gc-gl-setups-'));
process.env.GC_GREENLIGHTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-gl-'));

const gl = require('../lib/live/greenlight');
const reg = require('../lib/live/setups');

// A synthetic saved bracket-lab doc shaped like the real thing: the selection
// row carries what listable board rows carry (confirm consumes the same).
function labDoc(over = {}) {
  return {
    id: 'bracketlab-20260801-101010-test',
    kind: 'bracketlab',
    startedAt: '2026-08-01T10:10:10.000Z',
    finishedAt: '2026-08-01T12:00:00.000Z',
    campaign: 'ltc-drill-aug',
    dataManifest: { overall: 'abc123', symbols: { LTCUSDT: 'd1', XRPUSDT: 'd2', BCHUSDT: 'd3' } },
    selection: {
      trade: 'LTCUSDT', ctx1: 'XRPUSDT', ctx2: 'BCHUSDT', size: 3,
      geometry: 'daily-4d', decision: 'argmax', bandMode: 1.69, bandPct: 1.69,
      weekdaysOnly: false, members: require('../lib/bracketwork').specsFor(3, 'slim').length,
      quorum: 1, entry: 'market', gate: 'directional', dMult: null,
      tHours: 137, trailMult: null, armMult: null,
      pnl: 158.32, trades: 224,
      holdout: { pnl: 41.1, trades: 40 },
      declaredCell: {
        quorum: 1, entry: 'market', gate: 'directional', dMult: null,
        tHours: 137, trailMult: null, armMult: null,
      },
    },
    ...over,
  };
}

module.exports.greenlightFreezesTheSelectedRowIntoTheSharedVocabulary = function () {
  const rec = gl.greenlightFromRun(labDoc(), 'best', { name: 'test config', why: 'money screen + null + holdout all cleared' ,});
  const cfg = rec.configSnapshot;
  assert.strictEqual(cfg.combo.trade, 'LTCUSDT');
  assert.strictEqual(cfg.branch.band, 1.69, 'band frozen as the resolved NUMBER');
  assert.strictEqual(cfg.stage, 'slim', 'stage derived from committee width (4 @ size 3)');
  assert.strictEqual(cfg.members.length, 4);
  assert.strictEqual(cfg.cell.tHours, 137);
  // WAS: trainThrough had to equal the run's fire time. That premise is gone
  // (owner, 2026-08-19) — a rule carries no training window, and inferring one
  // from when somebody clicked was never defensible. The greenlight must now
  // mint NO freeze at all; when members train is the deployment's choice.
  assert.strictEqual(cfg.trainThrough, undefined,
    'the greenlight is still inventing a training freeze from the run');
  assert.ok(cfg.configVersion.startsWith('bracketlab-20260801-101010-test/best@'));
  assert.strictEqual(rec.campaign, 'ltc-drill-aug', 'provenance carries the parent job');
  assert.deepStrictEqual(rec.sourceRun.dataManifest.symbols.LTCUSDT, 'd1', 'QC-77 manifest rides along');
  assert.ok(/^gc-/.test(rec.engineVersion), 'engine version recorded (point 18)');
};

module.exports.greenlightRefusalsAreLoudAndSpecific = function () {
  const cases = [
    [() => gl.greenlightFromRun(labDoc({ kind: 'screen' }), 'best', { name: 'test config', why: 'x' ,}), /bracket-lab/],
    [() => gl.greenlightFromRun(labDoc(), 'best', {}), /WHY/],
    [() => gl.greenlightFromRun(labDoc({ selection: null }), 'best', { name: 'test config', why: 'x' ,}), /select a leader|no selected row/],
    [() => { const d = labDoc(); delete d.selection.declaredCell; return gl.greenlightFromRun(d, 'declared', { name: 'test config', why: 'x' ,}); }, /declared cell/],
    [() => { const d = labDoc(); d.selection.bandPct = undefined; return gl.greenlightFromRun(d, 'best', { name: 'test config', why: 'x' ,}); }, /bandPct/],
    [() => { const d = labDoc(); d.selection.members = 5; return gl.greenlightFromRun(d, 'best', { name: 'test config', why: 'x' ,}); }, /stage/],
    // WAS: a run with no startedAt was refused, because the greenlight needed a
    // date to place its training freeze. It needs no date now — a rule carries
    // no training window — so this is no longer a refusal and the case is gone.
    [() => gl.greenlightFromRun(labDoc(), 'wildcard', { name: 'test config', why: 'x' ,}), /best.*declared|declared.*best/],
  ];
  for (const [fn, re] of cases) {
    let err = null;
    try { fn(); } catch (e) { err = e; }
    assert.ok(err && re.test(err.message), `expected /${re.source}/, got: ${err && err.message}`);
  }
};

module.exports.declaredTargetUsesTheDeclaredCellNotTheSearchWinner = function () {
  const d = labDoc();
  d.selection.tHours = 999;                 // search winner drifted
  d.selection.declaredCell.tHours = 137;    // the hypothesis under test
  // (999 would fail vocabulary bounds; the declared overlay must win)
  const rec = gl.greenlightFromRun(d, 'declared', { name: 'test config', why: 'declared cell is the tested hypothesis' ,});
  assert.strictEqual(rec.configSnapshot.cell.tHours, 137);
};

module.exports.shuttleMintsADraftSetupWithProvenanceAndReverseLink = function () {
  const rec = gl.greenlightFromRun(labDoc(), 'best', { name: 'test config', why: 'cleared' ,});
  const { greenlight, setup } = gl.shuttle(rec.id, { name: 'LTC live #1', clipUsd: 10 });
  assert.strictEqual(setup.state, 'draft', 'shuttle mints a DRAFT — arming is a later, separate act');
  assert.strictEqual(setup.provenanceRef, rec.id, 'setup points at its greenlight');
  assert.deepStrictEqual(setup.configSnapshot, rec.configSnapshot, 'snapshot travels byte-identically');
  assert.ok(greenlight.shuttledSetupIds.includes(setup.id), 'greenlight keeps the reverse link');
  const back = reg.getSetup(setup.id);
  assert.deepStrictEqual(back.configSnapshot, rec.configSnapshot, 'snapshot survives the registry round-trip');
};

module.exports.laterLabEditsCannotReachAShuttledSetup = function () {
  const doc = labDoc();
  const rec = gl.greenlightFromRun(doc, 'best', { name: 'test config', why: 'cleared' ,});
  const { setup } = gl.shuttle(rec.id, { name: 'immutability probe', clipUsd: 10 });
  // mutate the doc afterwards — the setup's snapshot must be unaffected
  doc.selection.tHours = 1;
  doc.selection.bandPct = 9.99;
  const back = reg.getSetup(setup.id);
  assert.strictEqual(back.configSnapshot.cell.tHours, 137);
  assert.strictEqual(back.configSnapshot.branch.band, 1.69);
};

module.exports.shuttleIsTheOnlyDoorAndRespectsSetupValidation = function () {
  const rec = gl.greenlightFromRun(labDoc(), 'best', { name: 'test config', why: 'cleared' ,});
  let err = null;
  try { gl.shuttle(rec.id, { name: 'bad clip', clipUsd: -5 }); } catch (e) { err = e; }
  assert.ok(err && err.code === 'BAD_SETUP', 'shuttle enforces the same operational bounds');
  err = null;
  try { gl.shuttle('gl-nope-000', { name: 'x', clipUsd: 10 }); } catch (e) { err = e; }
  assert.ok(err && err.code === 'NOT_FOUND');
};

module.exports.listReturnsNewestFirst = function () {
  const a = gl.greenlightFromRun(labDoc(), 'best', { name: 'test config', why: 'first' ,});
  const b = gl.greenlightFromRun(labDoc(), 'best', { name: 'test config', why: 'second' ,});
  const list = gl.listGreenlights();
  assert.ok(list.length >= 2);
  const ia = list.findIndex((x) => x.id === a.id);
  const ib = list.findIndex((x) => x.id === b.id);
  assert.ok(ib <= ia, 'newest first');
};

// DETERMINISTIC guard for the same-millisecond ordering defect (was: list sorted
// only on millisecond createdUtc; two mints in one ms tied and fell through to
// filesystem readdir order — undefined "newest first"). We seed two records with
// EQUAL createdUtc whose filenames sort OLDER-first, but whose creation order
// (seq) is NEWER = gl-zzz-newer. Without the seq tiebreak the tie leaves them in
// readdir (filename) order = oldest first -> this FAILS. With it -> newest first.
// Reintroducing the bug (dropping the seq compare) was watched turning this red.
module.exports.sameMillisecondMintsSortByCreationOrderNotFilename = function () {
  const dir = process.env.GC_GREENLIGHTS_DIR;
  const T = '2030-01-01T00:00:00.000Z';            // equal ms for both -> forces the tie
  // filename order (readdir is lexical here): 'gl-aaa-older' < 'gl-zzz-newer'
  fs.writeFileSync(path.join(dir, 'gl-aaa-older.json'),
    JSON.stringify({ id: 'gl-aaa-older', createdUtc: T, seq: 10, why: 'older' }));
  fs.writeFileSync(path.join(dir, 'gl-zzz-newer.json'),
    JSON.stringify({ id: 'gl-zzz-newer', createdUtc: T, seq: 11, why: 'newer' }));
  const list = gl.listGreenlights();
  const iOld = list.findIndex((x) => x.id === 'gl-aaa-older');
  const iNew = list.findIndex((x) => x.id === 'gl-zzz-newer');
  assert.ok(iNew >= 0 && iOld >= 0, 'both seeded records listed');
  assert.ok(iNew < iOld,
    `newer (seq 11) must precede older (seq 10) despite filename order; got new@${iNew} old@${iOld}`);
};

// THE REGION ANCHOR MUST ACTUALLY MINT. The Greenlight anchor has offered
// "widest region" since 2026-08-17 and this module refused it — so the one
// option whose whole purpose is to resist shopping was the one option that could
// not produce a config, while the two that DID work are the two its own tooltip
// warns flatter themselves. batch.js bracketConfirm had implemented the same
// anchor on the same field all along; only the greenlight door was missing it
// (audit 2026-08-17).
//
// Watched failing 2026-08-17: with the region branch removed, this throws
// "greenlight target must be 'best' or 'declared'".
module.exports.regionTargetUsesTheRegionCentreNotTheSearchWinner = function () {
  const d = labDoc();
  d.selection.tHours = 137;                 // the search winner
  d.selection.region = {
    size: 18,
    // the middle of the widest run of neighbouring settings that all made money
    centre: { quorum: 2, entry: 'market', gate: 'directional', dMult: null, tHours: 89, trailMult: null, armMult: null },
    cellsConsidered: 60, cellsClearing: 41, bar: 'pnl > 0 after fees',
  };
  const rec = gl.greenlightFromRun(d, 'region', { name: 'test config', why: 'the widest region resists shopping' ,});
  assert.strictEqual(rec.configSnapshot.cell.tHours, 89, 'the region CENTRE must win, not the search peak');
  assert.strictEqual(rec.configSnapshot.cell.quorum, 2);
  assert.strictEqual(rec.target, 'region', 'the anchor is recorded on the greenlight');
  assert.ok(rec.configSnapshot.configVersion.includes('/region@'));
};

// A row with no region must say so plainly rather than quietly fall back to the
// search winner — a silent fallback would mint the shopped cell under the
// anti-shopping label, which is worse than refusing.
module.exports.aRowWithNoRegionRefusesRatherThanFallingBackToTheWinner = function () {
  let err = null;
  try { gl.greenlightFromRun(labDoc(), 'region', { name: 'test config', why: 'x' ,}); } catch (e) { err = e; }
  assert.ok(err && /widest region/.test(err.message),
    `expected a refusal naming the missing region, got: ${err && err.message}`);
};
