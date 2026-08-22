// A DROPDOWN AND ITS "permute" TICK ARE ONE CONTROL (owner, 2026-08-21).
//
// Every box and every permute beside it was a separate item in one wrapping
// row. Three consequences, all of them what the owner saw as "ugly":
//
//   * On wrap, a permute could land on a different line from the box it
//     belongs to, next to a box it has nothing to do with.
//   * The pairs did not line up with each other.
//   * Hiding one half left the other behind — a tick for a control that was
//     not on screen.
//
// RULE FOUR: a control belongs to its label and its field, and they line up
// together or the control is broken. Each pair is now one group, and the group
// is what wraps, aligns and hides.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');

// The group element that encloses a given control id.
function groupAround(id) {
  const at = PAGE.indexOf(`id="${id}"`);
  assert.ok(at > 0, `${id} is gone from the page`);
  const open = PAGE.lastIndexOf('<div', at);
  let depth = 0;
  for (let i = open; i < PAGE.length; i++) {
    if (PAGE.startsWith('<div', i)) depth++;
    else if (PAGE.startsWith('</div>', i)) { depth--; if (depth === 0) return PAGE.slice(open, i + 6); }
  }
  return '';
}

// box id -> the permute tick that belongs to it.
const PAIRS = [
  ['swGeom', 'swPermGeom'], ['swDec', 'swPermDec'], ['swBand', 'swPermBand'],
  ['swWeekdays', 'swPermWk'], ['swDecEntry', 'swPermDecEntry'], ['swDecGate', 'swPermDecGate'],
  ['swDecD', 'swPermDecD'], ['swDecT', 'swPermDecT'], ['swDecTrail', 'swPermDecTrail'],
  ['swDecArm', 'swPermDecArm'], ['swDecQ6', 'swPermDecAgree'], ['swDecQ8', 'swPermDecAgree'],
];

module.exports = {
  // The one that stops a tick drifting away from its box on a narrow window.
  async eachPermuteSitsInTheSameGroupAsItsBox() {
    for (const [box, tick] of PAIRS) {
      const group = groupAround(box);
      assert.ok(group.includes(`id="${tick}"`),
        `the "permute" tick ${tick} is not in the same group as ${box} — on a narrow window it can wrap onto a different line, beside a control it has nothing to do with`);
    }
  },

  async everyPairLinesUpAlongItsBottomEdge() {
    for (const [box] of PAIRS) {
      const group = groupAround(box);
      const openTag = group.slice(0, group.indexOf('>') + 1);
      assert.ok(/align-items:\s*flex-end/.test(openTag),
        `the group holding ${box} does not line its parts up along the bottom: ${openTag.slice(0, 120)}`);
    }
  },

  // Hiding must take the pair, not one half of it.
  async hidingTakesTheWholePair() {
    assert.ok(/for \(const grp of \['#swGrpGate', '#swGrpD', '#swGrpTrail'\]\) show\(grp, !market\)/.test(PAGE),
      'the market-entry hide no longer targets the whole group — a permute tick can be left on screen for a box that is gone');
    assert.ok(/show\('#swGrpArm'/.test(PAGE), 'the arm pair is no longer hidden as one group');
    assert.ok(!/show\('#swPermDecGateWrap'/.test(PAGE),
      'the old half-by-half hiding is back');
  },

  // A tick offering to try every agreement level when there is no agreement
  // level to set (owner, 2026-08-21). This one is shared by two dropdowns, so
  // the groups did not cover it: it is only dead when BOTH are.
  async theSharedAgreeTickIsDeadWhenBothItsBoxesAre() {
    assert.ok(/const noSingles = !\$\('#swSingles'\)\.checked;/.test(PAGE)
      && /const noContexts = !\(\$\('#swDoubles'\)\.checked \|\| \$\('#swTriples'\)\.checked\);/.test(PAGE),
    'the two conditions that ghost the agreement boxes are gone');
    assert.ok(/const dead = noSingles && noContexts;/.test(PAGE),
      'the shared "permute" tick is not tied to BOTH agreement boxes being off');
    assert.ok(/\$\('#swPermDecAgree'\)\.disabled = dead;/.test(PAGE),
      'the shared "permute" tick can still be ticked when neither agreement box can be set');
    assert.ok(/permWrap\.classList\.toggle\('ctl-off', dead\)/.test(PAGE),
      'the shared "permute" tick is not greyed out with its boxes');
  },

  // A hidden group must close up rather than leave a hole in the row.
  async aHiddenGroupClosesUpRatherThanLeavingAGap() {
    assert.ok(/e\.style\.display = on \? 'flex' : 'none'/.test(PAGE),
      "a re-shown group must go back to 'flex', not '' — an inline default would break its own alignment");
  },
};
