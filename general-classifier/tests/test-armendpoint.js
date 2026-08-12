// Arm/disarm HTTP endpoints. REGRESSION GUARD for the 2026-08-12 live incident:
// POST /api/pilot/arm and /api/pilot/disarm both threw HTTP 500 "fs is not
// defined" because writeArmRequest (and the stop-sweep helpers) referenced a bare
// `fs` that server.js does not define — it aliases the fs module as `dataFs`. The
// client (post() in pilot.html) does not check response.ok, so the 500 surfaced
// as a silent no-op: the owner pressed START, the confirm dialog closed, and the
// box never armed because no arm-request.json was ever written. It was latent
// because these POST endpoints were only first exercised by the first real START.
//
// This spins up the actual server on a throwaway port and drives the endpoint end
// to end: a 200 with {ok:true} AND a written request file is the pass; the old bug
// returns 500 and writes nothing. Uses the DISARM endpoint only (armed:false) so
// the test can never leave an "armed" request lying around; arm and disarm share
// the same writeArmRequest code path, so disarm fully exercises the fixed line.
const { assert } = require('./helpers');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const ARM_REQ = path.join(ROOT, 'data', 'pilot', 'arm-request.json');
// per-run port so a stray earlier server (or a parallel run) does not collide
const PORT = 18000 + (process.pid % 1000);

function req(method, p, body, extraHeaders) {
  return new Promise((resolve, reject) => {
    // body: object -> JSON.stringify; string -> sent RAW (to test malformed JSON)
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const headers = { ...(data != null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(extraHeaders || {}) };
    const r = http.request(
      { host: '127.0.0.1', port: PORT, path: p, method, headers },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    r.on('error', reject);
    if (data != null) r.write(data);
    r.end();
  });
}

async function waitListening(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try { const r = await req('GET', '/api/healthz'); if (r.status === 200) return; } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start on port ' + PORT + (lastErr ? ' (' + lastErr.message + ')' : ''));
}

async function withServer(fn) {
  try { fs.unlinkSync(ARM_REQ); } catch (_) { /* start clean */ }
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(PORT) },
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  try {
    await waitListening(8000);
    await fn();
  } catch (e) {
    throw new Error(e.message + (stderr ? '\n     server stderr: ' + stderr.trim().split('\n').slice(-3).join(' | ') : ''));
  } finally {
    child.kill('SIGKILL');
    try { fs.unlinkSync(ARM_REQ); } catch (_) { /* data/ is gitignored anyway */ }
  }
}

// The bug reproduced: this asserts the endpoint no longer 500s and actually
// writes the request the box reads.
module.exports.disarmEndpointReturns200AndWritesRequestNot500 = async function () {
  await withServer(async () => {
    const r = await req('POST', '/api/pilot/disarm', {});
    assert(r.status === 200, `POST /api/pilot/disarm expected 200, got ${r.status} — body: ${r.body}`);
    const j = JSON.parse(r.body);
    assert(j.ok === true, `expected {ok:true}, got ${r.body}`);
    assert(j.request && j.request.armed === false, `expected request.armed=false, got ${r.body}`);
    assert(fs.existsSync(ARM_REQ), 'arm-request.json was not written — the box would never see the switch');
  });
};

// Guard the whole class, not just the arm line: the stop-sweep status endpoint
// runs readStopSweep(), which had the same bare-fs defect. A GET must not 500.
module.exports.stopSweepStatusEndpointDoesNotThrowOnBareFs = async function () {
  await withServer(async () => {
    const r = await req('GET', '/api/pilot/stopsweep', {});
    // 200 (idle/status) is the healthy answer; the bug produced 500 fs-not-defined.
    assert(r.status === 200, `GET /api/pilot/stopsweep expected 200, got ${r.status} — body: ${r.body}`);
  });
};

// CSRF guard (finding C): a POST carrying a CROSS-SITE Origin is refused (403) and
// writes NOTHING, so a forged cross-site request cannot flip the live-money switch.
module.exports.crossSiteOriginIsRefusedAndWritesNothing = async function () {
  await withServer(async () => {
    const r = await req('POST', '/api/pilot/disarm', {}, { Origin: 'https://evil.example.com' });
    assert(r.status === 403, `cross-site disarm expected 403, got ${r.status} — body: ${r.body}`);
    assert(!fs.existsSync(ARM_REQ), 'a refused CSRF request must NOT write an arm-request');
  });
};

// The legit same-origin button still works: an allowed Origin passes and writes.
module.exports.sameSiteOriginIsAcceptedAndWrites = async function () {
  await withServer(async () => {
    const r = await req('POST', '/api/pilot/disarm', {}, { Origin: 'https://www.buitendyk.ca' });
    assert(r.status === 200, `same-site disarm expected 200, got ${r.status} — body: ${r.body}`);
    assert(fs.existsSync(ARM_REQ), 'an allowed request writes the arm-request the box reads');
  });
};

// Fail-OPEN on absence: a request with NO Origin/Referer (e.g. the live screen's
// fetch as a proxy may present it, or a non-browser client) is NOT blocked — so the
// guard can never break the running button even if a proxy strips those headers.
module.exports.noOriginIsNotBlocked = async function () {
  await withServer(async () => {
    const r = await req('POST', '/api/pilot/disarm', {}); // no Origin header
    assert(r.status === 200, `no-Origin disarm expected 200 (fail-open), got ${r.status} — body: ${r.body}`);
  });
};

// JSON error handler (finding B): malformed JSON returns a JSON 400 with an {error}
// field — NOT express's default HTML page with a stack trace.
module.exports.malformedJsonReturnsJson400NotHtmlStack = async function () {
  await withServer(async () => {
    const r = await req('POST', '/api/pilot/stop-apply', '{ not valid json', { Origin: 'https://www.buitendyk.ca' });
    assert(r.status === 400, `malformed JSON expected 400, got ${r.status} — body: ${r.body}`);
    assert(!/<!DOCTYPE|<html/i.test(r.body), `error must be JSON, not an HTML page — got: ${r.body.slice(0, 60)}`);
    let j = null; try { j = JSON.parse(r.body); } catch (_) { /* stays null */ }
    assert(j && typeof j.error === 'string', `expected {error: "..."} JSON, got: ${r.body.slice(0, 80)}`);
  });
};
