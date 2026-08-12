// Execution targets (IMPLEMENTATION-PLAN 8.1; NEXT-RELEASE 3, 9-compat).
//
// A target names WHERE a setup's executor runs and HOW the control plane
// reaches it. This release ships ONE transport ('ssh-box': the existing
// scp/ssh carry to a box we operate); the record shape is the seam that
// matters — the point-9 subscriber-local worker becomes transport
// 'worker-dialout' later, with the same messages (intent, journal, arm,
// allowlist) riding a different pipe. Messages are already transport-neutral
// JSON files, so a new transport is a carrier, not an engine change.
//
// Storage: data/live/targets.json — a small registry the owner edits through
// the UI later; the default entry is today's Mexico box so existing behavior
// is the zero-config case.
const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', '..', 'data', 'live', 'targets.json');
function targetsFile() { return process.env.GC_TARGETS_FILE || DEFAULT_FILE; }

// Today's box, as the built-in default target: absent file = exactly the
// current single-box world.
const BUILTIN = {
  'mx-1': {
    id: 'mx-1',
    kind: 'ssh-box',
    host: 'ec2-78-13-103-81.mx-central-1.compute.amazonaws.com',
    user: 'admin',
    note: 'Mexico AWS box (the original pilot executor host)',
  },
};

function listTargets() {
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(targetsFile(), 'utf8')); } catch (_) { stored = {}; }
  // built-ins are always present; stored entries extend/override by id
  return { ...BUILTIN, ...((stored && typeof stored === 'object') ? stored : {}) };
}

function getTarget(id) {
  return listTargets()[id || 'mx-1'] || null;
}

// Resolve a setup's execution target: its executionTargetRef, or the default
// box. Loud on a dangling ref — a setup pointing at a deleted target must
// surface, not silently fall back to a box the owner moved it OFF of.
function resolveForSetup(setup) {
  const ref = setup.executionTargetRef || 'mx-1';
  const t = getTarget(ref);
  if (!t) {
    const e = new Error(`setup ${setup.id}: execution target '${ref}' is not registered`);
    e.code = 'NO_TARGET';
    throw e;
  }
  return t;
}

module.exports = { listTargets, getTarget, resolveForSetup, targetsFile, BUILTIN };
