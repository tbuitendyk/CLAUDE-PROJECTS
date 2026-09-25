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
// The checklists themselves are kept on this machine, one file each, so they
// follow the owner to any device and each finished one stays as the record of
// how its engine was set up. The one thing here that reaches a machine is step
// 2's sign-in: the key it makes or is given, and the sign-in it tries with it.
// No AI anywhere.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const DIR = () => process.env.GC_ENGINE_SETUPS_DIR || path.join(__dirname, '..', '..', 'data', 'live', 'engine-setups');
// each engine's sign-in key, in a folder of its own that only this service can read
const KEYS_DIR = () => process.env.GC_ENGINE_KEYS_DIR || path.join(__dirname, '..', '..', 'data', 'live', 'engine-keys');
const ID_RE = /^es-[a-z0-9]{6,12}-[0-9a-f]{6}$/;
const NAME_MAX = 60;
// the engine record's own rule for a short name (lib/live/targets.js), so the
// short name chosen here is the one step 6 saves the engine under
const SHORT_RE = /^[a-z0-9][a-z0-9-]{1,29}$/;

// ---- THE TEMPLATE -----------------------------------------------------------
// A guidance block shows when each of its `when` choices matches; one marked
// `ifUnset` also shows while that choice has not been made, so the owner sees
// both roads before picking one. A choice with a `when` is asked only then.
const TEMPLATE = {
  version: 1,
  steps: [
    {
      id: 'ready',
      title: 'Here\'s what you need to get your trading engine off the ground',
      guidance: [
        { paras: [
          'The trading engine is the program that carries out Paper Books and Live Trading: it watches the price, opens and closes positions, and writes everything down. It needs a machine to run on — a rented server, or this computer — and this system links to it.',
          'Whatever it runs on needs three things: a fixed public IP address, because an exchange\'s trading keys are locked to one address and this system refuses a key that is not; power and internet around the clock, because a plan waiting or a position open needs it watching prices; and a country where your exchange serves you and you are allowed to use it.',
        ] },
        { when: { where: 'server' }, ifUnset: true, heading: 'A rented server', paras: [
          'Any cloud provider will do. Pick a country where your exchange serves you and you are allowed to use it. An exchange\'s servers sit in one place (Binance\'s, for example, are in Tokyo), so nearer is quicker, but for trades decided once a day a fraction of a second hardly matters.',
          'The smallest size is plenty: 1 CPU, 1 GB of memory and 10 GB of disk, running Debian 12 or 13, or Ubuntu 24.04. The engine is held to 300 MB of memory and half a CPU.',
          'Ask the provider for a fixed public IP address for it (on AWS, for example, it is called an Elastic IP).',
        ] },
        { when: { where: 'local' }, ifUnset: true, heading: 'This computer', paras: [
          'Any computer made in the last several years is plenty: the engine is held to 300 MB of memory and half a CPU. Linux, Mac and Windows will all do.',
          'It must stay on and awake whenever a plan is waiting or a position is open: set it never to sleep while it is plugged in.',
          'Its internet address must be fixed. Home addresses usually change from time to time; ask your internet provider for a static one.',
        ] },
        { when: { where: 'local', os: 'linux' }, paras: ['Linux: any current release will do.'] },
        { when: { where: 'local', os: 'mac' }, paras: ['Mac: in its power settings, stop it sleeping while it is plugged in, including when the display is off.'] },
        { when: { where: 'local', os: 'windows' }, paras: ['Windows: in its power settings, set sleep to never while it is plugged in.'] },
      ],
      choices: [
        { id: 'where', label: 'Where it runs', clears: true, clearsNote: 'changing this clears the ticks below, and any sign-in in step 2: they were about the other machine', options: [{ value: 'server', label: 'a rented server' }, { value: 'local', label: 'this computer' }] },
        { id: 'os', label: 'Its operating system', when: { where: 'local' }, options: [{ value: 'linux', label: 'Linux' }, { value: 'mac', label: 'Mac' }, { value: 'windows', label: 'Windows' }] },
      ],
      ticks: [
        { id: 'binance', label: 'My exchange serves me there, and I may use it there' },
        { id: 'ip', label: 'It has a fixed public IP address' },
        { id: 'on', label: 'It will be on and online around the clock' },
        { id: 'size', label: 'It meets the size above' },
      ],
    },
    {
      id: 'access',
      title: 'Let the system in',
      guidance: [
        { paras: [
          'This system signs in to the machine to install the engine and keep it running, the way you would sign in yourself: with a key. Choose how it gets one, give it the machine\'s address and the account to sign in as, and press Try signing in. The step is done when it has signed in.',
        ] },
        { when: { keyHow: 'made' }, ifUnset: true, heading: 'With a key this system makes', paras: [
          'Press Make this engine\'s key. The system keeps the private half to itself and never shows it; you copy the public half, shown below, onto the machine.',
          'A machine you are about to rent: most providers ask for a key when the machine is made. Give it the public half there (on AWS, for example, import it as a key pair and choose it when you launch).',
          'A machine you already have: sign in to it yourself and add the public half as a new line at the end of ~/.ssh/authorized_keys of the account this system signs in as. Some providers open a terminal on the machine in your browser (on AWS, for example, EC2 Instance Connect).',
        ] },
        { when: { keyHow: 'file' }, ifUnset: true, heading: 'With a key file you already have', paras: [
          'Paste the private key file the provider gave you when the machine was made: it starts with -----BEGIN and ends with PRIVATE KEY-----. The system keeps it to itself and never shows it again, only its fingerprint. A key file locked with a passphrase cannot be used.',
        ] },
        { when: { where: 'local' }, heading: 'This computer', paras: [
          'How this system reaches a computer at home without opening it to the internet is still being worked out. This step can be finished for a rented server today.',
        ] },
      ],
      choices: [
        { id: 'keyHow', label: 'How this system signs in', clears: true, clearsNote: 'changing this throws away the key and the sign-in made the other way', options: [{ value: 'made', label: 'with a key this system makes' }, { value: 'file', label: 'with a key file you already have' }] },
      ],
      fields: [
        { id: 'host', label: 'the machine\'s address', placeholder: 'ec2-203-0-113-7.compute.amazonaws.com', width: '31rem' },
        { id: 'user', label: 'sign in as', placeholder: 'admin', width: '8rem' },
      ],
      // the key controls and the sign-in, drawn by the page for this step
      panel: 'access',
      checks: [{ id: 'signedIn', label: 'This system signed in to the machine' }],
    },
    // the steps still being written: a title each, and nothing to tick yet
    { id: 'check', title: 'Check the machine', writing: true },
    { id: 'install', title: 'Install the engine', writing: true },
    { id: 'link', title: 'Link it to this system', writing: true },
    { id: 'save', title: 'Save the engine', writing: true },
    { id: 'current', title: 'Keep it current', writing: true },
  ],
};

// ---- WHERE A CHECKLIST STANDS ---------------------------------------------------
const matches = (when, choices) => Object.entries(when || {}).every(([k, v]) => (choices || {})[k] === v);
// the choices a step asks for, given what has been chosen so far
function choicesAsked(step, choices) { return (step.choices || []).filter((c) => !c.when || matches(c.when, choices)); }

// each step: done, open, and what is still missing, in words
function stepsOf(setup) {
  const out = [];
  let before = true;
  for (const step of TEMPLATE.steps) {
    const choices = setup.choices || {};
    const ticks = (setup.ticks || {})[step.id] || {};
    const missing = [];
    if (step.writing) missing.push('this step is still being written');
    for (const c of choicesAsked(step, choices)) if (!choices[c.id]) missing.push(`choose ${c.label.toLowerCase()}`);
    for (const t of step.ticks || []) if (ticks[t.id] !== true) missing.push(`tick "${t.label}"`);
    if (step.panel === 'access' && choices.keyHow && !(setup.key && setup.key.how === choices.keyHow)) missing.push(choices.keyHow === 'file' ? 'save the key file' : 'make this engine\'s key');
    for (const f of step.fields || []) if (!(((setup.fields || {})[step.id] || {})[f.id])) missing.push(`fill in ${f.label}`);
    for (const c of step.checks || []) if (!((((setup.checks || {})[step.id] || {})[c.id] || {}).ok)) missing.push(c.id === 'signedIn' ? 'press Try signing in, and sign in' : c.label.toLowerCase());
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
const withSteps = (rec) => ({ ...rec, steps: stepsOf(rec) });

// THE ENGINE'S TWO NAMES (owner, 2026-09-25): a short name -- letters, digits,
// dashes -- and a descriptive name, what the screens show, exactly as the
// engine record asks for them; step 6 saves the engine under both. A short
// name another checklist or an engine record already has is refused.
function checkShort(shortName, selfId = null) {
  const v = String(shortName == null ? '' : shortName).trim();
  const bad = (m) => { const e = new Error(m); e.status = 400; throw e; };
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
  if (!n || n.length > NAME_MAX) { const e = new Error(`descriptive name: 1 to ${NAME_MAX} characters`); e.status = 400; throw e; }
  const taken = list().find((x) => String(x.name).toLowerCase() === n.toLowerCase());
  if (taken) { const e = new Error(`there is already a setup for an engine called "${taken.name}" — one per engine`); e.status = 400; throw e; }
  const sn = checkShort(shortName);
  const now = new Date().toISOString();
  const rec = { id: `es-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`, name: n, shortName: sn, templateVersion: TEMPLATE.version, createdUtc: now, updatedUtc: now, engineId: null, choices: {}, ticks: {} };
  write(rec);
  return withSteps(rec);
}

// the short name of a checklist started before it was asked for, or a new one
// while its engine is not saved yet
function setShortName(id, shortName) {
  const rec = read(id);
  if (rec.engineId) { const e = new Error(`the engine is saved under ${rec.engineId}; its short name is the engine record's now`); e.status = 400; throw e; }
  rec.shortName = checkShort(shortName, rec.id);
  rec.updatedUtc = new Date().toISOString();
  write(rec);
  return withSteps(rec);
}

function stepOf(stepId) {
  const s = TEMPLATE.steps.find((x) => x.id === stepId);
  if (!s) { const e = new Error(`no step ${stepId}`); e.status = 400; throw e; }
  return s;
}
function mustBeOpen(rec, stepId) {
  const i = TEMPLATE.steps.findIndex((x) => x.id === stepId);
  if (!stepsOf(rec)[i].open) { const e = new Error(`step ${i + 1} opens when step ${i} is done`); e.status = 400; throw e; }
}

// A CHOICE. Changing where the engine runs clears the step's ticks, the
// choices that hang off it and every sign-in after it: they were about the
// other machine.
function setChoice(id, stepId, choiceId, value) {
  const rec = read(id);
  const step = stepOf(stepId);
  mustBeOpen(rec, stepId);
  const c = (step.choices || []).find((x) => x.id === choiceId);
  if (!c) { const e = new Error(`step "${step.title}" asks no choice ${choiceId}`); e.status = 400; throw e; }
  if (c.when && !matches(c.when, rec.choices)) {
    // said in the screen's words: the parent choice's label and its option's label, never a stored value
    const words = Object.entries(c.when).map(([k, v]) => { const pc = (step.choices || []).find((x) => x.id === k); const po = pc ? pc.options.find((o) => o.value === v) : null; return `${pc ? pc.label.toLowerCase() : k} is ${po ? po.label : v}`; }).join(' and ');
    const e = new Error(`${c.label.toLowerCase()} is asked only when ${words}`); e.status = 400; throw e;
  }
  const opt = c.options.find((o) => o.value === value);
  if (!opt) { const e = new Error(`${c.label.toLowerCase()}: one of ${c.options.map((o) => o.label).join(', ')}`); e.status = 400; throw e; }
  if (rec.choices[choiceId] !== value && c.clears) {
    for (const other of step.choices || []) if (other.when && Object.keys(other.when).includes(choiceId)) delete rec.choices[other.id];
    rec.ticks[stepId] = {};
    // a check this system made from here on was made the other way, or on the other machine
    const at = TEMPLATE.steps.indexOf(step);
    if (rec.checks) for (const later of TEMPLATE.steps.slice(at)) delete rec.checks[later.id];
    // a different way of signing in: the key made the other way goes
    if (step.panel === 'access') dropKey(rec);
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
  if (!t) { const e = new Error(`step "${step.title}" has no tick ${tickId}`); e.status = 400; throw e; }
  rec.ticks[stepId] = { ...(rec.ticks[stepId] || {}), [tickId]: on === true };
  rec.updatedUtc = new Date().toISOString();
  write(rec);
  return withSteps(rec);
}

function remove(id) {
  const f = fileOf(id);
  if (!fs.existsSync(f)) { const e = new Error(`no engine setup ${id}`); e.status = 404; throw e; }
  fs.unlinkSync(f);
  // deleting a checklist deletes every file it owns: its key goes with it
  fs.rmSync(keyDirOf(id), { recursive: true, force: true });
  return { ok: true, id };
}

// ---- STEP 2: THE KEY AND THE SIGN-IN -----------------------------------------
// The private half of a key is written once, to this engine's own folder, and
// never read back to any page, answer or log: only its public half and its
// fingerprint leave this machine. The sign-in runs the machine's own ssh.
let run = (cmd, args, timeoutMs) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1 << 20 }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, killed: !!(err && err.killed), missing: !!(err && err.code === 'ENOENT'), stdout: String(stdout || ''), stderr: String(stderr || '') }));
});
function keyDirOf(id) { fileOf(id); return path.join(KEYS_DIR(), id); }
const bad = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
function dropKey(rec) {
  delete rec.key;
  for (const f of ['key', 'key.pub', 'known_hosts']) fs.rmSync(path.join(keyDirOf(rec.id), f), { force: true });
}
async function fingerprintOf(pubFile) {
  const r = await run('ssh-keygen', ['-l', '-f', pubFile], 10000);
  const m = /(SHA256:[A-Za-z0-9+/=]+)/.exec(r.stdout);
  return m ? m[1] : null;
}
function freshDir(id) {
  const dir = keyDirOf(id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}
const toolMissing = () => bad('this machine has no ssh-keygen to make or read a key with', 500);

// with a key this system makes: a new pair, the private half kept here
async function makeKey(id) {
  const rec = read(id);
  mustBeOpen(rec, 'access');
  if (rec.choices.keyHow !== 'made') bad('choose "with a key this system makes" first');
  dropKey(rec);
  const dir = freshDir(id);
  const r = await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `uts ${rec.shortName || rec.id}`, '-f', path.join(dir, 'key')], 20000);
  if (r.missing) toolMissing();
  if (r.code !== 0) bad(`the key could not be made: ${(r.stderr || r.stdout).trim().split('\n').pop() || 'no reason given'}`, 500);
  const publicKey = fs.readFileSync(path.join(dir, 'key.pub'), 'utf8').trim();
  rec.key = { how: 'made', publicKey, fingerprint: await fingerprintOf(path.join(dir, 'key.pub')), at: new Date().toISOString() };
  if (rec.checks) delete rec.checks.access;
  rec.updatedUtc = new Date().toISOString();
  write(rec);
  return withSteps(rec);
}

// with a key file the owner already has: kept here, and checked to be one
async function saveKeyFile(id, text) {
  const rec = read(id);
  mustBeOpen(rec, 'access');
  if (rec.choices.keyHow !== 'file') bad('choose "with a key file you already have" first');
  const t = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim();
  if (t.length > 20000 || !/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(t) || !/-----END [A-Z ]*PRIVATE KEY-----$/.test(t)) bad('that is not a private key file: it starts with -----BEGIN and ends with PRIVATE KEY-----');
  dropKey(rec);
  const dir = freshDir(id);
  const kf = path.join(dir, 'key');
  fs.writeFileSync(kf, `${t}\n`, { mode: 0o600 });
  fs.chmodSync(kf, 0o600);
  // the public half, worked out from the file: a file that cannot give one is not kept
  const r = await run('ssh-keygen', ['-y', '-P', '', '-f', kf], 10000);
  if (r.missing) { fs.rmSync(kf, { force: true }); toolMissing(); }
  if (r.code !== 0 || !/^(ssh-|ecdsa-)/.test(r.stdout.trim())) {
    fs.rmSync(kf, { force: true });
    bad(/passphrase/i.test(r.stderr) ? 'the key file is locked with a passphrase, which this system cannot type: use a key file without one, or let the system make a key' : 'the key file could not be read as a key');
  }
  const publicKey = r.stdout.trim();
  fs.writeFileSync(path.join(dir, 'key.pub'), `${publicKey}\n`);
  rec.key = { how: 'file', publicKey, fingerprint: await fingerprintOf(path.join(dir, 'key.pub')), at: new Date().toISOString() };
  if (rec.checks) delete rec.checks.access;
  rec.updatedUtc = new Date().toISOString();
  write(rec);
  return withSteps(rec);
}

// the machine's address and the account to sign in as; a change asks for a new sign-in
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const USER_RE = /^[a-z_][a-z0-9_.-]{0,31}$/;
function setField(id, stepId, fieldId, value) {
  const rec = read(id);
  const step = stepOf(stepId);
  mustBeOpen(rec, stepId);
  const f = (step.fields || []).find((x) => x.id === fieldId);
  if (!f) bad(`step "${step.title}" has no box ${fieldId}`);
  const v = String(value == null ? '' : value).trim();
  if (fieldId === 'host' && !HOST_RE.test(v)) bad('the machine\'s address: a name like ec2-203-0-113-7.compute.amazonaws.com, or an address like 203.0.113.7');
  if (fieldId === 'user' && !USER_RE.test(v)) bad('sign in as: the account\'s name on the machine, like admin or ubuntu');
  rec.fields = rec.fields || {};
  const before = (rec.fields[stepId] || {})[fieldId];
  rec.fields[stepId] = { ...(rec.fields[stepId] || {}), [fieldId]: v };
  if (before !== v && rec.checks) delete rec.checks[stepId];
  rec.updatedUtc = new Date().toISOString();
  write(rec);
  return withSteps(rec);
}

// the sign-in, in words: what the machine said, or why it would not have us
function signInWords(r, user) {
  const e = `${r.stderr}\n${r.stdout}`;
  if (r.killed) return 'the machine did not answer within 25 seconds';
  if (/Permission denied/i.test(e)) return `the machine refused the key: add the public half to ~/.ssh/authorized_keys of ${user} on it`;
  if (/Could not resolve hostname|Name or service not known/i.test(e)) return 'no machine answers to that address';
  if (/timed out/i.test(e)) return 'the machine did not answer on port 22: is it running, and does its firewall let SSH in from this system?';
  if (/Connection refused/i.test(e)) return 'the machine refused the connection on port 22: its SSH server is not running';
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(e)) return 'the machine at that address is not the one this system signed in to before: its identity has changed. Nothing was sent to it';
  const last = e.trim().split('\n').filter((l) => l && !/^Warning: /.test(l)).pop();
  return last ? `the sign-in did not work: ${last}` : 'the sign-in did not work, and gave no reason';
}
async function signIn(id) {
  const rec = read(id);
  mustBeOpen(rec, 'access');
  const f = (rec.fields || {}).access || {};
  if (!rec.key) bad(rec.choices.keyHow === 'file' ? 'save the key file first' : 'make this engine\'s key first');
  if (!f.host || !f.user) bad('fill in the machine\'s address and sign in as first');
  const dir = keyDirOf(id);
  const args = ['-F', '/dev/null', '-i', path.join(dir, 'key'), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'PasswordAuthentication=no',
    '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${path.join(dir, 'known_hosts')}`, '-o', 'ConnectTimeout=12', '-o', 'LogLevel=ERROR',
    `${f.user}@${f.host}`, 'echo UTS-SIGNED-IN; uname -sm; id -un'];
  const r = await run('ssh', args, 25000);
  if (r.missing) bad('this machine has no ssh to sign in with', 500);
  const ok = r.code === 0 && /UTS-SIGNED-IN/.test(r.stdout);
  const lines = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const at = new Date().toISOString();
  let machine = null;
  if (ok) {
    const k = await run('ssh-keygen', ['-l', '-f', path.join(dir, 'known_hosts')], 10000);
    const m = /(SHA256:[A-Za-z0-9+/=]+)/.exec(k.stdout);
    machine = m ? m[1] : null;
  }
  rec.checks = rec.checks || {};
  rec.checks.access = { signedIn: ok
    ? { ok: true, at, said: `signed in as ${lines[2] || f.user} on ${f.host}: ${lines[1] || 'the machine did not say what it is'}`, machine }
    : { ok: false, at, why: signInWords(r, f.user) } };
  rec.updatedUtc = at;
  write(rec);
  return withSteps(rec);
}

module.exports = {
  TEMPLATE, stepsOf, list: () => list().map(withSteps), get: (id) => withSteps(read(id)), create, setShortName, setChoice, setTick, remove, DIR,
  makeKey, saveKeyFile, setField, signIn, signInWords, KEYS_DIR,
  _setRunner: (fn) => { run = fn; },
};
