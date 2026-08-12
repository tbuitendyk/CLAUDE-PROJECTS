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
