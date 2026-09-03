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
  // The surviving Sweep's pairs (owner order, 2026-08-28: the original Sweep
  // and its two drawings are gone and this pair is the only one left, so the
  // list below is that screen's, read off it).
  ['swGeom', 'swPermGeom'], ['swDec', 'swPermDec'], ['swBand', 'swPermBand'],
  ['swEntry', 'swPermEntry'], ['swGate', 'swPermGate'], ['swD', 'swPermD'],
  ['swT', 'swPermT'], ['swTrail', 'swPermTrail'], ['swArm', 'swPermArm'],
  ['swAgreeRule', 'swPermAgreeRule'], ['swAgreeShare', 'swPermAgreeShare'],
  ['swAgreeHold', 'swPermAgreeHold'], ['swAgreeCopy', 'swPermAgreeCopy'],
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
    assert.ok(/for \(const grp of \['#swGrpGate', '#swGrpD', '#swGrpTrail'\]\) swShowGroup\(grp, !market\)/.test(PAGE),
      'the market-entry hide no longer targets the whole group — a permute tick can be left on screen for a box that is gone');
    assert.ok(/swShowGroup\('#swGrpArm'/.test(PAGE), 'the arm pair is no longer hidden as one group');
    assert.ok(!/swShowGroup\('#swPerm/.test(PAGE),
      'half-by-half hiding is back — a pair hides as one group or not at all');
  },

  // The tick that used to be shared by two agreement boxes is gone with them
  // (owner loop, 2026-08-28): the dial is one share of the committee now, so
  // each agreement control has its own permute and none of them can apply to
  // a committee that does not exist.
  async everyAgreementControlOwnsItsOwnPermute() {
    for (const [box, tick] of [['swAgreeRule', 'swPermAgreeRule'], ['swAgreeShare', 'swPermAgreeShare'],
      ['swAgreeBoth', 'swPermAgreeBoth'], ['swAgreeHold', 'swPermAgreeHold']]) {
      assert.ok(PAGE.includes(`id="${box}"`), `${box} is gone from the page`);
      assert.ok(PAGE.includes(`id="${tick}"`), `${tick} is gone from the page`);
    }
    assert.ok(!/swPermDecAgree/.test(PAGE), 'the shared agreement tick is back');
  },

  // A hidden group must close up rather than leave a hole in the row.
  async aHiddenGroupClosesUpRatherThanLeavingAGap() {
    assert.ok(/e\.style\.display = on \? 'flex' : 'none'/.test(PAGE),
      "a re-shown group must go back to 'flex', not '' — an inline default would break its own alignment");
  },

  // A BOX NOTHING IN THE BLOCK READS IS GHOSTED WITH ITS TICK (owner order,
  // 2026-09-03: "ghost arm and one voice at"). arm is read only by a stop that
  // follows the price, so with trail on static and trail's permute unticked
  // the box changed nothing and looked as if it did; one voice at is read only
  // by voices. Ghosted, never hidden: hiding is for a box that cannot exist
  // (market has no rails), and a ghosted box keeps the row's shape and its
  // value for the moment the box it waits on changes.
  async aBoxNothingInTheBlockReadsIsGhostedWithItsTick() {
    const ghost = PAGE.slice(PAGE.indexOf('function swGhostGroup('), PAGE.indexOf('function swGhostGroup(') + 400);
    assert.ok(ghost.includes("e.classList.toggle('ctl-off', !!off);"), 'a ghosted group is not greyed');
    assert.ok(ghost.includes("for (const c of e.querySelectorAll('select, input')) c.disabled = !!off;"),
      'a ghosted group is greyed but its box and tick can still be operated');
    assert.ok(!/style\.display/.test(ghost), 'ghosting hides — the row loses its shape and the value its place');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.html'), 'utf8');
    assert.ok(/\.ctl-off \{ opacity:\.5; \}/.test(css), 'the page has no rule that greys a ghosted group');
    const sync = PAGE.slice(PAGE.indexOf('async function swCounts()'), PAGE.indexOf('async function swCounts()') + 2600);
    assert.ok(sync.includes("const staticStop = $('#swTrail') && $('#swTrail').value === ''\n      && !($('#swPermTrail') && $('#swPermTrail').checked);"),
      'arm does not wait on trail being static with its permute unticked');
    assert.ok(sync.includes("swGhostGroup('#swGrpArm', staticStop);"), 'arm and its tick are not ghosted under a static stop');
    assert.ok(sync.includes("const notVoices = $('#swAgreeRule') && $('#swAgreeRule').value !== 'voices'\n      && !($('#swPermAgreeRule') && $('#swPermAgreeRule').checked);"),
      'one voice at does not wait on quorum by being something other than voices with its permute unticked');
    assert.ok(sync.includes("swGhostGroup('#swGrpCopy', notVoices);"), 'one voice at and its tick are not ghosted under count, conviction or families');
    const grp = groupAround('swAgreeCopy');
    assert.ok(grp.startsWith('<div id="swGrpCopy"'), 'one voice at and its tick are not one group, so they cannot be ghosted as one');
    assert.ok(grp.includes('id="swPermAgreeCopy"'), 'the one voice at tick is outside its group');
    // and the Help tab says so, in the words on the screen
    const sandbox = {};
    // eslint-disable-next-line no-new-func
    new Function('window', fs.readFileSync(path.join(__dirname, '..', 'public', 'help-content.js'), 'utf8'))(sandbox);
    const H = sandbox.HELP.sweep.controls;
    assert.ok(/Ghosted while trail is static/.test(H.swArm.what), 'the arm help does not say when the box is ghosted');
    assert.ok(/Ghosted unless quorum by is voices/.test(H.swAgreeCopy.what), 'the one voice at help does not say when the box is ghosted');
  },
};
