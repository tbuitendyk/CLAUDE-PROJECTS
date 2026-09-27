// Execution targets + exchange adapter seams (plan phase 8).
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-targets-'));
process.env.GC_TARGETS_FILE = path.join(TDIR, 'targets.json');
const targets = require('../lib/live/targets');
const { getExchange } = require('../lib/live/exchange');
const binance = require('../lib/binance');

module.exports.builtinBoxIsTheZeroConfigDefault = function () {
  const t = targets.getTarget('mx-1');
  assert.ok(t && t.kind === 'ssh-box' && /mx-central-1/.test(t.host),
    'absent registry file = exactly the current single-box world');
  const r = targets.resolveForSetup({ id: 's', executionTargetRef: null });
  assert.strictEqual(r.id, 'mx-1', 'no ref -> default box');
};

module.exports.storedTargetsExtendAndOverrideBuiltins = function () {
  fs.writeFileSync(process.env.GC_TARGETS_FILE, JSON.stringify({
    'vps-2': { id: 'vps-2', kind: 'ssh-box', host: 'other.example.com', user: 'admin' },
  }));
  const all = targets.listTargets();
  assert.ok(all['mx-1'] && all['vps-2'], 'builtin + stored coexist');
  const r = targets.resolveForSetup({ id: 's', executionTargetRef: 'vps-2' });
  assert.strictEqual(r.host, 'other.example.com');
};

module.exports.danglingTargetRefIsLoudNotSilentFallback = function () {
  let err = null;
  try { targets.resolveForSetup({ id: 's', executionTargetRef: 'gone-9' }); } catch (e) { err = e; }
  assert.ok(err && err.code === 'NO_TARGET',
    'a setup pointing at a deleted target surfaces, never silently falls back');
};

module.exports.binanceAdapterDelegatesToTheRealLib = function () {
  const x = getExchange('binance');
  assert.strictEqual(x.name, 'binance');
  // identity of delegation, not behavior: the adapter must call the same
  // functions the rest of the system trusts, not re-implement them.
  assert.ok(typeof x.recentKlines === 'function' && typeof x.monthlyKlines === 'function'
    && typeof x.coveredMonths === 'function' && typeof x.serverTime === 'function');
  const orig = binance.coveredMonths;
  let asked = null;
  binance.coveredMonths = (sym) => { asked = sym; return ['2026-01']; };
  try {
    const got = x.coveredMonths('ZZZTESTUSDT');
    assert.strictEqual(asked, 'ZZZTESTUSDT', 'delegates to lib/binance');
    assert.deepStrictEqual(got, ['2026-01']);
  } finally { binance.coveredMonths = orig; }
};

module.exports.unknownAdapterIsRefused = function () {
  let err = null;
  try { getExchange('kraken'); } catch (e) { err = e; }
  assert.ok(err && err.code === 'NO_ADAPTER');
};

// WHERE A PLATFORM CALLS FROM, AS THIS SYSTEM SEES IT (3.282.0, owner 2026-09-27: "thorough detection of the
// ipv4 address source"): the link's own connection, kept on the platform's record with every address it has
// called from, newest first, ten at most, each with when it was first and last seen and how often
module.exports.everyAddressAPlatformCallsFromIsKept = function () {
  const { addressesSeen } = require('../lib/live/enginehub');
  let a = addressesSeen([], '1.1.1.1', '2026-09-27T01:00:00.000Z');
  assert.deepStrictEqual(a, [{ ip: '1.1.1.1', firstUtc: '2026-09-27T01:00:00.000Z', lastUtc: '2026-09-27T01:00:00.000Z', n: 1 }]);
  a = addressesSeen(a, '2.2.2.2', '2026-09-27T02:00:00.000Z');
  a = addressesSeen(a, '1.1.1.1', '2026-09-27T03:00:00.000Z');
  assert.deepStrictEqual(a.map((x) => [x.ip, x.n, x.firstUtc.slice(11, 13), x.lastUtc.slice(11, 13)]), [['1.1.1.1', 2, '01', '03'], ['2.2.2.2', 1, '02', '02']], 'newest first, counted, first seen kept');
  for (let i = 0; i < 12; i++) a = addressesSeen(a, `10.0.0.${i}`, `2026-09-28T${String(i).padStart(2, '0')}:00:00.000Z`);
  assert.strictEqual(a.length, 10, 'ten kept');
  assert.strictEqual(a[0].ip, '10.0.0.11');
  // kept on the record the screens read -- and the record put back as it was found, since later test files
  // read the same one and a platform left on it becomes their default
  const before = fs.existsSync(process.env.GC_TARGETS_FILE) ? fs.readFileSync(process.env.GC_TARGETS_FILE, 'utf8') : null;
  try {
    fs.writeFileSync(process.env.GC_TARGETS_FILE, '{}');
    targets.saveCallingEngine({ id: 'seen-1', name: 'Seen', tokenHash: 'd'.repeat(64) });
    targets.noteEngine('seen-1', { seenFrom: '1.1.1.1', addresses: addressesSeen([], '1.1.1.1') });
    const t = targets.getTarget('seen-1');
    assert.deepStrictEqual([t.seenFrom, t.addresses.length, t.addresses[0].ip], ['1.1.1.1', 1, '1.1.1.1']);
  } finally { if (before == null) fs.rmSync(process.env.GC_TARGETS_FILE, { force: true }); else fs.writeFileSync(process.env.GC_TARGETS_FILE, before); }
  // the link takes the address the web server in front says, or the connection's own
  const hub = fs.readFileSync(path.join(__dirname, '..', 'lib', 'live', 'enginehub.js'), 'utf8');
  assert.ok(/const from = String\(req\.headers\['x-real-ip'\] \|\| req\.socket\.remoteAddress \|\| ''\)\.replace\(\/\^::ffff:\/, ''\)\.slice\(0, 64\);/.test(hub)
    && /noteEngine\(id, \{ seenFrom: real, addresses: real \? addressesSeen\(kept, real\) : kept,/.test(hub), 'the link notes where each platform calls from');
  // 3.282.1 (owner: "just shows the loopback"): this server's own front door is never a platform's address
  const { isLoopback } = require('../lib/live/enginehub');
  assert.deepStrictEqual(['127.0.0.1', '127.8.0.1', '::1', 'localhost', '201.141.7.19', '10.0.0.5'].map(isLoopback), [true, true, true, true, false, false]);
  assert.ok(/const real = from && !isLoopback\(from\) \? from : null;/.test(hub) && /const kept = \(Array\.isArray\(t0\.addresses\) \? t0\.addresses : \[\]\)\.filter\(\(x\) => x && !isLoopback\(x\.ip\)\);/.test(hub), 'loopback is neither recorded nor kept');
};
