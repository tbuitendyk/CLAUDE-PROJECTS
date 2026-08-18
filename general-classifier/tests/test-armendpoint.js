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
const PORT = 18000 + (process.pid % 400) + Math.floor(Math.random() * 400);

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

// Robustness: an Origin whose host EQUALS the request's own Host is same-origin and
// accepted even if that host is not in the allowlist — so an unexpected serving host
// cannot break the button. (Here Host is spoofed to a non-allowlisted value that the
// Origin matches; a cross-site Origin would NOT match Host and stays refused.)
module.exports.originMatchingHostIsAcceptedEvenIfNotAllowlisted = async function () {
  await withServer(async () => {
    const r = await req('POST', '/api/pilot/disarm', {}, { Origin: 'https://example.test', Host: 'example.test' });
    assert(r.status === 200, `origin==Host expected 200, got ${r.status} — body: ${r.body}`);
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

// THE MASTER SWITCH MUST ACTUALLY STOP. The Trading tab's STOP button posted to
// /api/pilot/arm with {armed:false} for as long as the page existed. That route
// has never read the body — it hard-codes writeArmRequest(true) — so STOP was not
// even a no-op: writeArmRequest mints a fresh nonce and utc every call, and the
// box edge-triggers on that as a genuine START. The operator confirmed "STOP the
// F1 engine?", saw no error, and the screen redrew as RUNNING because req.armed
// matched st.armed and nothing looked pending. Real money kept trading while the
// switch reported it was off (audit 2026-08-17).
//
// Two halves, and both are needed. The server refuses the contradiction so a
// future caller cannot repeat it silently; the page is pinned to the right route
// so the refusal is never reached in normal use.
//
// Watched failing 2026-08-17: restoring `post('api/pilot/arm',{armed})` fails
// theStopButtonPostsToTheDisarmRoute, and removing the server guard fails
// theArmRouteRefusesAContradictoryArmedFalse (it 200s and writes armed:true).
module.exports.theArmRouteRefusesAContradictoryArmedFalse = async function () {
  await withServer(async () => {
    const r = await req('POST', '/api/pilot/arm', { armed: false });
    assert(r.status === 400,
      `POST /api/pilot/arm {armed:false} must be REFUSED (it means disarm and reached the wrong door), got ${r.status} — body: ${r.body}`);
    assert(!fs.existsSync(ARM_REQ),
      'a contradictory arm request still wrote arm-request.json — the box would read it as a START');
    const j = JSON.parse(r.body);
    assert(/disarm/.test(j.error || ''), `the refusal must name the right route, got: ${r.body}`);
  });
};

module.exports.theStopButtonPostsToTheDisarmRoute = async function () {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'trading.html'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert(/api\/pilot\/disarm/.test(src),
    'the Trading tab never calls api/pilot/disarm — its STOP button cannot stop anything');
  const i = src.indexOf('const go=async(armed)');
  assert(i >= 0, 'the Trading tab lost its master-switch handler');
  const block = src.slice(i, i + 400);
  assert(/armed\?'api\/pilot\/arm':'api\/pilot\/disarm'/.test(block.replace(/\s/g, '')
    .replace(/armed\?"api\/pilot\/arm":"api\/pilot\/disarm"/, "armed?'api/pilot/arm':'api/pilot/disarm'")),
    'the master switch does not choose its route from the button pressed — check it is not posting to one route with an {armed} field the server never reads');
};

// CLEARING A HALT MUST BE POSSIBLE FROM THE SCREEN. A halt never self-clears —
// that is deliberate, and right — but until 2026-08-18 clearing one also
// required shell access to the box, so from the owner's Trading tab a halt was a
// dead end (owner: "if it cannot by itself then a mechanism must be provided for
// the user to do that").
//
// The endpoint writes a REQUEST, exactly as the arm switch does. It must NOT
// arm: the master switch still governs entries, so the worst a cleared halt does
// is let an already-armed box resume once its cause is fixed.
//
// Watched failing 2026-08-18: removing the route makes the POST 404; dropping the
// nonce makes theUnhaltRequestIsSingleUse fail (two presses would be
// indistinguishable, and the carry could not consume-once).
module.exports.unhaltWritesARequestAndNeverArms = async function () {
  await withServer(async () => {
    const before = fs.existsSync(ARM_REQ);
    const r = await req('POST', '/api/pilot/unhalt', {});
    assert(r.status === 200, `POST /api/pilot/unhalt expected 200, got ${r.status} — body: ${r.body}`);
    const j = JSON.parse(r.body);
    assert(j.ok === true && j.request, `expected {ok:true, request}, got ${r.body}`);
    assert(typeof j.request.nonce === 'string' && /^[0-9a-f]{18}$/.test(j.request.nonce),
      `the nonce must be the 18-hex shape the carry gate accepts, got ${JSON.stringify(j.request.nonce)}`);
    assert(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(j.request.utc), 'the request must carry an ISO utc for the freshness check');
    // THE POINT: it must not have touched the master switch.
    assert.strictEqual(fs.existsSync(ARM_REQ), before,
      'clearing a halt wrote an ARM request — clearing a halt must never arm the box');
    const f = path.join(ROOT, 'data', 'pilot', 'unhalt-request.json');
    assert(fs.existsSync(f), 'no unhalt-request.json was written, so the control plane has nothing to carry');
    try { fs.unlinkSync(f); } catch (_) { /* data/ is gitignored */ }
  });
};

module.exports.theUnhaltRequestIsSingleUse = async function () {
  await withServer(async () => {
    const a = JSON.parse((await req('POST', '/api/pilot/unhalt', {})).body).request;
    const b = JSON.parse((await req('POST', '/api/pilot/unhalt', {})).body).request;
    assert(a.nonce !== b.nonce,
      'two presses minted the same nonce — the carry consumes by nonce, so a repeat would be indistinguishable '
      + 'from the first and a halt could be cleared twice off one press');
    try { fs.unlinkSync(path.join(ROOT, 'data', 'pilot', 'unhalt-request.json')); } catch (_) { /* ignore */ }
  });
};

module.exports.theTradingTabOffersTheControlOnlyWhenHalted = function () {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'trading.html'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const i = src.indexOf('if(d.halted)strips.push(');
  assert(i >= 0, 'the LIVE page no longer shows a halt banner');
  const block = src.slice(i, i + 900);
  assert(/id="btnUnhalt"/.test(block), 'the halt banner offers no way out — a halt is a dead end from this screen');
  assert(/api\/pilot\/unhalt/.test(src), 'nothing calls the unhalt endpoint');
  // and it must say what it does NOT do, before it is pressed
  assert(/does not start trading/i.test(src),
    'the control must say it does not start trading — otherwise it reads like a resume button');
  assert(/haltReason/.test(src), 'the confirmation must name WHY the box halted; clearing blind is the mistake the rule exists to prevent');
};
