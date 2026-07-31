const { assert } = require('./helpers');
const { foldGrid, reachMs, TEST_WEEKS, HOLD_WEEKS, STEP_WEEKS, WARMUP_WEEKS } = require('../lib/walkforward');
const { GEOMETRIES } = require('../lib/dataset');

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const T0 = Date.UTC(2020, 0, 6);

module.exports = {
  async foldGridTilesHistoryUniformly() {
    const spanDays = 900;
    const g = foldGrid(T0, T0 + (spanDays - 1) * DAY);
    assert.ok(g.length >= 5, `expected several folds over ${spanDays} days, got ${g.length}`);
    // first fold starts after the warm-up, never before
    assert.strictEqual(g[0].testStart, T0 + WARMUP_WEEKS * WEEK);
    for (const f of g) {
      assert.strictEqual(f.holdStart - f.testStart, TEST_WEEKS * WEEK, 'test slice is 8 weeks');
      assert.strictEqual(f.holdEnd - f.holdStart, HOLD_WEEKS * WEEK, 'hold slice is 8 weeks');
    }
    // step = hold width: hold slices tile history with no gap and no overlap
    for (let i = 1; i < g.length; i++) {
      assert.strictEqual(g[i].testStart - g[i - 1].testStart, STEP_WEEKS * WEEK);
      assert.strictEqual(g[i].holdStart, g[i - 1].holdEnd, 'hold slices must tile exactly');
    }
    // no fold's hold slice runs past the data
    const last = g[g.length - 1];
    assert.ok(last.holdEnd <= T0 + spanDays * DAY, 'grid must not overrun the history');
    // THE COUNT INVARIANT: identical spans yield identical grids wherever
    // they sit on the calendar
    const shifted = foldGrid(T0 + 500 * DAY, T0 + (500 + spanDays - 1) * DAY);
    assert.strictEqual(shifted.length, g.length);
    for (let i = 0; i < g.length; i++) {
      assert.strictEqual(shifted[i].testStart - shifted[0].testStart, g[i].testStart - g[0].testStart);
    }
  },
  async reachCoversTheExecutionHorizonForEveryShape() {
    // Same lesson as QC 52: the purge must cover features, label window AND
    // the longest trade the menu allows.
    for (const [name, geo] of Object.entries(GEOMETRIES)) {
      const r = reachMs(geo, [17, 161]);
      const expect = Math.max(geo.featureHours, geo.exitOffsetH, geo.entryOffsetH + 161 + 3) * 3_600_000;
      assert.strictEqual(r, expect, `${name}: reach must be the max of the three horizons`);
      assert.ok(r >= (geo.entryOffsetH + 161 + 3) * 3_600_000, `${name}: reach covers entry+timeout+gap-scan`);
    }
    // a custom shorter menu narrows the reach only down to the label window
    const d1 = GEOMETRIES['daily-1d'];
    assert.strictEqual(reachMs(d1, [17]), Math.max(d1.featureHours, d1.exitOffsetH, d1.entryOffsetH + 17 + 3) * 3_600_000);
  },
};
