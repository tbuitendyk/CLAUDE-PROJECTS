// pilotrule.js -- where the LIVE PILOT's trading rule comes from (Stage C,
// owner directive 2026-08-18/19).
//
// THE DEFECT THIS CLOSES. F1 — the rule trading real money — is a literal in
// lib/forwardbook.js, and lib/pilotsignal.js reads it from there at module
// load. A trading engine built to DISCOVER rules cannot keep its rules in
// source: changing what the engine trades then requires editing code, which
// means it requires me. That is a dependency on the wrong party wired into a
// production system, and it is the owner's central complaint.
//
// The generalized rail already does this correctly — lib/live/signal.js reads
// its config from setup data. Only the money rail didn't. This module is the
// money rail catching up; it invents no new store.
//
// HOW THE PILOT'S RULE IS NAMED. data/pilot/rule.json says which deployment the
// pilot trades: { setupId }. The owner sets it, having greenlighted the row off
// the board that discovered it. Nothing here writes that file.
//
// LEGACY IS LOUD, NEVER SILENT. Until the pointer exists, the rule still comes
// from BOOKS.F1 so the armed engine with an open position keeps working exactly
// as it does today — but every reader gets `source: 'code'` and the screens say
// so. A quiet fallback is how the hardcoded rule survives forever, which is the
// thing being removed.
const fs = require('fs');
const path = require('path');

const POINTER = path.join(__dirname, '..', 'data', 'pilot', 'rule.json');

function readPointer() {
  try {
    const d = JSON.parse(fs.readFileSync(POINTER, 'utf8'));
    return d && typeof d.setupId === 'string' && d.setupId ? d : null;
  } catch (_) { return null; }
}

// Resolve the pilot's rule and the instant its members train through.
//
// Returns { cfg, freezeMs, source, setupId, legacy }:
//   source 'data'  the owner designated a deployment; cfg is its configSnapshot
//                  and the freeze is its trainPolicy (lib/live/trainpolicy.js)
//   source 'code'  no pointer yet — the hardcoded F1, flagged so it is visible
function resolveRule() {
  const ptr = readPointer();
  if (ptr) {
    const reg = require('./live/setups');
    const setup = reg.getSetup(ptr.setupId);
    if (!setup) {
      throw new Error(`pilot rule points at setup ${ptr.setupId}, which does not exist — `
        + 'fix data/pilot/rule.json or re-designate the deployment');
    }
    const { resolveFreeze } = require('./live/trainpolicy');
    const freeze = resolveFreeze(setup);
    return {
      cfg: setup.configSnapshot,
      freezeMs: freeze.throughMs,
      source: 'data',
      setupId: setup.id,
      legacy: false,
    };
  }
  const { BOOKS, TRAIN_THROUGH } = require('./forwardbook');
  const f1 = BOOKS.find((b) => b.id === 'F1');
  if (!f1) throw new Error('no F1 in the code book list and no pilot rule pointer — the pilot has no rule');
  return {
    cfg: {
      combo: f1.combo, branch: f1.branch, stage: f1.stage,
      members: f1.members, cell: f1.cell,
    },
    freezeMs: TRAIN_THROUGH,
    source: 'code',
    setupId: null,
    legacy: true,
  };
}

module.exports = { resolveRule, readPointer, POINTER };
