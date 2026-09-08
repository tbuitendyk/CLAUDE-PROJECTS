// PERMUTING THE REPLICATION ROW (owner, 2026-08-17). The single declared config
// is the strongest reading available — one cell, named before the run, scored
// once per asset, no shopping. It must keep working EXACTLY as it did. What is
// added is the option to declare a SET instead, so the replication table can be
// read for a wide region rather than a single point.
//
// The rule these tests defend: a permuted set can never contain a config the
// single path would have refused. One validator decides what is legal, and the
// expansion runs every member through it.
//
// Watched failing 2026-08-17: returning the raw cartesian product without
// validateDeclared lets marketEntryNeverGainsRailsItCannotHave through; dropping
// the label de-duplication makes theSetHasNoDuplicates fail; reinstating a cap
// check makes aLargeExpansionIsBuiltNotRefused fail; and deleting the
// `declaredPermute` forward in server.js fails the repo's own
// everyBracketParamSurvivesTheApi guard in test-bracket.js.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const { expandDeclared } = require('../lib/declared');

const ROOT = path.join(__dirname, '..');
const GRID = {
  entries: ['breakout', 'market'],
  gates: ['active', 'directional'],
  dMults: [0.25, 0.5, 0.75, 1, 1.5],
  tHours: [17, 41, 65, 89, 113, 137, 161],
  trailMults: [0.5, 1, 1.5, 2],
  armMults: [0, 0.5, 1],
};
const BASE = { entry: 'breakout', gate: 'directional', dMult: 1.5, tHours: 65, quorumSingles: 2, quorumContexts: 3 };

module.exports = {
  // THE promise: nothing ticked behaves exactly as the single declared config.
  noPermuteTickLeavesTheSingleConfigUntouched() {
    const one = expandDeclared(BASE, {}, GRID);
    assert.strictEqual(one.length, 1, 'no permute tick declares exactly one config');
    assert.strictEqual(one[0].entry, 'breakout');
    assert.strictEqual(one[0].gate, 'directional');
    assert.strictEqual(one[0].dMult, 1.5);
    assert.strictEqual(one[0].tHours, 65);
    assert.strictEqual(one[0].quorumSingles, 2);
    assert.strictEqual(one[0].quorumContexts, 3);
    // and an absent declaration stays absent
    assert.deepStrictEqual(expandDeclared(null, { dMult: true }, GRID), []);
  },

  // Each ticked box multiplies the set by that box's menu.
  eachTickMultipliesBytheMenuItPermutes() {
    assert.strictEqual(expandDeclared(BASE, { dMult: true }, GRID).length, 5);
    assert.strictEqual(expandDeclared(BASE, { tHours: true }, GRID).length, 7);
    assert.strictEqual(expandDeclared(BASE, { gate: true }, GRID).length, 2);
    assert.strictEqual(expandDeclared(BASE, { dMult: true, tHours: true }, GRID).length, 35);
    // agree is a count PER committee size, so it multiplies by both
    assert.strictEqual(expandDeclared(BASE, { agree: true }, GRID).length, 48);
  },

  // Market entry has no rails. Permuting must never hand it a gate or a
  // distance — the validator refuses those, so a set containing one would turn
  // replication mode into a launch failure.
  marketEntryNeverGainsRailsItCannotHave() {
    const set = expandDeclared({ entry: 'market', tHours: 65, quorumSingles: 2 },
      { gate: true, dMult: true, trail: true, arm: true, tHours: true }, GRID);
    assert.strictEqual(set.length, 7, 'only the horizon can vary for a market cell');
    for (const c of set) {
      assert.strictEqual(c.entry, 'market');
      assert.strictEqual(c.gate, 'directional', 'market is directional by definition');
      assert.strictEqual(c.dMult, null, 'market has no rail distance');
    }
  },

  // Permuting entry itself yields both shapes, each legal on its own terms.
  permutingEntryYieldsBothShapesEachLegal() {
    const set = expandDeclared(BASE, { entry: true }, GRID);
    const market = set.filter((c) => c.entry === 'market');
    const breakout = set.filter((c) => c.entry === 'breakout');
    assert.ok(market.length && breakout.length, 'both entry styles are present');
    for (const c of market) assert.strictEqual(c.dMult, null);
    for (const c of breakout) assert.ok(c.dMult != null);
  },

  // The static (opposite-rail) stop is a real choice and must survive permuting
  // trail — otherwise ticking permute silently drops the setting the single
  // path defaults to.
  permutingTrailKeepsTheStaticStop() {
    const set = expandDeclared(BASE, { trail: true }, GRID);
    assert.ok(set.some((c) => c.trailMult == null), 'the static stop stays in the set');
    assert.ok(set.some((c) => c.trailMult === 2), 'and the trailing ones join it');
    // arm never travels without a trail
    for (const c of set) {
      if (c.trailMult == null) assert.strictEqual(c.armMult, null, 'no arm without a trail');
    }
  },

  // Two expansions landing on the same cell must be scored once, not twice —
  // a duplicated config would double that cell's weight in the tally.
  theSetHasNoDuplicates() {
    const set = expandDeclared(BASE, { dMult: true, tHours: true }, GRID);
    const labels = set.map((c) => c.label);
    assert.strictEqual(new Set(labels).size, labels.length, 'every config in the set is distinct');
  },

  // Ticking permute on a box that cannot apply must NOT multiply the set with
  // copies of the same config. arm means nothing while the trail is static, so
  // permuting arm alone declares one config, not three.
  aPermuteThatCannotApplyDoesNotInflateTheSet() {
    const set = expandDeclared(BASE, { arm: true }, GRID);
    assert.strictEqual(set.length, 1, 'arm cannot vary while the stop is static');
    assert.strictEqual(set[0].armMult, null);
    assert.strictEqual(set[0].trailMult, null);
  },

  // NO CAP. The owner's rule: software reports the number, the human decides.
  // A large expansion must be BUILT and returned, not refused on a number the
  // software invented for itself.
  aLargeExpansionIsBuiltNotRefused() {
    const set = expandDeclared(BASE, { dMult: true, tHours: true, gate: true, agree: true }, GRID);
    // 5 d x 7 t x 3 gates x (6 singles x 8 contexts) = 3360
    assert.strictEqual(set.length, 3360, 'every combination is declared, none refused');
    for (const c of set) assert.ok(c.label, 'and each one is a validated config');
  },

  // A run's own grid decides the menus, not the library's — a custom grid must
  // not silently expand into cells the run never computes.
  expansionUsesTheRunsOwnGrid() {
    const narrow = { ...GRID, dMults: [0.5, 1] };
    assert.strictEqual(expandDeclared({ ...BASE, dMult: 1 }, { dMult: true }, narrow).length, 2);
  },

  // The screen must offer the ticks and send them, or the feature is unreachable.
  //
  // RE-AIMED 2026-08-28 at the surviving Sweep. The old form's ticks were named
  // swPermDec* and rode on a declaredPermute key; the three-stage Sweep names
  // them swPerm* and sends them as cellPermute, plus four more the old form
  // never had — the agreement is its own dimension now and every part of it
  // permutes. The property is unchanged: every tick on screen must reach the
  // request, and the count must be readable before the button is pressed.
  theSweepFormOffersAndSendsThePermuteTicks() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    for (const id of ['swPermEntry', 'swPermGate', 'swPermD', 'swPermT', 'swPermTrail', 'swPermArm',
      'swPermDec', 'swPermBand', 'swPermWk',
      'swPermAgreeRule', 'swPermAgreeShare', 'swPermAgreeBoth', 'swPermAgreeHold']) {
      assert.ok(new RegExp(`id="${id}"`).test(ui), `the block must offer #${id}`);
    }
    // EVERY ONE OF THEM MUST BE READ. A tick on screen that the block never
    // asks about is a control that does nothing, which is the whole fault this
    // test exists for.
    const at = ui.indexOf('function swBlockParams()');
    const fn = ui.slice(at, ui.indexOf('\n}', at));
    for (const id of ['swPermEntry', 'swPermGate', 'swPermD', 'swPermT', 'swPermTrail', 'swPermArm',
      'swPermDec', 'swPermBand', 'swPermWk',
      'swPermAgreeRule', 'swPermAgreeShare', 'swPermAgreeBoth', 'swPermAgreeHold']) {
      assert.ok(fn.includes(`#${id}`), `#${id} is on screen but the block never reads it — the tick does nothing`);
    }
    // and the count must be visible BEFORE start stage 3, not discovered from a refusal
    assert.ok(/id="swCount"/.test(ui), 'the form must show how many settings the ticks declare');
  },


  // REMOVED 2026-08-28 with the screen it named: oneConfigGetsATableAndManyGetARankedList
  // held the deleted Boards to showing one declared config as a plain table and
  // many as a ranked, openable list. The three-stage Boards has no single-config
  // case — every stage 3 record set is a block of settings, always ranked, and
  // its own table checks are in tests/test-stages.js.



  // REMOVED 2026-08-28 with the columns it named: everyRankedColumnCarriesItsReadingRule
  // held four hover rules on the deleted Boards' ranked replication list — the
  // measured null as the only sanctioned yardstick, plateau width against a
  // knife-edge fit, the across-asset share as context not evidence, and money
  // ranked last on purpose. None of those four columns exists on the
  // three-stage Boards. The rule they enforced — every column says how to read
  // it — is enforced there by tests/test-help.js, which makes every control's
  // hover come from its Help entry, and by test-stages.js on the sort buttons.

  // Each tab remembers its OWN theme (owner, 2026-08-17).
  constructingRemembersItsOwnTheme() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const trading = fs.readFileSync(path.join(ROOT, 'public', 'trade.html'), 'utf8');
    assert.ok(/getItem\('cx-theme'\)/.test(ui) && /setItem\('cx-theme'/.test(ui),
      'Constructing must read and write its own theme key');
    assert.ok(!/lt-theme/.test(ui), 'and must no longer share the Trading page key');
    assert.ok(/lt-theme/.test(trading), 'Trading keeps its own key, unchanged');
  },

  // A permute tick belongs to its box and must vanish with it — left alone they
  // were ticks for controls that were not on screen (owner, 2026-08-17).
  // A tick must never outlive the box it belongs to. CHANGED 2026-08-21: the
  // box and its tick are now ONE GROUP rather than two items hidden in step,
  // which satisfies this more strongly — there is no longer a way to hide one
  // and leave the other, because there is only one thing to hide. The question
  // is the same; it is now put to the group.
  permuteTicksHideWithTheBoxTheyBelongTo() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const sync = ui.slice(ui.indexOf('async function swCounts()'));
    for (const [grp, box, tick] of [
      ['swGrpGate', 'swGate', 'swPermGate'],
      ['swGrpD', 'swD', 'swPermD'],
      ['swGrpTrail', 'swTrail', 'swPermTrail'],
      ['swGrpArm', 'swArm', 'swPermArm'],
    ]) {
      const at = ui.indexOf(`id="${grp}"`);
      assert.ok(at > 0, `the box and its tick need a group #${grp}`);
      const block = ui.slice(at, ui.indexOf('</div>', at));
      assert.ok(block.includes(`id="${box}"`) && block.includes(`id="${tick}"`),
        `#${grp} must hold both ${box} and its tick ${tick}`);
      assert.ok(new RegExp(`#${grp}`).test(sync), `#${grp} must be shown and hidden as one`);
    }
    // AND HIDING MUST PUT THE ROW BACK AS IT WAS. The groups lay out with
    // flex; setting display to '' on the way back leaves the browser to guess,
    // and a block would stack the box above its tick.
    assert.ok(/e\.style\.display = on \? 'flex' : 'none';/.test(ui),
      'a group that comes back must come back laid out the way it was drawn');
  },

};
