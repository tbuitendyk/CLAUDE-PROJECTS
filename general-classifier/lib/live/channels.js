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
function activate(greenlightId, channel, { by = OWNER_ID, clipUsd, name } = {}) {
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
    let open = 0;
    try { open = (require('./view').setupStatus(s).openPositions || []).length; } catch (_) { open = 0; }
    if (open > 0) {
      const e = new Error(`${channel} channel is still deactivating (${open} open) — re-activate after close-out`);
      e.code = 'DEACTIVATING'; throw e;
    }
  }
  if (!s) {
    const made = gl.shuttle(greenlightId, {
      name: name || `${g.configSnapshot.combo.trade} ${g.target} ${channel}`,
      // clip is operational (point 20), not part of the frozen snapshot; the
      // $10 default matches the pilot's clip and is editable on Setup detail.
      clipUsd: Number.isFinite(clipUsd) && clipUsd > 0 ? clipUsd : 10,
      by, channel,
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
