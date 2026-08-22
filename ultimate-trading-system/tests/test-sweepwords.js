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
const { collect, tabs, drawBody, htmlTemplates } = require('./sweep-words');

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

  // THE CHECK THAT WAS MISSING, and it is the one that matters (owner asked
  // what the gap meant, 2026-08-22).
  //
  // theListIsNotStale walks from the LIST to the page: everything the collector
  // found must appear in the file. That catches a stale file. It cannot catch a
  // collector that never found the words in the first place — and that is
  // exactly what had happened. 87 of the 221 labels plainly visible between
  // tags were absent from the lists, the Boards "order by" choices among them,
  // because the collector threw away everything inside `${...}` and every
  // conditional section of every screen is written inside one.
  //
  // This walks the other way: from the PAGE to the list. Any run of text
  // sitting plainly between two tags, with no interpolation in it, is something
  // a person can read on the screen, so every word of it has to be on that
  // tab's list. It does not depend on the collector's own idea of what the page
  // is, which is what makes it able to catch the collector being wrong.
  async theWordListSeesEveryVisibleLabel() {
    const missing = [];
    for (const t of tabs()) {
      const raw = htmlTemplates(drawBody(t.fn)).join('\n');
      const seen = new Set();
      // `(?<!=)` because the > of an arrow function is not a closing tag, and
      // the code after one is not something anybody reads on a screen.
      for (const m of raw.matchAll(/(?<!=)>([^<>${}`]{2,})</g)) {
        for (const w of m[1].split(/[^A-Za-z0-9%/.\-]+/)) {
          if (w && /[A-Za-z]/.test(w) && w.length > 1) seen.add(w);
        }
      }
      const have = new Set(collect(t.fn).words);
      for (const w of seen) if (!have.has(w)) missing.push(`${t.label}: "${w}"`);
    }
    assert.deepStrictEqual(missing, [],
      'these words are plainly visible on a screen and are on no word list, so the rule that '
      + 'says the list is the only permitted vocabulary would forbid a word the owner can see:\n  '
      + missing.join('\n  '));
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

  // The words that have actually caused trouble, and WHERE each one is really
  // allowed. Checked mechanically, and the check has now corrected this entry
  // twice.
  //
  // First time: 'promoted' is on Verify, 'committee' on Boards and Tune,
  // 'member' on Boards, 'cell' on History and Greenlight — all real names on
  // those screens and none of them on Sweep.
  //
  // Second time, 2026-08-22: 'slim' is on BOARDS, in the run's plan line —
  // "N units · N slim runs · N promote runs". It has been on that screen all
  // along; the collector could not see it, so this test happily agreed that it
  // was nowhere and I went on telling the owner it was a word they could not
  // see. That is the same fault as inventing a name, pointing the other way,
  // and it is exactly what a list you cannot trust does to you.
  //
  // A word can be legal on one screen and forbidden on another. The list is the
  // authority; this records where each of these stands.
  async theInternalNamesThatBurnedUsAreOnlyWhereTheScreenPutsThem() {
    const NOWHERE = ['logreg', 'boost', 'combo'];
    const ONLY_ON = { slim: ['Boards'] };
    const where = {};
    for (const t of tabs()) {
      for (const w of collect(t.fn).words) {
        const k = w.toLowerCase();
        (where[k] = where[k] || new Set()).add(t.label);
      }
    }
    for (const bad of NOWHERE) {
      const tabsWithIt = [...(where[bad] || [])];
      assert.deepStrictEqual(tabsWithIt, [],
        `"${bad}" is on ${tabsWithIt.join(', ')} and this test says it is nowhere. `
        + 'One of the two is wrong — check the screen, then fix whichever it is.');
    }
    for (const [word, allowed] of Object.entries(ONLY_ON)) {
      const tabsWithIt = [...(where[word] || [])].sort();
      assert.deepStrictEqual(tabsWithIt, allowed.slice().sort(),
        `"${word}" is on ${tabsWithIt.join(', ') || 'no screen'} and this test expects ${allowed.join(', ')}. `
        + 'If the screen changed, change this and the table in CLAUDE.md together.');
    }
  },
};
