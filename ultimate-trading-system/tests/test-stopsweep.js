// stopsweep pure parts: eligibility gate + call->entry conversion. The async
// full-history replay (computeSetupStop) is integration-tested on the VPS where
// candle data is available.
const { assert } = require('./helpers');
const { HOUR_MS } = require('../lib/binance');
const { entriesFromCalls, hasExistingStop } = require('../lib/stopsweep');
const { entryOutcome } = require('../lib/stoptuner');
const { FEE_PER_LEG, FEE_ROUND_TRIP, feeRate, feeFracOf } = require('../lib/paper');

module.exports.feeMustBeFractionalNotDollars = function () {
  // REGRESSION (2026-08-11), CLOSED AT THE ROOT (owner order, 2026-08-23).
  //
  // The fee used to be $0.125 A LEG — dollars — while this stop tuner has always
  // worked in fractional returns. Feeding the dollar figure straight in made a
  // 25% round-trip hurdle instead of 0.25% and mislabelled 97% of trades as
  // losers. Every caller carried a hand conversion to stop that happening, and a
  // hand conversion is something somebody eventually forgets.
  //
  // There is one meaning now: a fraction of the position, everywhere. So this
  // test no longer pins a conversion — it pins that the conversion is not
  // needed, and that the dollar figure can never be charged again by accident.
  assert.ok(Math.abs(FEE_PER_LEG - 0.00125) < 1e-12, `the lab fee is 0.00125 of the position, got ${FEE_PER_LEG}`);
  assert.ok(Math.abs(FEE_ROUND_TRIP - 0.0025) < 1e-12, 'the round trip is both legs');

  const map = new Map();
  map.set(0, { open: 100, high: 100, low: 100, close: 100 });
  map.set(3 * HOUR_MS, { open: 100.5, high: 100.5, low: 100.5, close: 100.5 }); // +0.5%
  // A +0.5% move clears the 0.25% round trip and is a winner. No conversion.
  assert.ok(entryOutcome(0, 'LONG', map, 3, FEE_PER_LEG).netPct > 0,
    'a +0.5% move is a winner at the real fee, with the fee passed through unconverted');

  // THE OLD DOLLAR VALUE IS REFUSED, not charged. This is what makes the bug
  // impossible rather than merely fixed: at 0.125 the same trade used to come
  // back a loser and nothing said why.
  let err = null;
  try { feeRate(0.125, 'test'); } catch (e) { err = e; }
  assert.ok(err, 'a fee of 0.125 was accepted — that is dollars, and it is a 12.5% rate');
  assert.ok(/FRACTIONS here, not dollars/.test(err.message), `wrong refusal: ${err.message}`);

  // And a run recorded before the change still prices at the cost it was found
  // under, rather than at a hundred times it.
  assert.ok(Math.abs(feeFracOf({ feePerLeg: 0.125 }) - FEE_PER_LEG) < 1e-12,
    'a run recorded in dollars must read back as the same real cost');
  assert.ok(Math.abs(feeFracOf({ feePerLeg: 0.00125, feeUnits: 'fraction' }) - FEE_PER_LEG) < 1e-12,
    'a run recorded as a fraction is taken as it stands');
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
// a module of built-in trade set-ups — the frozen dates of a research record with
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
  // NOTHING IS EVER BAKED INTO THE CODE (owner order, 2026-08-28: "THE SYSTEM
  // BELONGS TO *ME*"). Three trade set-ups — coins, settings, cutoff dates and
  // recorded results — used to live in lib/forwardbook.js and were offered
  // beside the owner's own profiles. They are gone. This check is repo-wide
  // rather than about these two modules, because the rule is about the whole
  // product: no such file, and nothing anywhere reaching for one.
  {
    const root = path.join(__dirname, '..');
    assert.ok(!fs.existsSync(path.join(root, 'lib', 'forwardbook.js')),
      'lib/forwardbook.js is back — trade set-ups written into the product are never allowed');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      if (d.name === 'node_modules' || d.name === 'data' || d.name.startsWith('.')) return [];
      const full = path.join(dir, d.name);
      return d.isDirectory() ? walk(full) : (d.name.endsWith('.js') ? [full] : []);
    });
    for (const file of walk(root)) {
      const raw = fs.readFileSync(file, 'utf8').replace(/\/\/[^\n]*/g, '');
      assert.ok(!/require\([^)]*forwardbook[^)]*\)/.test(raw),
        `${path.relative(root, file)} reaches for a module of built-in trade set-ups`);
    }
  }
  for (const f of ['stopsweep.js', 'convictionsweep.js']) {
    const raw = fs.readFileSync(path.join(__dirname, '..', 'lib', f), 'utf8');
    // Strip line comments before checking: the explanation of WHY these
    // constants are gone necessarily names them, and a test that cannot tell
    // prose from code fails on its own documentation.
    const src = raw.replace(/\/\/[^\n]*/g, '');
    assert.ok(!/require\('\.\/forwardbook'\)/.test(src),
      `lib/${f} imports a set of trade set-ups written into the product again — nothing is ever baked into the code`);
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
