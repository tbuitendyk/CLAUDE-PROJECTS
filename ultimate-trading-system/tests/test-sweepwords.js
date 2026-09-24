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
      // A CHOICE THAT IS THE WHOLE TEXT OF AN ELEMENT IS VISIBLE TOO (3.241.5,
      // owner: "fix the word list hole GO NOW!"). `>${open ? 'Put away' : 'Open'}<`
      // prints one of its two words, and this check could not see either: it
      // read only text with no interpolation in it, so the Open / Put away
      // button was on the owner's screen, on no list, and nothing failed. Read
      // here by its own pattern, not the collector's walker: a quoted string
      // straight after a choice's `?` or `:`, in an interpolation that is all
      // an element holds.
      for (const m of raw.matchAll(/(?<!=)>\s*\$\{([^{}`<>]*)\}\s*</g)) {
        for (const c of m[1].matchAll(/(?<![?])[?:](?![?.])\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
          for (const w of c[2].replace(/&[#\w]+;/g, ' ').split(/[^A-Za-z0-9%/.\-]+/)) {
            if (w && /[A-Za-z]/.test(w) && w.length > 1) seen.add(w);
          }
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

  // EVERY HELPER A SCREEN CALLS THAT DRAWS SOMETHING REACHES ITS READER
  // (3.241.5). The reader cut an arrow helper written as one expression --
  // `const putAwayBtn = (...) => \`<button ...\`` -- at the first { after its
  // name, which is the { of its first ${...}; it got `{attr}`, found no markup
  // and skipped it, so the Open / Put away button was on three screens and on
  // no list. Both directions of every other check read through that same
  // reader, so none of them could see it. This cuts each helper its own way --
  // from its first line to the next line that starts in the first column --
  // and asks that the first line of markup it draws is in what the reader
  // collected for every screen that calls it.
  async everyHelperAScreenCallsReachesItsReader() {
    const { servedSourceForTests } = require('./sweep-words');
    const S = servedSourceForTests();
    const own = new Map();
    for (const m of S.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|^const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm)) {
      const name = m[1] || m[2];
      if (own.has(name)) continue;
      const rest = S.slice(m.index);
      const end = rest.slice(1).search(/\n[^\s}\])]/);
      own.set(name, end < 0 ? rest : rest.slice(0, end + 1));
    }
    const screens = new Set(['draw', ...tabs().map((t) => t.fn)]);
    const missed = [];
    for (const t of tabs()) {
      const body = drawBody(t.fn);
      for (const [name, text] of own) {
        if (screens.has(name) || !new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\s*\\(`).test(body)) continue;
        const line = text.split('\n').find((l) => /<[a-z]/i.test(l));
        if (!line) continue;
        const markup = line.slice(line.search(/<[a-z]/i)).trim();
        if (!body.includes(markup)) missed.push(`${t.label}: ${name}() draws "${markup.slice(0, 70)}"`);
      }
    }
    assert.deepStrictEqual(missed, [],
      'a screen calls these helpers and they draw something, and the reader never saw what they draw — '
      + 'so their words are on the owner\'s screen and on no list:\n  ' + missed.join('\n  '));
  },

  // EVERY CHOICE A CONTROL OFFERS IS ON A LIST (owner order, 2026-08-29:
  // "GO NOW!" on the report that Boards said it had none).
  //
  // Boards' list read "What the dropdowns offer (0)" while Table 3.A carried
  // three of them. The collector only knew two ways a choice could exist —
  // literal <option> markup, and a vocabOptions() call — and the filter grid
  // uses neither: it takes a plain list of strings and draws the markup
  // itself. Nine choices the owner can pick were on no list, and under
  // RULE ONE-A that forbids naming any of them.
  //
  // THIS DOES NOT GO THROUGH THE COLLECTOR, and that is the whole point: it
  // reads the served source itself. A check that asks the collector what the
  // choices are cannot notice the collector missing some — which is exactly
  // how this sat unseen.
  async everyChoiceAControlOffersIsOnAList() {
    const md = fs.readFileSync(path.join(ROOT, 'SCREEN-WORDS.md'), 'utf8');
    const { servedSourceForTests } = require('./sweep-words');
    const src = servedSourceForTests();
    const missing = [];
    // a filter grid spec: [key, label, 'pick', hover, [ ...choices ]]
    for (const m of src.matchAll(/'pick',\s*(?:'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|[^[]|\n)*?\[([^\]]*)\]/g)) {
      for (const c of m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
        const choice = c[1].trim();
        if (choice && !md.includes(`\`${choice}\``)) missing.push(choice);
      }
    }
    // a control that reads the engine's own list at draw time
    const vocab = require('../lib/vocabulary');
    const served = typeof vocab.vocabulary === 'function' ? vocab.vocabulary() : vocab;
    for (const m of src.matchAll(/\bVOCAB\.([A-Za-z_$][\w$]*)/g)) {
      for (const o of (served[m[1]] || [])) {
        if (!md.includes(`\`${o.label}\``)) missing.push(`${m[1]}: ${o.label}`);
      }
    }
    assert.deepStrictEqual([...new Set(missing)], [],
      'these are choices a control on some screen offers, and they are on no word list — so the rule that says '
      + 'the list is the only permitted vocabulary would forbid naming a choice the owner can pick:\n  '
      + [...new Set(missing)].join('\n  ')
      + '\n     Rebuild it: node tests/sweep-words.js --write');
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
  // THE TABLE IN CLAUDE.md IS HELD TO THE GENERATOR, ROW BY ROW (3.187.0,
  // owner order: "whatever needs to be addressed for points four and five,
  // make sure that you do address them and correct those issues").
  //
  // RULE ONE-A's table of proved-forbidden words says, for each one, which
  // screens it is legal on. It has been WRONG SIX TIMES, every time because a
  // row was typed from memory: three of them told the owner a word was one
  // they could not see when it was on the screen in front of them, one left two
  // words marked legal on screens deleted that morning, one named a screen that
  // no longer exists at all, and one the file itself admitted to and left
  // standing. The rule's own words are "a rule that depends on remembering is
  // not a rule" -- so the table stops depending on it here.
  //
  // Each row is `| \`word\`, \`word\` | **Tab**, **Tab** | ... |`, or
  // **nowhere**. This reads those two columns and holds them to what the
  // generator finds, in both directions: a screen the row claims and the word
  // is not on, and a screen the word is on and the row does not claim.
  async theForbiddenWordsTableInClaudeMdMatchesTheGenerator() {
    const md = path.join(ROOT, '..', 'CLAUDE.md');
    if (!fs.existsSync(md)) return;            // the file is one level up; nothing to hold if it is not there
    const text = fs.readFileSync(md, 'utf8');
    const where = {};
    for (const t of tabs()) {
      for (const w of collect(t.fn).words) {
        const k = String(w).toLowerCase();
        (where[k] = where[k] || new Set()).add(t.label);
      }
    }
    const real = new Set(tabs().map((t) => t.label));
    const wrong = [];
    // the rows of the one table whose first column is backticked words and
    // whose second says where they are legal
    for (const line of text.split('\n')) {
      const m = line.match(/^\|\s*((?:`[^`]+`(?:,\s*)?)+)\s*\|\s*([^|]+?)\s*\|/);
      if (!m) continue;
      const words = [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1].toLowerCase());
      const col = m[2];
      const claimed = /\*\*nowhere\*\*/i.test(col) ? [] : [...col.matchAll(/\*\*([A-Za-z][A-Za-z -]*)\*\*/g)].map((x) => x[1].trim());
      // a screen named in the table that is not a screen any more
      for (const c of claimed) if (!real.has(c)) wrong.push(`the row for ${words.map((w) => `\`${w}\``).join(', ')} names "${c}", which is not a tab`);
      for (const w of words) {
        const got = [...(where[w] || [])].sort();
        const want = claimed.slice().sort();
        if (got.join(',') !== want.join(',')) {
          wrong.push(`\`${w}\` is on ${got.join(', ') || 'no screen'} and the table says ${want.join(', ') || 'nowhere'}`);
        }
      }
    }
    assert.deepStrictEqual(wrong, [],
      'RULE ONE-A\'s table of proved-forbidden words disagrees with the screens it describes. '
      + 'A table with a false row is the fault that rule exists to end, because the rule says the table is the authority:\n  '
      + wrong.join('\n  '));
  },

  async theInternalNamesThatBurnedUsAreOnlyWhereTheScreenPutsThem() {
    // Third correction, 2026-08-26: 'logreg' and 'boost' are on BOARDS — the
    // model column of the panel the inspect button opens shows them for every
    // member. They sat there as data values, which the collector could not
    // see, so this test agreed they were nowhere and the owner was told so as
    // fact — the slim blindness repeated word for word. The collector now
    // reads the values a screen prints as data from the engine, the same way
    // it reads the dropdown choices.
    // Fourth correction, 2026-08-28: 'slim' is on NO screen again. The two
    // boxes that named it were on the deleted Sweep, and the plan line that
    // named it was on the deleted Boards. It went back to being an internal
    // word the same day the screens went, so it is in NOWHERE — and read back
    // out of the generator, never typed.
    const NOWHERE = ['combo', 'slim'];
    // 'logreg' and 'boost' are named ON PURPOSE on both surviving screens —
    // Sweep says which kind of member each stage trains, and Boards shows them
    // per member — because the owner asked, of the old page, why the model in
    // use was being kept dark. Placements below were read back out of the
    // generator, not typed from memory: typing them is how this table has been
    // wrong three times.
    const ONLY_ON = { logreg: ['Sweep', 'Boards'], boost: ['Sweep', 'Boards'] };
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
  // AND IT FOLLOWS THEM AS FAR AS THEY GO (2026-08-28). One level was enough
  // while a screen called its helpers directly. Boards does not: it draws its
  // three stage tables through bDrawStage1/2/3, and each of those draws its
  // paging bar through bPager — two hops away. At one level the bar was
  // invisible all over again, so `Prev`, `Next` and the "N rows · page X of Y"
  // line were on the owner's screen and on no list. Both directions of the
  // check read through the same reader, so neither could see the hole.
  async theReaderFollowsWhatARendererDrawsWith() {
    const boards = drawBody('drawBoards');
    for (const w of ['>Prev<', '>Next<', 'rows · page']) {
      assert.ok(boards.includes(w),
        `the Boards reader cannot see "${w}" — it is on the screen and would be on no list`);
    }
    // A HELPER THAT NAMES THE CHOICES A CONTROL OFFERS IS PART OF THE SCREEN
    // (2026-08-29), even when it emits no markup at all. The gate box decides
    // its four choices in exactly such a helper, and they were on no list.
    assert.ok(boards.includes('VOCAB.gate') && boards.includes('does not apply'),
      'the Boards reader cannot see the gate box\'s choices — they are on the screen and would be on no list');

    // ...AND NOTHING MORE THAN THAT. Pulling in arithmetic helpers would fill
    // the list with words that are on no screen at all, which authorises
    // inventions just as surely as a missing word forbids a real name.
    // Checked by BEHAVIOUR, not by pinning the line: money() formats a number,
    // draws nothing, names no choice, and must stay out.
    assert.ok(!boards.includes("Number.isFinite(Number(v))"),
      'the reader now follows helpers that neither draw nor name a choice, so the list gains words no screen shows');
    assert.ok(!boards.includes('function money'), 'money() is arithmetic and its words are on no screen');

    const screens = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'screencontrols.js'), 'utf8');
    // ...AND A SCREEN IS NOT A HELPER OF ANOTHER SCREEN, which is what makes
    // depth safe. Verify's status strip calls draw(), the tab dispatcher, which
    // calls every renderer there is. Following that would put all 82 of Boards'
    // controls on Verify's list — the exact over-collection this file exists to
    // prevent, wearing the fix.
    assert.ok(/const screens = new Set\(\['draw', \.\.\.tabs\(S\)\.map\(\(t\) => t\.fn\)\]\);/.test(screens),
      'the renderers are not dead ends any more, so one screen can drag another screen\'s words onto its list');
    for (const fn of ['drawHeld', 'drawReserve']) {
      const judge = drawBody(fn);
      for (const w of ['every coin of every setting', 'copy settings into the form']) {
        assert.ok(!judge.includes(w), `${fn}'s list has picked up "${w}", which is on Boards`);
      }
    }
    // AND THE TWO JUDGING TABS ARE ONE SCREEN (3.147.0, VERIFY-DESIGN.md Part 9):
    // one renderer handed the stretch, so the two lists differ in nothing
    assert.deepStrictEqual(collect('drawHeld').words, collect('drawReserve').words, 'Held and Reserve are drawn by one renderer, so their word lists are one list');
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
    // RE-AIMED 2026-08-28: promote top k, board rows and menu grid were on the
    // deleted screens. These are phrases the surviving screens own outright.
    // RE-AIMED 2026-09-02: fee % each way is on Boards too now, on the fill-in
    // for the tuning-slice money (3.46.0), so it is no longer a Sweep-only probe.
    // RE-AIMED 2026-09-08: the planted check's press moved to Setup, under
    // Version (3.96.0), and Setup has no list. RE-AIMED 3.147.0: Verify became
    // Held and Reserve, one renderer, so a phrase of theirs is on BOTH of them
    // and on nothing else; the leak check below allows exactly that pair.
    const JUDGE_PAIR = new Set(['held', 'reserve']);
    const onlyOn = { sweep: ['start stage 1', 'carry forward (0 = all)', 'null set size'],
      held: ['work out the held-back ride', 'work out the reserve ride'],
      boards: ['every coin of every setting', 'copy settings into the form'],
      greenlight: ['greenlight this survivor'] };
    for (const [home, words] of Object.entries(onlyOn)) {
      for (const w of words) {
        assert.ok((byTabWords[home] || '').includes(w), `"${w}" is missing from its own screen (${home})`);
        for (const [other, blob] of Object.entries(byTabWords)) {
          if (other === home) continue;
          // Held and Reserve are one screen drawn twice (3.147.0), so a phrase of one is on the other by design
          if (JUDGE_PAIR.has(home) && JUDGE_PAIR.has(other)) continue;
          assert.ok(!blob.includes(w),
            `"${w}" is on ${home} only, but the reader put it on ${other} as well — the list would say the `
            + 'owner can see a control there that is not there');
        }
      }
    }
  },
};
