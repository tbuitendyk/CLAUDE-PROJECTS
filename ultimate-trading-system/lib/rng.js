// Seeded random numbers, so a run that uses chance can be repeated exactly.
//
// Every place this is used needs randomness that is reproducible from a seed:
// null rotations dealt onto random days, the fabricated pair the calibration
// check plants, the paired-fold exam. A run nobody can repeat is not evidence,
// so none of them may reach for Math.random.
//
// This lived in lib/interlace.js, whose other contents implemented a window
// layout the launcher refuses and which was removed with the rest of the dead
// code. Keeping a 180-line file describing retired machinery alive to host nine
// lines of arithmetic was the wrong trade.
//
// Zero imports, deliberately: worker threads load this.

// mulberry32 — a small, fast, well-distributed generator. Same seed, same
// sequence, on any machine and any Node version, which is the whole point.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { mulberry32 };
