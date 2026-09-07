#!/usr/bin/env node
// PULL A RUNNING STAGE 3'S MEMORY-ONLY STATE OUT THROUGH NODE'S OWN DEBUGGER,
// AND PAUSE IT (3.82.0, owner order 2026-09-07: "build the debug code injection
// and save the state and memory").
//
// WHY THIS EXISTS. Until 3.82.0 a stage 3 run kept two things only in memory
// until its last part landed -- the agreements each unit reached and the four
// comparisons for each unit -- and a stop threw both away. The run going on the
// box when this was written (S3 #1c) is on that older code, so it cannot write
// its own checkpoint. Node can open its debugger port in a running process on
// a signal, and a debugger can read a paused frame's locals. That is all this
// does: it breaks at the first line of the callback that runs each time a part
// lands, writes the same checkpoint file the run itself writes from 3.82.0
// on, asks the run to stop the way its own cancelStage does, and lets it go. The
// pricing workers are separate threads and keep working through the pause;
// the service answers nothing for the second or two the main thread is held.
//
// RULE TEN: this serves one run. Delete it, its test and its help the day that
// run has been started again.
//
// HOW TO RUN IT ON THE BOX, as the service's own user so the files it writes
// belong to the service:
//   sudo -u uts node /opt/ultimate-trading-system/tools/capture-stage3.js --dry-run
//   sudo -u uts node /opt/ultimate-trading-system/tools/capture-stage3.js
// It finds the service's process itself. --dry-run attaches, pauses once,
// reports what it sees, writes nothing and stops nothing.
//
// Deterministic and local: Node's inspector protocol over a socket to
// 127.0.0.1, nothing else (RULE SEVEN).
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function args() {
  const a = process.argv.slice(2);
  const out = { service: 'ultimate-trading-system', port: 9229, waitMinutes: 15, dryRun: false, appDir: null, pid: null, set: null, closeInspector: false, quiet: false };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    const v = a[i + 1];
    if (k === '--pid') { out.pid = Number(v); i++; }
    else if (k === '--service') { out.service = v; i++; }
    else if (k === '--port') { out.port = Number(v); i++; }
    else if (k === '--wait-minutes') { out.waitMinutes = Number(v); i++; }
    else if (k === '--app-dir') { out.appDir = v; i++; }
    else if (k === '--set') { out.set = v; i++; }
    else if (k === '--dry-run') out.dryRun = true;
    else if (k === '--close-inspector') out.closeInspector = true;
    else if (k === '--quiet') out.quiet = true;
    else throw new Error(`unknown argument ${k}`);
  }
  if (!out.appDir) out.appDir = path.join(__dirname, '..');
  return out;
}
const say = (opts, ...m) => { if (!opts.quiet) console.log(...m); };

// ---- the process ---------------------------------------------------------------
function servicePid(service) {
  const out = execFileSync('systemctl', ['show', '-p', 'MainPID', '--value', service], { encoding: 'utf8' }).trim();
  const pid = Number(out);
  if (!pid) throw new Error(`${service} has no main process (systemctl says MainPID=${out || 'none'})`);
  return pid;
}

// ---- where to break, read off the code the process is running ---------------------
// Two shapes are known: the loop as it was to 3.81.0 (inside startStage3, with
// its state in loose locals) and the loop from 3.82.0 on (runStage3Parts, with
// its state in `live`). Anything else refuses: a breakpoint on a guessed line is
// a pause with nothing to read.
function locateCallback(appDir) {
  const file = path.join(appDir, 'lib', 'stages.js');
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const at = lines.findIndex((l) => l.includes("await pool.forEach('s3Unit', payloads, (settled, i) => {"));
  if (at < 0) throw new Error(`${file} holds no stage 3 part-landed callback`);
  if (!lines[at + 1].includes('if (doc.cancelRequested) return;')) throw new Error(`${file}: the line after the callback is not the cancel check`);
  const before = lines.slice(Math.max(0, at - 120), at).join('\n');
  const shape = before.includes('async function runStage3Parts(') || lines.slice(Math.max(0, at - 200), at).join('\n').includes('async function runStage3Parts(')
    ? 'live' : (before.includes('const controlsMap = {};') && before.includes('const agreedMap = {};') ? 'locals' : null);
  if (!shape) throw new Error(`${file}: the callback is not in a shape this tool knows (neither the 3.81 locals nor the 3.82 live state)`);
  return { file, lineNumber: at + 1, shape };   // 0-based line of the cancel check
}

// what runs INSIDE the paused frame. It may only use what that frame can see —
// and a frame sees an outer variable ONLY IF SOME INNER FUNCTION REFERS TO IT.
// V8 keeps a variable on the stack unless a closure captures it, and the
// debugger cannot reach a stacked variable of an outer frame. cancelStage is
// defined at the top of lib/stages.js and only ever exported, so the callback
// frame cannot see it (the rehearsal found this, 2026-09-07); its two lines
// are written out here instead, on activeSet and activePool, which every
// launch and every finish refer to and are therefore always reachable.
// EVERY NAME THE REAL CAPTURE USES, and nothing else, per shape. The dry run
// reports whether the paused frame can SEE each of them, because that is the
// one thing that decides whether the real capture works and it cannot be
// worked out by reading the file -- it depends on what V8 kept. A dry run that
// read only the easy half would pass and prove nothing (found while preparing
// the real capture, 2026-09-07).
const NEEDS = {
  live: ['doc', 'live', 'writeCheckpoint', 'activeSet', 'activePool'],
  locals: ['doc', 'parts', 'parentRecords', 'agreedMap', 'controlsMap', 'pricedSettings', 'w', 'i',
    'atomicWrite', 'path', 'SETS_DIR', 'activeSet', 'activePool'],
};
const seesEvery = (shape) => `{ ${NEEDS[shape].map((n) => `${n}: typeof ${n}`).join(', ')} }`;

function expressionFor(shape, dryRun) {
  if (dryRun) {
    // typeof, never a bare read: a name the frame cannot see answers
    // "undefined" instead of throwing, so ONE probe reports on all of them
    return shape === 'live'
      ? `JSON.stringify({ id: doc.id, status: doc.status, partsDone: doc.perf.partsDone, partsTotal: doc.perf.partsTotal, units: live.units.length, agreedKeys: Object.keys(live.agreedMap).length, controlsUnits: Object.keys(live.controlsMap).length, storeRows: live.storeRows(), storeBlocks: live.storeBlocks(), release: doc.engineVersion, workers: (doc.perf || {}).workers, sees: ${seesEvery('live')}, shape: 'live' })`
      : `JSON.stringify({ id: doc.id, status: doc.status, partsDone: doc.perf.partsDone, partsTotal: parts.length, units: parentRecords.length, agreedKeys: Object.keys(agreedMap).length, controlsUnits: Object.keys(controlsMap).length, storeRows: w.records.count, storeBlocks: w.records.blockCount, release: doc.engineVersion, workers: (doc.perf || {}).workers, sees: ${seesEvery('locals')}, shape: 'locals' })`;
  }
  if (shape === 'live') {
    return `(() => {
      if (typeof activeSet === 'undefined' || typeof activePool === 'undefined') throw new Error('this frame cannot see activeSet/activePool, so the run could be written down and not stopped — nothing was written and it is untouched');
      writeCheckpoint(doc, live);
      const stopped = (activeSet && activeSet.id === doc.id) ? (activeSet.cancelRequested = true, (activePool && activePool.abort()), { stopped: true }) : { stopped: false, why: 'that set is not the one running' };
      return JSON.stringify({ id: doc.id, partsDone: doc.perf.partsDone, partsTotal: doc.perf.partsTotal, units: live.units.length, agreedKeys: Object.keys(live.agreedMap).length, controlsUnits: Object.keys(live.controlsMap).length, storeRows: live.storeRows(), storeBlocks: live.storeBlocks(), stopped, shape: 'live' });
    })()`;
  }
  // the 3.81 shape: the checkpoint is built by hand from the loop's own locals,
  // in exactly the form lib/stages.js reads back from 3.82.0 on
  return `(() => {
    if (typeof activeSet === 'undefined' || typeof activePool === 'undefined') throw new Error('this frame cannot see activeSet/activePool, so the run could be written down and not stopped — nothing was written and it is untouched');
    const at = new Date().toISOString();
    const cp = { v: 1, id: doc.id, at, release: doc.engineVersion, writtenBy: 'tools/capture-stage3.js through the inspector',
      workersN: doc.perf.workers, partsTotal: parts.length, partsDone: doc.perf.partsDone,
      units: parentRecords.map((r) => r.u), agreedMap, controlsMap, failures: doc.failures || [],
      pricedSettings, storeRows: w.records.count, storeBlocks: w.records.blockCount, atPart: i };
    atomicWrite(path.join(SETS_DIR, 'checkpoints', doc.id + '.json'), JSON.stringify(cp));
    const stopped = (activeSet && activeSet.id === doc.id) ? (activeSet.cancelRequested = true, (activePool && activePool.abort()), { stopped: true }) : { stopped: false, why: 'that set is not the one running' };
    return JSON.stringify({ id: doc.id, partsDone: cp.partsDone, partsTotal: cp.partsTotal, units: cp.units.length, agreedKeys: Object.keys(agreedMap).length, controlsUnits: Object.keys(controlsMap).length, storeRows: cp.storeRows, storeBlocks: cp.storeBlocks, stopped, shape: 'locals' });
  })()`;
}

// ---- a WebSocket client small enough to read in one sitting -----------------------
// The box runs Node 20, which has no WebSocket of its own, and this repository
// carries no dependency for one. RFC 6455: one handshake, masked frames out,
// unmasked frames in, text only, fragments joined, pings answered.
function connectWs(wsUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(wsUrl);
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect({ host: u.hostname, port: Number(u.port) }, () => {
      sock.write(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    let buf = Buffer.alloc(0);
    let upgraded = false;
    let frag = [];
    const listeners = [];
    const api = {
      onMessage(fn) { listeners.push(fn); },
      send(text) {
        const payload = Buffer.from(text, 'utf8');
        const mask = crypto.randomBytes(4);
        let head;
        if (payload.length < 126) head = Buffer.from([0x81, 0x80 | payload.length]);
        else if (payload.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(payload.length, 2); }
        else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(payload.length), 2); }
        const masked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
        sock.write(Buffer.concat([head, mask, masked]));
      },
      close() { try { sock.end(Buffer.from([0x88, 0x80, 0, 0, 0, 0])); } catch (_) { /* gone */ } try { sock.destroy(); } catch (_) { /* gone */ } },
    };
    const readFrames = () => {
      for (;;) {
        if (buf.length < 2) return;
        const fin = (buf[0] & 0x80) !== 0;
        const op = buf[0] & 0x0f;
        const maskedIn = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (maskedIn) off += 4;
        if (buf.length < off + len) return;
        let data = buf.slice(off, off + len);
        if (maskedIn) { const m = buf.slice(off - 4, off); data = Buffer.from(data.map((b, i) => b ^ m[i & 3])); }
        buf = buf.slice(off + len);
        if (op === 0x9) { sock.write(Buffer.concat([Buffer.from([0x8a, 0x80]), crypto.randomBytes(4)])); continue; }   // ping -> pong (empty, masked)
        if (op === 0x8) { sock.destroy(); return; }
        if (op === 0x1 || op === 0x0) {
          frag.push(data);
          if (fin) { const text = Buffer.concat(frag).toString('utf8'); frag = []; for (const fn of listeners) fn(text); }
        }
      }
    };
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = buf.slice(0, end).toString('utf8');
        buf = buf.slice(end + 4);
        if (!/^HTTP\/1\.1 101/.test(head)) { reject(new Error(`the inspector refused the socket: ${head.split('\r\n')[0]}`)); sock.destroy(); return; }
        upgraded = true;
        resolve(api);
      }
      readFrames();
    });
    sock.on('error', (err) => reject(err));
    sock.setTimeout(0);
  });
}

// ---- the inspector protocol, just enough ------------------------------------------
async function inspectorTargets(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/list', timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (err) { reject(err); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}
async function openInspector(pid, port, opts) {
  let targets = null;
  try { targets = await inspectorTargets(port); } catch (_) { targets = null; }
  if (!targets) {
    say(opts, `opening the inspector on process ${pid} (SIGUSR1)...`);
    process.kill(pid, 'SIGUSR1');
    const until = Date.now() + 10000;
    while (!targets && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 250));
      try { targets = await inspectorTargets(port); } catch (_) { targets = null; }
    }
  }
  if (!targets || !targets.length || !targets[0].webSocketDebuggerUrl) throw new Error(`no inspector answered on 127.0.0.1:${port} within ten seconds`);
  return targets[0].webSocketDebuggerUrl;
}

class Cdp {
  constructor(ws) { this.ws = ws; this.seq = 0; this.waiting = new Map(); this.events = []; this.eventWaiters = []; ws.onMessage((t) => this._on(t)); }
  _on(text) {
    let m; try { m = JSON.parse(text); } catch (_) { return; }
    if (m.id != null && this.waiting.has(m.id)) { const w = this.waiting.get(m.id); this.waiting.delete(m.id); if (m.error) w.reject(new Error(`${w.method}: ${m.error.message}`)); else w.resolve(m.result); return; }
    if (m.method) { this.events.push(m); for (const w of this.eventWaiters.slice()) { if (w.match(m)) { this.eventWaiters.splice(this.eventWaiters.indexOf(w), 1); w.resolve(m); } } }
  }
  call(method, params = {}, timeoutMs = 15000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waiting.delete(id); reject(new Error(`${method}: no answer in ${timeoutMs} ms`)); }, timeoutMs);
      this.waiting.set(id, { method, resolve: (r) => { clearTimeout(t); resolve(r); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  waitFor(match, timeoutMs) {
    const had = this.events.find(match);
    if (had) return Promise.resolve(had);
    return new Promise((resolve, reject) => {
      const w = { match, resolve: (m) => { clearTimeout(t); resolve(m); } };
      const t = setTimeout(() => { const i = this.eventWaiters.indexOf(w); if (i >= 0) this.eventWaiters.splice(i, 1); reject(new Error('timed out waiting for the run to land a part')); }, timeoutMs);
      this.eventWaiters.push(w);
    });
  }
}

// ---- the capture -------------------------------------------------------------------
async function capture(opts) {
  const pid = opts.pid || servicePid(opts.service);
  const where = locateCallback(opts.appDir);
  say(opts, `process ${pid} · ${where.file} · breaking at line ${where.lineNumber + 1} (${where.shape === 'live' ? 'the 3.82 loop' : 'the 3.81 loop'})${opts.dryRun ? ' · DRY RUN' : ''}`);
  const wsUrl = await openInspector(pid, opts.port, opts);
  const ws = await connectWs(wsUrl);
  const cdp = new Cdp(ws);
  let paused = false;
  let bpId = null;
  let out = null;
  try {
    await cdp.call('Debugger.enable');
    const bp = await cdp.call('Debugger.setBreakpointByUrl', { lineNumber: where.lineNumber, urlRegex: '.*[/\\\\]lib[/\\\\]stages\\.js$', columnNumber: 0 });
    bpId = bp.breakpointId;
    if (!bp.locations || !bp.locations.length) throw new Error('the breakpoint landed on no code — is the process running this file?');
    say(opts, `waiting up to ${opts.waitMinutes} minute(s) for the next part to land...`);
    const ev = await cdp.waitFor((m) => m.method === 'Debugger.paused' && Array.isArray(m.params.hitBreakpoints) && m.params.hitBreakpoints.includes(bpId), opts.waitMinutes * 60 * 1000);
    paused = true;
    const frame = ev.params.callFrames[0].callFrameId;
    // the right run, checked before anything is written
    const who = await cdp.call('Debugger.evaluateOnCallFrame', { callFrameId: frame, expression: 'doc.id', returnByValue: true });
    const id = who.result && who.result.value;
    if (opts.set && id !== opts.set) throw new Error(`the run that landed a part is ${id}, not ${opts.set} — nothing written`);
    const ev2 = await cdp.call('Debugger.evaluateOnCallFrame', { callFrameId: frame, expression: expressionFor(where.shape, opts.dryRun), returnByValue: true });
    if (ev2.exceptionDetails) throw new Error(`the capture threw inside the run: ${(ev2.exceptionDetails.exception && ev2.exceptionDetails.exception.description) || ev2.exceptionDetails.text}`);
    out = JSON.parse(ev2.result.value);
  } finally {
    // WHATEVER HAPPENED, THE RUN IS LET GO. A service left paused is a
    // service that answers nothing, for ever.
    try { if (bpId) await cdp.call('Debugger.removeBreakpoint', { breakpointId: bpId }, 5000); } catch (_) { /* best effort */ }
    try { if (paused) await cdp.call('Debugger.resume', {}, 5000); } catch (_) { /* best effort */ }
    try { await cdp.call('Debugger.disable', {}, 5000); } catch (_) { /* best effort */ }
    if (opts.closeInspector) {
      // asked to shut the port from inside; inspector.close() blocks the
      // process until every connection is gone, so ours is dropped at once
      try { cdp.call('Runtime.evaluate', { expression: "process.mainModule.require('inspector').close(); 'closed'" }, 1000).catch(() => {}); } catch (_) { /* best effort */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    ws.close();
  }
  return { pid, ...out };
}

// after the run has ended: the 3.81 code marks a stopped run cancelled, and the
// word the product knows for a stopped run that kept its state is paused
async function markPaused(opts, id) {
  const file = path.join(opts.appDir, 'data', 'stagesets', `${id}.json`);
  const cpFile = path.join(opts.appDir, 'data', 'stagesets', 'checkpoints', `${id}.json`);
  const until = Date.now() + 120000;
  let doc = null;
  while (Date.now() < until) {
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { doc = null; }
    if (doc && doc.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!doc) throw new Error(`${file} could not be read after the pause`);
  if (doc.status === 'running') throw new Error(`${id} is still running two minutes after the pause — nothing marked`);
  if (!fs.existsSync(cpFile)) throw new Error(`${id} ended ${doc.status} but its checkpoint is not on disk — nothing marked`);
  if (doc.status === 'paused') return doc.status;
  if (doc.status !== 'cancelled') throw new Error(`${id} ended ${doc.status}, not cancelled — left as it is`);
  const st = fs.statSync(file);
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    throw new Error(`${file} belongs to another user — run this as the service's own user (sudo -u uts) so the mark belongs to the service`);
  }
  const pf = doc.perf || {};
  doc.status = 'paused';
  doc.progress = `paused at ${Number(pf.partsDone || 0).toLocaleString()} of ${Number(pf.partsTotal || 0).toLocaleString()} parts · ${Number(pf.unitsDone || 0).toLocaleString()} of ${Number(pf.unitsTotal || 0).toLocaleString()} units priced`;
  doc.pausedBy = 'tools/capture-stage3.js through the inspector';
  const tmp = `${file}.tmp${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, file);
  return doc.status;
}

if (require.main === module) {
  (async () => {
    const opts = args();
    const got = await capture(opts);
    console.log(JSON.stringify(got));
    if (!opts.dryRun) {
      const status = await markPaused(opts, got.id);
      console.log(`${got.id} is ${status}: ${got.partsDone} of ${got.partsTotal} parts had landed, ${got.storeRows} rows in ${got.storeBlocks} blocks on disk, ${got.agreedKeys} agreement entries and ${got.controlsUnits} units' comparisons kept`);
    }
  })().catch((err) => { console.error(`FAILED: ${err.message}`); process.exit(1); });
}

module.exports = { locateCallback, expressionFor, capture, markPaused, connectWs, Cdp, NEEDS };
