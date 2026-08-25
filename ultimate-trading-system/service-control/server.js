// SERVICE CONTROL, ON ITS OWN LEGS (owner order, 2026-08-24).
//
// The owner asked "is the service control not exposed? how do i start stop
// check", and then: "all of the processing can happen anywhere on the target
// app so obviously it must be controlable and accessible".
//
// WHY THIS CANNOT LIVE IN THE MAIN APP, and it is not a preference:
//
//   1. The trading service runs as the unprivileged user `uts` with
//      NoNewPrivileges=true and ProtectSystem=strict. It cannot run systemctl.
//      Not "should not" -- cannot. A control inside it would be a dead button.
//
//   2. Even if it could, it would be useless exactly when it is needed. What
//      took the screens down was one request holding the single thread for ten
//      minutes; every other request queued behind it, and a restart button
//      served by that same thread would have queued too. A control that stops
//      answering at the same moment as the thing it controls is not a control.
//
// So this is a separate process, on its own port, and its whole job is to say
// what is running and to start, stop and restart it. It is deliberately tiny:
// no dependencies at all, not even the one the main app has.
//
// WHAT IT ADDS THAT systemd CANNOT SAY. `systemctl is-active` said "active"
// right through the outage, because the process was alive and the port was
// open -- the kernel accepts a connection whether or not anything is ever going
// to read it. So this asks each service a real question over its own port and
// reports how long the answer took, or that none came. "Running but not
// answering" is the state the owner was actually in, and nothing on the box
// would say it.
//
// WHAT IT REFUSES, in public rather than by hiding it. A few services cannot be
// stopped from here, because stopping them removes the way back: this one, the
// web server that serves the address, the remote login, and the deploy path a
// repair comes down. They are LISTED, with the reason, on the screen. RULE ZERO
// says what the owner may choose from is never curated in code out of sight --
// so nothing is hidden, and the reason travels with the refusal.
//
// EVERYTHING ELSE IS THE OWNER'S TO PRESS, including the services that hold
// real money. Those are neither hidden nor blocked: each row carries the
// description systemd itself holds for that unit, in its author's own words, so
// the live ones say so. Building this control is mine; pressing it is not.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 8095);
const HOST = '127.0.0.1';
// The pages are the trading system's own, served read-only from here so that
// when that service is not answering the screens still load and the control on
// them still works. There is no second copy of any screen.
const PUBLIC_DIR = path.resolve(process.env.UTS_PUBLIC || '/opt/ultimate-trading-system/public');
const SELF_UNIT = process.env.SELF_UNIT || 'uts-service-control.service';

// STOPPING ANY OF THESE REMOVES THE WAY BACK. Not a judgement about what the
// owner should want -- a statement that the interface could not undo it.
const CANNOT_STOP = [
  [SELF_UNIT, 'this is the control itself, so stopping it would leave nothing able to start anything again'],
  ['nginx.service', 'this is the web server that serves the address you are reading this on'],
  ['ssh.service', 'this is the remote login, and the last way into the machine'],
  ['sshd.service', 'this is the remote login, and the last way into the machine'],
  ['deploy-control.service', 'this is the path a repair comes down when everything else is broken'],
];
const refusalFor = (unit) => (CANNOT_STOP.find(([u]) => u === unit) || [])[1] || null;

const UNIT_RE = /^[A-Za-z0-9:@._-]{1,120}\.service$/;
const ACTIONS = ['start', 'stop', 'restart'];

// THE LIST OF WHAT THE OWNER WATCHES IS THE OWNER'S (owner, 2026-08-25: "we
// only care about the uts services ... fix that page ... that's just crazy").
//
// A hundred and fifty services on one screen is unusable, and they are right.
// But the fix is NOT a list of names written in here deciding which ones matter
// — RULE ZERO: what appears in the interface is a user function, and hardcoding
// what the owner may choose from takes their decision away invisibly. So the
// machine still reports every one of them, every time, and WHICH of them the
// screen leads with is a choice the owner makes on the screen and this file
// remembers. Nothing is ever removed from what they can reach.
const WATCH_FILE = process.env.UTS_WATCH || '/opt/uts-service-control/watching.json';

function readWatching() {
  try {
    const v = JSON.parse(fs.readFileSync(WATCH_FILE, 'utf8'));
    return Array.isArray(v) ? v.filter((u) => UNIT_RE.test(u)) : [];
  } catch (_) { return []; }        // never set, or unreadable: nothing is watched
}

function writeWatching(list) {
  const tmp = `${WATCH_FILE}.tmp${process.pid}`;
  fs.mkdirSync(path.dirname(WATCH_FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(list, null, 1));
  fs.renameSync(tmp, WATCH_FILE);
  return list;
}

function run(cmd, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// EVERY SERVICE ON THE MACHINE, from systemd, never from a list written here.
// A list in code is a list the owner cannot see or change (RULE ZERO).
async function listUnits() {
  const r = await run('systemctl', ['list-units', '--type=service', '--all', '--plain', '--no-legend', '--no-pager']);
  const out = [];
  for (const line of r.stdout.split('\n')) {
    const m = /^\s*(\S+\.service)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/.exec(line);
    if (m) out.push({ unit: m[1], load: m[2], active: m[3], sub: m[4], description: m[5].trim() });
  }
  return out;
}

const PROPS = ['Id', 'Description', 'LoadState', 'ActiveState', 'SubState', 'UnitFileState',
  'MainPID', 'MemoryCurrent', 'CPUUsageNSec', 'ActiveEnterTimestampMonotonic'];

async function detailsFor(units) {
  const by = new Map();
  if (!units.length) return by;
  // One call for all of them; systemd separates the blocks with a blank line.
  const r = await run('systemctl', ['show', '--no-pager', `--property=${PROPS.join(',')}`, ...units], 30000);
  for (const block of r.stdout.split('\n\n')) {
    const kv = {};
    for (const line of block.split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) kv[line.slice(0, i)] = line.slice(i + 1);
    }
    if (kv.Id) by.set(kv.Id, kv);
  }
  return by;
}

// WHICH UNIT HOLDS WHICH PORT, taken from the listening socket's own process
// rather than from the unit's recorded main pid -- nginx listens from a worker,
// not from the pid systemd records, and so does anything else that forks.
async function listeners() {
  const r = await run('ss', ['-lntpH']);
  const byUnit = new Map();
  for (const line of r.stdout.split('\n')) {
    const addr = /LISTEN\s+\d+\s+\d+\s+(\S+):(\d+)\s/.exec(line);
    const pid = /pid=(\d+)/.exec(line);
    if (!addr || !pid) continue;
    let unit = null;
    try {
      const cg = fs.readFileSync(`/proc/${pid[1]}/cgroup`, 'utf8');
      const m = /([A-Za-z0-9:@._-]+\.service)/.exec(cg);
      if (m) unit = m[1];
    } catch (_) { /* the process went away between the two reads */ }
    if (!unit) continue;
    const port = Number(addr[2]);
    const list = byUnit.get(unit) || [];
    if (!list.some((p) => p.port === port)) list.push({ port, host: addr[1] });
    byUnit.set(unit, list);
  }
  return byUnit;
}

// THE QUESTION systemd CANNOT ANSWER: does it actually reply? A live process
// with an open port accepts the connection whether or not it will ever read
// from it, which is exactly how "active" was reported all through an outage.
//
// FIVE ANSWERS, NOT TWO, and the difference is the whole worth of this column.
// The first version had only "answered" and "no answer", so it printed NO
// ANSWER in red against ssh, the mail service and the tunnel — every one of them
// perfectly healthy and simply not speaking the web. A screen that cries wolf
// about ssh every time it is looked at is a screen nobody reads on the day it is
// right, so:
//
//   answered  a web reply came back, and how long it took
//   spoke     it sent something back that is not a web reply — alive, and this
//             is not a service that speaks the web. Not a fault.
//   closed    it hung up without saying anything, which is what a service
//             expecting some other kind of conversation does. Not a fault.
//   refused   nothing is listening there at all.
//   silent    it TOOK the connection and then sent nothing at all. This is the
//             one. It is the signature of the outage, it is what "active" hides,
//             and it is the only one of the five that means anything is wrong.
function ask(host, port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve({ port, ...v }); } };
    const to = host === '*' || host === '0.0.0.0' || host === '[::]' ? '127.0.0.1' : host.replace(/^\[|\]$/g, '');
    const req = http.request({ host: to, port, method: 'GET', path: '/', timeout: timeoutMs }, (res) => {
      res.resume();
      res.on('end', () => done({
        answered: true, state: 'answered', status: res.statusCode,
        ms: Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10,
      }));
    });
    req.on('timeout', () => {
      req.destroy();
      done({
        answered: false, state: 'silent', wrong: true,
        why: `it took the connection and then sent nothing at all for ${timeoutMs / 1000} seconds`,
      });
    });
    req.on('error', (e) => {
      const msg = String(e.message || '');
      if (e.code === 'ECONNREFUSED') {
        return done({ answered: false, state: 'refused', wrong: true, why: 'nothing is listening there' });
      }
      // It answered. Just not in the web's language, which is a fact about what
      // the service is, not a fault in it.
      if (/Parse Error|HPE_/.test(msg) || e.code === 'HPE_INVALID_CONSTANT') {
        return done({ answered: false, state: 'spoke', why: 'it replied, but not in the web\'s language — this one does not serve pages' });
      }
      if (e.code === 'ECONNRESET' || /socket hang up/.test(msg)) {
        return done({ answered: false, state: 'closed', why: 'it hung up without replying, which is what something expecting a different kind of conversation does' });
      }
      return done({ answered: false, state: 'unknown', wrong: true, why: msg || 'it could not be reached' });
    });
    req.end();
  });
}

async function snapshot() {
  const units = await listUnits();
  const det = await detailsFor(units.map((u) => u.unit));
  const ports = await listeners();
  let uptime = 0;
  try { uptime = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]) || 0; } catch (_) { /* not linux */ }

  // Only the ones actually listening are asked, and only on this machine.
  const asked = new Map();
  const jobs = [];
  for (const [unit, list] of ports) {
    for (const p of list.slice(0, 4)) jobs.push(ask(p.host, p.port).then((a) => { asked.set(`${unit}|${p.port}`, a); }));
  }
  await Promise.all(jobs);

  const watching = readWatching();
  const rows = units.map((u) => {
    const d = det.get(u.unit) || {};
    const mono = Number(d.ActiveEnterTimestampMonotonic || 0);
    const mem = Number(d.MemoryCurrent);
    const cpu = Number(d.CPUUsageNSec);
    const mine = ports.get(u.unit) || [];
    return {
      unit: u.unit,
      // The unit's OWN words. A service that trades real money says so in the
      // description its author gave it, not in a label invented here.
      description: d.Description || u.description || '',
      load: d.LoadState || u.load,
      active: d.ActiveState || u.active,
      sub: d.SubState || u.sub,
      enabled: d.UnitFileState || '',
      mainPid: Number(d.MainPID || 0) || null,
      upSeconds: mono > 0 && uptime > 0 ? Math.max(0, Math.round(uptime - mono / 1e6)) : null,
      memoryBytes: Number.isFinite(mem) && mem > 0 ? mem : null,
      cpuSeconds: Number.isFinite(cpu) && cpu > 0 ? cpu / 1e9 : null,
      ports: mine.map((p) => p.port),
      answers: mine.slice(0, 4).map((p) => asked.get(`${u.unit}|${p.port}`)).filter(Boolean),
      cannotStop: refusalFor(u.unit),
      watched: watching.includes(u.unit),
    };
  });
  return {
    at: new Date().toISOString(),
    // Said on every reply, because it is what makes this control worth having.
    servedBy: { unit: SELF_UNIT, port: PORT, pid: process.pid, upSeconds: Math.round(process.uptime()) },
    refusals: CANNOT_STOP.map(([unit, why]) => ({ unit, why })),
    // EVERY service, always. What the screen leads with is the owner's choice;
    // what this reports is never narrowed by it.
    watching,
    units: rows,
  };
}

function watch(body) {
  const unit = String((body || {}).unit || '');
  if (!UNIT_RE.test(unit)) return { code: 400, body: { error: `"${unit}" is not the name of a service` } };
  const on = !!(body || {}).watch;
  const list = readWatching();
  const next = on ? [...new Set([...list, unit])].sort() : list.filter((u) => u !== unit);
  try { writeWatching(next); } catch (err) {
    return { code: 500, body: { error: `the list could not be saved: ${err.message}` } };
  }
  return { code: 200, body: { ok: true, unit, watching: next } };
}

async function act(body) {
  const unit = String((body || {}).unit || '');
  const action = String((body || {}).action || '');
  const confirm = String((body || {}).confirm || '');
  if (!UNIT_RE.test(unit)) return { code: 400, body: { error: `"${unit}" is not the name of a service` } };
  if (!ACTIONS.includes(action)) return { code: 400, body: { error: `the action has to be one of: ${ACTIONS.join(', ')}` } };
  // The same two-step the rest of the system uses wherever something cannot be
  // taken back: say the name again, or nothing happens.
  if (confirm !== unit) {
    return { code: 400, body: { error: `to ${action} "${unit}" the request has to name it twice, and this one did not — nothing has been done` } };
  }
  const why = refusalFor(unit);
  // Starting one of these is always allowed. It is only STOPPING them that
  // removes the way back, and restart is a stop with a hope attached.
  if (why && action !== 'start') {
    return { code: 409, body: { error: `"${unit}" cannot be ${action}ed from here: ${why}. Nothing has been done.`, why } };
  }
  // It has to be a service this machine actually has: a name that passed the
  // pattern but names nothing would otherwise be handed to systemctl.
  const known = await listUnits();
  const found = known.find((u) => u.unit === unit);
  if (!found) return { code: 404, body: { error: `this machine has no service called "${unit}"` } };
  const r = await run('systemctl', [action, unit], 60000);
  const after = await run('systemctl', ['is-active', unit]);
  return {
    code: r.ok ? 200 : 500,
    body: {
      ok: r.ok, unit, action, before: found.active, after: after.stdout.trim(),
      ...(r.ok ? {} : { error: (r.stderr || r.stdout || `systemctl ${action} would not do it`).trim().slice(0, 800) }),
    },
  };
}

// ---- the pages -------------------------------------------------------------
// The trading system's own, read-only. When that service is not answering, its
// screens still load from here and the control on them still works; every other
// tab on them will say it could not read its data, which is true and is exactly
// what it should say.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
}

function servePublic(res, rel) {
  const want = path.resolve(PUBLIC_DIR, `.${rel === '/' ? '/construct.html' : rel}`);
  // Resolved FIRST and then checked, so no arrangement of dots escapes.
  if (want !== PUBLIC_DIR && !want.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'that is outside the pages folder' });
  const type = TYPES[path.extname(want).toLowerCase()];
  if (!type) return send(res, 404, { error: 'that is not a page' });
  return fs.readFile(want, (err, buf) => {
    if (err) return send(res, 404, { error: 'there is no such page' });
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    return res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  // The same page is reachable at two addresses -- under the trading system's
  // own prefix, and directly here when that service is not answering -- and it
  // asks for this control by a path relative to wherever it was loaded from. So
  // one extra leading "svc/" is accepted and dropped, which lets a single page
  // work from both without having to know where it came from.
  let url = (req.url || '/').split('?')[0].replace(/\/{2,}/g, '/');
  url = url.replace(/^\/svc(?=\/|$)/, '') || '/';

  if (req.method === 'GET' && url === '/api/services') {
    return snapshot().then((s) => send(res, 200, s)).catch((e) => send(res, 500, { error: e.message }));
  }
  if (req.method === 'POST' && (url === '/api/service' || url === '/api/watch')) {
    const handler = url === '/api/watch' ? (b) => Promise.resolve(watch(b)) : act;
    let raw = '';
    let tooBig = false;
    req.on('data', (c) => { raw += c; if (raw.length > 8192) { tooBig = true; req.destroy(); } });
    req.on('end', () => {
      if (tooBig) return;
      let body;
      try { body = JSON.parse(raw || '{}'); } catch (_) { send(res, 400, { error: 'the request could not be read' }); return; }
      handler(body).then((r) => send(res, r.code, r.body)).catch((e) => send(res, 500, { error: e.message }));
    });
    return undefined;
  }
  if (req.method === 'GET') return servePublic(res, url);
  return send(res, 405, { error: 'this answers reads, and one kind of change' });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    process.stdout.write(`uts-service-control listening on ${HOST}:${PORT}\n`);
  });
}
module.exports = { server, snapshot, act, watch, readWatching, listUnits, listeners, ask, refusalFor, CANNOT_STOP, UNIT_RE, ACTIONS, PUBLIC_DIR };
