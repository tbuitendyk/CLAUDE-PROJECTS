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
const { validateConfig, liveExecutable } = require('./configschema');
const { resolveForSetup, targetServes } = require('./targets');
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
    // which config channel this record serves ('paper' | 'real' | null for
    // pre-channel-era setups like f1-pilot). Identity, set once at shuttle.
    channel: spec.channel ?? null,
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

// The live-executability gate, shared by the transition door AND updateSetup. It
// answers "may this setup honestly TRADE in state `to`?": the geometry must be one
// the executor implements, the target box must serve the traded symbol, and a LIVE
// setup must carry its own sub-account keyRef. Factored out (independent review
// 2026-08-12) because updateSetup can mutate executionTargetRef/keyRef — the very
// routing/isolation fields the transition door guards — so an already-trading setup
// must re-clear the same gate, or it is a second unguarded door into the exact
// states transition() refuses.
function liveGateErrors(s, to) {
  const errs = [];
  const le = liveExecutable(s.configSnapshot);
  if (!le.ok) errs.push(...le.errors);
  let target = null;
  try { target = resolveForSetup(s); } catch (e) { errs.push(e.message); }
  if (target && !targetServes(target, s.tradedPair)) {
    errs.push(`symbol ${s.tradedPair}: target '${target.id}' serves ${JSON.stringify(target.symbols)} — not this pair`);
  }
  if (to === 'live' && !(typeof s.keyRef === 'string' && s.keyRef.trim())) {
    errs.push('a LIVE setup needs its own sub-account keyRef so its balance and '
      + 'borrow pool never mingle with F1 or another setup (set keyRef first)');
  }
  return errs;
}

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
  // A setup that is already trading — paper, live, OR stopped — must re-clear the
  // live gate after the patch. 'stopped' is included deliberately: stopping halts
  // NEW entries but existing real positions still EXIT, and those exits are routed
  // by executionTargetRef (see live-mirror.js / pilotview.js — scheduled exits run
  // whether armed or stopped). Re-pointing a stopped setup at a box that does not
  // serve its symbol would silently misroute the real exit of a live position — the
  // exact silent-rejection hazard the transition gate exists to stop, now with live
  // money at risk. Passing `s.state` as `to` means a stopped setup is checked for
  // target/geometry but not spuriously required to carry keyRef (that fires only on
  // to==='live'). draft (never traded) and retired (no open positions) are excluded.
  if (s.state === 'paper' || s.state === 'live' || s.state === 'stopped') {
    const gerr = liveGateErrors(next, s.state);
    if (gerr.length) {
      const e = new Error(`update would break ${s.state} execution: ${gerr.join('; ')}`);
      e.code = 'NOT_LIVE_EXECUTABLE';
      throw e;
    }
  }
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
  // R10: entering paper/live is the point a setup would actually TRADE, so gate
  // it on what the live rail can honestly execute. Refuse a geometry the executor
  // does not implement (breakout/active/trailing/arm) — it would be silently
  // mis-traded as market/hold-to-t — and a symbol the target box does not serve
  // (the box would reject every intent invisibly). Surfaced as a 400 in the UI.
  // R7: going LIVE (placing REAL orders) requires the setup's OWN sub-account
  // (keyRef). F1 and any other setup sharing one isolated-margin sub-account mingle
  // their balance AND borrow pool, so multi-day short interest pools onto whichever
  // leg closes last and cross-contaminates per-setup/F1 realized — physically
  // unavoidable on a shared account. A distinct keyRef keeps each setup's money
  // isolated. (PAPER places no orders, so it needs none.) The executor must ROUTE
  // this keyRef before a live setup is truly isolated — tracked as open gap G8;
  // this gate records and enforces the requirement at the door. Shared with
  // updateSetup via liveGateErrors so both doors into a trading state agree.
  if (to === 'paper' || to === 'live') {
    const errs = liveGateErrors(s, to);
    if (errs.length) {
      const e = new Error(`cannot go ${to}: ${errs.join('; ')}`);
      e.code = 'NOT_LIVE_EXECUTABLE';
      throw e;
    }
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

// Stamp the start of a DISPLAYED run (owner, 2026-08-14): re-activating a
// channel restarts what the screen shows from this instant. Internal helper —
// deliberately not part of updateSetup's MUTABLE surface, because it is not an
// operational knob; it is set exactly at activation. Journals are untouched.
function setRunEpoch(id, utc = new Date().toISOString()) {
  const s = getSetup(id);
  if (!s) { const e = new Error(`no such setup ${id}`); e.code = 'NOT_FOUND'; throw e; }
  const next = { ...s, runEpochUtc: utc };
  atomicWrite(fileFor(id), next);
  return next;
}

module.exports = {
  createSetup, getSetup, listSetups, updateSetup, transition, deleteDraft, setRunEpoch,
  STATES, TRANSITIONS, MIN_STOP_PCT, setupsDir,
};
