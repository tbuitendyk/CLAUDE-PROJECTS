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
    const model = await trainSoftmax(Z, y, 0.1);
    assert.ok(model.converged, 'did not converge');
    const acc = accuracy(model, Z, y);
    assert.ok(acc > 0.9, `train accuracy only ${acc}`);
  },
  async generalizesToFreshDraws() {
    const train = makeData(300, 10, 21);
    const test = makeData(80, 10, 99);
    const scaler = standardizeFit(train.X);
    const model = await trainSoftmax(standardizeApply(train.X, scaler), train.y, 0.3);
    const acc = accuracy(model, standardizeApply(test.X, scaler), test.y);
    assert.ok(acc > 0.8, `test accuracy only ${acc}`);
  },
  async probabilitiesSumToOne() {
    const { X, y } = makeData(60, 5, 3);
    const model = await trainSoftmax(X, y, 1);
    const p = predict(model, X[0]).probs;
    const sum = p['-1'] + p['0'] + p['1'];
    assert.ok(Math.abs(sum - 1) < 1e-9, `probs sum ${sum}`);
  },
  async ladderPicksAndRetrains() {
    const { X, y } = makeData(100, 8, 5);
    const scaler = standardizeFit(X);
    const Z = standardizeApply(X, scaler);
    const { model, ladder, chosenLambda, valMajorityAcc } = await tuneAndTrain(Z, y, { lambdas: [0.1, 1, 10] });
    assert.ok(ladder.length >= 3); // may auto-extend past the base rungs
    assert.ok(ladder.some((r) => r.lambda === chosenLambda));
    assert.ok(ladder.every((r) => r.valAcc >= 0 && r.valAcc <= 1));
    assert.ok(valMajorityAcc >= 0 && valMajorityAcc <= 1);
    assert.ok(accuracy(model, Z, y) > 0.7);
  },
  async ladderExtendsWhenTheEdgeWins() {
    // Pure-noise labels: shrinking to the prior is optimal, so big lambdas
    // keep winning and the ladder must extend beyond its top rung.
    const rng = (() => { let s = 9; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; })();
    const X = Array.from({ length: 60 }, () => Array.from({ length: 6 }, () => rng() * 2 - 1));
    const y = X.map(() => (rng() < 0.34 ? -1 : rng() < 0.5 ? 0 : 1));
    const { ladder, chosenLambda } = await tuneAndTrain(X, y, { lambdas: [0.1, 1, 10] });
    const maxBase = 10;
    assert.ok(ladder.length > 3, `ladder did not extend (len ${ladder.length})`);
    assert.ok(ladder.some((r) => r.lambda > maxBase), 'no rung beyond the base top');
    assert.ok(chosenLambda >= maxBase);
  },
  async heavyRegularizationTamesWeights() {
    const { X, y } = makeData(80, 6, 13);
    const light = await trainSoftmax(X, y, 0.01);
    const heavy = await trainSoftmax(X, y, 100);
    const norm = (W) => Math.sqrt(W.reduce((s, w) => s + w * w, 0));
    assert.ok(norm(heavy.W) < norm(light.W), 'lambda=100 should shrink weights');
  },
  async missingClassInTrainingIsSafe() {
    // All labels 0/+1: the model must still train and never crash on class -1.
    const { X } = makeData(60, 5, 17);
    const y = X.map((row) => (row[0] > 0 ? 1 : 0));
    const model = await trainSoftmax(X, y, 1);
    const acc = accuracy(model, X, y);
    assert.ok(acc > 0.9, `accuracy ${acc}`);
  },
  async classWeightsRescueRareMovers() {
    // Wide-band shape: 30 dormant chunks blanket [-1,1] on one feature, five
    // +1 movers overlap the right end, five -1 movers the left end. The
    // unweighted optimum leans on the 3:1 prior and calls the overlap 0;
    // balanced weights make the rare classes matter enough to claim it.
    const X = [];
    const y = [];
    for (let i = 0; i < 30; i++) {
      X.push([(i / 29) * 2 - 1]);
      y.push(0);
    }
    for (const v of [0.6, 0.7, 0.8, 0.9, 1.0]) {
      X.push([v]);
      y.push(1);
    }
    for (const v of [-0.6, -0.7, -0.8, -0.9, -1.0]) {
      X.push([v]);
      y.push(-1);
    }
    const balanced = { '-1': 40 / 15, 0: 40 / 90, 1: 40 / 15 };
    const weights = y.map((l) => balanced[l]);
    const plain = await trainSoftmax(X, y, 0.1);
    const weighted = await trainSoftmax(X, y, 0.1, { weights });
    assert.strictEqual(predict(plain, [0.75]).label, 0); // prior wins unweighted
    assert.strictEqual(predict(weighted, [0.75]).label, 1);
    assert.strictEqual(predict(weighted, [-0.75]).label, -1);
    assert.strictEqual(predict(weighted, [0]).label, 0); // middle stays dormant
    // weighted accuracy: all-ones weights reproduce the plain number exactly
    const ones = y.map(() => 1);
    assert.strictEqual(accuracy(plain, X, y, ones), accuracy(plain, X, y));
    // under balanced weights the weighted model scores better than the plain
    assert.ok(accuracy(weighted, X, y, weights) > accuracy(plain, X, y, weights));
  },
  async tuneAndTrainAcceptsClassWeights() {
    const { X, y } = makeData(80, 4, 23);
    const { model, chosenLambda } = await tuneAndTrain(X, y, {
      lambdas: [0.1, 1],
      classWeights: { '-1': 1.5, 0: 0.7, 1: 1.5 },
    });
    assert.ok([0.1, 1].includes(chosenLambda));
    assert.ok(accuracy(model, X, y) > 0.5); // still learns the real rule
  },
};
