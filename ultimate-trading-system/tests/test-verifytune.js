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

  // THE SCANS AIM AT A STAGE 4 RECORD SET, from the server's own list (3.97.0):
  // the older engine's targets — a saved run's row and the live setups, which the
  // scans replayed with the older committee — went with that engine.
  theScansTargetAStage4RecordSetFromTheServersList() {
    assert.ok(/api\/pilot\/stop-candidates/.test(UI), 'the targets must come from the server');
    assert.ok(/id="tuneTarget"/.test(UI), 'with a picker');
    assert.ok(/a Stage 4 record set whose trades are captured on this tab/.test(UI), 'and it must say what can be aimed at');
    for (const gone of ["'sel'", 'savedBooks', 'runId: doc.id', 'setupId: chosen.id']) assert.ok(!UI.includes(gone), `the older target is still offered: ${gone}`);
  },

  theCustomStopBoxIsPercentAndTheEngineWantsAFraction() {
    assert.ok(/id="stopCustomPct"/.test(UI), 'a custom stop must be applicable');
    assert.ok(/applyStop\(v \/ 100\)/.test(UI),
      'the box is in PERCENT and the engine stores a FRACTION — sending the percent would be a 100x stop');
    assert.ok(/id="stopClear"/.test(UI), 'and the stop must be clearable');
    assert.ok(/NO fixed stop/.test(UI), 'with the consequence stated before it happens');
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
