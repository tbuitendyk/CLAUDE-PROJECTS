// Training policy — WHEN a rule's members train, separated from WHAT it trades
// (owner, 2026-08-19).
//
// The owner's question was the whole reason this exists: "we're not
// greenlighting history data, we're greenlighting a set of configs which are
// independent of the training history window ... so why do we care?" The answer
// was that we shouldn't. `trainThrough` had been inherited into the rule shape
// from lib/forwardbook.js, where freeze-at-a-date IS intrinsic, and the
// greenlight then had to invent a value — which it did by reading the run's
// FIRE TIME. For the run that produced F1 that guess lands five weeks past
// anything the run had loaded.
//
// These tests pin the separation, and in particular pin the two ways it could
// silently rot: the rule accepting the field again, and the greenlight
// re-inventing a date.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const tp = require(path.join(ROOT, 'lib', 'live', 'trainpolicy'));
const { validateConfig } = require(path.join(ROOT, 'lib', 'live', 'configschema'));
const { BOOKS, TRAIN_THROUGH } = require(path.join(ROOT, 'lib', 'forwardbook'));

function ruleOf(book) {
  return {
    combo: book.combo, branch: book.branch, stage: book.stage,
    members: book.members, cell: book.cell, configVersion: 'test/v1',
  };
}

// A RULE IS COMPLETE WITHOUT A TRAINING WINDOW. This is the claim the owner
// made and it has to hold in the validator, not just in prose.
function aRuleValidatesWithNoTrainingWindowAtAll() {
  for (const book of BOOKS) {
    const v = validateConfig(ruleOf(book));
    assert.ok(v.ok, `${book.id} was refused without a training window: ${(v.errors || []).join('; ')}`);
  }
}

// ...and the field must not sneak back in as a requirement.
function theRuleShapeDoesNotRequireATrainingWindow() {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'configschema.js'), 'utf8');
  assert.ok(!/fail\(errors, 'trainThrough/.test(src),
    'configschema is requiring trainThrough again — a rule does not carry a training window');
}

// THE GREENLIGHT MUST NOT INVENT A DATE. It used to read the run's fire time,
// which is not the data horizon and not a decision anyone made.
function theGreenlightInventsNoTrainingFreeze() {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'greenlight.js'), 'utf8');
  assert.ok(!/trainThrough:\s*fired/.test(src),
    'the greenlight is setting a training freeze from the run again');
}

function frozenAndRollingResolveAsDeclared() {
  const frozen = tp.resolveFreeze({ id: 's1', trainPolicy: { mode: 'frozen', throughMs: TRAIN_THROUGH } });
  assert.strictEqual(frozen.throughMs, TRAIN_THROUGH);
  assert.strictEqual(frozen.legacy, false);

  const now = 1_800_000_000_000;
  const rolling = tp.resolveFreeze({ id: 's2', trainPolicy: { mode: 'rolling' } }, now);
  assert.strictEqual(rolling.throughMs, now, 'rolling must train through everything closed by now');
  assert.strictEqual(rolling.legacy, false);
}

// LEGACY IS HONOURED, AND FLAGGED. Setups minted before the split keep working
// — nothing paper-trading is disturbed — but the result says `legacy` so the
// screens can label it and the old shape cannot quietly become permanent.
function aLegacySetupKeepsWorkingAndIsFlaggedAsLegacy() {
  const out = tp.resolveFreeze({ id: 'old', configSnapshot: { trainThrough: TRAIN_THROUGH } });
  assert.strictEqual(out.throughMs, TRAIN_THROUGH, 'a legacy setup lost its freeze — that would retrain it');
  assert.strictEqual(out.legacy, true, 'a legacy freeze was not flagged, so the old shape becomes invisible');
}

// A deployment with neither must fail LOUDLY. Defaulting would silently pick a
// training window for a real trading rule, which is the whole class of error
// being removed.
function aDeploymentWithNoPolicyAndNoLegacyIsRefused() {
  assert.throws(() => tp.resolveFreeze({ id: 'bare' }), /no training policy/,
    'a deployment with no policy was given one by default');
}

function anIncoherentPolicyIsRefused() {
  assert.ok(tp.validatePolicy({ mode: 'frozen' }).some((e) => /throughMs/.test(e)),
    'a frozen policy with no instant was accepted');
  assert.ok(tp.validatePolicy({ mode: 'rolling', throughMs: 123 }).some((e) => /throughMs/.test(e)),
    'a rolling policy carrying an instant was accepted — the two say different things');
  assert.ok(tp.validatePolicy({ mode: 'whenever' }).some((e) => /mode/.test(e)));
  assert.ok(tp.validatePolicy(null).length, 'a missing policy was accepted');
}

// The signal must take the freeze from the deployment, not the rule.
function theLiveSignalReadsTheFreezeFromTheDeployment() {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'signal.js'), 'utf8');
  assert.ok(!/cfg\.trainThrough/.test(src),
    'the live signal is reading the freeze off the rule again');
  assert.ok(/resolveFreeze\(setup\)/.test(src),
    'the live signal no longer resolves the freeze from the deployment');
}

module.exports = {
  aRuleValidatesWithNoTrainingWindowAtAll,
  theRuleShapeDoesNotRequireATrainingWindow,
  theGreenlightInventsNoTrainingFreeze,
  frozenAndRollingResolveAsDeclared,
  aLegacySetupKeepsWorkingAndIsFlaggedAsLegacy,
  aDeploymentWithNoPolicyAndNoLegacyIsRefused,
  anIncoherentPolicyIsRefused,
  theLiveSignalReadsTheFreezeFromTheDeployment,
};
