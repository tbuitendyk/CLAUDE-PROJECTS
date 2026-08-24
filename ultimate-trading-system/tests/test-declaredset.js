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
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
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
  // CHANGED 2026-08-22: the rows moved to disk and the counting moved with
  // them, so the page asks for the totals instead of computing them over every
  // recorded row. The reading rules did not move — they are checked against
  // lib/replication.js, which is where they now live.
  theBoardShowsTheReplicationTable() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const lib = fs.readFileSync(path.join(ROOT, 'lib', 'replication.js'), 'utf8');
    assert.ok(/api\/batch\/\$\{encodeURIComponent\(doc\.id\)\}\/replication/.test(ui),
      'the Boards section must ask for the replication totals');
    assert.ok(/if \(!tagged \|\| r\.nullDealSeed == null\)/.test(lib),
      'null copies score the declared cell too and must never enter the cross-asset count');
    assert.ok(/if \('nullDealSeed' in r\) \{ tagged = true/.test(lib),
      'untagged runs must be detected, not filtered as if they were tagged');
    assert.ok(/INFERRED, not measured/.test(ui),
      'and an inferred count must say on the page that it is inferred');
    assert.ok(/nullShare/.test(lib), 'the measured null must be computed per configuration');
    // and the browser must never be shipped the rows themselves again
    assert.ok(!/const all = \(doc && doc\.replication\) \|\| \[\]/.test(ui),
      'the page must not read every recorded row — that is what could not be shipped');
  },

  // ONE config gets the table on its own; MANY get a ranked, openable list FIRST
  // (owner, 2026-08-17) — with dozens of configs a wall of tables is unreadable.
  oneConfigGetsATableAndManyGetARankedList() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
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
    const ui = fs.readFileSync(path.join(ROOT, 'lib', 'replication.js'), 'utf8');
    const at = ui.indexOf('scored.sort(');
    assert.ok(at > 0, 'the replication ranking must still exist');
    // the comparator plus the byNull helper it delegates its first key to — a
    // banned statistic could otherwise hide one level down
    const cmp = ui.slice(ui.indexOf('const byNull'), ui.indexOf(';', at));
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
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8')
      + fs.readFileSync(path.join(ROOT, 'lib', 'replication.js'), 'utf8');
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
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(/only sanctioned yardstick \(QC-7\)/.test(ui), 'the measured null must name its rule');
    assert.ok(/knife-edge fit/.test(ui), 'plateau width must say what it guards against');
    assert.ok(/CONTEXT, NOT EVIDENCE/.test(ui), 'the across-asset share must be labelled context');
    assert.ok(/Ranked LAST on purpose/.test(ui), 'and money must say why it is last');
  },

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
    const sync = ui.slice(ui.indexOf('const syncDecEntry'));
    for (const [grp, box, tick] of [
      ['swGrpGate', 'swDecGate', 'swPermDecGate'],
      ['swGrpD', 'swDecD', 'swPermDecD'],
      ['swGrpTrail', 'swDecTrail', 'swPermDecTrail'],
      ['swGrpArm', 'swDecArm', 'swPermDecArm'],
    ]) {
      const at = ui.indexOf(`id="${grp}"`);
      assert.ok(at > 0, `the box and its tick need a group #${grp}`);
      const block = ui.slice(at, ui.indexOf('</div>', at));
      assert.ok(block.includes(`id="${box}"`) && block.includes(`id="${tick}"`),
        `#${grp} must hold both ${box} and its tick ${tick}`);
      assert.ok(new RegExp(`#${grp}`).test(sync), `#${grp} must be shown and hidden as one`);
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

// ---- the ranking itself, EXECUTED --------------------------------------------
//
// Everything above reads the ranking's SOURCE. That is how the ranking shipped
// ordering nothing: it grouped from a list its null copies had already been
// filtered out of, so the headline statistic was structurally null on every run,
// and the comparator's first key returned -1 whenever both sides were null — so
// the `||` chain never reached plateau width or money, and the order was
// arbitrary rather than merely wrong. The source-reading tests all passed. They
// saw the right words in the right order (audit 2026-08-17).
//
// These run the SHIPPED function, lifted out of public/construct.js by name.
// Not a copy of it — a copy would agree with itself.
//
// Watched failing 2026-08-17: grouping from the real-only rows again makes
// theMeasuredNullIsActuallyMeasured report null, and restoring the -1 first key
// makes theOrderFallsThroughToPlateauWidthWhenNoNullExists return C,B,A.
// MOVED 2026-08-22. The ranking lived inside public/construct.js and these
// tests lifted it out by name, because a copy of it in the test would only ever
// have agreed with itself. It now lives in lib/replication.js so it can stream
// rows off disk instead of needing all of them in a browser, which means these
// can simply require the real thing — a strict improvement, and the reading
// rules travelled with it unchanged.
function loadRanker() {
  const { rank } = require('../lib/replication');
  // The old signature took the rows already split; the new one takes a run and
  // reads its rows. Nothing else about the arithmetic changed.
  return (arg) => rank({ id: '__test-no-store', leaders: arg.leaders || [], replication: arg.all }).scored;
}

const repRow = (over) => ({
  trade: 'LTCUSDT', ctx1: null, ctx2: null, geometry: 'daily-3d',
  declaredLabel: 'q1 directional t89h', nullDealSeed: null,
  pnl: 10, trades: 30, holdout: { pnl: 5, trades: 10, vsAlwaysLong: 1 }, ...over,
});

// The caller's real-copy filter, restated the way drawBoards resolves it.
const argOf = (rows, leaders = [], tagged = true) => ({
  all: rows, realRows: rows.filter((r) => r.nullDealSeed == null), tagged, leaders,
});

module.exports.theMeasuredNullIsActuallyMeasured = function () {
  const rank = loadRanker();
  const rows = [
    repRow({ holdout: { pnl: 9, vsAlwaysLong: 1 } }),                       // the real look
    repRow({ nullDealSeed: 1, holdout: { pnl: 2, vsAlwaysLong: 0 } }),      // its copies
    repRow({ nullDealSeed: 2, holdout: { pnl: 4, vsAlwaysLong: 0 } }),
    repRow({ nullDealSeed: 3, holdout: { pnl: 12, vsAlwaysLong: 0 } }),
  ];
  const [g] = rank(argOf(rows));
  assert.strictEqual(g.nullPairs, 3, 'all three dealt-vote copies must be paired against the real look');
  assert.strictEqual(g.nullBeat, 2, 'the real 9 beats 2 and 4, not 12');
  assert.ok(Math.abs(g.nullShare - 2 / 3) < 1e-9, `nullShare must be measured, got ${g.nullShare}`);
  // The ranked list ships summaries only since 2026-08-23 (a 2,772-configuration
  // run made the old shape a 99 MB reply). The rule that a dealt-vote copy is
  // machinery and never an asset row is unchanged; tests/test-payload.js checks
  // it on detail(), which is what returns those rows now.
  assert.strictEqual(g.reals.length, 0, 'the ranked list is carrying per-asset rows again');
  assert.strictEqual(g.realsTotal, 1, 'the count of real rows was lost along with the rows');
  assert.strictEqual(g.holdCount, 1, 'the cross-asset count reads real rows only');
  assert.strictEqual(g.pos, 1);
};

module.exports.nullCopiesNeverEnterTheCrossAssetCount = function () {
  const rank = loadRanker();
  const rows = [
    repRow({ trade: 'LTCUSDT', holdout: { pnl: 5, vsAlwaysLong: 1 } }),
    repRow({ trade: 'XRPUSDT', holdout: { pnl: -2, vsAlwaysLong: -1 } }),
    // three losing null copies must not make the tally look like 1 of 5
    repRow({ trade: 'LTCUSDT', nullDealSeed: 1, holdout: { pnl: -9, vsAlwaysLong: -1 } }),
    repRow({ trade: 'XRPUSDT', nullDealSeed: 1, holdout: { pnl: -9, vsAlwaysLong: -1 } }),
    repRow({ trade: 'XRPUSDT', nullDealSeed: 2, holdout: { pnl: -9, vsAlwaysLong: -1 } }),
  ];
  const [g] = rank(argOf(rows));
  assert.strictEqual(g.holdCount, 2, 'two assets, not five rows');
  assert.strictEqual(g.pos, 1, 'one of the two assets held up');
  assert.strictEqual(g.sum, 3, 'money sums the real looks only (5 + -2)');
  assert.strictEqual(g.nullPairs, 3, 'but the nulls still count as the measured null');
};

module.exports.theOrderFallsThroughToPlateauWidthWhenNoNullExists = function () {
  const rank = loadRanker();
  const mk = (label, region, pnl) => [
    repRow({ declaredLabel: label, trade: `${label}USDT`, holdout: { pnl, vsAlwaysLong: 1 } }),
  ];
  const rows = [...mk('A', 9, 1), ...mk('B', 1, 3), ...mk('C', 5, 2)];
  const leaders = [
    { trade: 'AUSDT', ctx1: null, ctx2: null, geometry: 'daily-3d', region: { size: 9 } },
    { trade: 'BUSDT', ctx1: null, ctx2: null, geometry: 'daily-3d', region: { size: 1 } },
    { trade: 'CUSDT', ctx1: null, ctx2: null, geometry: 'daily-3d', region: { size: 5 } },
  ];
  const order = rank(argOf(rows, leaders)).map((g) => g.label);
  assert.deepStrictEqual(order, ['A', 'C', 'B'],
    'with no measured null anywhere the order must fall through to plateau width (9, 5, 1), not collapse');
};

module.exports.theMeasuredNullOutranksPlateauWidthAndMoney = function () {
  const rank = loadRanker();
  const rows = [
    // WIDE plateau, big money, but its own copies beat it
    repRow({ declaredLabel: 'wide', trade: 'WUSDT', holdout: { pnl: 50, vsAlwaysLong: 1 } }),
    repRow({ declaredLabel: 'wide', trade: 'WUSDT', nullDealSeed: 1, holdout: { pnl: 99, vsAlwaysLong: 0 } }),
    // narrow plateau, small money, but it beat its own copy
    repRow({ declaredLabel: 'narrow', trade: 'NUSDT', holdout: { pnl: 2, vsAlwaysLong: 1 } }),
    repRow({ declaredLabel: 'narrow', trade: 'NUSDT', nullDealSeed: 1, holdout: { pnl: 1, vsAlwaysLong: 0 } }),
  ];
  const leaders = [
    { trade: 'WUSDT', ctx1: null, ctx2: null, geometry: 'daily-3d', region: { size: 30 } },
    { trade: 'NUSDT', ctx1: null, ctx2: null, geometry: 'daily-3d', region: { size: 2 } },
  ];
  const order = rank(argOf(rows, leaders)).map((g) => g.label);
  assert.deepStrictEqual(order, ['narrow', 'wide'],
    'the measured null leads: beating your own copies outranks a wide plateau and more money');
};
