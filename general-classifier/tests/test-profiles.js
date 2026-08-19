// PROFILES: one kind of trading config, set up / paused / retired by the owner
// (owner, 2026-08-19: "GET RID OF ALL OF THIS F1 JUNK ... I have control to set
// it up and tear it down").
//
// These pin the three things that made the built-in pilot special, so that when
// it is deleted nothing quietly regresses to needing it back:
//
//   1. A config carries a NAME the owner chose. The generated id is a key, not a
//      label — "gl-mszdonx9-e5a595" told them nothing.
//   2. Real activation is gated on the profile having its OWN sub-account, which
//      is a condition it can MEET, rather than on being the one hardcoded config.
//   3. Retire is refused while real money is still open under it.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function withTempDirs(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-profiles-'));
  const prevG = process.env.GC_GREENLIGHTS_DIR;
  const prevS = process.env.GC_SETUPS_DIR;
  process.env.GC_GREENLIGHTS_DIR = path.join(base, 'gl');
  process.env.GC_SETUPS_DIR = path.join(base, 'setups');
  fs.mkdirSync(process.env.GC_GREENLIGHTS_DIR, { recursive: true });
  fs.mkdirSync(process.env.GC_SETUPS_DIR, { recursive: true });
  try { return fn(base); } finally {
    if (prevG === undefined) delete process.env.GC_GREENLIGHTS_DIR; else process.env.GC_GREENLIGHTS_DIR = prevG;
    if (prevS === undefined) delete process.env.GC_SETUPS_DIR; else process.env.GC_SETUPS_DIR = prevS;
    fs.rmSync(base, { recursive: true, force: true });
  }
}

// ---- 1. a config is named by its owner ---------------------------------------

function aConfigCannotBeCreatedWithoutAName() {
  const gl = require(path.join(ROOT, 'lib', 'live', 'greenlight'));
  assert.throws(() => gl.validName(''), /needs a NAME/,
    'a config can still be born carrying only a machine-generated id');
  assert.throws(() => gl.validName('   '), /needs a NAME/, 'whitespace passes as a name');
  assert.strictEqual(gl.validName('  DOGE momentum  '), 'DOGE momentum', 'the name is not trimmed');
}

function nameAndWhyAreRelabelableAndTheHistoryIsKept() {
  withTempDirs(() => {
    const gl = require(path.join(ROOT, 'lib', 'live', 'greenlight'));
    const dir = process.env.GC_GREENLIGHTS_DIR;
    const id = 'gl-test-relabel';
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({
      id, name: 'first name', why: 'first reason', campaign: 'sweep-A', configSnapshot: {},
    }));
    const out = gl.relabel(id, { name: 'LTC daily short', why: 'best of the triples scan' });
    assert.strictEqual(out.name, 'LTC daily short');
    assert.strictEqual(out.why, 'best of the triples scan');
    assert.strictEqual(out.campaign, 'sweep-A', 'relabelling moved the config to another campaign');
    assert.strictEqual(out.relabelHistory.length, 1, 'the previous labels were overwritten without trace');
    assert.strictEqual(out.relabelHistory[0].name, 'first name');
  });
}

function campaignIsNotRelabelable() {
  // Campaign is a REFERENCE to the line of work every config from that sweep
  // shares. Editing it here would either move this config to a different
  // campaign or rename the campaign for all of them. Neither is a rename.
  const routes = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'routes.js'), 'utf8');
  const handler = routes.match(/relabel'[\s\S]{0,700}?\n  \}\);/)[0];
  assert.ok(!/campaign/.test(handler.replace(/\/\/[^\n]*/g, '')),
    'the relabel endpoint accepts campaign, which is a foreign key and not a label');
}

// ---- 2. real activation is gated on something the owner can fix --------------

function goingLiveRequiresTheProfilesOwnSubAccount() {
  const setups = require(path.join(ROOT, 'lib', 'live', 'setups'));
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'setups.js'), 'utf8');
  assert.ok(/to === 'live' && !\(typeof s\.keyRef/.test(src),
    'the live gate no longer requires the profile to have its own sub-account');
  assert.ok(typeof setups.transition === 'function');
}

function theScreenGatesRealOnCredentialsNotOnBeingThePilot() {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'trading.html'), 'utf8');
  assert.ok(/keyRefSet/.test(html),
    'the screen cannot see whether a config has its own sub-account, so it cannot gate honestly');
  assert.ok(!/await per-setup sub-account key routing \(G8\)/.test(html),
    'the button still explains itself with a blocker the owner cannot act on');
  const routes = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'routes.js'), 'utf8');
  assert.ok(/keyRefSet: !!\(s\.keyRef/.test(routes),
    'the configs endpoint does not report credential presence per channel');
}

function theBoxPublishesEachProfilesKeyRef() {
  const lp = fs.readFileSync(path.join(ROOT, 'live-produce.js'), 'utf8');
  assert.ok(/key_ref: s\.keyRef \|\| null/.test(lp),
    'the allowlist omits keyRef, so the box cannot route a real order to the profile\'s own wallet');
}

// ---- 3. retire cannot strand money ------------------------------------------

function retireIsRefusedWhileRealMoneyIsOpen() {
  withTempDirs(() => {
    const setups = require(path.join(ROOT, 'lib', 'live', 'setups'));
    const dir = process.env.GC_SETUPS_DIR;
    const id = 'prof-open';
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({
      id, ownerId: 'owner', name: 'holds a position', state: 'stopped', clipUsd: 10,
      tradedPair: 'LTCUSDT', configSnapshot: {}, stateHistory: [],
    }));
    // a journal the derivation will read: one REAL position opened, never closed
    const jf = path.join(dir, 'journal.jsonl');
    fs.writeFileSync(jf, JSON.stringify({
      event: 'ENTRY_FILL', setup_id: id, chunk_start: '2026-08-14T00:00:00.000Z',
      side: 'SHORT', qty: 0.2, price: 44.5, utc: '2026-08-18T01:10:00Z', exit_due_ts: 9e9,
    }) + '\n');
    const prev = process.env.GC_LIVE_JOURNAL;
    process.env.GC_LIVE_JOURNAL = jf;
    try {
      assert.throws(() => setups.transition(id, 'retired'), /open position/i,
        'a profile can be retired while it still holds real money on the exchange');
    } finally {
      if (prev === undefined) delete process.env.GC_LIVE_JOURNAL; else process.env.GC_LIVE_JOURNAL = prev;
    }
  });
}

function retireIsAllowedOnceNothingIsOpen() {
  withTempDirs(() => {
    const setups = require(path.join(ROOT, 'lib', 'live', 'setups'));
    const dir = process.env.GC_SETUPS_DIR;
    const id = 'prof-flat';
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({
      id, ownerId: 'owner', name: 'flat', state: 'stopped', clipUsd: 10,
      tradedPair: 'LTCUSDT', configSnapshot: {}, stateHistory: [],
    }));
    const jf = path.join(dir, 'empty.jsonl');
    fs.writeFileSync(jf, '');
    const prev = process.env.GC_LIVE_JOURNAL;
    process.env.GC_LIVE_JOURNAL = jf;
    try {
      const out = setups.transition(id, 'retired');
      assert.strictEqual(out.state, 'retired', 'a flat profile cannot be retired');
    } finally {
      if (prev === undefined) delete process.env.GC_LIVE_JOURNAL; else process.env.GC_LIVE_JOURNAL = prev;
    }
  });
}

module.exports = {
  aConfigCannotBeCreatedWithoutAName,
  nameAndWhyAreRelabelableAndTheHistoryIsKept,
  campaignIsNotRelabelable,
  goingLiveRequiresTheProfilesOwnSubAccount,
  theScreenGatesRealOnCredentialsNotOnBeingThePilot,
  theBoxPublishesEachProfilesKeyRef,
  retireIsRefusedWhileRealMoneyIsOpen,
  retireIsAllowedOnceNothingIsOpen,
};
