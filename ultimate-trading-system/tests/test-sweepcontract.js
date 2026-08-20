// The Constructing tab's Sweep form posts option values STRAIGHT into
// /api/bracketlab. When a value the form can send is not a value the backend
// accepts, nothing catches it: the server throws, the page alerts, and the tab
// simply never launches. That is exactly how #swLayout shipped with the display
// strings ("70/15/15") in its value attributes instead of the backend tokens
// ("split70") — every Start sweep click failed, and no test noticed (owner,
// 2026-08-16).
//
// These tests read the ACTUAL option values out of public/construct.js and
// check them against the ACTUAL backend allow-lists, both extracted from source
// rather than restated here. Restating the lists would make the test agree with
// a copy of the contract instead of the contract.
//
// Watched failing 2026-08-16: restoring any one of the three old #swLayout
// values fails sweepLayoutOptionsAreAllAcceptedByTheBackend; dropping the
// weekly-8d option fails sweepOffersEveryBackendGeometry; sending a bare
// $('#swStart').value again fails blankMonthsAreOmittedNotSentEmpty.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const { GEOMETRIES } = require('../lib/dataset');

const ROOT = path.join(__dirname, '..');
const SWEEP = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
const BATCH = fs.readFileSync(path.join(ROOT, 'lib', 'batch.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

// Pull the <option value="..."> strings out of a named <select> in a source file.
// Returns [] when the select is absent, which the callers assert against.
function optionValues(src, selectId) {
  const open = src.indexOf(`<select id="${selectId}"`);
  if (open < 0) return [];
  const close = src.indexOf('</select>', open);
  const block = src.slice(open, close);
  return [...block.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
}

// The backend's window-layout allow-list, read from lib/batch.js itself so this
// test tracks the real validator instead of a copy of it.
function backendLayouts() {
  const m = BATCH.match(/if \(!\[([^\]]*)\]\.includes\(v\)\) \{\s*\n\s*throw new Error\(`unknown window layout/);
  assert.ok(m, 'the window-layout validator must still be findable in lib/batch.js');
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
}

module.exports = {
  // THE defect: a form value the backend refuses means the tab cannot launch.
  sweepLayoutOptionsAreAllAcceptedByTheBackend() {
    const accepted = backendLayouts();
    const offered = optionValues(SWEEP, 'swLayout');
    assert.ok(offered.length, 'the Sweep form must still carry a #swLayout select');
    const rejected = offered.filter((v) => !accepted.includes(v));
    assert.strictEqual(rejected.length, 0,
      `Sweep offers window layout(s) the backend refuses: ${rejected.join(', ')} `
      + `(accepted: ${accepted.join(', ')}) — every Start sweep click would fail`);
  },

  // Every offered chunk shape must be a real geometry key, or the sweep either
  // throws or silently computes the wrong shape.
  sweepGeometryOptionsAreAllRealGeometries() {
    const keys = Object.keys(GEOMETRIES);
    const offered = optionValues(SWEEP, 'swGeom');
    assert.ok(offered.length, 'the Sweep form must still carry a #swGeom select');
    const unknown = offered.filter((v) => !keys.includes(v));
    assert.strictEqual(unknown.length, 0,
      `Sweep offers unknown chunk shape(s): ${unknown.join(', ')} (real: ${keys.join(', ')})`);
  },

  // The other half: a geometry the backend computes but the form cannot ask for.
  // With permute ticked the sweep runs weekly-8d anyway, so leaving it out of the
  // dropdown made it reachable by accident and unreachable on purpose.
  sweepOffersEveryBackendGeometry() {
    const keys = Object.keys(GEOMETRIES);
    const offered = optionValues(SWEEP, 'swGeom');
    const missing = keys.filter((k) => !offered.includes(k));
    assert.strictEqual(missing.length, 0,
      `Sweep cannot launch these valid chunk shapes: ${missing.join(', ')}`);
  },

  // Bracket Lab is the launcher that works. Where the two forms express the same
  // control they must send the same vocabulary, or one of them is wrong.
  sweepAndBracketLabAgreeOnVocabulary() {
    for (const [sweepId, labId] of [['swLayout', 'bl-layout'], ['swGeom', 'bl-geometry']]) {
      const a = optionValues(SWEEP, sweepId).slice().sort();
      const b = optionValues(INDEX, labId).slice().sort();
      assert.ok(b.length, `${labId} must still exist in index.html to compare against`);
      assert.deepStrictEqual(a, b,
        `#${sweepId} and #${labId} must offer the same values — `
        + `Sweep: [${a.join(', ')}] vs Bracket Lab: [${b.join(', ')}]`);
    }
  },

  // A blank month box must be OMITTED, not sent as "". The server rejects ""
  // with a 400 and the backend defaults only apply to an absent key.
  blankMonthsAreOmittedNotSentEmpty() {
    for (const id of ['swStart', 'swEnd']) {
      const bare = new RegExp(`\\$\\('#${id}'\\)\\.value(?!\\s*\\|\\|)`);
      assert.ok(!bare.test(SWEEP),
        `#${id} is sent raw — a blank month box would POST "" and the server would refuse it with 400`);
    }
  },

  // The response contract is the same class as the request contract, and it is
  // NOT uniform across the three launchers: /api/bracketlab and historytuning
  // answer { batchId }, while httwo answers { started, id, … }. Reading the
  // wrong one renders a blank run id forever, and "fix them all to batchId"
  // would break the one that was right. Each key is read from the backend
  // source, so the check tracks the contract instead of a memory of it.
  everyLauncherReadsTheRunIdKeyItsBackendReturns() {
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    // (UI message id, where the authoritative return literal lives, its anchor)
    const LAUNCHERS = [
      { msg: 'swMsg',  src: server, anchor: "app.post('/api/bracketlab'", re: /res\.json\(\{\s*(\w+):\s*id\b/ },
      { msg: 'htMsg',  src: BATCH,  anchor: 'function htLaunch',  re: /return \{\s*(\w+):\s*doc\.id\b/ },
      { msg: 'ht2Msg', src: BATCH,  anchor: 'function ht2Launch', re: /return \{[^}]*?\b(\w+):\s*doc\.id\b/ },
    ];
    for (const l of LAUNCHERS) {
      const at = l.src.indexOf(l.anchor);
      assert.ok(at >= 0, `${l.anchor} must still exist to read the run-id contract from`);
      const backend = l.src.slice(at).match(l.re);
      assert.ok(backend, `${l.anchor} must still return the run id in an object literal`);
      const ui = SWEEP.match(new RegExp(`#${l.msg}'\\)\\.textContent = out \\? \`launched \\$\\{out\\.(\\w+)`));
      assert.ok(ui, `#${l.msg} must still report the run id on launch`);
      assert.strictEqual(ui[1], backend[1],
        `#${l.msg} reads out.${ui[1]} but ${l.anchor} returns { ${backend[1]} } — the run id renders blank`);
    }
  },

  // The declared block must send only what validateDeclared accepts. It THROWS
  // on a parameter that cannot apply (dMult or a non-directional gate under
  // market entry, armMult without trailMult) rather than ignoring it, so a form
  // that sends them turns replication mode into a launch failure.
  declaredBlockSendsOnlyWhatTheValidatorAccepts() {
    assert.ok(/id="swDecOn"/.test(SWEEP), 'the Sweep form must carry the declared-config toggle');
    // market entry: no gate, no dMult
    assert.ok(/entry === 'market'\s*\?\s*\{ entry, tHours: Number\(\$\('#swDecT'\)\.value\), \.\.\.qPart \}/.test(SWEEP),
      'a market declaration must send only entry, tHours and the quorum counts');
    // armMult only ever travels with trailMult
    assert.ok(/trailRaw \? \{ trailMult: Number\(trailRaw\), armMult: Number\(\$\('#swDecArm'\)\.value\) \} : \{\}/.test(SWEEP),
      'armMult must be sent only alongside trailMult — the validator refuses it alone');
    // quorum counts only for the committee sizes the run will contain
    assert.ok(/if \(\$\('#swSingles'\)\.checked\) qPart\.quorumSingles/.test(SWEEP),
      'quorumSingles must be sent only when singles are ticked');
    assert.ok(/if \(\$\('#swDoubles'\)\.checked \|\| \$\('#swTriples'\)\.checked\) qPart\.quorumContexts/.test(SWEEP),
      'quorumContexts must be sent only when doubles or triples are ticked');
  },

  // Every declared menu value must exist in the run's grid, or validateDeclared
  // throws "must be one of … (this run's grid)" at launch.
  declaredMenusMatchTheBackendGrid() {
    const bracketLib = require('../lib/bracket');
    const cases = [
      ['swDecEntry', bracketLib.ENTRIES.map(String)],
      ['swDecGate', bracketLib.GATES.map(String)],
      ['swDecD', bracketLib.D_MULTS.map(String)],
      ['swDecT', bracketLib.T_HOURS.map(String)],
      ['swDecArm', bracketLib.ARM_MULTS.map(String)],
    ];
    for (const [id, allowed] of cases) {
      const offered = optionValues(SWEEP, id);
      assert.ok(offered.length, `the declared block must carry #${id}`);
      const bad = offered.filter((v) => !allowed.includes(v));
      assert.strictEqual(bad.length, 0,
        `#${id} offers ${bad.join(', ')} — not in the backend grid (${allowed.join(', ')})`);
    }
    // trail additionally allows "" for the static (opposite-rail) stop
    const trail = optionValues(SWEEP, 'swDecTrail');
    const allowedTrail = ['', ...bracketLib.TRAIL_MULTS.map(String)];
    const badTrail = trail.filter((v) => !allowedTrail.includes(v));
    assert.strictEqual(badTrail.length, 0,
      `#swDecTrail offers ${badTrail.join(', ')} — not in the backend grid`);
  },

  // The two agreement counts are capped per committee size (6 and 8).
  declaredQuorumBoxesRespectTheirCommitteeSizes() {
    for (const [id, cap] of [['swDecQ6', 6], ['swDecQ8', 8]]) {
      const vals = optionValues(SWEEP, id).map(Number);
      assert.ok(vals.length, `the declared block must carry #${id}`);
      const bad = vals.filter((n) => !Number.isInteger(n) || n < 1 || n > cap);
      assert.strictEqual(bad.length, 0,
        `#${id} offers ${bad.join(', ')} — validateDeclared accepts 1..${cap}`);
    }
  },

  // CLASS-WIDE, not instance-wide. The window-layout defect was found by eye and
  // I guarded that one dropdown; #ht2hl then shipped with 90d/180d/365d/730d
  // against a server that accepts only 12mo/24mo/36mo, so EVERY age-dial launch
  // threw. Same bug, second instance, because the guard named two ids instead of
  // covering the rule. This one enumerates every select on the tab whose values
  // are checked against a backend allow-list, and fails on an unlisted select so
  // a NEW dropdown cannot quietly escape the check.
  everySelectCheckedByTheBackendOffersOnlyValuesItAccepts() {
    const { HALF_LIVES } = require('../lib/httwo');
    const { GEOMETRIES } = require('../lib/dataset');
    const CHECKED = [
      { id: 'swLayout', allowed: backendLayouts(), why: 'lib/batch.js window-layout allow-list' },
      { id: 'swGeom', allowed: Object.keys(GEOMETRIES), why: 'lib/dataset.js GEOMETRIES' },
      { id: 'ht2hl', allowed: Object.keys(HALF_LIVES), why: 'lib/httwo.js HALF_LIVES' },
    ];
    for (const c of CHECKED) {
      const offered = optionValues(SWEEP, c.id);
      assert.ok(offered.length, `#${c.id} must still exist and carry explicit option values`);
      const bad = offered.filter((v) => !c.allowed.includes(v));
      assert.strictEqual(bad.length, 0,
        `#${c.id} offers ${bad.join(', ')} — the backend accepts only ${c.allowed.join(', ')} (${c.why}); every launch would throw`);
    }
    // A select that carries explicit values and is NOT on the list above has
    // never been checked against anything. Fail loudly rather than assume.
    const known = new Set([...CHECKED.map((c) => c.id),
      // checked by their own test in test-declaredset.js against the run's grid
      'swDecEntry', 'swDecGate', 'swDecD', 'swDecT', 'swDecTrail', 'swDecArm', 'swDecQ6', 'swDecQ8',
      // free-form or purely local to the page, with no backend allow-list
      'swDec', 'bSort', 'glTarget', 'htWin', 'tuneTarget',
      // run-id pickers: every real option is a run id the SERVER listed, so the
      // allow-list is the server's own reply and cannot be restated here. The
      // only literal value in them is the empty placeholder. What these must
      // never be is <input> boxes — test-uicontracts.js pins that.
      'bPick', 't1null', 'cmpA', 'cmpB',
      // same shape: the campaign picker's options are the names the service
      // itself reports, and a NEW name is typed in the box beside it
      'cxCampPick']);
    const withValues = [...SWEEP.matchAll(/<select id="([\w-]+)"[^>]*>((?:(?!<\/select>)[\s\S])*?)<\/select>/g)]
      .filter((m) => /<option value="/.test(m[2])).map((m) => m[1]);
    const unlisted = withValues.filter((id) => !known.has(id));
    assert.deepStrictEqual(unlisted, [],
      `these selects carry explicit values and no test checks them against a backend allow-list: ${unlisted.join(', ')}`);
  },

  // A number the form can type but the backend silently reduces is a lie told to
  // the operator: the run is weaker than the one they asked for, with no notice.
  clampedNumberInputsCarryTheirBackendBounds() {
    const bounds = [
      { id: 'swK', max: 50, why: 'promoteK is capped at detailK 50 in lib/batch.js' },
      { id: 'swNulls', max: 24, why: 'labelShiftReps is capped at 24 in lib/batch.js' },
    ];
    for (const b of bounds) {
      const m = SWEEP.match(new RegExp(`<input id="${b.id}"[^>]*>`));
      assert.ok(m, `the Sweep form must still carry #${b.id}`);
      const tag = m[0];
      const max = tag.match(/max="(\d+)"/);
      assert.ok(max, `#${b.id} must carry a max attribute — ${b.why}`);
      assert.strictEqual(Number(max[1]), b.max,
        `#${b.id} max must match the backend cap (${b.max}) — ${b.why}`);
    }
  },
};
