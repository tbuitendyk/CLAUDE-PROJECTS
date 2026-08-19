// The widest-region finder. A board's top row is the best of ~1,260 tries, which
// looks good even on noise; a REGION of neighbouring settings that all work does
// not. These tests pin what "neighbouring" means, because that definition is the
// whole claim: loosen it and scattered luck reads as a plateau.
//
// Watched failing 2026-08-17: allowing diagonal steps makes
// scatteredWinnersAreNotARegion report 3 instead of 1; picking the region's
// highest scorer as its centre makes theCentreIsTheInteriorNotThePeak return the
// spike; dropping the minTrades guard makes neverTradedCellsDoNotPadARegion
// count the $0 rows.
const { assert } = require('./helpers');
const { widestRegion, adjacent, coordsOf, axisIndex } = require('../lib/plateau');

// a breakout cell on the real menus; pnl/trades supplied per test
const cell = (dMult, tHours, quorum, pnl, trades = 5, extra = {}) => ({
  entry: 'breakout', gate: 'directional', dMult, tHours, quorum,
  trailMult: null, armMult: null, pnl, trades, ...extra,
});

module.exports = {
  // A row of settings that all work, side by side on one axis, IS the thing.
  aContiguousRunOnOneAxisIsARegion() {
    const rows = [
      cell(0.25, 65, 2, 1.1), cell(0.5, 65, 2, 1.4), cell(0.75, 65, 2, 1.2),
      cell(1, 65, 2, -0.3), cell(1.5, 65, 2, -0.5),
    ];
    const r = widestRegion(rows);
    assert.strictEqual(r.size, 3, 'the three adjacent winners form one region');
    assert.strictEqual(r.cellsClearing, 3);
    assert.strictEqual(r.centre.dMult, 0.5, 'the middle of the run is the centre');
  },

  // THE point of the whole exercise: three isolated winners are not a plateau.
  scatteredWinnersAreNotARegion() {
    const rows = [
      cell(0.25, 17, 2, 3.1), cell(0.5, 17, 2, -1), cell(0.75, 17, 2, -1),
      cell(0.25, 65, 2, -1), cell(0.5, 65, 2, 2.9), cell(0.75, 65, 2, -1),
      cell(0.25, 137, 2, -1), cell(0.5, 137, 2, -1), cell(0.75, 137, 2, 3.4),
    ];
    const r = widestRegion(rows);
    assert.strictEqual(r.cellsClearing, 3, 'three cells clear the bar');
    assert.strictEqual(r.size, 1, 'but none of them touch, so the widest region is 1');
  },

  // A region may spread across more than one ordered axis at once.
  aRegionCanSpreadAcrossTwoAxes() {
    const rows = [
      cell(0.25, 41, 2, 1.1), cell(0.5, 41, 2, 1.2),
      cell(0.25, 65, 2, 1.3), cell(0.5, 65, 2, 1.4),
      cell(1.5, 161, 2, 5.0), // a lone spike, far away
    ];
    const r = widestRegion(rows);
    assert.strictEqual(r.size, 4, 'the 2x2 block is one region');
    assert.ok(r.centre.pnl < 5.0, 'the far-off spike is not the centre');
  },

  // The centre is the most interior cell, NOT the best-scoring one — otherwise
  // the shopped cell is quietly back in charge.
  theCentreIsTheInteriorNotThePeak() {
    const rows = [
      cell(0.25, 65, 2, 1.0), cell(0.5, 65, 2, 1.1), cell(0.75, 65, 2, 9.9),
      cell(1, 65, 2, 1.2), cell(1.5, 65, 2, 1.0),
    ];
    const r = widestRegion(rows);
    assert.strictEqual(r.size, 5, 'all five clear and are contiguous');
    assert.strictEqual(r.centre.dMult, 0.75, 'the middle of five is the third');
    // the middle happens to also be the peak here, so check the interior rule
    // directly on a case where they differ
    const rows2 = [
      cell(0.25, 65, 2, 9.9), cell(0.5, 65, 2, 1.0), cell(0.75, 65, 2, 1.0),
    ];
    const r2 = widestRegion(rows2);
    assert.strictEqual(r2.centre.dMult, 0.5, 'the interior cell wins, not the 9.9 spike at the edge');
  },

  // A cell that never traded is $0 by absence, not by skill, and must not pad a
  // region into looking wide.
  neverTradedCellsDoNotPadARegion() {
    const rows = [
      cell(0.25, 65, 2, 1.1, 5), cell(0.5, 65, 2, 0.9, 0), cell(0.75, 65, 2, 1.2, 5),
    ];
    const r = widestRegion(rows, { minTrades: 1 });
    assert.strictEqual(r.size, 1, 'the untraded middle breaks the run in two');
  },

  // Categories are not neighbours: a market cell does not sit "next to" a
  // breakout cell, so a region never spans them.
  regionsNeverSpanEntryOrGate() {
    const rows = [
      cell(0.25, 65, 2, 1.1), cell(0.5, 65, 2, 1.2),
      { entry: 'market', gate: 'directional', dMult: null, tHours: 65, quorum: 2,
        trailMult: null, armMult: null, pnl: 1.3, trades: 5 },
      { entry: 'breakout', gate: 'always', dMult: 0.25, tHours: 65, quorum: 2,
        trailMult: null, armMult: null, pnl: 1.4, trades: 5 },
    ];
    const r = widestRegion(rows);
    assert.strictEqual(r.cellsClearing, 4);
    assert.strictEqual(r.size, 2, 'only the two breakout/directional cells join up');
  },

  // Neighbouring means ONE step on ONE axis. Two steps is not adjacency, and a
  // diagonal is not either — both would let scattered luck read as a region.
  adjacencyIsOneStepOnOneAxis() {
    const rows = [cell(0.25, 41, 2, 1), cell(0.5, 41, 2, 1), cell(0.75, 41, 2, 1), cell(0.5, 65, 2, 1)];
    const idx = axisIndex(rows);
    const c = (r) => coordsOf(r, idx);
    assert.ok(adjacent(c(rows[0]), c(rows[1])), 'one step on d is adjacent');
    assert.ok(!adjacent(c(rows[0]), c(rows[2])), 'two steps on d is NOT adjacent');
    assert.ok(adjacent(c(rows[1]), c(rows[3])), 'one step on t is adjacent');
    assert.ok(!adjacent(c(rows[0]), c(rows[3])), 'a diagonal is NOT adjacent');
  },

  // Steps are measured on the menu THIS run computed, not the library's full
  // menu — a custom grid has its own spacing and must be judged on it.
  stepsAreMeasuredOnTheRunsOwnMenu() {
    // this run computed only d = 0.25 and 1.5; they are one step apart HERE
    const rows = [cell(0.25, 65, 2, 1.1), cell(1.5, 65, 2, 1.2)];
    const r = widestRegion(rows);
    assert.strictEqual(r.size, 2, 'adjacent on this run\'s own grid, however far apart in the library');
  },

  // An empty or all-losing board reports nothing rather than throwing.
  aBoardWithNoWinnersReportsNoRegion() {
    const r = widestRegion([cell(0.25, 65, 2, -1), cell(0.5, 65, 2, -2)]);
    assert.strictEqual(r.size, 0);
    assert.strictEqual(r.centre, null);
    assert.strictEqual(r.cellsConsidered, 2);
    const empty = widestRegion([]);
    assert.strictEqual(empty.size, 0);
    assert.strictEqual(empty.centre, null);
  },

  // The Greenlight anchor must accept the region and refuse it honestly when the
  // run predates it — a row with no region must not silently fall back to the
  // best cell, which is the very thing the region exists to avoid.
  // RENAMED 2026-08-17, and the rename is the point. This was called
  // "greenlightAcceptsTheRegionTargetAndRefusesItWhenAbsent" while it greps
  // lib/batch.js — the CONFIRM door. The GREENLIGHT door is a different function
  // in a different file, and it refused the region target the whole time this
  // test was green. Read together with theBoardOffersTheRegionAsASecondReading,
  // the pair said "the option exists and the backend takes it" about a control
  // that could not mint anything. A test named after a door it does not open is
  // worse than no test: it is a false all-clear. The greenlight door is now
  // covered FUNCTIONALLY (not by grep) in test-live-greenlight.js —
  // regionTargetUsesTheRegionCentreNotTheSearchWinner.
  confirmAcceptsTheRegionTargetAndRefusesItWhenAbsent() {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'batch.js'), 'utf8');
    assert.ok(/target === 'region'/.test(src), 'bracketConfirm must handle the region target');
    assert.ok(/row\.region \|\| !row\.region\.centre/.test(src),
      'a row without a region must throw, never fall through to the best cell');
    assert.ok(/confirm target must be 'best', 'declared' or 'region'/.test(src),
      'the refusal message must name all three targets');
    assert.ok(/\.\.\.row\.region\.centre/.test(src),
      'the region target must select the region CENTRE, not its best-scoring cell');
    // EVERY door the anchor can reach, not just the one this file happened to
    // read. The Greenlight select posts its value to the greenlight route, so
    // that module must take the same three anchors the confirm path does.
    const gsrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'live', 'greenlight.js'), 'utf8');
    assert.ok(/target === 'region'/.test(gsrc),
      'lib/live/greenlight.js must handle the region target — the Greenlight anchor posts to it');
    assert.ok(/greenlight target must be 'best', 'declared' or 'region'/.test(gsrc),
      'the greenlight refusal must name all three anchors the screen offers');
  },

  // The screen must offer the anchor and carry the width column, or the work is
  // deployed but not reachable (QC 139: deployed is not shipped).
  theBoardOffersTheRegionAsASecondReading() {
    const fs = require('fs');
    const path = require('path');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'constructing.js'), 'utf8');
    assert.ok(/<option value="region">widest region<\/option>/.test(ui),
      'the Greenlight anchor must offer "widest region"');
    assert.ok(/id="bSort"/.test(ui), 'the board must offer the second ranking');
    assert.ok(/l\.region\.size/.test(ui), 'the board must show each row\'s region width');
  },

  // The sweep must actually record it, or every row reads "—" forever.
  theSweepRecordsARegionOnEveryPromotedRow() {
    const fs = require('fs');
    const path = require('path');
    const work = fs.readFileSync(path.join(__dirname, '..', 'lib', 'bracketwork.js'), 'utf8');
    const batch = fs.readFileSync(path.join(__dirname, '..', 'lib', 'batch.js'), 'utf8');
    assert.ok(/widestRegion\(allCells/.test(work), 'the unit scorer must cut a region from its pooled cells');
    assert.ok(/allCells\.push\(\{ \.\.\.r, quorum: s\.quorum \}\)/.test(work),
      'cells must be pooled ACROSS quorum streams — quorum is one of the ordered axes');
    assert.ok(/region: res\.region \|\| null/.test(batch), 'the leader row must carry the region');
  },

  // The same board must always give the same region, or a result that moved
  // between identical runs would be untraceable.
  theResultIsStableAcrossRowOrder() {
    const rows = [
      cell(0.25, 41, 2, 1.1), cell(0.5, 41, 2, 1.2),
      cell(0.25, 65, 2, 1.3), cell(0.5, 65, 2, 1.4),
      cell(1, 137, 3, 1.5), cell(1.5, 137, 3, 1.6),
    ];
    const a = widestRegion(rows);
    const b = widestRegion([...rows].reverse());
    assert.strictEqual(a.size, b.size);
    assert.deepStrictEqual(a.centre, b.centre, 'row order must not change the answer');
  },
};
