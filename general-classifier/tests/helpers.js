const assert = require('assert');

// Deterministic LCG so tests never depend on Math.random.
function makeRng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

module.exports = { assert, makeRng };
