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
  // THE TIE WORDING WENT WITH THE ALWAYS GATE (2026-09-02). Only a setting
  // that ignored the forecast could tie every shuffle comparison; with no such
  // gate there is nothing to mark, and a column that could still be marked
  // would be marking a gate the engine does not have.
  theTablesNoLongerSpeakOfTies() {
    assert.ok(!/nullTies|B_TIED|tied\b/.test(UI.slice(UI.indexOf('const bDash'), UI.indexOf('const bCoin'))), 'the dash carries no tie story');
    assert.ok(UI.includes('function bShare(share, beat, pairs) {'), 'the share column takes no tie mark');
    assert.ok(UI.includes('const bLead = (v) => (v == null ? bDash() :'), 'nor does the lead column');
    const stagesSrc = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(!/nullSetHonest|nullTies|nullSetCanBeat/.test(stagesSrc), 'nothing in the tables empties a number for a gate that no longer exists');
  },

  // A TICK ON THE LEFT OF EVERY RECORD (owner order, 2026-09-02). It names the
  // record by its own number on the set -- never by its place in a sort or
  // on a page, which change -- and the ticks save on the record set the
  // moment they change, the way a column sort does.
  theStageTwoTableOffersATickOnEveryRecordThatSavesOnTheSet() {
    const body = UI.slice(UI.indexOf('async function bDrawStage2('), UI.indexOf('\nasync function bDrawStage3('));
    // btdN0 is the first-column cell that never wraps (3.72.0): on the stage 1
    // and stage 2 tables a row is one line, so a column can be read down
    assert.ok(body.includes('<td ${btdN0}><input type="checkbox" data-bpick="S2:${r.u}"${picked.has(r.u) ? \' checked\' : \'\'}'),
      'every record carries a tick named by its record number, drawn ticked when the set says so');
    assert.ok(body.includes('<input type="checkbox" data-bpickpage="S2"'), 'the heading tick picks or clears the page');
    assert.ok(body.includes('<button data-bpickclear="S2"'), 'and every pick can be cleared at once');
    assert.ok(body.includes('<b data-bpickcount="S2">${picked.size.toLocaleString()}</b> picked on this record set'), 'the count of picks is on the screen');
    assert.ok(body.includes("const picked = new Set((t && t.picked) || []);"), 'the ticks are drawn from the picks the set serves with its table');
    assert.ok(body.includes('colspan="17"'), 'the empty row spans the new column too');
    assert.ok(body.includes('bWirePicks(doc, mount, t);'), 'the ticks are wired');
    const wire = UI.slice(UI.indexOf('function bWirePicks('), UI.indexOf('\nasync function bDrawStage3('));
    assert.ok(wire.includes("await tryPost(`api/stageset/${encodeURIComponent(doc.id)}/picked`, { picked: [...next] });"),
      'a change saves the whole list on the record set');
    assert.ok(wire.includes('if (!(await save(next))) cb.checked = !cb.checked;'), 'a save that fails puts the tick back');
  },

  // THE NAME IS THE OWNER'S, on every open section (owner order, 2026-09-03).
  // Drawn and held asleep exactly as the notes are: literal ids, three copies
  // that must not drift, wired to the set's own rename address, and the button
  // says why it sleeps while the set is being written.
  theNameIsTheOwnersOnEveryOpenSection() {
    for (const n of [1, 2, 3]) {
      for (const id of [`bName${n}`, `bRename${n}`, `bNameMsg${n}`]) {
        assert.ok(UI.includes(`id="${id}"`), `the stage ${n} section is missing ${id}`);
      }
    }
    const bodyOf = (n) => {
      const at = UI.indexOf(`function namePanel${n}(doc) {`);
      assert.ok(at > 0, `namePanel${n} is gone`);
      return UI.slice(at, UI.indexOf('\n}', at))
        .split(`namePanel${n}`).join('namePanel#')
        .split(`bRename${n}`).join('bRename#')
        .split(`bNameMsg${n}`).join('bNameMsg#')
        .split(`bName${n}`).join('bName#');
    };
    assert.strictEqual(bodyOf(2), bodyOf(1), 'the stage 2 name box has drifted from the stage 1 one');
    assert.strictEqual(bodyOf(3), bodyOf(1), 'the stage 3 name box has drifted from the stage 1 one');
    assert.ok(bodyOf(1).includes('<div class="row" style="align-items:flex-end">'), 'the box and its button do not line up along their bottom edge');
    assert.ok(/tryPost\(url, \{ name: box\.value \}\)/.test(UI), 'the rename posts the single field the endpoint reads');
    assert.ok(UI.includes("    wireRename(`api/stageset/${encodeURIComponent(doc.id)}/name`, String(stage));"),
      'Boards does not wire the rename to its own record set\'s name address');
    assert.ok(UI.includes("${stage === 1 ? namePanel1(doc) : stage === 2 ? namePanel2(doc) : namePanel3(doc)}${stage === 1 ? notesPanel1(doc)"),
      'the name box is not drawn above the notes on every open section');
    assert.ok(/the name changes after the run finishes/.test(UI), 'the button must say WHY it is asleep while the set is being written');
    assert.ok(/drawBoardsHoldingPlace\(\);\n    \}\n  \};\n\}\nfunction wireNotesSave/.test(UI),
      'a rename must redraw Boards where it stands, because every picker and heading shows the name');
  },

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

  // THE BUTTON THAT PUTS BACK THE UNITS A RUN LOST (3.73.0, owner order
  // 2026-09-06). It only exists on a stage 1 set that is short, it never
  // launches anything on its own, and the reason it cannot be pressed is the
  // SERVICE's sentence printed word for word -- a second copy of those reasons
  // on this page would be a second answer to one question.
  theShortStageOneSetOffersToPutItsMissingUnitsBack() {
    assert.ok(UI.includes('<button id="bFillUnits" data-bfillunits="${esc(doc.id)}">put the missing units back</button>'),
      'a short stage 1 set carries the control');
    const at = UI.indexOf('async function bWireFillUnits(doc) {');
    assert.ok(at > 0, 'and it is wired');
    const fn = UI.slice(at, UI.indexOf('\n}\n', at));
    assert.ok(fn.includes('`api/stageset/${encodeURIComponent(doc.id)}/fill-units`'), 'it posts to the set it is drawn on');
    assert.ok(fn.includes('await tryPost(path, {})'), 'and it sends nothing else — the choices come off the set, never off this page');
    assert.ok(!/swT|swBand|swDec|swAllData|swStart|swEnd/.test(fn),
      'it must never read a box on Sweep: a unit trained on a different window would be ranked against the rest with nothing able to tell them apart');
    assert.ok(fn.includes('if (st && st.why) { btn.disabled = true;'),
      'a set that cannot be filled says why BEFORE it is pressed, not after');
    assert.ok(fn.includes('esc(st.why)') && !fn.includes('measurement block'),
      'the reason is the service own sentence, printed, never a second copy of the rules on this page');
    assert.ok(UI.includes("if (doc.stage === 1 && doc.status === 'incomplete') bWireFillUnits(doc);"),
      'wired only on a stage 1 set that is actually short');
  },


  // A STAGE 4 RECORD SET CAN BE DELETED (owner order, 2026-09-06: "there's no
  // way to delete s4 data" and "s1/2/3 wont delete cause 4 exists").
  //
  // Boards drew Delete record set… for stages 1, 2 and 3 because those are the
  // sections it has. A stage 4 set is drawn on the Funnel and nowhere else, so
  // it had no delete anywhere -- and a set another set was cut from refuses to
  // be deleted while that set is still there, so ONE undeletable stage 4 set
  // made its stage 3, stage 2 and stage 1 parents undeletable too. The whole
  // chain was walled in behind a missing button.
  theStageFourRecordSetCanBeDeletedFromTheScreenItLivesOn() {
    assert.ok(UI.includes('<button id="fCutDelete" class="danger"'), 'the Stage 4 heading carries a delete');
    const at = UI.indexOf('function fWireCut(d, st, cd) {');
    assert.ok(at > 0, 'and it is wired');
    const fn = UI.slice(at, UI.indexOf('\n}\n', at));
    const wire = fn.indexOf("const dl = $('#fCutDelete');");
    const bail = fn.indexOf('if (!cd) return;');
    assert.ok(wire > 0 && bail > 0 && wire < bail,
      'it must be wired BEFORE the early return: a set that will not open is the one most likely to want deleting');
    // it asks first, and it takes the id typed back -- the same two steps the
    // stage 1, 2 and 3 deletes take, because this removes just as much
    assert.ok(fn.includes("await tryPost(`api/stageset/${encodeURIComponent(id)}/delete`, {})"), 'it previews first');
    assert.ok(fn.includes("if (typed.trim() !== look.confirmWith) { alert('That is not the record set id — nothing was deleted.'); return; }"),
      'and refuses anything but the record set id typed back');
    // ...and it only ever deletes the set that is CHOSEN, never the walk
    assert.ok(fn.includes('if (dl && st.cut && st.cut !== F_NEW)'),
      'nothing is offered to delete while the screen is on new rule — there is no set there to delete');
    assert.ok(UI.includes('<button id="fCutDelete" class="danger" ${chosen ? \'\' : \'disabled\'}'),
      'and the control is dead on screen rather than silently doing nothing');
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
