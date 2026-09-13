const assert = require('assert');

// Deterministic LCG so tests never depend on Math.random.
function makeRng(seed = 42) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// EVERY NUMBER WRITTEN INTO A PIECE OF SOURCE, AS A VALUE (2026-09-13).
//
// Two scans in this suite ask whether a share has been typed somewhere it must
// not be, and both asked it by matching the SPELLING -- /0\.13/. To the engine
// `.13`, `0.130`, `13e-2` and `1.3e-1` are that same number; to those scans
// they were nothing at all, so a second copy of the share could be typed back
// in and every guard would stay green. Asked as a VALUE there is no spelling
// left to slip through.
//
// Comments go first, both kinds: a scan a comment can set off proves nothing
// either way, and the old one stripped only whole-line comments, so a trailing
// one was enough to fail it.
function numberLiteralsIn(src) {
  const code = String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:/])\/\/[^\n]*/g, '$1');
  const NUM = /(?<![\w$.])(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)/g;
  const out = [];
  for (const m of code.matchAll(NUM)) {
    const v = Number(String(m[0]).replace(/_/g, ''));
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

module.exports = { assert, makeRng, numberLiteralsIn };
