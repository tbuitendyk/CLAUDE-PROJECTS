// THE SWEEP TAB'S WORD LIST MUST MATCH THE SCREEN (owner order, 2026-08-21).
//
// SWEEP-WORDS.md is the only vocabulary permitted when talking about that
// screen. A list that has fallen behind the page is worse than no list: it
// would authorise a word the owner cannot see, which is the exact failure it
// was created to stop.
//
// So it is GENERATED, never typed, and this fails the moment it is stale.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const { collect } = require('./sweep-words');

const ROOT = path.join(__dirname, '..');

module.exports = {
  async theListIsNotStale() {
    const md = fs.readFileSync(path.join(ROOT, 'SWEEP-WORDS.md'), 'utf8');
    const got = collect();
    for (const label of got.controls) {
      assert.ok(md.includes(`\`${label}\``),
        `the Sweep tab shows "${label}" and the word list does not have it. `
        + 'Rebuild it: node tests/sweep-words.js --write');
    }
    for (const opt of got.options) {
      assert.ok(md.includes(`\`${opt}\``),
        `the "${opt}" choice is on screen and missing from the word list. `
        + 'Rebuild it: node tests/sweep-words.js --write');
    }
  },

  // The list must not authorise a word that is NOT on screen either.
  async theListHasNothingTheScreenDoesNot() {
    const md = fs.readFileSync(path.join(ROOT, 'SWEEP-WORDS.md'), 'utf8');
    const got = collect();
    const known = new Set([...got.controls, ...got.options]);
    const listed = [...md.matchAll(/^- `(.+)`$/gm)].map((m) => m[1]);
    const extra = listed.filter((x) => !known.has(x));
    assert.deepStrictEqual(extra, [],
      `the word list offers labels the Sweep tab does not show: ${extra.join(', ')}. `
      + 'Rebuild it: node tests/sweep-words.js --write');
  },

  // The words that have actually caused trouble must not be in it.
  async theInternalNamesThatBurnedUsAreNotInTheList() {
    const got = collect();
    const flat = new Set(got.words.map((w) => w.toLowerCase()));
    for (const bad of ['logreg', 'boost', 'combo', 'slim', 'promoted']) {
      assert.ok(!flat.has(bad),
        `"${bad}" is in the Sweep tab's word list, so it would be treated as a name the owner can see`);
    }
  },
};
