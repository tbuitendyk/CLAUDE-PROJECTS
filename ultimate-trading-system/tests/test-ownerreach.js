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
  // No POST that records a stop may omit `why`. Catching the shape generally
  // rather than the known call sites: another one added later would otherwise
  // silently reintroduce a script-only field. Since 3.145.0 the stop is a
  // record on one survivor of a Stage 4 record set (stop-choice); the older
  // pilot write (stop-apply) is not made from this page at all.
  for (const [file, src] of [['construct.js', CX]]) {
    // Capture to the end of the CALL, not to the first closing brace: a fetch
    // passes an options object whose `headers: {...},` closes early, which made
    // this stop reading before the body it was meant to inspect. A check that
    // stops short of the thing it checks is not a check.
    const posts = [...src.matchAll(/stop-choice`[\s\S]{0,600}?\)\s*;/g)].map((m) => m[0]);
    assert.ok(posts.length, `${file}: no stop-choice call found at all`);
    for (const call of posts) {
      assert.ok(/why/.test(call),
        `${file}: a stop is written without carrying the owner's reason — that field would then be `
        + 'fillable only by something other than the owner');
    }
    assert.ok(!/stop-apply/.test(src), `${file}: still writes the older pilot stop, which no screen calls live any more`);
  }
}

function theOwnerHasABoxToTypeTheReasonIn() {
  assert.ok(/id="stopWhy"/.test(CX), 'Constructing has no field for the owner to write their reason');
}

function theReasonCanBeEditedWithoutMovingTheNumber() {
  assert.ok(/id="stopWhySave"/.test(CX) && /applyStop\(onRecord \? onRecord\.stopPct \?\? null : null, false\)/.test(CX),
    'Constructing cannot save a reworded reason on its own, or does so in a way that could move the stop or run a scan');
}

function theRecordedChoiceIsReadableFromTheScreen() {
  // Writing it is half of it; the owner must be able to SEE what is on record,
  // for the survivor it was recorded on.
  assert.ok(/on record for <b>\$\{esc\(stopLabel\)\}<\/b>: /.test(CX),
    'the recorded choice is not displayed for the survivor picked, so the owner cannot check what was saved');
  assert.ok(/no choice about the stop has been recorded for <b>\$\{esc\(stopLabel\)\}<\/b> yet/.test(CX),
    'an unrecorded choice is not called out, so a gap reads as a decision');
  const STAGES = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
  assert.ok(/rows: \(d\.capture\.rows \|\| \[\]\)\.map\(\(r\) => \(\{ \.\.\.r, stop: stopChoiceOf\(d, r\.label\) \}\)\)/.test(STAGES),
    'the scan target list does not carry the stop on record per survivor, so the page has nothing to show');
}

function theServerAcceptsAndReturnsTheReason() {
  const STAGES = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
  assert.ok(/const why = typeof asked\.why === 'string' \? asked\.why\.trim\(\)\.slice\(0, 300\) : '';/.test(STAGES),
    'the record discards the reason, so the box on the page would do nothing');
  assert.ok(/app\.post\('\/api\/funnel\/set\/:id\/stop-choice'/.test(SERVER),
    'there is no endpoint to record the choice through');
  assert.ok(/\/api\/pilot\/stop-candidates/.test(SERVER) && /for \(const c of stages\.captureCandidates\(\)\) candidates\.push\(c\)/.test(SERVER),
    'there is no endpoint to read the recorded choice back');
}

function anOfflineFallbackDoesNotClaimAChoiceWasMade() {
  // The choice is read off the scan target's own row; when the list cannot be
  // read the fallback is an EMPTY list, so nothing renders as a recorded choice.
  assert.ok(/apiOr\('api\/pilot\/stop-candidates', \(\{ candidates: \[\] \}\)\)/.test(CX),
    'Constructing\'s offline fallback for the scan targets is not an empty list');
  assert.ok(/const onRecord = stopRow && stopRow\.stop \? stopRow\.stop : null;/.test(CX),
    'the choice on record is not read off the survivor\'s own row, so a failed fetch could render as a recorded choice');
}

module.exports = {
  everyStopWriteCarriesTheOwnersReason,
  theOwnerHasABoxToTypeTheReasonIn,
  theReasonCanBeEditedWithoutMovingTheNumber,
  theRecordedChoiceIsReadableFromTheScreen,
  theServerAcceptsAndReturnsTheReason,
  anOfflineFallbackDoesNotClaimAChoiceWasMade,
};
