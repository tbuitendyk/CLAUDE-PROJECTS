// The batch-doc plumbing around walk-forward runs (QC 58). Walkforward docs
// have no runs array — unit progress lives in perf — and three separate
// pieces of plumbing assumed runs exists: the picker row builder threw (the
// doc vanished from the list), the startup zombie sweep crashed (and the
// crash aborted the sweep for every doc after it), and the param normalizer
// silently corrected malformed numbers instead of refusing.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listRow, markInterrupted, getBatch } = require('../lib/batch');

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

  // R11: getBatch must never let a traversal-shaped id path-join out of the
  // batches dir into an arbitrary .json read (the greenlight endpoint passed an
  // unvalidated runId straight in).
  getBatchRefusesPathTraversalIds() {
    const BATCH_DIR = path.join(__dirname, '..', 'data', 'batches');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-trav-'));
    const sentinel = path.join(dir, 'secret.json');
    fs.writeFileSync(sentinel, JSON.stringify({ kind: 'bracketlab', id: 'x', runs: [] }));
    // an id that, unguarded, path-joins BATCH_DIR/<rel>.json onto the sentinel
    const rel = path.relative(BATCH_DIR, sentinel).replace(/\.json$/, '');
    assert.ok(rel.includes('..'), 'the crafted id really does traverse upward');
    assert.strictEqual(getBatch(rel), null, 'a traversal id must not read a file outside the batches dir');
    // ordinary ids still resolve normally (a nonexistent one -> null, not a throw)
    assert.strictEqual(getBatch('definitely-not-a-real-run-xyz'), null);
    fs.rmSync(dir, { recursive: true, force: true });
  },
};
