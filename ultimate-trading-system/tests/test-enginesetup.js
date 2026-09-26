// SETTING UP A TRADING ENGINE, STEP BY STEP (3.263.0, owner 2026-09-25): the
// checklist on Setup > Compute, one per engine -- the template, where each
// checklist stands, what a locked step refuses, and the page that draws it.
// TEMPLATE 2 (3.266.0, owner 2026-09-25): the engine calls out. Step 2 is an
// install command with a one-time code; this system keeps only a fingerprint of
// the code and, once the engine calls in, of the engine's own password.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.GC_ENGINE_SETUPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-es-'));
process.env.GC_ENGINE_KEYS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-es-keys-'));
process.env.GC_TARGETS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-es-targets-')), 'targets.json');
const es = require('../lib/live/enginesetup');
const targets = require('../lib/live/targets');
const refused = (fn, rx) => { let err = null; try { fn(); } catch (e) { err = e; } assert.ok(err && rx.test(err.message), `refused in words matching ${rx}: ${err && err.message}`); return err; };
const RELEASE = require('../package.json').version;
const readyTicks = (id) => { es.setChoice(id, 'ready', 'where', 'server'); for (const t of ['binance', 'on', 'size']) es.setTick(id, 'ready', t, true); };

module.exports = {
  // THE TEMPLATE: step 1 in full, step 2 the install command, step 3 keeping it current
  theTemplateHasStepOneInFullAndTheRestStillBeingWritten() {
    const [first, ...rest] = es.TEMPLATE.steps;
    assert.strictEqual(es.TEMPLATE.version, 2);
    assert.strictEqual(first.title, 'Here\'s what you need to get your trading engine off the ground');
    assert.deepStrictEqual(first.choices.map((c) => [c.id, c.options.map((o) => o.label)]), [['where', ['a rented server', 'this computer']], ['os', ['Linux', 'Mac', 'Windows']]]);
    assert.deepStrictEqual(first.choices[1].when, { where: 'local' }, 'the operating system is asked for this computer');
    // TIED TO ONE ADDRESS IS THE OWNER'S CHOICE (owner, 2026-09-25): no tick demands a fixed address
    assert.deepStrictEqual(first.ticks.map((t) => t.label), ['My exchange serves me there, and I may use it there', 'It will be on and online around the clock', 'It meets the size above']);
    assert.deepStrictEqual(rest.map((s) => [s.title, !!s.writing, s.panel]), [['Install the engine', false, 'install'], ['Keep it current', false, 'current']]);
    // THE PLATFORM IS THE OWNER'S CHOICE (owner, 2026-09-25): Binance only ever as an example
    const all = JSON.stringify(es.TEMPLATE.steps.map((x) => [x.title, x.guidance, (x.ticks || []).map((t) => t.label), (x.choices || []).map((c) => [c.label, c.options])]));
    for (const m of all.match(/[^.]*Binance[^.]*/g) || []) assert.ok(/for example/.test(m), `Binance named only as an example: ${m}`);
    // NOR ONE PROVIDER, NOR ONE INSTALLATION (owner, 2026-09-25): AWS only ever as an example, and nothing about the machines this system happens to run on
    for (const m of all.match(/[^.]*(AWS|EC2)[^.]*/g) || []) assert.ok(/for example/.test(m), `a provider named only as an example: ${m}`);
    assert.ok(!/Mexico|running today/.test(all), 'the template says nothing about one installation\'s machines');
    const words = JSON.stringify(first.guidance);
    for (const w of ['fixed public IP address is needed only if you tie your exchange keys to one address', 'Elastic IP', 'Debian 12 or 13', 'Ubuntu 24.04', '300 MB', 'static one', 'Mac:', 'Windows:', 'Linux:', 'Nothing here can sign in to that machine']) assert.ok(words.includes(w), `step 1 says ${w}`);
    assert.ok(!/sign-in key|authorized_keys|private half/.test(all), 'nothing in the template keeps or asks for a key that signs in to the machine');
  },

  // ONE PER ENGINE, and each step opens only when the one before it is done
  aChecklistOpensEachStepOnlyWhenTheOneBeforeIsDone() {
    const a = es.create('Mexico engine', 'mx-engine-2');
    assert.deepStrictEqual(a.steps.map((s) => [s.open, s.done]), [[true, false], [false, false], [false, false]]);
    refused(() => es.create(' mexico ENGINE ', 'other'), /already a setup for an engine called "Mexico engine" — one per engine/);
    refused(() => es.create('', 'other'), /^descriptive name: 1 to 60 characters$/);
    refused(() => es.create('Another', 'Not Short'), /^short name: 2 to 30 of a-z, 0-9 and -, starting with a letter or digit$/);
    refused(() => es.create('Another', 'mx-engine-2'), /short name: mx-engine-2 is already the short name of the setup for "Mexico engine"/);
    refused(() => es.create('Another', 'mx-1'), /^short name: mx-1 is already taken$/);
    refused(() => es.makeInstallCode(a.id), /^step 2 opens when step 1 is done$/);
    refused(() => es.setChoice(a.id, 'ready', 'os', 'mac'), /^its operating system is asked only when where it runs is this computer$/);
    refused(() => es.setChoice(a.id, 'ready', 'where', 'moon'), /one of a rented server, this computer/);
    refused(() => es.setTick(a.id, 'ready', 'nope', true), /has no tick nope/);
    es.setChoice(a.id, 'ready', 'where', 'local');
    assert.ok(es.get(a.id).steps[0].missing.includes('choose its operating system'), 'this computer asks its operating system');
    es.setChoice(a.id, 'ready', 'os', 'windows');
    for (const t of ['binance', 'on']) es.setTick(a.id, 'ready', t, true);
    assert.deepStrictEqual(es.get(a.id).steps[0].missing, ['tick "It meets the size above"']);
    const done = es.setTick(a.id, 'ready', 'size', true);
    assert.deepStrictEqual(done.steps.map((s) => [s.open, s.done]), [[true, true], [true, false], [false, false]], 'step 1 done opens step 2');
    assert.deepStrictEqual(done.steps[1].missing, ['press Make the install command']);
    // changing where it runs clears the ticks, the operating system and a command not used yet: they were about the other machine
    es.makeInstallCode(a.id);
    const moved = es.setChoice(a.id, 'ready', 'where', 'server');
    assert.deepStrictEqual([moved.choices, moved.ticks.ready, moved.install], [{ where: 'server' }, {}, null]);
    assert.deepStrictEqual(moved.steps.map((s) => s.open), [true, false, false]);
    // kept on this machine, and taken away
    assert.strictEqual(es.list().length, 1);
    assert.deepStrictEqual(es.remove(a.id), { ok: true, id: a.id });
    assert.strictEqual(es.list().length, 0);
    refused(() => es.get('../../etc/passwd'), /no engine setup/);
  },

  // THE PAGE: the button in The trading engine section opens and closes the
  // area; the steps come from the template; a button never shares a row with a field
  theComputeTabOpensTheChecklistFromItsButton() {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
    const engine = src.slice(src.indexOf('function engineHtml('), src.indexOf('function wireEs('));
    assert.ok(/\+ esHtml\(\)/.test(engine), 'the area is drawn inside The trading engine section');
    assert.ok(/<button id="esToggle"[^>]*>' \+ \(cEsOpen \? '▾' : '▸'\) \+ ' Set up a trading engine<\/button>/.test(src), 'one button opens and closes it');
    assert.ok(/localStorage\.setItem\('setup-es-open'/.test(src), 'open or closed is remembered for this viewer');
    assert.ok(/getJson\('api\/live\/engine-setups'\)/.test(src) && /esSetupHtml\(sel, cEs\.template\)/.test(src), 'the steps are the service\'s template');
    assert.ok(/<div class="row" style="margin-top:\.5rem"><button id="esStart">Start its setup<\/button>/.test(src), 'Start its setup has a row of its own');
    assert.ok(/<div class="row" style="margin-top:\.9rem"><button id="esDelete" class="danger"/.test(src), 'Delete this setup has a row of its own');
    assert.ok(/opens when step ' \+ i \+ ' is done/.test(src) && /This step is still being written\./.test(src), 'a locked step and a step still being written say so');
    assert.ok(/A new engine is added with Set up a trading engine\./.test(engine), 'the section says where a new engine comes from');
    assert.ok(!/A new engine record/.test(engine) && !/Start a new record instead/.test(engine), 'no engine record is made by hand any more');
  },
};

// THE ENGINE'S TWO NAMES (3.264.0): asked when a setup starts; a checklist
// started before they were asked for is given its short name on screen
module.exports.aChecklistCarriesTheEnginesTwoNames = function () {
  const dir = process.env.GC_ENGINE_SETUPS_DIR;
  const id = 'es-muhgabc1-a1b2c3';
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, name: 'CDMX UTS Trading Engine (AWS)', templateVersion: 2, createdUtc: '2026-09-25T20:55:00.000Z', updatedUtc: '2026-09-25T20:55:00.000Z', engineId: null, choices: {}, ticks: {}, install: null }));
  assert.strictEqual(es.get(id).shortName, undefined);
  refused(() => es.setShortName(id, 'CDMX'), /^short name: 2 to 30/);
  assert.strictEqual(es.setShortName(id, 'cdmx-engine').shortName, 'cdmx-engine');
  const b = es.create('Second engine', 'second-engine');
  refused(() => es.setShortName(b.id, 'cdmx-engine'), /already the short name of the setup for "CDMX UTS Trading Engine \(AWS\)"/);
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
  assert.ok(/setups\.length > 1\s*\? '<div class="row" style="margin-bottom:\.5rem"><label class="c"><span class="muted">show the checklist for<\/span>/.test(src), 'the picker shows only with more than one checklist');
  assert.ok(/<b style="font-size:\.95rem">' \+ esc\(sel\.name\) \+ '<\/b>/.test(src), 'the checklist is headed with its engine\'s name');
  assert.ok(/id="esShortFix"/.test(src) && /<button id="esShortSave">Save the short name<\/button>/.test(src), 'a checklist without a short name asks for it');
  assert.ok(/<button id="esNewToggle"[^>]*>' \+ \(cEsNew \? '▾' : '▸'\) \+ ' Set up another engine<\/button>/.test(src), 'another engine is set up behind its own button');
  assert.ok(!/name for the new engine/.test(src), 'the name box that read as this engine\'s second name is gone');
  es.remove(id); es.remove(b.id);
};

// STEP 2 -- THE INSTALL COMMAND AND THE FIRST CALL (3.266.0): a one-time code,
// shown once; the engine brings it back and is given a token of its own; this
// system keeps the fingerprints and nothing that could sign in to the machine
module.exports.stepTwoInstallsTheEngineWithAOneTimeCode = function () {
  const { Lock } = require('../engine/lock');
  const lock = new Lock(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-es-lock-')), 'lock.json')).open();
  const a = es.create('CDMX engine', 'cdmx-engine');
  readyTicks(a.id);
  const t0 = Date.UTC(2026, 8, 26, 1);
  const made = es.makeInstallCode(a.id, t0);
  assert.ok(/^UTS(-[A-HJ-NP-TV-Z2-9]{4}){6}$/.test(made.code), made.code);
  assert.strictEqual(made.expiresUtc, new Date(t0 + 60 * 60000).toISOString(), 'the code works for an hour');
  const onDisk = fs.readFileSync(path.join(process.env.GC_ENGINE_SETUPS_DIR, `${a.id}.json`), 'utf8');
  assert.ok(!onDisk.includes(made.code), 'the code itself is never kept: only its fingerprint');
  assert.deepStrictEqual(Object.keys(es.get(a.id).install).sort(), ['expiresUtc', 'madeUtc', 'usedUtc', 'waiting'], 'the page is told when, never the fingerprint');
  assert.deepStrictEqual(es.get(a.id).steps[1].missing, ['run the install command on the machine']);
  // wrong, late, or used: refused in words
  refused(() => es.enroll('UTS-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', {}, t0), /not known here: make a new install command on the Compute tab/);
  refused(() => es.enroll(made.code, {}, t0 + 61 * 60000), /has run out: make a new install command/);
  // THE FIRST CALL: a token of its own, its fingerprint in the engine record, the lock's public half kept
  const got = es.enroll(made.code.toLowerCase(), { lock: { publicKey: lock.info().publicKey }, release: RELEASE, machine: { platform: 'linux', arch: 'x64', hostname: 'ip-172-31-5-9', node: 'v20.1.0', extra: 'x'.repeat(500) } }, t0 + 5 * 60000);
  assert.deepStrictEqual([got.engineId, got.name, got.again], ['cdmx-engine', 'CDMX engine', false]);
  const eng = targets.getTarget('cdmx-engine');
  assert.deepStrictEqual([eng.link, eng.tokenHash, eng.lock.fingerprint, eng.machine.hostname, eng.release, eng.setupRef], ['calls-out', crypto.createHash('sha256').update(got.token).digest('hex'), lock.info().fingerprint, 'ip-172-31-5-9', RELEASE, a.id]);
  assert.ok(!JSON.stringify(targets.listEngines()).includes(got.token), 'the token itself is never kept here');
  refused(() => es.enroll(made.code, {}, t0 + 6 * 60000), /has been used already/);
  const after = es.get(a.id);
  assert.deepStrictEqual(after.steps.map((s) => [s.open, s.done]), [[true, true], [true, true], [true, true]], 'called in on this system\'s release: every step done');
  assert.deepStrictEqual([after.engine.id, after.engine.lock.fingerprint], ['cdmx-engine', lock.info().fingerprint]);
  // an engine behind this system's release is step 3's to bring forward
  targets.noteEngine('cdmx-engine', { release: '3.1.0' });
  assert.deepStrictEqual(es.get(a.id).steps[2].missing, [`bring the engine from 3.1.0 to ${RELEASE}`]);
  // installed again on the same machine (the same lock): the record carries on; a different machine starts afresh
  const again = es.enroll(es.makeInstallCode(a.id, t0 + 7 * 60000).code, { lock: { publicKey: lock.info().publicKey }, release: RELEASE }, t0 + 8 * 60000);
  assert.deepStrictEqual([again.again, again.sameMachine], [true, true]);
  assert.notStrictEqual(targets.getTarget('cdmx-engine').tokenHash, eng.tokenHash, 'a new token: the old one stops working');
  const other = new Lock(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-es-lock2-')), 'lock.json')).open();
  const elsewhere = es.enroll(es.makeInstallCode(a.id, t0 + 9 * 60000).code, { lock: { publicKey: other.info().publicKey } }, t0 + 10 * 60000);
  assert.deepStrictEqual([elsewhere.again, elsewhere.sameMachine], [true, false]);
  // a lock that is not a P-256 public half is not taken
  assert.strictEqual(es.lockOf({ publicKey: 'not a key' }), null);
  // once it has called in, where it runs is where it runs
  refused(() => es.setChoice(a.id, 'ready', 'where', 'local'), /the engine is installed and has called in; to run one on another machine, set up another engine/);
  // an engine the tunnel reaches keeps its short name: no install code can take it
  fs.writeFileSync(process.env.GC_TARGETS_FILE, JSON.stringify({ ...JSON.parse(fs.readFileSync(process.env.GC_TARGETS_FILE, 'utf8')), 'tun-engine': { id: 'tun-engine', kind: 'engine', link: 'tunnel', name: 'Tunnel', host: 'h', user: 'u', enginePort: 18095, localPort: 18095 } }));
  const tunId = 'es-muhgtun1-abcdef';
  fs.writeFileSync(path.join(process.env.GC_ENGINE_SETUPS_DIR, `${tunId}.json`), JSON.stringify({ id: tunId, name: 'Tun', shortName: 'tun-engine', templateVersion: 2, createdUtc: '2026-09-26T00:00:00.000Z', engineId: null, choices: { where: 'server' }, ticks: { ready: { binance: true, on: true, size: true } }, install: null }));
  refused(() => es.enroll(es.makeInstallCode(tunId, t0).code, {}, t0 + 60000), /already belongs to an engine the tunnel reaches/);
  es.remove(tunId);
  es.remove(a.id);
  targets.deleteEngine('cdmx-engine', []);
};

// RULE NINE: a checklist started on template 1 moves to template 2 once, and its
// sign-in key -- the thing template 2 never holds -- is deleted with its folder
module.exports.aTemplateOneChecklistMovesAndItsSignInKeyIsDeleted = function () {
  const id = 'es-muhgold1-0a1b2c';
  const keys = path.join(process.env.GC_ENGINE_KEYS_DIR, id);
  fs.mkdirSync(keys, { recursive: true });
  fs.writeFileSync(path.join(keys, 'key'), 'THE-PRIVATE-HALF');
  fs.writeFileSync(path.join(process.env.GC_ENGINE_SETUPS_DIR, `${id}.json`), JSON.stringify({
    id, name: 'CDMX UTS Trading Engine (AWS)', shortName: 'cdmx-engine', templateVersion: 1, createdUtc: '2026-09-25T20:55:00.000Z', updatedUtc: '2026-09-25T21:00:00.000Z', engineId: null,
    choices: { where: 'server', keyHow: 'made' }, ticks: { ready: { binance: true, ip: true, on: true, size: true } },
    fields: { access: { host: 'h', user: 'admin' } }, key: { how: 'made', publicKey: 'ssh-ed25519 AAAA', fingerprint: 'SHA256:x' }, checks: { access: { signedIn: { ok: true } } },
  }));
  assert.deepStrictEqual(es.repairTemplateOne(), { changed: 1, named: ['CDMX UTS Trading Engine (AWS)'] });
  const rec = JSON.parse(fs.readFileSync(path.join(process.env.GC_ENGINE_SETUPS_DIR, `${id}.json`), 'utf8'));
  assert.deepStrictEqual([rec.templateVersion, rec.choices, rec.ticks, rec.key, rec.fields, rec.checks, rec.install], [2, { where: 'server' }, { ready: { binance: true, on: true, size: true } }, undefined, undefined, undefined, null]);
  assert.strictEqual(fs.existsSync(keys), false, 'the sign-in key and its folder are gone');
  assert.deepStrictEqual(es.get(id).steps.map((s) => [s.open, s.done]), [[true, true], [true, false], [false, false]], 'step 1 stays done; step 2 is the install command');
  assert.deepStrictEqual(es.repairTemplateOne(), { changed: 0, named: [] }, 'once');
  es.remove(id);
};

// the page draws step 2 with a button in a row of its own each time, and never a code it was not just given
module.exports.theComputeTabDrawsStepTwo = function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
  const fn = src.slice(src.indexOf('function esInstallHtml('), src.indexOf('function esSetupHtml('));
  assert.ok(/'<div class="row" style="margin-top:\.6rem"><button id="esInstallMake"/.test(fn), 'Make the install command has a row of its own');
  assert.ok(/'Make a new install command' : 'Make the install command'/.test(fn), 'the button says whether a command is already out');
  assert.ok(/<div class="row" style="margin-top:\.3rem"><button id="esCmdCopy">Copy the command<\/button>/.test(fn), 'Copy the command has a row of its own');
  assert.ok(/<textarea id="esCmd" readonly/.test(fn), 'the command, to copy');
  assert.ok(/it is not shown again after this page is reloaded/.test(fn), 'the page says the code is shown once');
  assert.ok(/<input type="checkbox" disabled' \+ \(e \? ' checked' : ''\) \+ '> ' \+ esc\(c\.label\)/.test(fn) && /ticked by this system when the engine calls in/.test(fn), 'the check is ticked by the system, not the owner');
  assert.ok(!/privateKey|THE-PRIVATE|authorized_keys|esKeyMake|esSignIn/.test(src), 'nothing on the page makes, takes or shows a key that signs in to a machine');
  // the command: one per system, this system's own address, the short name and the code
  const cmdFn = new Function('PUBLIC_BASE', `${src.slice(src.indexOf('function esCommandFor('), src.indexOf('const hhmm ='))}; return esCommandFor;`)('https://www.example.test/uts/');
  assert.strictEqual(cmdFn('linux', 'cdmx-engine', 'UTS-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'), "curl -fsSL 'https://www.example.test/uts/engine-link/install/linux.sh' | sudo sh -s -- 'https://www.example.test/uts/' 'cdmx-engine' 'UTS-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF'");
  assert.ok(/install\/mac\.sh' \| sudo sh -s --/.test(cmdFn('mac', 'x2', 'UTS-A')), 'Mac');
  assert.strictEqual(cmdFn('windows', 'x2', 'UTS-A'), "& ([scriptblock]::Create((irm 'https://www.example.test/uts/engine-link/install/windows.ps1'))) 'https://www.example.test/uts/' 'x2' 'UTS-A'");
  // a rented server is Linux; this computer is the system chosen in step 1
  const sysFn = new Function(`${src.slice(src.indexOf('function esSystemOf('), src.indexOf('function esCommandFor('))}; return esSystemOf;`)();
  assert.deepStrictEqual([sysFn({ choices: { where: 'server' } }), sysFn({ choices: { where: 'local', os: 'mac' } }), sysFn({ choices: {} })], ['linux', 'mac', null]);
  const cur = src.slice(src.indexOf('function esCurrentHtml('), src.indexOf('function esSetupHtml('));
  assert.ok(/make a new install command in step 2 and run it on the machine/.test(cur), 'step 3 says how to bring the engine forward');
};

// THE INSTALL SCRIPTS: what each installs, where, and that each checks the package before it installs anything
module.exports.theInstallScriptsCheckThePackageAndOpenNothing = function () {
  const dir = path.join(__dirname, '..', 'engine', 'install');
  const linux = fs.readFileSync(path.join(dir, 'linux.sh'), 'utf8');
  const mac = fs.readFileSync(path.join(dir, 'mac.sh'), 'utf8');
  const win = fs.readFileSync(path.join(dir, 'windows.ps1'), 'utf8');
  for (const [name, src] of [['linux', linux], ['mac', mac], ['windows', win]]) {
    assert.ok(/engine-link\/release/.test(src) && /engine-link\/package/.test(src), `${name}: the package and its fingerprint come from this system`);
    assert.ok(/the package did not match its fingerprint; nothing was installed/.test(src), `${name}: a package that does not match is not installed`);
    assert.ok(/UTS\(-\[A-Z0-9\]\{4\}\)\{6\}/.test(src), `${name}: the code is checked for its shape before anything is done`);
    assert.ok(!/authorized_keys|ssh-keygen|PasswordAuthentication|listen/i.test(src), `${name}: nothing is opened for anyone to come in`);
  }
  for (const w of ['ProtectHome=true', 'ProtectSystem=strict', 'NoNewPrivileges=true', 'MemoryMax=300M', 'CPUQuota=50%', 'ReadWritePaths=$DATA', 'useradd --system']) assert.ok(linux.includes(w), `linux: ${w}`);
  assert.ok(/install -d -o "\$ACCT" -g "\$ACCT" -m 700 "\$DATA"/.test(linux) && /chmod 600 "\$DATA\/config.json"/.test(linux), 'linux: the data folder and the settings are the engine account\'s alone');
  assert.ok(/rm -f "\$DATA\/link\.json"/.test(linux), 'linux: installed again with a new code, the engine calls in afresh');
  assert.ok(/<key>KeepAlive<\/key><true\/>/.test(mac) && /chmod 700 "\$DATA"/.test(mac), 'mac: kept running, its data its owner\'s alone');
  assert.ok(/icacls \$data \/inheritance:r/.test(win) && /-RestartCount 999/.test(win), 'windows: only SYSTEM and administrators read its data; restarted if it stops');
  // the package holds the engine and nothing of the install scripts or the tests
  const { unpack } = require('../engine/tar');
  const hub = require('../lib/live/enginehub');
  const p = hub.packageNow();
  const names = unpack(p.data).map((f) => f.name);
  assert.ok(names.includes('main.js') && names.includes('link.js') && names.includes('lock.js') && names.includes('VERSION.json'), names.join(', '));
  assert.ok(!names.some((n) => n.startsWith('install/')), 'the install scripts are served, not packed');
  assert.strictEqual(p.sha256, crypto.createHash('sha256').update(p.data).digest('hex'));
  assert.strictEqual(JSON.parse(unpack(p.data).find((f) => f.name === 'VERSION.json').data).release, RELEASE);
};
