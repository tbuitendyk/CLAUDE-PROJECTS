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
    // R10: which symbols this box's executor actually serves. mx_executor.py
    // hardcodes SYMBOL=LTCUSDT, so a setup on any other pair would be silently
    // rejected by the box (INTENT_INVALID:symbol) — refuse it at the door
    // instead. A future box serving more pairs lists them here.
    symbols: ['LTCUSDT'],
  },
};

// R10: does this target's box serve the given symbol? A target with no declared
// symbols list is treated as serving anything (a custom box the owner vouches for).
function targetServes(target, symbol) {
  if (!target || !Array.isArray(target.symbols)) return true;
  return target.symbols.includes(symbol);
}

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

// ---- THE NEW TRADING ENGINE AS A TARGET (loop of 2026-09-25) ----------------
//
// The engine that carries out Paper Books and Live Trading for this system runs
// on the trading box beside the old order program. Where it is and how this
// machine reaches it is a record the owner creates and edits on Setup >
// Compute (RULE FIVE: nothing about the link stays written into code). The web
// box reaches the engine's loopback port through its own SSH tunnel, so the
// record says both ends: the box and its user, the engine's port there, and the
// port the tunnel opens here.
const ENGINE_ID_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;
const HOST_RE = /^[A-Za-z0-9.-]{1,253}$/;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const isPort = (n) => Number.isInteger(n) && n >= 1024 && n <= 65535;

function engineProblems(r) {
  const out = [];
  const x = r || {};
  if (typeof x.id !== 'string' || !ENGINE_ID_RE.test(x.id)) out.push('short name: 2 to 30 of a-z, 0-9 and -, starting with a letter or digit');
  if (x.id === 'mx-1') out.push('short name: mx-1 is already taken');
  if (typeof x.name !== 'string' || !x.name.trim() || x.name.length > 60) out.push('descriptive name: 1 to 60 characters');
  if (typeof x.host !== 'string' || !HOST_RE.test(x.host)) out.push('host: the trading box\'s address');
  if (typeof x.user !== 'string' || !USER_RE.test(x.user)) out.push('user: the account this machine signs in to the trading box as');
  if (!isPort(x.enginePort)) out.push('enginePort: the port the engine listens on, on the trading box itself (1024-65535)');
  if (!isPort(x.localPort)) out.push('localPort: the port the tunnel opens on this machine (1024-65535)');
  if (x.localPort === 8094 || x.localPort === 8095) out.push('localPort: 8094 and 8095 are this system\'s own services');
  return out;
}

function storedTargets() {
  try { const j = JSON.parse(fs.readFileSync(targetsFile(), 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch (_) { return {}; }
}
function writeTargets(obj) {
  fs.mkdirSync(path.dirname(targetsFile()), { recursive: true });
  const tmp = `${targetsFile()}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, targetsFile());
}

// every engine record, in the shape the screens read
function listEngines() {
  return Object.values(storedTargets()).filter((t) => t && t.kind === 'engine');
}
function defaultEngine() {
  const all = listEngines();
  return all.find((t) => t.isDefault) || (all.length === 1 ? all[0] : null);
}

// create or change an engine record; the one ticked default is the one new setups go to
function saveEngine(rec) {
  const r = {
    id: String((rec || {}).id || '').trim(), kind: 'engine', name: String((rec || {}).name || '').trim(),
    host: String((rec || {}).host || '').trim(), user: String((rec || {}).user || '').trim(),
    enginePort: Number((rec || {}).enginePort), localPort: Number((rec || {}).localPort),
    isDefault: !!(rec || {}).isDefault, symbols: null, note: typeof (rec || {}).note === 'string' ? rec.note.slice(0, 200) : '',
  };
  const problems = engineProblems(r);
  const all = storedTargets();
  for (const t of Object.values(all)) {
    if (t && t.kind === 'engine' && t.id !== r.id && Number(t.localPort) === r.localPort) problems.push(`localPort: ${r.localPort} is already the tunnel port of ${t.id}`);
  }
  if (problems.length) { const e = new Error(problems.join('; ')); e.code = 'BAD_ENGINE'; throw e; }
  if (r.isDefault) for (const t of Object.values(all)) if (t && t.kind === 'engine') t.isDefault = false;
  all[r.id] = r;
  writeTargets(all);
  return r;
}

// an engine record goes only when no setup names it
function deleteEngine(id, setups = []) {
  const all = storedTargets();
  if (!all[id] || all[id].kind !== 'engine') { const e = new Error(`no engine called ${id}`); e.code = 'NOT_FOUND'; throw e; }
  const users = setups.filter((s) => s.executionTargetRef === id && s.state !== 'retired');
  if (users.length) { const e = new Error(`${users.length} setup(s) run on ${id} (${users.map((s) => s.name || s.id).join(', ')}) -- move or retire them first`); e.code = 'IN_USE'; throw e; }
  delete all[id];
  writeTargets(all);
  return { deleted: id };
}

const isEngine = (t) => !!t && t.kind === 'engine';

module.exports = { listTargets, getTarget, resolveForSetup, targetServes, targetsFile, BUILTIN, listEngines, defaultEngine, saveEngine, deleteEngine, engineProblems, isEngine };
