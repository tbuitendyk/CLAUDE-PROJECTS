// lib/stats.js — the shared arithmetic.
//
// Created without a test, which is how the module it came out of lost a
// constant unnoticed. The empty-list contract below is the one the Construct
// screen depends on: a null-run summary with no samples must read "no answer",
// never a number and never NaN.
const { assert } = require('./helpers');
const { median } = require('../lib/stats');

module.exports = {
  // NOT NaN and NOT zero. A summary that shows 0 where it has nothing is a
  // number the owner would read as a result.
  async anEmptyListHasNoMiddleAndSaysSo() {
    assert.strictEqual(median([]), null);
  },

  async oddLengthTakesTheMiddleValue() {
    assert.strictEqual(median([3, 1, 2]), 2);
    assert.strictEqual(median([5]), 5);
  },

  async evenLengthAveragesTheTwoMiddleValues() {
    assert.strictEqual(median([4, 1, 3, 2]), 2.5);
    assert.strictEqual(median([2, 1]), 1.5);
  },

  // Callers pass arrays they still need. Sorting in place would silently
  // reorder a caller's data — the kind of fault that shows up somewhere else
  // entirely and is never traced back here.
  async theCallersArrayIsNotReordered() {
    const src = [3, 1, 2];
    median(src);
    assert.deepStrictEqual(src, [3, 1, 2]);
  },

  // Sorted numerically, not as text. JavaScript's default sort would order
  // [10, 9, 100] as [10, 100, 9] and return 100 as the middle value.
  async itSortsAsNumbersNotAsText() {
    assert.strictEqual(median([10, 9, 100]), 10);
    assert.strictEqual(median([2, 10, 1]), 2);
  },

  async negativesAndZeroAreOrderedCorrectly() {
    assert.strictEqual(median([-5, 0, 5]), 0);
    assert.strictEqual(median([-1, -3, -2]), -2);
  },
};
