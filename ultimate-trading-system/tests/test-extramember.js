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
  const train = [0.5, -1, 2, -2.5, 3, -1.5, 1, -4, 2.2, -0.8].map((d) => ({ diffPct: d }));
  const usual = medianAbsMove(train.map((c) => c.diffPct));
  assert.ok(usual > 1 && usual < 3, `the fixture's usual outcome move is ${usual}%, which is not the scale this test is written around`);
  // the multiple times the usual move, and nothing else
  for (const m of [10, 90, 300]) {
    assert.ok(Math.abs(bw.extraBandPctsFor(train, [m])[0] - usual * (m / 100)) < 1e-12,
      `a multiple of ${m} does not come out as ${m / 100} times the usual move`);
  }
  // AND IT IS NOT THE RAW NUMBER ANY MORE. This is the whole defect: read as a
  // percent of price, a multiple of 90 is a 90% move and nothing is ever up or down.
  assert.notStrictEqual(bw.extraBandPctsFor(train, [90])[0], 90, 'the walk\'s multiple is still being read as a percent of price');
  assert.ok(bw.extraBandPctsFor(train, [90])[0] < 5, 'a nine-tenths-of-usual band came out bigger than any move this coin makes');
  // several at once, in the unit's own order
  assert.deepStrictEqual(bw.extraBandPctsFor(train, [100, 200]).map((b) => Number(b.toFixed(6))),
    [Number(usual.toFixed(6)), Number((usual * 2).toFixed(6))], 'two extras do not come out in the order the unit carries them');
  assert.deepStrictEqual(bw.extraBandPctsFor(train, []), [], 'a unit with no extras is given a band it did not ask for');
  // A COIN WITH NO TYPICAL MOVE AT ALL REFUSES rather than marking everything
  // as up or down on a band of nought
  assert.throws(() => bw.extraBandPctsFor([{ diffPct: 0 }, { diffPct: 0 }], [90]), /no typical move at all/);
  // and the refusals that were already there still are
  assert.throws(() => bw.extraBandPctsFor(train, ['auto']), /never auto/);
  assert.throws(() => bw.extraBandPctsFor(train, [0]), /above nought/);
}

// AND THE SCALE COMES OFF THE TRAIN STRETCH ALONE (3.188.0). Test, held and
// reserve are all marked with a number none of them had any part in choosing --
// the same discipline `auto` already uses for a unit's own band. The multiple
// is declared in advance by the walk, so this is not a fitted band.
function theExtrasScaleIsMeasuredOnTheTrainStretchAlone() {
  const bw = require('../lib/bracketwork');
  const { medianAbsMove } = require('../lib/windowmove');
  // THE FIXTURE HAS TO TELL THE TWO APART, and a median is robust, so "calm
  // then wild" does not: with train the larger stretch its median IS the whole
  // set's median and a check on it proves nothing. The mutation guard found
  // this test passing while the scale was read off every chunk.
  //
  // So: train is half at 1 and half at 3, and the later stretch is all 1.
  // Train's own median is 2; every chunk's median is 1. One number cannot be
  // mistaken for the other.
  const at = (i) => (i < 140 ? 1 : (i < 280 ? 3 : 1));
  const chunks = Array.from({ length: 400 }, (_, i) => ({ startTs: i, diffPct: at(i) * ((i % 2) ? 1 : -1) }));
  const split = bw.splitAndLabel(chunks, { band: 2 }, true, [100]);
  assert.strictEqual(split.trainChunks.length, 280, 'the fixture no longer splits where this test is written around');
  assert.strictEqual(medianAbsMove(split.trainChunks.map((c) => c.diffPct)), 2, 'train\'s own usual move is not 2, so this proves nothing');
  assert.strictEqual(medianAbsMove(chunks.map((c) => c.diffPct)), 1, 'every chunk\'s usual move is not 1, so the two cannot be told apart');
  assert.ok(Math.abs(split.extraBandPcts[0] - 2) < 1e-9,
    `the band came out at ${split.extraBandPcts[0]} and train's own usual move is 2 — a later window helped choose the threshold it is then judged at`);
  // and every chunk IS marked, train, test and held alike, at that one number
  assert.ok(chunks.every((c) => Array.isArray(c.altLabels) && c.altLabels.length === 1), 'not every chunk carries the extra\'s answer');
  assert.ok(chunks.slice(140, 280).every((c) => c.altLabels[0] !== 0),
    'a move of 3 came out as sit out at a band of 2');
  assert.ok(chunks.slice(0, 140).every((c) => c.altLabels[0] === 0), 'a move of 1 came out as up or down at a band of 2');
  assert.ok(chunks.slice(280).every((c) => c.altLabels[0] === 0),
    'the later stretch moves 1 and the band is 2, so it should all be sit out — it is not, so the band is not the number this test thinks');
  // a multiple that puts the band under the moves marks them, so the band is
  // really being read and not just returned
  const marked = Array.from({ length: 400 }, (_, i) => ({ startTs: i, diffPct: at(i) * ((i % 2) ? 1 : -1) }));
  bw.splitAndLabel(marked, { band: 2 }, true, [10]);
  assert.ok(marked.every((c) => c.altLabels[0] !== 0), 'at a fifth of the usual move every chunk still came out as sit out');
  // the same through the pass splitter, which the five passes use
  const forPass = Array.from({ length: 400 }, (_, i) => ({ startTs: i, diffPct: at(i) * ((i % 2) ? 1 : -1) }));
  const passed = bw.splitAndLabelPass(forPass, { band: 2 }, 280, 40, [100]);
  assert.ok(Math.abs(passed.extraBandPcts[0] - 2) < 1e-9,
    `the pass splitter resolved the extra's band as ${passed.extraBandPcts[0]}, not off its own train stretch`);
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
  assert.ok(/const labelOf = at == null \? null : \(c\) => \(c\.altLabels \|\| \[\]\)\[at\];/.test(st),
    'every live member is marked against the unit\'s own band, so the walk\'s finding is thrown away');
  assert.ok(/trainProbMember\(\{ model: spec\.model, viewIdx, trainChunks, predictChunks, weights, labelOf \}\)/.test(st),
    'the live training is not handed the member\'s own answers');
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
  assert.ok(/extras: \(rec\.extras \|\| \[\]\)\.map\(\(e\) => \(\{ lookbackHours: e\.lookbackHours, bandPct: e\.bandPct \}\)\) \}/.test(stages),
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

module.exports = {
  anExtrasBandIsAMultipleOfTheUsualOutcomeMove,
  theExtrasScaleIsMeasuredOnTheTrainStretchAlone,
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
