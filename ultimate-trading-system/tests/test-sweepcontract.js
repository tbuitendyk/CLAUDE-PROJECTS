// The Constructing tab's Sweep form posts option values STRAIGHT into
// /api/bracketlab. When a value the form can send is not a value the backend
// accepts, nothing catches it: the server throws, the page alerts, and the tab
// simply never launches. That is exactly how #swLayout shipped with the display
// strings ("70/15/15") in its value attributes instead of the backend tokens
// ("split70") — every Start sweep click failed, and no test noticed (owner,
// 2026-08-16).
//
// These tests read the ACTUAL option values and check them against the ACTUAL
// backend allow-lists, both taken from source rather than restated here.
// Restating the lists would make the test agree with a copy of the contract
// instead of the contract.
//
// CHANGED 2026-08-21. The page no longer carries its own option lists; every
// dropdown is drawn from lib/vocabulary.js, which reads the code that
// implements each choice. So `optionValues` now asks the vocabulary rather than
// scraping the page — the same question, put to the thing that now answers it.
// The page copies are what these tests were guarding against, and there are
// none left to guard: the drift they were watching for cannot happen when there
// is one list rather than two. They still earn their place by checking that the
// one list agrees with the validators.
//
// Watched failing 2026-08-16: restoring any one of the three old #swLayout
// values fails sweepLayoutOptionsAreAllAcceptedByTheBackend; dropping the
// weekly-8d option fails sweepOffersEveryBackendGeometry; sending a bare
// $('#swStart').value again fails blankMonthsAreOmittedNotSentEmpty.
//
// Watched failing 2026-08-22: reverting the declared block to
// `entry === 'market' ? … : …` fails declaredBlockSendsOnlyWhatTheValidatorAccepts.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const { GEOMETRIES } = require('../lib/dataset');

const ROOT = path.join(__dirname, '..');
const SWEEP = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
const BATCH = fs.readFileSync(path.join(ROOT, 'lib', 'batch.js'), 'utf8');

// The values a named dropdown will offer. The page names which list it wants
// (`vocabOptions('tHours', ...)`), and the list itself comes from the system —
// so this follows the page's own pointer to the real source rather than reading
// a copy. Returns [] when the select is absent, which the callers assert against.
const { vocabulary } = require('../lib/vocabulary');
const VOCAB = vocabulary();

function optionValues(src, selectId) {
  const open = src.indexOf(`<select id="${selectId}"`);
  if (open < 0) return [];
  const close = src.indexOf('</select>', open);
  const block = src.slice(open, close);
  const asks = /vocabOptions\(\s*'([^']+)'/.exec(block);
  if (asks) {
    const list = VOCAB[asks[1]];
    assert.ok(list, `${selectId} asks for a choice list called "${asks[1]}" and the system publishes no such list`);
    return list.map((o) => o.value);
  }
  // A dropdown still carrying its own options is itself worth failing on now.
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

  // The declared block must send exactly what the run can use — no more, and no
  // LESS. Both halves have bitten:
  //
  //   * Too much: the validator THROWS on a parameter that cannot apply (a rail
  //     distance under a plain market entry) rather than ignoring it, so a form
  //     that oversends turns replication mode into a launch failure.
  //   * Too little: the boxes were hidden, and so unsent, whenever the entry box
  //     read market or the trail box read static — even with permute ticked
  //     beside them, which puts breakout and following stops in the run. The
  //     first came back as a refusal naming a control that was not on screen;
  //     the second quietly scored every following stop at an arm of 0x, a value
  //     the operator never saw (owner, 2026-08-22).
  //
  // So the condition, not the entry box, decides.
  declaredBlockSendsOnlyWhatTheValidatorAccepts() {
    assert.ok(/id="swDecOn"/.test(SWEEP), 'the Sweep form must carry the declared-config toggle');
    // THE RAILS RIDE WITH BREAKOUT, and breakout is in the run when the box
    // says so OR when its permute is ticked (owner, 2026-08-22). Reading the
    // box alone sent no gate and no distance for a permuted entry, and the
    // launch came back refused. A plain market run still sends neither.
    assert.ok(/const rails = entry !== 'market' \|\| dp\.entry;/.test(SWEEP),
      'the rails must be sent whenever breakout is in the run, not only when the box reads breakout');
    // an arm rides with a MOVING stop, which a permuted trail also puts in the run
    assert.ok(/const movingStop = trailRaw \|\| dp\.trail;/.test(SWEEP),
      'an arm must be sent whenever a following stop is in the run');
    assert.ok(/\.\.\.\(trailRaw \? \{ trailMult: Number\(trailRaw\) \} : \{\}\)/.test(SWEEP),
      'a trailMult may be sent only when the box actually names one');
    assert.ok(/\.\.\.\(movingStop \? \{ armMult: Number\(\$\('#swDecArm'\)\.value\) \} : \{\}\)/.test(SWEEP),
      'the arm must come from the box on screen, never from a value chosen in code');
    // what those conditions actually PRODUCE is checked against the server's own
    // expansion in tests/test-permutefields.js — this is the source-level guard.
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
  // So a box may only carry a max where the BACKEND really caps, and it must be
  // the same number.
  //
  // promote top K is a real structural limit — the list only ever holds detailK
  // rows, so a larger number could not be honoured by anything. null boards was
  // not: 24 was a ceiling this software picked on how strong a claim the owner
  // may attempt, and it was removed on 2026-08-22 (see
  // drawCountHasNoCeilingTheSoftwarePicked in test-bracket.js). The two are
  // checked from opposite sides for exactly that reason.
  clampedNumberInputsCarryTheirBackendBounds() {
    const tagOf = (id) => {
      const m = SWEEP.match(new RegExp(`<input id="${id}"[^>]*>`));
      assert.ok(m, `the Sweep form must still carry #${id}`);
      return m[0];
    };
    const capped = [{ id: 'swK', max: 50, why: 'promoteK is capped at detailK 50 in lib/batch.js' }];
    for (const b of capped) {
      const max = tagOf(b.id).match(/max="(\d+)"/);
      assert.ok(max, `#${b.id} must carry a max attribute — ${b.why}`);
      assert.strictEqual(Number(max[1]), b.max,
        `#${b.id} max must match the backend cap (${b.max}) — ${b.why}`);
    }
    // and the other way round: a box the backend does NOT cap must not invent
    // one, or the form refuses a run the system would have accepted
    const uncapped = [{ id: 'swNulls', param: 'labelShiftReps' }];
    for (const b of uncapped) {
      assert.ok(!/max="/.test(tagOf(b.id)),
        `#${b.id} carries a max that ${b.param} does not — the form refuses what the backend accepts`);
      assert.ok(!new RegExp(`${b.param}:\\s*Math\\.min`).test(BATCH),
        `${b.param} is capped in lib/batch.js again — the box would then silently understate the run`);
    }
  },

  // THE COST REPORT IS WHAT REPLACED THE CAP, so it has to be right. A ceiling
  // that is wrong refuses a run; a cost that is wrong lets the owner start one
  // they would not have chosen, which is worse. Run out of the shipped function
  // rather than restated here — a formula copied into a test only proves the copy.
  //
  // Watched failing 2026-08-22: changing the multiplier to n fails
  // theNullBoardCostIsStatedCorrectly.
  theNullBoardCostIsStatedCorrectly() {
    const from = SWEEP.indexOf('  const syncNullCost = () => {');
    assert.ok(from > 0, 'the null boards cost report must still exist');
    const body = SWEEP.slice(SWEEP.indexOf('const el =', from), SWEEP.indexOf('\n  };', from));
    const say = (typed) => {
      let out = '';
      const $ = (sel) => (sel === '#swNullCost'
        ? { set textContent(v) { out = v; }, set innerHTML(v) { out = v; } }
        : { value: typed });
      // eslint-disable-next-line no-new-func
      new Function('$', body)($);
      return out.replace(/<\/?b>/g, '');
    };
    assert.ok(/nothing to measure/.test(say('0')), 'no boards must say the run has nothing to compare against');
    assert.ok(/nothing to measure/.test(say('')), 'an empty box is no boards, not a broken report');
    for (const n of [1, 2, 19, 24, 200, 1000]) {
      const said = say(String(n));
      assert.ok(said.includes(`${n + 1}x the work`),
        `${n} boards is ${n + 1} passes of the run, and the report says: ${said}`);
      assert.ok(said.includes(`1-in-${n + 1}`),
        `beating all ${n} is a 1-in-${n + 1} claim, and the report says: ${said}`);
      assert.ok(/promote top K stops applying/.test(said),
        'the report must say that any number above zero makes promote top K stop applying');
    }
    // the one number worth knowing, offered only while it is still ahead
    assert.ok(/9 more would reach 1-in-20/.test(say('10')), '10 boards is 9 short of 1-in-20');
    assert.ok(!/more would reach/.test(say('19')), '19 already reaches it — do not ask for more');
    assert.ok(!/more would reach/.test(say('40')), 'past it, the prompt is noise');
  },
};
