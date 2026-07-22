// Gradient-boosted small trees (depth 2, 4 leaves) with softmax loss — the
// nonlinear counterpart to lib/logreg.js. Depth-2 trees capture feature
// interactions ("high volatility AND rising correlation") that a linear
// model structurally cannot. Pure deterministic arithmetic, zero imports.
//
// Round count is a REAL quality knob for boosting (unlike the convex
// logistic loss), so it is tuned automatically: train on the chronological
// sub-train, watch log-loss on the validation tail every round, remember the
// best round, stop after `patience` rounds without improvement — then the
// caller retrains on the full training window for exactly that many rounds.

const { makeYielder } = require('./throttle');

const CLASSES = [-1, 0, 1];
const K = CLASSES.length;

function classIndex(label) {
  const k = CLASSES.indexOf(label);
  if (k < 0) throw new Error(`unknown class label ${label}`);
  return k;
}

function softmaxRow(z) {
  let max = -Infinity;
  for (const v of z) if (v > max) max = v;
  let sum = 0;
  const p = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    p[k] = Math.exp(z[k] - max);
    sum += p[k];
  }
  for (let k = 0; k < K; k++) p[k] /= sum;
  return p;
}

// Best squared-error split of `indices` on one feature. Returns null when no
// split beats the parent (or leaves would be too small).
function bestSplitOnFeature(X, res, indices, j, minLeaf) {
  const order = [...indices].sort((a, b) => X[a][j] - X[b][j]);
  const n = order.length;
  let total = 0;
  for (const i of order) total += res[i];
  let left = 0;
  let best = null;
  for (let s = 0; s < n - 1; s++) {
    left += res[order[s]];
    if (X[order[s]][j] === X[order[s + 1]][j]) continue; // can't cut inside ties
    const nl = s + 1;
    const nr = n - nl;
    if (nl < minLeaf || nr < minLeaf) continue;
    const right = total - left;
    const gain = (left * left) / nl + (right * right) / nr - (total * total) / n;
    if (!best || gain > best.gain) {
      best = { gain, threshold: (X[order[s]][j] + X[order[s + 1]][j]) / 2, nl };
    }
  }
  return best;
}

function bestSplit(X, res, indices, minLeaf) {
  const f = X[0].length;
  let best = null;
  for (let j = 0; j < f; j++) {
    const cand = bestSplitOnFeature(X, res, indices, j, minLeaf);
    if (cand && (!best || cand.gain > best.gain)) best = { ...cand, feature: j };
  }
  return best;
}

// Newton leaf value for softmax boosting, clipped for stability.
function leafValue(res, hess, indices, lr) {
  let r = 0;
  let h = 0;
  for (const i of indices) {
    r += res[i];
    h += hess[i];
  }
  const v = r / (h + 1e-9);
  return lr * Math.max(-4, Math.min(4, v));
}

// One depth-2 regression tree on residuals. Node layout mirrors predictTree.
function fitTree(X, res, hess, indices, { minLeaf, lr, importance }) {
  const root = bestSplit(X, res, indices, minLeaf);
  if (!root) return { leaf: leafValue(res, hess, indices, lr) };
  importance[root.feature] += root.gain;
  const left = [];
  const right = [];
  for (const i of indices) (X[i][root.feature] <= root.threshold ? left : right).push(i);

  const child = (idx) => {
    const s = bestSplit(X, res, idx, minLeaf);
    if (!s) return { leaf: leafValue(res, hess, idx, lr) };
    importance[s.feature] += s.gain;
    const l = [];
    const r = [];
    for (const i of idx) (X[i][s.feature] <= s.threshold ? l : r).push(i);
    return {
      feature: s.feature,
      threshold: s.threshold,
      left: { leaf: leafValue(res, hess, l, lr) },
      right: { leaf: leafValue(res, hess, r, lr) },
    };
  };
  return { feature: root.feature, threshold: root.threshold, left: child(left), right: child(right) };
}

function predictTree(tree, x) {
  let node = tree;
  while (node.leaf === undefined) node = x[node.feature] <= node.threshold ? node.left : node.right;
  return node.leaf;
}

function scoreRow(model, x) {
  const z = Float64Array.from(model.priors);
  for (const round of model.trees) for (let k = 0; k < K; k++) z[k] += predictTree(round[k], x);
  return z;
}

function logLoss(model, X, yIdx) {
  let loss = 0;
  for (let i = 0; i < X.length; i++) {
    const p = softmaxRow(scoreRow(model, X[i]));
    loss -= Math.log(Math.max(p[yIdx[i]], 1e-300));
  }
  return loss / X.length;
}

// Train for up to `rounds`; when Xval/yval are given, early-stop on val
// log-loss with `patience` and report bestRound. onRound(r) is a progress
// hook; the loop yields the event loop every round (trees are ms-scale but
// hundreds of rounds add up).
async function trainBoost(X, y, {
  rounds = 400,
  lr = 0.1,
  minLeaf = 8,
  patience = 40,
  Xval = null,
  yval = null,
  onRound = null,
} = {}) {
  const n = X.length;
  const f = X[0].length;
  const yIdx = y.map(classIndex);
  const yvalIdx = yval ? yval.map(classIndex) : null;

  // Laplace-smoothed log priors so an absent class never yields -Infinity.
  const counts = new Float64Array(K);
  for (const k of yIdx) counts[k]++;
  const priors = Array.from({ length: K }, (_, k) => Math.log((counts[k] + 1) / (n + K)));

  const model = { priors, trees: [], importance: new Float64Array(f), bestRound: 0, valCurveBest: null };
  const F = Array.from({ length: n }, () => Float64Array.from(priors));
  const pace = makeYielder();

  let bestValLoss = Infinity;
  let bestTreeCount = 0;
  let sinceBest = 0;

  for (let r = 0; r < rounds; r++) {
    if (onRound) onRound(r);
    await pace();

    const roundTrees = [];
    // Residuals/hessians from CURRENT scores for all classes first, so the
    // round is one clean Newton step (trees within a round don't see each
    // other's updates).
    const P = F.map((z) => softmaxRow(z));
    for (let k = 0; k < K; k++) {
      const res = new Float64Array(n);
      const hess = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        res[i] = (yIdx[i] === k ? 1 : 0) - P[i][k];
        hess[i] = Math.max(P[i][k] * (1 - P[i][k]), 1e-6);
      }
      const tree = fitTree(X, res, hess, [...Array(n).keys()], { minLeaf, lr, importance: model.importance });
      roundTrees.push(tree);
      for (let i = 0; i < n; i++) F[i][k] += predictTree(tree, X[i]);
    }
    model.trees.push(roundTrees);

    if (yvalIdx) {
      const vl = logLoss(model, Xval, yvalIdx);
      if (vl < bestValLoss - 1e-6) {
        bestValLoss = vl;
        bestTreeCount = model.trees.length;
        sinceBest = 0;
      } else if (++sinceBest >= patience) break;
    }
  }

  if (yvalIdx) {
    model.trees = model.trees.slice(0, bestTreeCount || 1);
    model.bestRound = model.trees.length;
    model.valCurveBest = bestValLoss;
  } else {
    model.bestRound = model.trees.length;
  }
  return model;
}

function predictBoost(model, x) {
  const p = softmaxRow(scoreRow(model, x));
  let best = 0;
  for (let k = 1; k < K; k++) if (p[k] > p[best]) best = k;
  return { label: CLASSES[best], probs: { '-1': p[0], 0: p[1], 1: p[2] } };
}

function accuracyBoost(model, X, y) {
  if (X.length === 0) return null;
  let hit = 0;
  for (let i = 0; i < X.length; i++) if (predictBoost(model, X[i]).label === y[i]) hit++;
  return hit / X.length;
}

// Gain-share importance with names, for the report.
function importanceTable(model, names, count = 12) {
  const total = model.importance.reduce((s, v) => s + v, 0) || 1;
  return names
    .map((name, j) => ({ name, share: model.importance[j] / total }))
    .filter((r) => r.share > 0)
    .sort((a, b) => b.share - a.share)
    .slice(0, count);
}

module.exports = { trainBoost, predictBoost, accuracyBoost, importanceTable, CLASSES };
