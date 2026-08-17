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
// the label de-duplication makes theSetHasNoDuplicates fail; removing the cap
// check makes runawayExpansionIsRefusedLoudly fail; and deleting the
// `declaredPermute` forward in server.js fails the repo's own
// everyBracketParamSurvivesTheApi guard in test-bracket.js.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const { expandDeclared } = require('../lib/batch');

const ROOT = path.join(__dirname, '..');
const GRID = {
  entries: ['breakout', 'market'],
  gates: ['always', 'active', 'directional'],
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
    assert.strictEqual(expandDeclared(BASE, { gate: true }, GRID).length, 3);
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

  // Every declared config is scored on every asset, so the count multiplies the
  // run. Refuse loudly rather than starting something that runs for days.
  runawayExpansionIsRefusedLoudly() {
    let threw = null;
    try {
      expandDeclared(BASE, { dMult: true, tHours: true, gate: true, agree: true }, GRID);
    } catch (e) { threw = e; }
    assert.ok(threw, 'a runaway expansion must be refused');
    assert.ok(/over the 500 cap/.test(threw.message), 'the refusal names the cap');
    assert.ok(/\d+ configs/.test(threw.message), 'and says how many were asked for');
  },

  // A run's own grid decides the menus, not the library's — a custom grid must
  // not silently expand into cells the run never computes.
  expansionUsesTheRunsOwnGrid() {
    const narrow = { ...GRID, dMults: [0.5, 1] };
    assert.strictEqual(expandDeclared({ ...BASE, dMult: 1 }, { dMult: true }, narrow).length, 2);
  },

  // The screen must offer the ticks and send them, or the feature is unreachable.
  theSweepFormOffersAndSendsThePermuteTicks() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'constructing.js'), 'utf8');
    for (const id of ['swPermDecEntry', 'swPermDecGate', 'swPermDecD', 'swPermDecT',
      'swPermDecTrail', 'swPermDecArm', 'swPermDecAgree']) {
      assert.ok(new RegExp(`id="${id}"`).test(ui), `the replication row must offer #${id}`);
    }
    assert.ok(/body\.declaredPermute = dp/.test(ui), 'the ticks must reach the request body');
    assert.ok(/Object\.values\(dp\)\.some\(Boolean\)/.test(ui),
      'with nothing ticked the key must be omitted, so the single path is untouched');
    // and the count must be visible BEFORE Start sweep, not discovered from a refusal
    assert.ok(/id="swDecCount"/.test(ui), 'the form must show how many configs the ticks declare');
  },

  // The replication table the tick's own tooltip promises must exist on the tab.
  // It was absent for two days: the tick worked, the run recorded the rows, and
  // the tab showed nothing (owner, 2026-08-17).
  theBoardShowsTheReplicationTable() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'constructing.js'), 'utf8');
    assert.ok(/doc\.replication/.test(ui), 'the Boards section must read the recorded replication rows');
    assert.ok(/Replication — the declared config on every asset/.test(ui),
      'and render them under a named heading');
    assert.ok(/const rows = all\.filter\(\(r\) => r\.nullDealSeed == null\)/.test(ui),
      'null copies score the declared cell too and must never enter the cross-asset count');
    assert.ok(/binom\(pos, hold\.length\)/.test(ui),
      'the tally must be the binomial across assets on the HELD-BACK window');
  },

  // One row per (asset, declared config), tagged so the table can group them.
  theRunRecordsOneReplicationRowPerConfig() {
    const batch = fs.readFileSync(path.join(ROOT, 'lib', 'batch.js'), 'utf8');
    assert.ok(/declaredLabel,/.test(batch), 'each replication row carries its config label');
    assert.ok(/res\.declaredSet && res\.declaredSet\.length/.test(batch),
      'a permuted run records a row per config');
    const work = fs.readFileSync(path.join(ROOT, 'lib', 'bracketwork.js'), 'utf8');
    assert.ok(/allCells\.find\(\(r\) => r\.quorum === q && matchesDeclared\(r, cfg\)\)/.test(work),
      'each config is found among the cells already computed — no extra sweep');
    assert.ok(/d\.cell\.holdout = scoreHold/.test(work),
      'every set member needs its own held-back score or the tally denominator shrinks silently');
  },
};
