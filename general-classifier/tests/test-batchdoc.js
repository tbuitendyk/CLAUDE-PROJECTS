// The batch-doc plumbing around walk-forward runs (QC 58). Walkforward docs
// have no runs array — unit progress lives in perf — and three separate
// pieces of plumbing assumed runs exists: the picker row builder threw (the
// doc vanished from the list), the startup zombie sweep crashed (and the
// crash aborted the sweep for every doc after it), and the param normalizer
// silently corrected malformed numbers instead of refusing.
const { assert } = require('./helpers');
const { listRow, markInterrupted, wfParams } = require('../lib/batch');

module.exports = {
  async thePickerListsWalkforwardDocs() {
    const row = listRow({
      id: 'walkforward-20260731-x', kind: 'walkforward', status: 'running',
      startedAt: '2026-07-31T00:00:00Z', perf: { unitsDone: 3, unitsTotal: 9 }, params: {},
    });
    assert.strictEqual(row.kind, 'walkforward');
    assert.strictEqual(row.runsDone, 3, 'unit progress stands in for run progress');
    assert.strictEqual(row.runsTotal, 9);
    // and a classic doc still counts its runs the old way
    const classic = listRow({
      id: 'bracketlab-y', status: 'done', startedAt: '2026-07-30T00:00:00Z',
      runs: [{ status: 'done' }, { status: 'pending' }], params: {},
    });
    assert.strictEqual(classic.runsDone, 1);
    assert.strictEqual(classic.runsTotal, 2);
  },
  async theZombieSweepSurvivesAWalkforwardDoc() {
    const doc = markInterrupted({
      id: 'walkforward-20260731-x', kind: 'walkforward', status: 'running',
      perf: { unitsDone: 1, unitsTotal: 9 },
    });
    assert.strictEqual(doc.status, 'interrupted');
    assert.ok(doc.finishedAt, 'an interrupted doc gets an honest end time');
    // classic docs still get their running runs flipped to error
    const classic = markInterrupted({ status: 'running', runs: [{ status: 'running' }, { status: 'done' }] });
    assert.strictEqual(classic.runs[0].status, 'error');
    assert.strictEqual(classic.runs[1].status, 'done');
  },
  async aMalformedNumberIsRejectedNotCorrected() {
    assert.throws(() => wfParams({ feePerLeg: 'abc' }), /feePerLeg/);
    assert.throws(() => wfParams({ feePerLeg: -1 }), /feePerLeg/);
    assert.throws(() => wfParams({ minTradesSlice: 'lots' }), /minTradesSlice/);
    assert.throws(() => wfParams({ minTradesSlice: 0 }), /minTradesSlice/);
    // blank means the documented default — a rejection there would just be
    // friction, not protection
    const { p } = wfParams({});
    assert.strictEqual(p.minTradesSlice, 5);
    assert.ok(p.feePerLeg > 0);
  },
  async theNullArmIsExplicitNeverAccidental() {
    // A null run silently landing on the real arm (or the reverse) would be
    // the worst version of QC 60: a five-hour job answering the wrong
    // question with plausible numbers. Blank = real, stated loudly; a seed
    // = null, carried through; garbage = refusal.
    const real = wfParams({});
    assert.strictEqual(real.p.arm, 'real');
    assert.strictEqual(real.p.nullShiftSeed, undefined);
    const nul = wfParams({ nullShiftSeed: 101 });
    assert.strictEqual(nul.p.arm, 'null');
    assert.strictEqual(nul.p.nullShiftSeed, 101);
    assert.throws(() => wfParams({ nullShiftSeed: 'lucky' }), /nullShiftSeed/);
    assert.throws(() => wfParams({ nullShiftSeed: 0 }), /nullShiftSeed/);
    assert.throws(() => wfParams({ nullShiftSeed: 2.5 }), /nullShiftSeed/);
  },
  async weeklyEightDayIsExcludedFromWalkforwardLoudly() {
    // week-long chunks can never fill an 8-week slice once the execution
    // purge trims its tail, so every weekly-8d fold would "skip". The
    // permuted list drops it; asking for it outright is refused with the
    // reason, not silently swapped for a different shape.
    const { geoms } = wfParams({});
    assert.ok(!geoms.includes('weekly-8d'), 'permuted geometry list must not carry weekly-8d');
    assert.ok(geoms.length >= 4, 'the daily shapes all remain');
    assert.throws(() => wfParams({ permute: { geometry: false }, set: { geometry: 'weekly-8d' } }), /weekly-8d/);
    assert.throws(() => wfParams({ permute: { geometry: false }, set: { geometry: 'weekly8d' } }), /unknown geometry/);
  },
};
