// EVERY SCREEN'S WORD LIST MUST MATCH THE SCREEN (owner order, 2026-08-21).
//
// SCREEN-WORDS.md is the only vocabulary permitted when talking about these
// screens. A list that has fallen behind the page is worse than no list: it
// would authorise a word the owner cannot see, which is the exact failure it
// was created to stop.
//
// So it is GENERATED, never typed, and this fails the moment it is stale.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const { collect, tabs } = require('./sweep-words');

const ROOT = path.join(__dirname, '..');

module.exports = {
  // EVERY tab, not just one. A list for one screen leaves every other screen a
  // place where a name can still be invented.
  async theListIsNotStale() {
    const md = fs.readFileSync(path.join(ROOT, 'SCREEN-WORDS.md'), 'utf8');
    for (const t of tabs()) {
      let got;
      try { got = collect(t.fn); } catch (err) {
        assert.ok(false, `the ${t.label} tab could not be read (${err.message}) — its words are unchecked`);
      }
      for (const label of got.controls) {
        assert.ok(md.includes(`\`${label}\``),
          `the ${t.label} tab shows "${label}" and the word list does not have it. `
          + 'Rebuild it: node tests/sweep-words.js --write');
      }
      for (const opt of got.options) {
        assert.ok(md.includes(`\`${opt}\``),
          `the "${opt}" choice is on the ${t.label} tab and missing from the word list. `
          + 'Rebuild it: node tests/sweep-words.js --write');
      }
    }
  },

  // A tab with no list at all is the gap this was built to close.
  async everyTabHasALisT() {
    const md = fs.readFileSync(path.join(ROOT, 'SCREEN-WORDS.md'), 'utf8');
    for (const t of tabs()) {
      assert.ok(new RegExp(`^# ${t.label}$`, 'm').test(md),
        `the ${t.label} tab has no word list — that screen is still a place where a name can be invented`);
    }
  },

  // The list must not authorise a word that is NOT on screen either.
  async theListHasNothingTheScreenDoesNot() {
    const md = fs.readFileSync(path.join(ROOT, 'SCREEN-WORDS.md'), 'utf8');
    const known = new Set();
    for (const t of tabs()) {
      const g = collect(t.fn);
      for (const x of [...g.controls, ...g.options]) known.add(x);
    }
    const listed = [...md.matchAll(/^- `(.+)`$/gm)].map((m) => m[1]);
    const extra = listed.filter((x) => !known.has(x));
    assert.deepStrictEqual(extra, [],
      `the word list offers labels no tab shows: ${extra.join(', ')}. `
      + 'Rebuild it: node tests/sweep-words.js --write');
  },

  // The words that have actually caused trouble must not be in it.
  async theInternalNamesThatBurnedUsAreNotInTheList() {
    const flat = new Set();
    for (const t of tabs()) for (const w of collect(t.fn).words) flat.add(w.toLowerCase());
    // ONLY the ones that appear on NO tab. Checked, and the check corrected me:
    // 'promoted' is on Verify, 'committee' on Boards and Tune, 'member' on
    // Boards, 'cell' on History and Greenlight — all real names on those
    // screens, and none of them on Sweep. A word can be legal on one screen and
    // forbidden on another, which is why the lists are per tab.
    for (const bad of ['logreg', 'boost', 'combo', 'slim']) {
      assert.ok(!flat.has(bad),
        `"${bad}" is in a screen's word list, so it would be treated as a name the owner can see`);
    }
  },
};
