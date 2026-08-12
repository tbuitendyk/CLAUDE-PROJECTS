// Live Trading HTTP surface, over the wire (plan 1.3). Spawns the REAL server
// on a throwaway port (the QC-114 pattern: an endpoint nobody has driven over
// HTTP is not a tested endpoint) with GC_SETUPS_DIR pointed at a scratch dir.
const { assert } = require('./helpers');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 19200 + (process.pid % 400) + Math.floor(Math.random() * 400);
const ORIGIN = { Origin: 'https://www.buitendyk.ca' };  // same-site (CSRF-allowed)

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-liveroutes-'));
process.env.GC_SETUPS_DIR = SCRATCH;
const reg = require('../lib/live/setups');
const { BOOKS, TRAIN_THROUGH } = require('../lib/forwardbook');

function f1Config() {
  const F1 = BOOKS.find((b) => b.id === 'F1');
  return {
    combo: { ...F1.combo }, branch: { ...F1.branch }, stage: F1.stage,
    members: F1.members.map((m) => ({ ...m })), cell: { ...F1.cell },
    trainThrough: TRAIN_THROUGH, configVersion: 'f1-v1-2026-08-11',
  };
}

function req(method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method,
      headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(headers || {}) } },
      (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b, json: () => JSON.parse(b) })); });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
async function waitUp(ms) {
  const dl = Date.now() + ms;
  while (Date.now() < dl) {
    try { const r = await req('GET', '/api/healthz'); if (r.status === 200) return; } catch (_) {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start');
}

async function withServer(fn) {
  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT), GC_SETUPS_DIR: SCRATCH },
    cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = ''; child.stderr.on('data', (d) => stderr += d);
  try { await waitUp(8000); await fn(); }
  catch (e) { throw new Error(e.message + (stderr ? '\n     server stderr: ' + stderr.trim().split('\n').slice(-3).join(' | ') : '')); }
  finally { child.kill('SIGKILL'); }
}

module.exports.liveSetupLifecycleOverTheWire = async function () {
  const s = reg.createSetup({ id: 'wire-a', name: 'wire test', ownerId: 'owner',
    configSnapshot: f1Config(), clipUsd: 10, keyRef: 'sub-acct-wire' });  // R7: live needs a sub-account
  await withServer(async () => {
    // list + detail
    const list = (await req('GET', '/api/live/setups')).json();
    assert.ok(list.setups.some((x) => x.id === 'wire-a'), 'created setup appears in list');
    const det = await req('GET', '/api/live/setups/wire-a');
    assert.strictEqual(det.status, 200);
    assert.strictEqual(det.json().tradedPair, 'LTCUSDT');
    // config update over the wire
    const upd = await req('POST', '/api/live/setups/wire-a/config', { clipUsd: 20 }, ORIGIN);
    assert.strictEqual(upd.status, 200, upd.body);
    assert.strictEqual(upd.json().setup.clipUsd, 20);
    // immutable field refused with 400 (never silently merged)
    const imm = await req('POST', '/api/live/setups/wire-a/config', { configSnapshot: {} }, ORIGIN);
    assert.strictEqual(imm.status, 400, imm.body);
    // state transitions: draft -> paper -> live -> stopped
    for (const to of ['paper', 'live', 'stopped']) {
      const t = await req('POST', '/api/live/setups/wire-a/state', { to }, ORIGIN);
      assert.strictEqual(t.status, 200, `-> ${to}: ${t.body}`);
    }
    // illegal transition surfaces as 400
    const bad = await req('POST', '/api/live/setups/wire-a/state', { to: 'draft' }, ORIGIN);
    assert.strictEqual(bad.status, 400, bad.body);
    // unknown setup is 404
    const nf = await req('GET', '/api/live/setups/nope-xyz');
    assert.strictEqual(nf.status, 404);
  });
};

module.exports.liveMutationsAreCsrfGuarded = async function () {
  reg.createSetup({ id: 'wire-b', name: 'csrf test', ownerId: 'owner',
    configSnapshot: f1Config(), clipUsd: 10 });
  await withServer(async () => {
    const evil = { Origin: 'https://evil.example.com' };
    for (const [m, p, body] of [
      ['POST', '/api/live/setups/wire-b/state', { to: 'paper' }],
      ['POST', '/api/live/setups/wire-b/config', { clipUsd: 999 }],
      ['DELETE', '/api/live/setups/wire-b', null],
    ]) {
      const r = await req(m, p, body, evil);
      assert.strictEqual(r.status, 403, `${m} ${p} cross-site must be 403, got ${r.status}: ${r.body}`);
    }
    // and the record is untouched
    const det = (await req('GET', '/api/live/setups/wire-b')).json();
    assert.strictEqual(det.state, 'draft');
    assert.strictEqual(det.clipUsd, 10);
  });
};

module.exports.greenlightAndShuttleOverTheWire = async function () {
  // greenlight construction is unit-tested (test-live-greenlight); over the
  // wire we pin: unknown run -> 404, CSRF on both POSTs, and a full shuttle
  // from a pre-seeded greenlight record -> draft setup appears in the list.
  const GLDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-glwire-'));
  process.env.GC_GREENLIGHTS_DIR = GLDIR;
  const gl = require('../lib/live/greenlight');
  const rec = {
    id: 'gl-wire-1', createdUtc: new Date().toISOString(), by: 'owner', why: 'wire test',
    engineVersion: 'gc-0.0.0/setup-1/config-1', target: 'best', campaign: null,
    sourceRun: { id: 'r1', kind: 'bracketlab', startedAt: null, finishedAt: null, dataManifest: null },
    rowSummary: {}, configSnapshot: f1Config(), shuttledSetupIds: [],
  };
  fs.writeFileSync(path.join(GLDIR, 'gl-wire-1.json'), JSON.stringify(rec));
  await withServer(async () => {
    const list = (await req('GET', '/api/live/greenlights')).json();
    assert.ok(list.greenlights.some((g) => g.id === 'gl-wire-1'));
    // unknown run -> 404
    const nf = await req('POST', '/api/live/greenlight', { runId: 'nope', target: 'best', why: 'x' }, ORIGIN);
    assert.strictEqual(nf.status, 404, nf.body);
    // CSRF on both mutating endpoints
    for (const [p, body] of [
      ['/api/live/greenlight', { runId: 'r', target: 'best', why: 'x' }],
      ['/api/live/shuttle', { greenlightId: 'gl-wire-1', name: 'x', clipUsd: 10 }],
    ]) {
      const r = await req('POST', p, body, { Origin: 'https://evil.example.com' });
      assert.strictEqual(r.status, 403, `${p} cross-site must be 403: ${r.body}`);
    }
    // the shuttle mints a draft
    const sh = await req('POST', '/api/live/shuttle',
      { greenlightId: 'gl-wire-1', name: 'wired setup', clipUsd: 15 }, ORIGIN);
    assert.strictEqual(sh.status, 200, sh.body);
    const setup = sh.json().setup;
    assert.strictEqual(setup.state, 'draft');
    assert.strictEqual(setup.clipUsd, 15);
    const det = (await req('GET', `/api/live/setups/${setup.id}`)).json();
    assert.strictEqual(det.provenanceRef, 'gl-wire-1');
  });
};

module.exports.catalogAndStatusEndpointsOverTheWire = async function () {
  reg.createSetup({ id: 'wire-d', name: 'status probe', ownerId: 'owner',
    configSnapshot: f1Config(), clipUsd: 10 });
  await withServer(async () => {
    // catalog GET serves the required-vs-present shape
    const c = await req('GET', '/api/live/catalog');
    assert.strictEqual(c.status, 200, c.body);
    const cj = c.json();
    assert.ok('ok' in cj && Array.isArray(cj.entries), 'catalog shape');
    // repair is CSRF-guarded like every mutator
    const evil = await req('POST', '/api/live/catalog/repair', {}, { Origin: 'https://evil.example.com' });
    assert.strictEqual(evil.status, 403, evil.body);
    // same-site repair runs (no active setups in this scratch world -> no fetches)
    const ok = await req('POST', '/api/live/catalog/repair', {}, ORIGIN);
    assert.strictEqual(ok.status, 200, ok.body);
    assert.ok(Array.isArray(ok.json().fetched));
    // per-setup status: 200 with a book for a real id, 404 for unknown
    const st = await req('GET', '/api/live/setups/wire-d/status');
    assert.strictEqual(st.status, 200, st.body);
    assert.ok('fidelity' in st.json() && 'openPositions' in st.json());
    const nf = await req('GET', '/api/live/setups/nope-xyz/status');
    assert.strictEqual(nf.status, 404);
    // malformed JSON on a live mutator returns the JSON error, not HTML (QC 115)
    const mal = await req('POST', '/api/live/setups/wire-d/config', '{oops', ORIGIN);
    assert.strictEqual(mal.status, 400, mal.body);
    assert.ok(!/<html/i.test(mal.body), 'JSON error, never an HTML stack page');
  });
};

module.exports.keyRefNeverLeavesTheServerAsAValue = async function () {
  reg.createSetup({ id: 'wire-c', name: 'key test', ownerId: 'owner',
    configSnapshot: f1Config(), clipUsd: 10, keyRef: 'sub-acct-key-1' });
  await withServer(async () => {
    const det = (await req('GET', '/api/live/setups/wire-c')).json();
    assert.strictEqual(det.keyRef, 'set', 'detail shows presence only');
    const list = (await req('GET', '/api/live/setups')).json();
    const row = list.setups.find((x) => x.id === 'wire-c');
    assert.strictEqual(row.keyRef, 'set', 'list shows presence only');
    assert.ok(!JSON.stringify(det).includes('sub-acct-key-1'), 'ref value never serialized');
  });
};
