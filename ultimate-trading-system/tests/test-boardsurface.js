// The Boards section's ported surfaces. Each of these existed on the Bracket lab
// and rendered nothing on Constructing, so a reader had no way to reach them.
//
// Watched failing 2026-08-17: removing any renderer or wiring below fails its
// check; the plateau one also fails if renderPlateau stops being called from the
// menu-grid handler, which is the shape the old tooltip promised and never did.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'constructing.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');

module.exports = {
  // The tooltip promised a plateau view in two places and rendered none.
  theMenuGridRendersThePlateauViewItPromises() {
    assert.ok(/function renderPlateau/.test(UI), 'the plateau view must exist');
    assert.ok(/renderPlateau\(cells, l\)/.test(UI), 'and the menu grid must actually call it');
    assert.ok(/one setting moved at a time/.test(UI), 'with the one-setting-at-a-time rule stated');
    assert.ok(/needle/.test(UI), 'and the needle-versus-plateau reading spelled out');
    // only ONE thing may move per table, or it is not a plateau reading
    assert.ok(/armMult \?\? 0\) === \(cand\.armMult \?\? 0\)/.test(UI),
      'the trailing axis must pin arm to the candidate so only one setting moves');
  },

  theMenuGridSaysWhereTheRowSitsAndDisclosesOnlyTheHeldBackAverage() {
    assert.ok(/Your cell sits at #/.test(UI), 'the rank line must say where the chosen cell sits');
    assert.ok(/ONLY the average is disclosed/.test(UI),
      'per-cell held-back numbers would let the graded window be shopped — only the average may show');
  },

  // A microscope that invites being read as a null test must say it is not one.
  theInspectPanelExistsAndDisclaimsItself() {
    assert.ok(/data-inspect/.test(UI), 'every promoted row must offer inspect');
    assert.ok(/api\/bracketlab\/\$\{encodeURIComponent\(doc\.id\)\}\/inspect\?file=/.test(UI),
      'inspect takes the votes file and the agreement level as query params');
    assert.ok(/MICROSCOPE, not a null test/.test(UI), 'and must say what it cannot tell you');
  },

  notesAreReadableWritableAndRefusedWhileTheRunComputes() {
    assert.ok(/id="bNotes"/.test(UI), 'the run must carry notes');
    assert.ok(/\/notes`, \{ text:/.test(UI), 'saved with the single field the endpoint reads');
    assert.ok(/doc\.status === 'running' \? 'disabled'/.test(UI),
      'the engine refuses writes while a run computes, so the box must say so rather than failing on save');
    assert.ok(/out\.notes \|\| ''/.test(UI),
      're-render from the RESPONSE: the stored value comes back truncated');
  },

  copySettingsFillsTheFormButNeverTheIntent() {
    assert.ok(/id="bCopySettings"/.test(UI), 'the run header must offer copy-settings');
    assert.ok(/setV\('#swDesc', ''\)/.test(UI),
      'intent never copies — a re-run states its own purpose');
    assert.ok(/declaredPermute/.test(UI.slice(UI.indexOf('bCopySettings'))),
      'the declared permute ticks must copy too, or a re-run is not the same run');
  },

  theRunSaysWhatItIs() {
    assert.ok(/units · /.test(UI), 'the units equation must be shown');
    assert.ok(/Data fingerprint/.test(UI), 'and the data fingerprint');
    assert.ok(/data-comparable exactly when these match/.test(UI),
      'with the rule that makes the fingerprint worth showing');
    assert.ok(/STAMP FAILED/.test(UI), 'a failed stamp must be loud, not absent');
  },

  assetPredictabilityIsRenderedFromTheCensus() {
    assert.ok(/Asset predictability/.test(UI), 'the summary must exist');
    assert.ok(/r\.holdPnl == null \|\| r\.shiftFrac/.test(UI),
      'it reads held-back money from the census, skipping shifted rows');
    assert.ok(/do not judge yet/.test(UI),
      'counts grow while a sweep runs and the page must say so');
    // the Bracket lab is the source of truth for this arithmetic
    assert.ok(/100% = every real setup beat every null copy/.test(APP), 'the source reading still exists to match');
  },
};
