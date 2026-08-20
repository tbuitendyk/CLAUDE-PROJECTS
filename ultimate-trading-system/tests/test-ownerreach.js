// EVERY PIECE OF DATA AND FUNCTIONALITY IS REACHABLE FROM CODE THE OWNER RUNS
// (owner, 2026-08-19: "You hide NOTHING FROM ME — ALL DATA AND FUNCTIONALITY IS
// VIA CODE THAT I CAN RUN. always").
//
// The breach: a `why` was added beside the recorded protective-stop choice so a
// deliberate "no stop" could be told from one nobody set — and then the only
// thing that ever wrote it was a session running a script with a hand-made
// payload. Both stop screens posted {stopPct} and nothing else. A field the
// operator cannot fill is a control that lives where only the programmer can
// reach, which is the whole defect this project exists to remove.
//
// These tests do not check that a reason EXISTS. They check that the owner can
// WRITE one, from the page, on every path that records a choice.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CX = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function everyStopWriteCarriesTheOwnersReason() {
  // No POST to stop-apply may omit `why`. Catching the shape generally rather
  // than the two known call sites: a third one added later would otherwise
  // silently reintroduce a script-only field.
  for (const [file, src] of [['construct.js', CX]]) {
    // Capture to the end of the CALL, not to the first closing brace: a fetch
    // passes an options object whose `headers: {...},` closes early, which made
    // this stop reading before the body it was meant to inspect. A check that
    // stops short of the thing it checks is not a check.
    const posts = [...src.matchAll(/stop-apply'[\s\S]{0,600}?\)\s*;/g)].map((m) => m[0]);
    assert.ok(posts.length, `${file}: no stop-apply call found at all`);
    for (const call of posts) {
      assert.ok(/why/.test(call),
        `${file}: a stop is written without carrying the owner's reason — that field would then be `
        + 'fillable only by something other than the owner');
    }
  }
}

function theOwnerHasABoxToTypeTheReasonIn() {
  assert.ok(/id="stopWhy"/.test(CX), 'Constructing has no field for the owner to write their reason');
}

function theReasonCanBeEditedWithoutMovingTheNumber() {
  assert.ok(/id="stopWhySave"/.test(CX) && /stopPct: applied\.stopPct \?\? null/.test(CX),
    'Constructing cannot save a reworded reason on its own, or does so in a way that could move the stop');
}

function theRecordedChoiceIsReadableFromTheScreen() {
  // Writing it is half of it; the owner must be able to SEE what is on record.
  assert.ok(/on record: /.test(CX),
    'the recorded choice is not displayed, so the owner cannot check what was saved');
  assert.ok(/no choice about the stop has been recorded yet/.test(CX),
    'an unrecorded choice is not called out, so a gap reads as a decision');
}

function theServerAcceptsAndReturnsTheReason() {
  assert.ok(/typeof req\.body\.why === 'string'/.test(SERVER),
    'the endpoint discards the reason, so the box on the page would do nothing');
  assert.ok(/app\.get\('\/api\/pilot\/fixed-stop'/.test(SERVER),
    'there is no endpoint to read the recorded choice back');
}

function anOfflineFallbackDoesNotClaimAChoiceWasMade() {
  assert.ok(/stopPct: null, chosen: false, why: null/.test(CX),
    'Constructing\'s offline fallback omits chosen:false, so a failed fetch renders as a recorded choice');
}

module.exports = {
  everyStopWriteCarriesTheOwnersReason,
  theOwnerHasABoxToTypeTheReasonIn,
  theReasonCanBeEditedWithoutMovingTheNumber,
  theRecordedChoiceIsReadableFromTheScreen,
  theServerAcceptsAndReturnsTheReason,
  anOfflineFallbackDoesNotClaimAChoiceWasMade,
};
