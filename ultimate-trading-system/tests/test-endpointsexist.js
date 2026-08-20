// EVERY ENDPOINT THE TWO TABS CALL MUST EXIST ON THE SERVER (added 2026-08-18).
//
// The runtime harness (tests/browser.js) cannot catch this class. It deliberately
// does NOT press launchers or destructive buttons — firing a real sweep or nuking
// a config on every run is not something a test may do — so a control wired to an
// endpoint that does not exist is invisible to it. It is invisible to a reviewer
// too: both halves read correctly, and the fault lives only in the fact that the
// two strings do not meet. Same shape as QC-144 (the null-verdict route dropped
// ctx1/ctx2 between two correct ends) and QC-147 (three shipped controls the
// backend refused).
//
// WHAT THIS CHECKS AND WHAT IT DOES NOT. It asserts the ROUTE RESOLVES — that the
// page is not pointing at a URL Express has never heard of. It does not assert the
// endpoint does the right thing; that is what the per-feature tests are for. So a
// 400 ("bad request"), a 409 ("busy") or a JSON 404 ("no such setup <probe-id>")
// all PASS: they prove a handler ran. Only Express's own unmatched-route reply —
// an HTML body saying "Cannot GET/POST" — fails, because that is the signature of
// a control pointing at nothing.
//
// The endpoint list is EXTRACTED FROM THE PAGES, not hand-maintained, so a new
// control added tomorrow is covered without anyone remembering to add it here.
const { assert } = require('./helpers');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const PORT = 19000 + (process.pid % 400) + Math.floor(Math.random() * 400);

// Template slots (`${...}`) are filled with a probe id that will not exist. That
// is fine and intended: "no such setup probe-id" is a handler answering.
const PROBE = 'harness-probe-id';

// A few endpoints are reached only with a non-GET verb. Where a page calls one
// via a helper whose method is not visible in the string itself, name it here.
// Anything not listed is probed BOTH ways and passes if EITHER verb resolves —
// so a wrong guess here can never manufacture a failure.
function extractEndpoints() {
  const files = ['public/construct.js', 'public/trade.html'];
  const found = new Map();
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    for (const m of src.matchAll(/[`'"]((?:\.\.\/)?api\/[A-Za-z0-9_\-/${}.?=&]*)[`'"]/g)) {
      let p = m[1].replace(/^\.\.\//, '');
      // fill template slots, drop a trailing slash-only fragment (a base string
      // the page concatenates onto — not an endpoint in its own right)
      p = p.replace(/\$\{[^}]*\}/g, PROBE);
      if (/\/$/.test(p)) continue;
      if (!found.has(p)) found.set(p, f);
    }
  }
  return [...found].map(([p, from]) => ({ p, from }));
}

function req(method, p) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: '127.0.0.1', port: PORT, path: '/' + p, method,
        headers: method === 'POST' ? { 'Content-Type': 'application/json', 'Content-Length': 2 } : {} },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    r.on('error', reject);
    if (method === 'POST') r.write('{}');
    r.end();
  });
}

async function waitListening(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await req('GET', 'api/healthz'); if (r.status === 200) return; } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start on port ' + PORT);
}

// Express's unmatched-route handler answers with an HTML page. A handler that
// ran answers with JSON (or at least, not that). This is the whole distinction.
const isNoSuchRoute = (r) => r.status === 404 && /<!DOCTYPE html>|Cannot (GET|POST)/i.test(r.body);

module.exports.everyEndpointTheTabsCallResolvesToARealRoute = async function () {
  const endpoints = extractEndpoints();
  assert(endpoints.length > 20,
    `only ${endpoints.length} endpoints extracted from the two pages — the extractor has stopped `
    + 'matching, which would make this test pass by checking nothing');

  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT) }, cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const dead = [];
  try {
    await waitListening(8000);
    for (const { p, from } of endpoints) {
      // Probe BOTH verbs; the endpoint is real if EITHER resolves. A control is
      // only broken when NEITHER does.
      const g = await req('GET', p);
      if (!isNoSuchRoute(g)) continue;
      const post = await req('POST', p);
      if (!isNoSuchRoute(post)) continue;
      dead.push(`${p}  (called from ${from})`);
    }
  } catch (e) {
    throw new Error(e.message + (stderr ? '\n     server stderr: ' + stderr.trim().split('\n').slice(-3).join(' | ') : ''));
  } finally {
    child.kill('SIGKILL');
  }

  assert(dead.length === 0,
    `${dead.length} control(s) point at an endpoint the server does not have — pressing them `
    + `can only ever fail:\n       ${dead.join('\n       ')}`);
};
