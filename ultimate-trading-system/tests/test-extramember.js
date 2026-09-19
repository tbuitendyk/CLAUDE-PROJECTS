// THE EXTRA MEMBER'S NUMBERS (3.182.0, ADDITIONAL-MEMBER-DESIGN.md sections B
// and D; owner LOOP NOW! 2026-09-19).
//
// A unit promoted out of Walk it forward keeps every member it has and gains
// one more, trained on the same twenty-one numbers measured over the walk's
// look-back instead of over the chunk shape's own window.
//
// THE FIRST TEST IN THIS FILE IS THE ONE THAT MATTERS. lib/features.js stamps
// every record set with a measurement block version, and lib/stages.js refuses
// a parent built on a different one -- "every member in it was trained on
// numbers that no longer exist. Start a new stage 1." So a unit that asks for
// NO extra must come out byte for byte as it did before this existed, or the
// owner loses every chain on the box to a change nobody asked for.
const assert = require('assert');
const { buildComboChunks, comboViews } = require('../lib/bracket');
const { GEOMETRIES } = require('../lib/dataset');
const feats = require('../lib/features');

const HOUR_MS = 3600000;
const GEO = 'daily-1d';                       // 24 feature hours, so an extra plainly reaches back
const FEATURE_HOURS = GEOMETRIES[GEO].featureHours;

// A MADE-UP COIN WITH A SHAPE, not a flat line: assetCompressed reads quarter
// returns, a trend and a drawdown, and a flat series makes several of them
// nought, which would hide a column landing in the wrong place.
function coinMap(days, t0 = Date.UTC(2024, 0, 1)) {
  const m = new Map();
  const hours = days * 24;
  for (let i = 0; i < hours; i++) {
    const wave = Math.sin(i / 37) * 6 + Math.sin(i / 11) * 2;
    const open = 100 + i * 0.02 + wave;
    const close = open + Math.sin(i / 5) * 0.4;
    m.set(t0 + i * HOUR_MS, {
      open, close, high: Math.max(open, close) + 0.3, low: Math.min(open, close) - 0.3, volume: 1000 + (i % 50) * 7,
    });
  }
  return m;
}

const maps1 = () => ({ trade: coinMap(120) });
const maps2 = () => ({ trade: coinMap(120), ctx1: coinMap(120, Date.UTC(2024, 0, 1)) });

function aUnitWithNoExtraIsByteForByteWhatItWasBefore() {
  for (const maps of [maps1(), maps2()]) {
    const was = buildComboChunks(maps, GEO, false);
    const now = buildComboChunks(maps, GEO, false, false, []);
    assert.strictEqual(now.featureCount, was.featureCount, 'the vector is the same length');
    assert.strictEqual(now.chunks.length, was.chunks.length, 'and holds the same chunks');
    assert.ok(was.chunks.length > 40, `and there are enough of them to mean something (${was.chunks.length})`);
    for (let i = 0; i < was.chunks.length; i++) {
      assert.strictEqual(now.chunks[i].startTs, was.chunks[i].startTs);
      assert.deepStrictEqual(now.chunks[i].x, was.chunks[i].x, `chunk ${i} is unchanged`);
      assert.strictEqual(now.chunks[i].label, was.chunks[i].label);
      assert.strictEqual(now.chunks[i].diffPct, was.chunks[i].diffPct);
    }
    assert.strictEqual(now.tooEarly, undefined, 'and nothing was dropped for a warm-up it never asked for');
  }
  assert.strictEqual(feats.MEASUREMENTS_VERSION, 3,
    'the measurement block MUST NOT move for this work — a parent built on another one is refused by name');
}

function anExtraIsAppendedAndTheBaseColumnsDoNotMove() {
  const maps = maps1();
  const was = buildComboChunks(maps, GEO, false);
  const now = buildComboChunks(maps, GEO, false, false, [{ lookbackHours: 168 }]);
  assert.strictEqual(now.featureCount, was.featureCount + feats.PER_ASSET, 'one block of twenty-one more');
  const byTs = new Map(was.chunks.map((c) => [c.startTs, c]));
  assert.ok(now.chunks.length > 20, `enough chunks survive the warm-up (${now.chunks.length})`);
  for (const c of now.chunks) {
    const before = byTs.get(c.startTs);
    assert.ok(before, 'every chunk that survives was there before');
    assert.strictEqual(c.x.length, now.featureCount);
    assert.deepStrictEqual(c.x.slice(0, was.featureCount), before.x,
      'the base columns are exactly what they were — nothing woven into the middle');
  }
}

function theExtraBlockReallyIsTheLookBackEndingWhereTheChunkEnds() {
  const maps = maps1();
  const HOURS = 168;
  const now = buildComboChunks(maps, GEO, false, false, [{ lookbackHours: HOURS }]);
  const base = buildComboChunks(maps, GEO, false).featureCount;
  const c = now.chunks[5];
  // the span ends where the chunk's own features end, so it starts
  // HOURS - FEATURE_HOURS before the chunk does
  const from = c.startTs + (FEATURE_HOURS - HOURS) * HOUR_MS;
  const run = require('../lib/dataset').candleRun(maps.trade, from, HOURS);
  assert.ok(run, 'the candles for that span are in the map');
  assert.strictEqual(run.length, HOURS);
  assert.strictEqual(run[run.length - 1].close, maps.trade.get(c.startTs + (FEATURE_HOURS - 1) * HOUR_MS).close,
    'and it ends on the last candle of the chunk itself');
  assert.deepStrictEqual(c.x.slice(base), feats.spanFeatures(run), 'the extra block is that span, measured');
}

function thePlainMoveOverTheLookBackIsAlreadyOneOfTheNumbers() {
  // The owner asked for the walk's own number to ride along. total_ret over the
  // span IS it, so it needs no column of its own — this proves that rather than
  // leaving it as a claim in a comment.
  const maps = maps1();
  const HOURS = 96;
  const now = buildComboChunks(maps, GEO, false, false, [{ lookbackHours: HOURS }]);
  const base = buildComboChunks(maps, GEO, false).featureCount;
  const at = feats.PER_ASSET_SPEC.findIndex(([name]) => name === 'total_ret');
  assert.ok(at >= 0, 'total_ret is one of the twenty-one');
  const c = now.chunks[3];
  const run = require('../lib/dataset').candleRun(maps.trade, c.startTs + (FEATURE_HOURS - HOURS) * HOUR_MS, HOURS);
  const move = run[run.length - 1].close / run[0].open - 1;
  assert.ok(Math.abs(c.x[base + at] - move) < 1e-12,
    'the plain move over the look-back is in the extra block already');
}

function aChunkThatCannotReachBackIsDroppedAndCounted() {
  const maps = maps1();
  const plain = buildComboChunks(maps, GEO, false).chunks.length;
  const short = buildComboChunks(maps, GEO, false, false, [{ lookbackHours: 48 }]);
  const long = buildComboChunks(maps, GEO, false, false, [{ lookbackHours: 24 * 30 }]);
  assert.ok(long.chunks.length < short.chunks.length, 'a longer look-back costs more of the early chunks');
  assert.strictEqual(short.tooEarly, plain - short.chunks.length, 'and what went is counted, not quietly lost');
  assert.strictEqual(long.tooEarly, plain - long.chunks.length);
  assert.ok(long.tooEarly > 0, 'a thirty-day look-back really does cost some');
  // NOT filled with noughts: every surviving chunk carries a real block
  const base = buildComboChunks(maps, GEO, false).featureCount;
  for (const c of long.chunks) {
    assert.ok(c.x.slice(base).some((v) => v !== 0), 'no surviving chunk carries a fabricated block of noughts');
  }
}

function twoExtrasSitInTheOrderTheUnitCarriesThem() {
  const maps = maps1();
  const base = buildComboChunks(maps, GEO, false).featureCount;
  const two = buildComboChunks(maps, GEO, false, false, [{ lookbackHours: 72 }, { lookbackHours: 168 }]);
  assert.strictEqual(two.featureCount, base + 2 * feats.PER_ASSET, 'two blocks, not one and not three');
  const c = two.chunks[2];
  const run = (h) => require('../lib/dataset').candleRun(maps.trade, c.startTs + (FEATURE_HOURS - h) * HOUR_MS, h);
  assert.deepStrictEqual(c.x.slice(base, base + feats.PER_ASSET), feats.spanFeatures(run(72)), 'the first extra is first');
  assert.deepStrictEqual(c.x.slice(base + feats.PER_ASSET), feats.spanFeatures(run(168)), 'the second is second');
  // and a third is one more entry in the list, not another branch
  const three = buildComboChunks(maps, GEO, false, false,
    [{ lookbackHours: 72 }, { lookbackHours: 168 }, { lookbackHours: 336 }]);
  assert.strictEqual(three.featureCount, base + 3 * feats.PER_ASSET);
}

function theSlicesForTheExtrasAreTheirOwnAndTheBaseSlicesDoNotMove() {
  for (const size of [1, 2, 3]) {
    const plain = comboViews(size, 1);
    const withTwo = comboViews(size, 1, 2);
    assert.strictEqual(withTwo.featureCount, plain.featureCount + 2 * feats.PER_ASSET);
    for (const name of Object.keys(plain.views)) {
      assert.deepStrictEqual(withTwo.views[name], plain.views[name], `the ${name} slice is untouched at size ${size}`);
    }
    assert.deepStrictEqual(comboViews(size, 1, 0), plain, 'asking for none is the same as not asking');
    const e0 = withTwo.views.extra0;
    const e1 = withTwo.views.extra1;
    assert.strictEqual(e0.length, feats.PER_ASSET);
    assert.strictEqual(e0[0], plain.featureCount, 'the first extra starts where the base vector ends');
    assert.strictEqual(e1[0], plain.featureCount + feats.PER_ASSET);
    // no base slice can see an extra column
    const extras = new Set([...e0, ...e1]);
    for (const name of Object.keys(plain.views)) {
      for (const i of plain.views[name] || []) {
        assert.ok(!extras.has(i), `the ${name} slice must not reach into an extra block`);
      }
    }
  }
}

function anExtraWithoutAnHourCountIsRefusedRatherThanIgnored() {
  const maps = maps1();
  for (const bad of [[{ lookbackHours: 0 }], [{ lookbackHours: -24 }], [{}], [{ lookbackHours: 'soon' }]]) {
    assert.throws(() => buildComboChunks(maps, GEO, false, false, bad), /number of hours above nought/,
      `${JSON.stringify(bad)} is refused by name`);
  }
}

// THE EXTRA BLOCK MUST NOT SEE THE DECISION CANDLE (3.184.0). The trade opens
// at the geometry's entry hour, one clear hour after the chunk's own window
// closes. Only that candle's OPEN is known at the moment of decision — its
// high, its low and its close are not. A block that reached even one hour
// further than the base features would carry three numbers from after the
// decision, and it would look like a BETTER member for it.
//
// The block ends exactly where the base features end, so this holds by
// construction — and it is worth a test of its own precisely because it holds
// by construction: the next person to move the span by an hour will not know.
function theExtraBlockNeverReachesTheDecisionCandle() {
  const maps = maps1();
  const entryAt = GEOMETRIES[GEO].entryOffsetH;
  assert.ok(entryAt > FEATURE_HOURS, 'the entry candle sits after the chunk window closes');
  for (const HOURS of [48, 168, 24 * 21]) {
    const now = buildComboChunks(maps, GEO, false, false, [{ lookbackHours: HOURS }]);
    const c = now.chunks[4];
    const lastHour = c.startTs + (FEATURE_HOURS - 1) * HOUR_MS;
    const from = c.startTs + (FEATURE_HOURS - HOURS) * HOUR_MS;
    assert.strictEqual(from + (HOURS - 1) * HOUR_MS, lastHour,
      `a ${HOURS}-hour block ends on the chunk's own last candle, never later`);
    assert.ok(lastHour < c.startTs + entryAt * HOUR_MS,
      'and that is strictly before the candle the trade opens on');
  }
}

// AN UNREADABLE SPAN IS REFUSED RATHER THAN QUIETLY MISREAD (3.184.0).
function aSpanThatCannotBeHalvedOrQuarteredIsRefused() {
  const maps = maps1();
  for (const h of [1, 4, 6, 7]) {
    assert.throws(() => buildComboChunks(maps, GEO, false, false, [{ lookbackHours: h }]),
      /at least 8 and a whole multiple of 4/, `${h} hours is refused by name`);
  }
  for (const h of [25, 50, 99, 167]) {
    assert.throws(() => buildComboChunks(maps, GEO, false, false, [{ lookbackHours: h }]),
      /whole multiple of 4/, `${h} hours is refused: its quarters would drop hours on the floor`);
  }
  for (const h of [8, 24, 48, 168, 504]) {
    assert.doesNotThrow(() => buildComboChunks(maps, GEO, false, false, [{ lookbackHours: h }]),
      `${h} hours is fine — every look-back the walk offers is a multiple of 24`);
  }
}

module.exports = {
  aUnitWithNoExtraIsByteForByteWhatItWasBefore,
  anExtraIsAppendedAndTheBaseColumnsDoNotMove,
  theExtraBlockReallyIsTheLookBackEndingWhereTheChunkEnds,
  thePlainMoveOverTheLookBackIsAlreadyOneOfTheNumbers,
  aChunkThatCannotReachBackIsDroppedAndCounted,
  twoExtrasSitInTheOrderTheUnitCarriesThem,
  theSlicesForTheExtrasAreTheirOwnAndTheBaseSlicesDoNotMove,
  anExtraWithoutAnHourCountIsRefusedRatherThanIgnored,
  theExtraBlockNeverReachesTheDecisionCandle,
  aSpanThatCannotBeHalvedOrQuarteredIsRefused,
};
