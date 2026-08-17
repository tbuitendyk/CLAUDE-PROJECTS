// The Verify and Tune sections' ported surfaces.
//
// Watched failing 2026-08-17: dumping the verdict as JSON again fails the
// renderer check; removing the fire button leaves Tool 1 able only to READ a
// null run somebody else launched; targeting F1 unconditionally fails the
// picker check; and treating the custom stop box as a fraction fails the
// percent/fraction check — that unit confusion already cost this project once
// (the fee-per-leg $0.125 read as 12.5%, QC/stopsweep.js).
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'constructing.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'constructing.html'), 'utf8');

module.exports = {
  theNullVerdictIsReadNotDumped() {
    assert.ok(/function renderNullVerdict/.test(UI), 'the verdict must be rendered');
    assert.ok(/renderNullVerdict\(d\)/.test(UI), 'and the tool must call it');
    assert.ok(!/t1out'\)\.innerHTML = `<pre>/.test(UI), 'the raw JSON dump must be gone');
    // the readings that make the numbers mean anything
    assert.ok(/a floor, never a measure of strength/.test(UI), 'the p floor must be labelled a floor');
    assert.ok(/NOISE IS PROFITING/.test(UI), 'the sanity failure must be loud — it invalidates everything above it');
    assert.ok(/SETTINGS MISMATCH/.test(UI), 'two jobs with different settings must say so');
    assert.ok(/this window only/.test(UI), 'and what a pass actually buys must be stated');
  },

  toolOneCanFireItsOwnNullRounds() {
    assert.ok(/id="t1fire"/.test(UI), 'Tool 1 must be able to fire the rounds it reads');
    assert.ok(/\/null`, \{ shifts: rounds \}/.test(UI), 'the endpoint reads exactly one field, shifts');
    // the engine clamps a missing/zero count to ONE — a finished-looking test of nothing
    assert.ok(/rounds < 1/.test(UI), 'a zero or missing count must be refused here, not silently clamped to one');
    assert.ok(/1-in-\$\{rounds \+ 1\}/.test(UI), 'and the confirm must say what claim the count can support');
  },

  theScansCanTargetAnySavedBookNotJustF1() {
    assert.ok(/api\/pilot\/stop-candidates/.test(UI), 'the saved books must be offered');
    assert.ok(/id="tuneTarget"/.test(UI), 'with a picker');
    assert.ok(/opposite rail IS its stop/.test(UI),
      'and it must say why a book with a stop is not listed');
  },

  theCustomStopBoxIsPercentAndTheEngineWantsAFraction() {
    assert.ok(/id="stopCustomPct"/.test(UI), 'a custom stop must be applicable');
    assert.ok(/applyStop\(v \/ 100\)/.test(UI),
      'the box is in PERCENT and the engine stores a FRACTION — sending the percent would be a 100x stop');
    assert.ok(/id="stopClear"/.test(UI), 'and the stop must be clearable');
    assert.ok(/NO fixed stop/.test(UI), 'with the consequence stated before it happens');
  },

  theCpuCapIsReachableFromThisTab() {
    assert.ok(/id="cpubtn"/.test(HTML), 'the topbar must carry the CPU cap');
    assert.ok(/api\/cpu/.test(UI), 'wired to the endpoint');
    assert.ok(/service-wide/.test(HTML), 'and it must say the cap is shared by every job on the box');
  },
};
