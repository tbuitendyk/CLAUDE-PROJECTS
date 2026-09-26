'use strict';
// engine/link.js -- THE ENGINE CALLS OUT (owner, 2026-09-25: "the engine
// connects out to our server and keeps that connection open. Plans go down it,
// and prices, orders and positions come back. Nothing ever connects in.")
//
// Works from a rented server and from a computer at home alike: a connection
// going OUT needs no open port, no fixed address and no key on the web server
// that opens this machine.
//
// 1. THE FIRST START turns the one-time code from the install command into this
//    engine's own token (POST engine-link/enroll). The web server keeps only a
//    fingerprint of the token, never the token; this machine keeps the token in
//    link.json, readable by the engine's user alone. The engine's lock (its
//    public half) goes with it, so the Account tab can lock keys for it.
// 2. THE LINK is a websocket to engine-link/ws, the token in its header. Over it:
//      engine -> server: hello (release, lock, where its record stands), the
//                        record's lines from where the server's copy ends, then
//                        every new line as it is written, the live figures of
//                        open positions, a beat every ten seconds, and the
//                        answer to each request;
//      server -> engine: welcome (where its copy of the record ends, and the
//                        release the web server runs, so a screen can say when
//                        this engine is behind), and requests (the same
//                        questions the loopback listener answers -- engine/api.js).
//    A dropped link is opened again, waiting a little longer each time.
//    Nothing that arrives over the link is ever run as code: a request is one of
//    the fixed questions in engine/api.js, answered or refused.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('./net');
const { WebSocketClient } = require('./ws');

const BEAT_MS = 10000;
const MARKS_MS = 1000;

const withSlash = (u) => (u.endsWith('/') ? u : `${u}/`);

class Link {
  constructor({ url, code = null, dataDir, handle, journal, health, lock = null, version = {}, request = net.request, Socket = WebSocketClient }) {
    this.base = withSlash(String(url));
    this.code = code;
    this.dataDir = dataDir;
    this.handle = handle;
    this.journal = journal;
    this.health = health;
    this.lock = lock;
    this.version = version;
    this.request = request;
    this.Socket = Socket;
    this.tokenFile = path.join(dataDir, 'link.json');
    this.statusFile = path.join(dataDir, 'link-status.json');
    this.ws = null;
    this.live = false;
    this.failures = 0;
    this.stopped = false;
    this.marks = new Map();
    this.state = { linked: false, engineId: null, name: null, since: null, why: 'not started', serverRelease: null };
    this.timers = [];
    journal.on('record', (rec) => { if (this.live) this.send({ t: 'records', recs: [rec] }); });
    journal.on('mark', (m) => { if (this.live && m && m.planId) this.marks.set(m.planId, m); });
  }

  status() { return { ...this.state, url: this.base }; }

  // what the installer reads to say whether the engine linked
  note(patch) {
    this.state = { ...this.state, ...patch, at: new Date().toISOString() };
    try {
      const t = `${this.statusFile}.tmp`;
      fs.writeFileSync(t, JSON.stringify({ ...this.state, lock: this.lock ? this.lock.info().fingerprint : null }), { mode: 0o600 });
      fs.renameSync(t, this.statusFile);
    } catch (_) { /* the status file is for the installer's eyes; the record holds the rest */ }
  }

  token() {
    try { const j = JSON.parse(fs.readFileSync(this.tokenFile, 'utf8')); return j && j.token ? j : null; } catch (_) { return null; }
  }

  // THE FIRST START: the one-time code becomes this engine's own token
  async enroll() {
    if (this.token()) return this.token();
    if (!this.code) throw new Error('this engine has no token and no install code: install it again with a new install command');
    const body = JSON.stringify({
      code: this.code,
      lock: this.lock ? { publicKey: this.lock.info().publicKey } : null,
      release: this.version.release || null,
      machine: { platform: process.platform, arch: process.arch, hostname: os.hostname().slice(0, 80), node: process.version },
    });
    const r = await this.request('POST', `${this.base}engine-link/enroll`, { headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, body, timeoutMs: 20000 });
    if (r.status !== 200 || !r.json || !r.json.token || !r.json.engineId) {
      const why = (r.json && r.json.error) || r.text || `the web server answered ${r.status}`;
      const e = new Error(`the install code was not taken: ${why}`);
      e.final = r.status >= 400 && r.status < 500;
      throw e;
    }
    const rec = { engineId: r.json.engineId, name: r.json.name || null, token: r.json.token, enrolledAt: new Date().toISOString() };
    const t = `${this.tokenFile}.tmp`;
    fs.writeFileSync(t, JSON.stringify(rec), { mode: 0o600 });
    fs.renameSync(t, this.tokenFile);
    this.journal.append({ type: 'note', what: 'linked', engineId: rec.engineId, name: rec.name });
    return rec;
  }

  async start() {
    if (this.stopped) return;
    let tok;
    try {
      tok = await this.enroll();
    } catch (e) {
      this.note({ linked: false, why: e.message });
      // a refused code will not become good by asking again every second
      this.later(() => this.start(), e.final ? 10 * 60000 : Math.min(60000, 2000 * 2 ** Math.min(this.failures++, 5)));
      return;
    }
    this.note({ engineId: tok.engineId, name: tok.name });
    this.connect(tok);
    this.every(() => this.beat(), BEAT_MS);
    this.every(() => this.flushMarks(), MARKS_MS);
  }

  connect(tok) {
    if (this.stopped) return;
    const url = `${this.base.replace(/^http/, 'ws')}engine-link/ws`;
    const ws = new this.Socket(url, { headers: { Authorization: `Bearer ${tok.token}` } });
    this.ws = ws;
    this.live = false;
    ws.on('open', () => {
      this.send({
        t: 'hello', engineId: tok.engineId, release: this.version.release || null, commit: this.version.commit || null, code: (this.health() || {}).code || null,
        lock: this.lock ? this.lock.info() : null, journalN: this.journal.n, health: this.health(),
        machine: { platform: process.platform, arch: process.arch, hostname: os.hostname().slice(0, 80), node: process.version },
      });
    });
    ws.on('message', (text) => this.onMessage(text));
    ws.on('error', (e) => { this.note({ linked: false, why: e.message }); });
    ws.on('close', () => {
      this.live = false;
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      this.failures += 1;
      if (this.state.linked) this.note({ linked: false, why: 'the link closed; opening it again' });
      this.later(() => this.connect(tok), Math.min(30000, 1000 * 2 ** Math.min(this.failures, 5)));
    });
    ws.connect();
  }

  onMessage(text) {
    let m;
    try { m = JSON.parse(text); } catch (_) { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'welcome') {
      this.failures = 0;
      // the record from where the server's copy ends, then every new line as it is written
      let sent = Math.max(0, Number(m.since) || 0);
      for (;;) {
        const batch = this.journal.since(sent + 1, 500);
        if (!batch.length) break;
        this.send({ t: 'records', recs: batch });
        sent = batch[batch.length - 1].n;
        if (batch.length < 500) break;
      }
      this.live = true;
      this.note({ linked: true, since: new Date().toISOString(), why: null, serverRelease: typeof m.release === 'string' ? m.release : null });
      return;
    }
    if (m.t === 'request' && typeof m.id === 'string') {
      Promise.resolve(this.handle(String(m.method || 'GET'), String(m.path || '/'), m.body || {}))
        .then((out) => this.send({ t: 'answer', id: m.id, status: out.status, json: out.json }))
        .catch((e) => this.send({ t: 'answer', id: m.id, status: 500, json: { error: e.message } }));
    }
  }

  beat() {
    if (this.live) this.send({ t: 'beat', health: this.health() });
  }

  flushMarks() {
    if (!this.live || !this.marks.size) return;
    for (const mk of this.marks.values()) this.send({ t: 'mark', mark: mk });
    this.marks.clear();
  }

  send(obj) { return this.ws && this.ws.open ? this.ws.send(JSON.stringify(obj)) : false; }
  later(fn, ms) { const t = setTimeout(fn, ms); if (t.unref) t.unref(); this.timers.push(t); }
  every(fn, ms) { const t = setInterval(fn, ms); if (t.unref) t.unref(); this.timers.push(t); }

  stop() {
    this.stopped = true;
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    if (this.ws) this.ws.close();
  }
}

module.exports = { Link };
