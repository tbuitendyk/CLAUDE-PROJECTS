// Forward books: the value of these books is that they were specified before
// any forward number existed. These tests exist to make that freeze
// TAMPER-EVIDENT — every one of them fails if a specification drifts, so a
// change can only happen deliberately (FORWARD-BOOKS.md R4: books are not
// re-specified; if the engine changes they restart and the old record ends).
const { assert } = require('./helpers');
const fb = require('../lib/forwardbook');

// The pre-registration committed these exact values. Repeating them here means
// editing the module alone cannot quietly move the goalposts.
module.exports.frozenConstantsMatchThePreRegistration = function () {
  assert.strictEqual(new Date(fb.TRAIN_THROUGH).toISOString().slice(0, 10), '2026-06-30',
    'training cutoff must stay 2026-06-30 — the last date any selecting run could see');
  assert.strictEqual(new Date(fb.SCORE_FROM).toISOString(), '2026-07-01T00:00:00.000Z',
    'scoring must start 2026-07-01, so nothing from the spent selection window is ever counted');
  assert.strictEqual(fb.VERDICT_FLOOR_TRADES, 30,
    'the no-verdict-below floor is part of the pre-registration (R3)');
  assert.strictEqual(fb.SCORE_FROM > fb.TRAIN_THROUGH, true,
    'scoring must begin after training ends — otherwise the book is scoring what it trained on');
};

module.exports.theThreeBooksAreExactlyAsPreRegistered = function () {
  assert.strictEqual(fb.BOOKS.length, 3, 'the pre-registered set is three books; adding or dropping one is re-picking');
  const sig = (b) => [b.id, b.combo.trade, b.combo.ctx1, b.combo.ctx2, b.branch.geometry, b.branch.decision,
    b.branch.band, b.stage, b.members.length, b.cell.quorum, b.cell.entry, b.cell.gate,
    String(b.cell.dMult), b.cell.tHours, String(b.cell.trailMult)].join('|');
  const expected = [
    'F1|LTCUSDT|XRPUSDT|BCHUSDT|daily-4d|argmax|1.69|slim|4|1|market|directional|null|137|null',
    'F2|XLMUSDT|DOTUSDT|TRXUSDT|daily-4d|directional|1.61|slim|4|1|breakout|active|1.5|161|null',
    'F3|XLMUSDT|DOTUSDT|TRXUSDT|daily-4d|directional|1.61|promoted|8|1|breakout|active|1.5|161|null',
  ];
  fb.BOOKS.forEach((b, i) => assert.strictEqual(sig(b), expected[i],
    `book ${b.id} no longer matches its pre-registration. Books are never re-specified — restart the record `
    + 'deliberately (R4) rather than editing the freeze.'));
};

// A frozen member list that has silently drifted from what the engine builds is
// QC 71's failure mode in different clothes: no error, plausible numbers, wrong
// experiment. The guard must actually fire.
module.exports.aDriftedCommitteeIsCaughtNotAbsorbed = function () {
  fb.assertFrozenMembersMatchEngine();
  const book = fb.BOOKS[0];
  const saved = book.members;
  book.members = saved.slice(0, saved.length - 1);
  let err = null;
  try { fb.assertFrozenMembersMatchEngine(); } catch (e) { err = e; }
  book.members = saved;
  assert.ok(err && /no longer matches specsFor/.test(err.message),
    'dropping a member from a frozen committee must throw, naming the mismatch');
  fb.assertFrozenMembersMatchEngine();
};

// The band is part of the freeze. Re-deriving it on new data would move the
// labels the members were trained against, which is a different experiment.
module.exports.theBandIsFrozenNotAuto = function () {
  for (const b of fb.BOOKS) {
    assert.strictEqual(typeof b.branch.band, 'number',
      `book ${b.id}: band must be the frozen number, never 'auto' — an adaptive band re-derived on forward `
      + 'data changes the labels the frozen members were trained against');
    assert.ok(b.branch.band > 0 && b.branch.band < 10, `book ${b.id}: band out of plausible range`);
  }
};

// F2 and F3 differ in exactly one thing. That is what makes them a free
// one-variable experiment on committee size rather than two unrelated books.
module.exports.f2AndF3DifferOnlyInCommitteeSize = function () {
  const [, f2, f3] = fb.BOOKS;
  assert.deepStrictEqual(f2.combo, f3.combo, 'F2/F3 must share a combo');
  assert.deepStrictEqual(f2.branch, f3.branch, 'F2/F3 must share geometry, decision and band');
  assert.deepStrictEqual(
    { ...f2.cell, quorum: null }, { ...f3.cell, quorum: null },
    'F2/F3 must share every execution setting; only committee size (and the quorum count that indexes it) may differ',
  );
  assert.notStrictEqual(f2.members.length, f3.members.length, 'F2/F3 must actually differ in committee size');
};

// A test file that is not in tests/run.js's list runs NOTHING and still lets
// the suite report success — which is how this very file first "passed" with
// zero assertions executed. Same class as QC 3 (never assume a check checks).
module.exports.everyTestFileIsRegisteredWithTheRunner = function () {
  const fs = require('fs');
  const path = require('path');
  const dir = __dirname;
  const onDisk = fs.readdirSync(dir).filter((f) => /^test-.*\.js$/.test(f)).sort();
  const listed = fs.readFileSync(path.join(dir, 'run.js'), 'utf8');
  const missing = onDisk.filter((f) => !listed.includes(`'${f}'`));
  assert.strictEqual(missing.join(',') || '(none)', '(none)',
    `these test files exist but are not in tests/run.js, so they run nothing while the suite reports success: `
    + missing.join(', '));
};

// The split is the whole freeze, and its first version keyed on a chunk field
// that does not exist — it matched nothing and would have been a silent wrong
// record had the guard not thrown. Tested here on fabricated chunks so it needs
// no market data and cannot regress unnoticed.
module.exports.theFrozenSplitPutsNoTrainingPeriodPastTheCutoff = function () {
  const DAY = 86400000;
  const cutoff = Date.UTC(2026, 5, 30, 23, 59, 59);
  const from = Date.UTC(2026, 6, 1);
  // 4-day periods running from 2026-05-01 to 2026-08-01
  const chunks = [];
  for (let t = Date.UTC(2026, 4, 1); t < Date.UTC(2026, 7, 1); t += 4 * DAY) chunks.push({ startTs: t });
  const OUTCOME = 138 * 3600000; // daily-4d: the trade closes 138h after the period starts
  const { trainChunks, fwdChunks, periodMs, span } = fb.splitFrozen(chunks, cutoff, from, OUTCOME);
  assert.strictEqual(periodMs, 4 * DAY, 'period length is inferred from the spacing between chunks');
  assert.strictEqual(span, Math.max(4 * DAY, OUTCOME),
    'the training span must be the OUTCOME horizon when it exceeds the step — using the step as if it were '
    + 'the span is what let training outcomes land inside the scoring window');
  assert.ok(trainChunks.length > 0 && fwdChunks.length > 0, 'both sides of the split must be non-empty here');

  const lastTrain = trainChunks[trainChunks.length - 1];
  assert.ok(lastTrain.startTs + OUTCOME <= cutoff,
    'the last training period must have its TRADE CLOSED at or before the cutoff — a period whose outcome '
    + 'lands past it is trained on forward price action, which is the leak the freeze exists to prevent');
  assert.ok(fwdChunks[0].startTs >= from, 'the first scored period must start on or after the scoring date');
  // No period may appear on both sides.
  const trainSet = new Set(trainChunks.map((c) => c.startTs));
  assert.ok(!fwdChunks.some((c) => trainSet.has(c.startTs)), 'no period may be both trained on and scored');
};

module.exports.theSplitDoesNotSilentlyReturnNothing = function () {
  const DAY = 86400000;
  const chunks = [];
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2026, 3, 1); t += 4 * DAY) chunks.push({ startTs: t });
  // All chunks are well before the scoring date: training full, forward empty.
  const r = fb.splitFrozen(chunks);
  assert.strictEqual(r.trainChunks.length, chunks.length, 'chunks entirely before the cutoff all train');
  assert.strictEqual(r.fwdChunks.length, 0, 'and none of them are scored');
  // The real defect was the opposite: a split that matched NOTHING on either
  // side while looking like a valid empty result.
  assert.ok(r.trainChunks.length > 0,
    'a split that returns nothing on both sides is the silent-wrong-record failure — it must be impossible '
    + 'for well-formed chunks');
};

// End-to-end on the fabricated pair. The frozen-spec tests above are all pure,
// so nothing exercised the scoring PATH — and it shipped to the box twice with
// errors a single integration run would have caught (a chunk field that does
// not exist, then a helper that is not exported). This drives the real thing.
module.exports.scoreBookRunsEndToEndOnTheFabricatedPair = async function () {
  const fs = require('fs');
  const pathMod = require('path');
  const planted = require('../lib/planted');
  const CACHE = pathMod.join(__dirname, '..', 'data', 'cache');
  // A test-only book: the real three are frozen and must never be edited.
  planted.generatePlanted({ fromMonth: '2024-01', toDate: '2025-06-30' });
  const book = {
    id: 'TEST', note: 'fabricated pair',
    combo: { trade: planted.PLANTED_SYMBOL, ctx1: null, ctx2: null, size: 1 },
    branch: { geometry: 'daily-1d', decision: 'argmax', band: 1.5, weekdaysOnly: false },
    stage: 'slim',
    members: fb.BOOKS[0].members.slice(0, 3),
    cell: { quorum: 1, entry: 'market', gate: 'directional', dMult: null, tHours: 41, trailMult: null, armMult: null },
    backtest: { net: 0, trades: 0, breakEvenPerLeg: 0 },
  };
  try {
    // Cutoff and scoring date inside the fabricated span so both sides exist.
    const saveT = fb.TRAIN_THROUGH;
    const r = await fb.scoreBook(book, {
      trainThrough: Date.UTC(2025, 2, 31), scoreFrom: Date.UTC(2025, 3, 1),
    });
    assert.ok(r && typeof r === 'object', 'scoreBook must return a result object');
    assert.strictEqual(r.id, 'TEST');
    assert.ok(r.trainChunks > 0, 'the fabricated pair must yield training periods');
    if (!r.pending) {
      assert.ok(Number.isFinite(r.net), 'forward net money must be a number');
      assert.ok(Number.isInteger(r.trades) && r.trades >= 0, 'trade count must be a whole number');
      assert.strictEqual(typeof r.verdictAllowed, 'boolean', 'the verdict floor must be reported, not implied');
      if (r.trades > 0) {
        assert.ok(Number.isFinite(r.breakEvenPerLeg), 'break-even fee must be computed when trades exist');
        // gross = net + fees paid; the identity must hold exactly.
        assert.ok(Math.abs(r.gross - (r.net + r.trades * 2 * r.fee)) < 1e-9,
          'gross must equal net plus fees paid — if this drifts the cost numbers are fiction');
      }
    }
    assert.strictEqual(saveT, fb.TRAIN_THROUGH, 'scoring must not mutate the frozen constants');
  } finally {
    for (const f of fs.readdirSync(CACHE)) {
      if (f.startsWith(`${planted.PLANTED_SYMBOL}-1h-`)) fs.rmSync(pathMod.join(CACHE, f), { force: true });
    }
  }
};
