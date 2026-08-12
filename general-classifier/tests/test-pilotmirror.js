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

module.exports.hashDiffBreaks = function () {
  // votes+side identical, price within tol, but the input hash differs — the hash
  // covers the decision machinery (config/engine), so an unexplained divergence
  // is a REAL break (re-review), not informational.
  const v = m.compareDecision(rec({ input_hash: 'old' }),
    recomp({ input_hash: 'new', decision_price: 100.2 }));
  assert.strictEqual(v.break, true, 'an unexplained hash divergence is a mirror break');
  assert.strictEqual(v.hash_diff, true);
  assert.ok(/input_hash/.test(v.reason));
};

module.exports.vanishedDataOnCompletedDecisionBreaks = function () {
  // a decision recorded with a complete window whose data later cannot be
  // recomputed = the data vanished under it = break, not benign pending.
  const v = m.compareDecision(rec({ window_complete: true }),
    { found: false, note: 'missing feature candle' });
  assert.strictEqual(v.break, true, 'vanished data under a completed decision breaks');
  assert.ok(/vanished/.test(v.reason));
};

module.exports.foundFalseWithoutCompleteFlagIsPending = function () {
  // a record with no window_complete flag (legacy) stays conservatively pending.
  const v = m.compareDecision(rec(), { found: false, note: 'not caught up' });
  assert.strictEqual(v.break, false);
  assert.strictEqual(v.pending, true);
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

module.exports.pendingEntryPriceDefersInsteadOfBreaking = function () {
  // 2026-08-12: the live producer records the decision at the entry OPEN ~1h before
  // that candle caches, so a mirror recompute in between reads decision_price=null
  // with price_pending=true. That must DEFER the price check, not break real-vs-null.
  const v = m.compareDecision(rec({ decision_price: 88.5 }),
    recomp({ decision_price: null, price_pending: true }));
  assert.strictEqual(v.break, false, 'a pending entry candle defers the price check, not a break');
  assert.strictEqual(v.ok, true);
};

module.exports.realVsNullWithoutPendingStillBreaks = function () {
  // guard: the deferral applies ONLY when price_pending is set; a real-vs-null price
  // with no pending flag is still a divergence and must break (finding-7 protection).
  const v = m.compareDecision(rec({ decision_price: 88.5 }),
    recomp({ decision_price: null }));
  assert.strictEqual(v.break, true, 'real-vs-null price without price_pending still breaks');
  assert.ok(/decision_price/.test(v.reason));
};

module.exports.pendingPriceStillCatchesSideDrift = function () {
  // pending defers ONLY the price check; a side/vote/hash divergence during the
  // pending window must still break.
  const v = m.compareDecision(rec({ side: 'LONG', decision_price: 88.5 }),
    recomp({ side: 'SHORT', decision_price: null, price_pending: true }));
  assert.strictEqual(v.break, true, 'a side flip still breaks even while the price is pending');
  assert.ok(/side LONG -> SHORT/.test(v.reason));
};
