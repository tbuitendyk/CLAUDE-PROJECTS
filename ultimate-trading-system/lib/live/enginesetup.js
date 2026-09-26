'use strict';
// lib/live/enginesetup.js -- SETTING UP A TRADING ENGINE, STEP BY STEP (owner,
// 2026-09-25: "somehow the user has to be able to go from NOTHING provisioned
// with NO ACCESS by the system to provisioned with the current trading engine
// service installed and active").
//
// A checklist the owner works through on Setup > Compute, in The trading engine
// section, one kept per engine: each step has its guidance, the choices it
// asks for and the ticks that say it is done, and a step opens only when every
// one of the step before it is. The template below is the whole of what the
// screen shows -- written here, in one place, because the owner and this
// system are writing it together, step by step ("we will work the template
// together as we develop it"). The page draws whatever it says.
//
// THE ENGINE CALLS OUT (owner, 2026-09-25, template 2). Step 2 makes an install
// command carrying a one-time code; the owner runs it on the machine, and the
// engine it installs calls this system with the code and is given a token of
// its own (enroll, below). This system keeps a fingerprint of the token, never
// the token, and never holds anything that could sign in to the machine.
//
// The checklists themselves are kept on this machine, one file each, so they
// follow the owner to any device and each finished one stays as the record of
// how its engine was set up. No AI anywhere.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = () => process.env.GC_ENGINE_SETUPS_DIR || path.join(__dirname, '..', '..', 'data', 'live', 'engine-setups');
const ID_RE = /^es-[a-z0-9]{6,12}-[0-9a-f]{6}$/;
const NAME_MAX = 60;
// the engine record's own rule for a short name (lib/live/targets.js): the
// engine is saved under the short name chosen here when it first calls in
const SHORT_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;
// how long an install command's code works, once
const CODE_MS = 60 * 60000;
const RELEASE = () => require('../../package.json').version;

// ---- THE TEMPLATE -----------------------------------------------------------
// A guidance block shows when each of its `when` choices matches; one marked
// `ifUnset` also shows while that choice has not been made, so the owner sees
// both roads before picking one. A choice with a `when` is asked only then.
const TEMPLATE = {
  version: 2,
  steps: [
    {
      id: 'ready',
      title: 'Here\'s what you need to get your trading engine off the ground',
      guidance: [
        { paras: [
          'The trading engine is the program that carries out Paper Books and Live Trading: it watches the price, opens and closes positions, and writes everything down. It runs on a machine of yours — a rented server, or this computer — and calls this system. Nothing here can sign in to that machine.',
          'Whatever it runs on needs power and internet around the clock, because a plan waiting or a position open needs it watching prices; and it must be in a country where your exchange serves you and you are allowed to use it.',
          'A fixed public IP address is needed only if you tie your exchange keys to one address. That is your choice, where your exchange allows it: a tied key is safer, because if it ever leaks it is no use from anywhere else. You make the choice on the Account tab when you enter the keys.',
        ] },
        { when: { where: 'server' }, ifUnset: true, heading: 'A rented server', paras: [
          'Any cloud provider will do. Pick a country where your exchange serves you and you are allowed to use it. An exchange\'s servers sit in one place (Binance\'s, for example, are in Tokyo), so nearer is quicker, but for trades decided once a day a fraction of a second hardly matters.',
          'The smallest size is plenty: 1 CPU, 1 GB of memory and 10 GB of disk, running Debian 12 or 13, or Ubuntu 24.04. The engine is held to 300 MB of memory and half a CPU.',
          'If you will tie your exchange keys to its address, ask the provider for a fixed public IP address for it (on AWS, for example, it is called an Elastic IP).',
        ] },
        { when: { where: 'local' }, ifUnset: true, heading: 'This computer', paras: [
          'Any computer made in the last several years is plenty: the engine is held to 300 MB of memory and half a CPU. Linux, Mac and Windows will all do.',
          'It must stay on and awake whenever a plan is waiting or a position is open: set it never to sleep while it is plugged in.',
          'If you will tie your exchange keys to its address, that address must be fixed. Home addresses usually change from time to time; ask your internet provider for a static one.',
        ] },
        { when: { where: 'local', os: 'linux' }, paras: ['Linux: any current release will do.'] },
        { when: { where: 'local', os: 'mac' }, paras: ['Mac: in its power settings, stop it sleeping while it is plugged in, including when the display is off.'] },
        { when: { where: 'local', os: 'windows' }, paras: ['Windows: in its power settings, set sleep to never while it is plugged in.'] },
      ],
      choices: [
        { id: 'where', label: 'Where it runs', clears: true, clearsNote: 'changing this clears the ticks below, and any install command not used yet: they were about the other machine', options: [{ value: 'server', label: 'a rented server' }, { value: 'local', label: 'this computer' }] },
        { id: 'os', label: 'Its operating system', when: { where: 'local' }, options: [{ value: 'linux', label: 'Linux' }, { value: 'mac', label: 'Mac' }, { value: 'windows', label: 'Windows' }] },
      ],
      ticks: [
        { id: 'binance', label: 'My exchange serves me there, and I may use it there' },
        { id: 'on', label: 'It will be on and online around the clock' },
        { id: 'size', label: 'It meets the size above' },
      ],
    },
    {
      id: 'install',
      title: 'Install the engine',
      guidance: [
        { paras: [
          'Press Make the install command, then paste the command into a terminal on the machine. It installs the engine as a service of its own, and the engine calls this system with the code in the command and is given a password of its own. The code works once, for an hour.',
          'Nothing that can sign in to the machine is kept here: the engine calls out, and this system keeps only a fingerprint of the engine\'s password.',
          'When the engine has called in, the command prints the fingerprint of the engine\'s lock. The Account tab shows the same fingerprint where you enter the keys for this engine: the keys are locked in your browser so that only this engine can open them.',
        ] },
        { when: { where: 'server' }, heading: 'A rented server', paras: [
          'Sign in to it as an account that may install software (on AWS, for example, EC2 Instance Connect opens a terminal on it in your browser) and paste the command. It needs curl, and installs Node.js from the system\'s own packages if it is missing.',
        ] },
        { when: { where: 'local', os: 'linux' }, heading: 'Linux', paras: ['Open a terminal and paste the command; it asks for your password. It installs Node.js from the system\'s own packages if it is missing.'] },
        { when: { where: 'local', os: 'mac' }, heading: 'Mac', paras: ['Install Node.js 18 or newer first (from nodejs.org). Then open Terminal and paste the command; it asks for your password.'] },
        { when: { where: 'local', os: 'windows' }, heading: 'Windows', paras: ['Install Node.js 18 or newer first (from nodejs.org). Then open PowerShell as administrator and paste the command.'] },
      ],
      // the install command, drawn by the page for this step
      panel: 'install',
      checks: [{ id: 'called', label: 'The engine called in' }],
    },
    {
      id: 'current',
      title: 'Keep it current',
      guidance: [
        { paras: [
          'When this system moves to a new release, the engine should follow it. Make a new install command in step 2 and run it on the machine again: it replaces the engine\'s program and keeps its record, its lock and its keys, so nothing has to be entered again.',
          'Run it when the engine holds no plan waiting or open: the engine stops for the few seconds the new program takes to start.',
        ] },
      ],
      panel: 'current',
      checks: [{ id: 'current', label: 'It runs the release this system runs' }],
    },
  ],
};

// ---- WHERE A CHECKLIST STANDS ---------------------------------------------------
const matches = (when, choices) => Object.entries(when || {}).every(([k, v]) => (choices || {})[k] === v);
// the choices a step asks for, given what has been chosen so far
function choicesAsked(step, choices) { return (step.choices || []).filter((c) => !c.when || matches(c.when, choices)); }

// the engine a checklist set up, from its record: it exists once it has called in
function engineOf(setup) {
  if (!setup.engineId) return null;
  const t = require('./targets').listEngines().find((x) => x.id === setup.engineId && x.link === 'calls-out');
  return t ? { id: t.id, name: t.name, release: t.release || null, lastSeenUtc: t.lastSeenUtc || null, enrolledUtc: t.enrolledUtc || null, lock: t.lock || null, machine: t.machine || null } : null;
}

// each step: done, open, and what is still missing, in words
function stepsOf(setup) {
  const out = [];
  let before = true;
  const eng = engineOf(setup);
  for (const step of TEMPLATE.steps) {
    const choices = setup.choices || {};
    const ticks = (setup.ticks || {})[step.id] || {};
    const missing = [];
    if (step.writing) missing.push('this step is still being written');
    for (const c of choicesAsked(step, choices)) if (!choices[c.id]) missing.push(`choose ${c.label.toLowerCase()}`);
    for (const t of step.ticks || []) if (ticks[t.id] !== true) missing.push(`tick "${t.label}"`);
    if (step.panel === 'install' && !eng) missing.push(setup.install && !setup.install.usedUtc ? 'run the install command on the machine' : 'press Make the install command');
    if (step.panel === 'current' && eng && eng.release !== RELEASE()) missing.push(`bring the engine from ${eng.release || 'an unknown release'} to ${RELEASE()}`);
    if (step.panel === 'current' && !eng) missing.push('install the engine');
    const open = before;
    const done = open && missing.length === 0;
    out.push({ id: step.id, open, done, missing });
    before = done;
  }
  return out;
}

// ---- THE CHECKLISTS ON DISK ----------------------------------------------------
function fileOf(id) {
  if (!ID_RE.test(String(id || ''))) { const e = new Error(`no engine setup ${id}`); e.status = 404; throw e; }
  return path.join(DIR(), `${id}.json`);
}
function write(rec) {
  fs.mkdirSync(DIR(), { recursive: true });
  const f = fileOf(rec.id);
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`);
  fs.renameSync(tmp, f);
}
function read(id) {
  const f = fileOf(id);
  if (!fs.existsSync(f)) { const e = new Error(`no engine setup ${id}`); e.status = 404; throw e; }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}
function list() {
  let names = [];
  try { names = fs.readdirSync(DIR()).filter((f) => /\.json$/.test(f)); } catch (_) { return []; }
  const out = [];
  for (const f of names) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(DIR(), f), 'utf8'))); } catch (_) { /* a torn file is left out rather than guessed at */ }
  }
  return out.sort((a, b) => String(a.createdUtc).localeCompare(String(b.createdUtc)));
}
// what a page may see: never the code's fingerprint, only whether a code is waiting and until when
function withSteps(rec) {
  const { install, ...rest } = rec;
  const waiting = install && !install.usedUtc && Date.parse(install.expiresUtc) > Date.now();
  return { ...rest, install: install ? { madeUtc: install.madeUtc, expiresUtc: install.expiresUtc, usedUtc: install.usedUtc || null, waiting: !!waiting } : null, engine: engineOf(rec), releaseHere: RELEASE(), steps: stepsOf(rec) };
}
const bad = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };

// THE ENGINE'S TWO NAMES (owner, 2026-09-25): a short name -- letters, digits,
// dashes -- and a descriptive name, what the screens show, exactly as the
// engine record keeps them; the engine is saved under both when it calls in.
// A short name another checklist or an engine record already has is refused.
function checkShort(shortName, selfId = null) {
  const v = String(shortName == null ? '' : shortName).trim();
  if (!SHORT_RE.test(v)) bad('short name: 2 to 30 of a-z, 0-9 and -, starting with a letter or digit');
  if (v === 'mx-1') bad('short name: mx-1 is already taken');
  const other = list().find((x) => x.shortName === v && x.id !== selfId);
  if (other) bad(`short name: ${v} is already the short name of the setup for "${other.name}"`);
  const eng = require('./targets').listEngines().find((t) => t.id === v);
  if (eng) bad(`short name: ${v} is already the short name of the engine record "${eng.name}"`);
  return v;
}

// ONE PER ENGINE: a checklist is started under the two names of the engine it sets up
function create(name, shortName) {
  const n = String(name == null ? '' : name).trim();
  if (!n || n.length > NAME_MAX) bad(`descriptive name: 1 to ${NAME_MAX} characters`);
  const taken = list().find((x) => String(x.name).toLowerCase() === n.toLowerCase());
  if (taken) bad(`there is already a setup for an engine called "${taken.name}" — one per engine`);
  const sn = checkShort(shortName);
  const now = new Date().toISOString();
  const rec = { id: `es-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`, name: n, shortName: sn, templateVersion: TEMPLATE.version, createdUtc: now, updatedUtc: now, engineId: null, choices: {}, ticks: {}, install: null };
  write(rec);
  return withSteps(rec);
}

// the short name of a checklist started before it was asked for, or a new one
// while its engine has not called in yet
function setShortName(id, shortName) {
  const rec = read(id);
  if (rec.engineId) bad(`the engine is saved under ${rec.engineId}; its short name is the engine record's now`);
  rec.shortName = checkShort(shortName, rec.id);
  rec.updatedUtc = new Date().toISOString();
  write(rec);
  return withSteps(rec);
}

function stepOf(stepId) {
  const s = TEMPLATE.steps.find((x) => x.id === stepId);
  if (!s) bad(`no step ${stepId}`);
  return s;
}
function mustBeOpen(rec, stepId) {
  const i = TEMPLATE.steps.findIndex((x) => x.id === stepId);
  if (!stepsOf(rec)[i].open) bad(`step ${i + 1} opens when step ${i} is done`);
}

// A CHOICE. Changing where the engine runs clears the step's ticks, the
// choices that hang off it and an install command not used yet: they were about
// the other machine. Once the engine has called in, where it runs is where it
// runs: another machine is another engine, set up with its own checklist.
function setChoice(id, stepId, choiceId, value) {
  const rec = read(id);
  const step = stepOf(stepId);
  mustBeOpen(rec, stepId);
  const c = (step.choices || []).find((x) => x.id === choiceId);
  if (!c) bad(`step "${step.title}" asks no choice ${choiceId}`);
  if (c.when && !matches(c.when, rec.choices)) {
    // said in the screen's words: the parent choice's label and its option's label, never a stored value
    const words = Object.entries(c.when).map(([k, v]) => { const pc = (step.choices || []).find((x) => x.id === k); const po = pc ? pc.options.find((o) => o.value === v) : null; return `${pc ? pc.label.toLowerCase() : k} is ${po ? po.label : v}`; }).join(' and ');
    bad(`${c.label.toLowerCase()} is asked only when ${words}`);
  }
  const opt = c.options.find((o) => o.value === value);
  if (!opt) bad(`${c.label.toLowerCase()}: one of ${c.options.map((o) => o.label).join(', ')}`);
  if (rec.choices[choiceId] !== value && rec.engineId && engineOf(rec)) bad(`the engine is installed and has called in; to run one on another machine, set up another engine with its own checklist (Set up another engine)`);
  if (rec.choices[choiceId] !== value && c.clears) {
    for (const other of step.choices || []) if (other.when && Object.keys(other.when).includes(choiceId)) delete rec.choices[other.id];
    rec.ticks[stepId] = {};
    if (rec.install && !rec.install.usedUtc) rec.install = null;
  }
  rec.choices[choiceId] = value;
  rec.updatedUtc = new Date().toISOString();
  write(rec);
  return withSteps(rec);
}

function setTick(id, stepId, tickId, on) {
  const rec = read(id);
  const step = stepOf(stepId);
  mustBeOpen(rec, stepId);
  const t = (step.ticks || []).find((x) => x.id === tickId);
  if (!t) bad(`step "${step.title}" has no tick ${tickId}`);
  rec.ticks[stepId] = { ...(rec.ticks[stepId] || {}), [tickId]: on === true };
  rec.updatedUtc = new Date().toISOString();
  write(rec);
  return withSteps(rec);
}

// the checklist goes; an engine it set up keeps its own record, deleted from its card
function remove(id) {
  const f = fileOf(id);
  if (!fs.existsSync(f)) bad(`no engine setup ${id}`, 404);
  fs.unlinkSync(f);
  return { ok: true, id };
}

// ---- STEP 2: THE INSTALL COMMAND AND THE FIRST CALL ----------------------------
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
// letters and digits that cannot be misread for one another
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
function newCode() {
  const b = crypto.randomBytes(24);
  let s = '';
  for (const x of b) s += CODE_ALPHABET[x % CODE_ALPHABET.length];
  return `UTS-${s.match(/.{4}/g).join('-')}`;
}
const normalCode = (c) => String(c == null ? '' : c).trim().toUpperCase();

// A ONE-TIME CODE for the install command: shown once, on the page that asked;
// only its fingerprint is kept, and a new one replaces any not used yet
function makeInstallCode(id, now = Date.now()) {
  const rec = read(id);
  mustBeOpen(rec, 'install');
  if (!rec.shortName) bad('give the engine its short name first');
  const code = newCode();
  rec.install = { codeHash: sha256(code), madeUtc: new Date(now).toISOString(), expiresUtc: new Date(now + CODE_MS).toISOString(), usedUtc: null };
  rec.updatedUtc = rec.install.madeUtc;
  write(rec);
  return { setup: withSteps(rec), code, expiresUtc: rec.install.expiresUtc };
}

// A CODE TO MOVE AN ENGINE THE TUNNEL REACHES TO CALLING OUT, from its card:
// shown once, kept as its fingerprint on the engine record, good for an hour
function makeMoveCode(engineId, now = Date.now()) {
  const code = newCode();
  const expiresUtc = new Date(now + CODE_MS).toISOString();
  require('./targets').setMoveCode(engineId, sha256(code), expiresUtc);
  return { code, expiresUtc };
}

// what an engine may say of its lock: a P-256 public half, and its fingerprint worked out here
function lockOf(lock) {
  if (!lock || typeof lock.publicKey !== 'string' || lock.publicKey.length > 400) return null;
  try {
    const k = crypto.createPublicKey({ key: Buffer.from(lock.publicKey, 'base64'), format: 'der', type: 'spki' });
    if (k.asymmetricKeyType !== 'ec' || (k.asymmetricKeyDetails || {}).namedCurve !== 'prime256v1') return null;
    return { publicKey: lock.publicKey, fingerprint: require('../../engine/lock').fingerprintOf(lock.publicKey) };
  } catch (_) { return null; }
}
const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
function machineOf(m) {
  if (!m || typeof m !== 'object') return null;
  return { platform: clip(m.platform, 20), arch: clip(m.arch, 20), hostname: clip(m.hostname, 80), node: clip(m.node, 20) };
}
const releaseOf = (r) => (typeof r === 'string' && /^[0-9][0-9A-Za-z.-]{0,40}$/.test(r) ? r : null);

// THE FIRST CALL: the engine installed with the command brings the code, and is
// given a token of its own. The code works once and for an hour; this system
// keeps the token's fingerprint in the engine record and nothing else of it.
// An engine installed again on the same machine keeps its lock, so its record's
// copy of the engine's own record carries on; a different machine under the same
// short name starts a record of its own (sameMachine: false).
const sameHash = (a, h) => typeof a === 'string' && a.length === h.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(h));
function enroll(code, info = {}, now = Date.now()) {
  const h = sha256(normalCode(code));
  const targets = require('./targets');
  // an engine the tunnel reaches, moved to calling out with the code made on its card
  const moving = targets.listEngines().find((t) => t.link === 'tunnel' && t.move && sameHash(t.move.codeHash, h));
  if (moving) {
    if (moving.move.usedUtc || Date.parse(moving.move.expiresUtc) < now) bad('that code has run out: make a new one on the engine\'s card', 403);
    const token = crypto.randomBytes(32).toString('base64url');
    const eng = targets.moveToCallingOut(moving.id, { tokenHash: sha256(token), lock: lockOf(info.lock), machine: machineOf(info.machine), release: releaseOf(info.release) });
    return { engineId: eng.id, name: eng.name, token, again: true, sameMachine: true, moved: true };
  }
  const rec = list().find((x) => x.install && sameHash(x.install.codeHash, h));
  if (!rec) bad('that install code is not known here: make a new install command on the Compute tab', 403);
  if (rec.install.usedUtc) bad('that install code has been used already: make a new install command on the Compute tab', 403);
  if (Date.parse(rec.install.expiresUtc) < now) bad('that install code has run out: make a new install command on the Compute tab', 403);
  const lock = lockOf(info.lock);
  const before = targets.listEngines().find((t) => t.id === rec.shortName);
  if (before && before.link !== 'calls-out') bad(`the short name ${rec.shortName} already belongs to an engine the tunnel reaches`, 409);
  const sameMachine = !!(before && before.lock && lock && before.lock.fingerprint === lock.fingerprint);
  const token = crypto.randomBytes(32).toString('base64url');
  const eng = targets.saveCallingEngine({ id: rec.shortName, name: rec.name, tokenHash: sha256(token), lock, machine: machineOf(info.machine), release: releaseOf(info.release), setupRef: rec.id });
  rec.install.usedUtc = new Date(now).toISOString();
  rec.engineId = eng.id;
  rec.enrolledUtc = rec.install.usedUtc;
  rec.updatedUtc = rec.install.usedUtc;
  write(rec);
  return { engineId: eng.id, name: eng.name, token, again: !!before, sameMachine };
}

// ---- REPAIR: A CHECKLIST STARTED ON TEMPLATE 1 (3.266.0, RULE NINE) ------------
// Written to be deleted (RULE TEN) the day every checklist on the box has been
// through it. Template 1's step 2 kept a sign-in key on this machine -- the very
// thing template 2 exists to never hold -- so the move drops step 2's key, its
// boxes and its sign-in, deletes the key folder, and keeps the names, where it
// runs, its operating system and step 1's ticks (less the fixed address tick,
// which is the Account tab's choice now). Run once at start, announced.
const OLD_KEYS_DIR = () => process.env.GC_ENGINE_KEYS_DIR || path.join(__dirname, '..', '..', 'data', 'live', 'engine-keys');
function repairTemplateOne() {
  const named = [];
  for (const rec of list()) {
    if (rec.templateVersion !== 1) continue;
    const ch = rec.choices || {};
    const tk = (rec.ticks || {}).ready || {};
    const moved = {
      id: rec.id, name: rec.name, shortName: rec.shortName || null, templateVersion: 2, createdUtc: rec.createdUtc, updatedUtc: new Date().toISOString(),
      engineId: null, choices: { ...(ch.where ? { where: ch.where } : {}), ...(ch.os ? { os: ch.os } : {}) },
      ticks: { ready: { ...(tk.binance ? { binance: true } : {}), ...(tk.on ? { on: true } : {}), ...(tk.size ? { size: true } : {}) } }, install: null,
    };
    write(moved);
    fs.rmSync(path.join(OLD_KEYS_DIR(), rec.id), { recursive: true, force: true });
    named.push(rec.name);
  }
  try { if (fs.existsSync(OLD_KEYS_DIR()) && !fs.readdirSync(OLD_KEYS_DIR()).length) fs.rmdirSync(OLD_KEYS_DIR()); } catch (_) { /* a folder with something else in it stays */ }
  return { changed: named.length, named };
}

module.exports = {
  TEMPLATE, stepsOf, list: () => list().map(withSteps), get: (id) => withSteps(read(id)), create, setShortName, setChoice, setTick, remove, DIR,
  makeInstallCode, makeMoveCode, enroll, lockOf, repairTemplateOne, CODE_MS,
};
