const { assert, makeRng } = require('./helpers');
const {
  standardizeFit,
  standardizeApply,
  trainSoftmax,
  predict,
  accuracy,
  tuneAndTrain,
} = require('../lib/logreg');

// Deterministic synthetic dataset with a real (learnable) rule:
// label = +1 / -1 / 0 by the gap between the first two features.
function makeData(n, f, seed) {
  const rng = makeRng(seed);
  const X = [];
  const y = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(f);
    for (let j = 0; j < f; j++) row[j] = rng() * 2 - 1;
    const gap = row[0] - row[1];
    X.push(row);
    y.push(gap > 0.25 ? 1 : gap < -0.25 ? -1 : 0);
  }
  return { X, y };
}

module.exports = {
  async standardizeCentersAndScales() {
    const { X } = makeData(200, 6, 7);
    const scaler = standardizeFit(X);
    const Z = standardizeApply(X, scaler);
    for (let j = 0; j < 6; j++) {
      let m = 0;
      for (const row of Z) m += row[j];
      m /= Z.length;
      let v = 0;
      for (const row of Z) v += (row[j] - m) ** 2;
      v /= Z.length;
      assert.ok(Math.abs(m) < 1e-9, `mean ${m}`);
      assert.ok(Math.abs(v - 1) < 1e-6, `var ${v}`);
    }
  },
  async learnsASeparableRule() {
    const { X, y } = makeData(150, 10, 11);
    const scaler = standardizeFit(X);
    const Z = standardizeApply(X, scaler);
    const model = trainSoftmax(Z, y, 0.1);
    assert.ok(model.converged, 'did not converge');
    const acc = accuracy(model, Z, y);
    assert.ok(acc > 0.9, `train accuracy only ${acc}`);
  },
  async generalizesToFreshDraws() {
    const train = makeData(300, 10, 21);
    const test = makeData(80, 10, 99);
    const scaler = standardizeFit(train.X);
    const model = trainSoftmax(standardizeApply(train.X, scaler), train.y, 0.3);
    const acc = accuracy(model, standardizeApply(test.X, scaler), test.y);
    assert.ok(acc > 0.8, `test accuracy only ${acc}`);
  },
  async probabilitiesSumToOne() {
    const { X, y } = makeData(60, 5, 3);
    const model = trainSoftmax(X, y, 1);
    const p = predict(model, X[0]).probs;
    const sum = p['-1'] + p['0'] + p['1'];
    assert.ok(Math.abs(sum - 1) < 1e-9, `probs sum ${sum}`);
  },
  async ladderPicksAndRetrains() {
    const { X, y } = makeData(100, 8, 5);
    const scaler = standardizeFit(X);
    const Z = standardizeApply(X, scaler);
    const { model, ladder, chosenLambda } = tuneAndTrain(Z, y, { lambdas: [0.1, 1, 10] });
    assert.strictEqual(ladder.length, 3);
    assert.ok(ladder.some((r) => r.lambda === chosenLambda));
    assert.ok(ladder.every((r) => r.valAcc >= 0 && r.valAcc <= 1));
    assert.ok(accuracy(model, Z, y) > 0.7);
  },
  async heavyRegularizationTamesWeights() {
    const { X, y } = makeData(80, 6, 13);
    const light = trainSoftmax(X, y, 0.01);
    const heavy = trainSoftmax(X, y, 100);
    const norm = (W) => Math.sqrt(W.reduce((s, w) => s + w * w, 0));
    assert.ok(norm(heavy.W) < norm(light.W), 'lambda=100 should shrink weights');
  },
  async missingClassInTrainingIsSafe() {
    // All labels 0/+1: the model must still train and never crash on class -1.
    const { X } = makeData(60, 5, 17);
    const y = X.map((row) => (row[0] > 0 ? 1 : 0));
    const model = trainSoftmax(X, y, 1);
    const acc = accuracy(model, X, y);
    assert.ok(acc > 0.9, `accuracy ${acc}`);
  },
};
