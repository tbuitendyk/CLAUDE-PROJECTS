// A board selection must be leaveable (owner, 2026-08-18).
//
// Kept from a Stage 2 that was otherwise reverted: the rule registry it was
// part of duplicated lib/live/setups.js, which already stores configs as data
// with a lifecycle, a state history and provenance back to the greenlight that
// minted them. Building a second store for the same concept was the very
// duplication this work exists to remove, so it went. THIS gap was real and
// separate, so it stays.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// A SELECTION MUST BE LEAVEABLE (owner, 2026-08-18).
//
// A board row could be selected and never unselected: nothing in the tab took a
// selection off a run. That is not cosmetic. The stored selection changes what
// Verify, Tune and Greenlight offer and aim at, so a state the owner cannot
// leave goes on quietly steering later decisions — which is exactly how the
// stop tuner ended up aiming at a board row when the owner wanted the pilot.
//
// Driven through bracketSelect itself, not by reading the source: a clear that
// throws, or that leaves the selection in place, would pass any grep.
function aBoardSelectionCanBeCleared() {
  const batch = require(path.join(ROOT, 'lib', 'batch'));
  const id = `bracketlab-19700101-000000-cleartest`;
  const file = path.join(ROOT, 'data', 'batches', `${id}.json`);
  const row = {
    key: 'AAAUSDT|BBBUSDT|CCCUSDT|daily-4d|argmax|auto|24-7', stage: 'promoted',
    trade: 'AAAUSDT', geometry: 'daily-4d', decision: 'argmax', quorum: 1, tHours: 137,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    id, kind: 'bracketlab', status: 'done', leaders: [row], selection: null,
  }));
  try {
    let doc = batch.bracketSelect(id, { key: row.key, stage: 'promoted' });
    assert.ok(doc.selection && doc.selection.key === row.key, 'fixture did not select');

    doc = batch.bracketSelect(id, { clear: true });
    assert.strictEqual(doc.selection, null,
      'clear left the selection in place — the row goes on steering Verify, Tune and Greenlight');

    // and it must survive a reload, not just the in-memory object
    const reloaded = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(reloaded.selection, null, 'the cleared selection came back after a reload');
  } finally {
    fs.unlinkSync(file);
  }
}

module.exports = { aBoardSelectionCanBeCleared };
