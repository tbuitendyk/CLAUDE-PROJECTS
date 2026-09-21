// THE DECISION FIELD'S SETS ON DISK, AND THE BUILD'S DOORS (FIELD-DESIGN.md
// section E; owner LOOP NOW! 2026-09-21). These go through the real files
// in data/fields, as the walk set's tests do: a store only ever checked by
// scanning its source is a store nobody has opened. EVERY TEST CREATES ITS
// OWN SETS AND DELETES THEM IN A finally, and never touches one it did not
// create.
const { assert } = require('./helpers');
const fs = require('fs');
const path = require('path');

const aPair = (over = {}) => ({
  key: 'ZZZQAUSDT|daily-1d', coin: 'ZZZQAUSDT', geometry: 'daily-1d', standsFor: ['daily-2d'],
  decisions: 5, firstTs: 1, lastTs: 5, windowDays: 3, capDays: 3, fullAt: 4,
  fill: { copies: 2, slidesAsGood: 1, scramblesAsGood: 0 },
  state: { ts: 5, sign: 1, agreement: 60, size: 1.2, certainty: 50, speaking: 2, evidence: 4, full: true, daysInWindow: 3, decisionsInWindow: 3, yardsticks: [1], pointsWithEvidence: { rising: 1, falling: 1, of: 2 } },
  range: { days: 3, silentDays: 0, agreement: { lowest: 0, quarter: 30, median: 60, threeQuarters: 60, highest: 60 }, certainty: null },
  grid: [[{ rising: { avg: 1, evidence: 2 }, falling: null }, { rising: null, falling: { avg: -1, evidence: 2 } }]],
  readingToday: [{ sign: 1, bandsCleared: 1 }],
  days: { ts: [1, 2, 3, 4, 5], sign: [0, 0, 1, 1, 1], agreement: [0, 0, 100, 60, 60], size: [0, 0, 1, 1.2, 1.2], certainty: [null, null, 50, 50, 50], speaking: [0, 0, 1, 2, 2], evidence: [0, 0, 2, 4, 4], full: [0, 0, 0, 1, 1] },
  ...over,
});
const DIALS = { windowDays: 3, halfLifeDays: 2, floor: 0.1, bands: [50, 100], lookbackHours: [24], lookbackDays: [1], evidenceCap: 30, leastEvidence: 1, copies: 2, windowEachOwn: false };

function aFinishedBuildIsWrittenDownAndReadsBackWhole() {
  const fset = require('../lib/fieldset');
  const got = fset.saveField({ asked: { name: 'x' }, dials: DIALS, cap: { days: 3, coin: 'ZZZQAUSDT' }, collapse: [], pairs: [aPair()], startedAt: 1, finishedAt: 2, name: 'zzz field test' });
  try {
    assert(/^F-\d+$/.test(got.id), 'a field takes an F-n id');
    const doc = fset.readField(got.id);
    assert.strictEqual(doc.name, 'zzz field test');
    assert.strictEqual(doc.pairs.length, 1);
    assert.deepStrictEqual(doc.dials, DIALS, 'the dials it was built under travel with it');
    assert.strictEqual(doc.release, require('../package.json').version, 'and the release that built it');
    const listed = fset.listFields().find((w) => w.id === got.id);
    assert(listed && listed.pairs === 1 && listed.dials.windowDays === 3, 'the list carries the head, the count and the dials');
    assert(listed.briefs[0].state.sign === 1 && !listed.briefs[0].days && !listed.briefs[0].grid, 'the list carries each pair briefly, never its series or its grid');
    // the pair that stands for another shape is found under that shape too
    assert.strictEqual(fset.pairFor(doc, 'zzzqausdt', 'daily-2d').key, 'ZZZQAUSDT|daily-1d', 'a shape a pair stands for reads that pair');
    assert.strictEqual(fset.pairFor(doc, 'ZZZQAUSDT', 'weekly-8d'), null, 'and a shape nobody built is nothing');
    const days = fset.daysOf(doc.pairs[0]);
    assert.strictEqual(days.length, 5);
    assert.strictEqual(days[3].agreement, 60);
    assert.strictEqual(days[3].full, true);
    assert.strictEqual(require('../lib/field').readAt(days, 4.5).ts, 4, 'the series reads by instant');
    // rename, refusals in words
    assert.strictEqual(fset.renameField(got.id, 'zzz renamed').name, 'zzz renamed');
    let msg = '';
    try { fset.renameField(got.id, ''); } catch (err) { msg = err.message; }
    assert(msg.includes('needs a name'), msg);
  } finally {
    fset.deleteField(got.id, got.id);
  }
  assert.strictEqual(fset.readField(got.id), null, 'deleted');
}

function deletingTakesTwoStepsAndTheSecondNeedsTheId() {
  const fset = require('../lib/fieldset');
  const got = fset.saveField({ asked: {}, dials: DIALS, cap: null, collapse: [], pairs: [aPair()], startedAt: 1, finishedAt: 2, name: 'zzz delete test' });
  try {
    const look = fset.deleteField(got.id);
    assert(look.preview && look.confirmWith === got.id && look.pairs === 1, 'the first press previews and names the id to type');
    assert(fset.readField(got.id), 'nothing went');
    const wrong = fset.deleteField(got.id, 'F-999999');
    assert(wrong.preview, 'a wrong id previews again and deletes nothing');
  } finally {
    const done = fset.deleteField(got.id, got.id);
    assert(done.deleted, 'the id typed back deletes');
  }
}

function aStoppedBuildIsNotAFieldButIsNotThrownAwayEither() {
  const fset = require('../lib/fieldset');
  const id = fset.nextId();
  fset.startPart(id, { name: 'zzz part test', startedAt: 1, of: 2, asked: {}, dials: DIALS, cap: null, collapse: [], release: 'x' });
  try {
    fset.appendPart(id, [aPair()]);
    assert.strictEqual(fset.readField(id), null, 'a part is not a set');
    const un = fset.unfinishedFields().find((u) => u.id === id);
    assert(un && un.pairs === 1 && un.of === 2, 'it is listed as unfinished with what it holds');
    assert(fset.partKeys(id).has('ZZZQAUSDT|daily-1d'), 'and its keys say what not to build again');
    // a torn last line is a pair not yet done
    fs.appendFileSync(fset.partFile(id), '{"key":"torn');
    assert.strictEqual(fset.readPart(id).pairs.length, 1, 'a torn line is dropped, never guessed at');
    const sealed = fset.sealPart(id, { finishedAt: 3, name: 'zzz sealed' });
    assert(sealed.id === id && sealed.pairs === 1, 'sealing makes the set under the same id');
    assert(!fs.existsSync(fset.partFile(id)), 'and the part goes');
    assert(!fset.unfinishedFields().some((u) => u.id === id), 'so it is unfinished no longer');
  } finally {
    fset.removePart(id);
    if (fset.readField(id)) fset.deleteField(id, id);
  }
}

// THE DIALS THE SCREEN SENDS: a window above the system maximum is refused in
// words that say the maximum and the coin that sets it; each coin's own passes
// the same number through; look-backs typed in days are read in hours.
function theWindowIsHeldToTheTrainStretchOfTheShortestHistory() {
  const run = require('../lib/fieldrun');
  const cap = { system: { days: 1335, coin: 'ZZZQAUSDT', firstTs: Date.UTC(2020, 8, 23) }, perCoin: {} };
  const opts = { windowDays: 1500, halfLifeDays: 500, floor: 0.1, bands: '10,20', lookbackDays: '1, 3', evidenceCap: 30, leastEvidence: 3, copies: 5 };
  let msg = '';
  try { run.dialsFrom(opts, cap); } catch (err) { msg = err.message; }
  assert(msg.includes('1500') && msg.includes('1335') && msg.includes('ZZZQAUSDT') && msg.includes('2020-09-23'), `the refusal names the number, the most, the coin and its first day: ${msg}`);
  const ok = run.dialsFrom({ ...opts, windowDays: 1335 }, cap);
  assert.strictEqual(ok.windowDays, 1335);
  assert.deepStrictEqual(ok.lookbackHours, [24, 72], 'days become hours');
  assert.deepStrictEqual(ok.lookbackDays, [1, 3]);
  const own = run.dialsFrom({ ...opts, windowEachOwn: true }, cap);
  assert(own.windowEachOwn === true && own.windowDays === 1335, "each coin's own carries the system number as the default and the flag");
  let none = '';
  try { run.dialsFrom(opts, { system: null, perCoin: {} }); } catch (err) { none = err.message; }
  assert(none.includes('Read these coins'), 'with no coin read the refusal says what to press');
}

// THE TRAIN STRETCH IN DAYS is read off a coin's own daily record under the
// sealed layout, from the first decision to the last train one, never typed.
function theCapIsReadOffTheRecordsUnderTheSealedLayout() {
  const run = require('../lib/fieldrun');
  const coins = require('../lib/coins');
  const n = 1000;
  const ts = Array.from({ length: n }, (_, i) => Date.UTC(2020, 0, 1) + i * 86400000);
  const got = run.trainDaysOf({ periods: n, ts });
  const lp = coins.layoutParts(n, 'reserve61');
  const tr = lp.parts.find((q) => q.name === 'train');
  assert.strictEqual(got.days, tr.to, `the train stretch of ${n} daily decisions is its last train index in days (${tr.to}), got ${got.days}`);
  assert.strictEqual(got.firstTs, ts[0]);
  const cap = run.capOf([
    { coin: 'ZZZQAUSDT', read: true, shapes: { 'daily-1d': { periods: n, ts } } },
    { coin: 'ZZZQBUSDT', read: true, shapes: { 'daily-1d': { periods: 400, ts: ts.slice(0, 400) } } },
  ]);
  assert.strictEqual(cap.system.coin, 'ZZZQBUSDT', 'the shortest history sets the system maximum');
  assert(cap.perCoin.ZZZQAUSDT.days > cap.perCoin.ZZZQBUSDT.days, 'and each coin keeps its own');
}

// THE POOL CAN ACTUALLY RUN IT, on both its paths.
function thePoolKnowsTheFieldOnBothItsPaths() {
  const pool = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pool.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '..', 'lib', 'worker.js'), 'utf8');
  assert(/coinField: require\('\.\/field'\)\.fieldTask,/.test(pool), 'the inline path runs the build');
  assert(/coinField: require\('\.\/field'\)\.fieldTask,/.test(worker), 'and so does a worker thread');
  // and the build is named to the one predicate every heavy press is gated on
  const coinsrun = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsrun.js'), 'utf8');
  assert(/require\('\.\/fieldrun'\)\.fieldOwnBusy\(\)/.test(coinsrun), 'coinsOwnBusy names the field build, so stageBusy covers it');
}

// THE TASK'S ANSWER IS WHAT THE SET STORES: columns, the state, the grid, the
// range -- and it is the engine's own answer, packed.
function theTaskPacksTheSeriesIntoColumns() {
  const F = require('../lib/field');
  const n = 40;
  const decisionTs = []; const closeTs = []; const m24 = []; const out = [];
  for (let i = 0; i < n; i++) { decisionTs.push(1600000000000 + i * 86400000); closeTs.push(1600000000000 + i * 86400000 + 17 * 3600000); m24.push(i % 2 ? 1 : -1); out.push(i % 2 ? 1 : -1); }
  const dials = { windowDays: 10, halfLifeDays: 5, floor: 0.1, bands: [50], lookbackHours: [24], evidenceCap: 30, leastEvidence: 0.5, copies: 3, seedText: 't' };
  const packed = F.fieldTask({ input: { decisionTs, closeTs, out, moves: { 24: m24 } }, dials });
  const plain = F.buildField({ decisionTs, closeTs, out, moves: { 24: m24 } }, dials);
  assert.strictEqual(packed.days.ts.length, n);
  assert.deepStrictEqual(packed.days.sign, plain.days.map((d) => d.sign));
  assert.strictEqual(packed.days.full[n - 1], 1);
  assert(packed.state && packed.grid && packed.range && packed.fill, 'the state, the grid, the range and the fill ride with it');
  assert.strictEqual(packed.range.days, plain.days.filter((d) => d.ts >= plain.days[n - 1].ts - 10 * 86400000 && d.speaking > 0).length);
}

module.exports = {
  aFinishedBuildIsWrittenDownAndReadsBackWhole,
  deletingTakesTwoStepsAndTheSecondNeedsTheId,
  aStoppedBuildIsNotAFieldButIsNotThrownAwayEither,
  theWindowIsHeldToTheTrainStretchOfTheShortestHistory,
  theCapIsReadOffTheRecordsUnderTheSealedLayout,
  thePoolKnowsTheFieldOnBothItsPaths,
  theTaskPacksTheSeriesIntoColumns,
};
