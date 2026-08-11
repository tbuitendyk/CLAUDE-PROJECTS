// stopsweep pure parts: eligibility gate + call->entry conversion. The async
// full-history replay (computeSetupStop) is integration-tested on the VPS where
// candle data is available.
const { assert } = require('./helpers');
const { HOUR_MS } = require('../lib/binance');
const { entriesFromCalls, hasExistingStop } = require('../lib/stopsweep');

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
