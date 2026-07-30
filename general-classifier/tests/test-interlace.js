const { assert } = require('./helpers');
const { planIntervals, applyLayout, rotateWithinIntervals, GROUP_DAYS, EVAL_BLOCK_DAYS } = require('../lib/interlace');
const { splitByLayout, windowShift, quorumCall } = require('../lib/bracketwork');
const { compareDocs, settingsDiff } = require('../lib/compare');
const { nullVerdict } = require('../lib/verdict');
const { shiftStance } = require('../lib/batch');
const { T_HOURS } = require('../lib/bracket');
const { GEOMETRIES } = require('../lib/dataset');

const DAY_MS = 86_400_000;
const T0 = Date.UTC(2020, 0, 6); // a Monday

function synthChunks(spanDays, stepDays) {
  const out = [];
  for (let d = 0; d < spanDays; d += stepDays) {
    out.push({ startTs: T0 + d * DAY_MS, diffPct: Math.sin(d * 0.37) * 4, x: [d % 7, (d * 13) % 11], label: 0 });
  }
  return out;
}

module.exports = {
  async layoutIsReproducibleFromItsSeed() {
    const a = planIntervals(3 * GROUP_DAYS + 50, 'interlaced', 42);
    const b = planIntervals(3 * GROUP_DAYS + 50, 'interlaced', 42);
    assert.deepStrictEqual(a, b, 'same span+seed must give identical intervals');
    const c = planIntervals(3 * GROUP_DAYS + 50, 'interlaced', 43);
    assert.notDeepStrictEqual(a.intervals, c.intervals, 'a different seed should (here) slot differently');
  },

  async slottingObeysTheOwnersRule() {
    // (a) search or holdout first is a coin flip; (b) first eval block in
    // position 2 or 3; (c) second in 5, 6 or 7. Positions 1 and 4 always
    // train, so no two eval blocks can ever touch — within or across groups.
    const seen = { orders: new Set(), firsts: new Set(), seconds: new Set() };
    for (let seed = 0; seed < 30; seed++) {
      const plan = planIntervals(4 * GROUP_DAYS, 'interlaced', seed);
      for (const g of plan.groups) {
        assert.ok([2, 3].includes(g.firstPos), `first eval slot ${g.firstPos}`);
        assert.ok([5, 6, 7].includes(g.secondPos), `second eval slot ${g.secondPos}`);
        seen.orders.add(g.searchFirst);
        seen.firsts.add(g.firstPos);
        seen.seconds.add(g.secondPos);
      }
      // exactly one search + one hold interval per group
      const evals = plan.intervals.filter((iv) => iv.set !== 'train');
      assert.strictEqual(evals.filter((iv) => iv.set === 'search').length, plan.G);
      assert.strictEqual(evals.filter((iv) => iv.set === 'hold').length, plan.G);
      // no two eval intervals adjacent
      const sorted = evals.slice().sort((x, y) => x.startDay - y.startDay);
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(sorted[i].startDay > sorted[i - 1].endDay, 'eval blocks must never touch');
      }
    }
    assert.strictEqual(seen.orders.size, 2, 'both orderings must occur');
    assert.strictEqual(seen.firsts.size, 2, 'both first slots must occur');
    assert.strictEqual(seen.seconds.size, 3, 'all three second slots must occur');
  },

  async potentialTradeSlotsMatchAcrossModesForEveryShape() {
    // THE OWNER'S INVARIANT (2026-07-30): for any given time-period shape,
    // both layouts contain exactly the same number of potential trade days
    // in search and in holdout — by construction, not tuning.
    const spanDays = 2 * GROUP_DAYS + 58; // 2 groups + an awkward remainder
    for (const [name, geo] of Object.entries(GEOMETRIES)) {
      const stepDays = geo.stepHours / 24;
      const chunks = synthChunks(spanDays, stepDays);
      const chrono = applyLayout(chunks, geo, 'chronological', 7);
      const inter = applyLayout(chunks, geo, 'interlaced', 7);
      assert.strictEqual(chrono.search.length, inter.search.length, `${name}: search slots differ between layouts`);
      assert.strictEqual(chrono.hold.length, inter.hold.length, `${name}: holdout slots differ between layouts`);
      const expected = (2 * EVAL_BLOCK_DAYS) / stepDays;
      assert.strictEqual(inter.search.length, expected, `${name}: expected ${expected} search slots`);
      assert.strictEqual(inter.hold.length, expected, `${name}: expected ${expected} holdout slots`);
    }
  },

  async gappyDataStillYieldsIdenticalActualPeriods() {
    // What the first layout smoke caught on real data (2026-07-30): missing-
    // candle gaps do not fall evenly, so the interlaced arm's eval blocks —
    // landing in older, gappier eras — carried fewer ACTUAL chunks than the
    // chronological arm's gapless recent windows (501/498 vs 504). The
    // invariant is about actual periods, so both arms must trim to the
    // common per-set count, deterministically, with no cross-arm talk.
    const geo = GEOMETRIES['daily-3d'];
    const branch = { band: 'auto', decision: 'argmax' };
    const p = { interlaceSeed: 11, sharedBand: false };
    const gappy = synthChunks(2 * GROUP_DAYS + 40, 1)
      // knock holes in the OLD half only, where interlaced eval blocks live
      // and chronological ones never do
      .filter((c) => {
        const d = (c.startTs - T0) / DAY_MS;
        return !(d > 60 && d < 66) && !(d > 300 && d < 303);
      });
    const a = splitByLayout(gappy.map((c) => ({ ...c })), branch, geo, 'chronological', p);
    const b = splitByLayout(gappy.map((c) => ({ ...c })), branch, geo, 'interlaced', p);
    assert.strictEqual(a.testChunks.length, b.testChunks.length, 'actual search periods must match despite gaps');
    assert.strictEqual(a.holdChunks.length, b.holdChunks.length, 'actual holdout periods must match despite gaps');
    const trimmed = a.layoutMeta.evalTrimmed.search + a.layoutMeta.evalTrimmed.hold
      + b.layoutMeta.evalTrimmed.search + b.layoutMeta.evalTrimmed.hold;
    assert.ok(trimmed > 0, 'the gaps above must actually force a trim, or this test checks nothing');
  },

  async theTrainingSetPaysAllPurge() {
    const geo = GEOMETRIES['daily-3d'];
    const chunks = synthChunks(2 * GROUP_DAYS + 30, 1);
    for (const layout of ['chronological', 'interlaced']) {
      const { train, search, hold, meta } = applyLayout(chunks, geo, layout, 3);
      assert.ok(meta.purgedTrainChunks > 0, `${layout}: some train chunks must be purged at the seams`);
      // eval sets keep every chunk inside their intervals: counts are exact
      assert.strictEqual(search.length + hold.length, 2 * meta.groups * EVAL_BLOCK_DAYS, `${layout}: eval sets must keep their full complement`);
      // no surviving train chunk's candles can reach any eval chunk's candles
      const reach = Math.max(geo.featureHours, geo.exitOffsetH) * 3_600_000;
      for (const t of train) {
        for (const e of [...search, ...hold]) {
          assert.ok(Math.abs(t.startTs - e.startTs) >= reach,
            `${layout}: train chunk at ${t.startTs} shares candles with an eval chunk at ${e.startTs}`);
        }
      }
    }
  },

  async nullRotationStaysInsideItsBlocks() {
    const chunks = synthChunks(2 * GROUP_DAYS, 1);
    const before = chunks.map((c) => c.diffPct);
    rotateWithinIntervals(chunks, 'interlaced', 5, 0.4, windowShift);
    const plan = planIntervals(2 * GROUP_DAYS, 'interlaced', 5);
    let moved = 0;
    for (const iv of plan.intervals) {
      const idx = [];
      for (let i = 0; i < chunks.length; i++) {
        const d = (chunks[i].startTs - T0) / DAY_MS;
        if (d >= iv.startDay && d < iv.endDay) idx.push(i);
      }
      // the multiset of outcomes within each interval survives the rotation
      const now = idx.map((i) => chunks[i].diffPct).sort((a, b) => a - b);
      const was = idx.map((i) => before[i]).sort((a, b) => a - b);
      assert.deepStrictEqual(now, was, 'rotation crossed a block boundary');
      moved += idx.filter((i) => chunks[i].diffPct !== before[i]).length;
    }
    assert.ok(moved > chunks.length / 2, 'the rotation must actually move outcomes');
  },

  async sharedBandIsIdenticalAcrossTheArms() {
    const geo = GEOMETRIES['daily-3d'];
    const branch = { band: 'auto', decision: 'argmax' };
    const p = { interlaceSeed: 9, sharedBand: true };
    const a = splitByLayout(synthChunks(2 * GROUP_DAYS + 20, 1), branch, geo, 'chronological', p);
    const b = splitByLayout(synthChunks(2 * GROUP_DAYS + 20, 1), branch, geo, 'interlaced', p);
    assert.strictEqual(a.layoutMeta.bandFrom, 'common-train');
    assert.strictEqual(b.layoutMeta.bandFrom, 'common-train');
    assert.strictEqual(a.bandPct, b.bandPct, 'shared band must be bit-identical between arms');
  },

  async comparisonRefusesMismatchedSettings() {
    const params = (over) => ({
      universe: ['AUSDT'], holdout: true, feePerLeg: 0.125, windowLayout: 'chronological',
      interlaceSeed: 1, sharedBand: false, engineVersion: '1.26.0', ...over,
    });
    const row = (layout, pnl, over) => ({
      trade: 'AUSDT', geometry: 'daily-3d', decision: 'argmax', shiftFrac: null,
      holdPnl: pnl, holdTrades: 10, windowLayout: layout, layoutEvalDays: 126, ...over,
    });
    const A = { id: 'a', params: params({}), edgeCensus: [row('chronological', 50)] };
    const B = { id: 'b', params: params({ windowLayout: 'interlaced' }), edgeCensus: [row('interlaced', 30)] };
    // clean link works and pairs the setup
    const ok = compareDocs(A, B);
    assert.strictEqual(ok.pairedCount, 1);
    assert.strictEqual(ok.paired[0].dHoldPnl, -20);
    // any non-layout difference is refused, WITH the differing key named
    const C = { id: 'c', params: params({ windowLayout: 'interlaced', feePerLeg: 0.2 }), edgeCensus: [row('interlaced', 30)] };
    let threw = null;
    try { compareDocs(A, C); } catch (err) { threw = err.message; }
    assert.ok(threw && threw.includes('feePerLeg'), `must refuse and name the difference, got: ${threw}`);
    // same layout on both sides is refused
    const D = { id: 'd', params: params({}), edgeCensus: [row('chronological', 30)] };
    let threw2 = null;
    try { compareDocs(A, D); } catch (err) { threw2 = err.message; }
    assert.ok(threw2 && threw2.includes('one of each'), `got: ${threw2}`);
    // engine-version difference is allowed through but LOUD
    const E = { id: 'e', params: params({ windowLayout: 'interlaced', engineVersion: '1.27.0' }), edgeCensus: [row('interlaced', 30)] };
    const warned = compareDocs(A, E);
    assert.ok(warned.warnings.length === 1 && warned.warnings[0].includes('ENGINE VERSIONS DIFFER'));
    // a 'both' job compares its own arms with no second doc
    const F = {
      id: 'f', params: params({ windowLayout: 'both' }),
      edgeCensus: [row('chronological', 50), row('interlaced', 30)],
    };
    const both = compareDocs(F, null);
    assert.strictEqual(both.mode, 'both-job');
    assert.strictEqual(both.pairedCount, 1);
    assert.strictEqual(both.arms.a, 'chronological');
  },

  async trainingNeverSeesAnEvalTradePath() {
    // Audit 2026-07-30, confirmed major: purging only the label window let
    // eval trades at the menu's long timeouts run through candles that
    // surviving train chunks used as features — one-sided contamination of
    // the interlaced arm. The production path must purge out to the longest
    // execution horizon on the job's menu.
    const geo = GEOMETRIES['daily-3d'];
    const branch = { band: 'auto', decision: 'argmax' };
    const p = { interlaceSeed: 4 };
    const HOUR = 3_600_000;
    const tMax = Math.max(...T_HOURS);
    const { trainChunks, testChunks, holdChunks } = splitByLayout(synthChunks(2 * GROUP_DAYS + 25, 1), branch, geo, 'interlaced', p);
    for (const e of [...testChunks, ...holdChunks]) {
      const pathEnd = e.startTs + (geo.entryOffsetH + tMax + 3) * HOUR;
      for (const t of trainChunks) {
        const featEnd = t.startTs + geo.featureHours * HOUR;
        assert.ok(featEnd <= e.startTs || t.startTs >= pathEnd,
          `train features [${t.startTs},${featEnd}) overlap an eval trade path ending ${pathEnd}`);
      }
    }
  },

  async quorumCallRefusesNonVoteShapes() {
    // Audit 2026-07-30, CRITICAL: the null replay passed member OBJECTS
    // where call arrays belong; every vote read undefined and the committee
    // silently stood aside in every rotated world. Wrong shapes must crash.
    const memberObjects = [{ calls: [1, -1], model: {} }, { calls: [1, 0], model: {} }];
    let threw = false;
    try { quorumCall(memberObjects, 0, 1); } catch { threw = true; }
    assert.ok(threw, 'quorumCall must throw on member objects, not count them as abstentions');
    assert.strictEqual(quorumCall([[1, -1], [1, 0]], 0, 2), 1, 'real call arrays still work');
  },

  async rotationStanceRidesOnKeyPresence() {
    // Audit 2026-07-30, confirmed major: payload builders collapsed "no
    // stance" and "explicitly unrotated" into the same explicit null, so a
    // run-wide labelShiftFrac job never rotated and discovery promotion
    // reran scrambled slim rows unrotated. Presence of the key IS the
    // stance (QC 38 class).
    assert.deepStrictEqual(shiftStance({}), {}, 'no stance -> defer to the run-wide setting');
    assert.deepStrictEqual(shiftStance({ shiftFrac: null }), { labelShiftFrac: null }, 'explicit null -> never rotate');
    assert.deepStrictEqual(shiftStance({ shiftFrac: 0.25 }), { labelShiftFrac: 0.25 }, 'a draw keeps its own rotation');
  },

  async nullVerdictKeepsTheArmsApart() {
    const params = { windowLayout: 'both' };
    const row = (layout, shift, pnl) => ({
      trade: 'AUSDT', geometry: 'daily-3d', decision: 'argmax',
      shiftFrac: shift, holdPnl: pnl, windowLayout: layout,
    });
    const realDoc = { id: 'r', params, edgeCensus: [row('chronological', null, 10), row('interlaced', null, 99)] };
    const nullDoc = {
      id: 'n', params,
      edgeCensus: [row('chronological', 0.25, -5), row('interlaced', 0.25, -7),
        row('chronological', 0.5, -6), row('interlaced', 0.5, 120)],
    };
    // naming the arm pairs against that arm only
    const v = nullVerdict(realDoc, nullDoc, { trade: 'AUSDT', geometry: 'daily-3d', decision: 'argmax', windowLayout: 'chronological' });
    assert.strictEqual(v.perSetup.real, 10);
    assert.deepStrictEqual(v.perSetup.draws.map((d) => d.value), [-5, -6], 'chronological setup must rank against chronological draws only');
    // omitting the arm on a mixed doc is refused, not guessed
    let threw = null;
    try { nullVerdict(realDoc, nullDoc, { trade: 'AUSDT', geometry: 'daily-3d', decision: 'argmax' }); } catch (err) { threw = err.message; }
    assert.ok(threw && threw.includes('arm'), `must ask for the arm, got: ${threw}`);
  },

  async legacyRunsGetAPlainRefusalNotUndefined() {
    const params = { universe: ['AUSDT'], holdout: true };
    const row = { trade: 'AUSDT', geometry: 'daily-3d', decision: 'argmax', shiftFrac: null, holdPnl: 5 };
    const A = { id: 'a', params: { ...params }, edgeCensus: [row] };
    const B = { id: 'b', params: { ...params }, edgeCensus: [row] };
    let msg = null;
    try { compareDocs(A, B); } catch (err) { msg = err.message; }
    assert.ok(msg && !msg.includes('undefined'), `refusal must not print "undefined": ${msg}`);
    assert.ok(msg.includes('legacy') || msg.includes('quota-first'), `refusal names the real problem: ${msg}`);
  },

  async settingsDiffIgnoresOnlyTheAllowlist() {
    const diffs = settingsDiff(
      { feePerLeg: 0.1, windowLayout: 'chronological', label: 'x', minTrades: 10 },
      { feePerLeg: 0.1, windowLayout: 'interlaced', label: 'y', minTrades: 12 },
    );
    assert.deepStrictEqual(diffs, ['minTrades']);
  },
};
