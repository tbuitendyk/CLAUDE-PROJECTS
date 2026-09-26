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
// on a machine of the owner's. Every engine record says how this system and the
// engine reach each other (RULE FIVE: nothing about the link stays written into
// code), in one of two ways:
//
//   link: 'calls-out'  THE ENGINE CALLS OUT (owner, 2026-09-25: "the engine
//                      connects out to our server and keeps that connection
//                      open ... Nothing ever connects in"). Made when an engine
//                      installed with the install command first calls in
//                      (lib/live/enginesetup.js). The record holds a fingerprint
//                      of the engine's token -- never the token -- the public
//                      half of its lock for trading keys, and what it said of
//                      its machine and release the last time it called.
//   link: 'tunnel'     this machine reaches the engine's loopback port through
//                      its own SSH tunnel: the box and its user, the engine's
//                      port there, and the port the tunnel opens here. The way
//                      the first engine was installed; no new one is made so.
const ENGINE_ID_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;
const HOST_RE = /^[A-Za-z0-9.-]{1,253}$/;
const USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const TOKEN_HASH_RE = /^[0-9a-f]{64}$/;
const isPort = (n) => Number.isInteger(n) && n >= 1024 && n <= 65535;
const LINKS = ['calls-out', 'tunnel'];

function engineProblems(r) {
  const out = [];
  const x = r || {};
  if (typeof x.id !== 'string' || !ENGINE_ID_RE.test(x.id)) out.push('short name: 2 to 30 of a-z, 0-9 and -, starting with a letter or digit');
  if (x.id === 'mx-1') out.push('short name: mx-1 is already taken');
  if (typeof x.name !== 'string' || !x.name.trim() || x.name.length > 60) out.push('descriptive name: 1 to 60 characters');
  if (!LINKS.includes(x.link)) out.push('the link: calls out, or tunnel');
  if (x.link === 'tunnel') {
    if (typeof x.host !== 'string' || !HOST_RE.test(x.host)) out.push('trading box address: the machine\'s name or address');
    if (typeof x.user !== 'string' || !USER_RE.test(x.user)) out.push('sign in as: the account this machine signs in to the trading box as');
    if (!isPort(x.enginePort)) out.push('engine port there: 1024 to 65535');
    if (!isPort(x.localPort)) out.push('tunnel port here: 1024 to 65535');
    if (x.localPort === 8094 || x.localPort === 8095) out.push('tunnel port here: 8094 and 8095 are this system\'s own services');
  }
  if (x.link === 'calls-out' && (typeof x.tokenHash !== 'string' || !TOKEN_HASH_RE.test(x.tokenHash))) out.push('the engine\'s token fingerprint is missing');
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
// descriptive name, whether new setups run on it, its note -- and, for one the
// tunnel reaches, the tunnel's two ends. How an engine that calls out is reached
// is its own business and is not typed in. A NEW ENGINE is not made here: it is
// installed with the install command, and its record is made when it first calls.
function saveEngine(rec) {
  const all = storedTargets();
  const id = String((rec || {}).id || '').trim();
  const was = all[id];
  if (!was || was.kind !== 'engine') { const e = new Error(`no engine called ${id || '(none)'}: a new engine is added by installing it, with Set up a trading engine`); e.code = 'BAD_ENGINE'; throw e; }
  const r = { ...was, name: String((rec || {}).name || '').trim(), isDefault: !!(rec || {}).isDefault, note: typeof (rec || {}).note === 'string' ? rec.note.slice(0, 200) : (was.note || '') };
  if (was.link === 'tunnel') Object.assign(r, { host: String((rec || {}).host || '').trim(), user: String((rec || {}).user || '').trim(), enginePort: Number((rec || {}).enginePort), localPort: Number((rec || {}).localPort) });
  const problems = engineProblems(r);
  if (r.link === 'tunnel') {
    for (const t of Object.values(all)) {
      if (t && t.kind === 'engine' && t.id !== r.id && t.link === 'tunnel' && Number(t.localPort) === r.localPort) problems.push(`tunnel port here: ${r.localPort} is already the tunnel port of ${t.id}`);
    }
  }
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
  if (was && (was.kind !== 'engine' || was.link !== 'calls-out')) { const e = new Error(`the short name ${id} already belongs to another engine`); e.code = 'BAD_ENGINE'; throw e; }
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

// AN ENGINE THE TUNNEL REACHES, MOVED TO CALLING OUT (owner, 2026-09-25: "it
// ... reverses the direction of today's link"). A one-time code kept as its
// fingerprint on the record; the engine brings the code on its first call out
// and the record becomes one that calls out -- the same short name, names, tick
// and setups, and the same record of what it did, because it is the same engine
// on the same machine with the same data. Only the tunnel's two ends go.
function setMoveCode(id, codeHash, expiresUtc) {
  const all = storedTargets();
  const was = all[id];
  if (!was || was.kind !== 'engine') { const e = new Error(`no engine called ${id}`); e.code = 'NOT_FOUND'; throw e; }
  if (was.link !== 'tunnel') { const e = new Error(`${was.name} already calls this system`); e.code = 'BAD_ENGINE'; throw e; }
  all[id] = { ...was, move: { codeHash, madeUtc: new Date().toISOString(), expiresUtc, usedUtc: null } };
  writeTargets(all);
  return all[id];
}
function moveToCallingOut(id, { tokenHash, lock = null, machine = null, release = null }) {
  const all = storedTargets();
  const was = all[id];
  if (!was || was.link !== 'tunnel') { const e = new Error(`${id} is not an engine the tunnel reaches`); e.code = 'BAD_ENGINE'; throw e; }
  const r = {
    id: was.id, kind: 'engine', link: 'calls-out', name: was.name, isDefault: !!was.isDefault, symbols: null, note: was.note || '',
    tokenHash, lock, machine, release, setupRef: null, enrolledUtc: new Date().toISOString(), lastSeenUtc: null, movedFromTunnelUtc: new Date().toISOString(),
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
  if (!all[id] || all[id].kind !== 'engine') { const e = new Error(`no engine called ${id}`); e.code = 'NOT_FOUND'; throw e; }
  const users = setups.filter((s) => s.executionTargetRef === id && s.state !== 'retired');
  if (users.length) { const e = new Error(`${users.length} setup(s) run on ${id} (${users.map((s) => s.name || s.id).join(', ')}) -- move or retire them first`); e.code = 'IN_USE'; throw e; }
  delete all[id];
  writeTargets(all);
  return { deleted: id };
}

// ---- REPAIR: EVERY ENGINE RECORD SAYS HOW IT IS REACHED (3.266.0, RULE NINE) --
// Written to be deleted (RULE TEN) the day every record on the box has been
// through it: an engine record made before the link had two ways has no `link`
// and is, by construction, one the tunnel reaches. Run once at start, announced.
function repairLinkKinds() {
  const all = storedTargets();
  const named = [];
  for (const t of Object.values(all)) if (t && t.kind === 'engine' && !t.link) { t.link = 'tunnel'; named.push(t.id); }
  if (named.length) writeTargets(all);
  return { changed: named.length, named };
}

const isEngine = (t) => !!t && t.kind === 'engine';

module.exports = { listTargets, getTarget, resolveForSetup, targetServes, targetsFile, BUILTIN, listEngines, defaultEngine, saveEngine, saveCallingEngine, setMoveCode, moveToCallingOut, noteEngine, deleteEngine, engineProblems, isEngine, repairLinkKinds, LINKS };
