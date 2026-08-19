// The History Tuning engine's pure parts: the dial grid, the split
// geometry (ruling D), and the declared reading rules.
const { assert } = require('./helpers');
const HT = require('../lib/historytuning');

const DAY = 24 * 3600 * 1000;

module.exports = {
  async theGridIsThirtyFiveWithTheReferencePassFirst() {
    const grid = HT.dialGrid();
    assert.strictEqual(grid.length, 35, '5 age x 7 retune');
    assert.ok(grid[0].reference, 'reference pass first');
    assert.strictEqual(grid[0].age.key, 'none');
    assert.strictEqual(grid[0].retune.key, 'never');
    assert.strictEqual(grid.filter((g) => g.reference).length, 1, 'exactly one reference pass');
  },
  async splitGeometryMatchesRulingD() {
    // ~50 months usable, the ruling's own example
    const start = 0;
    const end = 50 * 30.44 * DAY;
    const g = HT.splitGeometry(start, end);
    assert.strictEqual(g.refusal, null);
    const [a, b, c] = g.splits;
    // six equal disjoint windows; training expands
    assert.ok(a.testStartTs < a.testEndTs && a.testEndTs === a.holdStartTs);
    assert.strictEqual(b.testStartTs, a.holdEndTs, 'middle test starts where early hold ends');
    assert.strictEqual(c.testStartTs, b.holdEndTs, 'late test starts where middle hold ends');
    assert.strictEqual(c.holdEndTs, end, 'late hold ends at the usable end');
    assert.strictEqual(a.trainStartTs, start);
    assert.strictEqual(b.trainStartTs, start, 'training always starts at history start');
    // early training run-up must be >= the minimum
    assert.ok((a.testStartTs - start) / DAY >= HT.MIN_TRAIN_DAYS);
  },
  async tooShortASpanRefusesWithArithmetic() {
    const g = HT.splitGeometry(0, 500 * DAY);
    assert.ok(g.refusal && /refused/.test(g.refusal) && /GUESSED/.test(g.refusal));
  },
  async everyHoldWindowIsDisjointFromEveryTestWindow() {
    const g = HT.splitGeometry(0, 60 * 30.44 * DAY);
    const tests = g.splits.map((s) => [s.testStartTs, s.testEndTs]);
    const holds = g.splits.map((s) => [s.holdStartTs, s.holdEndTs]);
    for (const [hs, he] of holds) {
      for (const [ts, te] of tests) {
        assert.ok(he <= ts || hs >= te, 'no hold window overlaps any test window');
      }
    }
  },
  async theReadingRulesAreStampedWithHonestyLabels() {
    for (const key of ['picking', 'combining', 'hold', 'nullRule']) {
      const r = HT.READING_RULES[key];
      assert.ok(r && r.text.length > 40, `${key} rule exists`);
      assert.ok(/DERIVED|GUESSED/.test(r.label), `${key} labeled`);
    }
    assert.ok(/did not strengthen/.test(HT.READING_RULES.hold.text), 'the failure sentence is committed');
  },
  async retuneDatesAndMilestonesFitTheWalkArithmetic() {
    // 6-month half-life on a 50-month span: milestones from history START
    // (ruling A), so several land inside any walk; the 36-month arm's first
    // milestone (month 36) can land inside a LATE walk but not an early one
    // — the honest consequence of calendar anchoring, recorded not hidden.
    const start = 0;
    const end = 50 * 30.44 * DAY;
    const H = require('../lib/history');
    const g = HT.splitGeometry(start, end);
    const early = g.splits[0];
    const ms6 = H.retrainMilestones(start, early.holdEndTs, 182.5).filter((t) => t > early.testStartTs);
    assert.ok(ms6.length >= 1, '6-month arm retrains inside the early walk');
    const ms36 = H.retrainMilestones(start, early.holdEndTs, 1095).filter((t) => t > early.testStartTs);
    assert.ok(ms36.length <= 1, '36-month arm rarely or never retrains in an early walk — by design, on the record');
  },
};
