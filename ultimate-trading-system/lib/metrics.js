// Classification metrics — the general classifier's headline numbers,
// extracted so the BRACKET LAB can report the exact same ones.
//
// This file is a deliberate re-expression of what pipeline.js computes for a
// single model, applied instead to a COMMITTEE's call stream. Every formula
// below is copied from there rather than reinvented, because the whole point
// is that a signal the classifier would have found shows up in the bracket
// lab as the same number, not as something merely similar:
//
//   testAcc            exact 3-class match rate, predicted == actual
//   majorityClass      argmax over the TRAINING counts (not the test ones)
//   majorityBaseline   share of TEST labels equal to that class
//   edge               testAcc - majorityBaseline
//   bestConstant       max test class share — the strongest hindsight constant
//   hindsightEdge      testAcc - bestConstant
//   balancedAcc        mean per-class recall over classes present in test
//   balancedEdge       balancedAcc - 1/3
//   directionalCalls   count of non-zero calls
//   directionalHits    of those, how many matched EXACTLY (a +1 call on a
//                      dormant 0 label is a miss, same as pipeline.js)
//
// Zero imports on purpose: worker threads load this, and lib/worker.js must
// never reach a stateful module.
const CLASSES = [-1, 0, 1];

function classCounts(labels) {
  const counts = { '-1': 0, 0: 0, 1: 0 };
  for (const l of labels) counts[l]++;
  return counts;
}

// Recall per class, null where the class never occurs in the test window —
// pipeline.js averages only the non-null ones, so balancedAcc is over classes
// PRESENT, not over all three.
function perClassRecall(actual, predicted) {
  return CLASSES.map((cls) => {
    let tp = 0;
    let support = 0;
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] === cls) {
        support++;
        if (predicted[i] === cls) tp++;
      }
    }
    return support > 0 ? tp / support : null;
  });
}

function classifierMetrics(trainLabels, testLabels, calls) {
  if (!testLabels.length) return null;
  const trainCounts = classCounts(trainLabels);
  const testCounts = classCounts(testLabels);

  let hits = 0;
  let dirCalls = 0;
  let dirHits = 0;
  for (let i = 0; i < testLabels.length; i++) {
    if (calls[i] === testLabels[i]) hits++;
    if (calls[i] !== 0) {
      dirCalls++;
      if (calls[i] === testLabels[i]) dirHits++;
    }
  }
  const testAcc = hits / testLabels.length;

  const majorityClass = CLASSES.reduce((a, b) => (trainCounts[b] > trainCounts[a] ? b : a));
  const majorityBaseline = testCounts[majorityClass] / testLabels.length;
  const bestConstant = Math.max(...Object.values(testCounts)) / testLabels.length;

  const recalls = perClassRecall(testLabels, calls).filter((r) => r != null);
  const balancedAcc = recalls.length ? recalls.reduce((s, v) => s + v, 0) / recalls.length : null;

  return {
    testAcc,
    majorityClass,
    majorityBaseline,
    edge: testAcc - majorityBaseline,
    bestConstant,
    hindsightEdge: testAcc - bestConstant,
    balancedAcc,
    balancedEdge: balancedAcc != null ? balancedAcc - 1 / 3 : null,
    directionalCalls: dirCalls,
    directionalHits: dirHits,
    directionalHitRate: dirCalls > 0 ? dirHits / dirCalls : null,
    testPeriods: testLabels.length,
  };
}

module.exports = { classifierMetrics, classCounts, perClassRecall, CLASSES };
