// Fix round, 2026-08-04 (3-agent adversarial review): the protections that
// can be tested without firing compute. Each test names the fault it pins.
const { assert } = require('./helpers');
const batch = require('../lib/batch');
const bracketLib = require('../lib/bracket');
const jobs = require('../lib/jobs');
const { nullVerdict } = require('../lib/verdict');

module.exports = {
  // A declared cell must be a cell the RUN will actually compute. The old
  // validator only knew the library menus, so a custom-grid run either
  // refused a value it was about to compute, or accepted one it never
  // would — hours of compute, then an empty replication table.
  async declaredCellsValidateAgainstTheRunsOwnGrid() {
    const customGrid = { dMults: [1.75], tHours: [65] };
    // 1.75 is deliberately NOT in the library menu…
    assert.ok(!bracketLib.D_MULTS.includes(1.75), 'test premise: 1.75 must not be a library dMult');
    // …so the library-only validator refuses it…
    assert.throws(() => batch.validateDeclared({ gate: 'active', dMult: 1.75, tHours: 65, quorum: 4 }), /dMult must be/);
    // …but a run whose grid carries it accepts it…
    const dec = batch.validateDeclared({ gate: 'active', dMult: 1.75, tHours: 65, quorum: 4 }, customGrid);
    assert.strictEqual(dec.dMult, 1.75);
    // …and a library value the run's grid does NOT carry refuses loudly.
    assert.throws(
      () => batch.validateDeclared({ gate: 'active', dMult: bracketLib.D_MULTS[0], tHours: 65, quorum: 4 }, customGrid),
      /this run's grid/,
    );
  },

  // QC 74: a re-fired tool archives the previous result, never destroys it.
  async archivePriorKeepsEveryPreviousResult() {
    const doc = {};
    batch.archivePrior(doc, 'nullTest', null); // nothing to archive on first fire
    assert.strictEqual(doc.priorResults, undefined);
    batch.archivePrior(doc, 'nullTest', { shifts: 9 });
    batch.archivePrior(doc, 'confirm', { cell: 'x' });
    assert.strictEqual(doc.priorResults.length, 2);
    assert.strictEqual(doc.priorResults[0].kind, 'nullTest');
    assert.strictEqual(doc.priorResults[0].value.shifts, 9);
    assert.ok(doc.priorResults[0].archivedAt);
  },

  // The failure list caps at 200 for doc weight, but the cap must COUNT what
  // it drops — a silent cap hides the breadth of a breakage.
  async theFailureCapCountsWhatItDrops() {
    const doc = { failures: [] };
    for (let i = 0; i < 205; i++) batch.recordFailure(doc, `k${i}`, 'boom');
    assert.strictEqual(doc.failures.length, 200);
    assert.strictEqual(doc.failuresDropped, 5);
  },

  // D3: eviction used to delete the oldest jobs regardless of status, which
  // blinded anyJobRunning() to a live job and orphaned its pollers.
  async evictionNeverDeletesARunningJob() {
    let release;
    const gate = new Promise((r) => { release = r; });
    const longId = jobs.startJob(() => gate);
    // flood past the KEEP=20 cap with instantly-finishing jobs
    const quick = [];
    for (let i = 0; i < 30; i++) quick.push(jobs.startJob(async () => i));
    await new Promise((r) => setTimeout(r, 50)); // let them settle + evict
    assert.strictEqual(jobs.anyJobRunning(), longId, 'the running job must survive eviction');
    assert.ok(jobs.getJob(longId), 'the running job must still be pollable');
    release('done');
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(jobs.anyJobRunning(), null);
  },

  // D2: the cache-write guard is now two-directional — a sweep refuses to
  // launch over a running data/analysis job's cache writes.
  async aSweepRefusesToLaunchOverARunningJob() {
    let release;
    const gate = new Promise((r) => { release = r; });
    const id = jobs.startJob(() => gate);
    try {
      assert.throws(
        () => batch.startBracketLab({ universe: ['AAAUSDT'], sizes: { singles: true }, windowLayout: 'split70' }),
        /data\/analysis job .* is running/,
      );
    } finally {
      release('done');
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.strictEqual(jobs.getJob(id).status, 'done');
  },

  // A declared trail cell in a run that computes no trail cells can never be
  // found — refuse at launch, not after hours of compute.
  async aDeclaredTrailCellNeedsTrailingTickedOn() {
    assert.throws(
      () => batch.startBracketLab({
        universe: ['AAAUSDT'], sizes: { singles: true }, windowLayout: 'split70',
        trailing: false,
        declared: {
          gate: bracketLib.GATES[0], dMult: bracketLib.D_MULTS[0], tHours: bracketLib.T_HOURS[0],
          quorum: 4, trailMult: bracketLib.TRAIL_MULTS[0],
        },
      }),
      /trailing stops ticked on/,
    );
  },

  // Tool 2 across two jobs with different measurement settings must NAME the
  // mismatch — two moneys under different fees are not the same quantity.
  async crossJobSettingsMismatchIsNamedInTheVerdict() {
    const row = (extra) => ({
      trade: 'AAAUSDT', geometry: 'daily-3d', decision: 'argmax', holdPnl: 5, ...extra,
    });
    const realDoc = { id: 'real-1', params: { feePerLeg: 0.1, windowLayout: 'split70' }, edgeCensus: [row({})] };
    const nullDoc = {
      id: 'null-1', params: { feePerLeg: 0.5, windowLayout: 'split70' },
      edgeCensus: [row({ nullDealSeed: 1, holdPnl: 1 })],
    };
    const out = nullVerdict(realDoc, nullDoc, null);
    assert.ok(out.paramMismatch, 'mismatch must be reported');
    assert.deepStrictEqual(out.paramMismatch.fields, ['feePerLeg']);
    // identical settings -> no warning
    const nullSame = { ...nullDoc, params: { ...realDoc.params } };
    assert.strictEqual(nullVerdict(realDoc, nullSame, null).paramMismatch, null);
  },
};
