// Multinomial (softmax) logistic regression, written directly against
// Float64Arrays. Pure deterministic arithmetic — nothing here touches the
// network, an API, or any AI service; require() list is empty on purpose.
//
// Design notes for this problem shape (~1,900 features, ~30–150 examples):
//   * Features are z-scored with statistics from the TRAINING set only.
//   * L2 regularization strength is chosen from a ladder by validation
//     accuracy on the chronological tail of the training set — the test set
//     is never touched until the final evaluation.
//   * The loss is convex, so iteration count is not a quality knob: training
//     runs until the loss stops improving (relative tolerance) under a
//     bold-driver step size, with a hard cap as a safety net.

const CLASSES = [-1, 0, 1];
const K = CLASSES.length;

function classIndex(label) {
  const k = CLASSES.indexOf(label);
  if (k < 0) throw new Error(`unknown class label ${label}`);
  return k;
}

// ---- standardization --------------------------------------------------------

function standardizeFit(X) {
  const n = X.length;
  const f = X[0].length;
  const mean = new Float64Array(f);
  const std = new Float64Array(f);
  for (const row of X) for (let j = 0; j < f; j++) mean[j] += row[j];
  for (let j = 0; j < f; j++) mean[j] /= n;
  for (const row of X) {
    for (let j = 0; j < f; j++) {
      const d = row[j] - mean[j];
      std[j] += d * d;
    }
  }
  for (let j = 0; j < f; j++) {
    std[j] = Math.sqrt(std[j] / n);
    if (std[j] < 1e-12) std[j] = 1; // constant feature -> zero after centering
  }
  return { mean, std };
}

function standardizeApply(X, { mean, std }) {
  return X.map((row) => {
    const out = new Float64Array(row.length);
    for (let j = 0; j < row.length; j++) out[j] = (row[j] - mean[j]) / std[j];
    return out;
  });
}

// ---- softmax core -----------------------------------------------------------

// W layout: K rows x (F+1) columns, last column is the bias (not penalized).
function logits(W, x, f) {
  const z = new Float64Array(K);
  for (let k = 0; k < K; k++) {
    const off = k * (f + 1);
    let s = W[off + f]; // bias
    for (let j = 0; j < f; j++) s += W[off + j] * x[j];
    z[k] = s;
  }
  return z;
}

function softmax(z) {
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

// Full-batch loss + gradient. Returns {loss, grad}. Optional per-sample
// weights w make this cost-sensitive: everything normalizes by sum(w)
// instead of n, so w = all-ones reproduces the unweighted math exactly.
// Used by the big-move hunter, where rare ±1 chunks must outweigh the
// dormant majority or the convex optimum is "always predict 0".
function lossGrad(W, X, yIdx, lambda, w = null) {
  const n = X.length;
  const f = X[0].length;
  const grad = new Float64Array(K * (f + 1));
  let loss = 0;
  let sumW = 0;
  for (let i = 0; i < n; i++) {
    const wi = w ? w[i] : 1;
    sumW += wi;
    const p = softmax(logits(W, X[i], f));
    loss -= wi * Math.log(Math.max(p[yIdx[i]], 1e-300));
    for (let k = 0; k < K; k++) {
      const err = wi * (p[k] - (k === yIdx[i] ? 1 : 0));
      const off = k * (f + 1);
      const x = X[i];
      for (let j = 0; j < f; j++) grad[off + j] += err * x[j];
      grad[off + f] += err;
    }
  }
  loss /= sumW;
  for (let k = 0; k < K; k++) {
    const off = k * (f + 1);
    for (let j = 0; j < f; j++) {
      loss += (lambda / (2 * sumW)) * W[off + j] * W[off + j];
      grad[off + j] = grad[off + j] / sumW + (lambda / sumW) * W[off + j];
    }
    grad[off + f] /= sumW;
  }
  return { loss, grad };
}

// Bold-driver gradient descent: grow the step while the loss falls, halve it
// (and undo the step) when it rises. Converges when the relative improvement
// stays under tol. The loss is convex, so the cap existing is a safety net,
// not a tuning knob — hitting it is reported as converged:false.
//
// Async on purpose: a multi-year run trains for minutes, and Node is
// single-threaded — without yielding, status polls queue unanswered until
// nginx returns an HTML 504 and the UI dies mid-run. Every few iterations
// the loop hands the event loop back through the service-wide CPU throttle
// (lib/throttle.js) and reports progress via onIter.
const { makeYielder } = require('./throttle');
const YIELD_EVERY = 10;

async function trainSoftmax(X, y, lambda, { maxIter = 5000, tol = 1e-7, onIter = null, weights = null } = {}) {
  const f = X[0].length;
  const yIdx = y.map(classIndex);
  const pace = makeYielder();
  let W = new Float64Array(K * (f + 1));
  let lr = 1.0;
  let { loss, grad } = lossGrad(W, X, yIdx, lambda, weights);
  let iter = 0;
  let converged = false;
  for (; iter < maxIter; iter++) {
    if (iter % YIELD_EVERY === 0) {
      if (onIter) onIter(iter);
      await pace();
    }
    const Wnext = new Float64Array(W.length);
    for (let i = 0; i < W.length; i++) Wnext[i] = W[i] - lr * grad[i];
    const next = lossGrad(Wnext, X, yIdx, lambda, weights);
    if (next.loss <= loss) {
      const improved = (loss - next.loss) / Math.max(loss, 1e-12);
      W = Wnext;
      loss = next.loss;
      grad = next.grad;
      lr *= 1.05;
      if (improved < tol) {
        converged = true;
        iter++;
        break;
      }
    } else {
      lr *= 0.5;
      if (lr < 1e-12) {
        converged = true; // step size exhausted: at the optimum within fp noise
        iter++;
        break;
      }
    }
  }
  return { W, f, loss, iters: iter, converged };
}

function predict(model, x) {
  const p = softmax(logits(model.W, x, model.f));
  let best = 0;
  for (let k = 1; k < K; k++) if (p[k] > p[best]) best = k;
  return { label: CLASSES[best], probs: { '-1': p[0], 0: p[1], 1: p[2] } };
}

// Optional per-sample weights turn this into cost-weighted accuracy — with
// balanced class weights it behaves like balanced accuracy, the right
// yardstick when the training objective itself is class-weighted.
function accuracy(model, X, y, w = null) {
  if (X.length === 0) return null;
  let hit = 0;
  let sumW = 0;
  for (let i = 0; i < X.length; i++) {
    const wi = w ? w[i] : 1;
    sumW += wi;
    if (predict(model, X[i]).label === y[i]) hit += wi;
  }
  return hit / sumW;
}

// ---- lambda ladder ----------------------------------------------------------

const DEFAULT_LAMBDAS = [0.01, 0.03, 0.1, 0.3, 1, 3, 10, 30];

// Chronological tune: validation = tail of the TRAINING window (never the
// test set). Ties go to the stronger lambda — when two strengths validate
// identically the simpler model generalizes better. When the winner sits at
// the TOP of the ladder, the ladder auto-extends (×~3 per rung, up to 4
// times) so an edge pick always means "the interior optimum", never "the
// fence was too close".
async function tuneAndTrain(Xtr, ytr, { lambdas = DEFAULT_LAMBDAS, onProgress = () => {}, classWeights = null } = {}) {
  const n = Xtr.length;
  const nVal = Math.max(3, Math.round(n * 0.25));
  const nSub = n - nVal;
  if (nSub < 4) throw new Error(`not enough training chunks (${n}) to tune regularization`);
  const Xsub = Xtr.slice(0, nSub);
  const ysub = ytr.slice(0, nSub);
  const Xval = Xtr.slice(nSub);
  const yval = ytr.slice(nSub);
  // classWeights (label -> weight) makes training cost-sensitive AND scores
  // the validation ladder with the same weights, so lambda is chosen for the
  // weighted objective, not for "predict the dormant majority".
  const wFor = classWeights ? (labels) => labels.map((l) => classWeights[l] ?? 1) : () => null;
  const wsub = wFor(ysub);
  const wval = wFor(yval);

  // Reference for reading the ladder: a model that always guesses the
  // sub-train majority class, scored on the same validation weeks. Ladder
  // rows at or below this are prior-convergence, not signal.
  const counts = new Map();
  for (const l of ysub) counts.set(l, (counts.get(l) || 0) + 1);
  const majLabel = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const valMajorityAcc = yval.filter((l) => l === majLabel).length / yval.length;

  const ladder = [];
  const evalLambda = async (lambda) => {
    onProgress(`training at lambda=${lambda}`);
    const m = await trainSoftmax(Xsub, ysub, lambda, {
      weights: wsub,
      onIter: (i) => onProgress(`training at lambda=${lambda} (iteration ${i})`),
    });
    ladder.push({ lambda, valAcc: accuracy(m, Xval, yval, wval), iters: m.iters, converged: m.converged });
  };
  const pickBest = () => {
    let best = ladder[0];
    for (const row of ladder) {
      if (row.valAcc > best.valAcc) best = row;
      else if (row.valAcc === best.valAcc && row.lambda > best.lambda && (row.converged || !best.converged)) best = row;
    }
    return best;
  };

  for (const lambda of lambdas) await evalLambda(lambda);
  for (let ext = 0; ext < 4; ext++) {
    const maxLambda = Math.max(...ladder.map((r) => r.lambda));
    if (pickBest().lambda !== maxLambda) break;
    await evalLambda(Math.round((maxLambda * 10) / 3)); // 30 -> 100 -> 333 -> 1110 -> 3700
  }

  const best = pickBest();
  onProgress(`retraining on full training set at lambda=${best.lambda}`);
  const model = await trainSoftmax(Xtr, ytr, best.lambda, {
    weights: wFor(ytr),
    onIter: (i) => onProgress(`retraining at lambda=${best.lambda} (iteration ${i})`),
  });
  return { model, ladder, chosenLambda: best.lambda, valSize: nVal, valMajorityAcc };
}

module.exports = {
  CLASSES,
  standardizeFit,
  standardizeApply,
  trainSoftmax,
  predict,
  accuracy,
  tuneAndTrain,
  DEFAULT_LAMBDAS,
};
