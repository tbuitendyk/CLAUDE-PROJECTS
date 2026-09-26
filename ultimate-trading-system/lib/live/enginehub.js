'use strict';
// lib/live/enginehub.js -- WHERE THE ENGINES THAT CALL OUT CALL IN (owner,
// 2026-09-25: "the engine connects out to our server and keeps that connection
// open. Plans go down it, and prices, orders and positions come back. Nothing
// ever connects in.")
//
// Everything here is under engine-link/, which the web server's front door
// passes through without the site's shared password: an engine proves itself
// with its own token (or, the first time, with its one-time install code), and
// nothing else under engine-link/ answers anyone.
//
//   GET  engine-link/ws            the link: a websocket, the token in its
//                                  Authorization header (checked against the
//                                  fingerprint in the engine's record)
//   POST engine-link/enroll        the first call: { code, lock, release, machine }
//                                  -> { engineId, name, token }
//   GET  engine-link/release       the release this system runs, and its package's SHA-256
//   GET  engine-link/package       the engine's program, as one gzipped tar
//   GET  engine-link/install/:file the install scripts (linux.sh, mac.sh, windows.ps1)
//   POST engine-link/relay/:id     for this service's own children only (the
//                                  decisions run in a child of their own): a
//                                  question passed to an engine over its link.
//                                  Refused unless it carries this process's own
//                                  secret and did not come through the front door.
//
// The messages on the link are in engine/link.js. Nothing that goes down the link
// is ever run as code on the engine: a request is one of the fixed questions in
// engine/api.js, answered or refused.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const ws = require('./wsserver');

const ENGINE_DIR = path.join(__dirname, '..', '..', 'engine');
const RELEASE = () => require('../../package.json').version;
const PING_MS = 25000;
const QUIET_MS = 75000;

const conns = new Map();      // engineId -> { conn, since, hello, lastAt, pending }
const watchers = new Map();   // engineId -> the mirror that keeps this engine's record here
let attached = false;
const RELAY_SECRET = crypto.randomBytes(32).toString('hex');
let seq = 0;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const sameHex = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ---- THE PACKAGE --------------------------------------------------------------
let pkg = null;
function packageNow() {
  const release = RELEASE();
  if (pkg && pkg.release === release) return pkg;
  const { pack, filesUnder, codeFingerprint, ENGINE_CODE } = require('../../engine/tar');
  const files = filesUnder(ENGINE_DIR, ENGINE_CODE);
  const code = codeFingerprint(files);
  files.push({ name: 'VERSION.json', data: JSON.stringify({ release, commit: null }) });
  const data = pack(files);
  pkg = { release, code, data, sha256: crypto.createHash('sha256').update(data).digest('hex'), bytes: data.length };
  return pkg;
}

// ---- THE LINK -------------------------------------------------------------------
function engineByToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  const h = sha256(token);
  return require('./targets').listEngines().find((t) => t.link === 'calls-out' && sameHex(t.tokenHash, h)) || null;
}

function status(engineId) {
  const c = conns.get(engineId);
  if (!c) return { linked: false, since: null, lastAt: null, why: 'the engine has not called in since this service started' };
  return { linked: true, since: c.since, lastAt: new Date(c.lastAt).toISOString(), release: c.hello ? c.hello.release : null, why: null };
}

function onUpgrade(req, socket, head) {
  const u = new URL(req.url, 'http://x');
  if (u.pathname !== '/engine-link/ws') { ws.refuse(socket, 404, 'no such address'); return; }
  const m = /^Bearer\s+(\S+)$/.exec(String(req.headers.authorization || ''));
  const eng = m ? engineByToken(m[1]) : null;
  if (!eng) { ws.refuse(socket, 401, 'this system does not know that engine\'s password: install the engine again with a new install command'); return; }
  const conn = ws.accept(req, socket, head);
  if (!conn) return;
  const id = eng.id;
  const was = conns.get(id);
  if (was) was.conn.close(4000);   // the newest link wins; an old one left open is closed
  const me = { conn, since: new Date().toISOString(), hello: null, lastAt: Date.now(), pending: new Map() };
  conns.set(id, me);
  const quiet = setInterval(() => {
    if (Date.now() - conn.lastAt > QUIET_MS) conn.close(4001);
    else conn.ping();
  }, PING_MS);
  quiet.unref();
  const helloWait = setTimeout(() => { if (!me.hello) conn.close(4002); }, 15000);
  helloWait.unref();
  conn.on('message', (text) => {
    me.lastAt = Date.now();
    let msg;
    try { msg = JSON.parse(text); } catch (_) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    const w = watchers.get(id);
    if (msg.t === 'hello') {
      me.hello = { release: typeof msg.release === 'string' && /^[0-9][0-9A-Za-z.-]{0,40}$/.test(msg.release) ? msg.release : null, journalN: Number(msg.journalN) || 0 };
      clearTimeout(helloWait);
      const es = require('./enginesetup');
      const lock = es.lockOf(msg.lock);
      require('./targets').noteEngine(id, { release: me.hello.release, code: typeof msg.code === 'string' && /^[0-9a-f]{16}$/.test(msg.code) ? msg.code : null, lastSeenUtc: new Date().toISOString(), ...(lock ? { lock } : {}), ...(msg.machine ? { machine: { platform: String(msg.machine.platform || '').slice(0, 20), arch: String(msg.machine.arch || '').slice(0, 20), hostname: String(msg.machine.hostname || '').slice(0, 80), node: String(msg.machine.node || '').slice(0, 20) } } : {}) });
      if (w && typeof w.hello === 'function') w.hello(msg);
      conn.send(JSON.stringify({ t: 'welcome', since: w ? w.n : 0, release: RELEASE() }));
      return;
    }
    if (msg.t === 'answer' && typeof msg.id === 'string') {
      const p = me.pending.get(msg.id);
      if (p) { me.pending.delete(msg.id); clearTimeout(p.timer); p.resolve({ ok: msg.status >= 200 && msg.status < 300, status: msg.status, json: msg.json, ms: Date.now() - p.started }); }
      return;
    }
    if (!w) return;
    if (msg.t === 'records' && Array.isArray(msg.recs)) w.takeFromLink(msg.recs);
    else if (msg.t === 'mark' && msg.mark && msg.mark.planId) w.marks.set(msg.mark.planId, msg.mark);
    else if (msg.t === 'beat' && msg.health) w.lastHealth = { at: new Date().toISOString(), health: msg.health };
  });
  conn.on('close', () => {
    clearInterval(quiet);
    clearTimeout(helloWait);
    for (const p of me.pending.values()) { clearTimeout(p.timer); p.resolve({ ok: false, status: 0, why: 'the link to the engine closed before it answered', ms: Date.now() - p.started }); }
    me.pending.clear();
    if (conns.get(id) === me) conns.delete(id);
    try { require('./targets').noteEngine(id, { lastSeenUtc: new Date().toISOString() }); } catch (_) { /* the record may be gone */ }
  });
}

// a question to an engine over its link, answered as the tunnel answers
function call(engineId, method, p, body = null, timeoutMs = 4000) {
  if (!attached) return relay(engineId, method, p, body, timeoutMs);
  const c = conns.get(engineId);
  if (!c || !c.conn.open || !c.hello) return Promise.resolve({ ok: false, status: 0, why: 'the engine is not linked to this system right now: it calls in by itself when it runs', ms: 0 });
  return new Promise((resolve) => {
    seq += 1;
    const id = `q${Date.now().toString(36)}${seq}`;
    const started = Date.now();
    const timer = setTimeout(() => { c.pending.delete(id); resolve({ ok: false, status: 0, why: `the engine sent nothing for ${timeoutMs / 1000} seconds`, ms: Date.now() - started }); }, timeoutMs);
    timer.unref();
    c.pending.set(id, { resolve, timer, started });
    c.conn.send(JSON.stringify({ t: 'request', id, method, path: p, body }));
  });
}

// the same question from a child of this service, passed through its parent
function relay(engineId, method, p, body, timeoutMs) {
  let r;
  try { r = JSON.parse(process.env.GC_ENGINE_RELAY || 'null'); } catch (_) { r = null; }
  if (!r || !r.port || !r.secret) return Promise.resolve({ ok: false, status: 0, why: 'no link to the engine from here', ms: 0 });
  const data = JSON.stringify({ method, path: p, body, timeoutMs });
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: r.port, method: 'POST', path: `/engine-link/relay/${encodeURIComponent(engineId)}`, timeout: timeoutMs + 3000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'X-UTS-Relay': r.secret } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) { resolve({ ok: false, status: 0, why: 'the relay refused the question', ms: 0 }); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { resolve({ ok: false, status: 0, why: 'the relay answered in a way that could not be read', ms: 0 }); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('the relay did not answer')));
    req.on('error', (e) => resolve({ ok: false, status: 0, why: e.message, ms: 0 }));
    req.write(data);
    req.end();
  });
}

function watch(engineId, mirror) { watchers.set(engineId, mirror); }
function unwatch(engineId) { watchers.delete(engineId); const c = conns.get(engineId); if (c) c.conn.close(4003); }

// ---- THE FIRST CALL, and not too many wrong codes from one address ---------------
const tries = new Map();   // address -> { n, from }
function tooMany(addr, now = Date.now()) {
  const t = tries.get(addr) || { n: 0, from: now };
  if (now - t.from > 3600000) { t.n = 0; t.from = now; }
  return t.n >= 30;
}
function tried(addr, now = Date.now()) {
  const t = tries.get(addr) || { n: 0, from: now };
  if (now - t.from > 3600000) { t.n = 0; t.from = now; }
  t.n += 1;
  tries.set(addr, t);
}

function installRoutes(app, express) {
  const small = express.json({ limit: '32kb' });
  app.post('/engine-link/enroll', small, (req, res) => {
    const addr = String(req.headers['x-real-ip'] || req.socket.remoteAddress || '');
    if (tooMany(addr)) return res.status(429).json({ error: 'too many install codes tried from this address in the last hour' });
    try {
      const b = req.body || {};
      const out = require('./enginesetup').enroll(b.code, { lock: b.lock, release: b.release, machine: b.machine });
      // a different machine under the same short name: its record here starts afresh, the old one kept beside it
      if (out.again && !out.sameMachine) require('./enginelink').restartMirror(out.engineId);
      // moved from the tunnel: the same engine and the same record, now followed over its link
      if (out.moved) require('./enginelink').relink(out.engineId);
      require('./enginelink').followAll(require('./targets').listEngines());
      return res.json({ engineId: out.engineId, name: out.name, token: out.token });
    } catch (e) {
      tried(addr);
      return res.status(e.status || 500).json({ error: e.status ? e.message : 'the install code could not be taken' });
    }
  });
  app.get('/engine-link/release', (req, res) => {
    const p = packageNow();
    res.set('Cache-Control', 'no-store').json({ release: p.release, code: p.code, sha256: p.sha256, bytes: p.bytes });
  });
  app.get('/engine-link/package', (req, res) => {
    const p = packageNow();
    res.set({ 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="uts-engine-${p.release}.tgz"` }).send(p.data);
  });
  app.get('/engine-link/install/:file', (req, res) => {
    const file = String(req.params.file);
    if (!['linux.sh', 'mac.sh', 'windows.ps1'].includes(file)) return res.status(404).json({ error: 'no such install script' });
    res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).send(fs.readFileSync(path.join(ENGINE_DIR, 'install', file), 'utf8'));
  });
  app.post('/engine-link/relay/:id', express.json({ limit: '2mb' }), async (req, res) => {
    // this service's own children only: the secret they were started with, and never through the front door
    if (req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || !sameHex(String(req.headers['x-uts-relay'] || ''), RELAY_SECRET)) return res.status(404).json({ error: 'no such address' });
    const b = req.body || {};
    const out = await call(String(req.params.id), String(b.method || 'GET'), String(b.path || '/'), b.body == null ? null : b.body, Math.min(60000, Number(b.timeoutMs) || 4000));
    return res.json(out);
  });
}

// the link's websocket on this service's own listener, and the relay's address for its children
function attach(server, port) {
  if (attached) return;
  attached = true;
  server.on('upgrade', onUpgrade);
  process.env.GC_ENGINE_RELAY = JSON.stringify({ port, secret: RELAY_SECRET });
}

module.exports = { attach, installRoutes, call, status, watch, unwatch, packageNow, engineByToken, _conns: conns };
