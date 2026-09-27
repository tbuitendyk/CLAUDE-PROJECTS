// Training policy — WHEN a rule's members train, separated from WHAT it trades
// (owner, 2026-08-19).
//
// The owner's question was the whole reason this exists: "we're not
// greenlighting history data, we're greenlighting a set of configs which are
// independent of the training history window ... so why do we care?" The answer
// was that we shouldn't. `trainThrough` had been inherited into the rule shape
// from three trade set-ups once written into the product, where
// freeze-at-a-date WAS intrinsic, and the
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
const { A_CUTOFF_MS, aSetupConfig } = require('./fixtures-setup');

function ruleOf(cfg) {
  return {
    engine: cfg.engine, combo: cfg.combo, branch: cfg.branch, stage: cfg.stage,
    members: cfg.members, cell: cfg.cell, agreement: cfg.agreement, training: cfg.training, configVersion: 'test/v1',
  };
}
// A few shapes of rule, made here rather than borrowed from the product:
// two different sets of coins, and a breakout cell beside a market one.
const RULES = [
  aSetupConfig(),
  aSetupConfig({ combo: { trade: 'XLMUSDT', ctx1: 'DOTUSDT', ctx2: 'TRXUSDT', size: 3 } }),
  aSetupConfig({ branch: { geometry: 'daily-4d', decision: 'directional', band: 1.61, weekdaysOnly: false },
    cell: { quorum: null, entry: 'breakout', gate: 'active', dMult: 1.5, tHours: 161, trailMult: null, armMult: null } }),
];

// A RULE IS COMPLETE WITHOUT A TRAINING WINDOW. This is the claim the owner
// made and it has to hold in the validator, not just in prose.
function aRuleValidatesWithNoTrainingWindowAtAll() {
  RULES.forEach((cfg, i) => {
    const v = validateConfig(ruleOf(cfg));
    assert.ok(v.ok, `rule ${i + 1} was refused without a training window: ${(v.errors || []).join('; ')}`);
  });
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
  const frozen = tp.resolveFreeze({ id: 's1', trainPolicy: { mode: 'frozen', throughMs: A_CUTOFF_MS } });
  assert.strictEqual(frozen.throughMs, A_CUTOFF_MS);

  const now = 1_800_000_000_000;
  const rolling = tp.resolveFreeze({ id: 's2', trainPolicy: { mode: 'rolling' } }, now);
  assert.strictEqual(rolling.throughMs, now, 'rolling must train through everything closed by now');
}

// THE OLD TRAINING DATE IS NOT READ (3.284.0, RULE NINE). Early setups carried
// it inside their frozen configuration; no setup on the box did when the
// fallback that read it was removed. A setup with only that date has no
// Members train choice, and decides nothing until one is picked.
function theOldTrainingDateIsNotRead() {
  assert.throws(() => tp.resolveFreeze({ id: 'old', configSnapshot: { trainThrough: A_CUTOFF_MS } }), /no training policy — pick Members train: as trained by Construct, frozen at or rolling/,
    'the old training date inside a frozen configuration was read as a Members train choice');
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'trainpolicy.js'), 'utf8');
  assert.ok(!/configSnapshot\.trainThrough|legacy:/.test(src), 'the fallback to the old training date is back');
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

// THREE CHOICES (3.283.0, owner 2026-09-27): "as trained by Construct" beside
// frozen at and rolling. It names no instant -- Construct's own is read from
// its history -- and it can be used only while the greenlight carries that
// history; one answer says why not, for the Save and for the decision alike.
function asTrainedByConstructIsTheThirdChoiceAndNeedsItsGreenlightsHistory() {
  assert.deepStrictEqual(tp.MODES, ['construct', 'frozen', 'rolling']);
  assert.deepStrictEqual(tp.validatePolicy({ mode: 'construct' }), []);
  assert.ok(tp.validatePolicy({ mode: 'construct', throughMs: 123 }).some((e) => /history Construct kept/.test(e)),
    'an instant on "as trained by Construct" was accepted -- Construct\'s history says where it ends');
  assert.deepStrictEqual(tp.resolveFreeze({ id: 's', trainPolicy: { mode: 'construct' } }), { mode: 'construct', throughMs: null });
  assert.strictEqual(tp.constructRefusal(null), 'the greenlight this setup came from is not on the box');
  assert.strictEqual(tp.constructRefusal({ id: 'gl' }), 'its greenlight carries no record of the history Construct trained on');
  assert.strictEqual(tp.constructRefusal({ construct: { lost: 'the stage 2 set its members were trained in is no longer on the box' } }), 'the stage 2 set its members were trained in is no longer on the box');
  assert.strictEqual(tp.constructRefusal({ construct: { hours: { coins: { LTCUSDT: {} } } } }), null);
  // and the decision refuses in the same words the Save does
  const sig = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'signal.js'), 'utf8');
  assert.ok(/require\('\.\/trainpolicy'\)\.constructRefusal\(gl\)/.test(sig), 'the decision has its own idea of when Construct\'s history is missing');
  const routes = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'routes.js'), 'utf8');
  assert.ok(/tp\.constructRefusal\(/.test(routes) && /tp\.validatePolicy\(b\.trainPolicy\)/.test(routes), 'the Save takes any Members train, or one it cannot train by');
}

// A BOOK KEEPS NO HELD STRETCH (3.283.0, owner 2026-09-27: "Why would we be
// wasting fifteen percent?"): frozen at and rolling train on all of it, or
// keep the newest 15% as test when the rule reads test -- voices, or a bar of
// its own history -- and nothing else does. Marked from the training stretch
// with the band worked out there, exactly as Construct's cut is.
function aBookKeepsNoHeldStretchAndTestOnlyWhenTheRuleReadsIt() {
  const bw = require(path.join(ROOT, 'lib', 'bracketwork'));
  const ss = require(path.join(ROOT, 'lib', 'live', 'stagesignal'));
  const chunks = () => Array.from({ length: 200 }, (_, i) => ({ startTs: i * 864e5, diffPct: ((i * 37) % 23) - 11 }));
  const all = bw.splitAndLabelBook(chunks(), { band: 'auto' }, false);
  assert.deepStrictEqual([all.trainChunks.length, all.testChunks.length, all.holdChunks.length], [200, 0, 0], 'all of it trains');
  const withTest = bw.splitAndLabelBook(chunks(), { band: 'auto' }, true);
  assert.deepStrictEqual([withTest.trainChunks.length, withTest.testChunks.length, withTest.holdChunks.length], [170, 30, 0], 'the newest 15% is test, nothing is held');
  assert.strictEqual(withTest.testChunks[0].startTs, 170 * 864e5, 'and it is the newest');
  const cons = bw.splitAndLabel(chunks(), { band: 'auto' }, true);
  assert.deepStrictEqual([cons.trainChunks.length, cons.testChunks.length, cons.holdChunks.length], [140, 30, 30], 'Construct\'s own cut is 70/15/15');
  // the band is the one worked out on the training stretch, as Construct works it out
  const { balancedBandPct } = require(path.join(ROOT, 'lib', 'dataset'));
  assert.strictEqual(withTest.bandPct, balancedBandPct(chunks().slice(0, 170).map((c) => c.diffPct)));
  assert.strictEqual(cons.bandPct, balancedBandPct(chunks().slice(0, 140).map((c) => c.diffPct)));
  assert.strictEqual(bw.BOOK_TEST_SHARE, 0.15);
  // what reads test: voices, and a bar of its own history -- nothing else
  assert.strictEqual(ss.readsTestStretch({ agreement: { rule: 'voices', bar: 'all' } }), true);
  assert.strictEqual(ss.readsTestStretch({ agreement: { rule: 'count', bar: 'own' } }), true);
  assert.strictEqual(ss.readsTestStretch({ agreement: { rule: 'trained', bar: null } }), false);
  assert.strictEqual(ss.readsTestStretch({ agreement: { rule: 'count', bar: 'all' } }), false);
  // and the member training marks with the band worked out, never the configuration's
  const live = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'stagesignal.js'), 'utf8');
  assert.ok(live.includes("const branch = { ...cfg.branch, band: 'auto' };"), 'the book marks its members\' answers with the configuration\'s band again');
  assert.ok(live.includes('? splitAndLabel(closed, branch, true, bands)') && live.includes(': splitAndLabelBook(closed, branch, readsTestStretch(cfg), bands);'),
    'the cut is no longer chosen by the Members train choice');
}

module.exports = {
  asTrainedByConstructIsTheThirdChoiceAndNeedsItsGreenlightsHistory,
  aBookKeepsNoHeldStretchAndTestOnlyWhenTheRuleReadsIt,
  aRuleValidatesWithNoTrainingWindowAtAll,
  theRuleShapeDoesNotRequireATrainingWindow,
  theGreenlightInventsNoTrainingFreeze,
  frozenAndRollingResolveAsDeclared,
  theOldTrainingDateIsNotRead,
  aDeploymentWithNoPolicyAndNoLegacyIsRefused,
  anIncoherentPolicyIsRefused,
  theLiveSignalReadsTheFreezeFromTheDeployment,
};
