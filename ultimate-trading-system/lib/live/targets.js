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
// on a machine of the owner's, and CALLS OUT (owner, 2026-09-25: "the engine
// connects out to our server and keeps that connection open ... Nothing ever
// connects in"). Its record is made when an engine installed with the install
// command first calls in (lib/live/enginesetup.js), and holds a fingerprint of
// the engine's token -- never the token -- the public half of its lock for
// trading keys, and what it said of its machine and release the last time it
// called. Nothing on it opens the engine's machine.
const ENGINE_ID_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;
const TOKEN_HASH_RE = /^[0-9a-f]{64}$/;
const LINKS = ['calls-out'];

function engineProblems(r) {
  const out = [];
  const x = r || {};
  if (typeof x.id !== 'string' || !ENGINE_ID_RE.test(x.id)) out.push('short name: 2 to 30 of a-z, 0-9 and -, starting with a letter or digit');
  if (x.id === 'mx-1') out.push('short name: mx-1 is already taken');
  if (typeof x.name !== 'string' || !x.name.trim() || x.name.length > 60) out.push('descriptive name: 1 to 60 characters');
  if (!LINKS.includes(x.link)) out.push('the link: a platform calls this system');
  if (typeof x.tokenHash !== 'string' || !TOKEN_HASH_RE.test(x.tokenHash)) out.push('the platform\'s token fingerprint is missing');
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

// CHANGING AN ENGINE RECORD on the Compute tab. What the owner may change: its
// descriptive name, whether new setups run on it, and its note. How an engine
// is reached is its own business and is not typed in. A NEW ENGINE is not made
// here: it is installed with the install command, and its record is made when
// it first calls.
function saveEngine(rec) {
  const all = storedTargets();
  const id = String((rec || {}).id || '').trim();
  const was = all[id];
  if (!was || was.kind !== 'engine') { const e = new Error(`no platform called ${id || '(none)'}: a new platform is added by installing it, with Set up a trading platform`); e.code = 'BAD_ENGINE'; throw e; }
  const r = { ...was, name: String((rec || {}).name || '').trim(), isDefault: !!(rec || {}).isDefault, note: typeof (rec || {}).note === 'string' ? rec.note.slice(0, 200) : (was.note || '') };
  const problems = engineProblems(r);
  if (problems.length) { const e = new Error(problems.join('; ')); e.code = 'BAD_ENGINE'; throw e; }
  if (r.isDefault) for (const t of Object.values(all)) if (t && t.kind === 'engine') t.isDefault = false;
  all[r.id] = r;
  writeTargets(all);
  return r;
}

// AN ENGINE THAT CALLS OUT, made or made again when it first calls with its
// one-time code. Made again: a machine installed afresh under the same short
// name gets a new token, and the old token stops working the moment this runs.
function saveCallingEngine({ id, name, tokenHash, lock = null, machine = null, release = null, setupRef = null }) {
  const all = storedTargets();
  const was = all[id];
  if (was && (was.kind !== 'engine' || was.link !== 'calls-out')) { const e = new Error(`the short name ${id} already belongs to another platform`); e.code = 'BAD_ENGINE'; throw e; }
  const r = {
    id, kind: 'engine', link: 'calls-out', name, isDefault: was ? !!was.isDefault : !listEngines().length, symbols: null, note: was ? was.note || '' : '',
    tokenHash, lock, machine, release, setupRef, enrolledUtc: new Date().toISOString(), lastSeenUtc: null,
  };
  const problems = engineProblems(r);
  if (problems.length) { const e = new Error(problems.join('; ')); e.code = 'BAD_ENGINE'; throw e; }
  all[id] = r;
  writeTargets(all);
  return r;
}

// what an engine that calls out said of itself when it last called
function noteEngine(id, patch) {
  const all = storedTargets();
  const was = all[id];
  if (!was || was.link !== 'calls-out') return null;
  const keep = {};
  for (const k of ['lock', 'machine', 'release', 'code', 'lastSeenUtc']) if (patch[k] !== undefined) keep[k] = patch[k];
  all[id] = { ...was, ...keep };
  writeTargets(all);
  return all[id];
}

// an engine record goes only when no setup names it
function deleteEngine(id, setups = []) {
  const all = storedTargets();
  if (!all[id] || all[id].kind !== 'engine') { const e = new Error(`no platform called ${id}`); e.code = 'NOT_FOUND'; throw e; }
  const users = setups.filter((s) => s.executionTargetRef === id && s.state !== 'retired');
  if (users.length) { const e = new Error(`${users.length} setup(s) run on ${id} (${users.map((s) => s.name || s.id).join(', ')}) -- move or retire them first`); e.code = 'IN_USE'; throw e; }
  delete all[id];
  writeTargets(all);
  return { deleted: id };
}

const isEngine = (t) => !!t && t.kind === 'engine';

module.exports = { listTargets, getTarget, resolveForSetup, targetServes, targetsFile, BUILTIN, listEngines, defaultEngine, saveEngine, saveCallingEngine, noteEngine, deleteEngine, engineProblems, isEngine, LINKS };
