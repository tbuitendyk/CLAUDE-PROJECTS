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
