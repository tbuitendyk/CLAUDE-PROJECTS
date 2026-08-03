// The History Tuning arithmetic — age discount, effective days, floor,
// calendar milestones (design ledger rulings A/C + system-wide floor).
const { assert } = require('./helpers');
const H = require('../lib/history');

const DAY = H.DAY_MS;

module.exports = {
  async theAgeWeightHalvesPerHalfLifeSmoothly() {
    const end = 1000 * DAY;
    assert.strictEqual(H.ageWeight(end, end, 365), 1, 'age zero counts fully');
    assert.ok(Math.abs(H.ageWeight(end - 365 * DAY, end, 365) - 0.5) < 1e-12, 'one half-life = half');
    assert.ok(Math.abs(H.ageWeight(end - 730 * DAY, end, 365) - 0.25) < 1e-12, 'two = quarter');
    const w1 = H.ageWeight(end - 100 * DAY, end, 365);
    const w2 = H.ageWeight(end - 101 * DAY, end, 365);
    assert.ok(w2 < w1 && w1 - w2 < 0.002, 'smooth per day, no cliffs');
  },
  async noDiscountMeansEveryExampleCountsFully() {
    const end = 500 * DAY;
    assert.strictEqual(H.ageWeight(end - 400 * DAY, end, null), 1);
    const chunks = [0, 1, 2, 3].map((d) => ({ endTs: end - d * DAY }));
    const { weights, effectiveDays } = H.ageWeights(chunks, end, null);
    assert.ok(weights.every((w) => w === 1));
    assert.strictEqual(effectiveDays, 4, 'effective days = calendar chunk days when undiscounted');
  },
  async theCapIsOnePointFourFourTimesTheHalfLife() {
    assert.ok(Math.abs(H.effectiveDaysCap(182.5) - 263.3) < 1, '6-month arm caps ~262-263 days');
    assert.strictEqual(H.effectiveDaysCap(null), Infinity);
    // The floor must sit under the 6-month cap or that arm could never run
    assert.ok(H.TRAINING_FLOOR_DAYS < H.effectiveDaysCap(182.5), 'floor below the 6-month ceiling');
  },
  async theFloorRefusesLoudlyWithItsNumber() {
    const r = H.floorRefusal(90, 'early split, H=6mo');
    assert.ok(/refused/.test(r) && /90 days/.test(r) && /180/.test(r) && /GUESSED/.test(r));
    assert.strictEqual(H.floorRefusal(200, 'x'), null, 'clear above the floor');
  },
  async milestonesAreCalendarAnchoredNotWalkAnchored() {
    const start = 0;
    const end = 60 * 30 * DAY; // ~60 months
    const ms = H.retrainMilestones(start, end, 365);
    // every 12 months from the START of history (ruling A)
    assert.strictEqual(ms[0], 365 * DAY);
    assert.strictEqual(ms[1], 730 * DAY);
    assert.ok(ms.length >= 4);
    assert.deepStrictEqual(H.retrainMilestones(start, end, null), [], 'no discount = never retrained');
  },
  async weightedTrainingReproducesUnweightedWhenAllOnes() {
    const { trainSoftmax, predict } = require('../lib/logreg');
    const X = [];
    const y = [];
    for (let i = 0; i < 30; i++) {
      const up = i % 2 === 0;
      X.push([up ? 1 : -1, i / 30]);
      y.push(up ? 1 : -1);
    }
    const a = await trainSoftmax(X, y, 1, {});
    const b = await trainSoftmax(X, y, 1, { weights: X.map(() => 1) });
    for (let i = 0; i < X.length; i++) {
      assert.strictEqual(predict(a, X[i]).label, predict(b, X[i]).label, 'all-ones weights change nothing');
    }
  },
  async tuneAndTrainAcceptsExampleWeightsAndOldCallsAreUntouched() {
    const { tuneAndTrain } = require('../lib/logreg');
    const X = [];
    const y = [];
    for (let i = 0; i < 24; i++) {
      const cls = i % 3 === 0 ? 1 : i % 3 === 1 ? -1 : 0;
      X.push([cls + Math.sin(i) * 0.01, cls * 0.5]);
      y.push(cls);
    }
    const plain = await tuneAndTrain(X, y, { lambdas: [1] });
    assert.ok(plain.model, 'legacy call shape still works');
    const recent = X.map((_, i) => Math.pow(0.5, (X.length - 1 - i) / 8));
    const weighted = await tuneAndTrain(X, y, { lambdas: [1], exampleWeights: recent });
    assert.ok(weighted.model, 'exampleWeights accepted');
  },
};
