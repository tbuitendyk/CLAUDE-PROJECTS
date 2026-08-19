// Conviction sizing (quorum-agreement clip ladder): the pure math the bracket-lab
// tool rests on. Synthetic entries, no candles, no network.
const { assert } = require('./helpers');
const { agreementEntries, evalConviction, MIN_BUCKET_N } = require('../lib/convictionsweep');

const HOUR_MS = 3600 * 1000;

module.exports.agreementCountsTheWinningSideOnly = function () {
  // 3 chunks, 4 members. Chunk 0: call +1 with members [1,1,-1,0] -> agreement 2
  // (the DOWN vote and the aside are not agreement). Chunk 1: call -1 with
  // [-1,-1,-1,-1] -> 4. Chunk 2: call 0 -> no entry at all.
  const chunks = [{ startTs: 0 }, { startTs: 1000 * 3600 }, { startTs: 2000 * 3600 }];
  const calls = [1, -1, 0];
  const memberCalls = [
    [1, -1, 0],
    [1, -1, 1],
    [-1, -1, 0],
    [0, -1, 0],
  ];
  const out = agreementEntries(chunks, calls, memberCalls, { entryOffsetH: 1 });
  assert.strictEqual(out.length, 2, 'a FLAT call produces no entry');
  assert.strictEqual(out[0].agree, 2, 'opposition and asides are not agreement');
  assert.strictEqual(out[0].side, 'LONG');
  assert.strictEqual(out[0].entryTs, HOUR_MS, 'entry offset applied');
  assert.strictEqual(out[1].agree, 4, 'unanimous agreement counts all members');
  assert.strictEqual(out[1].side, 'SHORT');
};

function mk(entries) { // [{agree, netPct, entryTs?}]
  return entries.map((e, i) => ({ entryTs: e.entryTs ?? i * 24 * HOUR_MS, side: 'LONG', agree: e.agree, netPct: e.netPct }));
}

module.exports.ladderDollarsScaleEachBucketByItsMultiplier = function () {
  // 1x clip $10. agree1 trade +1% -> $0.10 flat; agree3 trade +2% -> $0.20 flat,
  // $0.60 at 3x. Ladder [1,2,3,4].
  const r = evalConviction(mk([
    { agree: 1, netPct: 0.01 },
    { agree: 3, netPct: 0.02 },
  ]), { clipUsd: 10, ladder: [1, 2, 3, 4], holdHours: 10, shuffles: 0 });
  assert.strictEqual(r.flatUsd, 0.3);
  assert.strictEqual(r.ladderUsd, 0.7, '0.10*1 + 0.20*3');
  assert.strictEqual(r.upliftUsd, 0.4);
  const b1 = r.buckets.find((b) => b.agree === 1);
  const b3 = r.buckets.find((b) => b.agree === 3);
  assert.strictEqual(b1.ladderUsd, 0.1);
  assert.strictEqual(b3.ladderUsd, 0.6);
  assert.strictEqual(r.deployedFlatUsd, 20);
  assert.strictEqual(r.deployedLadderUsd, 40, '10*1 + 10*3');
};

module.exports.peakConcurrentNotionalRespectsOverlappingHolds = function () {
  // Two trades whose holds OVERLAP (entries 1h apart, 10h hold): peak = both
  // notionals at once. A third far later never overlaps.
  const r = evalConviction(mk([
    { agree: 4, netPct: 0.01, entryTs: 0 },
    { agree: 2, netPct: 0.01, entryTs: HOUR_MS },
    { agree: 1, netPct: 0.01, entryTs: 1000 * HOUR_MS },
  ]), { clipUsd: 10, ladder: [1, 2, 3, 4], holdHours: 10, shuffles: 0 });
  assert.strictEqual(r.peakConcurrentUsd, 60, '4x$10 + 2x$10 overlap');
  assert.strictEqual(r.peakConcurrentFlatUsd, 20, 'flat overlap is 2 clips');
};

module.exports.drawdownIsPeakToTroughOfTheLadderBook = function () {
  // +$0.4 (4x on +1%), then -$0.4 (4x on -1%), then -$0.1: peak 0.4, trough -0.1
  // -> drawdown 0.5. Entries spaced beyond the hold so order is unambiguous.
  const r = evalConviction(mk([
    { agree: 4, netPct: 0.01, entryTs: 0 },
    { agree: 4, netPct: -0.01, entryTs: 100 * HOUR_MS },
    { agree: 1, netPct: -0.01, entryTs: 200 * HOUR_MS },
  ]), { clipUsd: 10, ladder: [1, 2, 3, 4], holdHours: 10, shuffles: 0 });
  assert.strictEqual(r.maxDrawdownUsd, 0.5);
  assert.strictEqual(r.worstTradeUsd, -0.4);
};

module.exports.nullShufflePreservesBucketSizesAndIsSeededDeterministic = function () {
  // Agreement carries real signal here: every 4-agree trade wins, every 1-agree
  // loses. The uplift must beat nearly every shuffled assignment (pNull small),
  // and the same seed must reproduce the identical null distribution.
  const entries = [];
  for (let i = 0; i < 12; i++) entries.push({ agree: 4, netPct: 0.02, entryTs: i * 500 * HOUR_MS });
  for (let i = 0; i < 12; i++) entries.push({ agree: 1, netPct: -0.02, entryTs: (i + 20) * 500 * HOUR_MS });
  const opts = { clipUsd: 10, ladder: [1, 2, 3, 4], holdHours: 10, seed: 99, shuffles: 400 };
  const a = evalConviction(mk(entries), opts);
  const b = evalConviction(mk(entries), opts);
  assert.ok(a.upliftUsd > 0, 'signal-bearing agreement produces positive uplift');
  assert.ok(a.null.pNull <= 0.05, `chance rarely matches it (pNull=${a.null.pNull})`);
  assert.strictEqual(a.null.mean, b.null.mean, 'same seed -> identical null');
  assert.strictEqual(a.null.p95, b.null.p95);
  assert.ok(/YES/.test(a.verdict), a.verdict);
  // and when agreement is pure noise w.r.t. returns, the verdict must NOT be YES:
  // same returns, agreement assigned alternately (half the winners and half the
  // losers in each bucket) -> uplift ~0 by construction.
  const noise = entries.map((e, i) => ({ ...e, agree: (i % 2) ? 4 : 1 }));
  const c = evalConviction(mk(noise), opts);
  assert.ok(!/^YES/.test(c.verdict), `noise agreement must not read YES: ${c.verdict}`);
};

module.exports.thinMultipliedBucketsMakeTheVerdictInconclusive = function () {
  // A 4x bucket with fewer than MIN_BUCKET_N trades cannot carry a YES, however
  // good its $ looks — that is the bucket-starvation trap.
  const entries = [{ agree: 4, netPct: 0.05, entryTs: 0 }];
  for (let i = 0; i < 30; i++) entries.push({ agree: 1, netPct: 0.001, entryTs: (i + 5) * 500 * HOUR_MS });
  const r = evalConviction(mk(entries), { clipUsd: 10, ladder: [1, 2, 3, 4], holdHours: 10, seed: 7, shuffles: 200 });
  assert.ok(r.buckets.find((b) => b.agree === 4).thin, 'the 4x bucket is flagged thin');
  assert.ok(/INCONCLUSIVE/.test(r.verdict), r.verdict);
  assert.ok(MIN_BUCKET_N >= 2, 'sanity: a declared minimum exists');
};
