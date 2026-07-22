const { assert, makeRng } = require('./helpers');
const { trainBoost, predictBoost, accuracyBoost, importanceTable } = require('../lib/boost');
const { summarize } = require('../lib/batch');

// Interaction rule that a LINEAR model cannot represent: the label depends
// on the sign agreement of x0 and x1 (XOR-flavored). Depth-2 trees can.
function interactionData(n, f, seed) {
  const rng = makeRng(seed);
  const X = [];
  const y = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(f);
    for (let j = 0; j < f; j++) row[j] = rng() * 2 - 1;
    const a = row[0] > 0;
    const b = row[1] > 0;
    X.push(row);
    y.push(a && b ? 1 : !a && !b ? -1 : 0);
  }
  return { X, y };
}

module.exports = {
  async learnsAnInteractionRule() {
    const { X, y } = interactionData(400, 8, 3);
    const model = await trainBoost(X, y, { rounds: 150 });
    const acc = accuracyBoost(model, X, y);
    assert.ok(acc > 0.85, `train accuracy only ${acc} on an interaction rule`);
  },
  async generalizesOnFreshDraws() {
    const train = interactionData(500, 8, 7);
    const test = interactionData(150, 8, 91);
    const model = await trainBoost(train.X, train.y, { rounds: 150 });
    const acc = accuracyBoost(model, test.X, test.y);
    assert.ok(acc > 0.75, `test accuracy only ${acc}`);
  },
  async earlyStoppingPicksAReasonableRound() {
    const { X, y } = interactionData(400, 8, 11);
    const nVal = 100;
    const model = await trainBoost(X.slice(0, 300), y.slice(0, 300), {
      rounds: 300,
      Xval: X.slice(300),
      yval: y.slice(300),
      patience: 25,
    });
    assert.ok(model.bestRound >= 1 && model.bestRound <= 300);
    assert.ok(model.trees.length === model.bestRound);
    assert.ok(Number.isFinite(model.valCurveBest));
    assert.strictEqual(X.slice(300).length, nVal);
  },
  async probabilitiesSumToOne() {
    const { X, y } = interactionData(120, 5, 13);
    const model = await trainBoost(X, y, { rounds: 30 });
    const p = predictBoost(model, X[0]).probs;
    assert.ok(Math.abs(p['-1'] + p['0'] + p['1'] - 1) < 1e-9);
  },
  async importanceFindsTheRealFeatures() {
    const { X, y } = interactionData(400, 8, 17);
    const model = await trainBoost(X, y, { rounds: 80 });
    const names = Array.from({ length: 8 }, (_, j) => `f${j}`);
    const table = importanceTable(model, names, 3);
    const top2 = table.slice(0, 2).map((r) => r.name).sort();
    assert.deepStrictEqual(top2, ['f0', 'f1'], `importance top2 was ${top2}`);
  },
  async missingClassIsSafe() {
    const { X } = interactionData(100, 5, 19);
    const y = X.map((r) => (r[0] > 0 ? 1 : 0)); // no -1 anywhere
    const model = await trainBoost(X, y, { rounds: 40 });
    const acc = accuracyBoost(model, X, y);
    assert.ok(acc > 0.9, `accuracy ${acc}`);
  },
  async batchSummarizeRanksByEdge() {
    const mk = (trade, model, edge, status = 'done') => ({
      trade,
      compare: 'BTCUSDT',
      model,
      status,
      error: status === 'error' ? 'boom' : null,
      metrics: status === 'done' ? { edge, balancedEdge: edge / 2 } : null,
    });
    const s = summarize([mk('AAAUSDT', 'logreg', -0.05), mk('BBBUSDT', 'boost', 0.08), mk('CCCUSDT', 'logreg', 0.02), mk('DDDUSDT', 'boost', 0, 'error')]);
    assert.deepStrictEqual(s.ranked.map((r) => r.trade), ['BBBUSDT', 'CCCUSDT', 'AAAUSDT']);
    assert.strictEqual(s.positiveEdge, 2);
    assert.strictEqual(s.failed.length, 1);
    assert.strictEqual(s.total, 4);
  },
};
