// A DAY THE COMMITTEE DECLINED IS STILL A DECISION (owner, 2026-08-19).
//
// live-produce.js wrote a decision record only when the call was actionable AND
// not FLAT. So a day the members voted no left nothing behind, and an absent day
// meant EITHER "declined" OR "the tick never ran" with no way to tell them apart
// — on a record whose whole job is to be re-checkable.
//
// Worse, the log changed shape mid-history. The retired rail did record declined
// days and those came across on migration (9-13 August sit on the profile as
// FLAT), so the history is complete up to a seam and trade-days-only after it.
// Either behaviour applied consistently would be defensible; the seam is not.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRODUCE = fs.readFileSync(path.join(ROOT, 'live-produce.js'), 'utf8');
const code = PRODUCE.replace(/\/\/[^\n]*/g, '');

function aDeclinedDayIsRecordedNotDiscarded() {
  assert.ok(!/side !== 'FLAT'/.test(code),
    "recording is gated on the side again — a declined day is dropped and becomes indistinguishable "
    + 'from a tick that never ran');
  assert.ok(/const recordable = out\.actionable && out\.intent && out\.intent\.decision_price != null/.test(code),
    'the recording gate is no longer the price, so either declines are dropped or they are written '
    + 'without the price the reproduce-check needs');
}

function aRecordIsNeverWrittenWithoutItsPrice() {
  // compareDecision treats a recorded null price against a recomputed real one
  // as a divergence. Writing a priceless record would MANUFACTURE a break the
  // moment the entry candle caches — inventing drift where there is none is as
  // damaging as missing it.
  const cmp = fs.readFileSync(path.join(ROOT, 'lib', 'decisioncompare.js'), 'utf8');
  assert.ok(/\(rp == null\) !== \(cp == null\)/.test(cmp),
    'the null-vs-present price rule changed; the gate in live-produce.js was chosen against it '
    + 'and must be re-derived');
  assert.ok(/decision_price != null/.test(code),
    'nothing stops a priceless record being written');
}

function notRecordingIsSaidOutLoud() {
  assert.ok(/decision NOT recorded yet/.test(PRODUCE),
    'a period that went unrecorded is silent — the hole was closed by making a quieter hole');
  // TIGHTENED 2026-08-25. This pinned `!!recordable`, which reports whether the
  // decision COULD be written, not whether it WAS. Those came apart the moment
  // shipping was made fail-closed: an intent must only go out when the record
  // actually landed, so the result has to say what happened, not what was
  // possible. Same guarantee, stricter subject.
  assert.ok(/recorded: !!recordedOk/.test(code),
    'the per-setup result does not report whether the decision was actually written down');
}

function paperAndLiveAreTreatedIdentically() {
  // RULE TWO: a fix on one must land on the other. This loop must not branch on
  // state — `paper` is a flag on the shipped intent, not a different code path.
  const loop = code.slice(code.indexOf('for (const setup of active)'));
  assert.ok(!/state === 'paper'\s*\?/.test(loop),
    'the produce loop branches on paper vs live, so the two can drift apart');
  const reg = /setup\.state === 'paper'/g;
  const hits = (loop.match(reg) || []).length;
  assert.ok(hits === 0,
    `the produce loop reads setup.state ${hits} time(s); the paper flag belongs to the intent builder, not here`);
}

module.exports = {
  aDeclinedDayIsRecordedNotDiscarded,
  aRecordIsNeverWrittenWithoutItsPrice,
  notRecordingIsSaidOutLoud,
  paperAndLiveAreTreatedIdentically,
};
