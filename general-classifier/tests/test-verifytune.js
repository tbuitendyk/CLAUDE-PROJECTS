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

  // RENAMED 2026-08-17. This was toolOneCanFireItsOwnNullRounds, and the name
  // carried the same mistake the screen did: the button fires the ROTATION null
  // (doc.nullTest), which creates none of the dealt-vote rows Tool 1 pairs
  // against. Tool 1's draws come from a sweep launched with null boards above
  // zero. The button now sits in its own panel, says which instrument it is, and
  // its output is RENDERED — before this the rounds cost a full sweep each and
  // nothing on the tab ever displayed the result (audit 2026-08-17).
  rotationRoundsAreTheirOwnInstrumentAndTheirOutputIsShown() {
    assert.ok(/id="t1fire"/.test(UI), 'the rotation rounds must still be fireable');
    assert.ok(/\/null`, \{ shifts: rounds \}/.test(UI), 'the endpoint reads exactly one field, shifts');
    // the engine clamps a missing/zero count to ONE — a finished-looking test of nothing
    assert.ok(/rounds < 1/.test(UI), 'a zero or missing count must be refused here, not silently clamped to one');
    assert.ok(/1-in-\$\{rounds \+ 1\}/.test(UI), 'and the confirm must say what claim the count can support');
    // the two halves that were missing
    assert.ok(/function renderRotationRounds\(/.test(UI),
      'doc.nullTest is rendered nowhere — the rounds would cost a full sweep each and show nothing');
    assert.ok(/nt\.exceedSearch/.test(UI) && /nt\.medianBestPnl/.test(UI),
      'the rotation table must read the fields lib/batch.js actually writes onto doc.nullTest');
    assert.ok(/RETIRED as evidence|retires this construction/.test(UI),
      'the panel must say the register retires this construction as evidence');
    assert.ok(/does NOT feed Tool 1|not the draws Tool 1|none of the dealt-vote rows Tool 1/i.test(UI),
      'the panel must say these rounds are not what Tool 1 reads — that confusion is the defect');
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

  // THE PLANTED CHECK read `verdict || status` off a status object that has
  // neither field, so it fell through to NOT CHECKED on every call — including
  // after a PASS, permanently. And nothing polled, so firing it looked exactly
  // like not firing it (owner, 2026-08-17). Same class as the dead vsNulls
  // column: a field nothing writes.
  //
  // Watched failing: restoring `s.verdict || s.status` fails the field check;
  // removing the interval fails the polling check.
  thePlantedCheckReadsTheFieldTheEndpointActuallyReturns() {
    const planted = fs.readFileSync(path.join(ROOT, 'lib', 'planted.js'), 'utf8');
    // the endpoint's own contract, read from source
    const ret = planted.slice(planted.indexOf('function gateStatus'));
    for (const key of ['state', 'detail', 'running', 'lastGate']) {
      assert.ok(new RegExp(`\\b${key}[:.]`).test(ret.slice(0, 3000)),
        `gateStatus must still return ${key}`);
    }
    // strip line comments first: the comment recording this defect names the old
    // expression, and a check that matches its own documentation is no check
    const code = UI.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.ok(!/\bs\.verdict\b/.test(code) && !/\bgate\.verdict\b/.test(code),
      'nothing may read .verdict off the gate status — gateStatus returns no such field, so it always fell through to NOT CHECKED');
    assert.ok(!/\bs\.status\b/.test(code), 'nor .status');
    assert.ok(/s\.state \|\| 'NOT CHECKED'/.test(code), 'it must read state');
    assert.ok(/gate\.state/.test(code), 'and the Verify panel must read state too');
  },

  thePlantedCheckSaysWhenItIsRunningAndKeepsSaying() {
    assert.ok(/if \(s\.running\)/.test(UI), 'a gate in flight must show as RUNNING, not as its old verdict');
    // the poll must be REACHABLE, not merely present: checking that setInterval
    // appears somewhere passes even with the branch that reaches it disabled
    assert.ok(/if \(s\.running && !gatePoll\) \{[\s\S]{0,200}setInterval/.test(UI),
      'the poll must be started when a gate is in flight, not merely defined');
    assert.ok(/clearInterval\(gatePoll\)/.test(UI), 'stopping the moment it lands');
    assert.ok(/you do not need to reload/.test(UI), 'and telling the operator that');
    assert.ok(/gate\.running \? 'disabled title="a planted check is already running"'/.test(UI),
      'the button must be disabled while a check is already running');
  },

  thePlantedCheckShowsTheReasonNotJustTheWord() {
    assert.ok(/gate\.detail/.test(UI), 'the status sentence explains what the word means and must be shown');
    assert.ok(/lastGate\.sentences/.test(UI), 'and the last gate\'s own verdict sentences');
  },

  theCpuCapIsReachableFromThisTab() {
    assert.ok(/id="cpubtn"/.test(HTML), 'the topbar must carry the CPU cap');
    assert.ok(/api\/cpu/.test(UI), 'wired to the endpoint');
    assert.ok(/service-wide/.test(HTML), 'and it must say the cap is shared by every job on the box');
  },
};
