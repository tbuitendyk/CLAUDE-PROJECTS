// stopsweep pure parts: eligibility gate + call->entry conversion. The async
// full-history replay (computeSetupStop) is integration-tested on the VPS where
// candle data is available.
const { assert } = require('./helpers');
const { HOUR_MS } = require('../lib/binance');
const { entriesFromCalls, hasExistingStop } = require('../lib/stopsweep');
const { entryOutcome } = require('../lib/stoptuner');
const { REAL_FEE_PER_LEG, NOTIONAL } = require('../lib/paper');

module.exports.feeMustBeFractionalNotDollars = function () {
  // REGRESSION (2026-08-11): REAL_FEE_PER_LEG is $0.125 on the $100 notional, i.e.
  // 0.00125 as a FRACTION. The stop tuner works in fractional returns; feeding the
  // dollar 0.125 straight in made a 25% round-trip hurdle and mislabelled 97% of
  // trades as losers. Pin the conversion and the direction of the bug.
  const frac = REAL_FEE_PER_LEG / NOTIONAL;
  assert.ok(Math.abs(frac - 0.00125) < 1e-9, `fractional fee is 0.00125, got ${frac}`);
  const map = new Map();
  map.set(0, { open: 100, high: 100, low: 100, close: 100 });
  map.set(3 * HOUR_MS, { open: 100.5, high: 100.5, low: 100.5, close: 100.5 }); // +0.5%
  // with the CORRECT fractional fee, a +0.5% move clears the ~0.25% hurdle -> winner
  assert.ok(entryOutcome(0, 'LONG', map, 3, frac).netPct > 0, 'a +0.5% move is a winner at the real fee');
  // with the DOLLAR value used as a fraction (the bug), the same trade is a loser
  assert.ok(entryOutcome(0, 'LONG', map, 3, REAL_FEE_PER_LEG).netPct < 0, 'the dollar-as-fraction bug flips it to a loser');
};

module.exports.onlyMarketNoTrailSetupsAreStoplessAndTunable = function () {
  // F1-shape: market entry, no trailing stop -> HAS NO existing stop (tunable)
  assert.strictEqual(hasExistingStop({ entry: 'market', trailMult: null }), false,
    'a market entry with no trail has no protective stop');
  // breakout: the opposite rail is already the stop -> excluded
  assert.strictEqual(hasExistingStop({ entry: 'breakout', trailMult: null }), true,
    'a breakout cell stops at its opposite rail');
  // market but WITH a trailing stop -> excluded
  assert.strictEqual(hasExistingStop({ entry: 'market', trailMult: 2 }), true,
    'a trailing stop is an existing protective stop');
  assert.strictEqual(hasExistingStop(null), true, 'a missing cell is treated as already-stopped (safe)');
};

module.exports.entriesFromCallsMapsSidesAndOffsetSkippingFlat = function () {
  const chunks = [{ startTs: 0 }, { startTs: 1000 * HOUR_MS }, { startTs: 2000 * HOUR_MS }, { startTs: 3000 * HOUR_MS }];
  const calls = [1, 0, -1, 1];            // LONG, FLAT, SHORT, LONG
  const geo = { entryOffsetH: 97 };        // F1's daily-4d entry offset
  const entries = entriesFromCalls(chunks, calls, geo);
  assert.strictEqual(entries.length, 3, 'the FLAT call produces no entry');
  assert.deepStrictEqual(entries[0], { entryTs: 0 + 97 * HOUR_MS, side: 'LONG' });
  assert.deepStrictEqual(entries[1], { entryTs: 2000 * HOUR_MS + 97 * HOUR_MS, side: 'SHORT' });
  assert.deepStrictEqual(entries[2], { entryTs: 3000 * HOUR_MS + 97 * HOUR_MS, side: 'LONG' });
};

module.exports.zeroOffsetEntersAtChunkStart = function () {
  const entries = entriesFromCalls([{ startTs: 500 * HOUR_MS }], [-1], {});
  assert.deepStrictEqual(entries[0], { entryTs: 500 * HOUR_MS, side: 'SHORT' });
};

// A SCAN MUST STATE ITS OWN TRAINING CUTOFF (owner, 2026-08-19).
//
// Both heavy scans used to default to TRAIN_THROUGH/SCORE_FROM imported from
// lib/forwardbook.js — the frozen dates of a pre-registered research record with
// three books in it. Correct for that record, meaningless for anything else. So
// tuning a protective stop for the owner's own setup silently trained the
// committee through a stranger's cutoff and returned a confident number with the
// right units and a plausible magnitude. Every serious defect in this project has
// been that shape: not maths that throws, instrumentation that lies.
//
// The guard has no default to fall back to. This test exists because disabling
// the guard was watched leaving the whole suite green.
module.exports.aScanWithNoStatedCutoffIsRefusedNotDefaulted = function () {
  const fs = require('fs');
  const path = require('path');
  for (const f of ['stopsweep.js', 'convictionsweep.js']) {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'lib', f), 'utf8');
    // Strip line comments before checking: the explanation of WHY these
    // constants are gone necessarily names them, and a test that cannot tell
    // prose from code fails on its own documentation.
    const src = raw.replace(/\/\/[^\n]*/g, '');
    assert.ok(!/require\('\.\/forwardbook'\)/.test(src),
      `lib/${f} imports the pre-registered record again — its frozen dates are not a default for anyone else`);
    assert.ok(!/TRAIN_THROUGH|SCORE_FROM/.test(src),
      `lib/${f} still references another record's frozen constants`);
    assert.ok(/function requireFreeze\(/.test(src), `lib/${f} lost the cutoff guard`);
    assert.ok(/if \(!Number\.isFinite\(t\)\)/.test(src),
      `lib/${f}'s cutoff guard no longer tests the cutoff, so an unstated one passes through`);
  }
  // and the guard actually throws, naming what is missing
  const { computeSetupStop } = require('../lib/stopsweep');
  const book = { id: 'unit-test', combo: { trade: 'X', ctx1: 'Y', ctx2: 'Z', size: 3 },
    branch: { band: 1 }, members: [], cell: { entry: 'market', trailMult: null, quorum: 1, tHours: 24 } };
  return computeSetupStop(book, {}).then(
    () => { throw new Error('a scan with no stated cutoff was allowed to run'); },
    (e) => {
      assert.ok(/training cutoff/i.test(e.message),
        `the refusal must name the missing cutoff; got: ${e.message}`);
    },
  );
};
