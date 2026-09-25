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
// how its engine was set up. Nothing here reaches any machine yet: the steps
// that will are still being written. No AI anywhere.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = () => process.env.GC_ENGINE_SETUPS_DIR || path.join(__dirname, '..', '..', 'data', 'live', 'engine-setups');
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
          'Whatever it runs on needs three things: a fixed public IP address, because Binance keys are locked to one address and this system refuses a key that is not; power and internet around the clock, because a plan waiting or a position open needs it watching prices; and a country where Binance serves you and you are allowed to use it.',
        ] },
        { when: { where: 'server' }, ifUnset: true, heading: 'A rented server', paras: [
          'Any cloud provider will do. Pick a country where Binance serves you and you are allowed to use it: the engine running today is on AWS in Mexico City. Binance\'s servers are in Tokyo, so nearer is quicker, but for trades decided once a day a fraction of a second hardly matters.',
          'The smallest size is plenty: 1 CPU, 1 GB of memory and 10 GB of disk, running Debian 12 or 13, or Ubuntu 24.04. The engine is held to 300 MB of memory and half a CPU.',
          'Ask the provider for a fixed public IP address for it. On AWS that is an Elastic IP.',
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
        { id: 'where', label: 'Where it runs', clears: true, options: [{ value: 'server', label: 'a rented server' }, { value: 'local', label: 'this computer' }] },
        { id: 'os', label: 'Its operating system', when: { where: 'local' }, options: [{ value: 'linux', label: 'Linux' }, { value: 'mac', label: 'Mac' }, { value: 'windows', label: 'Windows' }] },
      ],
      ticks: [
        { id: 'binance', label: 'Binance serves me there, and I may use it there' },
        { id: 'ip', label: 'It has a fixed public IP address' },
        { id: 'on', label: 'It will be on and online around the clock' },
        { id: 'size', label: 'It meets the size above' },
      ],
    },
    // the steps still being written: a title each, and nothing to tick yet
    { id: 'access', title: 'Let the system in', writing: true },
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
  if (v === 'mx-1') bad('short name: mx-1 is the old order program');
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

// A CHOICE. Changing where the engine runs clears the step's ticks and the
// choices that hang off it: they were about the other machine.
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
  return { ok: true, id };
}

module.exports = { TEMPLATE, stepsOf, list: () => list().map(withSteps), get: (id) => withSteps(read(id)), create, setShortName, setChoice, setTick, remove, DIR };
