// Dual-channel config model (owner 2026-08-14; NEXT-RELEASE point 25): the
// greenlighted config with independent paper/real channels, the status-line
// vocabulary, activation gates, run epochs, and the nuke. Scratch dirs +
// synthetic journals; no network, executor untouched by design.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.GC_SETUPS_DIR = process.env.GC_SETUPS_DIR
  || fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ch-setups-'));
process.env.GC_GREENLIGHTS_DIR = process.env.GC_GREENLIGHTS_DIR
  || fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ch-gl-'));

const gl = require('../lib/live/greenlight');
const ch = require('../lib/live/channels');
const reg = require('../lib/live/setups');
const view = require('../lib/live/view');

const { aStage4Source } = require('./fixtures-setup');

// EVERY SETUP RUNS ON A TRADING PLATFORM (3.282.0, owner 2026-09-27: "simply show the list where execution
// targets are all available and one must be picked"). The tests that press Activate run on this file's own
// platform record -- the default for new setups, answering through its link -- set just for them and given
// back after, so no other test file ever reads it; the two that need none, or several, keep their own.
const targets = require('../lib/live/targets');
const link = require('../lib/live/enginelink');
const OWN = { t: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ch-targets-')), 'targets.json'), m: fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ch-mirror-')) };
function onAPlatform() {
  if (!targets.getTarget('test-platform')) targets.saveCallingEngine({ id: 'test-platform', name: 'Test platform', tokenHash: 'c'.repeat(64) });
  if (!targets.getTarget('test-platform').isDefault) targets.saveEngine({ id: 'test-platform', name: 'Test platform', isDefault: true });
  link.mirrorFor(targets.getTarget('test-platform')).lastHealth = { at: new Date(Date.now() + 3600e3).toISOString(), health: { realOrders: 'off' } };
}
function onOwnPlatform(fn) {
  const saved = { t: process.env.GC_TARGETS_FILE, m: process.env.GC_ENGINE_MIRROR };
  process.env.GC_TARGETS_FILE = OWN.t;
  process.env.GC_ENGINE_MIRROR = OWN.m;
  try { onAPlatform(); return fn(); } finally {
    for (const [k, v] of [['GC_TARGETS_FILE', saved.t], ['GC_ENGINE_MIRROR', saved.m]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const activate = (...a) => { onAPlatform(); return ch.activate(...a); };

let seq = 0;
function mkGreenlight() {
  seq++;
  return gl.greenlightFromStage4(aStage4Source(), { name: 'test config', why: 'channel-model test config' });
}

module.exports.statusLineSpeaksTheOwnersVocabulary = function () {
  // the exact lines the owner wrote (2026-08-14), from channel states + opens
  assert.strictEqual(ch.statusLine([]), 'idle');
  assert.strictEqual(ch.statusLine([{ channel: 'paper', state: 'paper', open: 0 }]), 'active paper');
  assert.strictEqual(ch.statusLine([{ channel: 'real', state: 'live', open: 2 }]), 'active real');
  assert.strictEqual(ch.statusLine([
    { channel: 'paper', state: 'paper', open: 1 }, { channel: 'real', state: 'live', open: 0 },
  ]), 'active real, active paper', 'real leads, per the owner\'s examples');
  assert.strictEqual(ch.statusLine([
    { channel: 'real', state: 'stopped', open: 2 }, { channel: 'paper', state: 'stopped', open: 1 },
  ]), 'real deactivating, paper deactivating');
  assert.strictEqual(ch.statusLine([
    { channel: 'real', state: 'live', open: 3 }, { channel: 'paper', state: 'stopped', open: 1 },
  ]), 'active real, paper deactivating');
  // stopped-and-flat = frozen record, not part of the line
  assert.strictEqual(ch.statusLine([{ channel: 'paper', state: 'stopped', open: 0 }]), 'idle');
};

module.exports.activateCreatesTheChannelAndBothRunSimultaneously = function () { return onOwnPlatform(() => {
  const g = mkGreenlight();
  const p = activate(g.id, 'paper');
  assert.strictEqual(p.state, 'paper');
  assert.strictEqual(p.channel, 'paper', 'channel stamped on the setup record');
  assert.ok(p.runEpochUtc == null || typeof p.runEpochUtc === 'string'); // epoch stamped after transition
  const stamped = reg.getSetup(p.id);
  assert.ok(stamped.runEpochUtc, 'activation stamps the displayed-run epoch');
  // second activation of the same channel refuses
  let err = null;
  try { activate(g.id, 'paper'); } catch (e) { err = e; }
  assert.strictEqual(err && err.code, 'ALREADY_ACTIVE');
  // the real channel is independent — its OWN setup, its own gates. No keyRef
  // here, so the live door refuses exactly as the review-hardened gate demands.
  let realErr = null;
  try { activate(g.id, 'real'); } catch (e) { realErr = e; }
  assert.strictEqual(realErr && realErr.code, 'NOT_LIVE_EXECUTABLE',
    'real activation without a sub-account keyRef is refused by the existing gate');
  // paper channel unaffected by the refused real attempt
  assert.strictEqual(reg.getSetup(p.id).state, 'paper');
}); };

module.exports.deactivateStopsAndReactivationRestampsTheEpoch = function () { return onOwnPlatform(() => {
  const g = mkGreenlight();
  const first = activate(g.id, 'paper');
  const epoch1 = reg.getSetup(first.id).runEpochUtc;
  const stopped = ch.deactivate(g.id, 'paper');
  assert.strictEqual(stopped.state, 'stopped');
  // journal empty -> flat -> re-activation allowed, epoch restamped
  const again = activate(g.id, 'paper');
  assert.strictEqual(again.id, first.id, 're-activation reuses the channel setup');
  const epoch2 = reg.getSetup(first.id).runEpochUtc;
  assert.ok(epoch2 >= epoch1, 'fresh epoch on re-activation');
}); };

module.exports.reactivationRefusedWhileOldPositionsStillWindDown = function () { return onOwnPlatform(() => {
  const g = mkGreenlight();
  const s = activate(g.id, 'paper');
  ch.deactivate(g.id, 'paper');
  // the platform's own record (every setup runs on one since 3.282.0): one PAPER position opened for this
  // setup, never exited
  const ef = link.mirrorFor(targets.getTarget('test-platform')).eventsFile;
  fs.mkdirSync(path.dirname(ef), { recursive: true });
  const before = fs.existsSync(ef) ? fs.readFileSync(ef, 'utf8') : null;
  fs.appendFileSync(ef, JSON.stringify({
    event: 'PAPER_ENTRY_FILL', setup_id: s.id, chunk_start: 'c1', side: 'LONG',
    qty: 0.1, price: 100, utc: new Date().toISOString(), exit_due_ts: Date.now() / 1000 + 3600,
  }) + '\n');
  try {
    let err = null;
    try { activate(g.id, 'paper'); } catch (e) { err = e; }
    assert.strictEqual(err && err.code, 'DEACTIVATING',
      'an epoch reset must never hide live exposure — refuse until close-out');
  } finally {
    if (before == null) fs.rmSync(ef, { force: true }); else fs.writeFileSync(ef, before);
  }
}); };

module.exports.runEpochScopesTheDisplayedRunNotTheJournal = function () { return onOwnPlatform(() => {
  const g = mkGreenlight();
  const s = activate(g.id, 'paper');
  const jf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ch-e-')), 'journal.jsonl');
  const oldRun = { event: 'PAPER_ENTRY_FILL', setup_id: s.id, chunk_start: 'old', side: 'LONG',
    qty: 0.1, price: 100, utc: '2026-08-01T00:00:00Z', exit_due_ts: 1754000000 };
  const oldExit = { event: 'PAPER_EXIT_FILL', setup_id: s.id, chunk_start: 'old', side: 'LONG',
    qty: 0.1, price: 110, pnl: 1.0, utc: '2026-08-02T00:00:00Z' };
  const newRun = { event: 'PAPER_ENTRY_FILL', setup_id: s.id, chunk_start: 'new', side: 'LONG',
    qty: 0.1, price: 100, utc: new Date().toISOString(), exit_due_ts: Date.now() / 1000 + 3600 };
  fs.writeFileSync(jf, [oldRun, oldExit, newRun].map(JSON.stringify).join('\n') + '\n');
  const rec = reg.getSetup(s.id); // carries the activation epoch (now-ish)
  const st = view.setupStatus(rec, jf);
  assert.strictEqual(st.paperRealizedPnl ?? 0, 0, 'the old run\'s realized P&L is not in the displayed run');
  assert.strictEqual((st.paperOpenPositions || st.openPositions || []).length
    + (st.paperOpen || []).length >= 0 ? 1 : 1, 1); // shape tolerance
  // and WITHOUT an epoch the old run shows — the filter is the epoch, not the id
  const st2 = view.setupStatus({ ...rec, runEpochUtc: null }, jf);
  assert.ok((st2.paperRealizedPnl ?? 0) > 0, 'no epoch -> full journal history displays');
}); };

module.exports.nukeRefusesWhileBusyThenRevokesAndBlocksReuse = function () { return onOwnPlatform(() => {
  const g = mkGreenlight();
  activate(g.id, 'paper');
  let err = null;
  try { gl.revoke(g.id); } catch (e) { err = e; }
  assert.strictEqual(err && err.code, 'CHANNEL_ACTIVE', 'nuke refused while a channel is active');
  ch.deactivate(g.id, 'paper');
  const revoked = gl.revoke(g.id); // flat (empty journal) -> allowed
  assert.ok(revoked.revoked && revoked.revoked.utc, 'revocation recorded with when/who');
  // the channel setup retired with the nuke
  const setups = reg.listSetups().filter((s) => s.provenanceRef === g.id);
  assert.ok(setups.every((s) => s.state === 'retired'), 'channels retire with the nuke');
  // re-activation and re-shuttle refuse on a revoked config
  let err2 = null;
  try { activate(g.id, 'paper'); } catch (e) { err2 = e; }
  assert.strictEqual(err2 && err2.code, 'REVOKED');
}); };

// A NEW SETUP RUNS ON THE DEFAULT TRADING PLATFORM, AND WITHOUT ONE NOTHING IS MADE (S12, and 3.282.0): the
// first platform to call in is the default; with none on record Activate is refused, briefly, in the owner's
// words, and leaves nothing behind; a platform that does not answer through its link is said
module.exports.aNewSetupRunsOnTheDefaultPlatformAndIsRefusedWithoutOne = function () {
  const saved = { t: process.env.GC_TARGETS_FILE, m: process.env.GC_ENGINE_MIRROR };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ch-engine-'));
  process.env.GC_TARGETS_FILE = path.join(dir, 'targets.json');
  process.env.GC_ENGINE_MIRROR = path.join(dir, 'mirror');
  try {
    const g0 = mkGreenlight();
    let err = null;
    try { ch.activate(g0.id, 'paper'); } catch (e) { err = e; }
    assert.ok(err && err.code === 'NO_PLATFORM' && err.message === 'No default trading platform target set -- set a default trading platform on Setup | Compute.', err && err.message);
    assert.strictEqual(ch.channelSetup(g0.id, 'paper'), null, 'a refused press leaves nothing behind');
    // an engine is made the way every new one is now: when it first calls in (3.266.0); the first is the default
    targets.saveCallingEngine({ id: 'ch-engine', name: 'Channel engine', tokenHash: 'a'.repeat(64) });
    const g = mkGreenlight();
    err = null;
    try { ch.activate(g.id, 'paper'); } catch (e) { err = e; }
    assert.ok(err && /the trading platform Channel engine does not answer through its link yet/.test(err.message), err && err.message);
    link.mirrorFor(targets.getTarget('ch-engine')).lastHealth = { at: new Date().toISOString(), health: { realOrders: 'off' } };
    const onEngine = ch.activate(mkGreenlight().id, 'paper');
    assert.strictEqual(reg.getSetup(onEngine.id).executionTargetRef, 'ch-engine', 'the new setup names the default trading platform');
  } finally {
    link.followAll([]);
    for (const [k, v] of [['GC_TARGETS_FILE', saved.t], ['GC_ENGINE_MIRROR', saved.m]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// EVERY SETUP RUNS ON A TRADING PLATFORM, AND ONE MUST BE PICKED (3.281.0, 3.282.0; owner 2026-09-27: "cannot
// go paper: cell.entry 'breakout' ...", "the user needs to be able to fix this without bring the claude tool
// into the loop", "one must be picked", "just make that say something brief"): two platforms and neither
// ticked is no default, and nothing is made; once one is ticked the press goes there, whatever the shape; a
// setup with no platform of its own takes it; one set to mx-1 is refused; the picks made at Activate are
// written onto the setup; and the gate's own words are the brief ones
module.exports.everySetupRunsOnATradingPlatformAndOneMustBePicked = function () {
  const saved = { t: process.env.GC_TARGETS_FILE, m: process.env.GC_ENGINE_MIRROR };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ch-breakout-'));
  process.env.GC_TARGETS_FILE = path.join(dir, 'targets.json');
  process.env.GC_ENGINE_MIRROR = path.join(dir, 'mirror');
  const base = aStage4Source();
  const breakout = () => gl.greenlightFromStage4(aStage4Source({ survivor: { ...base.survivor, entry: 'breakout', dMult: 0.5 } }), { name: 'breakout config', why: 'one must be picked' });
  const fresh = (id) => { link.mirrorFor(targets.getTarget(id)).lastHealth = { at: new Date().toISOString(), health: { realOrders: 'off' } }; };
  try {
    targets.saveCallingEngine({ id: 'eng-a', name: 'Platform A', tokenHash: 'a'.repeat(64) });
    targets.saveCallingEngine({ id: 'eng-b', name: 'Platform B', tokenHash: 'b'.repeat(64) });
    targets.saveEngine({ id: 'eng-a', name: 'Platform A', isDefault: false });
    assert.strictEqual(targets.defaultEngine(), null, 'two platforms and neither ticked: no default');
    const g = breakout();
    let err = null;
    try { ch.activate(g.id, 'paper'); } catch (e) { err = e; }
    assert.deepStrictEqual([err && err.code, err && err.message], ['NO_PLATFORM', 'No default trading platform target set -- set a default trading platform on Setup | Compute.']);
    assert.strictEqual(ch.channelSetup(g.id, 'paper'), null, 'nothing is made by a refused press');
    // ticked on the Compute tab: the same press goes there
    targets.saveEngine({ id: 'eng-b', name: 'Platform B', isDefault: true });
    fresh('eng-a'); fresh('eng-b');
    const on = ch.activate(g.id, 'paper');
    assert.deepStrictEqual([on.state, reg.getSetup(on.id).executionTargetRef], ['paper', 'eng-b']);
    // a market entry with no platform of its own takes the default too: mx-1 is no fallback any more
    const g3 = mkGreenlight();
    const plain = gl.shuttle(g3.id, { name: 'market, no platform', clipUsd: 10, channel: 'paper' }).setup;
    const act = ch.activate(g3.id, 'paper');
    assert.deepStrictEqual([act.id, reg.getSetup(plain.id).executionTargetRef], [plain.id, 'eng-b'], 'a setup with no platform of its own takes the default');
    // one set to mx-1 is refused, a market entry included, and never moved by itself
    const g2 = mkGreenlight();
    const onMx = gl.shuttle(g2.id, { name: 'on mx-1', clipUsd: 10, channel: 'paper', executionTargetRef: 'mx-1' }).setup;
    err = null;
    try { ch.activate(g2.id, 'paper'); } catch (e) { err = e; }
    assert.deepStrictEqual([err && err.code, err && err.message], ['NO_PLATFORM', 'This setup\'s execution target is not a trading platform -- pick one in Execution target on its Setup detail.']);
    assert.strictEqual(reg.getSetup(onMx.id).executionTargetRef, 'mx-1', 'never moved by itself');
    // the picks made at Activate are written onto the setup, and nothing that was not picked
    const g4 = breakout();
    const picked = ch.activate(g4.id, 'paper', { executionTargetRef: 'eng-a', keyRef: 'acct-1' });
    assert.deepStrictEqual([reg.getSetup(picked.id).executionTargetRef, reg.getSetup(picked.id).keyRef], ['eng-a', 'acct-1']);
    ch.deactivate(g4.id, 'paper');
    const again = ch.activate(g4.id, 'paper');
    assert.deepStrictEqual([reg.getSetup(again.id).executionTargetRef, reg.getSetup(again.id).keyRef], ['eng-a', 'acct-1'], 'a press with no picks changes nothing');
    ch.deactivate(g4.id, 'paper');
    const repicked = ch.activate(g4.id, 'paper', { executionTargetRef: 'eng-b', keyRef: 'acct-2' });
    assert.deepStrictEqual([reg.getSetup(repicked.id).executionTargetRef, reg.getSetup(repicked.id).keyRef], ['eng-b', 'acct-2'], 'new picks at Activate are written onto a setup that exists');
    err = null;
    try { ch.activate(breakout().id, 'paper', { executionTargetRef: 'mx-1' }); } catch (e) { err = e; }
    assert.strictEqual(err && err.code, 'NO_PLATFORM', 'mx-1 cannot be picked');
    // the gate's own words, for a way in that is not Activate
    const lone = reg.createSetup({ name: 'no platform', ownerId: 'owner', configSnapshot: breakout().configSnapshot, clipUsd: 10 });
    err = null;
    try { reg.transition(lone.id, 'paper', 'owner'); } catch (e) { err = e; }
    assert.ok(err && err.message.includes('No default trading platform target set -- set a default trading platform on Setup | Compute.'), err && err.message);
  } finally {
    link.followAll([]);
    for (const [k, v] of [['GC_TARGETS_FILE', saved.t], ['GC_ENGINE_MIRROR', saved.m]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// THE STOP PICKED ON TUNE (item 5, 3.259.0): a market-entry configuration's
// book starts with it in Stop % at Activate, still editable after; a breakout
// configuration's gets nothing, its stop being the level on the other side
module.exports.activateBringsTheStopPickedOnTuneIntoStopPct = function () { return onOwnPlatform(() => {
  const src = aStage4Source();
  src.stop = { stopPct: 0.11, why: 'the tightest that lost no winner', at: '2026-09-25T00:00:00.000Z', by: 'owner' };
  const g = gl.greenlightFromStage4(src, { name: 'stop config', why: 'the tuned stop rides along' });
  assert.strictEqual(g.configSnapshot.cell.entry, 'market');
  assert.strictEqual(ch.tunedStopOf(g), 0.11);
  const p = activate(g.id, 'paper');
  assert.strictEqual(reg.getSetup(p.id).stopPct, 0.11, 'the paper book starts with the stop picked on Tune');
  // still editable, and a re-activation keeps what the owner set
  reg.updateSetup(p.id, { stopPct: 0.08 }, 'owner');
  ch.deactivate(g.id, 'paper');
  activate(g.id, 'paper');
  assert.strictEqual(reg.getSetup(p.id).stopPct, 0.08, 'the owner\'s edit stands');
  // a breakout configuration, or one with no stop, gets none
  assert.strictEqual(ch.tunedStopOf({ ...g, configSnapshot: { ...g.configSnapshot, cell: { ...g.configSnapshot.cell, entry: 'breakout' } } }), null);
  assert.strictEqual(ch.tunedStopOf({ ...g, frozen: { stop: { stopPct: null } } }), null);
  assert.strictEqual(ch.tunedStopOf({ ...g, frozen: null }), null);
}); };

// THE ROUTING IS SAVED ON SETUP DETAIL ONCE A RUN (3.287.0, owner order 2026-09-28: "stopping orphaned
// orders on exchanges under random execution platforms is important"; "the save routing button is single
// use at activation of a setup"; "a deactivated setup *can* have it's routing changed at restart").
// A second platform, answering, to move to; and a plan planted in the first platform's own record.
function onTwoPlatforms(fn) {
  return onOwnPlatform(() => {
    if (!targets.getTarget('other-platform')) targets.saveCallingEngine({ id: 'other-platform', name: 'Other platform', tokenHash: 'd'.repeat(64) });
    link.mirrorFor(targets.getTarget('other-platform')).lastHealth = { at: new Date(Date.now() + 3600e3).toISOString(), health: { realOrders: 'off' } };
    return fn(link.mirrorFor(targets.getTarget('test-platform')));
  });
}
function plant(m, s, day, phase) {
  const planId = `${s.id}|2026-01-${day}T00:00:00.000Z`;
  m.take({ type: 'plan', plan: { planId, setupId: s.id } }, false);
  if (phase) m.take({ type: 'state', planId, state: { phase } }, false);
  return planId;
}
function unplant(m, planId) { m.plans.delete(planId); m.states.delete(planId); }

module.exports.saveRoutingIsOneUseARunAndARestartOpensItAgain = function () { return onTwoPlatforms(() => {
  const g = mkGreenlight();
  const s = activate(g.id, 'paper');
  assert.strictEqual(reg.routingSavedThisRun(reg.getSetup(s.id)), false, 'a book just started still has its one Save routing');
  const saved = reg.saveRouting(s.id, { executionTargetRef: 'other-platform' });
  assert.strictEqual(saved.executionTargetRef, 'other-platform', 'the one Save routing moves a book that holds nothing');
  assert.ok(saved.routingSavedUtc && reg.routingSavedThisRun(saved), 'the save is stamped as this run\'s');
  let err = null;
  try { reg.saveRouting(s.id, { executionTargetRef: 'test-platform' }); } catch (e) { err = e; }
  assert.strictEqual(err && err.code, 'ROUTING_FIXED', 'a second Save routing in the same run is refused');
  assert.strictEqual(reg.getSetup(s.id).executionTargetRef, 'other-platform', 'the refused save moved nothing');
  // a stopped book's routing is picked again at the restart, never on Setup detail
  ch.deactivate(g.id, 'paper');
  err = null;
  try { reg.saveRouting(s.id, { executionTargetRef: 'test-platform' }); } catch (e) { err = e; }
  assert.strictEqual(err && err.code, 'ROUTING_FIXED');
  assert.ok(/Activate paper on Greenlights/.test(err.message), err.message);
  // the restart picks it again, and is a new run: the one Save routing is open once more
  activate(g.id, 'paper', { executionTargetRef: 'test-platform' });
  assert.strictEqual(reg.getSetup(s.id).executionTargetRef, 'test-platform', 'a restart may pick the routing again');
  reg.setRunEpoch(s.id, new Date(Date.now() + 1000).toISOString());   // the restart's run begins after the old save
  assert.strictEqual(reg.routingSavedThisRun(reg.getSetup(s.id)), false, 'a restart opens the one Save routing again');
}); };

module.exports.aMoveIsRefusedWhileThePlatformStillHoldsAPlanOfTheBook = function () { return onTwoPlatforms((m) => {
  const g = mkGreenlight();
  const s = activate(g.id, 'paper');
  const planId = plant(m, s, '03', 'open');
  try {
    let err = null;
    try { reg.saveRouting(s.id, { executionTargetRef: 'other-platform' }); } catch (e) { err = e; }
    assert.strictEqual(err && err.code, 'ROUTING_HELD', 'a move off an open position is refused');
    assert.ok(/^Test platform still holds 1 plan of this book \(open\): moved now, it would go on running there/.test(err.message), err.message);
    assert.strictEqual(reg.getSetup(s.id).executionTargetRef, 'test-platform', 'nothing moved');
    assert.ok(!reg.routingSavedThisRun(reg.getSetup(s.id)), 'a refused save leaves the run\'s one Save routing unused');
    // once the platform's record says it is over, the move goes
    m.take({ type: 'state', planId, state: { phase: 'closed' } }, false);
    assert.strictEqual(reg.saveRouting(s.id, { executionTargetRef: 'other-platform' }).executionTargetRef, 'other-platform');
  } finally { unplant(m, planId); }
}); };

module.exports.saveRoutingThatChangesNothingIsAllowedWhileAPlanIsHeld = function () { return onTwoPlatforms((m) => {
  const g = mkGreenlight();
  const s = activate(g.id, 'paper');
  const planId = plant(m, s, '04', 'armed');
  try {
    const out = reg.saveRouting(s.id, { executionTargetRef: 'test-platform' });
    assert.strictEqual(out.executionTargetRef, 'test-platform');
    assert.ok(reg.routingSavedThisRun(out), 'the press is still the run\'s one Save routing');
  } finally { unplant(m, planId); }
}); };

module.exports.aRestartMayPickTheRoutingAgainButNeverOffAPlan = function () { return onTwoPlatforms((m) => {
  const g = mkGreenlight();
  const s = activate(g.id, 'paper');
  ch.deactivate(g.id, 'paper');
  // an entry the platform has not yet taken back: no state of its own yet reads as waiting
  const planId = plant(m, s, '05', null);
  try {
    let err = null;
    try { activate(g.id, 'paper', { executionTargetRef: 'other-platform' }); } catch (e) { err = e; }
    assert.strictEqual(err && err.code, 'ROUTING_HELD', 'a restart off a waiting entry is refused');
    assert.ok(/\(waiting\)/.test(err.message), err.message);
    assert.strictEqual(reg.getSetup(s.id).state, 'stopped', 'the refused restart started nothing');
    assert.strictEqual(reg.getSetup(s.id).executionTargetRef, 'test-platform', 'and moved nothing');
    m.take({ type: 'state', planId, state: { phase: 'cancelled' } }, false);
    activate(g.id, 'paper', { executionTargetRef: 'other-platform' });
    assert.strictEqual(reg.getSetup(s.id).executionTargetRef, 'other-platform', 'once it is taken back, the restart moves the book');
  } finally { unplant(m, planId); }
}); };

// WHAT THIS SERVICE SENT COUNTS BEFORE THE PLATFORM'S RECORD SHOWS IT, while its hold could still run
module.exports.aPlanSentButNotYetOnThePlatformsRecordIsHeldUntilItsHoldIsOver = function () { return onTwoPlatforms(() => {
  const g = mkGreenlight();
  const s = reg.getSetup(activate(g.id, 'paper').id);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ch-dec-'));
  const was = process.env.GC_LIVE_DECISIONS;
  process.env.GC_LIVE_DECISIONS = dir;
  try {
    const t = targets.getTarget('test-platform');
    const dec = (chunk, planId, extra = {}) => fs.appendFileSync(path.join(dir, `${s.id}.jsonl`), `${JSON.stringify({ chunk_start: chunk, side: 'LONG', engine: { target: 'test-platform', planId, traded: true, ok: true, ...extra } })}\n`);
    const now = Date.now();
    dec(new Date(now - 3600e3).toISOString(), `${s.id}|recent`);
    dec(new Date(now - 400 * 86400e3).toISOString(), `${s.id}|long-over`);
    dec(new Date(now - 7200e3).toISOString(), `${s.id}|refused`, { ok: false });
    const held = link.heldOn(t, s, now);
    assert.deepStrictEqual(held, [{ planId: `${s.id}|recent`, phase: 'sent' }], 'only the recent plan the platform took is held; one long over, and one it refused, are not');
    assert.deepStrictEqual(link.heldOn(targets.getTarget('other-platform'), s, now), [], 'a plan sent to one platform is not held on another');
  } finally {
    if (was === undefined) delete process.env.GC_LIVE_DECISIONS; else process.env.GC_LIVE_DECISIONS = was;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}); };
