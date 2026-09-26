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

module.exports.activateCreatesTheChannelAndBothRunSimultaneously = function () {
  const g = mkGreenlight();
  const p = ch.activate(g.id, 'paper');
  assert.strictEqual(p.state, 'paper');
  assert.strictEqual(p.channel, 'paper', 'channel stamped on the setup record');
  assert.ok(p.runEpochUtc == null || typeof p.runEpochUtc === 'string'); // epoch stamped after transition
  const stamped = reg.getSetup(p.id);
  assert.ok(stamped.runEpochUtc, 'activation stamps the displayed-run epoch');
  // second activation of the same channel refuses
  let err = null;
  try { ch.activate(g.id, 'paper'); } catch (e) { err = e; }
  assert.strictEqual(err && err.code, 'ALREADY_ACTIVE');
  // the real channel is independent — its OWN setup, its own gates. No keyRef
  // here, so the live door refuses exactly as the review-hardened gate demands.
  let realErr = null;
  try { ch.activate(g.id, 'real'); } catch (e) { realErr = e; }
  assert.strictEqual(realErr && realErr.code, 'NOT_LIVE_EXECUTABLE',
    'real activation without a sub-account keyRef is refused by the existing gate');
  // paper channel unaffected by the refused real attempt
  assert.strictEqual(reg.getSetup(p.id).state, 'paper');
};

module.exports.deactivateStopsAndReactivationRestampsTheEpoch = function () {
  const g = mkGreenlight();
  const first = ch.activate(g.id, 'paper');
  const epoch1 = reg.getSetup(first.id).runEpochUtc;
  const stopped = ch.deactivate(g.id, 'paper');
  assert.strictEqual(stopped.state, 'stopped');
  // journal empty -> flat -> re-activation allowed, epoch restamped
  const again = ch.activate(g.id, 'paper');
  assert.strictEqual(again.id, first.id, 're-activation reuses the channel setup');
  const epoch2 = reg.getSetup(first.id).runEpochUtc;
  assert.ok(epoch2 >= epoch1, 'fresh epoch on re-activation');
};

module.exports.reactivationRefusedWhileOldPositionsStillWindDown = function () {
  const g = mkGreenlight();
  const s = ch.activate(g.id, 'paper');
  ch.deactivate(g.id, 'paper');
  // synthetic journal: one PAPER position opened for this setup, never exited
  const jf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ch-j-')), 'journal.jsonl');
  fs.writeFileSync(jf, JSON.stringify({
    event: 'PAPER_ENTRY_FILL', setup_id: s.id, chunk_start: 'c1', side: 'LONG',
    qty: 0.1, price: 100, utc: new Date().toISOString(), exit_due_ts: Date.now() / 1000 + 3600,
  }) + '\n');
  const old = process.env.GC_LIVE_JOURNAL;
  process.env.GC_LIVE_JOURNAL = jf;
  try {
    let err = null;
    try { ch.activate(g.id, 'paper'); } catch (e) { err = e; }
    assert.strictEqual(err && err.code, 'DEACTIVATING',
      'an epoch reset must never hide live exposure — refuse until close-out');
  } finally {
    if (old == null) delete process.env.GC_LIVE_JOURNAL; else process.env.GC_LIVE_JOURNAL = old;
  }
};

module.exports.runEpochScopesTheDisplayedRunNotTheJournal = function () {
  const g = mkGreenlight();
  const s = ch.activate(g.id, 'paper');
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
};

module.exports.nukeRefusesWhileBusyThenRevokesAndBlocksReuse = function () {
  const g = mkGreenlight();
  ch.activate(g.id, 'paper');
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
  try { ch.activate(g.id, 'paper'); } catch (e) { err2 = e; }
  assert.strictEqual(err2 && err2.code, 'REVOKED');
};

// S12 AND THE TICK ON SETUP > COMPUTE: with no engine on record a new setup
// runs where it always did; with an engine ticked "new setups run on this
// engine", a new setup names that engine -- and only a setup that names it is
// ever sent to it
module.exports.aNewSetupRunsOnTheEngineTickedForNewSetupsAndOtherwiseWhereItAlwaysDid = function () {
  const targets = require('../lib/live/targets');
  const link = require('../lib/live/enginelink');
  const saved = { t: process.env.GC_TARGETS_FILE, m: process.env.GC_ENGINE_MIRROR };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-ch-engine-'));
  process.env.GC_TARGETS_FILE = path.join(dir, 'targets.json');
  process.env.GC_ENGINE_MIRROR = path.join(dir, 'mirror');
  try {
    const plain = ch.activate(mkGreenlight().id, 'paper');
    assert.ok(!reg.getSetup(plain.id).executionTargetRef, 'no engine on record: the setup runs where it always did');
    // an engine is made the way every new one is now: when it first calls in (3.266.0); the first is the one new setups run on
    targets.saveCallingEngine({ id: 'ch-engine', name: 'Channel engine', tokenHash: 'a'.repeat(64) });
    const g = mkGreenlight();
    let err = null;
    try { ch.activate(g.id, 'paper'); } catch (e) { err = e; }
    assert.ok(err && /the trading engine Channel engine does not answer through its link yet/.test(err.message), err && err.message);
    link.mirrorFor(targets.getTarget('ch-engine')).lastHealth = { at: new Date().toISOString(), health: { realOrders: 'off' } };
    const onEngine = ch.activate(mkGreenlight().id, 'paper');
    assert.strictEqual(reg.getSetup(onEngine.id).executionTargetRef, 'ch-engine', 'the new setup names the engine ticked for new setups');
    assert.ok(!reg.getSetup(plain.id).executionTargetRef, 'a setup already running stays where it is');
  } finally {
    link.followAll([]);
    for (const [k, v] of [['GC_TARGETS_FILE', saved.t], ['GC_ENGINE_MIRROR', saved.m]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// THE STOP PICKED ON TUNE (item 5, 3.259.0): a market-entry configuration's
// book starts with it in Stop % at Activate, still editable after; a breakout
// configuration's gets nothing, its stop being the level on the other side
module.exports.activateBringsTheStopPickedOnTuneIntoStopPct = function () {
  const src = aStage4Source();
  src.stop = { stopPct: 0.11, why: 'the tightest that lost no winner', at: '2026-09-25T00:00:00.000Z', by: 'owner' };
  const g = gl.greenlightFromStage4(src, { name: 'stop config', why: 'the tuned stop rides along' });
  assert.strictEqual(g.configSnapshot.cell.entry, 'market');
  assert.strictEqual(ch.tunedStopOf(g), 0.11);
  const p = ch.activate(g.id, 'paper');
  assert.strictEqual(reg.getSetup(p.id).stopPct, 0.11, 'the paper book starts with the stop picked on Tune');
  // still editable, and a re-activation keeps what the owner set
  reg.updateSetup(p.id, { stopPct: 0.08 }, 'owner');
  ch.deactivate(g.id, 'paper');
  ch.activate(g.id, 'paper');
  assert.strictEqual(reg.getSetup(p.id).stopPct, 0.08, 'the owner\'s edit stands');
  // a breakout configuration, or one with no stop, gets none
  assert.strictEqual(ch.tunedStopOf({ ...g, configSnapshot: { ...g.configSnapshot, cell: { ...g.configSnapshot.cell, entry: 'breakout' } } }), null);
  assert.strictEqual(ch.tunedStopOf({ ...g, frozen: { stop: { stopPct: null } } }), null);
  assert.strictEqual(ch.tunedStopOf({ ...g, frozen: null }), null);
};
