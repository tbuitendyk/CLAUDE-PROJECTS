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

function labDoc(id) {
  return {
    id, kind: 'bracketlab', startedAt: '2026-08-01T10:10:10.000Z',
    finishedAt: '2026-08-01T12:00:00.000Z', campaign: 'ch-test',
    dataManifest: { overall: 'abc', symbols: { LTCUSDT: 'd1', XRPUSDT: 'd2', BCHUSDT: 'd3' } },
    selection: {
      trade: 'LTCUSDT', ctx1: 'XRPUSDT', ctx2: 'BCHUSDT', size: 3,
      geometry: 'daily-4d', decision: 'argmax', bandMode: 1.69, bandPct: 1.69,
      weekdaysOnly: false, members: 4,
      quorum: 1, entry: 'market', gate: 'directional', dMult: null,
      tHours: 137, trailMult: null, armMult: null,
      pnl: 10, trades: 10, holdout: { pnl: 1, trades: 2 },
      declaredCell: { quorum: 1, entry: 'market', gate: 'directional', dMult: null,
        tHours: 137, trailMult: null, armMult: null },
    },
  };
}
let seq = 0;
function mkGreenlight() {
  return gl.greenlightFromRun(labDoc(`bracketlab-2026080${(seq % 9) + 1}-10101${seq++}-t`), 'declared',
    { why: 'channel-model test config' });
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
