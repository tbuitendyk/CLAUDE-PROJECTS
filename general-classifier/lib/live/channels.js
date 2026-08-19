// channels.js -- the dual-channel config model (owner, 2026-08-14; NEXT-RELEASE
// point 25). The user-facing entity is the GREENLIGHTED CONFIG; each config has
// two independent channels — 'paper' and 'real' — either of which can be
// activated, and both may run simultaneously. There is NO draft in the user's
// vocabulary: Activate creates-and-starts in one step.
//
// Implementation rides the EXISTING, review-hardened setup machinery: each
// active channel is an ordinary setup record (created through the greenlight
// shuttle — still the only door), stamped with its channel. Every gate the
// transition door enforces (live-executable geometry, target serves the pair,
// keyRef for real) applies unchanged, the allowlist/journal/executor protocol
// is untouched, and therefore F1 and the paper-only real-guard keep their
// guarantees. This module is orchestration + vocabulary, never a new engine.
//
// Deactivation maps to 'stopped': entries halt, scheduled exits keep running,
// and the config shows 'deactivating' until every position is closed, then the
// record freezes. Re-activation re-uses the channel's setup (stopped→paper|live)
// and stamps a fresh runEpochUtc — the DISPLAYED run history restarts from that
// epoch; the underlying journal is append-only and never destroyed.
const reg = require('./setups');
const gl = require('./greenlight');
const { OWNER_ID } = require('../ownerid');

const CHANNELS = ['paper', 'real'];
const ACTIVE_STATE = { paper: 'paper', real: 'live' };

// Newest non-retired setup carrying this config+channel; retired ones are
// history, not the channel.
function channelSetup(greenlightId, channel) {
  const all = reg.listSetups()
    .filter((s) => s.provenanceRef === greenlightId && s.channel === channel && s.state !== 'retired');
  return all.length ? all[all.length - 1] : null;
}

function channelSetups(greenlightId) {
  return { paper: channelSetup(greenlightId, 'paper'), real: channelSetup(greenlightId, 'real') };
}

// Pure: one status line from the channels' states + open-position counts,
// exactly in the owner's vocabulary:
//   idle | active paper | active real | active real, active paper |
//   real deactivating, paper deactivating | active real, paper deactivating | ...
// A channel is 'active' in state paper/live, 'deactivating' while stopped with
// positions still open, and silent once stopped-and-flat (its frozen record
// still shows on the channel's pages).
function statusLine(parts) {
  const bits = [];
  for (const p of parts || []) {
    if (!p) continue;
    if (p.state === 'paper' || p.state === 'live') bits.push(`active ${p.channel}`);
    else if (p.state === 'stopped' && (p.open || 0) > 0) bits.push(`${p.channel} deactivating`);
  }
  // real before paper, per the owner's examples
  bits.sort((a, b) => (a.includes('real') ? 0 : 1) - (b.includes('real') ? 0 : 1));
  return bits.length ? bits.join(', ') : 'idle';
}

// Activate a channel. Creates the channel's setup on first activation (via the
// shuttle — the only door), or restarts a stopped one. Every transition gate
// applies unchanged; a refused gate (e.g. real without keyRef) surfaces as the
// transition's own error.
function activate(greenlightId, channel, { by = OWNER_ID, clipUsd, name, trainPolicy } = {}) {
  // A deployment must say when its members train. Legacy setups fall back to
  // the freeze inside their old configSnapshot, out loud — see trainpolicy.js.
  if (trainPolicy) {
    const pe = require('./trainpolicy').validatePolicy(trainPolicy);
    if (pe.length) { const e = new Error(pe.join('; ')); e.code = 'BAD_TRAIN_POLICY'; throw e; }
  }
  if (!CHANNELS.includes(channel)) { const e = new Error(`unknown channel '${channel}'`); e.code = 'BAD_CHANNEL'; throw e; }
  const g = gl.getGreenlight(greenlightId);
  if (!g) { const e = new Error(`no such greenlight ${greenlightId}`); e.code = 'NOT_FOUND'; throw e; }
  if (g.revoked) { const e = new Error('this config was nuked back to not-greenlighted; re-greenlight it first'); e.code = 'REVOKED'; throw e; }
  let s = channelSetup(greenlightId, channel);
  const target = ACTIVE_STATE[channel];
  if (s && (s.state === 'paper' || s.state === 'live')) {
    const e = new Error(`${channel} channel is already active`); e.code = 'ALREADY_ACTIVE'; throw e;
  }
  // Re-activation is gated on the previous run being fully closed out. Without
  // this, the fresh runEpochUtc would hide the still-open positions from the
  // display while the engine keeps managing them — invisible exposure, the one
  // thing a trading screen must never allow.
  if (s && s.state === 'stopped') {
    // BOTH BOOKS COUNT, and the message must SAY so. A setup that has gone
    // paper -> live can hold real and paper positions at once, and re-activating
    // resets this setup's displayed run — which would hide either kind while the
    // engine keeps managing it. So the gate is right to count both. What was
    // wrong was the number: it reported a single total while the setup screen
    // shows one side, so the operator was refused with "2 open" while looking at
    // a page showing 1, and the two numbers could not be reconciled
    // (found 2026-08-18 by the runtime control pass).
    let open = 0;
    let paperOpen = 0;
    try {
      const rows = require('./view').setupStatus(s).openPositions || [];
      open = rows.filter((p) => !p.paper).length;
      paperOpen = rows.filter((p) => p.paper).length;
    } catch (_) { open = 0; paperOpen = 0; }
    if (open + paperOpen > 0) {
      const parts = [];
      if (open) parts.push(`${open} real`);
      if (paperOpen) parts.push(`${paperOpen} paper`);
      const e = new Error(`${channel} channel is still deactivating (${parts.join(' + ')} still open on this setup) `
        + '— re-activating would reset its displayed run and hide them while the engine keeps managing them. Re-activate after close-out');
      e.code = 'DEACTIVATING'; throw e;
    }
  }
  if (!s) {
    const made = gl.shuttle(greenlightId, {
      name: name || `${g.configSnapshot.combo.trade} ${g.target} ${channel}`,
      // clip is operational (point 20), not part of the frozen snapshot; the
      // $10 default matches the pilot's clip and is editable on Setup detail.
      clipUsd: Number.isFinite(clipUsd) && clipUsd > 0 ? clipUsd : 10,
      by, channel, trainPolicy,
    });
    s = made.setup;
  }
  const out = reg.transition(s.id, target, by, `activate ${channel}`);
  reg.setRunEpoch(s.id); // displayed run history restarts here; journal untouched
  return out;
}

function deactivate(greenlightId, channel, { by = OWNER_ID } = {}) {
  const s = channelSetup(greenlightId, channel);
  if (!s) { const e = new Error(`no ${channel} channel exists for this config`); e.code = 'NOT_FOUND'; throw e; }
  if (s.state !== 'paper' && s.state !== 'live') {
    const e = new Error(`${channel} channel is not active (state: ${s.state})`); e.code = 'NOT_ACTIVE'; throw e;
  }
  return reg.transition(s.id, 'stopped', by, `deactivate ${channel}`);
}

module.exports = { CHANNELS, channelSetup, channelSetups, statusLine, activate, deactivate };
