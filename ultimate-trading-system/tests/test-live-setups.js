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
const { A_CUTOFF_MS, aSetupConfig } = require('./fixtures-setup');

// The canonical valid config: F1's frozen book spec expressed in the shared
// vocabulary. Built from the engine's own committee, so this fixture
// can never drift from the engine's real shape.
function f1Config() {
  const F1 = aSetupConfig();
  return {
    combo: { ...F1.combo },
    branch: { ...F1.branch },
    stage: F1.stage,
    members: F1.members.map((m) => ({ ...m })),
    cell: { ...F1.cell },
    trainThrough: A_CUTOFF_MS,
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
  const s = mkSetup({ keyRef: 'sub-acct-1' });   // R7: live needs its own sub-account
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
  const s = mkSetup({ keyRef: 'sub-acct-2' });   // R7: live needs its own sub-account
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

// ---- R10: only a live-EXECUTABLE geometry/symbol may go paper or live --------
module.exports.f1ShapeSetupMayGoPaperAndLive = function () {
  const s = mkSetup({ keyRef: 'sub-acct-3' });  // F1 shape; R7: live needs a sub-account
  assert.strictEqual(reg.transition(s.id, 'paper').state, 'paper',
    'the F1 market/directional shape is live-executable');
  assert.strictEqual(reg.transition(s.id, 'live').state, 'live');
};

module.exports.liveRequiresItsOwnSubAccountKeyRef = function () {
  // R7: a setup sharing one sub-account with F1 mingles balance + borrow pool, so
  // multi-day short interest pools onto whoever closes last and cross-contaminates
  // realized. Going LIVE without a distinct keyRef is refused; PAPER needs none.
  const s = mkSetup();  // no keyRef
  assert.strictEqual(reg.transition(s.id, 'paper').state, 'paper', 'paper needs no sub-account');
  let err = null;
  try { reg.transition(s.id, 'live'); } catch (e) { err = e; }
  assert.ok(err && err.code === 'NOT_LIVE_EXECUTABLE', `expected refusal, got ${err && err.code}`);
  assert.ok(/keyRef|sub-account/.test(err.message), err.message);
  // with its own sub-account it may go live
  reg.updateSetup(s.id, { keyRef: 'sub-acct-own' });
  assert.strictEqual(reg.transition(s.id, 'live').state, 'live');
};

module.exports.updateSetupReRunsTheLiveGateSoRoutingCantBeBlankedPastTheDoor = function () {
  // Independent review 2026-08-12: updateSetup mutates executionTargetRef/keyRef —
  // the routing/isolation fields the transition door guards. An already-LIVE setup
  // must re-clear the same gate, or updateSetup is a SECOND unguarded door: blanking
  // a live setup's keyRef would re-mingle its borrow/balance pool with F1. Tripwire —
  // drop the updateSetup gate and the blank is accepted, failing this test.
  const s = mkSetup({ keyRef: 'sub-acct-live' });
  assert.strictEqual(reg.transition(s.id, 'live').state, 'live');
  let err = null;
  try { reg.updateSetup(s.id, { keyRef: '' }); } catch (e) { err = e; }
  assert.ok(err && err.code === 'NOT_LIVE_EXECUTABLE',
    `blanking a live setup's keyRef must be refused, got ${err && err.code}`);
  assert.ok(/keyRef|sub-account/.test(err.message), err.message);
  // the rejected update never wrote — the live setup still carries its own key
  assert.strictEqual(reg.getSetup(s.id).keyRef, 'sub-acct-live');
  // the safe operational surface (clip/name/stop) still updates on a live setup —
  // the gate closes the routing door without over-blocking the tunable fields
  const upd = reg.updateSetup(s.id, { clipUsd: 30, name: 'tuned' });
  assert.strictEqual(upd.clipUsd, 30);
  assert.strictEqual(upd.keyRef, 'sub-acct-live', 'routing untouched by a safe update');
};

module.exports.updateSetupGateAlsoCoversStoppedSetupsWindingDownRealExits = function () {
  // Confirming re-review 2026-08-12: a STOPPED setup is not quiet — stopping halts
  // new entries but existing real positions still EXIT, routed by executionTargetRef.
  // Re-pointing a stopped setup at a box that doesn't serve its symbol would silently
  // misroute the real exit of a live position. So the updateSetup gate must cover
  // 'stopped' too, not just paper/live. Tripwire: drop 'stopped' from the gate
  // condition and the bad re-point is accepted, failing this test.
  const s = mkSetup({ keyRef: 'sub-acct-stop' });
  assert.strictEqual(reg.transition(s.id, 'live').state, 'live');
  assert.strictEqual(reg.transition(s.id, 'stopped').state, 'stopped'); // mandated winddown
  let err = null;
  try { reg.updateSetup(s.id, { executionTargetRef: 'no-such-box' }); } catch (e) { err = e; }
  assert.ok(err && err.code === 'NOT_LIVE_EXECUTABLE',
    `re-pointing a stopped setup at a dangling target must be refused, got ${err && err.code}`);
  // the rejected update never wrote — routing intact for the real exit
  assert.notStrictEqual(reg.getSetup(s.id).executionTargetRef, 'no-such-box');
  // a safe field update on a stopped setup still works (no over-block)
  const upd = reg.updateSetup(s.id, { name: 'winding-down' });
  assert.strictEqual(upd.name, 'winding-down');
};

module.exports.unexecutableGeometryIsRefusedAtPaperTransition = function () {
  // a breakout / active-gate / trailing / arm cell would be SILENTLY mis-traded
  // as market/hold-to-t by the live executor — refuse it at the door to paper.
  for (const [mut, needle] of [
    [(c) => { c.cell.entry = 'breakout'; c.cell.dMult = 2; }, 'MARKET entry'],
    [(c) => { c.cell.gate = 'active'; }, 'DIRECTIONAL gate'],
    [(c) => { c.cell.trailMult = 1.5; }, 'trailing stop'],
    [(c) => { c.cell.armMult = 1.2; }, 'arm gate'],
  ]) {
    const cfg = f1Config(); mut(cfg);
    const s = mkSetup({ configSnapshot: cfg });
    let err = null;
    try { reg.transition(s.id, 'paper'); } catch (e) { err = e; }
    assert.ok(err && err.code === 'NOT_LIVE_EXECUTABLE',
      `expected NOT_LIVE_EXECUTABLE, got ${err && err.code}: ${err && err.message}`);
    assert.ok(err.message.includes(needle), `error names the unsupported feature: ${err.message}`);
    assert.strictEqual(reg.getSetup(s.id).state, 'draft', 'refused setup stays a draft (never traded)');
  }
};

module.exports.unservedSymbolIsRefusedAtPaperTransition = function () {
  // the box serves only LTCUSDT; a setup on another pair would have every intent
  // silently rejected by the box — refuse it at the door instead.
  const cfg = f1Config(); cfg.combo.trade = 'XRPUSDT';
  const s = mkSetup({ configSnapshot: cfg });
  assert.strictEqual(s.tradedPair, 'XRPUSDT');
  let err = null;
  try { reg.transition(s.id, 'paper'); } catch (e) { err = e; }
  assert.ok(err && err.code === 'NOT_LIVE_EXECUTABLE',
    `expected NOT_LIVE_EXECUTABLE, got ${err && err.code}: ${err && err.message}`);
  assert.ok(/XRPUSDT/.test(err.message) && /serves/.test(err.message), err.message);
};
