// THE D1 MIGRATION (owner order, 2026-09-18: "delete #3b and #3c, migrate the
// other four"). A repair, and it is deleted the day needs() comes back empty
// on the box (RULE TEN) -- this file goes with it.
//
// WHAT THESE CHECK, and each is a restated clause of the D1 pre-registration.
// The pre-registration was written when this looked like stripping a FIELD off
// every row and said "same row count, exactly". It drops two rows in three, so
// that clause was impossible and is replaced here by the one that carries the
// same protection: the same BLOCK count, and every surviving row under the
// block index it already had.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const ROOT = path.join(__dirname, '..');

function withScratch(fn) {
  const realData = path.join(ROOT, 'data');
  const stash = `${realData}.stash-d1-${process.pid}`;
  const had = fs.existsSync(realData);
  if (had) fs.renameSync(realData, stash);
  fs.mkdirSync(path.join(realData, 'batches'), { recursive: true });
  const mods = ['lib/rowstore', 'lib/d1migrate'];
  mods.forEach((m) => { delete require.cache[require.resolve(path.join(ROOT, m))]; });
  try {
    return fn({ rowstore: require(path.join(ROOT, 'lib/rowstore')), d1: require(path.join(ROOT, 'lib/d1migrate')) });
  } finally {
    fs.rmSync(realData, { recursive: true, force: true });
    if (had) fs.renameSync(stash, realData);
    mods.forEach((m) => { delete require.cache[require.resolve(path.join(ROOT, m))]; });
  }
}

// A SET SHAPED LIKE THE ONES ON THE BOX: one block per unit per dial value, so
// two blocks in three keep nothing -- which is exactly s3-mu0z1opj-7, where
// thirty of forty-five blocks come out empty.
const VALUES = ['off', 'confirmed only', 'sized'];
function buildSet(rowstore, id, units = 5) {
  const w = rowstore.writer(id, 'records', { manualBlocks: true });
  for (let u = 0; u < units; u++) {
    for (const confirm of VALUES) {
      w.push({
        si: u, label: `unit ${u} - ${confirm}`, u, trade: `AAA${u}USDT`, ctx1: null, ctx2: null,
        geometry: 'daily-3d', confirm, pnl: u * 10 + VALUES.indexOf(confirm), trades: 40 + u,
        lean: confirm === 'off' ? null : { rising: 1, falling: -1 },
      });
      w.flush(true);
    }
  }
  w.close();
}

module.exports = {

  // THE PLAN IS READ OFF THE ROWS, never a list of ids somebody keeps up to date.
  thePlanCountsWhatIsThereRatherThanAssumingTheShape() {
    withScratch(({ rowstore, d1 }) => {
      buildSet(rowstore, 'd1-plan', 5);
      const p = d1.planFor('d1-plan');
      assert.strictEqual(p.blocks, 15, `15 blocks, got ${p.blocks}`);
      assert.strictEqual(p.rows, 15, `15 rows, got ${p.rows}`);
      assert.strictEqual(p.keep, 5, `5 rows the dial was off for, got ${p.keep}`);
      assert.strictEqual(p.drop, 10, `10 to drop, got ${p.drop}`);
      assert.strictEqual(p.emptied, 10, `10 blocks would keep nothing, got ${p.emptied}`);
      assert.strictEqual(p.can, true, 'and it can be migrated');
      assert.deepStrictEqual(p.values.map((v) => v.value).sort(), ['confirmed only', 'off', 'sized']);
    });
  },

  // THE WHOLE POINT: the same block count, and every kept row under the index
  // it already had. Block indexes are recorded away from the rows, so a block
  // that vanished would move every one of them.
  everySurvivingRowStaysUnderTheBlockIndexItAlreadyHad() {
    withScratch(({ rowstore, d1 }) => {
      buildSet(rowstore, 'd1-swap', 5);
      // where each keeper lives BEFORE, read off the set that is standing
      const before = new Map();
      for (let b = 0; b < 15; b++) {
        for (const { row } of rowstore.readBlocks('d1-swap', 'records', [b]) || []) {
          if (row.confirm === 'off') before.set(row.label, b);
        }
      }
      assert.strictEqual(before.size, 5, 'five keepers to follow');

      const out = d1.migrate('d1-swap');
      assert.strictEqual(out.migrated, true);
      assert.strictEqual(out.kept, 5, `kept ${out.kept}`);
      assert.strictEqual(out.dropped, 10, `dropped ${out.dropped}`);
      assert.strictEqual(out.emptied, 10, `${out.emptied} blocks kept nothing`);

      assert.strictEqual(rowstore.blocksOf('d1-swap', 'records').length, 15,
        'the same number of blocks, or every stored index points somewhere else');
      assert.strictEqual(rowstore.count('d1-swap', 'records'), 5, 'and only the kept rows are rows');
      for (const [label, b] of before) {
        const got = (rowstore.readBlocks('d1-swap', 'records', [b]) || []).map((x) => x.row.label);
        assert.deepStrictEqual(got, [label], `block ${b} used to hold ${label} and now holds ${JSON.stringify(got)}`);
      }
      for (const row of rowstore.readAll('d1-swap', 'records')) {
        assert.strictEqual(row.confirm, 'off', `a row the dial was not off for survived: ${row.label}`);
      }
    });
  },

  // A KEPT ROW IS THE SAME ROW. Not "the same shape" -- the same values, field
  // for field, because the money on it is the evidence the set exists for.
  aKeptRowComesThroughUnchangedFieldForField() {
    withScratch(({ rowstore, d1 }) => {
      buildSet(rowstore, 'd1-same', 4);
      const was = rowstore.readAll('d1-same', 'records').filter((r) => r.confirm === 'off');
      d1.migrate('d1-same');
      const now = rowstore.readAll('d1-same', 'records');
      assert.strictEqual(now.length, was.length, `${now.length} rows against ${was.length}`);
      for (let i = 0; i < was.length; i++) {
        assert.deepStrictEqual(now[i], was[i], `row ${i} changed`);
      }
    });
  },

  // THE OWNER'S SET SURVIVES A FAILED MIGRATION UNTOUCHED. Verified by making
  // the check itself fail: nothing is swapped, nothing is left beside it.
  aMigrationThatDoesNotVerifyLeavesTheSetExactlyAsItWas() {
    withScratch(({ rowstore, d1 }) => {
      buildSet(rowstore, 'd1-keep', 4);
      const before = rowstore.readAll('d1-keep', 'records');
      const blocksBefore = rowstore.blocksOf('d1-keep', 'records').length;
      // break the writer so the rewrite cannot come out right
      const realWriter = rowstore.writer;
      rowstore.writer = (id, name, opts) => {
        const w = realWriter(id, name, opts);
        return { ...w, push: (o) => (o.confirm === 'off' && o.si === 2 ? w.count : w.push(o)), get count() { return w.count; }, get blockCount() { return w.blockCount; }, flush: (f) => w.flush(f), close: () => w.close() };
      };
      let threw = null;
      try { d1.migrate('d1-keep'); } catch (e) { threw = e; } finally { rowstore.writer = realWriter; }
      assert.ok(threw, 'a rewrite that lost a row must throw rather than swap');
      assert.ok(/was NOT migrated/.test(threw.message), `and say so plainly, got: ${threw && threw.message}`);
      assert.deepStrictEqual(rowstore.readAll('d1-keep', 'records'), before, 'the set is exactly as it was');
      assert.strictEqual(rowstore.blocksOf('d1-keep', 'records').length, blocksBefore, 'with its blocks as they were');
      assert.ok(!fs.existsSync(rowstore.storeDir(d1.BESIDE('d1-keep'))), 'and nothing is left standing beside it');
    });
  },

  // A SET WITH NOTHING TO KEEP IS REFUSED BY NAME, because migrating it and
  // deleting it are the same act and that is the owner's call, never a
  // session's (RULE NINE). This is #3b and #3c on the box.
  aSetWhereEveryRowWouldGoIsRefusedRatherThanEmptied() {
    withScratch(({ rowstore, d1 }) => {
      const w = rowstore.writer('d1-allsized', 'records', { manualBlocks: true });
      for (let u = 0; u < 4; u++) { w.push({ u, confirm: 'sized', pnl: u }); w.flush(true); }
      w.close();
      const p = d1.planFor('d1-allsized');
      assert.strictEqual(p.can, false, 'it cannot be migrated');
      assert.ok(/the owner's call/.test(p.why), `and says why, got: ${p.why}`);
      assert.throws(() => d1.migrate('d1-allsized'), /owner's call/);
      assert.strictEqual(rowstore.count('d1-allsized', 'records'), 4, 'and every row is still there');
    });
  },

  // AND A SET THAT NEVER CARRIED THE DIAL IS NOT OFFERED ONE. The document says
  // which were launched with it permuted, and the migration turns that off, so
  // this is the same question read from the cheap end.
  aSetThatIsAlreadyRightIsNotListedAsNeedingAnything() {
    withScratch(({ rowstore, d1 }) => {
      const w = rowstore.writer('d1-clean', 'records', { manualBlocks: true });
      for (let u = 0; u < 3; u++) { w.push({ u, confirm: 'off', pnl: u }); w.flush(true); }
      w.close();
      buildSet(rowstore, 'd1-dirty', 2);
      const list = d1.needs(() => ([
        { id: 'd1-clean', name: 'already right', stage: 3, params: { permuteConfirm: false } },
        { id: 'd1-dirty', name: 'three per setting', stage: 3, params: { permuteConfirm: true } },
        { id: 'd1-other', name: 'not stage 3', stage: 2, params: { permuteConfirm: true } },
        { id: 'd1-old', name: 'never had the dial', stage: 3, params: {} },
      ]));
      assert.strictEqual(list.length, 1, `one set needs it, got ${list.map((x) => x.id).join(', ')}`);
      assert.strictEqual(list[0].id, 'd1-dirty');
      assert.strictEqual(list[0].rows, 6, `two units times three rows, got ${list[0].rows}`);
    });
  },

  // AND ASKING COSTS A READ OF THE DOCUMENTS, NOT OF THE ROWS.
  //
  // This is asked on every draw of Boards. The first version called planFor()
  // on every stage 3 set -- every block of every one of them -- and the
  // endpoint timed out the first time the box was asked. RULE TEN names that
  // cost exactly: a repair that reads something on every screen draw, one of
  // which walked every record of the owner's set to decide whether to offer a
  // button nobody would press again.
  //
  // Watched failing: putting planFor() back inside needs() reads the blocks and
  // this counts them.
  askingWhatNeedsItNeverReadsARow() {
    withScratch(({ rowstore, d1 }) => {
      buildSet(rowstore, 'd1-big', 40);           // 120 blocks, 120 rows
      let blockReads = 0;
      const real = rowstore.readBlocks;
      rowstore.readBlocks = (...a) => { blockReads++; return real(...a); };
      try {
        const list = d1.needs(() => ([{ id: 'd1-big', name: 'big', stage: 3, params: { permuteConfirm: true } }]));
        assert.strictEqual(list.length, 1, 'the set is listed');
        assert.strictEqual(list[0].rows, 120, `and its row count comes off the sidecar, got ${list[0].rows}`);
      } finally { rowstore.readBlocks = real; }
      assert.strictEqual(blockReads, 0,
        `asking what needs migrating read ${blockReads} block(s) — on every draw of Boards, for every set on the box`);
    });
  },

};
