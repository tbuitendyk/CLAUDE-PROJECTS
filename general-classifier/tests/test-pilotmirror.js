// Mirror check (findings 26/7): the comparison that decides whether a live
// decision still reproduces against fresh data. Pure logic — no engine, no
// network — so the safety-critical break rule is pinned directly.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');
const m = require('../lib/pilotmirror');

const rec = (o = {}) => ({
  chunk_start: '2026-08-07T00:00:00.000Z', side: 'LONG', per_member: [1, 1, 0, 1],
  decision_price: 100.0, input_hash: 'abc123', ...o,
});
const recomp = (o = {}) => ({
  found: true, side: 'LONG', per_member: [1, 1, 0, 1],
  decision_price: 100.0, input_hash: 'abc123', ...o,
});

module.exports.identicalIsAMatch = function () {
  const v = m.compareDecision(rec(), recomp());
  assert.strictEqual(v.break, false, 'identical decision must not break');
  assert.strictEqual(v.ok, true);
};

module.exports.sideFlipBreaks = function () {
  const v = m.compareDecision(rec({ side: 'LONG' }), recomp({ side: 'SHORT' }));
  assert.strictEqual(v.break, true, 'a side flip is a mirror break');
  assert.ok(/side LONG -> SHORT/.test(v.reason), 'reason names the side change');
};

module.exports.voteChangeBreaks = function () {
  const v = m.compareDecision(rec({ per_member: [1, 1, 0, 1] }),
    recomp({ per_member: [1, 1, 1, 1] }));
  assert.strictEqual(v.break, true, 'a per-member vote change is a mirror break');
  assert.ok(/votes/.test(v.reason));
};

module.exports.priceWithinToleranceIsOk = function () {
  // 0.3% < 0.5% tol, votes+side identical -> the trade decision is unchanged
  const v = m.compareDecision(rec({ decision_price: 100.0 }), recomp({ decision_price: 100.3 }));
  assert.strictEqual(v.break, false, 'a sub-tolerance price revision is not a break');
};

module.exports.priceBeyondToleranceBreaks = function () {
  const v = m.compareDecision(rec({ decision_price: 100.0 }), recomp({ decision_price: 101.5 }));
  assert.strictEqual(v.break, true, 'a >0.5% entry-price revision is a break');
  assert.ok(/decision_price/.test(v.reason));
};

module.exports.notYetRecomputableIsPendingNotBreak = function () {
  const v = m.compareDecision(rec(), { found: false, note: 'data not caught up' });
  assert.strictEqual(v.break, false, 'a chunk that cannot be recomputed yet is not a break');
  assert.strictEqual(v.pending, true, 'it is pending');
};

module.exports.hashDiffAloneWithinPriceTolDoesNotBreak = function () {
  // votes+side identical, price within tol, but hash differs (e.g. config bump):
  // reported as informational, not a hard break on its own.
  const v = m.compareDecision(rec({ input_hash: 'old' }),
    recomp({ input_hash: 'new', decision_price: 100.2 }));
  assert.strictEqual(v.break, false, 'hash diff alone within price tolerance is not a break');
  assert.strictEqual(v.hash_diff, true, 'but the hash difference is flagged');
};

module.exports.writeThenLoadRoundTrips = function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-test-'));
  try {
    m.writeDecision(rec({ chunk_start: '2026-08-07T00:00:00.000Z' }), dir);
    m.writeDecision(rec({ chunk_start: '2026-08-08T00:00:00.000Z', side: 'SHORT' }), dir);
    // re-shipping the same chunk overwrites, never duplicates
    m.writeDecision(rec({ chunk_start: '2026-08-07T00:00:00.000Z', side: 'LONG' }), dir);
    const loaded = m.loadDecisions(dir);
    assert.strictEqual(loaded.length, 2, 'two distinct chunks, dedup on re-ship');
    assert.strictEqual(loaded[0].chunk_start, '2026-08-07T00:00:00.000Z', 'sorted by chunk_start');
    assert.strictEqual(loaded[1].side, 'SHORT');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

module.exports.loadMissingDirIsEmpty = function () {
  assert.deepStrictEqual(m.loadDecisions('/no/such/dir/xyz'), [], 'a missing dir yields no decisions');
};
