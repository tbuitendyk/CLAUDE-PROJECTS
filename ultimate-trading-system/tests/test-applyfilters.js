// FOUR FILTERS IS ONE WAIT, NOT FOUR (owner order, 2026-08-30: "instead of
// triggering a minute long operation refresh on every lost focus of a settings
// field ... the button becomes necessary to apply the settings of all of the
// fields at once").
//
// A filter used to go on the moment its box lost focus. On the owner's record
// set that is minutes each, so setting four filters meant sitting through three
// tables nobody asked to see. What has to be right, and each of which fails by
// doing nothing visible:
//
//   * the button and the tick box are on EVERY filtered table, not the two the
//     complaint happened to name;
//   * leaving a box, with the tick box clear, starts no work at all;
//   * the button is asleep until the boxes say something different from what
//     is applied — and asleep AGAIN if the old value is typed back, which is a
//     comparison against what is applied, never a "something was touched" flag;
//   * applying puts on exactly what the boxes say, so emptying a box clears it.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const JS = () => fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
const HTML = () => fs.readFileSync(path.join(ROOT, 'public', 'construct.html'), 'utf8');

// The tables that carry filters, READ from the calls rather than typed, so a
// table added tomorrow is covered without anybody remembering to add it here.
const gridKeys = (src) => [...new Set([...src.matchAll(/bFilterGrid\('([A-Z0-9]+)'/g)].map((m) => m[1]))];

// Pulled out of the source and run for real: a regex can say the comparison is
// written, only running it can say it answers correctly.
function theComparison() {
  const src = JS();
  const from = src.indexOf('const bSameFilters = (a, b) => {');
  assert.ok(from > 0, 'nothing compares the boxes to what is applied');
  const text = src.slice(from, src.indexOf('\n};\n', from) + 4);
  // eslint-disable-next-line no-eval
  return eval(`${text}; bSameFilters`);
}

module.exports = {
  async everyFilteredTableCanBePutOnInOneGo() {
    const src = JS();
    const keys = gridKeys(src);
    assert.ok(keys.length >= 4, `expected the four filtered tables, found ${keys.length}: ${keys}`);
    const grid = src.slice(src.indexOf('function bFilterGrid('), src.indexOf('function bWireFilters('));
    assert.ok(/data-bapply="\$\{key\}"/.test(grid),
      'a filtered table has no way to put its boxes on in one go, so every box is its own wait');
    assert.ok(/data-bauto="\$\{key\}"/.test(grid),
      'there is no way to turn the one-at-a-time behaviour back on');
    assert.ok(/>apply settings</.test(grid) && />\s*auto-apply settings</.test(grid),
      'the two controls are not named on the screen');
    // KEYED PER TABLE. One shared name and Stage 1's button would put Stage 3's
    // boxes on — and the two are read from different halves of the page.
    assert.ok(/bAuto\(key\)/.test(grid),
      'the tick box is not remembered per table, so one table\'s choice speaks for all four');
  },

  async theButtonIsAsleepUntilThereIsSomethingToPutOn() {
    const src = JS();
    const grid = src.slice(src.indexOf('function bFilterGrid('), src.indexOf('function bWireFilters('));
    assert.ok(/data-bapply="\$\{key\}" disabled/.test(grid),
      'the button is drawn awake, so it invites a press that would redraw the table for no change');
    const st = src.slice(src.indexOf('function bApplyState('), src.indexOf('function bApplyFilters('));
    assert.ok(/bSameFilters\(bBoxesNow\(root, key\), bFilters\(key\)\)/.test(st),
      'the button is not comparing the boxes against what is applied — so typing a value back to '
      + 'what it already was would leave the button awake with nothing to do');
    assert.ok(/bAuto\(key\) \|\|/.test(st),
      'the button stays pressable while auto-apply settings is on, where it can only repeat work');
  },

  // The comparison itself, run rather than read.
  async typingTheOldValueBackIsNotAChange() {
    const same = theComparison();
    assert.strictEqual(same({}, {}), true, 'two empty sets of filters differ');
    assert.strictEqual(same({ a: '5' }, { a: '5' }), true, 'the same filter reads as changed');
    assert.strictEqual(same({ a: 5 }, { a: '5' }), true,
      'a box holds text and the store may hold a number — the same filter must not read as changed');
    assert.strictEqual(same({ a: '5' }, { a: '6' }), false, 'a changed filter reads as unchanged');
    assert.strictEqual(same({ a: '5' }, {}), false, 'a filter added reads as unchanged');
    assert.strictEqual(same({}, { a: '5' }), false, 'a filter emptied reads as unchanged');
    assert.strictEqual(same({ a: '5', b: '1' }, { a: '5', c: '1' }), false,
      'two different filters of the same count read as the same');
  },

  async leavingABoxStartsNoWorkUnlessAutoApplyIsTicked() {
    const src = JS();
    const wire = src.slice(src.indexOf('function bWireFilters('), src.indexOf('function bWireFilters(') + 1600);
    assert.ok(/el\.onchange = \(\) => \{ if \(bAuto\(key\)\) bApplyFilters\(root, key\); else bApplyState\(root, key\); \};/.test(wire),
      'leaving a box still puts its filter on whatever the tick box says, which is the minutes-per-box '
      + 'behaviour the button exists to end');
    assert.ok(/el\.oninput = \(\) => \{ if \(!bAuto\(key\)\) bApplyState\(root, key\); \};/.test(wire),
      'the button only reconsiders when a box is LEFT, so it cannot wake on the first keystroke or '
      + 'sleep again the moment the old value is typed back');
  },

  async applyingPutsOnExactlyWhatTheBoxesSay() {
    const src = JS();
    const set = src.slice(src.indexOf('function bSetFilters('), src.indexOf('const bAuto ='));
    assert.ok(/all\[key\] = \{ \.\.\.next \};/.test(set),
      'applying MERGES over what was already applied, so a box the owner emptied keeps filtering the '
      + 'table and nothing on screen says why');
    const ap = src.slice(src.indexOf('function bApplyFilters('), src.indexOf('function bApplyFilters(') + 420);
    assert.ok(/bSetFilters\(key, bBoxesNow\(root, key\)\)/.test(ap),
      'applying does not read the boxes, so it puts on something other than what is on screen');
    assert.ok(/from\$\{key\}`\]: 0/.test(ap),
      'applying leaves the table on the page it was on, which can be past the end of a smaller result');
  },

  async tickingAutoApplyPutsOnWhatIsAlreadyTyped() {
    const src = JS();
    const cb = src.slice(src.indexOf("querySelectorAll('[data-bauto]')"), src.indexOf("querySelectorAll('[data-bauto]')") + 700);
    assert.ok(/bSaveAuto\(key, cb\.checked\)/.test(cb), 'the tick box is not remembered');
    assert.ok(/if \(cb\.checked && !bSameFilters\(bBoxesNow\(root, key\), bFilters\(key\)\)\) bApplyFilters/.test(cb),
      'ticking auto-apply settings leaves anything already typed unapplied in a box whose button has '
      + 'just been greyed out — it looks applied and is not');
  },

  async theTwoStageThreeTablesDoNotRunIntoEachOther() {
    const src = JS();
    const html = HTML();
    const a = src.indexOf('Table 3.A: Settings, ranked');
    const b = src.indexOf('Table 3.B: Every coin of every setting');
    assert.ok(a > 0 && b > a, 'the two Stage 3 tables are not where this expects them');
    const between = src.slice(a, b);
    assert.ok(/t3break/.test(between),
      'nothing separates the two Stage 3 tables, so the second heading reads as another note under the first');
    for (const [n, i] of [['3.A', a], ['3.B', b]]) {
      assert.ok(/class="t3head"/.test(src.slice(i - 40, i)),
        `the Table ${n} heading is the same size as the notes around it, so it does not read as the name of a table`);
    }
    assert.ok(/\.t3head \{ font-size:1\.05rem;/.test(html), 'the table headings have no size of their own');
    assert.ok(/\.t3break \{ border-top:/.test(html), 'the break between the two tables draws nothing');
  },
};
