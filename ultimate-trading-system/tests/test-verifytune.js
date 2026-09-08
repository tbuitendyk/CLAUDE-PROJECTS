// The Verify and Tune sections' ported surfaces.
//
// Watched failing 2026-08-17: targeting F1 unconditionally fails the
// picker check; and treating the custom stop box as a fraction fails the
// percent/fraction check — that unit confusion already cost this project once
// (the fee-per-leg $0.125 read as 12.5%, QC/stopsweep.js).
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'construct.html'), 'utf8');
// the planted check's panel lives on Setup, under Version (3.96.0); the marker
// beside "planted check:" and its poll stay on Construct
const SETUP = fs.readFileSync(path.join(ROOT, 'public', 'setup.html'), 'utf8');

module.exports = {
  // THE THREE PANELS THAT WAITED FOR A CHOSEN ROW OF AN OLD SWEEP RUN ARE GONE
  // (3.86.0): Tool 1, the rotation rounds and Tool 2 drew dead on everything the
  // engine writes now. The sentences worth keeping moved onto the verdict panel,
  // where tests/test-funnelverify.js reads them.
  theRetiredVerifyPanelsStayRetired() {
    assert.ok(!/Tool 1 — this row against its null runs/.test(UI), 'the Tool 1 panel grew back');
    assert.ok(!/Rotation rounds — a SEPARATE instrument/.test(UI), 'the rotation rounds panel grew back');
    assert.ok(!/Tool 2 — the board against its dealt-vote null boards/.test(UI), 'the Tool 2 panel grew back');
    assert.ok(!/function renderNullVerdict|function renderRotationRounds/.test(UI), 'their renderers are still there');
    for (const id of ['t1null', 't1run', 't1rounds', 't1fire']) assert.ok(!new RegExp(`id="${id}"`).test(UI), `#${id} is still on the page`);
    // what they said that was worth keeping is said on the verdict panel now
    assert.ok(/a floor, never a measure of strength/.test(UI), 'the p floor must be labelled a floor');
    assert.ok(/NOISE IS PROFITING/.test(UI), 'the sanity failure must be loud — it invalidates everything above it');
    assert.ok(/this window only/.test(UI), 'and what a pass actually buys must be stated');
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
    const code = [UI, SETUP].map((f) => f.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')).join('\n');
    assert.ok(!/\bs\.verdict\b/.test(code) && !/\bgate\.verdict\b/.test(code),
      'nothing may read .verdict off the gate status — gateStatus returns no such field, so it always fell through to NOT CHECKED');
    assert.ok(!/\bs\.status\b/.test(code), 'nor .status');
    assert.ok(/s\.state \|\| 'NOT CHECKED'/.test(code), 'it must read state');
    assert.ok(/gate\.state/.test(SETUP), 'and the panel on Setup must read state too');
  },

  thePlantedCheckSaysWhenItIsRunningAndKeepsSaying() {
    assert.ok(/if \(s\.running\)/.test(UI), 'a gate in flight must show as RUNNING, not as its old verdict');
    // the poll must be REACHABLE, not merely present: checking that setInterval
    // appears somewhere passes even with the branch that reaches it disabled
    assert.ok(/if \(s\.running && !gatePoll\) \{[\s\S]{0,200}setInterval/.test(UI),
      'the poll must be started when a gate is in flight, not merely defined');
    assert.ok(/clearInterval\(gatePoll\)/.test(UI), 'stopping the moment it lands');
    assert.ok(/you do not need to reload/.test(SETUP), 'and telling the operator that');
    assert.ok(/gate\.running \? 'disabled title="a planted check is already running"'/.test(SETUP),
      'the button must be disabled while a check is already running');
  },

  thePlantedCheckShowsTheReasonNotJustTheWord() {
    assert.ok(/gate\.detail/.test(SETUP), 'the status sentence explains what the word means and must be shown');
    assert.ok(/lastGate\.sentences/.test(SETUP), 'and the last gate\'s own verdict sentences');
  },

  // Inverted 2026-08-26 (owner order: "Remove the obsolete CPU button"). The
  // button cycled the same per-worker duty cycle the Compute tab's share box
  // sets — one dial shown in two places, under a hover that misdescribed it
  // as a worker cap. One dial, one home: it must never grow back here, and
  // neither may the endpoint pair that existed only to serve it.
  theCpuDialLivesOnTheComputeTabAlone() {
    assert.ok(!/id="cpubtn"/.test(HTML), 'the CPU button grew back on the Construct page');
    assert.ok(!/api\/cpu['"`]/.test(UI) && !/'api\/cpu'/.test(UI), 'the page still asks the retired endpoint');
    const server = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
    assert.ok(!/['"`]\/api\/cpu['"`]/.test(server), 'the retired endpoint pair is still served');
  },
};
