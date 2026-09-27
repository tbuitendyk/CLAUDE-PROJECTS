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
const { aSetupConfig } = require('./fixtures-setup');

// a stage-engine configuration, made through the product's own door (3.97.0)
function f1Config() {
  return { ...aSetupConfig(), configVersion: 'f1-v1-2026-08-11' };
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
    engineVersion: 'gc-0.0.0/setup-1/config-1', target: 'stage4', campaign: null,
    sourceRun: { id: 'r1', kind: 'stage3', startedAt: null, finishedAt: null, dataManifest: null },
    rowSummary: {}, configSnapshot: f1Config(), shuttledSetupIds: [],
  };
  fs.writeFileSync(path.join(GLDIR, 'gl-wire-1.json'), JSON.stringify(rec));
  await withServer(async () => {
    const list = (await req('GET', '/api/live/greenlights')).json();
    assert.ok(list.greenlights.some((g) => g.id === 'gl-wire-1'));
    // an unknown Stage 4 record set is refused in words (3.97.0: the one door)
    const nf = await req('POST', '/api/live/greenlight', { source: 'stage4', setId: 'nope', pick: { by: 'depth' }, why: 'x', name: 'x' }, ORIGIN);
    assert.strictEqual(nf.status, 400, nf.body);
    assert.ok(/unknown Stage 4 record set/.test(nf.body), nf.body);
    // CSRF on both mutating endpoints
    for (const [p, body] of [
      ['/api/live/greenlight', { source: 'stage4', setId: 'r', why: 'x' }],
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

module.exports.theSubAccountKeyIsShownAsTheAccountItNames = async function () {
  // 3.282.0 (owner 2026-09-27: "After setting a Sub-account key THAT ACCOUNT SELECTION MUST BE SHOWN ON THE
  // SETUP"): the reference is the name of a trading account, shown under its own name beside presence
  reg.createSetup({ id: 'wire-c', name: 'key test', ownerId: 'owner',
    configSnapshot: f1Config(), clipUsd: 10, keyRef: 'sub-acct-key-1' });
  await withServer(async () => {
    const det = (await req('GET', '/api/live/setups/wire-c')).json();
    assert.deepStrictEqual([det.keyRef, det.hasKeyRef], ['sub-acct-key-1', true], 'the detail names the account');
    const list = (await req('GET', '/api/live/setups')).json();
    const row = list.setups.find((x) => x.id === 'wire-c');
    assert.deepStrictEqual([row.keyRef, row.hasKeyRef], ['sub-acct-key-1', true], 'and so does the list');
    assert.ok(!/"keyRef":"set"/.test(JSON.stringify(det) + JSON.stringify(list)), 'never the word set in the field that names the account');
  });
};

// PICKED FROM THE LISTS, OR NOT AT ALL (3.282.0, owner 2026-09-27: "one must be picked"; the sub-account key
// "must be a drop down list box also"): the service refuses an execution target that is no trading platform
// and a key that names no trading account, on Save routing and at Activate alike
module.exports.theRoutingIsPickedFromTheLists = async function () {
  reg.createSetup({ id: 'wire-r', name: 'routing test', ownerId: 'owner', configSnapshot: f1Config(), clipUsd: 10 });
  await withServer(async () => {
    const t = await req('POST', '/api/live/setups/wire-r/config', { executionTargetRef: 'mx-1' }, ORIGIN);
    assert.strictEqual(t.status, 400, t.body);
    assert.ok(/pick a trading platform in Execution target|there is no trading platform yet: one is set up on Setup \| Compute/.test(t.json().error), t.body);
    const k = await req('POST', '/api/live/setups/wire-r/config', { keyRef: 'no-such-account' }, ORIGIN);
    assert.strictEqual(k.status, 400, k.body);
    assert.ok(/pick one of the trading accounts in Sub-account key|there is no trading account yet: one is set up on Setup \| Account/.test(k.json().error), k.body);
    assert.strictEqual(reg.getSetup('wire-r').executionTargetRef, null, 'nothing was written');
    const a = await req('POST', '/api/live/configs/gl-none/activate', { channel: 'paper', executionTargetRef: 'mx-1' }, ORIGIN);
    assert.deepStrictEqual([a.status, a.json().error], [400, 'pick a trading platform from the list']);
  });
};
