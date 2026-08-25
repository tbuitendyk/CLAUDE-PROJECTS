// RESTART THE TRADING SERVICE. That is the whole of it.
//
// Owner, 2026-08-25: "IF THERE WAS A SERVICE NOT RUNNING THAT WAS STOPPING THAT
// THEN I NEED TO BE ABLE TO CONTROL *ONLY THAT SERVICE*".
//
// An earlier version of this listed all 153 services on the machine and offered
// to start and stop any of them, with a screen of its own. That was junk in a
// trading application and the owner threw it out. What is left is one button's
// worth of machinery: restart ultimate-trading-system, and say whether it is
// running and answering. There is no unit parameter, so there is nothing to
// validate and nothing that can be pointed anywhere else.
//
// WHY IT IS A SEPARATE PROGRAM AT ALL, and it is not a preference. Two reasons,
// either one decisive:
//
//   1. The trading service runs as the unprivileged user `uts` with
//      NoNewPrivileges=true and ProtectSystem=strict. It cannot run systemctl.
//      Not "should not" -- cannot. A restart button inside it would be dead.
//
//   2. The only reason to press this is that the trading service has stopped
//      answering. A button served BY that service would not be answering
//      either. A control that goes down with the thing it controls is not a
//      control.
//
// It also serves the trading system's own pages, read-only, so the button is
// reachable when that service is not answering. There is no second copy of any
// screen and no screen of its own.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT || 8095);
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.resolve(process.env.UTS_PUBLIC || '/opt/ultimate-trading-system/public');
// THE ONE SERVICE THIS CAN TOUCH. Fixed here on purpose: the owner asked for
// control of only this one, so there is no name to pass in and no way to aim it
// at anything else.
const UNIT = process.env.UTS_UNIT || 'ultimate-trading-system.service';
const UNIT_PORT = Number(process.env.UTS_UNIT_PORT || 8094);

function run(cmd, args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim() });
    });
  });
}

// RUNNING IS NOT THE SAME AS ANSWERING, and only the second one matters here.
// `systemctl is-active` said "active" right through the outage, because the
// process was alive and its port was open -- the machine accepts the connection
// whether or not anything will ever read it. So this asks a real question.
function answers(timeoutMs = 4000) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    const req = http.request({ host: '127.0.0.1', port: UNIT_PORT, method: 'GET', path: '/', timeout: timeoutMs }, (res) => {
      res.resume();
      res.on('end', () => done({ answering: true, ms: Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10 }));
    });
    req.on('timeout', () => { req.destroy(); done({ answering: false, why: `it took the connection and then sent nothing for ${timeoutMs / 1000} seconds` }); });
    req.on('error', (e) => done({ answering: false, why: e.code === 'ECONNREFUSED' ? 'nothing is listening on it' : (e.message || 'it could not be reached') }));
    req.end();
  });
}

async function state() {
  const active = await run('systemctl', ['is-active', UNIT], 15000);
  return { unit: UNIT, active: active.stdout || 'unknown', ...(await answers()) };
}

async function restart() {
  const before = await run('systemctl', ['is-active', UNIT], 15000);
  const r = await run('systemctl', ['restart', UNIT]);
  const after = await run('systemctl', ['is-active', UNIT], 15000);
  return {
    code: r.ok ? 200 : 500,
    body: {
      ok: r.ok, unit: UNIT, was: before.stdout || 'unknown', now: after.stdout || 'unknown',
      ...(r.ok ? {} : { error: (r.stderr || r.stdout || 'systemctl would not restart it').slice(0, 500) }),
    },
  };
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

// The trading system's own pages, read-only, so the button is reachable when
// that service is not answering.
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
  // The page is reachable at two addresses -- under the trading system's own
  // prefix, and directly here when that service is not answering -- and it asks
  // for this by a path relative to wherever it was loaded from. So one extra
  // leading "svc/" is accepted and dropped, which lets one page work from both.
  let url = (req.url || '/').split('?')[0].replace(/\/{2,}/g, '/');
  url = url.replace(/^\/svc(?=\/|$)/, '') || '/';

  if (req.method === 'GET' && url === '/api/state') {
    return state().then((s) => send(res, 200, s)).catch((e) => send(res, 500, { error: e.message }));
  }
  if (req.method === 'POST' && url === '/api/restart') {
    // No body is read and none is needed: there is exactly one thing this can
    // do to exactly one service, so there is nothing to say.
    req.resume();
    return restart().then((r) => send(res, r.code, r.body)).catch((e) => send(res, 500, { error: e.message }));
  }
  if (req.method === 'GET') return servePublic(res, url);
  return send(res, 405, { error: 'this answers reads, and one kind of change' });
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    process.stdout.write(`uts-service-control listening on ${HOST}:${PORT} for ${UNIT}\n`);
  });
}
module.exports = { server, state, restart, answers, UNIT, PUBLIC_DIR };
