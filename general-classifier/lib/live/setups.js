// TradingSetup registry (NEXT-RELEASE points 3, 4, 10-prep, 15, 18, 20;
// plan phase 1). One JSON file per setup under data/live/setups/.
//
// A setup is a LIVE TRADING JOB minted from a greenlighted lab config: the
// configSnapshot is IMMUTABLE from creation (point 4 — later lab edits can
// never mutate a live setup; a new idea is a new shuttle, not an edit).
// Operational fields (name, clipUsd, stopPct, executionTargetRef, keyRef) are
// mutable; identity/evidence fields are not.
//
// STATE is eligibility, not execution: state 'live' means the setup MAY trade;
// actually opening positions still requires the setup's ARM switch (the
// owner's button), exactly like the F1 pilot's LIVE=1 vs ARM split. Paper
// setups run the identical path with simulated fills (point 15, bypassable —
// draft can go straight to live).
//
// No deletion of anything that ever ran: retire is terminal and keeps the
// record (audit trail). Only never-run drafts may be deleted outright.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateConfig } = require('./configschema');
const { ENGINE_VERSION, SETUP_SCHEMA_VERSION } = require('./version');

// Resolved per call (not at module load) so tests can point the registry at a
// scratch directory via GC_SETUPS_DIR without touching the real data/ tree.
const DEFAULT_SETUPS_DIR = path.join(__dirname, '..', '..', 'data', 'live', 'setups');
function setupsDir() { return process.env.GC_SETUPS_DIR || DEFAULT_SETUPS_DIR; }

const STATES = ['draft', 'paper', 'live', 'stopped', 'retired'];
// live -> retired is deliberately NOT allowed: a live setup is stopped first,
// so retirement is always a two-step, never a misclick on a trading job.
const TRANSITIONS = {
  draft: ['paper', 'live', 'retired'],
  paper: ['live', 'stopped', 'retired'],
  live: ['stopped'],
  stopped: ['paper', 'live', 'retired'],
  retired: [],
};

// Same DERIVED floor as the stop-apply endpoint (server.js): a stop tighter
// than 0.5% triggers on hourly noise and guarantees a net loss vs round-trip
// fees. One constant meaning in both places.
const MIN_STOP_PCT = 0.005;

const ID_RE = /^[a-z0-9][a-z0-9-]{2,40}$/;

function ensureDir() { fs.mkdirSync(setupsDir(), { recursive: true }); }
function fileFor(id) { return path.join(setupsDir(), `${id}.json`); }

function atomicWrite(file, obj) {
  const tmp = `${file}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, file);
}

// Validate the OPERATIONAL fields (the mutable surface + identity basics).
// configSnapshot validity is configschema's job.
function validateOperational(s) {
  const errors = [];
  if (!ID_RE.test(String(s.id || ''))) errors.push('id: 3-41 chars, [a-z0-9-], starts alphanumeric');
  if (typeof s.ownerId !== 'string' || !s.ownerId.trim()) errors.push('ownerId: required (point 10 prep)');
  if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > 80) errors.push('name: 1-80 chars');
  if (!STATES.includes(s.state)) errors.push(`state: must be one of ${STATES}`);
  if (!Number.isFinite(s.clipUsd) || s.clipUsd <= 0) errors.push('clipUsd: must be a positive dollar notional');
  if (s.stopPct != null) {
    if (!Number.isFinite(s.stopPct) || s.stopPct >= 1) errors.push('stopPct: fraction of entry < 1, or null for no stop');
    else if (s.stopPct < MIN_STOP_PCT) errors.push(`stopPct: below the ${MIN_STOP_PCT} floor (0.5%) — triggers on noise`);
  }
  for (const k of ['executionTargetRef', 'keyRef', 'provenanceRef']) {
    if (s[k] != null && typeof s[k] !== 'string') errors.push(`${k}: must be a string or null`);
  }
  return errors;
}

// Create a setup. `spec` carries: id (optional — generated when absent), name,
// ownerId, configSnapshot, provenanceRef, clipUsd, stopPct?, tradedPair is
// DERIVED from the snapshot (never passed separately — one source of truth).
function createSetup(spec) {
  ensureDir();
  const cfg = spec.configSnapshot;
  const cv = validateConfig(cfg);
  if (!cv.ok) {
    const err = new Error(`configSnapshot invalid: ${cv.errors.join('; ')}`);
    err.code = 'BAD_CONFIG';
    throw err;
  }
  const id = spec.id || `setup-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  const setup = {
    schema: SETUP_SCHEMA_VERSION,
    id,
    ownerId: spec.ownerId,
    name: spec.name,
    state: 'draft',
    // identity/evidence — IMMUTABLE after creation
    configSnapshot: cfg,
    tradedPair: cfg.combo.trade,
    engineVersion: ENGINE_VERSION,
    provenanceRef: spec.provenanceRef ?? null,
    createdUtc: now,
    // operational — mutable
    clipUsd: spec.clipUsd,
    stopPct: spec.stopPct ?? null,
    executionTargetRef: spec.executionTargetRef ?? null,
    keyRef: spec.keyRef ?? null,
    stateHistory: [{ from: null, to: 'draft', utc: now, by: spec.by || 'owner' }],
  };
  const errors = validateOperational(setup);
  if (errors.length) {
    const err = new Error(`setup invalid: ${errors.join('; ')}`);
    err.code = 'BAD_SETUP';
    throw err;
  }
  if (fs.existsSync(fileFor(id))) {
    const err = new Error(`setup ${id} already exists`);
    err.code = 'EXISTS';
    throw err;
  }
  atomicWrite(fileFor(id), setup);
  return setup;
}

function getSetup(id) {
  if (!ID_RE.test(String(id || ''))) return null; // also blocks path traversal
  try { return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')); } catch (_) { return null; }
}

function listSetups() {
  ensureDir();
  return fs.readdirSync(setupsDir())
    .filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(setupsDir(), f), 'utf8')); } catch (_) { return null; } })
    .filter(Boolean)
    .sort((a, b) => String(a.createdUtc).localeCompare(String(b.createdUtc)));
}

// Update MUTABLE fields only. Any attempt to change an identity/evidence field
// is an error, not a merge — silence here would be how a live setup's meaning
// drifts (the point-4 immutability promise).
const MUTABLE = new Set(['name', 'clipUsd', 'stopPct', 'executionTargetRef', 'keyRef']);
function updateSetup(id, patch, by = 'owner') {
  const s = getSetup(id);
  if (!s) { const e = new Error(`no such setup ${id}`); e.code = 'NOT_FOUND'; throw e; }
  const offered = Object.keys(patch || {});
  const illegal = offered.filter((k) => !MUTABLE.has(k));
  if (illegal.length) {
    const e = new Error(`immutable/unknown field(s): ${illegal.join(', ')}`);
    e.code = 'IMMUTABLE';
    throw e;
  }
  const next = { ...s };
  for (const k of offered) next[k] = patch[k];
  const errors = validateOperational(next);
  if (errors.length) { const e = new Error(errors.join('; ')); e.code = 'BAD_SETUP'; throw e; }
  atomicWrite(fileFor(id), next);
  return next;
}

// State machine. Every transition is journaled in stateHistory with who/when.
function transition(id, to, by = 'owner', note) {
  const s = getSetup(id);
  if (!s) { const e = new Error(`no such setup ${id}`); e.code = 'NOT_FOUND'; throw e; }
  const allowed = TRANSITIONS[s.state] || [];
  if (!allowed.includes(to)) {
    const e = new Error(`illegal transition ${s.state} -> ${to} (allowed: ${allowed.join(', ') || 'none'})`);
    e.code = 'BAD_TRANSITION';
    throw e;
  }
  const next = { ...s, state: to };
  next.stateHistory = [...(s.stateHistory || []),
    { from: s.state, to, utc: new Date().toISOString(), by, ...(note ? { note } : {}) }];
  atomicWrite(fileFor(id), next);
  return next;
}

// Only a never-run draft may be deleted; everything else retires (audit trail).
function deleteDraft(id) {
  const s = getSetup(id);
  if (!s) { const e = new Error(`no such setup ${id}`); e.code = 'NOT_FOUND'; throw e; }
  if (s.state !== 'draft') { const e = new Error('only drafts may be deleted; use retire'); e.code = 'NOT_DRAFT'; throw e; }
  fs.unlinkSync(fileFor(id));
  return true;
}

module.exports = {
  createSetup, getSetup, listSetups, updateSetup, transition, deleteDraft,
  STATES, TRANSITIONS, MIN_STOP_PCT, setupsDir,
};
