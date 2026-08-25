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
  assert.ok(/const recordable = priced/.test(code),
    'the recording gate is no longer built on the priced flag, so either declines are dropped or '
    + 'trades are written without the price the reproduce-check needs');
}

function aStandDownIsRecordedTheMomentItIsDecided() {
  // OWNER, 2026-08-25: "the software used to give the stand down immediately.
  // fix that again". Recording was gated on the entry price for every side
  // alike, and that price is the open of a candle an HOUR after the vote is
  // known. So a declined day sat invisible for that whole hour — the owner
  // watching an empty decision history for a call already made at 00:00.
  //
  // A FLAT decision is complete without a price: no order is placed, so there
  // is nothing to fill and nothing to price.
  assert.ok(/out\.intent\.side === 'FLAT'/.test(code),
    'a FLAT decision is recordable only once it has a price again — the stand-down will not '
    + 'appear until its entry candle caches, an hour after it was decided');
}

function aTradedRecordIsNeverWrittenWithoutItsPrice() {
  // QC 169, NARROWED BUT NOT WEAKENED. A LONG or SHORT record CLAIMS a fill
  // price; writing one without it would manufacture a reproduce-check break the
  // moment the entry candle caches. That gate stays. Only FLAT — which claims no
  // price because no trade happens — is exempt, and compareDecision has to agree
  // with the producer about exactly which records are exempt or one of them is
  // inventing drift.
  const cmp = fs.readFileSync(path.join(ROOT, 'lib', 'decisioncompare.js'), 'utf8');
  assert.ok(/\(rp == null\) !== \(cp == null\)/.test(cmp),
    'the null-vs-present price rule is gone entirely; a traded record with no price would now '
    + 'pass the reproduce-check silently');
  assert.ok(/rp == null && recorded\.side === 'FLAT'/.test(cmp),
    'the exemption is not restricted to FLAT — the producer and the comparison no longer agree '
    + 'about which records may be priceless');
  assert.ok(/const priced = !!\(out\.actionable && out\.intent && out\.intent\.decision_price != null\)/.test(code),
    'nothing stops a priceless TRADED record being written');
}

function aPricelessStandDownIsNotADivergence() {
  // Behavioural, not a source read. A stand-down recorded at 00:08 with no price
  // must still reproduce at 01:08 when the candle has cached and the recompute
  // CAN read a price. If this breaks, the profile halts itself for drift that
  // never happened — which is the exact damage the old price gate was avoiding.
  const { compareDecision } = require(path.join(ROOT, 'lib', 'decisioncompare.js'));
  const rec = { chunk_start: '2026-08-25T00:00:00.000Z', side: 'FLAT', per_member: [1, -1, 0],
    decision_price: null, input_hash: 'h1', window_complete: true };
  const re = { found: true, price_pending: false, side: 'FLAT', per_member: [1, -1, 0],
    decision_price: 108.4, input_hash: 'h1' };
  const r = compareDecision(rec, re);
  assert.ok(r.ok && !r.break, `a priceless stand-down was called a break: ${r.reason}`);
  assert.strictEqual(r.price_unrecorded, true,
    'the skipped price check is invisible in the result — a check that quietly skips a field '
    + 'reads exactly like a check that passed it');
}

function aPricelessTradedRecordStillBreaks() {
  // THE FAULT INJECTION FOR THE CHECK ABOVE. Same shape, side LONG. A record
  // that claims a fill price and does not carry one is a real divergence and
  // must still halt. If widening the exemption ever slips past FLAT, this is
  // what catches it.
  const { compareDecision } = require(path.join(ROOT, 'lib', 'decisioncompare.js'));
  const rec = { chunk_start: '2026-08-25T00:00:00.000Z', side: 'LONG', per_member: [1, 1, 1],
    decision_price: null, input_hash: 'h1', window_complete: true };
  const re = { found: true, price_pending: false, side: 'LONG', per_member: [1, 1, 1],
    decision_price: 108.4, input_hash: 'h1' };
  const r = compareDecision(rec, re);
  assert.ok(r.break, 'a LONG recorded with no price now passes the reproduce-check');
  assert.ok(/decision_price/.test(r.reason), `the break does not name the price: ${r.reason}`);
}

function aStandDownStillHasItsVotesAndHashChecked() {
  // The exemption covers the PRICE and nothing else. A stand-down that later
  // recomputes as a trade, or under a different engine, is a real break and the
  // priceless record must not shelter it.
  const { compareDecision } = require(path.join(ROOT, 'lib', 'decisioncompare.js'));
  const rec = { chunk_start: '2026-08-25T00:00:00.000Z', side: 'FLAT', per_member: [1, -1, 0],
    decision_price: null, input_hash: 'h1', window_complete: true };
  const flipped = compareDecision(rec,
    { found: true, side: 'LONG', per_member: [1, 1, 1], decision_price: 108.4, input_hash: 'h1' });
  assert.ok(flipped.break, 'a stand-down that recomputes as a LONG is not reported as a break');
  const drifted = compareDecision(rec,
    { found: true, side: 'FLAT', per_member: [1, -1, 0], decision_price: 108.4, input_hash: 'h2' });
  assert.ok(drifted.break, 'a stand-down whose input hash drifted is not reported as a break');
}

function aPricelessIntentIsNeverShipped() {
  // The record and the INTENT have different requirements and always did: the
  // record is ours to keep, the intent is a message to the box, and the box
  // rejects one with no price — INTENT_INVALID problems:["decision_price"], the
  // fault this whole change started from. Now that a FLAT is recordable before
  // it is priced, gating shipping on recordedOk alone would let exactly that
  // rejected message out again.
  const m = code.match(/if \(([^\n]*?)\)\s*\{\s*\n\s*const stamp =/);
  assert.ok(m, 'the intent-write gate could not be found in live-produce.js at all');
  assert.ok(/\bpriced\b/.test(m[1]),
    'the intent write is not gated on the price — priceless stand-downs will ship and be '
    + 'rejected as INTENT_INVALID again');
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
  aStandDownIsRecordedTheMomentItIsDecided,
  aTradedRecordIsNeverWrittenWithoutItsPrice,
  aPricelessStandDownIsNotADivergence,
  aPricelessTradedRecordStillBreaks,
  aStandDownStillHasItsVotesAndHashChecked,
  aPricelessIntentIsNeverShipped,
  notRecordingIsSaidOutLoud,
  paperAndLiveAreTreatedIdentically,
};
