// lib/paper.js — the paper-trade arithmetic and the rule that turns a
// committee's probabilities into a side.
//
// directionalCall was covered only by the consensus screen's test file, which
// went with that screen (THIS-RELEASE point 14). The rule itself did not: it is
// what the surviving sweep's `directional` decision runs on, through
// lib/bracket.js trainMember. Leaving its only test inside a deleted file would
// have removed the protection silently, so it moved here, beside the module it
// is actually about.
const { assert } = require('./helpers');
const { directionalCall } = require('../lib/paper');

module.exports = {
  async directionalCallIgnoresTheDormantClass() {
    // P(0) can dominate outright and still never win at tau=0 — standing
    // aside only happens on ties or below-threshold confidence.
    assert.strictEqual(directionalCall({ '-1': 0.2, 0: 0.5, 1: 0.3 }, 0), 1);
    assert.strictEqual(directionalCall({ '-1': 0.3, 0: 0.5, 1: 0.2 }, 0), -1);
    assert.strictEqual(directionalCall({ '-1': 0.25, 0: 0.5, 1: 0.25 }, 0), 0); // exact tie
    assert.strictEqual(directionalCall({ '-1': 0.2, 0: 0.5, 1: 0.3 }, 0.4), 0); // under threshold
    assert.strictEqual(directionalCall({ '-1': 0.2, 0: 0.35, 1: 0.45 }, 0.4), 1); // over it
    assert.strictEqual(directionalCall({ '-1': 0.55, 0: 0.05, 1: 0.4 }, 0.5), -1);
  },
};
