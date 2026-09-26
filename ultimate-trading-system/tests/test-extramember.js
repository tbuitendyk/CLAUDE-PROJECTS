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


// AN EXTRA'S BAND IS A MULTIPLE OF THE USUAL MOVE, NOT A PERCENT OF PRICE
// (3.188.0, owner's choice: "do b").
//
// THE DEFECT THIS CLOSES. A unit's own band is a percent of price: 2.5 means a
// move of 2.5%. The number a walk carries is a MULTIPLE of what the coin
// usually moves: 90 means nine tenths of it. One was being substituted for the
// other, so a walk's 90 was read as a 90% price move, EVERY chunk came out as
// sit out, and the extra member trained on one constant answer -- the exact
// failure the design's section F exists to prevent, arriving as a unit mix-up
// rather than through the arithmetic. Nothing had run through it.
//
// AND WHICH USUAL MOVE. The walk measured its own over the LOOK-BACK -- the
// move before the decision, which is what its band thresholds. What is
// thresholded here is the move AFTER: the answer the member is trained to
// forecast. So the multiple carries over and the scale is measured here, on
// the thing actually being thresholded, over the TRAIN stretch alone.
function anExtrasBandIsAMultipleOfTheUsualOutcomeMove() {
  const bw = require('../lib/bracketwork');
  const { medianAbsMove } = require('../lib/windowmove');
  // THE MOVE THE BAND IS ABOUT IS THE LOOK-BACK'S, NOT THE OUTCOME'S (3.198.0),
  // AND THE YARDSTICK TRAILS (3.201.0). The fixture gives the two moves
  // deliberately different scales -- the outcome about 10% and the look-back
  // about 2% -- so neither can be mistaken for the other.
  const backs = [0.5, -1, 2, -2.5, 3, -1.5, 1, -4, 2.2, -0.8];
  const wide = backs.concat(backs, backs);     // 30 chunks: past MIN_CHUNKS, so the gate can fire
  const chunks = () => wide.map((d, i) => ({ backPct: [d], diffPct: (i % 2 ? 10 : -10), label: (i % 2 ? 1 : -1) }));
  const usual = medianAbsMove(backs);
  assert.ok(usual > 1 && usual < 3, `the fixture's usual look-back move is ${usual}%, which is not the scale this test is written around`);

  // the multiple times the usual look-back move, and nothing else
  for (const m of [10, 90, 300]) {
    const t = bw.markExtraGates(chunks(), [m])[0];
    assert.ok(Math.abs(t - usual * (m / 100)) < 0.35,
      `a multiple of ${m} came out at ${t} and the usual look-back move is ${usual}`);
  }
  // AND IT IS NOT THE RAW NUMBER. Read as a percent of price, a multiple of 90
  // is a 90% move and nothing is ever up or down.
  assert.ok(bw.markExtraGates(chunks(), [90])[0] < 5, 'a nine-tenths-of-usual band came out bigger than any move this coin makes');
  assert.deepStrictEqual(bw.markExtraGates(chunks(), []), [], 'a unit with no extras is given a band it did not ask for');

  // TWO EXTRAS MEASURE TWO LOOK-BACKS, each scaled off its own
  const two = wide.map((d, i) => ({ backPct: [d, d * 2], diffPct: (i % 2 ? 10 : -10), label: 1 }));
  const got = bw.markExtraGates(two, [100, 100]);
  assert.ok(Math.abs(got[1] / got[0] - 2) < 0.05, 'a look-back that moves twice as far did not come out twice as wide');

  // A COIN WITH NO TYPICAL MOVE AT ALL REFUSES rather than gating on nought
  assert.throws(() => bw.markExtraGates(wide.map(() => ({ backPct: [0] })), [90]), /no typical move at all/);
  assert.throws(() => bw.markExtraGates(wide.map(() => ({ diffPct: 3 })), [90]), /no typical move at all/);
  // and the refusals that were already there still are
  assert.throws(() => bw.markExtraGates(chunks(), ['auto']), /never auto/);
  assert.throws(() => bw.markExtraGates(chunks(), [0]), /above nought/);
}

// A CHUNK'S GATE IS WORKED OUT FROM THE CHUNKS BEFORE IT AND NOTHING AFTER
// (owner order, 2026-09-25: "write tests for those four gaps"). The yardstick
// trails, and the test below it said so without checking it: it ran the gate
// twice on the same chunks and rebuilt the yardstick in the test instead of
// reading the library's. So a yardstick taken over every chunk, or a chunk's
// own move counted before its threshold, or the chunks walked backwards, all
// passed. This cuts the series short -- the chunks it keeps must be gated
// exactly as in the whole series -- and holds every gate to the rule itself: the
// chunk's look-back move against the multiple of the median of the moves
// strictly before it, once there are enough of them.
function aChunksGateIsWorkedOutFromTheChunksBeforeItAndNothingAfter() {
  const bw = require('../lib/bracketwork');
  const { medianAbsMove } = require('../lib/windowmove');
  const { MIN_CHUNKS } = require('../lib/pipeline');
  // a coin that is calm, then five times wilder, then calmer again. The moves
  // are spread over sixty-one sizes, not a handful: seven repeated sizes put
  // every yardstick, right or wrong, between the same two moves, so a gate
  // worked out from the wrong chunks opened on exactly the same chunks.
  const scale = (i) => (i < 120 ? 1 : (i < 240 ? 5 : 2));
  const series = () => Array.from({ length: 360 }, (_, i) => ({
    startTs: i, diffPct: 8 * ((i % 2) ? 1 : -1), label: ((i % 2) ? 1 : -1),
    backPct: [scale(i) * (0.5 + ((i * 37) % 61) / 20) * ((i % 3) ? 1 : -1)],
  }));
  const full = series();
  bw.markExtraGates(full, [150]);
  assert.ok(full.some((c) => c.extraOn[0]) && full.some((c) => !c.extraOn[0]), 'the gate opens somewhere and shuts somewhere, or this proves nothing');
  // cut short anywhere, what is kept is gated exactly as in the whole series
  for (const k of [60, 130, 250]) {
    const part = series().slice(0, k);
    bw.markExtraGates(part, [150]);
    assert.deepStrictEqual(part.map((c) => c.extraOn[0]), full.slice(0, k).map((c) => c.extraOn[0]),
      `cut at chunk ${k}, a gate before the cut changed: it was worked out from chunks after it`);
  }
  // and each gate is the rule itself, off the moves strictly before the chunk
  const seen = [];
  full.forEach((c, i) => {
    const yard = seen.length >= MIN_CHUNKS ? medianAbsMove(seen) : null;
    const want = yard > 0 && Math.abs(c.backPct[0]) > yard * 1.5;
    assert.strictEqual(c.extraOn[0], want, `chunk ${i}: the gate is not the chunk's own move against 1.5 times the median of the moves before it`);
    seen.push(c.backPct[0]);
  });
  // AND ONE CHUNK THAT TELLS THE FAULTS APART. Twelve moves of 1 and 2 put the
  // yardstick at 1.5 and the bar at 2.25, so a move of 2.3 clears it. Count
  // the chunk's own move, or take the yardstick over the whole series, and the
  // median is 2, the bar is 3, and the gate stays shut; walk the chunks from
  // the newest back and nothing is behind it at all.
  const tell = Array.from({ length: MIN_CHUNKS }, (_, i) => ({ startTs: i, diffPct: 1, label: 1, backPct: [(i % 2) ? 2 : 1] }));
  tell.push({ startTs: MIN_CHUNKS, diffPct: 1, label: 1, backPct: [2.3] });
  bw.markExtraGates(tell, [150]);
  assert.strictEqual(tell[MIN_CHUNKS].extraOn[0], true,
    'a move of 2.3 against a bar of 1.5 x 1.5 = 2.25 left the gate shut: the yardstick was taken from more than the moves before the chunk');
}

// THE YARDSTICK TRAILS, AND THAT IS THE WHOLE POINT (3.201.0, owner: "trailing").
//
// It was one median over the train stretch, held still for train, test, held
// and reserve alike. Two faults, and the second is the one that was invisible:
// it could not follow a coin whose moves grew or shrank, and it moved with the
// SPLIT -- change window layout and every chunk's answer changed, including
// chunks that were in train both times.
function theExtrasScaleIsMeasuredOnTheTrainStretchAlone() {
  const bw = require('../lib/bracketwork');
  // a coin that gets four times wilder halfway through
  const at = (i) => (i < 200 ? 1 : 4);
  const mk = () => Array.from({ length: 400 }, (_, i) => ({
    startTs: i, diffPct: 8 * ((i % 2) ? 1 : -1), label: ((i % 2) ? 1 : -1),
    backPct: [at(i) * (((i % 5) - 2) || 1)],
  }));

  // IT MOVES, AND IT MOVES THE WAY THE WALK'S DOES. The yardstick is the median
  // of every look-back move before the chunk, so it CLIMBS as the coin gets
  // wilder -- and it climbs SLOWLY, because the calm half stays in the median
  // for a long time. That lag is not a fault to fix here: it is exactly what
  // lib/coinscan.js usualMoveAt does with 'trailing', and matching the walk is
  // the whole reason this is trailing at all. A frozen yardstick would not move
  // at all.
  const chunks = mk();
  bw.markExtraGates(chunks, [150]);
  const early = chunks.slice(12, 200).filter((c) => c.extraOn[0]).length / 188;
  const late = chunks.slice(200).filter((c) => c.extraOn[0]).length / 200;
  assert.ok(late > early, `the wild half fired on ${(late * 100).toFixed(0)}% and the calm half on ${(early * 100).toFixed(0)}% — a bigger move is not clearing a bigger bar`);
  assert.ok(early > 0 || late > 0, 'the gate never fires at all, so this proves nothing');
  // and the threshold itself really is a moving number, not one held still
  const seen = [];
  const bars = [];
  for (const c of chunks) {
    const yard = seen.length >= 12 ? require('../lib/windowmove').medianAbsMove(seen) : null;
    if (yard > 0) bars.push(yard * 1.5);
    seen.push(c.backPct[0]);
  }
  assert.ok(bars[bars.length - 1] > bars[0] * 1.2,
    'the yardstick ended where it started, so it is not trailing anything');

  // AND IT DOES NOT CARE WHERE THE SPLIT FALLS. A chunk's threshold comes from
  // the chunks before it in time and from nothing else, so cutting train in a
  // different place cannot change one answer.
  const a = mk(); bw.markExtraGates(a, [150]);
  const b = mk(); bw.markExtraGates(b, [150]);
  assert.deepStrictEqual(a.map((c) => c.extraOn[0]), b.map((c) => c.extraOn[0]), 'the gate is not the same twice on the same chunks');
  assert.ok(a.every((c, i) => c.extraOn[0] === b[i].extraOn[0]), 'the answers moved');

  // THE FIRST FEW ARE NEVER GATED ON, because a median of a handful is not a
  // yardstick. They sit at the start of train, so test and held are untouched.
  assert.ok(a.slice(0, 12).every((c) => c.extraOn[0] === false), 'a chunk with almost no history behind it was gated on anyway');

  // and the answer is the unit's own on a chunk the gate opens, sit out on one
  // it shuts -- which is the walk's rule
  const split = bw.splitAndLabel(mk(), { band: 2 }, true, [150]);
  const all = split.trainChunks.concat(split.testChunks, split.holdChunks);
  assert.ok(all.every((c) => Array.isArray(c.altLabels) && c.altLabels.length === 1), 'not every chunk carries the extra\'s answer');
  assert.ok(all.every((c) => (c.extraOn[0] ? c.altLabels[0] === c.label : c.altLabels[0] === 0)),
    'the extra is not asked the unit\'s own question where its gate opens, and sit out where it shuts');
  assert.ok(all.some((c) => c.extraOn[0]) && all.some((c) => !c.extraOn[0]), 'the fixture no longer has the gate both open and shut');
}

// THE LIVE PATH CAN TRAIN A UNIT THAT TOOK A MEMBER FROM A WALK SET (3.188.0,
// owner order: "code whatever the live path needs").
//
// Live does not run the frozen models: it REBUILDS the whole committee from
// the configuration at the freeze point. Three things had no room for such a
// member, and every one of them would have stopped a greenlight dead:
//   * the allowed member kinds were full/prices/volume/pricevol/cross only
//   * the feature vector was built with no extras, so the slice did not exist
//   * a configuration carried ONE band and every member was marked with it
function theLiveConfigurationCarriesWhatAWalkSetAdded() {
  const { validateConfig } = require('../lib/live/configschema');
  const base = {
    engine: 'stages', stage: 'stages',
    combo: { trade: 'LTCUSDT', ctx1: 'ETHUSDT', ctx2: 'XRPUSDT', size: 3 },
    branch: { geometry: 'daily-4d', decision: 'argmax', band: 2.5, weekdaysOnly: false },
    agreement: { rule: 'count', bar: 'all', pct: 75, copy: 98, both: false, persist: 0 },
    cell: { quorum: null, entry: 'market', gate: 'directional', dMult: null, tHours: 65, trailMult: null, armMult: null },
    members: [{ model: 'logreg', view: 'full', at: null }],
    configVersion: 'test',
  };
  assert.ok(validateConfig(base).ok, `a plain configuration no longer validates: ${validateConfig(base).errors.join('; ')}`);
  // NO EXTRAS IS NOT AN OLD ERA, it is a unit that took nothing -- so a
  // configuration written before they existed is valid unchanged
  assert.ok(validateConfig({ ...base, extras: [] }).ok, 'an empty extras list is read as something other than "took nothing"');
  // one that took a member from a walk set
  const withOne = {
    ...base,
    extras: [{ lookbackHours: 720, bandPct: 90 }],
    members: [{ model: 'logreg', view: 'full', at: null }, { model: 'boost', view: 'extra0', at: 0 }],
  };
  const v = validateConfig(withOne);
  assert.ok(v.ok, `a unit that took a member from a walk set is refused: ${v.errors.join('; ')}`);
  // THE EXTRA'S BAND IS NOT BOUNDED BY 50. A unit's own band is a percent of
  // price and (0,50) is right for it; an extra's is a multiple of the usual
  // move and the walk sweeps them to 700. One rule for both is how the
  // multiple came to be read as a percent.
  assert.ok(validateConfig({ ...withOne, extras: [{ lookbackHours: 720, bandPct: 700 }] }).ok,
    'a multiple past 50 is refused as though it were a percent of price');
  assert.ok(!validateConfig({ ...base, branch: { ...base.branch, band: 700 } }).ok, 'the unit\'s own band is no longer held to a percent of price');
  // and the things that must still be refused
  const bad = (over, re) => {
    const out = validateConfig({ ...withOne, ...over });
    assert.ok(!out.ok && out.errors.some((e) => re.test(e)), `expected a refusal matching ${re}, got ${out.errors.join('; ') || 'no refusal'}`);
  };
  bad({ members: [{ model: 'logreg', view: 'extra1', at: 1 }] }, /extra0 to extra0/);
  bad({ extras: [{ lookbackHours: 0, bandPct: 90 }] }, /lookbackHours/);
  bad({ extras: [{ lookbackHours: 720, bandPct: -1 }] }, /not a percent of price/);
  bad({ extras: 'lots' }, /must be an array/);
  // A MEMBER SAYS WHICH EXTRA IT READS. Parsed back out of the view name it
  // would be one more place for the two to disagree about which band it is
  // marked at, which is the whole defect this release is closing.
  bad({ members: [{ model: 'logreg', view: 'full', at: null }, { model: 'boost', view: 'extra0', at: null }] }, /members\[1\]\.at: must be 0/);
  bad({ members: [{ model: 'logreg', view: 'full', at: 0 }] }, /must be null for a member that reads no extra/);
  // AND WHICH EXTRAS BELONG TOGETHER (3.203.0): absent is no plateau; a plateau
  // names extras the unit carries and its centre is one of them
  assert.ok(validateConfig({ ...withOne, plateaus: [] }).ok, 'an empty plateaus list is refused');
  assert.ok(validateConfig({ ...withOne, plateaus: [{ centre: 0, members: [0] }] }).ok, 'a plateau of one around the only extra is refused');
  bad({ plateaus: 'nine' }, /plateaus: must be an array/);
  bad({ plateaus: [{ centre: 0, members: [0, 1] }] }, /plateaus\[0\]\.members: must name extras 0 to 0/);
  bad({ plateaus: [{ centre: 1, members: [0] }] }, /plateaus\[0\]\.centre: must be one of its own members/);
  bad({ plateaus: [{ centre: 0, members: [] }] }, /plateaus\[0\]\.members/);
}

// A NEIGHBOUR TOO THIN TO TRAIN GOES SILENT, A CENTRE STILL REFUSES (3.203.0).
// The nine include a band a step higher than the walk liked, and a higher band
// opens the gate less often -- so a plateau will sometimes have a member with
// too few decisions to learn a direction from. Held on a real fit: what such
// a member becomes, that everything reads it without a branch, and that the
// centre of a plateau, being what the owner promoted, refuses as one extra
// always has.
async function aNeighbourTooThinToTrainGoesSilentAndACentreStillRefuses() {
  const sw = require('../lib/stagework');
  const bw = require('../lib/bracketwork');
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const chunks = Array.from({ length: 300 }, (_, i) => {
    const x = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
    return { startTs: Date.UTC(2024, 0, 1) + i * 86400000, x, diffPct: 4 * (x[0] - x[1]) + (rnd() - 0.5), backPct: [(rnd() * 2 - 1) * 5, (rnd() * 2 - 1) * 5] };
  });
  // extra 0 at a band the gate clears often; extra 1 at one it almost never clears
  const { trainChunks, testChunks, holdChunks } = bw.splitAndLabel(chunks, { band: 2 }, true, [100, 900]);
  const predictChunks = [...testChunks, ...holdChunks];
  const viewIdx = [0, 1, 2, 3];
  const thinSpec = { model: 'logreg', view: 'extra1', from: 'extra1', at: 1 };
  const args = { spec: thinSpec, viewIdx, trainChunks, testChunks, holdChunks, predictChunks, weights: null, weightsOf: () => null, labelOf: null, share: 60 };
  const swath = [...trainChunks, ...testChunks, ...holdChunks];
  const nOwn = Math.round(swath.length * 0.6);
  const opened = swath.slice(0, nOwn).filter((c) => c.extraOn[1]).length;
  assert.ok(opened < 12, `the fixture's thin member opens its gate on ${opened} chunks, which is not thin`);
  // refused by default, and as a centre
  await assert.rejects(() => sw.trainGatedMember({ ...args }), /too few to learn a direction from/, 'a thin extra trained anyway');
  await assert.rejects(() => sw.trainGatedMember({ ...args, whenThin: 'refuse' }), /too few to learn a direction from/);
  // silent when told so: a real member that never speaks, and says why
  const m = await sw.trainGatedMember({ ...args, whenThin: 'silent' });
  assert.strictEqual(m.saved.kind, 'silent', 'a silent member has no saved model of its own kind');
  assert.match(m.saved.why, /too few to learn a direction from/, 'and it does not say why');
  assert.strictEqual(m.silent, m.saved.why);
  assert.strictEqual(m.picked, 'not trained');
  assert.strictEqual(m.probs.length, predictChunks.length);
  assert.ok(m.probs.every((p) => p[0] === 0 && p[1] === 1 && p[2] === 0), 'a silent member spoke');
  const nVal = Math.max(3, Math.round(trainChunks.length * 0.25));
  assert.strictEqual(m.tauProbs.length, nVal, 'its tuning-slice votes are not every member\'s same slice');
  assert.ok(m.tauProbs.every((p) => p[1] === 1), 'a silent member spoke on the tuning slice');
  assert.strictEqual(m.own.chunks.length, swath.length - nOwn, 'its own reading is not over the rest of the history');
  assert.deepStrictEqual(m.own.trainedOn, opened);
  assert.ok(m.own.probs.every((p) => p[1] === 1));
  // everything that forecasts from a saved model reads it without a branch
  assert.ok(sw.forecastRows(m.saved, viewIdx, testChunks).every((p) => p[1] === 1 && p[0] === 0), 'a silent saved model does not forecast a sit out');
  const again = sw.ownReadingOf({ saved: m.saved, spec: thinSpec, viewIdx, trainChunks, testChunks, holdChunks, share: 60 });
  assert.deepStrictEqual(again.probs, m.own.probs);
  // its reading says it is silent and why
  const [r] = sw.memberReadings({ members: [{ spec: thinSpec, ...m }], specs: [thinSpec], testChunks, seed: 's', unitKey: 'u', nullN: 3, tag: 't' });
  assert.strictEqual(r.spoke, 0);
  assert.match(r.silent, /too few to learn a direction from/);
  assert.deepStrictEqual(r.trained, { chunks: opened, of: nOwn });
  // a member that is not thin is untouched by the setting
  const wide = { model: 'logreg', view: 'extra0', from: 'extra0', at: 0 };
  const a = await sw.trainGatedMember({ ...args, spec: wide, whenThin: 'silent' });
  const b = await sw.trainGatedMember({ ...args, spec: wide, whenThin: 'refuse' });
  assert.strictEqual(a.saved.kind, 'logreg'); assert.deepStrictEqual(a.probs, b.probs);
  assert.strictEqual(a.silent, undefined);
  // WHICH MEMBERS MAY GO SILENT: a plateau's neighbours, never its centre, and
  // never a lone extra
  const plats = [{ centre: 0, members: [0, 1] }];
  assert.strictEqual(sw.whenThinFor(wide, plats), 'refuse', 'a plateau\'s centre may go silent');
  assert.strictEqual(sw.whenThinFor(thinSpec, plats), 'silent', 'a neighbour is refused rather than silent');
  assert.strictEqual(sw.whenThinFor(thinSpec, []), 'refuse', 'a lone extra may go silent');
  assert.strictEqual(sw.whenThinFor({ model: 'logreg', view: 'full' }, plats), 'refuse');
  // and a plateau is checked against the extras it indexes
  const ex = [{ lookbackHours: 24, bandPct: 100 }, { lookbackHours: 24, bandPct: 900 }];
  assert.deepStrictEqual(sw.plateausOf({ plateaus: plats }, ex).map((f) => f.members), [[0, 1]]);
  assert.deepStrictEqual(sw.plateausOf({}, ex), []);
  assert.throws(() => sw.plateausOf({ plateaus: [{ centre: 0, members: [0, 2] }] }, ex), /names extras this unit does not carry/);
  assert.throws(() => sw.plateausOf({ plateaus: [{ centre: 2, members: [0, 1] }] }, ex), /names extras this unit does not carry/);
  // AND THE PLATEAUS RIDE ON EVERY RECORD THAT NEEDS THEM: the launch, both
  // stages' records, the greenlight, the live rebuild, the stage 3 refusal
  const fs = require('fs');
  const path = require('path');
  const st = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
  assert.ok(st.includes("{ ...p, extras: u.extras, plateaus: u.plateaus || [] }"), 'a stage 1 unit is not told its plateaus');
  assert.ok(st.includes("{ ...p, extras: rec.extras, plateaus: rec.plateaus || [] }"), 'a stage 2 unit is not told its plateaus');
  assert.ok(st.includes('plateaus: res.plateaus && res.plateaus.length ? res.plateaus : null,'), 'the stage 1 record drops the plateaus');
  assert.ok(st.includes('plateaus: (rec.plateaus || []).length ? rec.plateaus : null,'), 'the stage 2 record drops the plateaus');
  assert.ok(/plateaus: \(rec\.plateaus \|\| \[\]\)\.map\(\(f\) => \(\{ centre: f\.centre, members: \(f\.members \|\| \[\]\)\.slice\(\) \}\)\) \}/.test(st), 'the greenlight is never told the plateaus');
  assert.ok(!/does not fold a plateau to one vote/.test(st), 'stage 3 still refuses a set with plateaus (3.205.0 folds them)');
  assert.ok(/plateaus: unit\.plateaus \|\| \[\], speaking \}\);/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'stagework.js'), 'utf8')), 'the stage 3 task does not fold the plateaus it is told');
  assert.ok(st.includes("plateaus: Array.isArray((x || {}).plateaus) ? (x || {}).plateaus : [],"), 'a relaunch from a record drops the plateaus');
  assert.ok(st.includes("({ ...u, extras: [], plateaus: [] })"), 'the control arm keeps the plateaus it dropped the extras of');
  const live = fs.readFileSync(path.join(__dirname, '..', 'lib', 'live', 'stagesignal.js'), 'utf8');
  assert.ok(/whenThin: sw\.whenThinFor\(\{ at \}, plateaus\),/.test(live), 'the live rebuild refuses a thin neighbour the set priced as silent');
  const gl = fs.readFileSync(path.join(__dirname, '..', 'lib', 'live', 'greenlight.js'), 'utf8');
  assert.ok(/plateaus: \(\(src\.unit \|\| \{\}\)\.plateaus \|\| \[\]\)\.map/.test(gl), 'a greenlight drops which extras belong together');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  assert.ok(/>plateau<\/th>/.test(ui) && ui.includes('${r.plateau ? `${r.plateau.size} of ${r.plateau.of}` : '), 'Coins does not say how big each promoted row\'s plateau is');
}

// AND THE THREE PLACES THAT REBUILD IT ARE WIRED (3.188.0). Source-scanned,
// because each is one line in a path that cannot be run without the box's
// candle cache -- and a line missing from any one of them is a committee that
// silently loses what the walk found.
function theLivePathBuildsMarksAndTrainsTheExtraMember() {
  const fs = require('fs');
  const path = require('path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'lib', 'live', f), 'utf8');
  const sig = read('signal.js');
  // the columns exist
  assert.ok(/const params = \{ allLoaded: true, feePerLeg: fee, includeUnlabeled: true, extras \};/.test(sig),
    'the live chunks are built without the extras, so their numbers are not in the vector');
  assert.ok(/bracketLib\.comboViews\(cfg\.combo\.size, geo\.featureHours \/ 24, extras\.length\)\.views/.test(sig),
    'the live slices are worked out without the extras, so a member added from a walk set has nothing to read');
  // the answers, and each member on the question it was asked
  const st = read('stagesignal.js');
  assert.ok(/splitAndLabel\(closed, \{ \.\.\.cfg\.branch, band: cfg\.branch\.band \}, true, extras\.map\(\(e\) => e\.bandPct\)\)/.test(st),
    'the live splitter is not given the extras\' bands, so no member has its own answers to learn');
  // THE GATE IS APPLIED LIVE TOO, AND THE SAME WAY (3.201.0). The walk's finding
  // is no longer a different set of answers to learn -- it is a gate on WHEN the
  // member may speak, applied and never learned. Live rebuilds the whole
  // committee from the configuration, so a member built here has to be the
  // member the sweep priced: trained on the chunks its band opens and forced to
  // sit out on the rest. Built any other way the live committee speaks at a
  // different rate from the one the evidence is about.
  assert.ok(/await sw\.trainGatedMember\(\{/.test(st),
    'the live path trains the extra without its gate, so it speaks at a rate no evidence covers');
  assert.ok(/spec: \{ model: spec\.model, at \}, viewIdx, trainChunks, testChunks, holdChunks, predictChunks, weights,/.test(st),
    'the live extra is not handed the whole closed history, so it cannot train on its share of it');
  // AND ON THE SET'S OWN SPLIT (3.202.0), weighed over whatever rows that gives it
  assert.ok(/weightsOf: \(rows\) => trainingWeightsFor\(training, rows, fee\), share: training\.extraTrainShare, labelOf: null,/.test(st),
    'the live extra is not trained on the split the set recorded, so the live committee is not the one the evidence is about');
  assert.ok(/extraTrainShare: p1\.extraTrainShare \?\? null,/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8')),
    'the greenlight is never told the split, so live cannot cut the history the way the set did');
  assert.ok(!/const labelOf = at == null \? null : \(c\) => \(c\.altLabels \|\| \[\]\)\[at\];/.test(st),
    'the live path still marks an extra against a different set of answers');

  assert.ok(/if \(!viewIdx\) throw new Error\(`live signal: this unit has no slice called/.test(st),
    'a member naming a slice this unit does not have trains on nothing instead of refusing');
  // THE MULTIPLE TRAVELS, NOT THE PERCENT. Live resolves it against its own
  // training stretch the way stage 1 did against its; handing over the percent
  // stage 1 arrived at would have the two marking at different thresholds the
  // moment the windows differed.
  const gl = read('greenlight.js');
  assert.ok(/extras: \(\(src\.unit \|\| \{\}\)\.extras \|\| \[\]\)\.map\(\(e\) => \(\{ lookbackHours: Number\(e\.lookbackHours\), bandPct: Number\(e\.bandPct\) \}\)\)/.test(gl),
    'a greenlight drops what the unit took from a walk set');
  assert.ok(/members: src\.members\.map\(\(m\) => \(\{ model: m\.model, view: m\.view, at: m\.at \?\? null \}\)\)/.test(gl),
    'a greenlight drops which extra each member reads');
  assert.ok(/were added from a walk set and the record does not carry the look-back and band they were built with/.test(gl),
    'a record that cannot say what its extra members read is greenlighted anyway');
  // and the stage 3 set hands both along
  const stages = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
  assert.ok(stages.includes('extras: (rec.extras || []).map((e) => ({ lookbackHours: e.lookbackHours, bandPct: e.bandPct })),'),
    'the greenlight is never told what the unit took from a walk set');
  assert.ok(/members: \(rec\.specs \|\| \[\]\)\.map\(\(sp\) => \(\{ model: sp\.model, view: sp\.view, at: sp\.at \?\? null \}\)\)/.test(stages),
    'the greenlight is never told which extra each member reads');
  // AND BOTH TRADE BRANCHES SAY SO, through the one path (RULE TWO): the row is
  // outside every `branch === 'paper'` test on the page, so Paper Books and
  // Live Trading cannot come to describe the same unit differently.
  const trade = fs.readFileSync(path.join(__dirname, '..', 'public', 'trade.html'), 'utf8');
  assert.ok(/cfgRow\('From a walk set',/.test(trade), 'neither Trade branch says what a unit took from a walk set');
  const row = trade.indexOf("cfgRow('From a walk set'");
  const guarded = [...trade.matchAll(/branch === 'paper'|isPaper/g)].some((m) => Math.abs(m.index - row) < 900);
  assert.ok(!guarded, 'the row sits inside a branch test, so one Trade branch can show it and the other not');
}

// AN EXTRA TRAINS ON ITS OWN SHARE OF THE WHOLE HISTORY AND IS READ ON THE REST
// (3.202.0, owner order: "trained fifty fifty or ... sixty forty using the
// entire history swath"). Every claim the design makes, held on a real fit:
// where it trains, where it is read, that its committee votes are the same
// votes, that the tuning slice and the probe stay honest, that stage 2 can
// read it again from the saved model vote for vote, and what it refuses.
async function anExtraTrainsOnItsShareOfTheWholeHistoryAndIsReadOnTheRest() {
  const sw = require('../lib/stagework');
  const bw = require('../lib/bracketwork');
  // a deterministic coin: four numbers a chunk, an outcome leaning on the
  // first two, and a look-back move for the gate to read
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const N = 480;
  const chunks = Array.from({ length: N }, (_, i) => {
    const x = [rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1];
    return { startTs: Date.UTC(2024, 0, 1) + i * 86400000, x, diffPct: 4 * (x[0] - x[1]) + (rnd() - 0.5), backPct: [(rnd() * 2 - 1) * 5] };
  });
  const { trainChunks, testChunks, holdChunks } = bw.splitAndLabel(chunks, { band: 2 }, true, [100]);
  const predictChunks = [...testChunks, ...holdChunks];
  const swath = [...trainChunks, ...testChunks, ...holdChunks];
  const spec = { model: 'logreg', view: 'extra0', from: 'extra0', at: 0 };
  const viewIdx = [0, 1, 2, 3];
  const weightsOf = (rows) => rows.map((c) => 1 + Math.abs(c.diffPct) / 10);
  const args = { spec, viewIdx, trainChunks, testChunks, holdChunks, predictChunks, weights: null, weightsOf, labelOf: null };
  const m = await sw.trainGatedMember({ ...args, share: 60 });
  const nOwn = Math.round(swath.length * 0.6);
  assert.ok(nOwn < trainChunks.length, 'the fixture has the split reaching the test window, so it proves nothing');
  // WHERE IT TRAINS AND WHERE IT IS READ: the first 60% of everything, the rest
  assert.strictEqual(m.own.chunks.length, swath.length - nOwn, 'the member is not read on the rest of the whole history');
  assert.strictEqual(m.own.chunks[0], swath[nOwn], 'its reading does not start where its training share ends');
  assert.strictEqual(m.own.ofChunks, nOwn, 'its training share is not 60% of the whole history');
  assert.strictEqual(m.own.trainedOn, swath.slice(0, nOwn).filter((c) => c.extraOn[0]).length, 'it did not train on exactly the gated chunks of its share');
  assert.strictEqual(m.own.share, 60);
  // ITS COMMITTEE VOTES ARE STILL ON THE SYSTEM'S OWN WINDOWS, and gated there
  assert.strictEqual(m.probs.length, predictChunks.length, 'the committee votes are not over the test and held-back windows');
  predictChunks.forEach((c, k) => { if (!c.extraOn[0]) assert.deepStrictEqual(m.probs[k], [0, 1, 0], 'a shut gate did not force a sit out on the committee vote'); });
  m.own.chunks.forEach((c, k) => {
    if (!c.extraOn[0]) assert.deepStrictEqual(m.own.probs[k], [0, 1, 0], 'a shut gate did not force a sit out on its own reading');
    // (the votes are kept to four places, so the three sum to one within that)
    else assert.ok(Math.abs(m.own.probs[k].reduce((a, b) => a + b, 0) - 1) < 1e-3 && m.own.probs[k][1] !== 1, 'an open gate did not get a real forecast');
  });
  // THE SAME VOTE ON THE SAME CHUNK, whichever list it is read from
  const at = m.own.chunks.indexOf(predictChunks[0]);
  assert.ok(at >= 0, 'the test window is not inside what the member is read on');
  predictChunks.forEach((c, k) => assert.deepStrictEqual(m.own.probs[at + k], m.probs[k], 'the member votes one way for the committee and another for its own reading'));
  // THE TUNING SLICE IS THE SYSTEM'S, and the probe never fitted on it
  const nVal = Math.max(3, Math.round(trainChunks.length * 0.25));
  assert.strictEqual(m.tauProbs.length, nVal, 'its tuning-slice votes are not on every member\'s same slice');
  const tuneFrom = trainChunks[trainChunks.length - nVal].startTs;
  const keep = m.own.trainedOn;
  const before = swath.slice(0, nOwn).filter((c) => c.extraOn[0] && c.startTs < tuneFrom).length;
  assert.ok(before < keep, 'the fixture has no gated training chunk inside the tuning slice, so the probe cut is untested');
  assert.strictEqual(m.nSub, Math.min(keep - Math.max(3, Math.round(keep * 0.25)), before), 'the probe fitted on rows inside the slice it votes on, or on fewer than it may');
  // STAGE 2 READS IT AGAIN FROM THE SAVED MODEL, vote for vote
  const again = sw.ownReadingOf({ saved: m.saved, spec, viewIdx, trainChunks, testChunks, holdChunks, share: 60 });
  assert.deepStrictEqual(again.probs, m.own.probs, 'the saved model does not give back the votes the fit gave');
  assert.strictEqual(again.chunks.length, m.own.chunks.length);
  // AND ITS READING IS TAKEN THERE, and says where
  const [r] = sw.memberReadings({ members: [{ spec, ...m }], specs: [spec], testChunks, seed: 's', unitKey: 'u', nullN: 3, tag: 't' });
  assert.strictEqual(r.chunks, m.own.chunks.length, 'its reading is still over the test window alone');
  assert.strictEqual(r.read.share, 60);
  assert.strictEqual(r.read.fromTs, swath[nOwn].startTs);
  assert.strictEqual(r.read.toTs, swath[swath.length - 1].startTs);
  assert.strictEqual(r.read.chunks, m.own.chunks.length);
  assert.deepStrictEqual(r.trained, { chunks: keep, of: nOwn });
  assert.ok(r.spoke <= m.own.chunks.filter((c) => c.extraOn[0]).length, 'it spoke on a decision its gate shut');
  // A BASE MEMBER IS READ WHERE IT ALWAYS WAS
  const base = await sw.trainProbMember({ model: 'logreg', viewIdx, trainChunks, predictChunks });
  const bspec = { model: 'logreg', view: 'full' };
  const [b] = sw.memberReadings({ members: [{ spec: bspec, ...base }], specs: [bspec], testChunks, seed: 's', unitKey: 'u', nullN: 3, tag: 't' });
  assert.strictEqual(b.chunks, testChunks.length, 'a base member is no longer read on the test window');
  assert.strictEqual(b.read.share, null);
  assert.strictEqual(b.read.fromTs, testChunks[0].startTs);
  assert.strictEqual(b.trained, null);
  // THE OTHER CHOICE CUTS WHERE IT SAYS
  const half = await sw.trainGatedMember({ ...args, share: 50 });
  assert.strictEqual(half.own.chunks.length, swath.length - Math.round(swath.length * 0.5), '50/50 did not halve the history');
  // AND WHAT IT REFUSES: no split, a split reaching the test window, no way to weigh its rows
  await assert.rejects(() => sw.trainGatedMember({ ...args }), /has no split to train on/, 'a missing split trained on something anyway');
  await assert.rejects(() => sw.trainGatedMember({ ...args, share: 90 }), /into the test window/, 'a split reaching the test window was accepted');
  await assert.rejects(() => sw.trainGatedMember({ ...args, weightsOf: null, share: 60 }), /weightsOf/, 'an extra was trained without being told how to weigh its own rows');
  // a base member is untouched by any of it
  const plain = await sw.trainGatedMember({ spec: bspec, viewIdx, trainChunks, predictChunks, weights: null, labelOf: null });
  assert.deepStrictEqual(plain.probs, base.probs, 'a base member came out different through trainGatedMember');
  assert.strictEqual(plain.own, undefined, 'a base member grew a reading of its own');
}

// THE SPLIT IS THE OWNER'S CHOICE, IT IS REFUSED RATHER THAN COERCED, AND IT
// RIDES ON EVERY RECORD THAT NEEDS IT (3.202.0).
function theSplitIsTheOwnersChoiceAndRidesOnEveryRecord() {
  const fs = require('fs');
  const path = require('path');
  const S = require('../lib/stages');
  const { vocabulary } = require('../lib/vocabulary');
  const offered = (vocabulary().extraTrainShare || []).map((o) => o);
  assert.deepStrictEqual(offered.map((o) => o.label), ['60/40', '50/50'], 'the box does not offer 60/40 first and 50/50 second');
  assert.deepStrictEqual(offered.map((o) => Number(o.value)), [60, 50], 'the values are not the training share in percent');
  assert.throws(() => S.startStage1({ sizes: { singles: true }, fee: 0.05, name: 'x', extraTrainShare: 70 }),
    /is not a split for extra members \(60\/40 or 50\/50\)/, 'a share the box does not offer was accepted');
  assert.throws(() => S.startStage1({ sizes: { singles: true }, fee: 0.05, name: 'x', extraTrainShare: 'half' }),
    /is not a split for extra members/, 'a word was accepted as a share');
  assert.strictEqual(S.publicParams({ params: { extraTrainShare: 60 } }).extraTrainShare, 60, 'the split is not served to the page');
  assert.strictEqual(S.publicParams({ params: {} }).extraTrainShare, null, 'a set made before the split reads as having one');
  const st = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
  const launch = st.slice(st.indexOf('function startStage1(params) {'), st.indexOf('const units = unitsFor('));
  assert.ok(/windowLayout,\n    extraTrainShare,/.test(launch), 'the split never reaches the workers, so the box does nothing');
  // what stage 2 trains under is read off its parent's params in one place since 3.269.0 (s2TrainingOf)
  assert.ok(st.includes('extraTrainShare: pp.extraTrainShare,') && st.includes('const p = s2TrainingOf(parent.params);'), 'stage 2 does not inherit the split, so the two halves of a committee could be cut differently');
  assert.ok(/was made before the split for extra members existed/.test(st), 'a parent from before the split is carried to stage 2 and half its committees cut the other way');
  assert.ok(st.includes('saved,') && /const saved = hasExtras \? rec\.specs\.map/.test(st), 'the parent\'s saved models do not ride to stage 2, so its extras cannot be read on their own stretch there');
  // the screen: the box, the launch, the restore, the provenance row, and the
  // tick beside it bottom-aligned (RULE FOUR-A)
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  assert.ok(/<label class="f" title="[^"]*">split for extra members<select id="swExtraShare">\$\{vocabOptions\('extraTrainShare', '60'\)\}<\/select><\/label>/.test(ui),
    'the Sweep screen has no split for extra members box, or it does not default to 60/40');
  const row = ui.slice(ui.lastIndexOf('<div class="row"', ui.indexOf('id="swExtraShare"')), ui.indexOf('id="swExtraShare"'));
  assert.ok(row.includes('align-items:flex-end') && row.includes('id="swPlainUnits"'), 'the split box does not share a bottom-aligned row with the tick it belongs beside');
  assert.ok(ui.includes("extraTrainShare: Number($('#swExtraShare').value),"), 'the launch does not send the split');
  assert.ok(ui.includes("setV('#swExtraShare', p.extraTrainShare == null ? '60' : String(p.extraTrainShare));"), 'loading a set back into the boxes drops its split');
  // (the box-by-box comparison of the stage headings went in 3.241.0: every section now shows the set its own box names, filled from it)
  assert.ok(/\$\('#swExtraShare'\)\.disabled = !walk \|\| plain;/.test(ui) && /\$\('#swPlainUnits'\)\.disabled = !walk;/.test(ui) && /const walk = swSourceNow\(\) === 'walk';/.test(ui),
    'the split box and the control arm are live under a Coins choice that adds no extra members (3.204.1: only the walk set does)');
  // the members panel says where each member trained and was read
  const panel = ui.slice(ui.indexOf('function bMembersPanel('), ui.indexOf('function bMembersBtn('));
  for (const col of ['>trained on</th>', '>read on</th>']) assert.ok(panel.includes(col), `the members table has no ${col} column`);
  assert.ok(panel.includes('m.trained.chunks') && panel.includes('m.read.fromTs'), 'the two columns are drawn and never filled');
  assert.ok(/colspan="14"/.test(panel), 'the empty row does not span the columns');
  const help = fs.readFileSync(path.join(__dirname, '..', 'public', 'help-content.js'), 'utf8');
  assert.ok(/swExtraShare: \{/.test(help), 'the split box has no help entry');
}

module.exports = {
  aNeighbourTooThinToTrainGoesSilentAndACentreStillRefuses,
  anExtraTrainsOnItsShareOfTheWholeHistoryAndIsReadOnTheRest,
  theSplitIsTheOwnersChoiceAndRidesOnEveryRecord,
  anExtrasBandIsAMultipleOfTheUsualOutcomeMove,
  theExtrasScaleIsMeasuredOnTheTrainStretchAlone,
  aChunksGateIsWorkedOutFromTheChunksBeforeItAndNothingAfter,
  theLiveConfigurationCarriesWhatAWalkSetAdded,
  theLivePathBuildsMarksAndTrainsTheExtraMember,
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
