// lib/pipeline.js — what is left of it after the single-pair screen was retired.
//
// These exist because deleting that screen's run path silently broke tuneTau:
// the constant it reads was cut with the dead code, nothing imported tuneTau in
// a test, and a fully green suite said everything was fine. A function the
// sweep's directional decision depends on had no coverage at all.
const { assert } = require('./helpers');
const { tuneTau, monthList, deriveShift, MIN_CHUNKS } = require('../lib/pipeline');

// The fee is passed explicitly in every call below. It used to default to the
// paper fee whatever the caller charged, which is the defect these calls now
// also guard: see theFeeMustBeGivenRatherThanAssumed at the bottom.

const HOUR = 3600000;
const geo = { entryOffsetH: 1, exitOffsetH: 2 };
// One chunk that moves up 10% between entry and exit.
const upMap = new Map([[1e6 + HOUR, { open: 100 }], [1e6 + 2 * HOUR, { open: 110 }]]);

module.exports = {
  // A threshold priced at a cost nobody chose is a threshold chosen for the
  // wrong reason. Forgetting the fee must be loud (found 2026-08-21).
  async theFeeMustBeGivenRatherThanAssumed() {
    const geo = { entryOffsetH: 1, exitOffsetH: 2 };
    let threw = false;
    try { tuneTau([{ startTs: 1e6 }], [{ '-1': 0.1, 0: 0.3, 1: 0.6 }], new Map(), geo); } catch (_) { threw = true; }
    assert.ok(threw, 'the threshold tuner still prices at a fee nobody passed it');
  },

  // And the fee must actually reach the arithmetic, not merely be accepted.
  async theFeeChangesWhatTheLadderIsWorth() {
    const geo = { entryOffsetH: 1, exitOffsetH: 2 };
    const map = new Map([[1e6 + 3600000, { open: 100 }], [1e6 + 7200000, { open: 101 }]]);
    const chunks = [{ startTs: 1e6 }];
    const probs = [{ '-1': 0.1, 0: 0.3, 1: 0.6 }];
    const free = tuneTau(chunks, probs, map, geo, 0);
    const costly = tuneTau(chunks, probs, map, geo, 0.125);
    const at = (r, tau) => r.tauLadder.find((x) => x.tau === tau).pnl;
    assert.ok(at(free, 0) > at(costly, 0),
      'the same ladder is worth the same at two different fees — the fee is not reaching the arithmetic');
  },

  // The whole point of a FIXED menu is that it cannot be widened quietly: a
  // continuous scan would let the tuner shop, which is the freedom the null
  // tests exist to price. If this ladder ever changes length, that is a
  // methodology change and it should not pass unnoticed.
  async theThresholdMenuIsFixedAndPreRegistered() {
    const r = tuneTau([{ startTs: 1e6 }], [{ '-1': 0.1, 0: 0.3, 1: 0.6 }], upMap, geo, 0);
    assert.strictEqual(r.tauLadder.length, 7, 'the tau menu is no longer seven rungs');
    assert.deepStrictEqual(r.tauLadder.map((x) => x.tau), [0, 0.34, 0.4, 0.45, 0.5, 0.55, 0.6]);
  },

  // Ties go to the HIGHER threshold — fewer, more confident trades. A call at
  // 0.6 confidence wins on every rung up to 0.6 and stands aside above it, so
  // every rung that trades earns the same money and the tie-break decides.
  async tiesGoToTheMoreConfidentThreshold() {
    const r = tuneTau([{ startTs: 1e6 }], [{ '-1': 0.1, 0: 0.3, 1: 0.6 }], upMap, geo, 0);
    assert.strictEqual(r.tau, 0.6);
    assert.strictEqual(r.tauLadder.find((x) => x.tau === 0.6).trades, 1);
  },

  // Below its threshold the call stands aside: no trade, no money, either way.
  async aCallUnderTheThresholdDoesNotTrade() {
    const r = tuneTau([{ startTs: 1e6 }], [{ '-1': 0.1, 0: 0.5, 1: 0.4 }], upMap, geo, 0);
    const top = r.tauLadder.find((x) => x.tau === 0.6);
    assert.strictEqual(top.trades, 0);
    assert.strictEqual(top.pnl, 0);
  },

  // A chunk whose entry or exit candle is missing is skipped, not guessed at.
  async aMissingCandleIsSkippedRatherThanInvented() {
    const r = tuneTau([{ startTs: 1e6 }], [{ '-1': 0.1, 0: 0.3, 1: 0.6 }], new Map(), geo, 0);
    assert.ok(r.tauLadder.every((x) => x.trades === 0 && x.pnl === 0));
  },

  async monthListSpansInclusivelyAndCrossesTheYear() {
    assert.deepStrictEqual(monthList('2026-11', '2027-02'), [
      { year: 2026, month: 11 }, { year: 2026, month: 12 },
      { year: 2027, month: 1 }, { year: 2027, month: 2 },
    ]);
    assert.deepStrictEqual(monthList('2026-03', '2026-03'), [{ year: 2026, month: 3 }]);
  },

  // A bad range must refuse rather than quietly return a short list — a silently
  // truncated span is a run measured on less history than it reports.
  async monthListRefusesNonsenseRatherThanShorteningTheSpan() {
    assert.throws(() => monthList('2026-13', '2026-14'), /bad month/);
    assert.throws(() => monthList('nonsense', '2026-01'), /bad month/);
    assert.throws(() => monthList('2027-01', '2026-01'), /before start/);
    assert.throws(() => monthList('2000-01', '2026-01'), /too large/);
  },

  async deriveShiftStaysInsideTheBufferedCycleAndRefusesTooLittleData() {
    assert.ok(deriveShift(310, 0.0001) >= 8);
    assert.ok(deriveShift(310, 0.9999) <= 302);
    assert.ok(deriveShift(310, 0.7) > deriveShift(310, 0.3));
    assert.throws(() => deriveShift(18, 0.5), /too few chunks/);
  },

  async theTrainingFloorIsStillAFloor() {
    assert.strictEqual(typeof MIN_CHUNKS, 'number');
    assert.ok(MIN_CHUNKS >= 12, 'the minimum chunk count dropped below twelve');
  },
};
