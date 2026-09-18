// d1migrate.js -- A REPAIR, AND IT IS WRITTEN TO BE DELETED (RULE TEN).
//
// WHAT IT DOES. A stage 3 set launched with the confirmation dial permuted
// holds THREE rows for every setting -- one priced with the dial `off`, one
// `confirmed only`, one `sized`. The owner's decision, 2026-09-18: keep the
// `off` row of each and drop the other two, so every set on the box holds one
// row per setting again and the dial can be cut out of the engine whole.
//
// WHEN IT DIES. The day `needs()` comes back empty on the box with nothing
// running. That is the only evidence that retires it -- not a version number,
// not "probably all of them" (RULE TEN). What goes then is the whole of it:
// this file, its two endpoints, the notice and the press on Boards, its tests
// and its guards. Half a repair left behind reads as live code with no way in.
//
// WHY IT IS ONE FILE. A repair threaded through a reader as an extra condition
// cannot be lifted out in one cut, and seven of those had accumulated in
// lib/stages.js before RULE TEN was written. Nothing here is called from
// anywhere but its own endpoints.
//
// HOW IT IS SAFE (RULE NINE: migrate BESIDE, verify, then swap).
// The new store is built next to the old one under its own id, checked against
// the old one row by row, and only then moved into place. Nothing is rewritten
// where it stands, so a crash at any point leaves the owner's set exactly as it
// was. Hours of compute that cannot be re-derived from anything but a full
// re-run are not worth a clever in-place edit.
//
// THE ONE THING THAT MAKES IT DELICATE, measured before it was written:
// block indexes are recorded away from the rows -- per coin in the totals --
// so the rewrite must keep the same block COUNT and the same order. Of the four
// sets on the box, one loses no block, two lose two of three, and one loses
// thirty of forty-five. rowstore's writer cannot write an empty block by
// itself, so it is asked for one explicitly (`flush(true)` under manualBlocks)
// and every surviving row stays under the block index it already had.
const fs = require('fs');
const path = require('path');
const rowstore = require('./rowstore');

const KEEP = 'off';
const BESIDE = (id) => `${id}.d1beside`;
const confirmOf = (row) => String((row && row.confirm) || KEEP);
const isKeeper = (row) => confirmOf(row) === KEEP;

// UNDEFINED AND NULL ARE ONE THING TO EVERY READER OF THESE ROWS, and the
// rewrite makes an absent trailing value explicit. Comparing with that
// normalised on both sides is the honest check: it does not hide a changed
// value, only a changed way of writing "nothing". The count of them is
// reported, so a set where it happened says so rather than passing quietly.
const norm = (v) => (v === undefined ? null : v);
function sameRow(a, b) {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  let loosened = 0;
  for (const k of keys) {
    const x = norm(a[k]); const y = norm(b[k]);
    if (JSON.stringify(x) !== JSON.stringify(y)) return { same: false, field: k, was: a[k], now: b[k] };
    if (a[k] === undefined && b[k] === null) loosened++;
  }
  return { same: true, loosened };
}

// WHAT ONE SET WOULD LOSE, read off the rows themselves. Never a hardcoded list
// of ids: a set written tomorrow with the dial permuted is one of these too,
// and a list somebody has to remember to update is the thing RULE FIVE forbids.
function planFor(id) {
  const blocks = rowstore.blocksOf(id, 'records');
  if (!blocks) return { id, can: false, why: 'this set has no block index, so its rows cannot be rewritten block for block' };
  const per = [];
  let keep = 0; let drop = 0; let empties = 0;
  const values = new Map();
  for (let b = 0; b < blocks.length; b++) {
    const got = rowstore.readBlocks(id, 'records', [b]) || [];
    let k = 0;
    for (const { row } of got) {
      const v = confirmOf(row);
      values.set(v, (values.get(v) || 0) + 1);
      if (isKeeper(row)) k++;
    }
    keep += k; drop += got.length - k;
    if (got.length && k === 0) empties++;
    per.push({ block: b, rows: got.length, keep: k });
  }
  return {
    id,
    can: drop > 0 && keep > 0,
    why: drop === 0 ? 'every row of this set is already the one the dial was off for'
      : keep === 0 ? 'no row of this set was priced with the dial off, so there is nothing to keep — migrating it and deleting it are the same act, and that is the owner\'s call'
        : null,
    blocks: blocks.length, rows: keep + drop, keep, drop, emptied: empties,
    values: [...values.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ value: v, rows: n })),
    per,
  };
}

// EVERY SET THAT WAS LAUNCHED WITH THE DIAL PERMUTED, AND IT IS A CHEAP READ.
//
// This is asked on every draw of Boards, so it may not touch the rows. The
// first version called planFor() on every stage 3 set -- every block of every
// one of them, a hundred thousand rows on the big ones -- and the endpoint
// timed out on the box the first time it was asked. That is exactly the cost
// RULE TEN names: a repair that reads something on every screen draw, one of
// which "walked every record of the owner's set to decide whether to offer a
// button nobody would ever press again". Caught by running it, not by reading
// it.
//
// The document already knows: `permuteConfirm` is what made the set carry
// three rows per setting, and the migration turns it off. So the notice is a
// read of the set documents, and the COUNTS come from the preview press, which
// is one set at a time and asked for.
//
// `listSets` is handed in rather than required, because requiring stages.js
// from here would make the repair part of the thing it repairs.
function needs(listSets) {
  const out = [];
  for (const doc of listSets()) {
    if (doc.stage !== 3) continue;
    if (!doc.params || doc.params.permuteConfirm !== true) continue;
    let rows = null;
    try { rows = rowstore.count(doc.id, 'records'); } catch (_) { /* the sidecar is a forty-byte read */ }
    out.push({ id: doc.id, name: doc.name, rows });
  }
  return out;
}

// MIGRATE BESIDE, VERIFY, THEN SWAP. Returns what it did, or throws with the
// set untouched. `after` is handed the id once the rows are in place, so the
// caller can delete what was derived from them and say so (RULE NINE: totals
// are rebuilt from the migrated records, never migrated themselves).
function migrate(id, { after = null } = {}) {
  const plan = planFor(id);
  if (!plan.can) throw new Error(plan.why || `${id} does not need this`);

  const beside = BESIDE(id);
  rowstore.remove(beside);                       // a previous attempt that never swapped
  const w = rowstore.writer(beside, 'records', { manualBlocks: true });
  for (let b = 0; b < plan.blocks; b++) {
    for (const { row } of rowstore.readBlocks(id, 'records', [b]) || []) {
      if (isKeeper(row)) w.push(row);
    }
    w.flush(true);                               // a block that kept nothing is still a block
  }
  w.close();

  // ---- VERIFY, against the set that is still standing untouched ----------
  const fail = (why) => { rowstore.remove(beside); throw new Error(`${id} was NOT migrated: ${why}`); };
  const newBlocks = rowstore.blocksOf(beside, 'records');
  if (!newBlocks) fail('the new store came out with no block index');
  if (newBlocks.length !== plan.blocks) {
    fail(`${newBlocks.length} blocks written against ${plan.blocks} — every index after a missing block would point somewhere else`);
  }
  const wrote = rowstore.count(beside, 'records');
  if (wrote !== plan.keep) fail(`${wrote} rows written against ${plan.keep} that should have been kept`);
  let loosened = 0;
  for (let b = 0; b < plan.blocks; b++) {
    const want = (rowstore.readBlocks(id, 'records', [b]) || []).filter((x) => isKeeper(x.row)).map((x) => x.row);
    const got = (rowstore.readBlocks(beside, 'records', [b]) || []).map((x) => x.row);
    if (got.length !== want.length) fail(`block ${b} came out with ${got.length} rows against ${want.length}`);
    for (let i = 0; i < want.length; i++) {
      const cmp = sameRow(want[i], got[i]);
      if (!cmp.same) fail(`block ${b} row ${i} changed in ${cmp.field}: ${JSON.stringify(cmp.was)} became ${JSON.stringify(cmp.now)}`);
      loosened += cmp.loosened;
    }
  }
  let left = 0;
  rowstore.each(beside, 'records', (row) => { if (!isKeeper(row)) left++; });
  if (left) fail(`${left} row(s) the dial was not off for survived the rewrite`);

  // ---- SWAP. Only now, and the old store is kept until the new one is in.
  const oldDir = rowstore.storeDir(id);
  const newDir = rowstore.storeDir(beside);
  const asideDir = `${oldDir}.d1old`;
  fs.rmSync(asideDir, { recursive: true, force: true });
  fs.renameSync(oldDir, asideDir);
  try { fs.renameSync(newDir, oldDir); } catch (err) {
    fs.renameSync(asideDir, oldDir);             // put the owner's set back, exactly as it was
    throw new Error(`${id} was NOT migrated: the new store could not be moved into place (${err.message})`);
  }
  fs.rmSync(asideDir, { recursive: true, force: true });

  const derived = after ? after(id) : [];
  return {
    migrated: true, id, blocks: plan.blocks, kept: plan.keep, dropped: plan.drop,
    emptied: plan.emptied, loosened, derived,
  };
}

module.exports = { needs, planFor, migrate, KEEP, BESIDE };
