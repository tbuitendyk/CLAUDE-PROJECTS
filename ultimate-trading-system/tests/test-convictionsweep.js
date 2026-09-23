// Conviction sizing (quorum-agreement clip ladder): the pure math the bracket-lab
// tool rests on. Synthetic entries, no candles, no network.
const { assert } = require('./helpers');
const { evalConviction, MIN_BUCKET_N } = require('../lib/convictionsweep');

const HOUR_MS = 3600 * 1000;


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
  // THE RETURN ON THE AMOUNT TRADED (3.143.0, owner order): $0.30 on $20 flat is
  // 1.50%; $0.70 on $40 on the ladder is 1.75%; 0.25 points between them. Per
  // level it is one number, because the ladder scales money and amount alike.
  assert.deepStrictEqual({ flat: r.flatReturnPct, ladder: r.ladderReturnPct, pts: r.upliftReturnPts }, { flat: 1.5, ladder: 1.75, pts: 0.25 });
  assert.deepStrictEqual({ b1: b1.returnPct, b3: b3.returnPct, empty: r.buckets.find((b) => b.agree === 2).returnPct }, { b1: 1, b3: 2, empty: null });
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

// EACH TRADE AT ITS OWN SIZE, THE LADDER ON TOP (3.235.0, owner order
// 2026-09-23: "sizing multiplies through"). Flat is the survivor as it really
// trades -- every trade at the size its own setting gave it -- the ladder
// multiplies that, the amount traded is every trade's size at the clip, and a
// multiplier of 0 takes a row's money and amount away together. Every size 1
// is exactly the result with no sizes at all.
module.exports.eachTradeAtItsOwnSizeTheLadderOnTop = function () {
  const base = [
    { agree: 1, netPct: 0.01 }, { agree: 2, netPct: -0.02 }, { agree: 3, netPct: 0.03 }, { agree: 3, netPct: -0.01 },
  ];
  const opts = { clipUsd: 100, ladder: [1, 2, 3], holdHours: 10, shuffles: 50 };
  const plain = evalConviction(mk(base), opts);
  const ones = evalConviction(mk(base).map((e) => ({ ...e, size: 1 })), opts);
  assert.deepStrictEqual(ones, plain, 'every trade at size 1 is the result with no sizes');
  const sizes = [1.5, 0.75, 2, 1];
  const sized = evalConviction(mk(base).map((e, i) => ({ ...e, size: sizes[i] })), opts);
  const own = base.map((e, i) => e.netPct * 100 * sizes[i]);   // each trade's money at its own size
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-3, `${what}: ${a} vs ${b}`);
  near(sized.flatUsd, own.reduce((a, v) => a + v, 0), 'flat is every trade at its own size');
  near(sized.ladderUsd, own[0] * 1 + own[1] * 2 + own[2] * 3 + own[3] * 3, 'the ladder multiplies each trade\'s own money');
  near(sized.deployedFlatUsd, 100 * (1.5 + 0.75 + 2 + 1), 'the amount traded flat is every size at the clip');
  near(sized.deployedLadderUsd, 100 * (1.5 * 1 + 0.75 * 2 + 2 * 3 + 1 * 3), 'and on the ladder, each size times its multiplier');
  const b3 = sized.buckets.find((b) => b.agree === 3);
  assert.ok(Math.abs(b3.returnPct - ((own[2] + own[3]) / (100 * (2 + 1))) * 100) < 0.006, `a row's return is its money over its trades' own amount, to the two places it is printed at: ${b3.returnPct}`);
  near(sized.worstTradeUsd, Math.min(own[0] * 1, own[1] * 2, own[2] * 3, own[3] * 3), 'the worst trade at its size and its multiplier');
  assert.ok(sized.null.pNullReturn != null, 'the return on the amount traded is checked against its own shuffles');
  // YOUR NUMBERS, DOWN EACH ROW (owner 2026-09-23): 0 turns a row off -- its
  // money and its amount traded go together
  const off = evalConviction(mk(base).map((e, i) => ({ ...e, size: sizes[i] })), { ...opts, ladder: [0, 0, 1.5] });
  near(off.ladderUsd, 1.5 * (own[2] + own[3]), 'only the row at 1.5 makes money on the ladder');
  near(off.deployedLadderUsd, 100 * 1.5 * (2 + 1), 'and only it puts money to work');
  assert.strictEqual(off.buckets.find((b) => b.agree === 1).ladderUsd, 0, 'a row at 0 makes nothing');
  assert.deepStrictEqual(off.ladder, [0, 0, 1.5], 'the numbers priced are stamped on the result');
};
