// The Constructing tab's Sweep form posts option values STRAIGHT into
// /api/bracketlab. When a value the form can send is not a value the backend
// accepts, nothing catches it: the server throws, the page alerts, and the tab
// simply never launches. That is exactly how #swLayout shipped with the display
// strings ("70/15/15") in its value attributes instead of the backend tokens
// ("split70") — every Start sweep click failed, and no test noticed (owner,
// 2026-08-16).
//
// These tests read the ACTUAL option values out of public/constructing.js and
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
const SWEEP = fs.readFileSync(path.join(ROOT, 'public', 'constructing.js'), 'utf8');
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

  // The response contract is the same class as the request contract: the sweep
  // POST returns { batchId }, and reading out.id gave a blank run id forever.
  sweepReadsTheRunIdKeyTheEndpointReturns() {
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const handler = server.slice(server.indexOf("app.post('/api/bracketlab'"));
    const key = handler.match(/res\.json\(\{\s*(\w+):/);
    assert.ok(key, 'the /api/bracketlab handler must still answer with a JSON object');
    const launched = SWEEP.match(/launched \$\{out\.(\w+)/);
    assert.ok(launched, 'the Sweep launch message must still report the run id');
    assert.strictEqual(launched[1], key[1],
      `Sweep reads out.${launched[1]} but /api/bracketlab returns { ${key[1]} } — the run id renders blank`);
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
