// THE ENGINE CALLS OUT (3.266.0, owner 2026-09-25: "the engine connects out to
// our server and keeps that connection open. Plans go down it, and prices,
// orders and positions come back. Nothing ever connects in."). End to end, with
// the real programs: the web service, and an engine started the way the install
// command starts it -- with nothing but this system's address and a one-time code.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
function req(port, method, p, body = null, headers = {}) {
  return new Promise((resolve) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { json = null; } resolve({ status: res.statusCode, json }); });
    });
    r.on('error', (e) => resolve({ status: 0, json: null, why: e.message }));
    if (data) r.write(data);
    r.end();
  });
}
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(250);
  }
}

module.exports = {
  // THE WHOLE ROAD: an install code made on the service; the engine started with
  // it calls in, is given its own token, opens its link, and answers over it --
  // and the web service holds nothing that opens the engine's machine
  async anEngineStartedWithItsCodeCallsInAndAnswersOverItsLink() {
    const web = tmp('co-web-');
    const eng = tmp('co-eng-');
    const port = await freePort();
    const env = { ...process.env, PORT: String(port), GC_TARGETS_FILE: path.join(web, 'targets.json'), GC_ENGINE_MIRROR: path.join(web, 'mirror'), GC_ENGINE_SETUPS_DIR: path.join(web, 'es'), GC_NO_ENGINE_PRODUCE: '1' };
    const server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
    let engine = null;
    try {
      assert.ok(await until(async () => (await req(port, 'GET', '/api/live/engine-setups')).status === 200), 'the web service is up');
      const made = await req(port, 'POST', '/api/live/engine-setups', { name: 'CDMX engine', shortName: 'cdmx-engine' });
      const id = made.json.setup.id;
      await req(port, 'POST', `/api/live/engine-setups/${id}/choice`, { step: 'ready', choice: 'where', value: 'server' });
      await req(port, 'POST', `/api/live/engine-setups/${id}/choice`, { step: 'ready', choice: 'os', value: 'linux' });
      for (const t of ['binance', 'on', 'size']) await req(port, 'POST', `/api/live/engine-setups/${id}/tick`, { step: 'ready', tick: t, on: true });
      const code = (await req(port, 'POST', `/api/live/engine-setups/${id}/install`, {})).json.code;
      assert.ok(/^UTS-/.test(code), code);
      // the engine, as the installer leaves it: an address and a code, nothing else
      fs.writeFileSync(path.join(eng, 'config.json'), JSON.stringify({ link: { url: `http://127.0.0.1:${port}/`, code } }));
      engine = spawn(process.execPath, ['engine/main.js'], { cwd: ROOT, env: { ...process.env, ENGINE_DATA: eng }, stdio: 'ignore' });
      const linked = await until(async () => {
        const r = await req(port, 'GET', '/api/live/engines');
        const e = r.json && (r.json.engines || []).find((x) => x.id === 'cdmx-engine');
        return e && e.link && e.link.following && e.answers ? e : null;
      });
      assert.ok(linked, 'the engine called in and answers over its link');
      // (run from the repository the engine has no VERSION.json; the package the installer fetches carries one -- tested beside the install scripts)
      assert.deepStrictEqual([linked.health.realOrders, linked.health.link.linked], ['off', true]);
      // what each side keeps
      const lock = JSON.parse(fs.readFileSync(path.join(eng, 'lock.json'), 'utf8'));
      const tok = JSON.parse(fs.readFileSync(path.join(eng, 'link.json'), 'utf8'));
      assert.strictEqual(fs.statSync(path.join(eng, 'link.json')).mode & 0o777, 0o600, 'the engine\'s password is its own account\'s alone');
      assert.strictEqual(linked.lock.fingerprint, require('../engine/lock').fingerprintOf(lock.publicKey), 'the web service shows the engine\'s own lock');
      const stored = fs.readFileSync(env.GC_TARGETS_FILE, 'utf8');
      assert.ok(!stored.includes(tok.token) && stored.includes(crypto.createHash('sha256').update(tok.token).digest('hex')), 'the web service keeps the password\'s fingerprint, never the password');
      assert.ok(!stored.includes(lock.privateKey) && !JSON.stringify(linked).includes(lock.privateKey), 'the lock\'s private half never leaves the engine');
      assert.ok(!JSON.stringify(linked).includes('tokenHash'), 'the screens are not told even the fingerprint');
      // the checklist's step 2 is ticked by the engine's call
      const es = (await req(port, 'GET', '/api/live/engine-setups')).json.setups.find((x) => x.id === id);
      // step 3 is done by the code, not the number: run from the repository the engine says no release,
      // and its code is the very code this system serves
      assert.deepStrictEqual(es.steps.map((s) => s.done), [true, true, true]);
      assert.strictEqual(linked.health.code, require('../lib/live/enginehub').packageNow().code, 'the engine\'s code fingerprint is the package\'s');
      // the Account tab's question goes over the link: the keys (none yet) and the lock to lock them with
      const acct = await req(port, 'GET', '/api/account/trading');
      assert.deepStrictEqual([acct.json.keys['cdmx-engine'].answers, acct.json.keys['cdmx-engine'].lock.publicKey], [true, lock.publicKey]);
      // THE RECORD COMES BACK OVER THE LINK: the engine's lines reach the web service's copy
      const mirrored = await until(async () => { try { return fs.readFileSync(path.join(env.GC_ENGINE_MIRROR, 'cdmx-engine', 'raw.jsonl'), 'utf8').includes('"type":"start"'); } catch (_) { return false; } });
      assert.ok(mirrored, 'the engine\'s record arrives in the web service\'s copy');
      // A WRONG PASSWORD IS REFUSED AT THE DOOR, and nothing but the link answers there
      const wrong = await new Promise((resolve) => {
        const r = http.request({ host: '127.0.0.1', port, path: '/engine-link/ws', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13', Authorization: 'Bearer not-the-password-at-all-xxxxxxxx' } });
        r.on('response', (res) => resolve(res.statusCode));
        r.on('upgrade', () => resolve(101));
        r.on('error', () => resolve(0));
        r.end();
      });
      assert.strictEqual(wrong, 401);
      const relay = await req(port, 'POST', '/engine-link/relay/cdmx-engine', { method: 'GET', path: '/health' }, { 'X-UTS-Relay': 'guess', 'X-Real-IP': '203.0.113.9' });
      assert.strictEqual(relay.status, 404, 'the relay does not answer anyone from outside');
      const used = await req(port, 'POST', '/engine-link/enroll', { code });
      assert.deepStrictEqual([used.status, /used already/.test(used.json.error)], [403, true], 'a code works once');
      // the package and its fingerprint, as the installers fetch them
      const rel = await req(port, 'GET', '/engine-link/release');
      assert.deepStrictEqual([rel.status, rel.json.release, /^[0-9a-f]{64}$/.test(rel.json.sha256)], [200, require('../package.json').version, true]);
    } finally {
      if (engine) engine.kill();
      server.kill();
      await sleep(300);
      fs.rmSync(web, { recursive: true, force: true });
      fs.rmSync(eng, { recursive: true, force: true });
    }
  },

  // AN ENGINE CALLS OUT, AND ONLY THAT (3.267.0): with no web server to call it
  // does not start -- it refuses before it opens or writes anything, and it
  // never listens for anyone instead
  async anEngineWithNoWebServerToCallRefusesToStart() {
    const eng = tmp('co-none-');
    try {
      fs.writeFileSync(path.join(eng, 'config.json'), JSON.stringify({ liveEnabled: false }));
      const out = await new Promise((resolve) => {
        execFile(process.execPath, ['engine/main.js'], { cwd: ROOT, env: { ...process.env, ENGINE_DATA: eng }, timeout: 15000 }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stderr: String(stderr) }));
      });
      assert.strictEqual(out.code, 2, JSON.stringify(out));
      assert.ok(/names no web server to call: install the platform with an install command made on the Compute tab/.test(out.stderr), out.stderr);
      assert.deepStrictEqual(fs.readdirSync(eng), ['config.json'], 'nothing opened or written: no record, no lock, no key store');
    } finally { fs.rmSync(eng, { recursive: true, force: true }); }
  },

  // A CHILD OF THE WEB SERVICE -- the decisions run in one of their own -- asks an
  // engine that calls out through its parent, with the secret it was started with
  async aChildOfTheServiceReachesAnEngineThroughItsParent() {
    const hub = require('../lib/live/enginehub');
    const targets = require('../lib/live/targets');
    const dir = tmp('co-relay-');
    process.env.GC_TARGETS_FILE = path.join(dir, 'targets.json');
    process.env.GC_ENGINE_MIRROR = path.join(dir, 'mirror');
    const token = crypto.randomBytes(32).toString('base64url');
    targets.saveCallingEngine({ id: 'relay-engine', name: 'Relay engine', tokenHash: crypto.createHash('sha256').update(token).digest('hex') });
    // the hub takes links on the one listener it is attached to, once per process: the run's shared one
    const { port } = await require('./engine-linked').hubListener();
    require('../lib/live/enginelink').followAll(targets.listEngines());
    // a stand-in engine: the real link, answering one question
    const { Link } = require('../engine/link');
    const { EventEmitter } = require('events');
    const journal = Object.assign(new EventEmitter(), { n: 0, since: () => [] });
    const edir = tmp('co-relay-eng-');
    fs.writeFileSync(path.join(edir, 'link.json'), JSON.stringify({ engineId: 'relay-engine', token }));
    const lk = new Link({ url: `http://127.0.0.1:${port}/`, dataDir: edir, handle: async (m, p) => ({ status: 200, json: { asked: `${m} ${p}` } }), journal, health: () => ({ ok: true }) });
    try {
      await lk.start();
      assert.ok(await until(async () => hub.status('relay-engine').linked && (await hub.call('relay-engine', 'GET', '/health')).ok), 'linked');
      const inProcess = await hub.call('relay-engine', 'GET', '/state');
      assert.deepStrictEqual(inProcess.json, { asked: 'GET /state' });
      const child = await new Promise((resolve) => {
        execFile(process.execPath, ['-e', "require('./lib/live/enginelink').call({ id: 'relay-engine', link: 'calls-out' }, 'POST', '/plans', { a: 1 }, 5000).then((r) => console.log(JSON.stringify(r)))"], { cwd: ROOT, env: { ...process.env } }, (err, out) => resolve(err ? { error: err.message } : JSON.parse(out)));
      });
      assert.deepStrictEqual([child.ok, child.json], [true, { asked: 'POST /plans' }], JSON.stringify(child));
      // without the secret the child is refused: the relay answers this service's own children only
      const outsider = await new Promise((resolve) => {
        execFile(process.execPath, ['-e', "require('./lib/live/enginelink').call({ id: 'relay-engine', link: 'calls-out' }, 'GET', '/health', null, 3000).then((r) => console.log(JSON.stringify(r)))"], { cwd: ROOT, env: { ...process.env, GC_ENGINE_RELAY: JSON.stringify({ port, secret: 'wrong' }) } }, (err, out) => resolve(err ? { error: err.message } : JSON.parse(out)));
      });
      assert.strictEqual(outsider.ok, false);
    } finally {
      lk.stop();
      require('../lib/live/enginelink').followAll([]);
      targets.deleteEngine('relay-engine', []);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(edir, { recursive: true, force: true });
    }
  },
};
