// THE COMPUTE HAND: what this system's own services are doing, and starting,
// stopping and restarting them (owner design, 2026-08-25).
//
// HISTORY, because this file has been two wrong sizes already. It began as a
// browser of all 153 services on the machine — thrown out by the owner as junk
// ("we only care about the uts services"). It was then cut to a single blind
// restart button. The owner's Compute design is the right middle: THIS SYSTEM'S
// OWN services — an allow-list of a few names, not a browser — each with its
// load, its ceiling, and its start/stop/restart, feeding the Compute tab of the
// Setup page every thirty seconds.
//
// WHY IT IS A SEPARATE PROGRAM, unchanged from day one and still decisive:
//
//   1. The trading service runs as an unprivileged user with
//      NoNewPrivileges=true and ProtectSystem=strict. It cannot run systemctl
//      or write a service's CPU ceiling. Not "should not" — cannot.
//
//   2. The moment these controls matter is the moment that service has stopped
//      answering. A control served by it would be stuck in the same queue.
//
// It also serves the trading system's own pages read-only, so the Compute tab
// is still reachable (…/uts/svc/setup.html) when the main service is not.
//
// WHAT IT WILL ACT ON: only the units named in UTS_UNITS (default: the trading
// service). Not a list curated on a screen and not a browser of the machine —
// the system's own parts, extended by env when the sweep runner exists. The
// one refusal kept from the old design: it will not stop or restart ITSELF,
// because it is the way back, and a way back you can close from a phone is not
// a way back. It says so rather than hiding the fact.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 8095);
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.resolve(process.env.UTS_PUBLIC || '/opt/ultimate-trading-system/public');
const SELF_UNIT = process.env.SELF_UNIT || 'uts-service-control.service';
// The service the plain restart route acts on, and the default subject of
// everything here.
const UNIT = process.env.UTS_UNIT || 'ultimate-trading-system.service';
const UNIT_PORT = Number(process.env.UTS_UNIT_PORT || 8094);

// THE SERVICES THAT DO THE USER'S WORK — the only ones reported and the only
// ones actionable. THE CONTROL ITSELF IS NOT ON THIS LIST (owner ruling,
// 2026-08-25): it is the plumbing behind the web interface, and "if this
// program is to be used by multiple clients from OUR web server WHY ON EARTH
// would we expose that to the end users?" It does the pressing invisibly; it
// is nobody's compute resource. The self-refusal below is kept as a second
// wall for the day an environment file lists it anyway.
const UNITS = (process.env.UTS_UNITS || UNIT)
  .split(',').map((s) => s.trim()).filter(Boolean);
const ACTIONS = ['start', 'stop', 'restart'];
const SELF_REFUSAL = 'this is the control itself — stopping it from here would leave nothing able to start anything again';

function run(cmd, args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() });
    });
  });
}

// RUNNING IS NOT THE SAME AS ANSWERING. `systemctl is-active` said "active"
// straight through an outage, because the machine accepts a connection on a
// live port whether or not anything will ever read it. So the service that
// serves pages gets asked a real question and timed.
function answers(port, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: '/', timeout: timeoutMs }, (res) => {
      res.resume();
      res.on('end', () => done({ answering: true, ms: Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10 }));
    });
    req.on('timeout', () => { req.destroy(); done({ answering: false, why: `it took the connection and then sent nothing for ${timeoutMs / 1000} seconds` }); });
    req.on('error', (e) => done({ answering: false, why: e.code === 'ECONNREFUSED' ? 'nothing is listening on it' : (e.message || 'it could not be reached') }));
    req.end();
  });
}

const cg = (unit, f) => `/sys/fs/cgroup/system.slice/${unit}/${f}`;
const readNum = (file) => { try { return Number(fs.readFileSync(file, 'utf8').trim()); } catch (_) { return null; } };

async function show(unit, props) {
  const r = await run('systemctl', ['show', unit, '--no-pager', `--property=${props.join(',')}`], 15000);
  const kv = {};
  for (const line of r.stdout.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i)] = line.slice(i + 1);
  }
  return kv;
}

// The quota systemd holds, as a percentage of one processor. "infinity" means
// no ceiling and is reported as null rather than a made-up number.
function quotaPct(v) {
  if (!v || v === 'infinity') return null;
  const m = /^([\d.]+)(m?)s$/.exec(v);
  if (!m) return null;
  const sec = Number(m[1]) * (m[2] === 'm' ? 0.001 : 1);
  return Math.round(sec * 100);
}

// WHAT THE MACHINE SAYS ABOUT A SERVICE'S LAST DEATH — its own record, read
// back so a stranded record set can say WHY the service restarted instead of
// leaving a silent hole (owner order, 2026-08-27). A memory-ceiling death
// aborts the process (code 134) or is killed by the machine (oom-kill);
// both are said in plain words, and a clean stop says nothing.
async function lastDeath(unit) {
  if (!UNITS.includes(unit)) {
    return { code: 400, body: { error: `"${unit}" is not one of this system's services (${UNITS.join(', ')})` } };
  }
  const d = await show(unit, ['Result', 'ExecMainStatus', 'ExecMainCode', 'NRestarts', 'ActiveState']);
  const result = d.Result || '';
  const status = Number(d.ExecMainStatus || 0);
  const died = !!result && result !== 'success';
  let plain = null;
  if (died) {
    if (result === 'oom-kill') plain = 'the machine killed it for using too much memory';
    else if (status === 134) plain = 'it stopped itself mid-work; a memory ceiling death looks exactly like this';
    else plain = `it did not stop cleanly (${result}, code ${status})`;
  }
  return { code: 200, body: { unit, died, result, status, restarts: Number(d.NRestarts || 0), plain } };
}

// WHAT EVERYTHING IS DOING RIGHT NOW. Processor use is measured, not asked
// for: the kernel's own running total of each service's processor time, read
// twice half a second apart. The Compute tab asks for this every thirty
// seconds.
async function compute() {
  let uptime = 0;
  try { uptime = parseFloat(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]) || 0; } catch (_) { /* not linux */ }
  const usage = (u) => {
    try {
      const m = /usage_usec (\d+)/.exec(fs.readFileSync(cg(u, 'cpu.stat'), 'utf8'));
      return m ? Number(m[1]) : null;
    } catch (_) { return null; }               // not running: no group to read
  };
  // BOTH ENDS OF THE WINDOW ARE READ TOGETHER (owner report, 2026-08-27:
  // "390% ceiling allowed and yet the service is using 398.2%"). The kernel
  // enforces the ceiling on this very counter, so a true sustained read can
  // never sit above it — but this used to read each unit's counter AFTER its
  // systemctl show call, tens of milliseconds of extra counted time over a
  // denominator frozen at the half-second sleep, and a service pinned AT its
  // ceiling displayed a few percent above it. The counters are now read for
  // every unit in one pass, immediately either side of the sleep, and the
  // slow systemctl asks happen outside the measured window.
  // Two seconds, not half a one: the kernel doles the ceiling out in 100ms
  // slices, so the shorter the window the more one slice's alignment wobbles
  // the reading — at half a second a service pinned at 390% still read ~392.
  // The page only asks every thirty seconds; two seconds of patience buys a
  // number that sits on the ceiling instead of dancing around it.
  const t0 = process.hrtime.bigint();
  const before = new Map(UNITS.map((u) => [u, usage(u)]));
  await new Promise((r) => { setTimeout(r, 2000); });
  const afterAll = new Map(UNITS.map((u) => [u, usage(u)]));
  const windowMs = Number(process.hrtime.bigint() - t0) / 1e6;

  const units = [];
  for (const unit of UNITS) {
    const d = await show(unit, ['Description', 'ActiveState', 'SubState', 'ActiveEnterTimestampMonotonic', 'CPUQuotaPerSecUSec', 'MainPID']);
    let cpuPct = null;
    const after = afterAll.get(unit);
    const a = before.get(unit);
    if (after != null && a != null && windowMs > 0) {
      // usec of processor time over msec of wall time: /1000 aligns the units,
      // x100 makes it a percentage, and the round keeps one decimal.
      cpuPct = Math.max(0, Math.round(((after - a) / 1000 / windowMs) * 1000) / 10);
    }
    const mono = Number(d.ActiveEnterTimestampMonotonic || 0);
    units.push({
      unit,
      description: d.Description || '',
      active: d.ActiveState || 'unknown',
      sub: d.SubState || '',
      upSeconds: mono > 0 && uptime > 0 && d.ActiveState === 'active' ? Math.max(0, Math.round(uptime - mono / 1e6)) : null,
      cpuPct,
      memoryBytes: readNum(cg(unit, 'memory.current')),
      quotaPct: quotaPct(d.CPUQuotaPerSecUSec),
      cannotStop: unit === SELF_UNIT ? SELF_REFUSAL : null,
      ...(unit === UNIT ? { answers: await answers(UNIT_PORT) } : {}),
      ...(unit === SELF_UNIT ? { answers: { answering: true, ms: 0 } } : {}),
    });
  }

  let mem = {};
  try {
    const mi = fs.readFileSync('/proc/meminfo', 'utf8');
    const g = (k) => { const m = new RegExp(`${k}:\\s+(\\d+) kB`).exec(mi); return m ? Number(m[1]) * 1024 : null; };
    mem = { totalBytes: g('MemTotal'), availableBytes: g('MemAvailable') };
  } catch (_) { /* not linux */ }
  let disk = {};
  try { const s = fs.statfsSync('/'); disk = { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize }; } catch (_) { /* older node */ }
  let load = null;
  try { load = fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).map(Number); } catch (_) { /* not linux */ }

  return {
    at: new Date().toISOString(),
    machine: { processors: require('os').cpus().length, load, memory: mem, disk },
    units,
    servedBy: { unit: SELF_UNIT, upSeconds: Math.round(process.uptime()) },
  };
}

// One action on one of THIS SYSTEM'S services. The name has to be on the
// fixed list, the action one of three, and the name given twice — the same
// two-step everything irreversible in this system uses.
async function act(body) {
  const unit = String((body || {}).unit || '');
  const action = String((body || {}).action || '');
  if (!UNITS.includes(unit)) {
    return { code: 400, body: { error: `"${unit}" is not one of this system's services (${UNITS.join(', ')})` } };
  }
  if (!ACTIONS.includes(action)) return { code: 400, body: { error: `the action has to be one of: ${ACTIONS.join(', ')}` } };
  if (String((body || {}).confirm || '') !== unit) {
    return { code: 400, body: { error: `to ${action} "${unit}" the request has to name it twice — nothing has been done` } };
  }
  if (unit === SELF_UNIT && action !== 'start') {
    return { code: 409, body: { error: `"${unit}" cannot be ${action}ed from here: ${SELF_REFUSAL}. Nothing has been done.` } };
  }
  const before = await run('systemctl', ['is-active', unit], 15000);
  const r = await run('systemctl', [action, unit]);
  const after = await run('systemctl', ['is-active', unit], 15000);
  return {
    code: r.ok ? 200 : 500,
    body: {
      ok: r.ok, unit, action, was: before.stdout || 'unknown', now: after.stdout || 'unknown',
      ...(r.ok ? {} : { error: (r.stderr || r.stdout || `systemctl ${action} would not do it`).slice(0, 500) }),
    },
  };
}

// The processor ceiling for one of this system's services, as a percentage of
// one processor (300 = three processors' worth). Written with set-property, so
// it takes effect immediately AND survives a restart of the unit.
async function setQuota(body) {
  const unit = String((body || {}).unit || '');
  if (!UNITS.includes(unit)) {
    return { code: 400, body: { error: `"${unit}" is not one of this system's services (${UNITS.join(', ')})` } };
  }
  if (String((body || {}).confirm || '') !== unit) {
    return { code: 400, body: { error: `to change "${unit}"'s ceiling the request has to name it twice — nothing has been done` } };
  }
  const cores = require('os').cpus().length;
  const pct = Math.floor(Number((body || {}).percent));
  // The floor of 10 is not taste: a ceiling near zero starves the service of
  // the processor time it needs merely to answer, which reads exactly like the
  // outage this control exists to fix.
  if (!Number.isFinite(pct) || pct < 10 || pct > cores * 100) {
    return { code: 400, body: { error: `the ceiling must be a whole number from 10 to ${cores * 100} — this machine has ${cores} processors, and 100 is one processor's worth` } };
  }
  const r = await run('systemctl', ['set-property', unit, `CPUQuota=${pct}%`]);
  const d = await show(unit, ['CPUQuotaPerSecUSec']);
  return {
    code: r.ok ? 200 : 500,
    body: {
      ok: r.ok, unit, quotaPct: quotaPct(d.CPUQuotaPerSecUSec),
      ...(r.ok ? {} : { error: (r.stderr || r.stdout || 'systemctl would not set it').slice(0, 500) }),
    },
  };
}

async function state() {
  const active = await run('systemctl', ['is-active', UNIT], 15000);
  return { unit: UNIT, active: active.stdout || 'unknown', ...(await answers(UNIT_PORT)) };
}

async function restart() {
  return act({ unit: UNIT, action: 'restart', confirm: UNIT });
}

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

// The trading system's own pages, read-only, so the Compute tab still loads
// when that service is not answering. No second copy of any screen.
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

function withBody(req, res, handler) {
  let raw = '';
  let tooBig = false;
  req.on('data', (c) => { raw += c; if (raw.length > 8192) { tooBig = true; req.destroy(); } });
  req.on('end', () => {
    if (tooBig) return;
    let body;
    try { body = JSON.parse(raw || '{}'); } catch (_) { send(res, 400, { error: 'the request could not be read' }); return; }
    handler(body).then((r) => send(res, r.code, r.body)).catch((e) => send(res, 500, { error: e.message }));
  });
}

const server = http.createServer((req, res) => {
  // The pages are reachable at two addresses — under the trading system's own
  // prefix, and directly here when that service is not answering — and they ask
  // for this control by a path relative to wherever they were loaded from. One
  // extra leading "svc/" is accepted and dropped so one page works from both.
  let url = (req.url || '/').split('?')[0].replace(/\/{2,}/g, '/');
  url = url.replace(/^\/svc(?=\/|$)/, '') || '/';

  if (req.method === 'GET' && url === '/api/state') {
    return state().then((s) => send(res, 200, s)).catch((e) => send(res, 500, { error: e.message }));
  }
  if (req.method === 'GET' && url === '/api/last-death') {
    const unit = new URLSearchParams((req.url || '').split('?')[1] || '').get('unit') || UNIT;
    return lastDeath(unit).then((r) => send(res, r.code, r.body));
  }
  if (req.method === 'GET' && url === '/api/compute') {
    return compute().then((s) => send(res, 200, s)).catch((e) => send(res, 500, { error: e.message }));
  }
  if (req.method === 'POST' && url === '/api/restart') {
    // Kept for anything still pressing the old one-button path. No body is
    // read: there is exactly one thing this can do to exactly one service.
    req.resume();
    return restart().then((r) => send(res, r.code, r.body)).catch((e) => send(res, 500, { error: e.message }));
  }
  if (req.method === 'POST' && url === '/api/service') return withBody(req, res, act);
  if (req.method === 'POST' && url === '/api/quota') return withBody(req, res, setQuota);
  if (req.method === 'GET') return servePublic(res, url);
  return send(res, 405, { error: 'this answers reads, and two kinds of change' });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    process.stdout.write(`uts-service-control listening on ${HOST}:${PORT} for ${UNITS.join(', ')}\n`);
  });
}
module.exports = { server, state, restart, act, setQuota, compute, answers, quotaPct, lastDeath, UNIT, UNITS, SELF_UNIT, ACTIONS, PUBLIC_DIR };
