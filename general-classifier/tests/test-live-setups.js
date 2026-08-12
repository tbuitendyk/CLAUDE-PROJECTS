// TradingSetup registry (plan phase 1): schema validation, configSnapshot
// immutability, the state machine, and crash-safe storage. Runs against a
// scratch dir via GC_SETUPS_DIR — never the real data/ tree.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.GC_SETUPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-setups-'));
const reg = require('../lib/live/setups');
const { validateConfig } = require('../lib/live/configschema');
const { BOOKS, TRAIN_THROUGH } = require('../lib/forwardbook');

// The canonical valid config: F1's frozen book spec expressed in the shared
// vocabulary. Built from the SAME source forwardbook freezes, so this fixture
// can never drift from the engine's real shape.
function f1Config() {
  const F1 = BOOKS.find((b) => b.id === 'F1');
  return {
    combo: { ...F1.combo },
    branch: { ...F1.branch },
    stage: F1.stage,
    members: F1.members.map((m) => ({ ...m })),
    cell: { ...F1.cell },
    trainThrough: TRAIN_THROUGH,
    configVersion: 'f1-v1-2026-08-11',
  };
}
let seq = 0;
function mkSetup(over = {}) {
  seq += 1;
  return reg.createSetup({
    id: `t-${process.pid}-${seq}`, name: 'test setup', ownerId: 'owner',
    configSnapshot: f1Config(), clipUsd: 10, ...over,
  });
}

module.exports.f1BookSpecIsAValidConfigSnapshot = function () {
  const v = validateConfig(f1Config());
  assert.ok(v.ok, `F1's frozen book must validate: ${v.errors}`);
};

module.exports.configValidationCatchesEveryBrokenField = function () {
  const cases = [
    [(c) => { c.combo.trade = 'nope'; }, 'combo.trade'],
    [(c) => { c.combo.size = 2; }, 'combo.size'],
    [(c) => { c.branch.geometry = 'weekly-99x'; }, 'branch.geometry'],
    [(c) => { c.branch.decision = 'vibes'; }, 'branch.decision'],
    [(c) => { c.branch.band = 0; }, 'branch.band'],
    [(c) => { c.stage = 'mega'; }, 'stage'],
    [(c) => { c.members = []; }, 'members'],
    [(c) => { c.members[0].model = 'llm'; }, 'members[0].model'],
    [(c) => { c.cell.quorum = 9; }, 'cell.quorum'],   // exceeds committee of 4
    [(c) => { c.cell.entry = 'limit'; }, 'cell.entry'],
    [(c) => { c.cell.tHours = 0; }, 'cell.tHours'],
    [(c) => { delete c.trainThrough; }, 'trainThrough'],
    [(c) => { c.configVersion = ''; }, 'configVersion'],
  ];
  for (const [mutate, field] of cases) {
    const c = f1Config();
    mutate(c);
    const v = validateConfig(c);
    assert.ok(!v.ok && v.errors.some((e) => e.includes(field.split('[')[0].split('.')[0]) || e.includes(field)),
      `expected ${field} to fail validation; got ok=${v.ok} errors=${v.errors}`);
  }
};

module.exports.breakoutEntryRequiresDMult = function () {
  const c = f1Config();
  c.cell.entry = 'breakout'; c.cell.dMult = null;
  const v = validateConfig(c);
  assert.ok(!v.ok && v.errors.some((e) => e.includes('dMult')), 'breakout without dMult must fail');
};

module.exports.createDerivesPairAndStampsEngineVersionAndHistory = function () {
  const s = mkSetup();
  assert.strictEqual(s.state, 'draft');
  assert.strictEqual(s.tradedPair, 'LTCUSDT', 'tradedPair derived from snapshot, not passed');
  assert.ok(/^gc-\d+\.\d+\.\d+\/setup-1\/config-1$/.test(s.engineVersion), `engineVersion stamped: ${s.engineVersion}`);
  assert.strictEqual(s.stateHistory.length, 1);
  assert.strictEqual(s.stateHistory[0].to, 'draft');
  const back = reg.getSetup(s.id);
  assert.deepStrictEqual(back, s, 'round-trips through disk');
};

module.exports.createRejectsBadConfigAndBadOperational = function () {
  let threw = null;
  try { mkSetup({ configSnapshot: { combo: {} } }); } catch (e) { threw = e; }
  assert.ok(threw && threw.code === 'BAD_CONFIG', 'invalid snapshot refused');
  threw = null;
  try { mkSetup({ clipUsd: -5 }); } catch (e) { threw = e; }
  assert.ok(threw && threw.code === 'BAD_SETUP', 'negative clip refused');
  threw = null;
  try { mkSetup({ stopPct: 0.001 }); } catch (e) { threw = e; }
  assert.ok(threw && threw.code === 'BAD_SETUP' && /floor/.test(threw.message), 'sub-floor stop refused');
};

module.exports.configSnapshotAndIdentityAreImmutable = function () {
  const s = mkSetup();
  for (const patch of [
    { configSnapshot: f1Config() },
    { tradedPair: 'BTCUSDT' },
    { engineVersion: 'forged' },
    { id: 'other' },
    { createdUtc: 'yesterday' },
    { state: 'live' },              // state moves via transition(), never update()
    { stateHistory: [] },
  ]) {
    let threw = null;
    try { reg.updateSetup(s.id, patch); } catch (e) { threw = e; }
    assert.ok(threw && threw.code === 'IMMUTABLE',
      `patch ${Object.keys(patch)} must be refused, got ${threw && threw.code}`);
  }
  // mutable surface still works
  const upd = reg.updateSetup(s.id, { clipUsd: 25, name: 'renamed', stopPct: 0.11 });
  assert.strictEqual(upd.clipUsd, 25);
  assert.strictEqual(upd.stopPct, 0.11);
};

module.exports.stateMachineAllowsDeclaredPathsOnly = function () {
  const s = mkSetup();
  // draft -> paper -> live -> stopped -> live (restart) -> stopped -> retired
  reg.transition(s.id, 'paper');
  reg.transition(s.id, 'live');
  let threw = null;
  try { reg.transition(s.id, 'retired'); } catch (e) { threw = e; }
  assert.ok(threw && threw.code === 'BAD_TRANSITION', 'live -> retired must be two-step (stop first)');
  reg.transition(s.id, 'stopped');
  reg.transition(s.id, 'live');
  reg.transition(s.id, 'stopped');
  const done = reg.transition(s.id, 'retired');
  assert.strictEqual(done.state, 'retired');
  assert.strictEqual(done.stateHistory.length, 7, 'every hop journaled');
  threw = null;
  try { reg.transition(s.id, 'draft'); } catch (e) { threw = e; }
  assert.ok(threw && threw.code === 'BAD_TRANSITION', 'retired is terminal');
};

module.exports.draftBypassStraightToLiveIsAllowed = function () {
  // NEXT-RELEASE point 15 (owner amendment): paper is OPTIONAL — deeper-pocket
  // users go straight to live.
  const s = mkSetup();
  const live = reg.transition(s.id, 'live');
  assert.strictEqual(live.state, 'live');
};

module.exports.onlyDraftsDeleteEverythingElseRetires = function () {
  const s = mkSetup();
  reg.transition(s.id, 'paper');
  let threw = null;
  try { reg.deleteDraft(s.id); } catch (e) { threw = e; }
  assert.ok(threw && threw.code === 'NOT_DRAFT', 'a setup that ran keeps its record');
  const d = mkSetup();
  assert.strictEqual(reg.deleteDraft(d.id), true);
  assert.strictEqual(reg.getSetup(d.id), null);
};

module.exports.getSetupBlocksPathTraversal = function () {
  assert.strictEqual(reg.getSetup('../../etc/passwd'), null);
  assert.strictEqual(reg.getSetup('a/b'), null);
  assert.strictEqual(reg.getSetup(''), null);
};

module.exports.listReturnsCreatedSetupsSortedByCreation = function () {
  const before = reg.listSetups().length;
  const a = mkSetup(); const b = mkSetup();
  const list = reg.listSetups();
  assert.strictEqual(list.length, before + 2);
  const ids = list.map((x) => x.id);
  assert.ok(ids.indexOf(a.id) < ids.indexOf(b.id), 'creation order preserved');
};
