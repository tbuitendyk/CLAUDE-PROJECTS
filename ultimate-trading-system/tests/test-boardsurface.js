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
const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');

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

  // CHANGED 2026-08-22: there is now ONE mapping from a run's stored settings
  // to the boxes on the Sweep section — fillSweepForm — because two callers
  // need it. This button copies a run into the form for a re-run, and the
  // Sweep section itself shows the settings of a job while it is running.
  // Two copies of that mapping would be two answers to one question, and the
  // one that drifts would be the one nobody is looking at.
  //
  // The intent rule is unchanged and still the point: a RE-RUN states its own
  // purpose, so this caller passes an empty description. The running-job
  // display passes the run's own, which is exactly what somebody looking at a
  // running job wants to read.
  copySettingsFillsTheFormButNeverTheIntent() {
    assert.ok(/id="bCopySettings"/.test(UI), 'the run header must offer copy-settings');
    assert.ok(/function fillSweepForm\(p, description\)/.test(UI),
      'the run-to-form mapping must live in one named place both callers use');
    assert.ok(/fillSweepForm\(doc\.params \|\| \{\}, ''\)/.test(UI),
      'intent never copies — a re-run states its own purpose, so this caller passes no description');
    const map = UI.slice(UI.indexOf('function fillSweepForm'), UI.indexOf('async function drawSweep'));
    assert.ok(/declaredPermute/.test(map),
      'the declared permute ticks must copy too, or a re-run is not the same run');
    for (const id of ['#swUni', '#swGeom', '#swLayout', '#swNulls', '#swTrail', '#swDecOn', '#swDecEntry']) {
      assert.ok(map.includes(id), `${id} is not carried by the run-to-form mapping — a re-run would not be the same run`);
    }
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
  },
};
// EVERY BOX OF PERMUTATION RESULTS NAMES ITS SOURCE (owner order, 2026-08-25:
// "you should indicate the actual true source for data rows in every box of
// permutation results"). Six boxes on Boards show permutation results; a
// number whose origin is not on the screen gets read as whatever the reader
// hoped it was. The marker is the literal word the screen prints.
module.exports.everyPermutationBoxNamesItsSource = function () {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const body = src.slice(src.indexOf('async function drawBoards('), src.indexOf('async function drawVerify('));
  const sources = (body.match(/source: /g) || []).length;
  assert.ok(sources >= 6,
    `the Boards section prints ${sources} source line(s); the board, the ranked list, the single-config panel, `
    + 'the every-coin box, the opened rows and the menu grid each need one');
};

// THE OPEN RECORDS SURVIVE A REDRAW (owner order, 2026-08-26: "the view
// needs to stay open and fixed to the same scrolling position"). The records
// opened below a coin row used to be inserted by hand and die on every
// redraw — flipping to Sweep and back folded them all, which also shortened
// the page so the remembered scroll landed somewhere else. Now what came
// back is kept by row identity and coinBox draws every open one, so a
// redraw keeps the height and the scroll restore keeps its meaning.
module.exports.theOpenRecordsSurviveARedraw = function () {
  const { assert: a } = require('./helpers');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  a.ok(/let openRecs = \{ id: null, byKey: new Map\(\) \};/.test(src),
    'the open-records state is gone — every redraw folds them again');
  a.ok(/const open = openRecs\.byKey\.has\(coinKeyOf\(r\)\);/.test(src)
    && /open\s*\?\s*`<tr class="coinsub">/.test(src.replace(/\n/g, ' ')),
    'the shared coin row no longer draws the open records from state');
  a.ok(/openRecs\.byKey\.set\(key, got\)/.test(src), 'opening a row no longer keeps what came back');
  a.ok(/openRecs\.byKey\.delete\(key\)/.test(src), 'closing a row no longer clears its state, so it springs back open');
  // ONE builder, used by the state render and the button press alike — a
  // second copy of that block is the drift the house rules police.
  const hits = src.split('read straight from the stored rows. Each is one promoted unit').length - 1;
  a.strictEqual(hits, 1, 'the records block exists in more than one copy (or none)');
};

// EVERY CONTROL CARRIES ITS HELP AS HOVER TEXT (owner order, 2026-08-26:
// "where's the tool tip on the decision drop down in Sweep? missing tool
// tips on many (most?) of the controls"). The hover is wired from the Help
// tab's entries — which test-help.js forces to exist for every control — so
// a control cannot be hoverless, and the words cannot drift from the Help
// tab's. A hand-written title in the template wins over the wired one.
module.exports.everyControlsHelpBecomesItsHover = function () {
  const { assert: a } = require('./helpers');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  a.ok(/function hoverFromHelp\(key\)/.test(src), 'the wiring function is gone');
  a.ok(/if \(!el\.title\) el\.title = text;/.test(src),
    'a hand-written title no longer wins — the sharper in-place warnings get overwritten');
  a.ok(/if \(lab && !lab\.title\) lab\.title = text;/.test(src),
    'the caption around a control no longer carries the hover');
  for (const key of ['data', 'sweep', 'sweep2', 'sweep3', 'boards', 'boards2', 'boards3', 'verify', 'history', 'tune', 'greenlight']) {
    a.ok(new RegExp(`hoverFromHelp\\('${key}'\\)`).test(src), `the ${key} draw no longer wires its hovers`);
  }
};


// The ranked list's heading counts EVERY configuration the run declared,
// not the hundred the page happens to show (owner caught it, 2026-08-26:
// "why is this table '100 declared configs' when we permuted thousands?").
module.exports.theRankedHeadingCountsEveryConfigurationNotThePage = function () {
  const { assert: a } = require('./helpers');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  a.ok(/Replication — \$\{Number\(rep\.configs \|\| 0\)\.toLocaleString\(\)\} declared configs, ranked/.test(src),
    'the heading is back to counting the page instead of the run');
  a.ok(!/Replication — \$\{scored\.length\} declared configs/.test(src),
    'the page-length count crept back into the heading');
};


// THE BOARDS VIEW SURVIVES LEAVING THE PAGE (owner order, 2026-08-26: "I
// EXPECT ALL PAGES TO PERSIST THEIR VIEW AND LOCATION WHEN FLIPPING AROUND.
// *ALWAYS*"). Flipping to Setup unloads the whole script, so the open boxes,
// open lines, open records, floors and pages are written to the same store
// that already carries the section, the run and the scroll — and rebuilt
// once on load, after which the scroll is put back on a page whose height is
// the height the owner left.
module.exports.theBoardsViewSurvivesLeavingThePage = function () {
  const { assert: a } = require('./helpers');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  a.ok(/const BOARDS_VIEW_KEY = 'cx-boards-view';/.test(src), 'the view record has no home');
  a.ok((src.match(/saveBoardsView\(doc\);/g) || []).length >= 9,
    'the view record is not saved at every point the view can change');
  a.ok(/applyBoardsView\(doc\);/.test(src), 'nothing rebuilds the view on load');
  a.ok(/restoreScroll\(tab\)/.test(src.slice(src.indexOf('async function applyBoardsView'), src.indexOf('async function applyBoardsView') + 3000)),
    'the scroll is not put back after the rebuild — it lands on a page still short');
  a.ok(/openRecs\.byKey\.set\(k, \{ loading: true \}\)/.test(src),
    'restored-open records are not held open while their rows are fetched back');
  a.ok(/if \(holder\.open\) load\(\);/.test(src),
    'a ranked line restored open never loads its table — the toggle only fires on a press');
};

// The four floors sit BEFORE the sort by row, in the order the owner named
// them (owner order, 2026-08-26).
module.exports.theFourFloorsSitBeforeTheSortRow = function () {
  const { assert: a } = require('./helpers');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  const at = (m) => { const i = src.indexOf(m); a.ok(i >= 0, m + ' is not on the page'); return i; };
  const share = at('id="bCoinMinShare"');
  const hold = at('id="bCoinMinHold"');
  const trades = at('id="bCoinMinTrades"');
  const vsl = at('id="bCoinMinVsLong"');
  const sort = at('id="bCoinSort"');
  a.ok(share < hold && hold < trades && trades < vsl && vsl < sort,
    'the four floors are not in the ordered place — before the sort by row, in the order named');
  a.ok(/minShare=\$\{encodeURIComponent\(repCoins\.minShare\)\}/.test(src),
    'the floors never reach the other side — the boxes are decoration');
};
