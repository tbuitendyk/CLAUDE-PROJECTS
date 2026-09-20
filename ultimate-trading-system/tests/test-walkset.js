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

// A SET'S PROMOTIONS MOVE INTO A FILE BESIDE IT (3.194.0, RULE NINE). Until
// then they were inside the set document, so flipping one key rewrote 146MB.
// This test goes out with the repair it guards (RULE TEN).
function aSetWrittenWithItsPicksInsideIsBroughtUpToDate() {
  const ws = require('../lib/walkset');
  const fs = require('fs');
  {
    const rows = [
      { coin: 'LTCUSDT', geometry: 'daily-1d', lookback: 312, band: 200, trades: 9, perTrade: 0.1, windows: 4, windowsUp: 3, scan: [] },
      { coin: 'XLMUSDT', geometry: 'daily-1d', lookback: null, band: 250, trades: 7, perTrade: 0.2, windows: 4, windowsUp: 2, scan: [] },
    ];
    const got = ws.saveWalk({ asked: {}, shapes: [], collapse: [], rows, startedAt: 1, finishedAt: 2, name: 'old shape' });
    const keys = rows.map(ws.rowKey);
    // put it back into the shape a set written before 3.194.0 has
    fs.rmSync(ws.picksFile(got.id), { force: true });
    const doc = ws.readWalk(got.id);
    doc.picked = keys.slice().sort();
    doc.off = [keys[1]];
    fs.writeFileSync(ws.walkFile(got.id), `${JSON.stringify(doc)}\n`);
    ws.forgetBrief(got.id);

    // AND IT REFUSES TO GUESS UNTIL IT HAS BEEN MOVED. Reading an unmoved set
    // as "nothing promoted" would hide the owner's work behind a number.
    assert.strictEqual(ws.readPicks(got.id), null, 'no picks file yet');
    assert.strictEqual(ws.listWalks()[0].picked, null, 'the list says it does not know rather than saying nought');
    assert.strictEqual(ws.listWalks()[0].picksUnread, true, 'and it says so by name, so the screen can');
    assert.deepStrictEqual(ws.promoted(), [], 'and nothing is promoted from a set that has not been moved');

    const done = ws.repairPicksIntoTheirOwnFile();
    assert.strictEqual(done.moved, 1, 'the one set is moved');
    assert.deepStrictEqual(done.failed, [], 'and nothing failed');

    assert.deepStrictEqual(ws.readPicks(got.id).picked, keys.slice().sort(), 'every pick came across');
    assert.deepStrictEqual(ws.readPicks(got.id).off, [keys[1]], 'and so did which of them are unticked');
    const after = ws.readWalk(got.id);
    assert(!('picked' in after) && !('off' in after), 'and the set document no longer carries them');
    assert.strictEqual(after.rows.length, 2, 'with every row still there');
    const g = ws.promoted();
    assert.strictEqual(g[0].rows.length, 2);
    assert.strictEqual(g[0].rows.filter((r) => r.ticked).length, 1, 'the unticked one is still unticked');

    try {
      // and a second pass finds nothing to do, so a restart cannot double it
      assert.strictEqual(ws.repairPicksIntoTheirOwnFile().moved, 0, 'it is done once');
    } finally { try { ws.deleteWalk(got.id, got.id); } catch (_) { /* already gone */ } }
  }
}

// A SET IS `W-4.json` AND `W-4.picks.json` IS NOT ONE (3.194.0). The folder now
// holds two kinds of file, and a reader that took any .json for a set would
// invent `W-4.picks` and parse it on every draw -- the 2026-09-19 outage again.
function aPicksFileIsNeverMistakenForASet() {
  const ws = require('../lib/walkset');
  {
    const rows = [{ coin: 'LTCUSDT', geometry: 'daily-1d', lookback: 312, band: 200, trades: 9, perTrade: 0.1, windows: 4, windowsUp: 3, scan: [] }];
    const got = ws.saveWalk({ asked: {}, shapes: [], collapse: [], rows, startedAt: 1, finishedAt: 2, name: 'one set' });
    ws.setPickedMany(got.id, [ws.rowKey(rows[0])], true);
    const list = ws.listWalks();
    assert.strictEqual(list.length, 1, 'one set on disk is one set in the list');
    assert.strictEqual(list[0].id, got.id, 'and it is the set, not the picks file');
    try {
      assert.ok(ws.isSetFile(`${got.id}.json`), 'the set file is a set');
      assert.ok(!ws.isSetFile(`${got.id}.picks.json`), 'and the picks file beside it is not');
    } finally { try { ws.deleteWalk(got.id, got.id); } catch (_) { /* already gone */ } }
  }
}

module.exports = {
  aSetWrittenWithItsPicksInsideIsBroughtUpToDate,
  aPicksFileIsNeverMistakenForASet,
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
      // 3.184.0: a promoted row brings its look-back and band with it as an
      // extra, which is what the sweep turns into one more member. BOTH LTC
      // rows here are the same coin and chunk shape, so they are ONE unit --
      // and with one of them unticked, that unit carries exactly one extra,
      // the 504-hour / band 300 row. That is the merge the design asks for,
      // tested by accident of this fixture and worth keeping on purpose.
      const fwd = ws.promotedUnits();
      assert.strictEqual(fwd.length, 1, 'and only the ticked one goes forward as a unit');
      assert.strictEqual(fwd[0].coin, 'LTCUSDT');
      assert.strictEqual(fwd[0].geometry, 'daily-1d');
      assert.strictEqual(fwd[0].extras.length, 1, 'carrying what the walk found, and only for the row still ticked');
      assert.strictEqual(fwd[0].extras[0].lookbackHours, 504);
      assert.strictEqual(fwd[0].extras[0].bandPct, 300);
      assert.strictEqual(fwd[0].extras[0].from.set, got.id, 'and saying which walk set it came from');
      // and a row whose look-back is the chunk shape's own span adds no member:
      // the existing members already read exactly those numbers
      assert.ok(!fwd.some((u) => (u.extras || []).some((e) => !(e.lookbackHours > 0))),
        'no extra is carried without a look-back of its own');
      ws.setRowOff(got.id, k(rows[0]), false);
      assert(ws.promoted().find((g) => g.id === got.id).rows.every((r) => r.ticked), 'ticking it back on restores it');

      // TWO ROWS OF ONE COIN AND SHAPE ARE ONE UNIT WITH TWO EXTRAS (3.184.0).
      // They were folded to a bare coin and shape until the walk's look-back
      // and band started travelling with them; now the unit is still one, and
      // each row it came from is one more member the sweep will train.
      const both = ws.promotedUnits();
      assert.strictEqual(both.length, 1, 'two rows of one coin and shape are ONE unit');
      assert.strictEqual(both[0].coin, 'LTCUSDT');
      assert.strictEqual(both[0].geometry, 'daily-1d');
      assert.deepStrictEqual(both[0].extras.map((e) => [e.lookbackHours, e.bandPct]), [[312, 200], [504, 300]],
        'with one extra per row, in the order they were met — a list, so a third is an entry and not a branch');

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

  // THE FAMILY OF NINE AROUND A PROMOTED ROW (3.203.0, owner order: "the
  // plateau of nine ... those increments are not necessarily equally dispersed
  // ... that would just be inherited in that plateau of nine"). Read off the
  // set's own rows, in the set's own spacing; smaller at an edge and it says
  // which side is missing; nothing for a row at the chunk shape's own span.
  aPromotedRowBringsItsFamilyOfNineOffItsOwnSet() {
    const ws = require('../lib/walkset');
    // LTC daily-1d walked at four look-backs and four bands, unevenly spaced,
    // plus the shape's own span; XLM walked at one look-back only
    const rows = [];
    for (const h of [24, 48, 96, 168]) for (const b of [100, 150, 200, 300]) rows.push(aRow({ lookback: String(h), band: b }));
    rows.push(aRow({ lookback: 'own', band: 150 }));
    rows.push(aRow({ coin: 'XLMUSDT', lookback: '48', band: 300 }));
    const got = ws.saveWalk({ asked: {}, shapes: [], collapse: [], rows, startedAt: 1, finishedAt: 2, name: 'family set' });
    const key = (h, b, coin = 'LTCUSDT') => `${coin}|daily-1d|${h}|${b}`;
    try {
      // a row in the middle of the grid: nine, look-back first and band within it
      const mid = ws.familyOf(got.id, { key: key(96, 150), coin: 'LTCUSDT', geometry: 'daily-1d', lookback: '96', band: 150 });
      assert.strictEqual(mid.size, 9); assert.strictEqual(mid.of, 9);
      assert.deepStrictEqual(mid.lookbacks, [48, 96, 168], 'the set\'s own neighbours, in the set\'s own spacing');
      assert.deepStrictEqual(mid.bands, [100, 150, 200]);
      assert.deepStrictEqual(mid.missing, []);
      assert.deepStrictEqual(mid.rows.map((r) => [r.lookbackHours, r.bandPct, r.centre]),
        [[48, 100, false], [48, 150, false], [48, 200, false], [96, 100, false], [96, 150, true], [96, 200, false], [168, 100, false], [168, 150, false], [168, 200, false]]);
      assert.ok(mid.rows.every((r) => r.key === key(r.lookbackHours, r.bandPct)), 'every family row is a key of the set');
      // a row in the corner: four, and both missing sides are named
      const corner = ws.familyOf(got.id, { key: key(24, 100), coin: 'LTCUSDT', geometry: 'daily-1d', lookback: '24', band: 100 });
      assert.strictEqual(corner.size, 4);
      assert.deepStrictEqual(corner.lookbacks, [24, 48]); assert.deepStrictEqual(corner.bands, [100, 150]);
      assert.deepStrictEqual(corner.missing, [ws.FAMILY_SIDES.shorter, ws.FAMILY_SIDES.lower]);
      // an edge on one axis only: six
      const edge = ws.familyOf(got.id, { key: key(168, 200), coin: 'LTCUSDT', geometry: 'daily-1d', lookback: '168', band: 200 });
      assert.strictEqual(edge.size, 6); assert.deepStrictEqual(edge.missing, [ws.FAMILY_SIDES.longer]);
      // the shape's own span has no family; a coin walked at one look-back has a family of three
      assert.strictEqual(ws.familyOf(got.id, { key: key('own', 150), coin: 'LTCUSDT', geometry: 'daily-1d', lookback: 'own', band: 150 }), null);
      const lone = ws.familyOf(got.id, { key: key(48, 300, 'XLMUSDT'), coin: 'XLMUSDT', geometry: 'daily-1d', lookback: '48', band: 300 });
      assert.strictEqual(lone.size, 1, 'XLM was walked at one look-back and one band, so its family is itself');
      assert.deepStrictEqual(lone.missing, [ws.FAMILY_SIDES.shorter, ws.FAMILY_SIDES.longer, ws.FAMILY_SIDES.lower, ws.FAMILY_SIDES.higher]);

      // PROMOTED: each row says its family, and the units carry nine extras per
      // row with overlapping families sharing the extras they have in common
      ws.setPickedMany(got.id, [key(96, 150), key(24, 100), key('own', 150)], true);
      const group = ws.promoted().find((g) => g.id === got.id);
      assert.strictEqual(group.rows.find((r) => r.key === key(96, 150)).family.size, 9, 'the promoted list does not say the family');
      assert.strictEqual(group.rows.find((r) => r.key === key('own', 150)).family, null);
      const [unit] = ws.promotedUnits();
      assert.strictEqual(unit.coin, 'LTCUSDT');
      // 9 + 4 minus the two rows the families share: (48,100) and (48,150)
      assert.strictEqual(unit.extras.length, 11, `nine and four with two shared should be eleven extras, got ${unit.extras.length}`);
      assert.strictEqual(new Set(unit.extras.map((e) => `${e.lookbackHours}|${e.bandPct}`)).size, 11, 'an extra is carried twice');
      assert.strictEqual(unit.families.length, 2, 'one family per promoted row with a look-back of its own');
      // found by the row each is around, because the picks file keeps its own order
      const f9 = unit.families.find((f) => f.from.key === key(96, 150));
      const f4 = unit.families.find((f) => f.from.key === key(24, 100));
      assert.ok(f9 && f4, 'each promoted row has a family around it');
      assert.strictEqual(f9.members.length, 9); assert.strictEqual(f4.members.length, 4);
      assert.deepStrictEqual([unit.extras[f9.centre].lookbackHours, unit.extras[f9.centre].bandPct], [96, 150], 'the centre is the promoted row');
      assert.deepStrictEqual([unit.extras[f4.centre].lookbackHours, unit.extras[f4.centre].bandPct], [24, 100]);
      assert.ok(f9.members.includes(f9.centre) && f4.members.includes(f4.centre));
      const shared = f9.members.filter((i) => f4.members.includes(i));
      assert.deepStrictEqual(shared.map((i) => [unit.extras[i].lookbackHours, unit.extras[i].bandPct]).sort(), [[48, 100], [48, 150]], 'the two families do not share the rows they have in common');
      assert.deepStrictEqual(f4.missing, [ws.FAMILY_SIDES.shorter, ws.FAMILY_SIDES.lower]);
      assert.strictEqual(f9.from.key, key(96, 150), 'a family says which promoted row it is around');
      assert.ok(unit.extras.every((e) => e.from && e.from.set === got.id && e.from.key), 'every extra says which set and row it is');
      // the members are in grid order, so a full family reads the same way every time
      assert.deepStrictEqual(f9.members.map((i) => [unit.extras[i].lookbackHours, unit.extras[i].bandPct]),
        [[48, 100], [48, 150], [48, 200], [96, 100], [96, 150], [96, 200], [168, 100], [168, 150], [168, 200]]);
    } finally { try { ws.deleteWalk(got.id, got.id); } catch (_) { /* already gone */ } }
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
  // MANY ROWS IN ONE ASK (3.180.0). Tick every row shown can tick thousands,
  // and one request each would be thousands of reads and thousands of writes
  // of a file that runs to tens of megabytes. And every key is checked BEFORE
  // any is written: half a list applied and the rest refused leaves the owner
  // unable to say what happened.
  manyRowsArePickedInOneAskAndABadKeyStopsTheWholeAsk() {
    const ws = require('../lib/walkset');
    const rows = [
      aRow(),
      aRow({ coin: 'XLMUSDT', lookback: 'own', band: 250 }),
      aRow({ coin: 'LTCUSDT', lookback: '504', band: 300 }),
    ];
    const got = ws.saveWalk({ asked: {}, shapes: [], collapse: [], rows, startedAt: 1, finishedAt: 2, name: 'bulk set' });
    try {
      const keys = rows.map(ws.rowKey);
      const out = ws.setPickedMany(got.id, keys, true);
      assert.strictEqual(out.picked, 3, 'all three went in on one ask');
      assert.strictEqual(out.changed, 3, 'and it says how many it was handed');
      assert.deepStrictEqual(ws.readPicks(got.id).picked, keys.slice().sort());

      // a stranger among them stops the whole ask, and names itself -- and the
      // reason it gives is the true one for the direction asked (3.194.0).
      // Promoting asks "is this a row of the walk", which is a question about
      // the set document; removing asks "is this promoted", which is a question
      // about a file of a few hundred bytes. That is why Remove is instant.
      assert.throws(() => ws.setPickedMany(got.id, [keys[0], 'NOPEUSDT|daily-1d|24|200'], true),
        /NOPEUSDT\|daily-1d\|24\|200.*is not a row of/);
      assert.throws(() => ws.setPickedMany(got.id, [keys[0], 'NOPEUSDT|daily-1d|24|200'], false),
        /NOPEUSDT\|daily-1d\|24\|200.*is not promoted from/);
      assert.strictEqual(ws.readPicks(got.id).picked.length, 3, 'and nothing was unpicked on the way to refusing');

      // unticking a list is the same door
      assert.strictEqual(ws.setPickedMany(got.id, [keys[0], keys[2]], false).picked, 1);
      assert.deepStrictEqual(ws.readPicks(got.id).picked, [keys[1]]);

      // and one row still goes through the door it always did
      ws.setPicked(got.id, keys[0], true);
      assert.strictEqual(ws.readPicks(got.id).picked.length, 2, 'setPicked is setPickedMany with one row, not a second implementation');

      assert.throws(() => ws.setPickedMany(got.id, [], true), /no row was named/);

      // EVERY PROMOTION OFF ONE SET IN ONE PRESS (3.194.0, owner order). It is
      // setPickedMany with every key, so there is one implementation, and it
      // says how many went because a press that empties a list has to.
      const gone = ws.clearPicks(got.id);
      assert.strictEqual(gone.removed, 2, 'it says how many it took off');
      assert.strictEqual(gone.picked, 0, 'and none are left');
      assert.deepStrictEqual(ws.readPicks(got.id).picked, [], 'the picks file is empty, not missing');
      assert.strictEqual(ws.clearPicks(got.id).removed, 0, 'pressing it again takes nothing off and does not throw');
      assert.strictEqual(ws.readWalk(got.id).rows.length, 3, 'and the walk set still has every row it ever had');
      assert.throws(() => ws.setPickedMany(got.id, keys, 'yes'), /picked or not/);
    } finally { ws.deleteWalk(got.id, got.id); }
  },

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
      assert(ws.readPicks(got.id).picked.length === 2, 'the picks belong to the set, so they survive a restart');
      // AND THEY ARE NOT IN THE SET DOCUMENT (3.194.0). Keeping them there
      // meant rewriting 146MB to flip one key, which is what made Remove slow.
      const doc = ws.readWalk(got.id);
      assert(!('picked' in doc) && !('off' in doc), 'the set document carries the walk, never what the owner pressed');
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
  // RE-AIMED 3.189.0 (owner order, after a walk was lost to a restart three
  // hours in). A stopped walk is STILL not a set -- a table missing the coins
  // it never reached would read as a comparison and is not one. What changed is
  // that it is no longer thrown away either: every row is written down as it
  // lands, and what is left can be carried on. Refusing to READ a partial walk
  // and refusing to KEEP one were never the same requirement; they only looked
  // like one while nothing could resume.
  aStoppedWalkIsNotAsetButIsNotThrownAwayEither() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'coinsrun.js'), 'utf8');
    assert(/if \(!run\.stop && !run\.error && run\.done >= run\.of && run\.of > 0\) \{/.test(src),
      'a walk short of rows, stopped, or in error is sealed into a set anyway');
    assert(/run\.saved = require\('\.\/walkset'\)\.sealPart\(id, \{/.test(src), 'and the seal is what writes it');
    assert(/\} else if \(run\.rows\.length\) \{\n\s+run\.unfinished = \{ id, rows: run\.rows\.length, of: run\.of \};/.test(src),
      'a walk that did not finish leaves nothing behind to carry on from');
    assert(/catch \(err\) \{ run\.saveError = String/.test(src),
      'a disk that says no is SAID, not thrown -- the table in hand is still good');
    assert(/saved: r\.saved \|\| null, saveError: r\.saveError \|\| null,/.test(src), 'and the screen is told both');
    // EVERY ROW ON DISK BEFORE IT IS COUNTED. A row counted and not saved is a
    // row the owner is told they have and would lose.
    assert(/try \{ wset\.appendPart\(id, \[row\]\); \}/.test(src), 'rows are no longer written down as they land');
    // inside the walk's OWN lane -- `run.done++` appears in the coin reading too,
    // and comparing against the first one in the file would prove nothing
    const lane = src.slice(src.indexOf('const lane = async () => {'), src.indexOf('await Promise.all(Array.from('));
    assert(lane.indexOf('wset.appendPart(id, [row]);') >= 0 && lane.indexOf('wset.appendPart(id, [row]);') < lane.indexOf('run.done++;'),
      'a row is counted before it is saved, so the count can promise a row the disk does not hold');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    assert(/could not be written down/.test(ui), 'and it says so on the page rather than only in a log');
    assert(/data-wcarry=/.test(ui) && /Carry on with it/.test(ui), 'the screen offers no way to carry on with an unfinished walk');
    assert(/data-wdropcarry=/.test(ui) && /Throw it away/.test(ui), 'and no way to be rid of one');
  },

  // A WALK KEEPS WHAT IT HAS DONE, AND ONLY WHAT IT HAS DONE (3.189.0).
  aWalkKeepsItsRowsAsTheyLandAndCanBeCarriedOn() {
    const w = require('../lib/walkset');
    const id = `W-test-${Date.now().toString(36)}`;
    try {
      w.startPart(id, { name: 'a walk', startedAt: Date.now(), of: 4, asked: { windowMonths: 6 }, shapes: [], collapse: null });
      w.appendPart(id, [{ coin: 'AAAUSDT', geometry: 'daily-1d', lookback: 'own', band: 10 }]);
      w.appendPart(id, [{ coin: 'AAAUSDT', geometry: 'daily-1d', lookback: '720', band: 20 }]);
      assert.strictEqual(w.readPart(id).rows.length, 2, 'the rows are not being kept as they land');
      // THE KEY IS THE ONE THE WALK IDENTIFIES A ROW BY EVERYWHERE ELSE, so a
      // row done under one press is the same row the next press would make
      assert.deepStrictEqual([...w.partKeys(id)].sort(), ['AAAUSDT|daily-1d|720|20', 'AAAUSDT|daily-1d|own|10']);
      // IT IS NOT A SET UNTIL IT IS SEALED
      assert.strictEqual(w.readWalk(id), null, 'an unfinished walk reads as a set');
      assert.ok(w.unfinishedWalks().some((u) => u.id === id && u.rows === 2 && u.of === 4), 'an unfinished walk is not reported as one');
      assert.ok(!w.listWalks().some((x) => x.id === id), 'an unfinished walk is listed among the sets');
      // A TORN LAST LINE IS A ROW NOT YET DONE, never a guess
      fs.appendFileSync(w.partFile(id), '{"coin":"AAAUSDT","geom');
      assert.strictEqual(w.readPart(id).rows.length, 2, 'half a row written by a killed service is read as a whole one');
      // AND THE SEAL MAKES IT A SET, under the same name it was keeping
      const out = w.sealPart(id, { finishedAt: Date.now() });
      assert.strictEqual(out.id, id, 'the set does not carry the name the walk was keeping');
      assert.strictEqual(out.rows, 2);
      assert.strictEqual(w.readPart(id), null, 'the part outlives the set it became');
      assert.ok(w.readWalk(id), 'the sealed walk is not readable as a set');
      assert.ok(!w.unfinishedWalks().some((u) => u.id === id), 'a sealed walk still reports as unfinished');
    } finally {
      w.removePart(id);
      try { fs.rmSync(w.walkFile(id), { force: true }); } catch (_) { /* fixture */ }
    }
  },

  // THE PARTS LIVE IN THEIR OWN DIRECTORY (3.189.0), because a part named
  // `<id>.part.json` beside the sets would be listed as a walk called
  // `<id>.part` -- which is exactly the fault that cost the evening this was
  // written in (lib/stages.js isSetDocument).
  aPartIsNeverMistakenForAset() {
    const w = require('../lib/walkset');
    assert.ok(w.PARTS.startsWith(w.DIR + path.sep), 'the parts are not kept under the walks directory');
    assert.notStrictEqual(path.dirname(w.partFile('W-9')), w.DIR, 'a part sits beside the sets, where a listing will find it');
    assert.ok(w.partFile('W-9').endsWith('.jsonl'), 'a part is named so a listing of .json files would pick it up');
  },
};
