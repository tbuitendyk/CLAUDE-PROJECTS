// TradingSetup registry (NEXT-RELEASE points 3, 4, 10-prep, 15, 18, 20;
// plan phase 1). One JSON file per setup under data/live/setups/.
//
// A setup is a LIVE TRADING JOB minted from a greenlighted lab config: the
// configSnapshot is IMMUTABLE from creation (point 4 — later lab edits can
// never mutate a live setup; a new idea is a new shuttle, not an edit).
// Operational fields (name, clipUsd, stopPct, feePerLeg, executionTargetRef,
// keyRef) are mutable; identity/evidence fields are not.
//
// STATE is eligibility, not execution: state 'live' means the setup MAY trade;
// actually opening positions still requires the setup's ARM switch (the
// owner's button), exactly like the box's LIVE=1 vs ARM split. Paper
// setups run the identical path with simulated fills (point 15, bypassable —
// draft can go straight to live).
//
// No deletion of anything that ever ran: retire is terminal and keeps the
// record (audit trail). Only never-run drafts may be deleted outright.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateConfig, liveExecutable } = require('./configschema');
const { FEE_PER_LEG, MAX_FEE_PER_LEG, feeRate } = require('../paper');
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

// THE TRADING FEE BELONGS TO THIS PROFILE (owner order, 2026-08-23): "we're
// going to need to have a trading fee percentage that can be set per trading
// profile. And, of course, the trading profiles might be on Binance, might be
// on other servers."
//
// It is operational, not evidence: it says what THIS deployment pays to trade,
// which is a property of where it runs, not of the rule it runs. Two profiles
// on the same rule at two venues cost different amounts and must be allowed to
// say so. A fraction of the position, per leg, exactly as everywhere else in
// the engine (lib/paper.js, 2026-08-23).
//
// A profile created before this existed has no fee on its record. It is read as
// the lab rate — the number every one of them was actually priced at — and the
// screen says it is inherited rather than presenting it as a choice somebody
// made.
function setupFee(s) {
  const v = s && s.feePerLeg;
  return Number.isFinite(v) ? v : FEE_PER_LEG;
}
const feeIsInherited = (s) => !Number.isFinite(s && s.feePerLeg);

function ensureDir() { fs.mkdirSync(setupsDir(), { recursive: true }); }
// EVERY path is built here, and the id is checked HERE rather than at each
// caller. A setup record carries its own id, and that id was reaching this
// function after only the id in the web address had been checked — so a record
// containing `../../something` could name a file outside the folder, and the
// write and the delete both answered "ok". Guarding the one place that builds
// the path means no caller can forget (found 2026-08-21).
function fileFor(id) {
  if (!ID_RE.test(String(id == null ? '' : id))) {
    const err = new Error(`refusing to build a file path from the id ${JSON.stringify(id)}`);
    err.code = 'BAD_ID';
    throw err;
  }
  return path.join(setupsDir(), `${id}.json`);
}

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
  if (s.feePerLeg != null) {
    // Refused rather than clamped, and refused in the operator's own units: the
    // box on screen is a PERCENT, so the message has to be about percents or it
    // names a number nobody typed.
    if (!Number.isFinite(s.feePerLeg) || s.feePerLeg < 0) {
      errors.push('feePerLeg: the trading fee is a percent of what is traded, charged each way');
    } else if (s.feePerLeg >= MAX_FEE_PER_LEG) {
      errors.push(`feePerLeg: ${(100 * s.feePerLeg).toFixed(3)}% each way is above the ${100 * MAX_FEE_PER_LEG}% ceiling `
        + '— no venue charges that, and a number that large is nearly always a fee typed as dollars');
    }
  }
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
    // WHEN this deployment's members train (owner, 2026-08-19). Not part of
    // the rule — the same rule can be deployed frozen for evidence or rolling
    // for trading. See lib/live/trainpolicy.js.
    trainPolicy: spec.trainPolicy || null,
    stopPct: spec.stopPct ?? null,
    // WHAT IT COSTS THIS PROFILE TO TRADE, per leg, as a fraction of the
    // position. Defaulted from whatever minted it — a profile shuttled from a
    // greenlight starts at the fee its board was actually found under, so the
    // live arithmetic and the evidence agree until the owner says otherwise.
    feePerLeg: Number.isFinite(spec.feePerLeg) ? spec.feePerLeg : null,
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

// WHAT IS WRONG WITH THIS RECORD, read back from disk. Everything written by
// createSetup passes; everything else names its problems.
//
// Why this exists (found 2026-08-21): there was NO checking on the way back in.
// A file could carry a state nobody recognises, an id that disagrees with its
// own filename, a dollar size that is text, a configuration that no longer
// validates — and it read back as an ordinary setup, went onto the screen, and
// went into the list the box trades from. Sixteen of eighteen deliberately
// broken files came back looking valid.
function setupProblems(rec, filename) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
    return ['this file does not hold a setup record at all'];
  }
  const problems = validateOperational(rec).slice();
  // THE SHAPE-VERSION IS READ BACK (2026-08-21). Every record is written with
  // the record-shape it was made under, and the whole point of that stamp is
  // that a later version of the code can notice a record it does not fully
  // understand. Nothing anywhere read it, so a record from another version was
  // consumed as if it were current — silently. Nothing is wrong today, with one
  // version in existence; the moment the shape changes, old records start being
  // read as though they meant what new ones mean.
  if (rec.schema !== SETUP_SCHEMA_VERSION) {
    problems.push(rec.schema == null
      ? `this record carries no record-shape version; this system writes shape ${SETUP_SCHEMA_VERSION}, so it was made by something else`
      : `this record was written in shape ${JSON.stringify(rec.schema)} and this system reads shape ${SETUP_SCHEMA_VERSION} — what its fields mean may have changed`);
  }
  if (filename !== undefined && `${rec.id}.json` !== filename) {
    problems.push(`the record calls itself "${rec.id}" but it is stored as ${filename} — every control addresses it by the filename, so nothing can act on it`);
  }
  const cv = validateConfig(rec.configSnapshot);
  if (!cv.ok) problems.push(`its configuration no longer passes the system's own check: ${cv.errors.join('; ')}`);
  return problems;
}

// Read every stored setup, each carrying whatever is wrong with it.
//
// NOTHING IS DROPPED. The first attempt at this filtered the broken ones out of
// the list, and that is the same fault in the other direction: a setup whose
// configuration stops validating would silently disappear from every screen,
// which is exactly the vanishing this was written to stop. A rename could no
// longer reach it either — caught by an existing test, which is the only reason
// I noticed.
//
// So a record that cannot be trusted is KEPT and NAMED. `__problems` rides with
// it, empty when there is nothing wrong. The screens can show it and say why;
// the trading path takes `tradableSetups()` and never sees it.
function readSetups() {
  ensureDir();
  const files = fs.readdirSync(setupsDir()).filter((f) => f.endsWith('.json'));
  const setups = [];
  const unreadable = [];
  const byId = new Map();

  for (const f of files) {
    let rec = null;
    try { rec = JSON.parse(fs.readFileSync(path.join(setupsDir(), f), 'utf8')); } catch (err) {
      // Nothing can be recovered from this one — there is no record to carry a
      // problem on — so it is reported separately rather than lost.
      unreadable.push({ file: f, problems: [`this file cannot be read back at all (${err.message})`] });
      continue;
    }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
      unreadable.push({ file: f, problems: ['this file does not hold a setup record at all'] });
      continue;
    }
    const withFile = { ...rec, __file: f, __problems: setupProblems(rec, f) };
    const seen = byId.get(rec.id);
    if (seen) seen.push(withFile); else byId.set(rec.id, [withFile]);
    setups.push(withFile);
  }

  // TWO FILES CLAIMING ONE ID. The screen reads whichever the lookup finds and
  // the trading list reads whichever came last, so stopping that setup stops
  // only one of them. There is no way to tell which is meant, and picking one
  // is how the two came to disagree — so all of them say so and none may trade.
  for (const [id, group] of byId) {
    if (group.length < 2) continue;
    const names = group.map((g) => g.__file).join(', ');
    for (const g of group) {
      g.__problems.push(`${group.length} files all claim to be the setup "${id}" (${names}). There is no way to tell which one is meant, so none of them may trade.`);
    }
  }

  setups.sort((a, b) => String(a.createdUtc).localeCompare(String(b.createdUtc)));
  return { setups, unreadable, unusable: setups.filter((x) => x.__problems.length).concat(unreadable) };
}

// Everything on disk that could be parsed, broken ones included and marked.
function listSetups() { return readSetups().setups; }

// The ones nothing is wrong with. THIS is what may reach real money — the box's
// trading list, the pairs in use, anything that acts rather than displays.
function tradableSetups() { return readSetups().setups.filter((x) => !x.__problems.length); }

// Update MUTABLE fields only. Any attempt to change an identity/evidence field
// is an error, not a merge — silence here would be how a live setup's meaning
// drifts (the point-4 immutability promise).
const MUTABLE = new Set(['name', 'clipUsd', 'stopPct', 'feePerLeg', 'executionTargetRef', 'keyRef', 'trainPolicy']);

// The live-executability gate, shared by the transition door AND updateSetup. It
// answers "may this setup honestly TRADE in state `to`?": the geometry must be one
// the executor implements, the target box must serve the traded symbol, and a LIVE
// setup must carry its own sub-account keyRef. Factored out (independent review
// 2026-08-12) because updateSetup can mutate executionTargetRef/keyRef — the very
// routing/isolation fields the transition door guards — so an already-trading setup
// must re-clear the same gate, or it is a second unguarded door into the exact
// states transition() refuses.
// Open positions for a profile, straight from the box journal — the same source
// the screens read, so the gate and the screen can never disagree about whether
// something is still holding money. Deliberately tolerant: an unreadable journal
// yields [] rather than throwing, because a profile with nothing open must stay
// retirable even if the box is briefly unreachable. Real positions only; a paper
// book holds no money and never blocks a retirement.
function openPositionsFor(setupId) {
  try {
    const { setupStatus, deriveSetup, readJournal, journalFile } = require('./view');
    const { events } = readJournal(journalFile());
    const st = deriveSetup(events, setupId);
    return (st.openPositions || []).filter((p) => !p.paper);
  } catch (_) { return []; }
}

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
      + 'borrow pool never mingle with another setup (set keyRef first)');
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
  // by executionTargetRef (scheduled exits run
  // whether armed or stopped). Re-pointing a stopped setup at a box that does not
  // serve its symbol would silently misroute the real exit of a live position — the
  // exact silent-rejection hazard the transition gate exists to stop, now with live
  // money at risk. Passing `s.state` as `to` means a stopped setup is checked for
  // target/geometry but not spuriously required to carry keyRef (that fires only on
  // to==='live'). draft (never traded) and retired (no open positions) are excluded.
  //
  // ONLY WHEN THE PATCH CAN CHANGE THE GATE'S ANSWER (owner, 2026-08-19). The
  // gate judges routing and isolation: executionTargetRef and keyRef, plus the
  // configSnapshot geometry, which is immutable and cannot be patched at all.
  // A patch that touches none of those cannot change its verdict — so re-running
  // it there does nothing except let an unrelated, pre-existing problem block an
  // unrelated edit.
  //
  // That is not hypothetical. Renaming a config propagates the new name to its
  // deployments, and the rename was REFUSED with "the live executor only does
  // MARKET entry ... a LIVE setup needs its own sub-account keyRef" — none of
  // which has anything to do with what the thing is called. A setup with any
  // execution complaint could never be renamed, which is the shape of defect the
  // owner has been describing all along: a control that exists and cannot be used.
  const GATE_FIELDS = new Set(['executionTargetRef', 'keyRef']);
  const touchesRouting = offered.some((k) => GATE_FIELDS.has(k));
  if (touchesRouting && (s.state === 'paper' || s.state === 'live' || s.state === 'stopped')) {
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
  // (keyRef). Any two setups sharing one isolated-margin sub-account mingle
  // their balance AND borrow pool, so multi-day short interest pools onto whichever
  // leg closes last and cross-contaminates the other setup's realized — physically
  // unavoidable on a shared account. A distinct keyRef keeps each setup's money
  // isolated. (PAPER places no orders, so it needs none.) The executor must ROUTE
  // this keyRef before a live setup is truly isolated — tracked as open gap G8;
  // this gate records and enforces the requirement at the door. Shared with
  // updateSetup via liveGateErrors so both doors into a trading state agree.
  if (to === 'paper' || to === 'live') {
    // THE ONE DOOR INTO A TRADING STATE, so this is where a record that cannot
    // be trusted is stopped. Before this, nothing checked a stored setup on the
    // way back in: a state nobody recognises, an id that disagrees with its own
    // filename, a dollar size stored as text, a configuration that no longer
    // validates — all read back as ordinary setups and went into the list the
    // box trades from (found 2026-08-21). Whatever else is wrong with a record,
    // it does not get to place orders.
    const wrong = setupProblems(s, `${s.id}.json`);
    if (wrong.length) {
      const e = new Error(`cannot go ${to}: this stored record is not sound — ${wrong.join('; ')}`);
      e.code = 'UNSOUND_RECORD';
      throw e;
    }
    const errs = liveGateErrors(s, to);
    if (errs.length) {
      const e = new Error(`cannot go ${to}: ${errs.join('; ')}`);
      e.code = 'NOT_LIVE_EXECUTABLE';
      throw e;
    }
  }
  // RETIRE IS THE END OF A PROFILE'S LIFE and it is terminal — nothing transitions
  // out of retired. Allowing it while the profile still holds an open position
  // would strand real money: the profile leaves the allowlist, its intents stop
  // being produced, and the position sits on the exchange owned by something the
  // system no longer considers to exist. Stop it, let its positions run out to
  // their scheduled exits, then retire it (owner, 2026-08-19).
  if (to === 'retired') {
    const open = openPositionsFor(id);
    if (open.length) {
      const e = new Error(`cannot retire ${id}: it still holds ${open.length} open `
        + `position(s) (${open.map((p) => p.chunk_start).join(', ')}). Stop it and let them `
        + 'reach their scheduled exits first — retiring now would leave real money '
        + 'on the exchange owned by a profile the system has forgotten.');
      e.code = 'HAS_OPEN_POSITIONS';
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
  createSetup, getSetup, listSetups, readSetups, tradableSetups, setupProblems,
  setupFee, feeIsInherited,
  updateSetup, transition, deleteDraft, setRunEpoch,
  STATES, TRANSITIONS, MIN_STOP_PCT, setupsDir,
};
