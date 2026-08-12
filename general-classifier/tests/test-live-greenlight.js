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
      weekdaysOnly: false, members: 4,
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
  const rec = gl.greenlightFromRun(labDoc(), 'best', { why: 'money screen + null + holdout all cleared' });
  const cfg = rec.configSnapshot;
  assert.strictEqual(cfg.combo.trade, 'LTCUSDT');
  assert.strictEqual(cfg.branch.band, 1.69, 'band frozen as the resolved NUMBER');
  assert.strictEqual(cfg.stage, 'slim', 'stage derived from committee width (4 @ size 3)');
  assert.strictEqual(cfg.members.length, 4);
  assert.strictEqual(cfg.cell.tHours, 137);
  assert.strictEqual(cfg.trainThrough, Date.parse('2026-08-01T10:10:10.000Z'),
    'freeze = the selecting run\'s fire time (the last instant it could see)');
  assert.ok(cfg.configVersion.startsWith('bracketlab-20260801-101010-test/best@'));
  assert.strictEqual(rec.campaign, 'ltc-drill-aug', 'provenance carries the parent job');
  assert.deepStrictEqual(rec.sourceRun.dataManifest.symbols.LTCUSDT, 'd1', 'QC-77 manifest rides along');
  assert.ok(/^gc-/.test(rec.engineVersion), 'engine version recorded (point 18)');
};

module.exports.greenlightRefusalsAreLoudAndSpecific = function () {
  const cases = [
    [() => gl.greenlightFromRun(labDoc({ kind: 'screen' }), 'best', { why: 'x' }), /bracket-lab/],
    [() => gl.greenlightFromRun(labDoc(), 'best', {}), /WHY/],
    [() => gl.greenlightFromRun(labDoc({ selection: null }), 'best', { why: 'x' }), /select a leader|no selected row/],
    [() => { const d = labDoc(); delete d.selection.declaredCell; return gl.greenlightFromRun(d, 'declared', { why: 'x' }); }, /declared cell/],
    [() => { const d = labDoc(); d.selection.bandPct = undefined; return gl.greenlightFromRun(d, 'best', { why: 'x' }); }, /bandPct/],
    [() => { const d = labDoc(); d.selection.members = 5; return gl.greenlightFromRun(d, 'best', { why: 'x' }); }, /stage/],
    [() => { const d = labDoc(); delete d.startedAt; delete d.finishedAt; return gl.greenlightFromRun(d, 'best', { why: 'x' }); }, /startedAt|freeze/],
    [() => gl.greenlightFromRun(labDoc(), 'wildcard', { why: 'x' }), /best.*declared|declared.*best/],
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
  const rec = gl.greenlightFromRun(d, 'declared', { why: 'declared cell is the tested hypothesis' });
  assert.strictEqual(rec.configSnapshot.cell.tHours, 137);
};

module.exports.shuttleMintsADraftSetupWithProvenanceAndReverseLink = function () {
  const rec = gl.greenlightFromRun(labDoc(), 'best', { why: 'cleared' });
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
  const rec = gl.greenlightFromRun(doc, 'best', { why: 'cleared' });
  const { setup } = gl.shuttle(rec.id, { name: 'immutability probe', clipUsd: 10 });
  // mutate the doc afterwards — the setup's snapshot must be unaffected
  doc.selection.tHours = 1;
  doc.selection.bandPct = 9.99;
  const back = reg.getSetup(setup.id);
  assert.strictEqual(back.configSnapshot.cell.tHours, 137);
  assert.strictEqual(back.configSnapshot.branch.band, 1.69);
};

module.exports.shuttleIsTheOnlyDoorAndRespectsSetupValidation = function () {
  const rec = gl.greenlightFromRun(labDoc(), 'best', { why: 'cleared' });
  let err = null;
  try { gl.shuttle(rec.id, { name: 'bad clip', clipUsd: -5 }); } catch (e) { err = e; }
  assert.ok(err && err.code === 'BAD_SETUP', 'shuttle enforces the same operational bounds');
  err = null;
  try { gl.shuttle('gl-nope-000', { name: 'x', clipUsd: 10 }); } catch (e) { err = e; }
  assert.ok(err && err.code === 'NOT_FOUND');
};

module.exports.listReturnsNewestFirst = function () {
  const a = gl.greenlightFromRun(labDoc(), 'best', { why: 'first' });
  const b = gl.greenlightFromRun(labDoc(), 'best', { why: 'second' });
  const list = gl.listGreenlights();
  assert.ok(list.length >= 2);
  const ia = list.findIndex((x) => x.id === a.id);
  const ib = list.findIndex((x) => x.id === b.id);
  assert.ok(ib <= ia, 'newest first');
};
