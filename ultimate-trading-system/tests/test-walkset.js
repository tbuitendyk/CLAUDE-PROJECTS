// WALK IT FORWARD'S SETS ON DISK (3.164.0, owner order: "build the saved walk
// set").
//
// Until this release the walk wrote nothing: nineteen minutes of compute lived
// in the service's memory and went the moment it restarted, silently. These
// tests go through the real files on a scratch directory -- a store that is
// only ever checked by scanning its source is a store nobody has opened.
const { assert } = require('./helpers');
const fs = require('fs');
const path = require('path');

// EVERY TEST HERE CREATES ITS OWN SETS AND DELETES THEM IN A finally, and
// never touches a set it did not create. There is no scratch directory: the
// store closes over its own path, so standing one in would be a pretence.
const aRow = (over = {}) => ({
  coin: 'LTCUSDT', geometry: 'daily-1d', lookback: '312', band: 200,
  trades: 370, perTrade: 0.879, windows: 15, windowsUp: 15, best: 3.96, worst: 0.15,
  copies: 100, asGood: 0, asGoodSlid: 0,
  scan: [{ from: 0, to: 9, n: 40, perTrade: 0.5, thin: false, ts: 1 }],
  ...over,
});

module.exports = {
  // PROMOTED IS A REFERENCE, NOT A COPY (owner decision, 2026-09-18: "reference
  // the walk set, not copy"). Every row in the list at the top of Coins is read
  // back off its own walk set, so deleting the set takes them with it and
  // nothing up there can go stale against a re-walk.
  //
  // AND PROMOTED AND TICKED ARE TWO DIFFERENT THINGS. Promoting says a row is
  // worth carrying; the tick says whether to run it just now. A promoted row
  // is TICKED until it is unticked, the same way a passer is, so promoting
  // does not then need a second press to use.
  aPromotedRowIsAReferenceToItsWalkSetAndIsTickedUntilUnticked() {
    const ws = require('../lib/walkset');
    const rows = [
      aRow(),
      aRow({ coin: 'XLMUSDT', lookback: 'own', band: 250 }),
      aRow({ coin: 'LTCUSDT', lookback: '504', band: 300 }),
    ];
    const got = ws.saveWalk({ asked: {}, shapes: [], collapse: [], rows, startedAt: 1, finishedAt: 2, name: 'promo set' });
    const k = (r) => ws.rowKey(r);
    try {
      assert.deepStrictEqual(ws.promoted(), ws.promoted().filter((g) => g.id !== got.id),
        'a set with nothing promoted is not listed at all — an empty box on the screen is noise');

      ws.setPicked(got.id, k(rows[0]), true);
      ws.setPicked(got.id, k(rows[2]), true);
      const group = ws.promoted().find((g) => g.id === got.id);
      assert(group, 'the set appears once something is promoted from it');
      assert(group.name === 'promo set' && group.release, 'headed by the set it came from, which is the provenance');
      assert(group.rows.length === 2, `two rows promoted, got ${group.rows.length}`);
      assert(group.rows.every((r) => r.ticked), 'and both arrive TICKED');
      // it carries what the ROW is
      const one = group.rows.find((r) => r.lookback === '504');
      assert(one && Number(one.band) === 300 && one.trades === 370, 'with its own look-back, band and figures');
      assert(Array.isArray(one.scan) && one.scan.length, 'and its window strip, so windows paid can be counted on it');

      // UNTICKING KEEPS THE PROMOTION
      ws.setRowOff(got.id, k(rows[0]), true);
      const after = ws.promoted().find((g) => g.id === got.id);
      assert(after.rows.length === 2, 'unticking does not un-promote');
      assert(after.rows.filter((r) => r.ticked).length === 1, 'but only one is ticked now');
      assert.deepStrictEqual(ws.promotedUnits(), [{ coin: 'LTCUSDT', geometry: 'daily-1d' }],
        'and only the ticked one goes forward as a unit');
      ws.setRowOff(got.id, k(rows[0]), false);
      assert(ws.promoted().find((g) => g.id === got.id).rows.every((r) => r.ticked), 'ticking it back on restores it');

      // TWO ROWS OF ONE COIN AND SHAPE FOLD TO ONE UNIT here, because that is
      // the shape unitsForPassers takes. Telling them apart is what step D is
      // for; until then they are the same coin and the same chunk shape.
      assert.deepStrictEqual(ws.promotedUnits(), [{ coin: 'LTCUSDT', geometry: 'daily-1d' }],
        'two promoted rows on one coin and shape are one unit for now');

      // A ROW THAT IS NOT PROMOTED CANNOT BE TICKED
      assert.throws(() => ws.setRowOff(got.id, k(rows[1]), true), /is not promoted from/,
        'ticking something that was never promoted is refused by name');
      assert.throws(() => ws.setPicked(got.id, 'NOTAROW|x|y|z', true), /is not a row of/,
        'and promoting something that is not a row of this set is refused too');
    } finally { try { ws.deleteWalk(got.id, got.id); } catch (_) { /* already gone */ } }

    // AND THE REFERENCE DIES WITH THE SET, which is the whole of the owner's
    // choice: nothing is copied, so nothing is left behind pointing at a walk
    // that is gone.
    assert(!ws.promoted().some((g) => g.name === 'promo set'),
      'deleting the walk set takes its promoted rows with it');
  },

  // A FINISHED WALK IS ON DISK AND READS BACK THE SAME. Every figure the table
  // draws has to survive the round trip, including the per-window strip -- an
  // opened set that lost its windows would draw a row that cannot be opened.
  aFinishedWalkIsWrittenDownAndReadsBackWholeAndKeepsItsParameters() {
    const ws = require('../lib/walkset');
    const asked = { windowMonths: 6, warmUpMonths: 12, bands: [200, 250], scrambles: 100, floor: 3, lookbacks: [24, 312] };
    const rows = [aRow(), aRow({ coin: 'XLMUSDT', lookback: 'own', band: 250 })];
    const got = ws.saveWalk({ asked, shapes: [{ key: 'daily-1d', label: 'Daily 1-day' }], collapse: [{ forwardHours: 17, walks: 'daily-1d', standsFor: ['daily-2d'] }], rows, startedAt: 10, finishedAt: 20, name: 'a walk' });
    try {
      assert(got.id && got.rows === 2 && got.bytes > 0, `the save answers with its id, its rows and its size, got ${JSON.stringify(got)}`);
      const back = ws.readWalk(got.id);
      assert(back, 'and it reads back');
      assert.deepStrictEqual(back.asked, asked, 'THE PARAMETERS RIDE WITH IT -- a set that does not say how it was walked can be read as though it had been walked some other way');
      assert.deepStrictEqual(back.rows, rows, 'and every row, whole, strips and all');
      assert.deepStrictEqual(back.collapse, [{ forwardHours: 17, walks: 'daily-1d', standsFor: ['daily-2d'] }],
        'and which shapes stood down when it was walked, or its row count lies');
      assert(back.release && /^\d+\.\d+\.\d+$/.test(back.release), `and the release that walked it, got ${back.release}`);
      assert(back.startedAt === 10 && back.finishedAt === 20, 'and when it ran');
      // the list is cheap: headers only, never the rows
      const list = ws.listWalks().filter((w) => w.id === got.id);
      assert(list.length === 1 && list[0].rows === 2 && !('scan' in list[0]), 'the list carries the count, not the rows');
    } finally { try { ws.deleteWalk(got.id, got.id); } catch (_) { /* already gone */ } }
  },

  // AN ID THE BOX DOES NOT HOLD IS REFUSED BY NAME, on every door. This is the
  // allow-list test-sweepcontract.js points at for the walk sets box: its
  // values are ids of files this store holds, and nothing else gets through.
  aSetIsOpenedRenamedPickedAndDeletedOnlyByAnIdTheBoxHolds() {
    const ws = require('../lib/walkset');
    const run = require('../lib/coinsrun');
    assert(ws.readWalk('W-nope-9999') === null, 'reading an id the box does not hold answers nothing rather than guessing');
    assert.throws(() => ws.renameWalk('W-nope-9999', 'x'), /no walk/, 'renaming it is refused by name');
    assert.throws(() => ws.setPicked('W-nope-9999', 'k', true), /no walk/, 'picking a row of it is refused by name');
    assert.throws(() => ws.deleteWalk('W-nope-9999'), /no walk/, 'deleting it is refused by name');
    assert.throws(() => run.coinsWalkOpen('W-nope-9999'), /no walk/, 'and opening it on the screen is refused by name');
  },

  // A PICK NAMES A ROW OF THIS SET AND NOTHING ELSE, and the picks come back as
  // coin and shape -- the shape every other part of the box already takes a
  // selection in, so a walk's picks need no new machinery downstream.
  thePicksAreRowsOfTheSetAndTheyComeBackAsCoinAndShape() {
    const ws = require('../lib/walkset');
    const rows = [aRow(), aRow({ lookback: '336' }), aRow({ coin: 'XLMUSDT', geometry: 'daily-3d', lookback: '48', band: 300 })];
    const got = ws.saveWalk({ asked: {}, shapes: [], collapse: [], rows, startedAt: 1, finishedAt: 2 });
    try {
      assert.throws(() => ws.setPicked(got.id, 'NOPEUSDT|daily-1d|own|200', true), /is not a row of/,
        'a key that is not a row of this set is refused, or a pick could name anything');
      assert.throws(() => ws.setPicked(got.id, ws.rowKey(rows[0]), 'yes'), /picked or not/, 'and a pick is a yes or a no');
      ws.setPicked(got.id, ws.rowKey(rows[0]), true);
      ws.setPicked(got.id, ws.rowKey(rows[1]), true);
      ws.setPicked(got.id, ws.rowKey(rows[2]), true);
      // TWO ROWS OF ONE COIN AND SHAPE ARE ONE UNIT. Picking a coin at two
      // look-backs is still one coin and shape to everything downstream, and
      // handing it over twice would price it twice.
      assert.deepStrictEqual(ws.pickedUnits(got.id), [
        { coin: 'LTCUSDT', geometry: 'daily-1d' },
        { coin: 'XLMUSDT', geometry: 'daily-3d' },
      ], 'the picks come back as coin and shape, once each, in the order the rows sit in');
      ws.setPicked(got.id, ws.rowKey(rows[2]), false);
      assert.deepStrictEqual(ws.pickedUnits(got.id), [{ coin: 'LTCUSDT', geometry: 'daily-1d' }], 'and un-picking takes it out');
      assert(ws.readWalk(got.id).picked.length === 2, 'the picks live ON the set, so they survive a restart');
    } finally { try { ws.deleteWalk(got.id, got.id); } catch (_) { /* already gone */ } }
  },

  // DELETING ONE TAKES TWO STEPS, the way a record set does. Hours of compute
  // cannot be got back from a mis-click.
  deletingASetAnswersWithWhatWouldGoAndOnlyItsOwnIdDoesIt() {
    const ws = require('../lib/walkset');
    const got = ws.saveWalk({ asked: {}, shapes: [], collapse: [], rows: [aRow()], startedAt: 1, finishedAt: 2 });
    const look = ws.deleteWalk(got.id, '');
    assert(look.preview === true && look.confirmWith === got.id && look.rows === 1 && look.bytes > 0,
      `the first press answers with what would go, got ${JSON.stringify(look)}`);
    assert(ws.readWalk(got.id), 'and nothing has gone yet');
    const wrong = ws.deleteWalk(got.id, 'not-the-id');
    assert(wrong.preview === true, 'the wrong id deletes nothing');
    assert(ws.readWalk(got.id), 'and it is still there');
    const done = ws.deleteWalk(got.id, got.id);
    assert(done.deleted === true && done.id === got.id, `its own id does it, got ${JSON.stringify(done)}`);
    assert(ws.readWalk(got.id) === null, 'and it is gone');
  },

  // NAMES ARE DIFFERENT FROM EACH OTHER, because a name is how a set is
  // recognised in a month, and two sets called the same thing is two sets
  // nobody can tell apart.
  everySetHasItsOwnNameAndTheBoxOffersAFreeOne() {
    const ws = require('../lib/walkset');
    const a = ws.saveWalk({ asked: {}, shapes: [], collapse: [], rows: [aRow()], startedAt: 1, finishedAt: 2, name: 'the same name' });
    const b = ws.saveWalk({ asked: {}, shapes: [], collapse: [], rows: [aRow()], startedAt: 1, finishedAt: 3 });
    try {
      assert(a.id !== b.id, 'two sets, two ids');
      assert(a.name === 'the same name', 'a typed name is taken as typed');
      assert(/^walk \d+$/.test(b.name), `and a blank one takes the free name the box offers, got ${b.name}`);
      assert.throws(() => ws.renameWalk(b.id, 'the same name'), /already the name/, 'a name already in use is refused by name');
      assert.throws(() => ws.renameWalk(b.id, '   '), /needs a name/, 'and a blank one is refused');
      const ok = ws.renameWalk(b.id, 'something else');
      assert(ok.name === 'something else', 'a free name is taken');
      assert(!ws.listWalks().some((w) => w.name === ''), 'no set is left nameless');
    } finally {
      for (const id of [a.id, b.id]) { try { ws.deleteWalk(id, id); } catch (_) { /* gone */ } }
    }
  },

  // A STOPPED WALK IS NOT SAVED, and a finished one is. This reads the runner's
  // own line rather than trusting it: the condition is the whole rule.
  aStoppedWalkIsNotWrittenDownAndTheScreenSaysWhatWasWritten() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsrun.js'), 'utf8');
    assert(/if \(!run\.stop && !run\.error && run\.rows\.length\) \{/.test(src),
      'only a walk that finished, without error, with rows, is written down');
    assert(/run\.saved = require\('\.\/walkset'\)\.saveWalk\(\{/.test(src), 'and that is what writes it');
    assert(/catch \(err\) \{ run\.saveError = String/.test(src),
      'a disk that says no is SAID, not thrown -- the table in hand is still good');
    assert(/saved: r\.saved \|\| null, saveError: r\.saveError \|\| null,/.test(src), 'and the screen is told both');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    assert(/could not be written down/.test(ui), 'and it says so on the page rather than only in a log');
  },
};
