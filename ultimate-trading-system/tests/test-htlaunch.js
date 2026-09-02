// Launch-crossing coverage for History Tuning (QC lesson: the suite was
// green while the launcher was dead — no test crossed the orchestration
// layer). These drive startHistoryTuning's validation with fake source docs
// on disk; the compute path is covered by the engine tests and the planted
// check, and the on-box smoke after deploy covers the full pipe.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const batch = require('../lib/batch');

const BATCH_DIR = path.join(__dirname, '..', 'data', 'batches');

function fakeBoard(id, params) {
  fs.mkdirSync(BATCH_DIR, { recursive: true });
  const doc = {
    id, kind: 'bracketlab', status: 'done', startedAt: new Date().toISOString(),
    params: { windowLayout: 'split70', allLoaded: false, startMonth: '2021-01', endMonth: '2025-12',
      dormantPct: 1, compareSymbol: 'BTCUSDT', dMults: [1], tHours: [41], gates: ['directional'],
      entries: ['breakout'], feePerLeg: 0.125, ...params },
    leaders: [], edgeCensus: [],
  };
  fs.writeFileSync(path.join(BATCH_DIR, `${id}.json`), JSON.stringify(doc));
  return doc;
}

const CELL = { quorum: 3, gate: 'directional', entry: 'breakout', dMult: 1, tHours: 41, bandPct: 1.1 };
const COMBO = { trade: 'DOTUSDT', ctx1: null, ctx2: null, size: 1 };
const BRANCH = { geometry: 'daily-3d', decision: 'argmax', band: 'auto', weekdaysOnly: false };

async function expectRefusal(params, re) {
  let err = null;
  try { await batch.startHistoryTuning(params); } catch (e) { err = e; }
  assert.ok(err, 'must refuse');
  assert.ok(re.test(err.message), `wrong refusal: ${err.message}`);
}

module.exports = {
  async legacyEightyBoardsRefuseActivation() {
    const src = fakeBoard('bracketlab-20990101-0000-t1', { windowLayout: 'legacy80' });
    await expectRefusal({ sourceBatchId: src.id, combo: COMBO, branch: BRANCH, declaredCell: CELL },
      /activation refused.*70\/15\/15/);
  },
  // a stored row can still name the always gate (removed 2026-09-02); it is
  // refused as a gate this engine no longer has, never priced as another
  async aRowNamingAGateTheEngineNoLongerHasRefusesActivation() {
    const src = fakeBoard('bracketlab-20990101-0001-t2', {});
    await expectRefusal({ sourceBatchId: src.id, combo: COMBO, branch: BRANCH, declaredCell: { ...CELL, gate: 'always' } },
      /gate this engine no longer has \(always\)/);
  },
  async weeklyChunkShapeRefusesStructurally() {
    const src = fakeBoard('bracketlab-20990101-0002-t3', {});
    await expectRefusal({ sourceBatchId: src.id, combo: COMBO, branch: { ...BRANCH, geometry: 'weekly-8d' }, declaredCell: CELL },
      /weekly-8d/);
  },
  async missingCellFieldsRefuseLoudly() {
    const src = fakeBoard('bracketlab-20990101-0003-t4', {});
    const cell = { ...CELL };
    delete cell.bandPct;
    await expectRefusal({ sourceBatchId: src.id, combo: COMBO, branch: BRANCH, declaredCell: cell },
      /declaredCell\.bandPct/);
  },
  async nullDrawsRefuseBadSeedsAndUnknownRuns() {
    await expectRefusal({ replayOf: 'historytuning-nope' }, /unknown History Tuning run/);
    const ht = {
      id: 'historytuning-20990101-0000-t5', kind: 'historytuning', status: 'done',
      params: { arm: 'real', splits: [{}], combo: COMBO, branch: BRANCH },
      htRows: [{ ageKey: 'none', retuneKey: 'never', split: 'early', trailFile: 'x.json' }],
    };
    fs.writeFileSync(path.join(BATCH_DIR, `${ht.id}.json`), JSON.stringify(ht));
    await expectRefusal({ replayOf: ht.id, nullShiftSeed: 'abc' }, /nullShiftSeed must be an integer/);
  },
  async aRunWithMissingTrailFilesCannotDrawNulls() {
    const ht = {
      id: 'historytuning-20990101-0001-t6', kind: 'historytuning', status: 'done',
      params: { arm: 'real', splits: [{}], combo: COMBO, branch: BRANCH },
      htRows: [{ ageKey: '6mo', retuneKey: 'r4m1', split: 'early', trailFile: null }],
    };
    fs.writeFileSync(path.join(BATCH_DIR, `${ht.id}.json`), JSON.stringify(ht));
    await expectRefusal({ replayOf: ht.id, nullShiftSeed: 7 }, /no trail, no null, no claim/);
  },
  async cleanup() {
    for (const f of fs.readdirSync(BATCH_DIR)) {
      if (/-t\d\.json$/.test(f) || f.includes('2099')) fs.unlinkSync(path.join(BATCH_DIR, f));
    }
    assert.ok(true);
  },
};
