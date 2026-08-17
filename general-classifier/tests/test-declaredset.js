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

  // NO CAP. The owner's rule: software reports the number, the human decides.
  // A large expansion must be BUILT and returned, not refused on a number the
  // software invented for itself.
  aLargeExpansionIsBuiltNotRefused() {
    const set = expandDeclared(BASE, { dMult: true, tHours: true, gate: true, agree: true }, GRID);
    // 5 d x 7 t x 3 gates x (6 singles x 8 contexts) = 5040
    assert.strictEqual(set.length, 5040, 'every combination is declared, none refused');
    for (const c of set) assert.ok(c.label, 'and each one is a validated config');
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
    assert.ok(/rows = all\.filter\(\(r\) => r\.nullDealSeed == null\)/.test(ui),
      'null copies score the declared cell too and must never enter the cross-asset count');
    assert.ok(/const tagged = all\.some\(\(r\) => 'nullDealSeed' in r\)/.test(ui),
      'untagged docs must be detected, not filtered as if they were tagged');
    assert.ok(/INFERRED, not measured/.test(ui),
      'and an inferred count must say on the page that it is inferred');
    // the reading that counts is the config against ITS OWN dealt-vote copies
    assert.ok(/nullShare/.test(ui), 'the measured null must be computed per configuration');
  },

  // ONE config gets the table on its own; MANY get a ranked, openable list FIRST
  // (owner, 2026-08-17) — with dozens of configs a wall of tables is unreadable.
  oneConfigGetsATableAndManyGetARankedList() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'constructing.js'), 'utf8');
    assert.ok(/if \(scored\.length === 1\)/.test(ui), 'a single config keeps the plain table');
    assert.ok(/Replication — the declared config on every asset/.test(ui), 'under its own heading');
    assert.ok(/declared configs, ranked/.test(ui), 'many configs get a ranked list');
    assert.ok(/<details/.test(ui) && /<summary/.test(ui), 'each line opens for its per-asset detail');
    assert.ok(/overflow-y:auto/.test(ui), 'and the list scrolls');
  },

  // QC-142 ENFORCEMENT. An ordering IS a claim about which row is better, so a
  // statistic the register bans as evidence may not appear in a sort key —
  // silently making the very claim the ban exists to prevent. QC-7 bans the
  // binomial p across assets: units are correlated and the measured null is the
  // only yardstick. This reads the comparator's own inputs.
  //
  // Watched failing 2026-08-17: restoring `a.p - b.p` as the first key fails
  // here, which is exactly the defect that shipped before the owner caught it.
  noSortKeyIsBuiltFromAStatisticTheRegisterBans() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'constructing.js'), 'utf8');
    const at = ui.indexOf('scored.sort(');
    assert.ok(at > 0, 'the replication ranking must still exist');
    const cmp = ui.slice(at, ui.indexOf(';', at));
    const BANNED = [
      { re: /\bbinom\b/, why: 'a binomial p across correlated assets (QC-7)' },
      { re: /\.p\b/, why: 'a p-value (QC-7 bans quoting one as evidence)' },
      { re: /pFloor/, why: 'a p floor is a floor, not a measure of strength' },
    ];
    for (const b of BANNED) {
      assert.ok(!b.re.test(cmp), `the sort key is built from ${b.why} — an ordering is a claim`);
    }
    // and it must lead on what the register DOES admit
    const nullIdx = cmp.indexOf('nullShare');
    const regionIdx = cmp.indexOf('region');
    const sumIdx = cmp.indexOf('b.sum - a.sum');
    assert.ok(nullIdx > 0, 'the measured null must be in the sort key');
    assert.ok(regionIdx > nullIdx, 'plateau width comes after the measured null');
    assert.ok(sumIdx > regionIdx, 'money is the LAST tiebreak, never earlier');
  },

  // A banned statistic must not be computed for display either, once nothing
  // legitimately needs it — dead code that produces one is an invitation.
  theBannedStatisticIsNotComputedAtAll() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'constructing.js'), 'utf8');
    assert.ok(!/const binom = /.test(ui), 'the binomial helper must be gone, not merely unused');
    // NOT banned, and must not be "cleaned up" by a later reader: the
    // 1-in-(N+1) RESOLUTION FLOOR of N measured null draws. That is the
    // register's own sanctioned framing — the strongest claim a given number of
    // draws can support, stated as a floor. What QC-7 bans is a binomial p
    // computed ACROSS CORRELATED ASSETS, which is a different quantity entirely.
    assert.ok(/1-in-\(N\+1\) claim/.test(ui),
      'the resolution floor of a measured null is admitted and must stay');
  },

  // The columns carry their reading rules, or a number is shown that will be
  // misread — these four are misread in opposite directions if swapped.
  everyRankedColumnCarriesItsReadingRule() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'constructing.js'), 'utf8');
    assert.ok(/only sanctioned yardstick \(QC-7\)/.test(ui), 'the measured null must name its rule');
    assert.ok(/knife-edge fit/.test(ui), 'plateau width must say what it guards against');
    assert.ok(/CONTEXT, NOT EVIDENCE/.test(ui), 'the across-asset share must be labelled context');
    assert.ok(/Ranked LAST on purpose/.test(ui), 'and money must say why it is last');
  },

  // Each tab remembers its OWN theme (owner, 2026-08-17).
  constructingRemembersItsOwnTheme() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'constructing.js'), 'utf8');
    const trading = fs.readFileSync(path.join(ROOT, 'public', 'trading.html'), 'utf8');
    assert.ok(/getItem\('cx-theme'\)/.test(ui) && /setItem\('cx-theme'/.test(ui),
      'Constructing must read and write its own theme key');
    assert.ok(!/lt-theme/.test(ui), 'and must no longer share the Trading page key');
    assert.ok(/lt-theme/.test(trading), 'Trading keeps its own key, unchanged');
  },

  // A permute tick belongs to its box and must vanish with it — left alone they
  // were ticks for controls that were not on screen (owner, 2026-08-17).
  permuteTicksHideWithTheBoxTheyBelongTo() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'constructing.js'), 'utf8');
    for (const id of ['swPermDecGateWrap', 'swPermDecDWrap', 'swPermDecTrailWrap', 'swPermDecArmWrap']) {
      assert.ok(new RegExp(`id="${id}"`).test(ui), `the tick needs its own wrapper #${id}`);
      assert.ok(new RegExp(`#${id}`).test(ui.slice(ui.indexOf('const syncDecEntry'))),
        `#${id} must be shown/hidden alongside its box`);
    }
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
