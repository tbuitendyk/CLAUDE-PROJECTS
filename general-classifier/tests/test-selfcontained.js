// THE PRODUCT CONTAINS ITS OWN EXECUTION COMPONENT (owner, 2026-08-24).
//
// The code that places real orders used to live only on the vps-access branch —
// a different project, deployed by a script the product could not see. So the
// product could ship "complete" while the piece that actually trades was
// missing, untested here, and unknown to the project lead. A real defect was
// found and fixed in that off-product copy on 2026-08-24; nothing in this repo
// could have caught it.
//
// These checks make the dependency impossible to reintroduce quietly.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const EXEC = path.join(ROOT, 'executor', 'mx_executor.py');

function theExecutorShipsInsideTheProduct() {
  assert.ok(fs.existsSync(EXEC),
    'executor/mx_executor.py is missing — the component that places real orders must live IN '
  + 'the product, not on another branch');
  const src = fs.readFileSync(EXEC, 'utf8');
  assert.ok(src.length > 50000,
    `the executor is only ${src.length} bytes — a stub is not the component`);
}

function theRecordedHashMatchesTheFile() {
  const recorded = fs.readFileSync(path.join(ROOT, 'executor', 'EXECUTOR-SHA256'), 'utf8').trim();
  const actual = crypto.createHash('sha256').update(fs.readFileSync(EXEC)).digest('hex');
  assert.strictEqual(actual, recorded,
    'executor/EXECUTOR-SHA256 does not match executor/mx_executor.py. Either the executor was '
  + 'edited without updating the hash, or a divergent copy landed here. The hash exists so the '
  + 'deployment mirror on vps-access can be PROVEN byte-identical rather than assumed to be.');
}

function theExecutorStillBorrowsBeforeItSellsAShort() {
  // The 2026-08-24 defect, guarded at the product level: a short must take out
  // its own loan. Auto-borrow covers only the shortfall and would sell a
  // concurrent long's coin instead.
  const src = fs.readFileSync(EXEC, 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(/def borrow_base\(/.test(code),
    'the executor has lost borrow_base() — a short would fall back on auto-borrow and sell a '
  + "concurrent long's inventory");
  assert.ok(/margin\/loan/.test(code), 'the explicit loan call is gone');
  assert.ok(!/side_eff\s*=\s*"NO_SIDE_EFFECT" if .* else "MARGIN_BUY"/.test(code),
    'the entry has reverted to auto-borrow for shorts — this is the exact 2026-08-24 regression');
}

module.exports = {
  theExecutorShipsInsideTheProduct,
  theRecordedHashMatchesTheFile,
  theExecutorStillBorrowsBeforeItSellsAShort,
};
