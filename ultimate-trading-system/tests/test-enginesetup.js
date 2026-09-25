// SETTING UP A TRADING ENGINE, STEP BY STEP (3.263.0, owner 2026-09-25): the
// checklist on Setup > Compute, one per engine -- the template, where each
// checklist stands, what a locked step refuses, and the page that draws it.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.GC_ENGINE_SETUPS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-es-'));
process.env.GC_ENGINE_KEYS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-es-keys-'));
const es = require('../lib/live/enginesetup');
const refused = (fn, rx) => { let err = null; try { fn(); } catch (e) { err = e; } assert.ok(err && rx.test(err.message), `refused in words matching ${rx}: ${err && err.message}`); return err; };

module.exports = {
  // THE TEMPLATE: steps 1 and 2 written in full, steps 3 to 7 titles still being written
  theTemplateHasStepOneInFullAndTheRestStillBeingWritten() {
    const [first, ...rest] = es.TEMPLATE.steps;
    assert.strictEqual(first.title, 'Here\'s what you need to get your trading engine off the ground');
    assert.deepStrictEqual(first.choices.map((c) => [c.id, c.options.map((o) => o.label)]), [['where', ['a rented server', 'this computer']], ['os', ['Linux', 'Mac', 'Windows']]]);
    assert.deepStrictEqual(first.choices[1].when, { where: 'local' }, 'the operating system is asked for this computer');
    assert.deepStrictEqual(first.ticks.map((t) => t.label), ['My exchange serves me there, and I may use it there', 'It has a fixed public IP address', 'It will be on and online around the clock', 'It meets the size above']);
    assert.deepStrictEqual(rest.map((s) => [s.title, !!s.writing]), [['Let the system in', false], ['Check the machine', true], ['Install the engine', true], ['Link it to this system', true], ['Save the engine', true], ['Keep it current', true]]);
    // THE PLATFORM IS THE OWNER'S CHOICE (owner, 2026-09-25): Binance only ever as an example
    const all = JSON.stringify(es.TEMPLATE.steps.map((x) => [x.title, x.guidance, (x.ticks || []).map((t) => t.label), (x.choices || []).map((c) => [c.label, c.options])]));
    for (const m of all.match(/[^.]*Binance[^.]*/g) || []) assert.ok(/for example/.test(m), `Binance named only as an example: ${m}`);
    const words = JSON.stringify(first.guidance);
    for (const w of ['fixed public IP address', 'Elastic IP', 'Debian 12 or 13', 'Ubuntu 24.04', '300 MB', 'static one', 'Mac:', 'Windows:', 'Linux:']) assert.ok(words.includes(w), `step 1 says ${w}`);
  },

  // ONE PER ENGINE, and each step opens only when the one before it is done
  aChecklistOpensEachStepOnlyWhenTheOneBeforeIsDone() {
    const a = es.create('Mexico engine', 'mx-engine-2');
    assert.deepStrictEqual(a.steps.map((s) => [s.open, s.done]), [[true, false], [false, false], [false, false], [false, false], [false, false], [false, false], [false, false]]);
    refused(() => es.create(' mexico ENGINE ', 'other'), /already a setup for an engine called "Mexico engine" — one per engine/);
    refused(() => es.create('', 'other'), /^descriptive name: 1 to 60 characters$/);
    refused(() => es.create('Another', 'Not Short'), /^short name: 2 to 30 of a-z, 0-9 and -, starting with a letter or digit$/);
    refused(() => es.create('Another', 'mx-engine-2'), /short name: mx-engine-2 is already the short name of the setup for "Mexico engine"/);
    refused(() => es.create('Another', 'mx-1'), /mx-1 is the old order program/);
    refused(() => es.setTick(a.id, 'access', 'x', true), /^step 2 opens when step 1 is done$/);
    refused(() => es.setChoice(a.id, 'ready', 'os', 'mac'), /^its operating system is asked only when where it runs is this computer$/);
    refused(() => es.setChoice(a.id, 'ready', 'where', 'moon'), /one of a rented server, this computer/);
    refused(() => es.setTick(a.id, 'ready', 'nope', true), /has no tick nope/);
    es.setChoice(a.id, 'ready', 'where', 'local');
    assert.ok(es.get(a.id).steps[0].missing.includes('choose its operating system'), 'this computer asks its operating system');
    es.setChoice(a.id, 'ready', 'os', 'windows');
    for (const t of ['binance', 'ip', 'on']) es.setTick(a.id, 'ready', t, true);
    assert.deepStrictEqual(es.get(a.id).steps[0].missing, ['tick "It meets the size above"']);
    const done = es.setTick(a.id, 'ready', 'size', true);
    assert.deepStrictEqual(done.steps.slice(0, 3).map((s) => [s.open, s.done]), [[true, true], [true, false], [false, false]], 'step 1 done opens step 2; step 2 is still being written');
    assert.deepStrictEqual(done.steps[1].missing, ['choose how this system signs in', 'fill in the machine\'s address', 'fill in sign in as', 'press Try signing in, and sign in']);
    // changing where it runs clears the ticks and the operating system: they were about the other machine
    const moved = es.setChoice(a.id, 'ready', 'where', 'server');
    assert.deepStrictEqual([moved.choices, moved.ticks.ready], [{ where: 'server' }, {}]);
    assert.deepStrictEqual(moved.steps.map((s) => s.open), [true, false, false, false, false, false, false]);
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
  },
};

// THE ENGINE'S TWO NAMES (3.264.0): asked when a setup starts; a checklist
// started before they were asked for is given its short name on screen
module.exports.aChecklistCarriesTheEnginesTwoNames = function () {
  const dir = process.env.GC_ENGINE_SETUPS_DIR;
  const id = 'es-muhgabc1-a1b2c3';
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, name: 'CDMX UTS Trading Engine (AWS)', templateVersion: 1, createdUtc: '2026-09-25T20:55:00.000Z', updatedUtc: '2026-09-25T20:55:00.000Z', engineId: null, choices: {}, ticks: {} }));
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

// STEP 2 -- LET THE SYSTEM IN (3.265.0): a key this system makes or a key file
// it is given, the machine's address and account, and a sign-in the system
// ticks itself. The private half never leaves this machine's folder.
module.exports.stepTwoLetsTheSystemInWithAKeyAndASignIn = async function () {
  const calls = [];
  let sshAnswer = { code: 0, stdout: 'UTS-SIGNED-IN\nLinux x86_64\nadmin\n', stderr: '' };
  let yAnswer = { code: 0, stdout: 'ssh-ed25519 AAAAC3NzaFILE\n', stderr: '' };
  es._setRunner(async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'ssh-keygen' && args.includes('-t')) { const f = args[args.indexOf('-f') + 1]; fs.writeFileSync(f, 'THE-PRIVATE-HALF'); fs.writeFileSync(`${f}.pub`, 'ssh-ed25519 AAAAC3NzaMADE uts cdmx-engine\n'); return { code: 0, stdout: '', stderr: '' }; }
    if (cmd === 'ssh-keygen' && args.includes('-l')) return { code: 0, stdout: '256 SHA256:abcDEF123 uts (ED25519)\n', stderr: '' };
    if (cmd === 'ssh-keygen' && args.includes('-y')) return yAnswer;
    if (cmd === 'ssh') return sshAnswer;
    return { code: 1, stdout: '', stderr: 'unexpected' };
  });
  const a = es.create('CDMX engine', 'cdmx-engine');
  refused(() => es.setChoice(a.id, 'access', 'keyHow', 'made'), /^step 2 opens when step 1 is done$/);
  es.setChoice(a.id, 'ready', 'where', 'server');
  for (const t of ['binance', 'ip', 'on', 'size']) es.setTick(a.id, 'ready', t, true);
  es.setChoice(a.id, 'access', 'keyHow', 'made');
  // with a key this system makes: the public half and a fingerprint, never the private half
  const made = await es.makeKey(a.id);
  assert.deepStrictEqual([made.key.how, made.key.publicKey, made.key.fingerprint], ['made', 'ssh-ed25519 AAAAC3NzaMADE uts cdmx-engine', 'SHA256:abcDEF123']);
  assert.ok(!JSON.stringify(es.list()).includes('THE-PRIVATE-HALF'), 'the private half is never in a record or an answer');
  const dir = path.join(process.env.GC_ENGINE_KEYS_DIR, a.id);
  assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700, 'the key folder is this service\'s alone');
  // the address and the account, each checked
  refused(() => es.setField(a.id, 'access', 'host', 'not a host!'), /the machine's address: a name like/);
  refused(() => es.setField(a.id, 'access', 'user', 'Root User'), /sign in as: the account's name/);
  es.setField(a.id, 'access', 'host', 'ec2-203-0-113-7.compute.amazonaws.com');
  es.setField(a.id, 'access', 'user', 'admin');
  // the sign-in: the machine's own ssh, never asking, accepting a new machine's identity once
  let r = await es.signIn(a.id);
  const ssh = calls.filter((c) => c[0] === 'ssh').pop();
  for (const o of ['BatchMode=yes', 'IdentitiesOnly=yes', 'StrictHostKeyChecking=accept-new', `UserKnownHostsFile=${path.join(dir, 'known_hosts')}`]) assert.ok(ssh.includes(o), `signs in with ${o}`);
  assert.ok(ssh.includes('admin@ec2-203-0-113-7.compute.amazonaws.com') && ssh.includes(path.join(dir, 'key')));
  assert.deepStrictEqual([r.checks.access.signedIn.ok, r.checks.access.signedIn.said], [true, 'signed in as admin on ec2-203-0-113-7.compute.amazonaws.com: Linux x86_64']);
  assert.deepStrictEqual(r.steps.slice(1, 3).map((x) => [x.open, x.done]), [[true, true], [true, false]], 'signed in: step 2 done, step 3 opens');
  // a changed address asks for a new sign-in
  r = es.setField(a.id, 'access', 'host', '203.0.113.7');
  assert.strictEqual(r.steps[1].done, false);
  sshAnswer = { code: 255, stdout: '', stderr: 'admin@203.0.113.7: Permission denied (publickey).\n' };
  r = await es.signIn(a.id);
  assert.deepStrictEqual([r.checks.access.signedIn.ok, r.checks.access.signedIn.why], [false, 'the machine refused the key: add the public half to ~/.ssh/authorized_keys of admin on it']);
  // the other way: a key file the owner has -- a key it is, and no passphrase
  r = es.setChoice(a.id, 'access', 'keyHow', 'file');
  assert.deepStrictEqual([r.key, fs.existsSync(path.join(dir, 'key'))], [undefined, false], 'a different way of signing in drops the key made the other way');
  assert.strictEqual((r.checks || {}).access, undefined, 'and the sign-in made with it');
  await (async () => { let err = null; try { await es.saveKeyFile(a.id, 'hello'); } catch (e) { err = e; } assert.ok(err && /not a private key file/.test(err.message)); })();
  yAnswer = { code: 1, stdout: '', stderr: 'Load key: incorrect passphrase supplied to decrypt private key' };
  await (async () => { let err = null; try { await es.saveKeyFile(a.id, '-----BEGIN OPENSSH PRIVATE KEY-----\nLOCKED\n-----END OPENSSH PRIVATE KEY-----'); } catch (e) { err = e; } assert.ok(err && /locked with a passphrase/.test(err.message), err && err.message); })();
  assert.strictEqual(fs.existsSync(path.join(dir, 'key')), false, 'a key file that cannot be used is not kept');
  yAnswer = { code: 0, stdout: 'ssh-ed25519 AAAAC3NzaFILE\n', stderr: '' };
  r = await es.saveKeyFile(a.id, '-----BEGIN OPENSSH PRIVATE KEY-----\nGOOD\n-----END OPENSSH PRIVATE KEY-----');
  assert.deepStrictEqual([r.key.how, r.key.publicKey, fs.statSync(path.join(dir, 'key')).mode & 0o777], ['file', 'ssh-ed25519 AAAAC3NzaFILE', 0o600]);
  assert.ok(!JSON.stringify(es.list()).includes('GOOD'), 'the key file is never in a record or an answer');
  // a sign-in was about one machine: moving where it runs takes it away
  await es.saveKeyFile(a.id, '-----BEGIN OPENSSH PRIVATE KEY-----\nGOOD\n-----END OPENSSH PRIVATE KEY-----');
  sshAnswer = { code: 0, stdout: 'UTS-SIGNED-IN\nLinux x86_64\nadmin\n', stderr: '' };
  assert.strictEqual((await es.signIn(a.id)).steps[1].done, true);
  r = es.setChoice(a.id, 'ready', 'where', 'local');
  assert.strictEqual((r.checks || {}).access, undefined, 'moving where it runs drops the sign-in in step 2');
  // each clearing choice says what it clears, in its own words
  const notes = es.TEMPLATE.steps.flatMap((x) => (x.choices || []).filter((c) => c.clears).map((c) => [c.id, c.clearsNote]));
  assert.deepStrictEqual(notes, [['where', 'changing this clears the ticks below, and any sign-in in step 2: they were about the other machine'], ['keyHow', 'changing this throws away the key and the sign-in made the other way']]);
  // deleting the checklist deletes its key
  es.remove(a.id);
  assert.strictEqual(fs.existsSync(dir), false);
};

// the sign-in's refusals, in words
module.exports.aFailedSignInSaysWhyInWords = function () {
  const w = (stderr, extra = {}) => es.signInWords({ code: 255, stdout: '', stderr, ...extra }, 'admin');
  assert.strictEqual(w('ssh: Could not resolve hostname nope: Name or service not known'), 'no machine answers to that address');
  assert.strictEqual(w('ssh: connect to host 203.0.113.7 port 22: Connection timed out'), 'the machine did not answer on port 22: is it running, and does its firewall let SSH in from this system?');
  assert.strictEqual(w('ssh: connect to host 203.0.113.7 port 22: Connection refused'), 'the machine refused the connection on port 22: its SSH server is not running');
  assert.ok(/its identity has changed\. Nothing was sent to it$/.test(w('Host key verification failed.')));
  assert.strictEqual(w('', { killed: true }), 'the machine did not answer within 25 seconds');
};

// the page draws step 2 with a button in a row of its own each time
module.exports.theComputeTabDrawsStepTwo = function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'setup.html'), 'utf8');
  const fn = src.slice(src.indexOf('function esAccessHtml('), src.indexOf('function esSetupHtml('));
  assert.ok(/<div class="row" style="margin-top:\.6rem"><button id="esKeyMake">Make this engine\\'s key<\/button><\/div>/.test(fn), 'Make this engine\'s key');
  assert.ok(/<textarea id="esPub" readonly/.test(fn) && /Copy the public half/.test(fn), 'the public half, to copy');
  assert.ok(/<div class="row" style="margin-top:\.3rem"><button id="esKeySave">Save the key file<\/button><\/div>/.test(fn), 'Save the key file');
  assert.ok(/<button id="esSignIn"/.test(fn) && /Try signing in<\/button>/.test(fn), 'Try signing in');
  assert.ok(/<input type="checkbox" disabled/.test(fn) && /ticked by this system when it signs in/.test(fn), 'the sign-in is ticked by the system, not the owner');
  assert.ok(!/privateKey|THE-PRIVATE/.test(fn), 'nothing on the page can show a private half');
  const setupFn = src.slice(src.indexOf('function esSetupHtml('), src.indexOf('function esHtml('));
  assert.ok(/c\.clearsNote && ch\[c\.id\] \? '<span class="note">' \+ esc\(c\.clearsNote\)/.test(setupFn), 'a clearing choice shows its own note, not step 1\'s');
  assert.ok(!/they were about the other machine/.test(setupFn), 'no note is fixed in the page');
};
