// The Boards screen's surfaces.
//
// CUT BACK 2026-08-28 (owner order: "get rid of the Sweep, Sweep2, Boards, and
// Boards2 tabs. make the existing 'Sweep3' just 'Sweep' and the existing
// 'Boards3' just 'Boards'"). This file used to hold fourteen checks. Twelve of
// them named things that were only ever on the deleted Boards — the menu grid
// and its plateau reading, the inspect panel, the ranked replication list and
// its heading, the six source lines, the open-records state, the remembered
// board view, the four floors, copy-settings into the old Sweep form, the run
// identity line and the asset predictability summary. Their subject is gone, so
// they are gone with it, listed here so the removal is a record and not a
// silence. What remains is what the surviving screens still do.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');

module.exports = {
  // The notes box and its save are drawn and wired by ONE pair of functions
  // (notesPanelHtml / wireNotesSave). Only one screen carries them now, but the
  // properties are the ones that were always the point.
  notesAreReadableWritableAndRefusedWhileTheRunComputes() {
    // ONE BOX PER OPEN SECTION, each with a LITERAL id (2026-08-29). It used to
    // be drawn on the deepest selection only, so a stage 3 record set took the
    // box away from the two sections above it. The ids are literal because
    // lib/screencontrols.js reads them out of the source — an id built at
    // runtime is a control the owner can see and the word list cannot name.
    for (const n of [1, 2, 3]) {
      for (const id of [`bNotes${n}`, `bNotesSave${n}`, `bNotesMsg${n}`]) {
        assert.ok(UI.includes(`id="${id}"`), `the stage ${n} section is missing ${id}`);
      }
    }
    // AND THE THREE MUST NOT DRIFT. Three copies of one control is how one of
    // them quietly stops matching the others.
    const bodyOf = (n) => {
      const at = UI.indexOf(`function notesPanel${n}(doc) {`);
      assert.ok(at > 0, `notesPanel${n} is gone`);
      // ONLY the id suffixes are normalised. Replacing the bare digit everywhere
      // also rewrote .slice(0, 16) differently for n=1 than for n=2, which made
      // this fail on three boxes that were in fact identical.
      return UI.slice(at, UI.indexOf('\n}', at))
        .split(`notesPanel${n}`).join('notesPanel#')
        .split(`bNotesSave${n}`).join('bNotesSave#')
        .split(`bNotesMsg${n}`).join('bNotesMsg#')
        .split(`bNotes${n}`).join('bNotes#');
    };
    assert.strictEqual(bodyOf(2), bodyOf(1), 'the stage 2 notes box has drifted from the stage 1 one');
    assert.strictEqual(bodyOf(3), bodyOf(1), 'the stage 3 notes box has drifted from the stage 1 one');
    assert.ok(/tryPost\(saveUrl, \{ text: box\.value \}\)/.test(UI),
      'saved with the single field the endpoint reads');
    assert.ok(/wireNotesSave\(`api\/stageset\/\$\{encodeURIComponent\(doc\.id\)\}\/notes`/.test(UI),
      'the Boards screen must wire the save to its own record set\'s notes address');
    assert.ok(/const off = doc\.status === 'running';/.test(UI)
      && /\$\{off \? 'disabled' : ''\}/.test(UI),
    'the engine refuses writes while a run computes, so the box must say so rather than failing on save');
    assert.ok(/notes save after the run finishes/.test(UI),
      'and the button must say WHY it is asleep, not just be dead');
    assert.ok(/out\.notes \|\| ''/.test(UI),
      're-render from the RESPONSE: the stored value comes back truncated');
  },
};

// EVERY CONTROL CARRIES ITS HELP AS HOVER TEXT (owner order, 2026-08-26:
// "where's the tool tip on the decision drop down in Sweep? missing tool
// tips on many (most?) of the controls"). The hover is wired from the Help
// tab's entries — which test-help.js forces to exist for every control — so
// a control cannot be hoverless, and the words cannot drift from the Help
// tab's. A hand-written title in the template wins over the wired one.
//
// THE TAB LIST IS READ FROM THE CODE, not typed here (2026-08-28). It was
// typed, and the day four screens were deleted this check went on demanding
// hovers for screens that no longer existed while it could not have noticed a
// NEW screen wired to nothing. Reading TABS catches both.
module.exports.everyControlsHelpBecomesItsHover = function () {
  const { assert: a } = require('./helpers');
  const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
  a.ok(/function hoverFromHelp\(key\)/.test(src), 'the wiring function is gone');
  a.ok(/if \(!el\.title\) el\.title = text;/.test(src),
    'a hand-written title no longer wins — the sharper in-place warnings get overwritten');
  a.ok(/if \(lab && !lab\.title\) lab\.title = text;/.test(src),
    'the caption around a control no longer carries the hover');
  const keys = require('../lib/screencontrols').tabs().map((t) => t.key).filter((k) => k !== 'help');
  a.ok(keys.length >= 7, `only ${keys.length} screens were read out of TABS — the list cannot be right`);
  for (const key of keys) {
    a.ok(new RegExp(`hoverFromHelp\\('${key}'\\)`).test(src), `the ${key} draw no longer wires its hovers`);
  }
};
