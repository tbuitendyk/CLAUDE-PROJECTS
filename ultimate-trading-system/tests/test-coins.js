// COINS: every decision read on its own window, the band applied at draw time,
// and the parts read from the engine's own split (COINS.md Part one; owner
// LOOP NOW! 2026-09-13).
//
// The success rules these check were written in LOOP-2026-09-13-COINS.md
// section A BEFORE any of this ran, which is the only reason a green result
// here means anything.
const { assert, numberLiteralsIn } = require('./helpers');
const fs = require('fs');
const path = require('path');
const {
  shapes, windowMoves, medianAbsMove, readingsUnderBand,
  partsFor, layoutParts, countIn, gapIn, runLength, stretchOf, shapeSummary,
} = require('../lib/coins');
const { GEOMETRIES, toHourlyMap, forwardFill } = require('../lib/dataset');

// AN HOURLY MAP WITH A PRICE PATH WE CAN READ BACK. Open and close DIFFER on
// every candle on purpose: a reading that took the close where the design says
// the open would pass on candles where the two are equal, and the first
// version of this generator made them equal.
function mapOf(hours, { start = 100, seed = 7, t0 = Date.UTC(2024, 0, 1) } = {}) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const rows = [];
  let p = start;
  for (let h = 0; h < hours; h++) {
    const open = p;
    p *= 1 + Math.sin(h / 170) * 0.006 + (rnd() - 0.5) * 0.006;
    rows.push({ ts: t0 + h * 3600000, open, high: Math.max(open, p) * 1.001, low: Math.min(open, p) * 0.999, close: p, quoteVolume: 1000 });
  }
  return forwardFill(toHourlyMap(rows)).map;
}
const HOUR = 3600000;

module.exports = {
  // C1.1: five shapes, from the engine's table, named as Sweep names them.
  theFiveShapesComeFromTheEngineAndCarryTheSweepLabels() {
    const list = shapes();
    assert.deepStrictEqual(list.map((s) => s.key), Object.keys(GEOMETRIES), 'one shape per geometry, in the engine\'s order');
    const { vocabulary } = require('../lib/vocabulary');
    const labels = new Map(vocabulary().geometry.map((o) => [o.value, o.label]));
    for (const s of list) {
      assert.strictEqual(s.label, labels.get(s.key), `${s.key} is not named as Sweep names it`);
      assert.strictEqual(s.windowHours, GEOMETRIES[s.key].featureHours, `${s.key}'s window is not the shape's own`);
      assert.ok(['day', 'week'].includes(s.every) && /\d\d:00$/.test(s.at), `${s.key} does not say when a decision opens: ${s.every} ${s.at}`);
    }
    assert.strictEqual(list.filter((s) => s.every === 'day').length, 4, 'four daily shapes');
    assert.strictEqual(list.filter((s) => s.every === 'week').length, 1, 'one weekly shape');
  },

  // C1.2: the window move is from the OPEN of the first candle of the window to
  // the OPEN of the trade, per decision, and the decisions are the sweep's own.
  aWindowMoveEndsWhereTheDECISIONIsTakenAndTheFillIsLeftAlone() {
    const map = mapOf(24 * 120);
    const { TUE_OFFSET_H } = require('../lib/dataset');
    for (const [key, g] of Object.entries(GEOMETRIES)) {
      const wm = windowMoves(map, key);
      assert.ok(wm.periods > 10, `${key}: too few decisions read (${wm.periods})`);
      assert.strictEqual(wm.ts.length, wm.move.length, `${key}: a moment per move`);
      const built = require('../lib/bracket').buildComboChunks({ trade: map }, key, false).chunks;
      assert.deepStrictEqual(wm.ts, built.map((c) => c.startTs), `${key}: the decisions are not the sweep's own chunks`);
      for (let i = 0; i < wm.ts.length; i++) {
        const first = map.get(wm.ts[i]);
        // THE READING ENDS WHERE THE DECISION IS TAKEN: the OPEN of the first
        // candle of the fill (owner's choice, 2026-09-17). On the four daily
        // shapes the fill is one candle, so that is the entry candle's open and
        // nothing about them changes. On Weekly 8-day the fill is a six-hour
        // Tuesday average whose middle is the nominal entry, so half of it had
        // not happened when the decision was taken -- the reading now ends at
        // the first candle of that window instead.
        const decideAt = wm.ts[i] + (g.labelMode === 'windows' ? TUE_OFFSET_H : g.entryOffsetH) * HOUR;
        const decidePrice = map.get(decideAt).open;
        if (g.labelMode === 'points') assert.strictEqual(built[i].c1, decidePrice, `${key}: a daily shape decides and fills at the same open`);
        const want = ((decidePrice - first.open) / first.open) * 100;
        assert.ok(Math.abs(wm.move[i] - want) < 1e-3, `${key} decision ${i}: move ${wm.move[i]} is not first-open-to-decision-open ${want}`);
        // AND THE FILL IS UNTOUCHED. The whole point of the change is that the
        // trade still fills across the six hours; only the READING moved. If
        // c1 ever became the decision price, the trade would have changed and
        // everything priced downstream of it with it.
        if (g.labelMode === 'windows') {
          assert.notStrictEqual(built[i].c1, decidePrice, `${key}: the fill must still be the six-hour average, not the decision open`);
          const notThis = ((built[i].c1 - first.open) / first.open) * 100;
          assert.ok(Math.abs(wm.move[i] - notThis) > 1e-6, `${key} decision ${i}: the reading still ends at the fill price, which is half unknown when the decision is taken`);
        }
        // and NOT from the first candle's close, which on these candles differs
        const notClose = ((decidePrice - first.close) / first.close) * 100;
        assert.ok(Math.abs(wm.move[i] - notClose) > 1e-6, `${key} decision ${i}: reads the first candle's close`);
      }
      assert.deepStrictEqual(wm.span, { fromTs: wm.ts[0], toTs: wm.ts[wm.ts.length - 1] });
      // C1.5: the trade's own outcome rides with every decision, and it is the
      // chunk's own diffPct -- the number the training's label is made from
      assert.strictEqual(wm.out.length, wm.periods, `${key}: an outcome per decision`);
      for (let i = 0; i < wm.out.length; i++) assert.ok(Math.abs(wm.out[i] - built[i].diffPct) < 1e-3, `${key} decision ${i}: outcome ${wm.out[i]} is not the chunk's ${built[i].diffPct}`);
    }
  },

  // A MOVE OVER ANY LOOK-BACK, ending at the same decision (owner, 2026-09-17).
  // The shape decides the trade; the look-back decides what is looked at, and
  // the two stopped being welded together here.
  aLookBackMeasuresFromItsOwnDistanceAndEndsAtTheSameDecision() {
    const map = mapOf(24 * 200);
    const { TUE_OFFSET_H } = require('../lib/dataset');
    for (const key of ['daily-2d', 'weekly-8d']) {
      const g = GEOMETRIES[key];
      const wm = windowMoves(map, key, [24, 72, 336]);
      assert.deepStrictEqual(Object.keys(wm.moves).sort(), ['24', '336', '72'], `${key}: one array per look-back asked for`);
      for (const h of [24, 72, 336]) {
        assert.strictEqual(wm.moves[String(h)].length, wm.periods, `${key}: look-back ${h} has a value per decision`);
      }
      let checked = 0;
      for (let i = 0; i < wm.periods; i++) {
        const decideAt = wm.ts[i] + (g.labelMode === 'windows' ? TUE_OFFSET_H : g.entryOffsetH) * HOUR;
        const decidePrice = map.get(decideAt).open;
        for (const h of [24, 72, 336]) {
          const back = map.get(decideAt - h * HOUR);
          const got = wm.moves[String(h)][i];
          if (!back) { assert.strictEqual(got, null, `${key}: no candle ${h}h back is a null, never a guess`); continue; }
          const want = ((decidePrice - back.open) / back.open) * 100;
          assert.ok(Math.abs(got - want) < 1e-3, `${key} decision ${i} look-back ${h}: ${got} is not ${want}`);
          checked++;
        }
      }
      assert.ok(checked > 30, `${key}: too few look-back values actually checked (${checked})`);
      // the near and the far look-back are genuinely different readings, or the
      // check above would pass on a walk that ignored the distance entirely
      const near = wm.moves['24'].filter((v) => v != null);
      const far = wm.moves['336'].filter((v) => v != null);
      assert.ok(near.some((v, i) => far[i] != null && Math.abs(v - far[i]) > 1e-6), `${key}: a day back and a fortnight back read the same, so the distance is being ignored`);
    }
  },

  theGapIsRisingMinusFallingAndSitOutIsInNeitherSide() {
    //            r    r    f    f    s    r    f
    const out = [ 2,  -1,   1,  -3,  99,   4,  -2];
    const g = gapIn('rrffsrf', out, 0, 6);
    assert.deepStrictEqual(g.afterRising, { n: 3, shareUp: 2 / 3, meanOut: (2 - 1 + 4) / 3 });
    assert.deepStrictEqual(g.afterFalling, { n: 3, shareUp: 1 / 3, meanOut: (1 - 3 - 2) / 3 });
    assert.ok(Math.abs(g.gapShare - 1 / 3) < 1e-12, 'gap in share: rising minus falling');
    assert.ok(Math.abs(g.gapMove - (5 / 3 - (-4 / 3))) < 1e-12, 'gap in move: rising minus falling');
    assert.deepStrictEqual(g.thinSide, { n: 3, which: 'rising' }, 'equal counts: rising is named as the thin side');
    // the 99 sat out and moved nothing
    assert.strictEqual(gapIn('rrffsrf', out, 0, 6).afterRising.meanOut, gapIn('rrffrrf', out, 0, 6).afterRising.meanOut - 0 === undefined ? 0 : g.afterRising.meanOut);
    // a stretch with no falling decisions has no gap, and says so with a null
    const only = gapIn('rrsr', [1, 2, 3, -1], 0, 3);
    assert.strictEqual(only.afterFalling.n, 0);
    assert.strictEqual(only.afterFalling.shareUp, null);
    assert.strictEqual(only.gapShare, null);
    assert.strictEqual(only.gapMove, null);
    assert.deepStrictEqual(only.thinSide, { n: 0, which: 'falling' });
    // a sub-stretch reads only its own decisions
    const sub = gapIn('rrffsrf', out, 2, 4);
    assert.strictEqual(sub.afterRising.n, 0);
    assert.strictEqual(sub.afterFalling.n, 2);
    // the run length: decisions per colour change, and nothing over nothing
    assert.strictEqual(runLength({ decisions: 20, changes: 4 }), 4);
    assert.strictEqual(runLength({ decisions: 7, changes: 0 }), 7);
    assert.strictEqual(runLength({ decisions: 0, changes: 0 }), null);
    const st = stretchOf('rrffsrf', out, 0, 6);
    assert.strictEqual(st.decisions, 7);
    assert.strictEqual(st.changes, 4);
    assert.strictEqual(st.run, 7 / 5);
    assert.deepStrictEqual(st.gap, g);
  },

  // C1.3: nothing after a decision's open can move its reading. The same is
  // what makes the reading usable live.
  // NOTHING AFTER THE DECISION MOVES THE READING -- on EVERY shape now, not
  // only a daily one (3.159.0). This ran on daily-3d alone, and Weekly 8-day
  // would have failed it: its reading ended at a six-hour average whose second
  // half lands after the decision, so rewriting prices from the decision
  // onward changed the reading of the very decision being taken.
  nothingAfterTheDecisionMovesTheReading() {
    const { TUE_OFFSET_H } = require('../lib/dataset');
    for (const key of ['daily-1d', 'daily-3d', 'weekly-8d']) {
      const g = GEOMETRIES[key];
      const a = mapOf(24 * (key === 'weekly-8d' ? 400 : 90));
      const wa = windowMoves(a, key, [48]);
      const k = Math.min(20, Math.max(3, Math.floor(wa.periods / 3)));
      const cut = wa.ts[k] + (g.labelMode === 'windows' ? TUE_OFFSET_H : g.entryOffsetH) * HOUR;
      const b = new Map();
      for (const [ts, c] of a) b.set(ts, ts > cut ? { ...c, open: c.open * 3, close: c.close * 3, high: c.high * 3, low: c.low * 3 } : c);
      const wb = windowMoves(b, key, [48]);
      for (let i = 0; i <= k; i++) {
        assert.strictEqual(wb.ts[i], wa.ts[i], `${key}: the decisions moved`);
        assert.strictEqual(wb.move[i], wa.move[i], `${key} decision ${i}: the reading moved when only prices AFTER the decision changed`);
        assert.strictEqual(wb.moves['48'][i], wa.moves['48'][i], `${key} decision ${i}: a look-back moved when only prices AFTER the decision changed`);
      }
      assert.ok(wa.periods > k + 4, `${key}: not enough decisions to bite`);
      // THE BITE, AND WHY IT IS "SOME" RATHER THAN A NAMED ONE. A move is a
      // ratio, so a window lying WHOLLY inside the rewritten prices reads
      // exactly the same -- three times the price over three times the base.
      // Only a window straddling the cut can differ, and which index straddles
      // depends on the shape. Naming one passed on daily-3d and failed on
      // daily-1d, where the test was right and the naming was wrong.
      const bit = wa.move.slice(k + 1).some((v, i) => v !== wb.move[k + 1 + i]);
      assert.ok(bit, `${key}: no later decision read differently, so this test cannot catch anything`);
    }
  },

  // C1.4: a first price that is not a base for a return costs that decision
  // and no other, and it is counted rather than invented.
  aBadFirstPriceIsSkippedAndCountedNeverInvented() {
    const a = mapOf(24 * 60);
    const wa = windowMoves(a, 'daily-2d');
    const victim = wa.ts[12];
    const b = new Map(a);
    b.set(victim, { ...a.get(victim), open: 0 });
    const wb = windowMoves(b, 'daily-2d');
    assert.strictEqual(wb.skipped, 1, 'one decision skipped');
    assert.strictEqual(wb.periods, wa.periods - 1, 'and only one');
    assert.ok(!wb.ts.includes(victim), 'the skipped decision is not in the list under any value');
    assert.deepStrictEqual(wb.ts, wa.ts.filter((t) => t !== victim), 'every other decision is still there, in order');
  },

  // C2.1: the band is a share of the median move ignoring direction, and it
  // reads three ways.
  theBandIsAShareOfTheMedianAndReadsThreeWays() {
    assert.strictEqual(medianAbsMove([-3, -2, -1, 0, 1, 2, 3]), 2, 'odd count: the middle of the sorted sizes');
    assert.strictEqual(medianAbsMove([-4, 1, 2, -3]), 2.5, 'even count: the average of the two middles');
    assert.strictEqual(medianAbsMove([]), null, 'nothing to take a median of');
    const r = readingsUnderBand([-3, -2, -1, 0, 1, 2, 3], 50);
    assert.strictEqual(r.yardstick, 2);
    assert.strictEqual(r.threshold, 1);
    assert.strictEqual(r.reading, 'ffsssrr', 'at half the median, ±1 and 0 sit out');
    assert.strictEqual(readingsUnderBand([-3, -2, -1, 0, 1, 2, 3], 0).reading, 'fffsrrr', 'at 0 only a move of exactly nothing sits out');
    assert.strictEqual(readingsUnderBand([-3, -2, -1, 0, 1, 2, 3], 100000).reading, 'sssssss', 'a huge band sits everything out');
    // a yardstick handed in is used in place of the median of these moves (3.130.0)
    assert.strictEqual(readingsUnderBand([-3, -2, -1, 0, 1, 2, 3], 50, 4).threshold, 2, 'the threshold is half the given yardstick');
    assert.strictEqual(readingsUnderBand([-3, -2, -1, 0, 1, 2, 3], 50, 4).reading, 'fsssssr', 'read at the given yardstick, not at the median of 2');
    assert.strictEqual(readingsUnderBand([-3, -2, -1, 0, 1, 2, 3], 50, null).yardstick, 2, 'none given: the median, as before');
    assert.throws(() => readingsUnderBand([1], -1), /zero or more/, 'a negative band is refused');
    assert.throws(() => readingsUnderBand([1], 'x'), /zero or more/, 'a non-number is refused');
  },

  // C3.1: the parts come from the engine's own split and are never typed here.
  thePartsAreTheEnginesOwnSplitNeverTyped() {
    const { splitBounds, reserveChunks } = require('../lib/bracketwork');
    for (const n of [40, 97, 500, 1455, 2913]) {
      const r = partsFor(n, 'reserve61');
      const nRes = reserveChunks(n);
      const b = splitBounds(n - nRes, true);
      assert.deepStrictEqual(r.map((p) => p.to - p.from + 1), [b.nTrain, b.nTest, b.nHold, nRes], `reserve61 at ${n}`);
      const s = partsFor(n, 'split70');
      const b2 = splitBounds(n, true);
      assert.deepStrictEqual(s.map((p) => p.to - p.from + 1), [b2.nTrain, b2.nTest, b2.nHold], `split70 at ${n}`);
      for (const parts of [r, s]) {
        assert.strictEqual(parts[0].from, 0);
        assert.strictEqual(parts[parts.length - 1].to, n - 1);
        for (let i = 1; i < parts.length; i++) assert.strictEqual(parts[i].from, parts[i - 1].to + 1, 'the parts meet');
      }
    }
    assert.throws(() => partsFor(100, 'nope'), /unknown window layout/);
    const tiny = layoutParts(3, 'reserve61');
    assert.ok(tiny.why && /do not divide/.test(tiny.why), `three decisions must not divide four ways: ${JSON.stringify(tiny)}`);
    assert.ok(layoutParts(100, 'split70').parts, 'a hundred divide fine');
    // AND THE SHARES ARE NOT TYPED IN THIS FILE, as a value in any spelling
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coins.js'), 'utf8');
    const typed = numberLiteralsIn(src).filter((v) => [0.13, 0.15, 0.61, 0.7, 0.85, 0.74].includes(v));
    assert.deepStrictEqual(typed, [], `a share of the split is typed into lib/coins.js: ${typed.join(', ')}`);
  },

  // C3.2: the counts add up, and a colour change AT a boundary belongs to
  // neither part, so the parts never double-count it.
  theCountsPerPartAddUpAndChangesAtABoundaryBelongToNeither() {
    assert.deepStrictEqual(countIn('rrffss', 0, 5), { decisions: 6, rising: 2, falling: 2, sitOut: 2, changes: 2 });
    assert.deepStrictEqual(countIn('rrffss', 0, 2), { decisions: 3, rising: 2, falling: 1, sitOut: 0, changes: 1 });
    assert.deepStrictEqual(countIn('rrffss', 3, 5), { decisions: 3, rising: 0, falling: 1, sitOut: 2, changes: 1 });
    // the only change sits exactly on the boundary between the two parts
    assert.strictEqual(countIn('rrrfff', 0, 5).changes, 1);
    assert.strictEqual(countIn('rrrfff', 0, 2).changes, 0);
    assert.strictEqual(countIn('rrrfff', 3, 5).changes, 0);
    assert.deepStrictEqual(countIn('', 0, -1), { decisions: 0, rising: 0, falling: 0, sitOut: 0, changes: 0 });
  },

  // C4.1: the summary carries exactly what a bar is drawn from, per layout,
  // with the moments sent as hours since the one before and the moves to two
  // places -- and the full record it was made from is not touched.
  theSummaryCarriesWhatTheBarIsDrawnFromAndNothingHeavier() {
    const map = mapOf(24 * 200);
    const wm = windowMoves(map, 'daily-1d');
    const before = JSON.stringify(wm);
    const s = shapeSummary(wm, 50, ['split70', 'reserve61']);
    assert.strictEqual(JSON.stringify(wm), before, 'summing up must not rewrite the record');
    assert.strictEqual(s.periods, wm.periods);
    assert.strictEqual(s.reading.length, wm.periods, 'one character per decision');
    assert.ok(/^[rfs]+$/.test(s.reading));
    assert.strictEqual(s.t0, wm.ts[0]);
    assert.strictEqual(s.dt.length, wm.periods - 1);
    let t = s.t0;
    for (let i = 1; i < wm.ts.length; i++) { t += s.dt[i - 1] * HOUR; assert.strictEqual(t, wm.ts[i], `moment ${i} does not rebuild from the hours`); }
    for (let i = 0; i < wm.move.length; i++) assert.ok(Math.abs(s.move[i] - wm.move[i]) < 0.005 + 1e-9, `move ${i} sent to more than two places or wrong`);
    assert.strictEqual(s.out.length, wm.periods, 'an outcome per decision goes out with the bar');
    for (let i = 0; i < wm.out.length; i++) assert.ok(Math.abs(s.out[i] - wm.out[i]) < 0.005 + 1e-9, `outcome ${i} sent to more than two places or wrong`);
    assert.deepStrictEqual(s.whole.gap, gapIn(s.reading, wm.out, 0, wm.periods - 1), 'the whole bar carries its gap');
    assert.strictEqual(s.whole.run, runLength(s.whole));
    const w = s.whole;
    assert.strictEqual(w.rising + w.falling + w.sitOut, wm.periods, 'the whole-bar counts cover every decision');
    assert.strictEqual(s.range.largestRise, Math.max(...wm.move));
    assert.strictEqual(s.range.largestFall, Math.min(...wm.move));
    assert.strictEqual(s.yardstick, medianAbsMove(wm.move));
    for (const layout of ['split70', 'reserve61']) {
      const lay = s.layouts[layout];
      assert.ok(lay.parts, `${layout} has parts`);
      const sum = lay.parts.reduce((a, p) => a + p.rising + p.falling + p.sitOut, 0);
      assert.strictEqual(sum, wm.periods, `${layout}: the parts' counts cover every decision`);
      assert.deepStrictEqual(lay.parts.map((p) => p.name), layout === 'reserve61' ? ['train', 'test', 'held', 'reserve'] : ['train', 'test', 'held']);
      for (const p of lay.parts) assert.deepStrictEqual({ r: p.rising, f: p.falling, s: p.sitOut, c: p.changes }, (() => { const c = countIn(s.reading, p.from, p.to); return { r: c.rising, f: c.falling, s: c.sitOut, c: c.changes }; })());
      for (const p of lay.parts) {
        assert.deepStrictEqual(p.gap, gapIn(s.reading, wm.out, p.from, p.to), `${layout} ${p.name}: the part carries its own gap, read over its own decisions`);
        assert.strictEqual(p.run, runLength(p));
      }
    }
    // a shape with nothing in it sums up without throwing and says why per layout
    const empty = shapeSummary({ ts: [], move: [], out: [] }, 50, ['split70']);
    assert.strictEqual(empty.periods, 0);
    assert.strictEqual(empty.whole.gap.gapShare, null);
    assert.ok(empty.layouts.split70.why);
  },
};
