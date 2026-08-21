// THE REFRESH STATUS SITS BESIDE THE BUTTON (owner, 2026-08-21).
//
// While a Global Refresh ran, "working…" appeared at the foot of the page,
// away from the control doing the work. The owner asked for it beside the
// button and vertically centred on it.
//
// Why this needs pinning rather than just doing: the row it lives in is
// deliberately BOTTOM-aligned, because the controls to its left are a label
// stacked above an input and it is their bottom edges that should agree.
// Dropping the status straight into that row would sit it on the same bottom
// edge — beside the button but not level with it, which is the "make it line
// up" correction RULE FOUR says the owner should never have to ask for. The
// group that holds the button and the status is what centres them on each
// other, and that is the part a later edit could quietly undo.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');

// The element that holds them both: from the opening tag of the group down to
// the matching close, found by counting rather than guessing at the markup.
function groupAround(id) {
  const at = PAGE.indexOf(`id="${id}"`);
  assert.ok(at > 0, `${id} is gone`);
  let open = PAGE.lastIndexOf('<div', at);
  let depth = 0;
  for (let i = open; i < PAGE.length; i++) {
    if (PAGE.startsWith('<div', i)) depth++;
    else if (PAGE.startsWith('</div>', i)) { depth--; if (depth === 0) return PAGE.slice(open, i + 6); }
  }
  return '';
}

module.exports = {
  async theStatusIsInsideTheSameGroupAsTheButton() {
    const group = groupAround('dlRefreshAll');
    assert.ok(/id="dlOut"/.test(group),
      'the refresh status is no longer beside the Global Refresh button — it has gone back to standing on its own below the controls');
  },

  // Beside is not enough; the owner asked for centred.
  async thatGroupCentresThemOnEachOther() {
    const group = groupAround('dlRefreshAll');
    const openTag = group.slice(0, group.indexOf('>') + 1);
    assert.ok(/align-items:\s*center/.test(openTag),
      `the group holding the button and its status does not centre them on each other: ${openTag}`);
  },

  // The row is bottom-aligned on purpose and that must not be "tidied away":
  // the label-above-input controls to the left need their bottom edges to agree.
  async theRowItSitsInStaysBottomAligned() {
    const at = PAGE.indexOf('id="dlPairs"');
    assert.ok(at > 0, 'the download row is gone');
    const rowTag = PAGE.slice(PAGE.lastIndexOf('<div', at), at);
    assert.ok(/align-items:\s*flex-end/.test(rowTag),
      'the download row lost its bottom alignment — the buttons will no longer line up with the inputs beside them');
  },

  // A long status must grow downward inside the group, not shove the group
  // onto a line of its own, which would put it underneath again.
  async aLongStatusCannotPushTheGroupOntoItsOwnLine() {
    const group = groupAround('dlRefreshAll');
    const openTag = group.slice(0, group.indexOf('>') + 1);
    assert.ok(/min-width:\s*0/.test(openTag),
      'the group cannot shrink, so a long status will wrap it onto its own line and the status ends up below the button again');
  },

  // Everything that reports into it still reaches it.
  async everythingThatReportsStillWritesToTheSamePlace() {
    assert.ok(/const dsStatus = \(m\) => \{ const e = \$\('#dlOut'\);/.test(PAGE),
      'the status writer no longer targets #dlOut');
    assert.strictEqual((PAGE.match(/id="dlOut"/g) || []).length, 1,
      'there is more than one status element now — two places to look is worse than one in the wrong place');
  },
};
