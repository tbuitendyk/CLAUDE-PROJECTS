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

  // THE LIST DESCRIBES THE SCREEN THE OWNER IS LOOKING AT (owner order,
  // 2026-08-22), which is the one the box is SERVING and not the one in the
  // working tree.
  //
  // What went wrong: a control was renamed, the commit was held back from
  // deploy so a running sweep would survive, and this list then authorised a
  // name that was nowhere on the owner's screen. The rule's own tool failing in
  // the exact direction the rule exists to prevent — and it failed silently,
  // because nothing anywhere knew which screen the list was describing.
  //
  // Watched failing 2026-08-22: changing a hash in SERVED.json makes the
  // generator refuse, which fails theServedRecordMatchesTheCommitItNames;
  // regenerating with --repo puts the working tree's commit in the header and
  // fails theListSaysWhichScreenItDescribes.
  async theServedRecordMatchesTheCommitItNames() {
    const crypto = require('crypto');
    const { execFileSync } = require('child_process');
    const served = JSON.parse(fs.readFileSync(path.join(ROOT, 'SERVED.json'), 'utf8'));
    assert.ok(/^[0-9a-f]{40}$/.test(served.commit || ''),
      'SERVED.json must name the full commit the box deployed, or there is no way to read what it shows');
    assert.ok(served.files && Object.keys(served.files).length,
      'and the hash of every file the screens are drawn from, or the record proves nothing');

    for (const [rel, want] of Object.entries(served.files)) {
      let buf;
      try {
        buf = execFileSync('git', ['show', `${served.commit}:ultimate-trading-system/${rel}`],
          { cwd: path.join(ROOT, '..'), maxBuffer: 1 << 28 });
      } catch (err) {
        assert.ok(false, `the box is serving ${served.commit.slice(0, 12)} and this repository cannot read ${rel} from it`);
      }
      const got = crypto.createHash('sha256').update(buf).digest('hex');
      assert.strictEqual(got, want.sha256,
        `${rel} at ${served.commit.slice(0, 12)} is not what the box reported serving — `
        + 're-capture with vps-access/scripts/uts-served-fingerprint.sh');
      assert.strictEqual(buf.length, want.bytes, `${rel} is a different length from the served copy`);
    }

    // and it must be a commit this branch actually contains, not one from
    // somewhere else that happens to be readable
    // `--is-ancestor` says so by EXITING zero, not by printing anything: with
    // its output ignored the call returns null on success, so the answer is
    // whether it threw.
    let isAncestor = true;
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', served.commit, 'HEAD'],
        { cwd: path.join(ROOT, '..'), stdio: ['ignore', 'ignore', 'ignore'] });
    } catch (_) { isAncestor = false; }
    assert.ok(isAncestor,
      `${served.commit.slice(0, 12)} is not an ancestor of this branch — the box is serving something this `
      + 'branch does not contain, so nothing here can say what is on the screen');
  },

  // The file says which screen it is describing, so nobody has to guess.
  async theListSaysWhichScreenItDescribes() {
    const md = fs.readFileSync(path.join(ROOT, 'SCREEN-WORDS.md'), 'utf8');
    const served = JSON.parse(fs.readFileSync(path.join(ROOT, 'SERVED.json'), 'utf8'));
    assert.ok(md.includes(served.commit.slice(0, 12)),
      `SCREEN-WORDS.md does not say it was generated from ${served.commit.slice(0, 12)}, the commit the box is serving. `
      + 'Rebuild it: node tests/sweep-words.js --write');
    assert.ok(/what the box is serving/.test(md),
      'and it must say plainly that it describes the served screen rather than the working tree');
    assert.ok(/will not appear here until it is/.test(md),
      'including the consequence: a label just changed is not on the list until it is deployed');
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
      for (const x of [...g.controls, ...g.options, ...(g.dataValues || [])]) known.add(x);
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
    // Third correction, 2026-08-26: 'logreg' and 'boost' are on BOARDS — the
    // model column of the panel the inspect button opens shows them for every
    // member. They sat there as data values, which the collector could not
    // see, so this test agreed they were nowhere and the owner was told so as
    // fact — the slim blindness repeated word for word. The collector now
    // reads the values a screen prints as data from the engine, the same way
    // it reads the dropdown choices.
    const NOWHERE = ['combo'];
    // 'slim' and 'promote' became SWEEP words on 2026-08-22, when the owner
    // asked for the two passes to be drawn as two boxes and named. That is the
    // honest resolution of the whole tangle about those words: they are on the
    // screen now, so they can be used about that screen.
    const ONLY_ON = { slim: ['Boards', 'Sweep'], logreg: ['Boards'], boost: ['Boards'] };
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

  // A SCREEN IS ITS RENDERER PLUS WHAT ITS RENDERER DRAWS WITH (2026-08-23).
  //
  // The reader read one function and stopped. That was right while every screen
  // built its markup inline, and it went wrong the moment a control was shared:
  // the paging bar is drawn on four tables by one helper, so its words were on
  // the owner's screen and on no list — which under RULE ONE-A means they could
  // not be said to the owner at all.
  //
  // Following helpers turned up 71 labels beyond the bar's own five, so the
  // hole had been there a while. The opposite failure is worse and is checked
  // too: a reader that over-collects would authorise words from a screen the
  // owner is not looking at.
  async theReaderFollowsWhatARendererDrawsWith() {
    const boards = drawBody('drawBoards');
    for (const w of ['rows per page', '>first<', '>prev<', '>next<', '>last<']) {
      assert.ok(boards.includes(w),
        `the Boards reader cannot see "${w}" — it is on the screen and would be on no list`);
    }
    // A helper that draws nothing must add nothing: pulling in arithmetic
    // helpers would fill the list with words that are on no screen at all.
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    assert.ok(/if \(\/<\[a-z\]\/i\.test\(b\)\) out\.push\(b\)/.test(
      require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'screencontrols.js'), 'utf8')),
    'the reader follows helpers that draw nothing, so the list gains words no screen shows');
    assert.ok(src.length > 0);
  },

  // AND IT MUST NOT BLEED BETWEEN SCREENS. Each of these is shown on exactly
  // one tab; if following helpers started dragging one screen's words onto
  // another, the list would authorise a word the owner cannot see there —
  // which is the original fault wearing the fix.
  async oneScreensWordsDoNotLeakOntoAnother() {
    // The CONTROL LABELS and the prose, not the word list: `words` is split
    // into single tokens, so a phrase like "promote top K" is never in it and
    // the first version of this check failed on its own probe.
    const byTabWords = {};
    for (const t of tabs()) {
      const c = collect(t.fn);
      byTabWords[t.key] = [...c.controls, ...c.options, ...c.prose].join('\n').toLowerCase();
    }
    const onlyOn = { sweep: ['promote top k', 'board rows'], verify: ['run the planted check'],
      boards: ['menu grid'], greenlight: ['greenlight this config'] };
    for (const [home, words] of Object.entries(onlyOn)) {
      for (const w of words) {
        assert.ok((byTabWords[home] || '').includes(w), `"${w}" is missing from its own screen (${home})`);
        for (const [other, blob] of Object.entries(byTabWords)) {
          if (other === home) continue;
          assert.ok(!blob.includes(w),
            `"${w}" is on ${home} only, but the reader put it on ${other} as well — the list would say the `
            + 'owner can see a control there that is not there');
        }
      }
    }
  },
};
