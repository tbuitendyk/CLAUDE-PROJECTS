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
  // NOT uniform across the launchers: historytuning answers { batchId }, httwo
  // answers { started, id, … }, and the three stages answer { id, name, units }
  // (stage 3 adds settings). Reading the wrong key renders a blank forever, and
  // "fix them all to the same word" would break the ones that were right. Each
  // key is read from the backend source, so the check tracks the contract
  // instead of a memory of it.
  //
  // RE-AIMED 2026-08-28. The bracketlab row named #swMsg, which was on the
  // deleted Sweep. The three stage launchers replace it, and they are held to
  // the stronger version of the same rule: EVERY key their message reads has to
  // be a key their own backend function returns.
  everyLauncherReadsTheRunIdKeyItsBackendReturns() {
    const STAGES = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    const LAUNCHERS = [
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
    // THE THREE STAGES. Every out.<key> the message reads must be returned by
    // the function behind that stage's route, read from lib/stages.js rather
    // than restated here.
    for (const [out, fn] of [['swOut1', 'function startStage1'], ['swOut2', 'function startStage2'], ['swOut3', 'function startStage3']]) {
      const at = SWEEP.indexOf(`say('#${out}'`);
      assert.ok(at > 0, `#${out} must still report what was launched`);
      const said = SWEEP.slice(at, SWEEP.indexOf('`)', at));
      const keys = [...said.matchAll(/\bgot\.(\w+)/g)].map((m) => m[1]);
      assert.ok(keys.length, `#${out} reports nothing about the launch it just made`);
      const fnAt = STAGES.indexOf(fn);
      assert.ok(fnAt > 0, `${fn} must still exist to read the contract from`);
      const ret = STAGES.slice(fnAt).match(/\n  return \{([^}]*)\};/);
      assert.ok(ret, `${fn} must still answer with an object literal`);
      const returned = new Set([...ret[1].matchAll(/(\w+)\s*[:,}]/g)].map((m) => m[1]));
      for (const k of keys) {
        assert.ok(returned.has(k),
          `#${out} reads out.${k} but ${fn} returns { ${[...returned].join(', ')} } — it renders blank`);
      }
    }
  },

  // The block must send exactly what the run can use — no more, and no LESS.
  // Both halves have bitten:
  //
  //   * Too much: the validator THROWS on a parameter that cannot apply (a rail
  //     distance under a plain market entry) rather than ignoring it, so a form
  //     that oversends turns a launch into a failure.
  //   * Too little: the boxes were hidden, and so unsent, whenever the entry box
  //     read market or the trail box read static — even with permute ticked
  //     beside them, which puts breakout and following stops in the run. The
  //     first came back as a refusal naming a control that was not on screen;
  //     the second quietly scored every following stop at an arm of 0x, a value
  //     the operator never saw (owner, 2026-08-22).
  //
  // So the condition, not the entry box, decides.
  //
  // RE-AIMED 2026-08-28 at swBlockParams, which is where the three-stage Sweep
  // builds the block. The old declared-config toggle went with its screen: on
  // the three-stage Sweep the block is always declared, so there is nothing to
  // switch on. The two conditions below are the ones that bit, in their new
  // spelling, and they are read out of that one function rather than the file
  // at large — a match anywhere else would not prove the block is built right.
  declaredBlockSendsOnlyWhatTheValidatorAccepts() {
    const at = SWEEP.indexOf('function swBlockParams()');
    assert.ok(at > 0, 'the Sweep form must still build its block in one named place');
    const fn = SWEEP.slice(at, SWEEP.indexOf('\n}', at));
    // THE RAILS RIDE WITH BREAKOUT, and breakout is in the run when the box
    // says so OR when its permute is ticked (owner, 2026-08-22). Reading the
    // box alone sent no gate and no distance for a permuted entry, and the
    // launch came back refused. A plain market run still sends neither.
    assert.ok(/if \(entry !== 'market' \|\| permEntry\) \{/.test(fn),
      'the rails must be sent whenever breakout is in the run, not only when the box reads breakout');
    for (const part of ["cell.gate = \$('#swGate').value;", "cell.dMult = Number(\$('#swD').value);"]) {
      assert.ok(fn.includes(part), `${part} is no longer sent with the rails`);
    }
    assert.ok(/\} else \{\n\s*cell\.entry = 'market';\n\s*\}/.test(fn),
      'a plain market run must send an entry and nothing else — a rail distance under market is refused by the validator');
    // an arm rides with a MOVING stop, which a permuted trail also puts in the run
    assert.ok(fn.includes("if ($('#swTrail').value !== '') { cell.trailMult = Number($('#swTrail').value); cell.armMult = Number($('#swArm').value); }"),
      'a trailMult may be sent only when the box actually names one, and it must bring its arm');
    assert.ok(fn.includes("else if ($('#swPermTrail').checked) { cell.armMult = Number($('#swArm').value); }"),
      'an arm must be sent whenever a following stop is in the run, and it must come from the box on screen '
      + 'rather than from a value chosen in code');
    // THE AGREEMENT IS ITS OWN DIMENSION and every part of it comes off the
    // screen. The two committee-size counts this used to check went with the
    // share dial that replaced them (test-stages.js holds that).
    for (const k of ['agreeRule', 'agreePct', 'agreeBothModels', 'agreePersist']) {
      assert.ok(new RegExp(`${k}: `).test(fn), `the block no longer carries ${k}`);
    }
  },

  // REMOVED 2026-08-28: declaredQuorumBoxesRespectTheirCommitteeSizes checked
  // that #swDecQ6 offered 1..6 and #swDecQ8 offered 1..8, because an agreement
  // was a COUNT and one number could not mean the same thing on a committee of
  // six and one of eight. Both boxes are gone: the agreement is a share of
  // whatever committee a unit holds, so there is one dial and no size to cap it
  // against. What replaced them is checked in tests/test-stages.js
  // (everyAgreementRuleIsReachableFromTheScreen, noSettingNameCarriesACommitteeSize).

  // Every declared menu value must exist in the run's grid, or validateDeclared
  // throws "must be one of … (this run's grid)" at launch.
  declaredMenusMatchTheBackendGrid() {
    const bracketLib = require('../lib/bracket');
    const cases = [
      ['swEntry', bracketLib.ENTRIES.map(String)],
      ['swGate', bracketLib.GATES.map(String)],
      ['swD', bracketLib.D_MULTS.map(String)],
      ['swT', bracketLib.T_HOURS.map(String)],
      ['swArm', bracketLib.ARM_MULTS.map(String)],
    ];
    for (const [id, allowed] of cases) {
      const offered = optionValues(SWEEP, id);
      assert.ok(offered.length, `the block must carry #${id}`);
      const bad = offered.filter((v) => !allowed.includes(v));
      assert.strictEqual(bad.length, 0,
        `#${id} offers ${bad.join(', ')} — not in the backend grid (${allowed.join(', ')})`);
    }
    // trail additionally allows "" for the stop that sits at a fixed price on
    // the far side of the entry and never moves — the `static` choice
    const trail = optionValues(SWEEP, 'swTrail');
    const allowedTrail = ['', ...bracketLib.TRAIL_MULTS.map(String)];
    const badTrail = trail.filter((v) => !allowedTrail.includes(v));
    assert.strictEqual(badTrail.length, 0,
      `#swTrail offers ${badTrail.join(', ')} — not in the backend grid`);
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
      // The every-coin table's order is applied on the other side, so a value
      // this select offers that the other side does not accept would silently
      // fall back to the default order — the page would CLAIM one ordering and
      // show another, which on a ranked table is a lie about which row won.
      // The stage screens' own orderings all left this list with the controls
      // themselves: the carry follows the sort saved on the parent's table
      // (2026-08-27), and every table is ordered by clicking its columns rather
      // than by a dropdown (owner order, 2026-08-28: "remove obsolete ordering
      // selections as we can do all row ordering by column selections").
      // bCoinSort went the same way on 2026-08-28 with the screen that carried
      // it. The keys those column clicks send are the engine's own list, and
      // tests/test-stages.js (theSavedSortOrdersTheTablesAndTheFirstColumnFollows)
      // holds them to it.
      { id: 'swAgreeRule', allowed: require('../lib/agreement').AGREE_RULES, why: 'lib/agreement.js AGREE_RULES' },
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
      'swEntry', 'swGate', 'swD', 'swT', 'swTrail', 'swArm',
      // free-form or purely local to the page, with no backend allow-list
      'swDec', 'swAgreeShare', 'swAgreeHold', 'glTarget', 'htWin', 'tuneTarget',
      // run-id pickers: every real option is a run id the SERVER listed, so the
      // allow-list is the server's own reply and cannot be restated here. The
      // only literal value in them is the empty placeholder. What these must
      // never be is <input> boxes — test-uicontracts.js pins that.
      't1null', 'cmpA', 'cmpB', 'bPick1', 'bPick2', 'bPick3', 'swFrom2', 'swFrom3',
      // same shape: the campaign picker's options are the names the service
      // itself reports, and a NEW name is typed in the box beside it
      'cxCampPick',
      // same shape again, and the allow-list is enforced rather than restated:
      // every option is the name of a service the machine itself reported, and
      // the control refuses any name that is not in that same list at the
      // moment it is asked (test-servicecontrol.js pins that, and pins that a
      // refused name never reaches systemctl).
      'svcPick',
      // the Funnel's coin-and-shape picker (3.41.0): every unit option is a key
      // the server itself listed for the open set, and the one literal value,
      // 'all', is the blended table -- test-funnel.js
      // (theBlendIsChosenByNameAndNothingChosenIsTheFirstUnit) holds the
      // engine to accepting exactly that literal, and to refusing a key the
      // set does not hold
      'fUnit',
      // the Funnel's Stage 4 record set picker (3.58.0): same shape again --
      // every set option is an id the SERVICE listed for the open coin and
      // shape, and the one literal value, 'new', is the walk and is never sent
      // anywhere. A remembered id the service no longer lists is dropped for
      // the newest rather than asked for (fCutChosen), and the service refuses
      // an id that is not a Stage 4 set at all -- test-funnel.js
      // (aStageFourSetThatWillNotOpenStillDrawsThePicker and
      // theFunnelOffersTheStageFourSetsCutFromTheCoinAndShape) hold both.
      'fCutPick']);
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
    // NOTHING THE BACKEND DOES NOT CAP MAY CARRY A MAX (owner order,
    // 2026-08-23) — or the form refuses a run the system would have accepted.
    //
    // RE-AIMED 2026-08-28. The three boxes this named (null boards, promote top
    // K, board rows) were on the deleted Sweep. The surviving Sweep's own
    // uncapped boxes are the two null set sizes and the two carry counts, and
    // they are held to the same rule.
    const uncapped = [
      { id: 'swNull1', param: 'the stage 1 null set size' },
      { id: 'swNull3', param: 'the stage 3 null set size' },
      { id: 'swCarry', param: 'the stage 2 carry' },
      { id: 'swCarry3', param: 'the stage 3 carry' },
    ];
    for (const b of uncapped) {
      assert.ok(!/max="/.test(tagOf(b.id)),
        `#${b.id} carries a max that ${b.param} does not — the form refuses what the backend accepts`);
    }
    // ...and every one of them must still refuse a negative, which IS a real bound.
    for (const b of uncapped) {
      assert.ok(/min="0"/.test(tagOf(b.id)), `#${b.id} accepts a negative count`);
    }

    // DRIVEN, NOT GREPPED. The first version of this checked the source for
    // `promoteK: Math.min` and `detailK: <number>`, which are the shapes the
    // OLD code used. Restoring either clamp in the shape the new code uses
    // passed it — a test pinned to yesterday's spelling of the fault. So it
    // runs the real mapping and reads the answer.
    const batch = require('../lib/batch');
    const base = { universe: ['LTCUSDT'], sizes: { singles: true }, allLoaded: true, windowLayout: 'split70' };
    const plan = (o) => batch.planFor({ ...base, ...o }).p;

    assert.strictEqual(plan({ promoteK: 200, detailK: 200 }).promoteK, 200,
      'promote top K came back as something other than what was asked for — a number quietly replaced by a '
      + 'different number is worse than a refusal, because the owner goes on believing they set it');
    assert.strictEqual(plan({ detailK: 500 }).detailK, 500,
      'the board size is not the owner\'s — it decides how many rows they ever see');
    assert.strictEqual(plan({}).detailK, 50, 'the default board is still 50, so nothing moves for a run that says nothing');

    // The pair that cannot both be true is refused, naming both boxes.
    let err = null;
    try { plan({ promoteK: 200, detailK: 50 }); } catch (e) { err = e; }
    assert.ok(err, 'promoting more rows than the board keeps was accepted — those rows do not exist to promote');
    assert.ok(/promote top K is 200/.test(err.message) && /keeps 50 rows/.test(err.message),
      `the refusal must name BOTH numbers so it is obvious which to move; got: ${err.message}`);
    assert.ok(/board rows/.test(err.message) && /promote top K/.test(err.message),
      'the refusal must name the two boxes on the screen, not the fields in the code');
    assert.ok(/Nothing has been changed for you/.test(err.message),
      'the refusal does not say that nothing was altered on the owner\'s behalf');
    // THE SCREEN HALF WENT WITH ITS SCREEN, 2026-08-28: the old Sweep said the
    // conflict while it was being typed rather than only after Start sweep.
    // Both boxes were on that screen, so there is no pair left to conflict.
    // The three-stage Sweep keeps the same principle where it still applies —
    // its cost line states the budget refusal before start stage 3 is pressed,
    // out of the same arithmetic the launch enforces (tests/test-stages.js,
    // theBudgetGateDoesTheArithmeticUpFront).
  },

  // REMOVED 2026-08-28: theNullBoardCostIsStatedCorrectly ran the deleted
  // Sweep's syncNullCost out of its own source and checked what it said — that
  // n null boards is (n+1)x the work, that beating all n is a 1-in-(n+1) claim,
  // and that any number above zero makes promote top K stop applying. All three
  // facts belonged to that screen's arithmetic: on the three stages a null set
  // is dealt from votes already kept, costs no training at all, and there is no
  // promote top K for it to switch off. There is nothing to re-aim this at.

  // RECORDS TO PRICE (owner order, 2026-09-02): the stage 3 set-up says
  // "N records" or "Selected records"; under N records the carry forward box
  // decides, 0 for all or N for the top of the sorted table; under Selected
  // records the launch prices exactly what is ticked on the parent's stage 2
  // table. The launch and the cost line both say which.
  theStageThreeSetUpPricesNRecordsOrTheSelectedOnes() {
    // the dropdown draws the engine's own two choices through the vocabulary,
    // so the words on the screen and the values the launch accepts are one list
    assert.ok(SWEEP.includes("records to price<select id=\"swPick3\">${vocabOptions('stage3Pick', 'count')}</select>"),
      'the choice sits beside the carry forward box under its own name, drawn from the vocabulary');
    const stages = require('../lib/stages');
    const offered = require('../lib/vocabulary').vocabulary().stage3Pick;
    assert.deepStrictEqual(offered, [{ value: 'count', label: 'N records' }, { value: 'selected', label: 'Selected records' }],
      'the two choices are named in the owner\'s words');
    assert.deepStrictEqual(offered.map((o) => o.value), stages.PICK_CHOICES, 'and are exactly what the launch accepts');
    const go = SWEEP.slice(SWEEP.indexOf("$('#swGo3').onclick"), SWEEP.indexOf("$('#swGo3').onclick") + 700);
    assert.ok(go.includes("pick: $('#swPick3').value,"), 'the launch says which');
    const count = SWEEP.slice(SWEEP.indexOf("const c3 = $('#swCount');"), SWEEP.indexOf("const c3 = $('#swCount');") + 2200);
    assert.ok(/api\/stage3-count', \{[\s\S]*?\bcarry, pick, units/.test(count), 'and so does the cost line');
    assert.ok(count.includes("$('#swCarry3').disabled = pick === 'selected';"), 'the carry box is held while Selected records is chosen');
    assert.ok(count.includes("? (pick === 'selected' ? pickedN : (carry > 0 ? Math.min(carry, parent.plan.units) : parent.plan.units))"),
      'the unit count on the cost line is the picked count under Selected records');
    assert.ok(SWEEP.includes("setV('#swPick3', p.selected != null ? 'selected' : 'count');"), 'a stage 3 set\'s own choice comes back onto the form');
  },
};
