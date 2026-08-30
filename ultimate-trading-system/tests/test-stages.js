// THE THREE-STAGE SYSTEM'S ARITHMETIC, PENCILLED (owner order, 2026-08-27:
// "write it. adversarial review. deploy"). Every number the stages produce
// rides on the pieces below, so each one is checked against a hand-worked
// answer — and the mutation harness proves these tests bite.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { assert } = require('./helpers');
const sw = require('../lib/stagework');
const stages = require('../lib/stages');
const rowstore = require('../lib/rowstore');

const ROOT = path.join(__dirname, '..');
const SETS_DIR = path.join(ROOT, 'data', 'stagesets');

module.exports = {
  // The fixed rule, by hand: two members over three chunks, labels up /
  // nowhere / down. Pooled surenesses on what happened: 0.35 + 0.65 + 0.5.
  async theForecastScoreMatchesThePencil() {
    const m1 = [[0.2, 0.3, 0.5], [0.1, 0.8, 0.1], [0.6, 0.2, 0.2]];
    const m2 = [[0.4, 0.4, 0.2], [0.3, 0.5, 0.2], [0.4, 0.4, 0.2]];
    const labels = [1, 0, -1];
    assert.ok(Math.abs(sw.forecastScore([m1, m2], labels) - 1.5) < 1e-12, 'the pencil says 1.5');
    // pooling is a MEAN, not a sum — a 4-member unit must not outscore a
    // 3-member unit just by having more members
    assert.deepStrictEqual(sw.pooledAt([m1, m2], 0).map((x) => Math.round(x * 100) / 100), [0.3, 0.35, 0.35]);
    // an order permutes which chunk's votes meet which label
    const s = sw.forecastScore([m1, m2], labels, [2, 0, 1]);
    assert.ok(Math.abs(s - (0.2 + 0.35 + 0.2)) < 1e-12, `dealt score should be 0.75, got ${s}`);
  },

  async theLeadOverTheNullSetMatchesThePencil() {
    assert.strictEqual(sw.leadOver(2, [1, 1, 1]), 0, 'a null set with no spread reads 0, never infinity');
    assert.ok(Math.abs(sw.leadOver(2, [0, 2]) - 1) < 1e-12, 'mean 1, spread 1 → lead 1');
    assert.strictEqual(sw.leadOver(2, []), null, 'no null set → no lead');
  },

  // Deals are reproducible from the seed and differ across draws; the same
  // order serves every member, so agreement survives and only the calendar
  // dies (QC 81 carried over).
  async theDealsAreSeededAndDistinct() {
    const a = sw.dealOrder(123, 'LTCUSDT|||daily-4d', 's1#0', 8);
    const b = sw.dealOrder(123, 'LTCUSDT|||daily-4d', 's1#0', 8);
    const c = sw.dealOrder(123, 'LTCUSDT|||daily-4d', 's1#1', 8);
    assert.deepStrictEqual(a, b, 'the same draw must deal the same order');
    assert.notDeepStrictEqual(a, c, 'two draws must not deal the same order');
    assert.deepStrictEqual(a.slice().sort((x, y) => x - y), [0, 1, 2, 3, 4, 5, 6, 7], 'a deal is a permutation, nothing lost');
  },

  // The stored spread back into a call must read exactly like the engine:
  // argmax scans [-1, 0, 1] with strict >, so ties keep the earlier class.
  async theStoredVoteReadsBackLikeTheLiveOne() {
    assert.strictEqual(sw.callFromProbs([0.4, 0.4, 0.2], 'argmax', null), -1, 'tie keeps the first class, like the engine scan');
    assert.strictEqual(sw.callFromProbs([0.2, 0.4, 0.4], 'argmax', null), 0);
    assert.strictEqual(sw.callFromProbs([0.1, 0.2, 0.7], 'argmax', null), 1);
    // directional goes through the same directionalCall the live paths use
    const { directionalCall } = require('../lib/paper');
    for (const p of [[0.5, 0.2, 0.3], [0.1, 0.3, 0.6], [0.34, 0.33, 0.33]]) {
      assert.strictEqual(sw.callFromProbs(p, 'directional', 0.1),
        directionalCall({ '-1': p[0], 0: p[1], 1: p[2] }, 0.1),
        'the stage 3 directional call must be the engine\'s own');
    }
  },

  // The units enumerator matches the sweep engine's own combo rules: doubles
  // ordered on who is traded, triples unordered on the two alongside.
  async theUnitCountsMatchTheEnginesComboRules() {
    const u3 = ['A', 'B', 'C'];
    const geos = ['weekly-8d', 'daily-4d'];
    assert.strictEqual(stages.unitsFor(u3, { singles: true }, geos).length, 6);
    assert.strictEqual(stages.unitsFor(u3, { doubles: true }, geos).length, 12);
    assert.strictEqual(stages.unitsFor(u3, { triples: true }, geos).length, 6);
    assert.strictEqual(stages.unitsFor(u3, { singles: true, doubles: true, triples: true }, geos).length, 24);
  },

  // The settings block is the sweep's own expandDeclared times the decision,
  // band and 24/5 variants — counted by hand for known ticks.
  async theSettingsBlockCountsByHand() {
    const base = { entry: 'breakout', gate: 'directional', dMult: 1.5, tHours: 65 };
    assert.strictEqual(stages.settingsFor({ cell: base }).length, 1, 'no permute → one setting');
    assert.strictEqual(stages.settingsFor({ cell: base, cellPermute: { tHours: true } }).length, 7, 'seven holding times');
    assert.strictEqual(stages.settingsFor({ cell: base, permuteDecision: true, permuteBand: true, permuteWeekdays: true }).length,
      2 * 4 * 2, 'decision × band menu × 24/5');
    // the TRADE SHAPE block, on its own: breakout gates(3) × d(5) × t(7) ×
    // (static + 4 trails × 3 arms)(13) + market t(7) = 1,372 shapes. The
    // agreement is no longer multiplied in here — it is its own dimension
    // (owner loop, 2026-08-28), which is what stopped a run declaring 8x the
    // settings it could ever tell apart.
    const shapes = stages.settingsFor({
      cell: base,
      cellPermute: { entry: true, gate: true, dMult: true, tHours: true, trail: true, arm: true },
    });
    assert.strictEqual(shapes.length, 1372, 'the shape block must count exactly what the sweep\'s enumerator declares');
    const labels = new Set(shapes.map((x) => x.label));
    assert.strictEqual(labels.size, shapes.length, 'every setting carries a distinct name');
    // and an 'agree' permute on the shape side is IGNORED, never multiplied:
    // the old enumerator crossed both committee bars here, 48 to a cell
    const withAgree = stages.settingsFor({
      cell: { ...base, quorumSingles: 2, quorumContexts: 3 },
      cellPermute: { entry: true, gate: true, dMult: true, tHours: true, trail: true, arm: true, agree: true },
    });
    assert.strictEqual(withAgree.length, 1372, 'the old agree permute must not reach the shape enumerator');
  },

  // NO COMMITTEE SIZE APPEARS IN A SETTING'S NAME, EVER (owner, 2026-08-27:
  // "on singles there's no with contexts at all"; owner loop, 2026-08-28: the
  // dial became a share). The old names carried two bars — one per committee
  // size — and on a singles-only run the second was named but never applied.
  async noSettingNameCarriesACommitteeSize() {
    const all = stages.settingsFor({
      cell: { entry: 'market', tHours: 89 },
      agreePermuteRule: true, agreePermutePct: true, agreePermuteBoth: true, agreePermutePersist: true,
    }, [1]);
    for (const x of all) {
      assert.ok(!/\/6|\/8|\/10|q\d/.test(x.label), `a committee size leaked into a name: ${x.label}`);
      assert.ok(/^(count|conviction|voices|families) \d+%/.test(x.label), `name must open with the rule and its share: ${x.label}`);
    }
    // ONE dial, every committee size: the same share is a legal setting for a
    // run of coins on their own and for a run read alongside others
    const singles = stages.settingsFor({ cell: { entry: 'market', tHours: 89 }, agreeRule: 'count', agreePct: 50 }, [1]);
    const mixed = stages.settingsFor({ cell: { entry: 'market', tHours: 89 }, agreeRule: 'count', agreePct: 50 }, [1, 3]);
    assert.strictEqual(singles.length, 1);
    assert.strictEqual(mixed.length, 1);
    assert.strictEqual(singles[0].label, mixed[0].label, 'one share, one name, whatever the committee holds');
    // every way of weighing reaches the block, and each is named on the setting
    const rules = new Set(stages.settingsFor({ cell: { entry: 'market', tHours: 89 }, agreePermuteRule: true }, [1]).map((x) => x.agreeRule));
    assert.deepStrictEqual([...rules].sort(), ['conviction', 'count', 'families', 'voices'],
      'unusual was never a way of weighing — it is count against the own history bar, and the bar is its own dial now');
    // ...AND SO DOES EACH BAR, with the bar written into the name, because the
    // same share means two different things under the two of them
    const bars = stages.settingsFor({ cell: { entry: 'market', tHours: 89 }, agreeRule: 'count', agreePct: 75, agreePermuteBar: true }, [1]);
    assert.deepStrictEqual(bars.map((x) => x.agreeBar).sort(), ['all', 'own']);
    assert.deepStrictEqual(bars.map((x) => x.label.split(' · ')[0]).sort(),
      ['count 75% market t89h', 'count 75% own market t89h'],
      'a name that hides which bar it used puts two unlike settings under one heading');
    // the combination that could not be asked for before
    const wanted = stages.settingsFor({ cell: { entry: 'market', tHours: 89 }, agreeRule: 'families', agreeBar: 'own', agreePct: 75 }, [1]);
    assert.strictEqual(wanted.length, 1);
    assert.deepStrictEqual([wanted[0].agreeRule, wanted[0].agreeBar], ['families', 'own'],
      'kinds of evidence measured against its own history must be reachable — it was not, and that was the muddle');
  },

  // The counter behind the Sweep cost line resolves the SAME units the
  // launch will price — the carry cut decides which bars exist, so the
  // number on the screen and the number that runs are one number.
  async theStageThreeCountRidesTheLaunchesOwnResolution() {
    const id = `s2-test-${Date.now().toString(36)}-cd`;
    const file = path.join(SETS_DIR, `${id}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        id, stage: 2, seq: 999986, name: 'S2 #cd', status: 'done', createdAt: new Date().toISOString(),
        plan: { units: 2 }, params: { universe: ['AAA', 'BBB', 'CCC'] },
      }));
      const w = rowstore.writer(id, 'records');
      w.push({ carriedRank: 1, s1rank: 1, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', specs: [], scoreAll: 5, score3: 4 });
      w.push({ carriedRank: 2, s1rank: 2, trade: 'BBB', ctx1: 'CCC', ctx2: null, size: 2, geometry: 'daily-4d', specs: [], scoreAll: 1, score3: 1 });
      w.close();
      const b = { from: id, cell: { entry: 'market', tHours: 65 }, agreePermutePct: true };
      // BOTH committee sizes carried: a share that lands on a different rung
      // for 8 members than for 10 is two settings, not one
      const mixed = stages.stage3Declared({ ...b, carry: 0 });
      assert.strictEqual(mixed.units, 2);
      assert.strictEqual(mixed.coins, 2, 'coins counted from the records the launch prices, not the universe');
      // carry 1 takes the top by forecast score — all members: the coin on
      // its own — so only 8-member rungs remain and the shares that shared a
      // rung collapse
      const cut = stages.stage3Declared({ ...b, carry: 1 });
      assert.strictEqual(cut.units, 1);
      assert.strictEqual(cut.coins, 1);
      assert.strictEqual(cut.settings, 8, 'twelve shares land on the eight rungs an 8-member committee has');
      // AND THE MIXED RUN MUST COUNT MORE. `>=` was too weak to notice the
      // resolution being skipped altogether: with no sizes resolved the count
      // falls back to a coin on its own, which is exactly the cut case, and a
      // count that always answered 8 satisfied it. Both sizes carried, a share
      // is two settings whenever it lands on different rungs for 8 members and
      // for 10 — twelve shares, twelve distinguishable pairs.
      assert.strictEqual(mixed.settings, 12,
        'the count is not resolving which committee sizes the launch will actually price — it is answering '
        + 'for a coin on its own whatever is carried, so the cost line and the launch are two different numbers');
      // no parent named yet: counted for a coin on its own, which is the
      // smallest committee — twelve shares, eight rungs
      assert.strictEqual(stages.stage3Declared({ cell: b.cell, agreePermutePct: true }).settings, 8);
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
    }
  },

  // Stage 3's tables, pencilled end to end on a fabricated records store:
  // per-coin-first averaging, coins in the money, the every-coin grouping by
  // cell across decision/band/24-5 variants, floors, and the block-targeted
  // records read.
  async theStageThreeTablesMatchThePencil() {
    const id = `s3-test-${Date.now().toString(36)}`;
    const dir = rowstore.storeDir(id);
    try {
      const w = rowstore.writer(id, 'records');
      const mk = (si, label, trade, geometry, decision, hold, beat, pairs, vsl, lead, test = 10) => ({
        si, label, decision, bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
        entry: 'breakout', gate: 'directional', dMult: 1.5, tHours: 65, trailMult: null, armMult: null,
        quorum: 2, members: 6, pnl: test, trades: 3,
        holdout: { pnl: hold, trades: 4, stops: 1, vsAlwaysLong: vsl },
        beat, pairs, lead: lead ?? null, u: 0, trade, ctx1: null, ctx2: null, size: 1, geometry,
      });
      // setting 0: coin A twice (two variants: argmax/directional), coin B once
      w.push(mk(0, 'q2/6 x · argmax auto 24/7', 'AAA', 'daily-4d', 'argmax', 10, 15, 19, 5, 2, 10));
      w.flush();
      w.push(mk(0, 'q2/6 x · directional auto 24/7', 'AAA', 'daily-4d', 'directional', 30, 10, 19, 6, 4, 26));
      w.push(mk(0, 'q2/6 x · argmax auto 24/7', 'BBB', 'daily-4d', 'argmax', -4, 3, 19, -2, -1, -4));
      w.flush();
      // setting 1: one coin, in the money
      w.push(mk(1, 'q3/6 y · argmax auto 24/7', 'AAA', 'daily-4d', 'argmax', 7, 12, 19, 1, 0.5, 9));
      w.close();

      const tally = await stages.buildTally({ id });
      // ranked: setting 0 → coin A mean hold (10+30)/2 = 20, coin B −4;
      // avgHold = (20 − 4) / 2 = 8; coins 2, in the money 1
      const r0 = tally.ranked.find((r) => r.si === 0);
      assert.ok(Math.abs(r0.avgHold - 8) < 1e-12, `per-coin-first average: expected 8, got ${r0.avgHold}`);
      assert.strictEqual(r0.coins, 2);
      assert.strictEqual(r0.coinsInMoney, 1, 'coin B lost money on held-back, so 1 of 2');
      // lead over null set, per coin first: coin A (2+4)/2 = 3, coin B −1;
      // avgLead = (3 − 1) / 2 = 1
      assert.ok(Math.abs(r0.avgLead - 1) < 1e-12, `per-coin-first lead: expected 1, got ${r0.avgLead}`);
      assert.strictEqual(r0.beat, 28);
      assert.strictEqual(r0.pairs, 57);
      // avg test $, per coin first (owner order, 2026-08-27): coin A
      // (10+26)/2 = 18, coin B −4 → ranked (18 − 4) / 2 = 7
      assert.ok(Math.abs(r0.avgTest - 7) < 1e-12, `per-coin-first test money: expected 7, got ${r0.avgTest}`);
      // every-coin: the two AAA variants of setting 0 group under one row
      const coinA = tally.coins.find((k) => k.trade === 'AAA' && k.cellLabel === 'q2/6 x');
      assert.strictEqual(coinA.rows, 2, 'decision variants are the rows under the coin');
      assert.strictEqual(coinA.beat, 25);
      assert.strictEqual(coinA.pairs, 38);
      assert.ok(Math.abs(coinA.avgHold - 20) < 1e-12);
      assert.ok(Math.abs(coinA.avgTest - 18) < 1e-12, 'the coin row averages its records’ test money too');

      // floors and sort through the serving path
      const tf = path.join(SETS_DIR, `${id}-tally.json.gz`);
      assert.ok(fs.existsSync(tf), 'the tally must be saved beside the set');
      const coins = stages.stage3Coins(id, { sort: 'money', minPairs: 30 });
      assert.strictEqual(coins.rows.length, 1, 'only the 38-comparison row clears a floor of 30');
      assert.strictEqual(coins.removed, 2, 'and the line under the table owns up to both rows held back');
      const sorted = stages.stage3Coins(id, { sort: 'money', minPairs: 10 });
      assert.deepStrictEqual(sorted.rows.map((r) => r.avgHold), [20, 7, -4], 'money sort, whole set, best first');
      assert.deepStrictEqual(sorted.rows.map((r) => r.avgTest), [18, 9, -4], 'and every served row carries its avg test $');
      // one click on a column sorts it; a second click turns the whole order
      // the other way (owner order, 2026-08-27)
      const byTest = stages.stage3Coins(id, { sort: 'test', minPairs: 10 });
      assert.deepStrictEqual(byTest.rows.map((r) => r.avgTest), [18, 9, -4], 'avg test $ sorts the whole set, best first');
      const turned = stages.stage3Coins(id, { sort: 'test', flip: '1', minPairs: 10 });
      assert.deepStrictEqual(turned.rows.map((r) => r.avgTest), [-4, 9, 18], 'a second click turns the whole order the other way');
      const byRows = stages.stage3Coins(id, { sort: 'rows', minPairs: 10 });
      assert.strictEqual(byRows.rows[0].rows, 2, 'rows sorts by how many records the row averages');
      const floored = stages.stage3Coins(id, { minVsLong: 0 });
      assert.ok(floored.rows.every((r) => r.avgVsLong >= 0), 'the vs always-long floor holds');
      // EVERY FLOOR THE TABLE OFFERS MUST ACTUALLY REMOVE ROWS. avg test $ was
      // drawn, sent and never read: a floor of a million on the owner's own
      // 411,600-row table removed nothing. A box that does nothing is worse
      // than no box, so each one is held here against a floor above every
      // value in its column.
      for (const [box, col] of [['minTest', 'avgTest'], ['minHold', 'avgHold'], ['minTrades', 'avgTrades'],
        ['minVsLong', 'avgVsLong'], ['minPairs', 'pairs']]) {
        const all = stages.stage3Coins(id, {});
        assert.ok(all.rows.some((r) => r[col] != null), `the fixture has no ${col} to floor`);
        const none = stages.stage3Coins(id, { [box]: 1e9 });
        assert.strictEqual(none.rows.length, 0, `the "${box}" floor removes nothing — the box is drawn and never read`);
        assert.strictEqual(none.removed, all.total, `and the line under the table does not own up to what "${box}" held back`);
      }

      // the records under a row come back from only its blocks, grouped right
      const got = stages.stage3CoinRows(id, { cellLabel: 'q2/6 x', trade: 'AAA', ctx1: '', ctx2: '', geometry: 'daily-4d' });
      assert.strictEqual(got.shown, 2);
      assert.deepStrictEqual(got.rows.map((r) => r.decision).sort(), ['argmax', 'directional']);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(path.join(SETS_DIR, `${id}-tally.json.gz`), { force: true }); } catch (_) { /* fixture */ }
    }
  },

  // A 'running' set the service restarted out from under is marked the
  // moment the list is read — a corpse must never show as alive.
  async aStrandedRunningSetIsMarkedInterrupted() {
    const id = `s1-test-${Date.now().toString(36)}`;
    const file = path.join(SETS_DIR, `${id}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ id, stage: 1, seq: 999999, name: 'S1 #test', status: 'running', createdAt: new Date().toISOString(), plan: { units: 1 } }));
      const row = stages.listSets().find((x) => x.id === id);
      assert.ok(row, 'the set must list');
      assert.strictEqual(row.status, 'interrupted');
      assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).status, 'interrupted', 'and the doc itself is rewritten');
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
    }
  },

  // The chain rail refuses by name: an unfinished parent, a wrong-stage
  // parent, and a price-file mismatch each carry their own sentence.
  async theChainRefusalsNameThemselves() {
    const mkSet = (over) => {
      const id = `s1-test-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
      const doc = {
        id, stage: 1, seq: 999998, name: 'S1 #ref', status: 'done',
        createdAt: new Date().toISOString(), engineVersion: require('../package.json').version,
        measurements: require('../lib/features').MEASUREMENTS_VERSION,
        params: { universe: ['ZZZTESTUSDT'], allLoaded: true, windowLayout: 'reserve61' },
        dataManifest: { overallDigest: 'not-what-the-files-say', symbols: { ZZZTESTUSDT: { digest: 'x' } } },
        plan: { units: 1 },
        ...over,
      };
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(path.join(SETS_DIR, `${doc.id}.json`), JSON.stringify(doc));
      return doc;
    };
    const cleanup = [];
    try {
      const running = mkSet({ status: 'interrupted' });
      cleanup.push(running.id);
      assert.throws(() => stages.startStage2({ from: running.id }), /only a finished set/i);
      const wrongStage = mkSet({});
      cleanup.push(wrongStage.id);
      assert.throws(() => stages.startStage3({ from: wrongStage.id, fee: 0.00125, cell: { entry: 'market', tHours: 65, quorumSingles: 2, quorumContexts: 3 } }),
        /is a stage 1 set/i, 'a stage 3 launch must refuse a stage 1 parent by name');
      const drifted = mkSet({});
      cleanup.push(drifted.id);
      assert.throws(() => stages.startStage2({ from: drifted.id }), /price files changed|refuses/i);
      assert.throws(() => stages.startStage2({ from: drifted.id, orderBy: 'beat' }), /order by is gone/i,
        'the removed order by must be refused loudly, never silently ignored — the carry follows the saved sort now');
    } finally {
      for (const id of cleanup) { try { fs.rmSync(path.join(SETS_DIR, `${id}.json`), { force: true }); } catch (_) { /* fixture */ } }
    }
  },

  // The stage 1 and stage 2 reading tables page from the stores and keep the
  // recorded order.
  // S4 OF THE LOOP: a set built on an older measurement block can never be a
  // parent. Its members were trained on numbers that no longer exist, in
  // positions that now hold something else — so it is refused BY NAME, with
  // what to do about it, and nothing of the owner's is deleted to achieve it.
  async aSetFromAnOlderMeasurementBlockIsRefusedAsAParent() {
    const id = `s1-test-${Date.now().toString(36)}-old`;
    const file = path.join(SETS_DIR, `${id}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        id, stage: 1, seq: 999985, name: 'S1 #old', status: 'done',
        createdAt: new Date().toISOString(), engineVersion: require('../package.json').version,
        params: { universe: ['ZZZTESTUSDT'], allLoaded: true }, plan: { units: 1 },
      }));
      assert.throws(() => stages.startStage2({ from: id, carry: 0 }),
        /was built on measurement block .* and this box builds/, 'an unstamped set is an old set and must be refused');
      assert.throws(() => stages.startStage2({ from: id, carry: 0 }),
        /Start a new stage 1/, 'and the refusal says what to do instead');
      assert.ok(fs.existsSync(file), 'refusing a set must never delete it');
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
    }
  },

  async theStageTablesPageInRecordedOrder() {
    const id = `s1-test-${Date.now().toString(36)}-t`;
    const dir = rowstore.storeDir(id);
    const file = path.join(SETS_DIR, `${id}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ id, stage: 1, seq: 999997, name: 'S1 #pg', status: 'done', createdAt: new Date().toISOString(), plan: { units: 3 } }));
      const rec = rowstore.writer(id, 'records');
      for (let u = 0; u < 3; u++) {
        rec.push({ u, trade: `C${u}`, ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', bandPct: 2, counts: {}, specs: [], score: 10 - u, beat: u, pairs: 19, lead: u, nullScores: [], blocks: {} });
      }
      rec.close();
      const rk = rowstore.writer(id, 'ranking');
      rk.push({ rank: 1, u: 2, beat: 2, pairs: 19, lead: 2, score: 8 });
      rk.push({ rank: 2, u: 1, beat: 1, pairs: 19, lead: 1, score: 9 });
      rk.push({ rank: 3, u: 0, beat: 0, pairs: 19, lead: 0, score: 10 });
      rk.close();
      const page = stages.stage1Table(id, 0, 2);
      assert.strictEqual(page.total, 3);
      assert.deepStrictEqual(page.rows.map((r) => r.trade), ['C2', 'C1'], 'the table serves the recorded ranking order');
      const page2 = stages.stage1Table(id, 2, 2);
      assert.deepStrictEqual(page2.rows.map((r) => r.trade), ['C0']);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
    }
    // and the stage 2 table orders by forecast score — all members, best
    // first, ties keeping their carry order (owner order, 2026-08-27)
    const id2 = `s2-test-${Date.now().toString(36)}-t`;
    const dir2 = rowstore.storeDir(id2);
    const file2 = path.join(SETS_DIR, `${id2}.json`);
    try {
      fs.writeFileSync(file2, JSON.stringify({ id: id2, stage: 2, seq: 999990, name: 'S2 #pg', status: 'done', createdAt: new Date().toISOString(), plan: { units: 3 } }));
      const rec2 = rowstore.writer(id2, 'records');
      rec2.push({ u: 0, carriedRank: 1, s1rank: 1, trade: 'C0', ctx1: null, ctx2: null, geometry: 'daily-4d', specs: [], score3: 4, scoreAll: 5, helped: 1, beat: 17, pairs: 19, lead: 2.5 });
      rec2.push({ u: 1, carriedRank: 2, s1rank: 2, trade: 'C1', ctx1: null, ctx2: null, geometry: 'daily-4d', specs: [], score3: 8, scoreAll: 9, helped: 1, beat: 19, pairs: 19, lead: 4 });
      rec2.push({ u: 2, carriedRank: 3, s1rank: 3, trade: 'C2', ctx1: null, ctx2: null, geometry: 'daily-4d', specs: [], score3: 8.5, scoreAll: 9, helped: 0.5, beat: 12, pairs: 19, lead: 1 });
      rec2.close();
      const t2 = stages.stage2Table(id2, 0, 10);
      assert.deepStrictEqual(t2.rows.map((r) => r.trade), ['C1', 'C2', 'C0'],
        'best all-members score first; the tie keeps its carry order');
      assert.deepStrictEqual(t2.rows.map((r) => r.rank), [1, 2, 3],
        'stage 2 order is the table\'s own sequence, never an echo of the stage 1 order');
      // the unit's stage 1 reading rides along for the table's null set columns
      assert.deepStrictEqual(t2.rows.map((r) => [r.beat, r.pairs, r.lead]), [[19, 19, 4], [12, 19, 1], [17, 19, 2.5]],
        'beat its own null set and lead over null set are served with each carried row');
    } finally {
      try { fs.rmSync(dir2, { recursive: true, force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(file2, { force: true }); } catch (_) { /* fixture */ }
    }
  },

  // Deleting a record set asks for the name back, refuses a named parent,
  // and actually removes the files when confirmed (owner order, 2026-08-27:
  // "yes" to the delete control).
  async theDeleteAsksForTheNameBackAndProtectsParents() {
    const stamp = Date.now().toString(36);
    const parent = { id: `s1-test-${stamp}-p`, stage: 1, seq: 999996, name: 'S1 #del-p', status: 'done', createdAt: new Date().toISOString(), plan: { units: 1 } };
    const child = { id: `s2-test-${stamp}-c`, stage: 2, seq: 999996, name: 'S2 #del-c', status: 'done', createdAt: new Date().toISOString(), parent: { id: parent.id, name: parent.name }, plan: { units: 1 } };
    const file = (d) => path.join(SETS_DIR, `${d.id}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file(parent), JSON.stringify(parent));
      fs.writeFileSync(file(child), JSON.stringify(child));
      const w = rowstore.writer(child.id, 'records');
      w.push({ u: 0, si: 0, label: 'x · argmax auto 24/7', trade: 'AAA', geometry: 'daily-1d', beat: 1, pairs: 9 });
      w.close();

      assert.throws(() => stages.deleteSet(parent.id), /is the parent of .*S2 #del-c/,
        'a set another set names as its parent must be refused by the child\'s name');
      const look = stages.deleteSet(child.id);
      assert.strictEqual(look.preview, true);
      assert.strictEqual(look.confirmWith, child.id);
      assert.ok(fs.existsSync(file(child)), 'asking what would go must delete nothing');
      const wrong = stages.deleteSet(child.id, 'not-the-id');
      assert.strictEqual(wrong.preview, true, 'a wrong name back deletes nothing');
      const done = stages.deleteSet(child.id, child.id);
      assert.strictEqual(done.deleted, true);
      assert.ok(!fs.existsSync(file(child)), 'the set document must be gone');
      assert.ok(!fs.existsSync(rowstore.storeDir(child.id)), 'the set\'s rows must be gone');
      const doneP = stages.deleteSet(parent.id, parent.id);
      assert.strictEqual(doneP.deleted, true, 'with the child gone the parent may go');
    } finally {
      try { fs.rmSync(file(parent), { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(file(child), { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(rowstore.storeDir(child.id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
    }
  },

  // The sharded tally folds to the same answer as the single pass: sums are
  // commutative, block sets are unions, and a test — not a comment — holds
  // the two equal.
  async theShardedTallyFoldsToTheSameAnswer() {
    const rows = [];
    for (let i = 0; i < 12; i++) {
      rows.push({
        si: i % 3, label: `q2/6 x t${i}h · argmax auto 24/7`, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false,
        entry: 'breakout', gate: 'directional', dMult: 1.5, tHours: 17, trailMult: null, armMult: null,
        quorum: 2, members: 6, pnl: i, trades: 1,
        holdout: { pnl: i - 5, trades: 2, stops: 0, vsAlwaysLong: i - 6 },
        beat: i % 10, pairs: 9, lead: (i - 4) / 2, trade: i % 2 ? 'AAA' : 'BBB', ctx1: null, ctx2: null, geometry: 'daily-1d',
      });
    }
    const one = sw.newTallyAcc();
    rows.forEach((r, i) => sw.tallyFold(one, r, Math.floor(i / 4)));
    const merged = sw.newTallyAcc();
    for (let shard = 0; shard < 3; shard++) {
      const part = sw.newTallyAcc();
      rows.slice(shard * 4, shard * 4 + 4).forEach((r) => sw.tallyFold(part, r, shard));
      sw.mergeTallyAcc(merged, JSON.parse(JSON.stringify(sw.serializeTallyAcc(part))));
    }
    const norm = (acc) => {
      const o = sw.serializeTallyAcc(acc);
      o.perSetting.sort((a, b) => a.si - b.si);
      for (const st of o.perSetting) st.perCoin.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      o.perCoin.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      for (const [, k] of o.perCoin) k.b.sort((x, y) => x - y);
      return o;
    };
    assert.deepStrictEqual(norm(merged), norm(one), 'the sharded fold must be the single-pass fold, exactly');
  },

  // The ranked table sorts by ONE picked column, saved on the record set
  // (owner order, 2026-08-27: "only a single column to select by is
  // sufficient") — the whole list is ordered before the page is cut, two
  // columns are refused by sentence, and with nothing picked the table
  // serves the totalling's own order.
  async theRankedTableSortsByOnePickedColumn() {
    const id = `s3-test-${Date.now().toString(36)}-rs`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const doc = {
      id, stage: 3, seq: 999987, name: 'S3 #rs', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 1, settings: 3 }, params: { nullN: 9 },
      recordsVersion: stages.RECORDS_V,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      const mk = (si, tHours, hold, beat) => ({
        si, label: `q2/6 x t${tHours}h · argmax auto 24/7`, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false,
        bandPct: 2, entry: 'breakout', gate: 'directional', dMult: 1.5, tHours, trailMult: null, armMult: null,
        quorum: 2, members: 6, pnl: 10, trades: 3,
        holdout: { pnl: hold, trades: 4, stops: 1, vsAlwaysLong: 2 },
        beat, pairs: 9, lead: 1.5, u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
      });
      w.push(mk(0, 17, 30, 3));
      w.push(mk(1, 65, -4, 8));
      w.push(mk(2, 41, 12, 5));
      w.close();
      await stages.buildTally(doc);

      // nothing picked: the totalling's own order — beat share, best first
      assert.deepStrictEqual(stages.stage3Ranked(id, 0, 10).rows.map((r) => r.tHours), [65, 41, 17]);
      // one column picked: the whole list reorders, and the pick echoes back
      stages.setSetSort(id, [{ key: 'avgHold', dir: 'desc' }]);
      const byHold = stages.stage3Ranked(id, 0, 10);
      assert.deepStrictEqual(byHold.rows.map((r) => r.avgHold), [30, 12, -4], 'the picked column orders the whole table');
      assert.deepStrictEqual(byHold.sort, [{ key: 'avgHold', dir: 'desc' }], 'the served page says what ordered it');
      stages.setSetSort(id, [{ key: 'tHours', dir: 'asc' }]);
      assert.deepStrictEqual(stages.stage3Ranked(id, 0, 10).rows.map((r) => r.tHours), [17, 41, 65], 'a dial column sorts too');
      // and the page cut comes AFTER the sort
      assert.deepStrictEqual(stages.stage3Ranked(id, 1, 1).rows.map((r) => r.tHours), [41], 'page two really is the middle');
      // refusals, by sentence: two columns, and a column these tables lack
      assert.throws(() => stages.setSetSort(id, [{ key: 'avgHold', dir: 'desc' }, { key: 'tHours', dir: 'asc' }]),
        /one column at a time on this table/);
      assert.throws(() => stages.setSetSort(id, [{ key: 'score3', dir: 'desc' }]),
        /not a column these tables sort by/, 'a stage 2 column is refused on a stage 3 set');
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(path.join(SETS_DIR, `${id}-tally.json.gz`), { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
    }
  },

  // A tally of an older shape READS AS ABSENT (owner order, 2026-08-27: the
  // coins table gained avg test $) — it is never served with dashes where
  // the new column belongs; the rebuild-on-read door re-totals it instead.
  async theOldTallyShapeRetotalsItself() {
    const id = `s3-test-${Date.now().toString(36)}-ov`;
    const tf = path.join(SETS_DIR, `${id}-tally.json.gz`);
    const realGunzip = zlib.gunzipSync;
    let parses = 0;
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      // THE TWO SHAPE NUMBERS ARE READ OUT OF THE CODE, never typed: this was
      // written with 1 and 2 in it and went red the next time the tally gained
      // a column, which is precisely the event it exists to cover.
      const NOW = Number(/const TALLY_V = (\d+);/.exec(fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8'))[1]);
      fs.writeFileSync(tf, zlib.gzipSync(JSON.stringify({ v: NOW - 1, builtAt: 'x', rows: 0, ranked: [], coins: [] })));
      // ONE parse decides, and the verdict is remembered (the third
      // out-of-memory death, 2026-08-27): re-parsing the stale file on every
      // ask is what killed the service beside the re-total.
      zlib.gunzipSync = (...a) => { parses += 1; return realGunzip(...a); };
      assert.strictEqual(stages.readTally(id), null, 'an old-shape tally must not be served');
      assert.strictEqual(stages.stage3Ranked(id, 0, 10), null, 'so the table read falls through to the rebuild door');
      assert.ok(!stages.ensureTally(id).ready, 'and the door no longer answers ready off the file\'s mere existence');
      assert.strictEqual(parses, 1, `one parse decides; a stat answers ever after — got ${parses} parses`);
      zlib.gunzipSync = realGunzip;
      // the shape the totalling writes today IS served — the changed file
      // escapes the remembered verdict
      fs.writeFileSync(tf, zlib.gzipSync(JSON.stringify({ v: NOW, builtAt: 'xx', rows: 0, ranked: [], coins: [] })));
      const served = stages.stage3Ranked(id, 0, 10);
      assert.ok(served && served.total === 0, 'the current shape serves');
    } finally {
      zlib.gunzipSync = realGunzip;
      try { fs.rmSync(tf, { force: true }); } catch (_) { /* fixture */ }
    }
  },

  // ---- the campaign rides the stages (owner GO, 2026-08-27) ----------------

  // The stamp sits on all three launches — pinned in the source because a
  // real launch is too heavy for this suite (the end-to-end exam launches for
  // real and checks the stamp rides). Everything downstream of a stamp — the
  // listing row, the tree, the contents count, the picker — is proved against
  // stamped documents here.
  async theCampaignStampSitsOnEveryStageLaunch() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    const stamps = src.split("campaign: require('./campaign').getCampaign() || null").length - 1;
    assert.strictEqual(stamps, 3, `all three stage launches must stamp the campaign in use — found ${stamps} of 3`);

    const campaign = require('../lib/campaign');
    const stamp = Date.now().toString(36);
    const name = `camp-test-${stamp}`;
    const s1 = { id: `s1-test-${stamp}-a`, stage: 1, seq: 999995, name: 'S1 #camp-a', status: 'done', createdAt: '2026-08-27T01:00:00.000Z', desc: 'first', params: { campaign: name, windowLayout: 'reserve61' }, plan: { units: 1 } };
    const s2 = { id: `s2-test-${stamp}-b`, stage: 2, seq: 999995, name: 'S2 #camp-b', status: 'done', createdAt: '2026-08-27T02:00:00.000Z', parent: { id: s1.id, name: s1.name }, params: { campaign: name, windowLayout: 'reserve61' }, plan: { units: 1 } };
    const file = (d) => path.join(SETS_DIR, `${d.id}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file(s1), JSON.stringify(s1));
      fs.writeFileSync(file(s2), JSON.stringify(s2));
      const row = stages.listSets().find((x) => x.id === s1.id);
      assert.strictEqual(row.params.campaign, name, 'the listing row must carry the campaign');
      const tree = campaign.campaignTree(name);
      const ids = tree.runs.map((r) => r.id);
      assert.ok(ids.includes(s1.id) && ids.includes(s2.id), 'both record sets must be in the campaign tree');
      const childRow = tree.runs.find((r) => r.id === s2.id);
      assert.strictEqual(childRow.kind, 'stage 2');
      assert.strictEqual(childRow.parentRunId, s1.id, 'the tree must link a set to the parent it read');
      const found = campaign.campaignContents(name);
      assert.strictEqual(found.counts.stageSets, 2);
      assert.strictEqual(found.declaredOnly, false, 'a campaign holding record sets holds something');
      assert.ok(campaign.listCampaignNames().includes(name),
        'a campaign whose only activity is record sets must still be offered by the picker');
    } finally {
      try { fs.rmSync(file(s1), { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(file(s2), { force: true }); } catch (_) { /* fixture */ }
    }
  },

  // Deleting a campaign takes its record sets children-first — stage 3 before
  // 2 before 1 — because a set named as a parent refuses deletion. A set a
  // FOREIGN campaign's child names stays behind, and the delete says so.
  async theCampaignDeleteTakesItsRecordSetsChildrenFirst() {
    const campaign = require('../lib/campaign');
    const stamp = Date.now().toString(36);
    const name = `camp-del-${stamp}`;
    const nameB = `camp-delb-${stamp}`;
    const wasSet = campaign.getCampaign();
    const s1 = { id: `s1-test-${stamp}-d1`, stage: 1, seq: 999993, name: 'S1 #cd-1', status: 'done', createdAt: '2026-08-27T01:00:00.000Z', params: { campaign: name }, plan: { units: 1 } };
    const s2 = { id: `s2-test-${stamp}-d2`, stage: 2, seq: 999993, name: 'S2 #cd-2', status: 'done', createdAt: '2026-08-27T02:00:00.000Z', parent: { id: s1.id, name: s1.name }, params: { campaign: name }, plan: { units: 1 } };
    const p2 = { id: `s1-test-${stamp}-d3`, stage: 1, seq: 999992, name: 'S1 #cd-3', status: 'done', createdAt: '2026-08-27T03:00:00.000Z', params: { campaign: nameB }, plan: { units: 1 } };
    const foreign = { id: `s2-test-${stamp}-d4`, stage: 2, seq: 999992, name: 'S2 #cd-4', status: 'done', createdAt: '2026-08-27T04:00:00.000Z', parent: { id: p2.id, name: p2.name }, params: { campaign: `camp-else-${stamp}` }, plan: { units: 1 } };
    const file = (d) => path.join(SETS_DIR, `${d.id}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      for (const d of [s1, s2, p2, foreign]) fs.writeFileSync(file(d), JSON.stringify(d));

      // the clean chain goes whole: child first, then the parent it named
      const out = campaign.deleteCampaign(name);
      assert.strictEqual(out.removed.stageSets, 2, 'both record sets of the chain must go');
      assert.deepStrictEqual(out.leftBehind, [], 'nothing of a self-contained chain stays behind');
      assert.ok(!fs.existsSync(file(s1)) && !fs.existsSync(file(s2)), 'the set documents must be gone');
      assert.strictEqual(campaign.getCampaign(), wasSet, 'deleting a campaign that is not in use must not touch the one that is');

      // a parent a FOREIGN campaign's child names is refused, and named
      const outB = campaign.deleteCampaign(nameB);
      assert.strictEqual(outB.removed.stageSets, 0, 'the named parent must stay');
      assert.strictEqual(outB.leftBehind.length, 1, 'and the delete must say so');
      assert.ok(/S2 #cd-4/.test(outB.leftBehind[0]), 'the reason names the child that protects it');
      assert.ok(fs.existsSync(file(p2)), 'the protected set document must still be there');
    } finally {
      for (const d of [s1, s2, p2, foreign]) { try { fs.rmSync(file(d), { force: true }); } catch (_) { /* fixture */ } }
    }
  },

  // The sort picked on a stage table saves ON the record set, orders the
  // whole served table with the first column sequential under it, refuses
  // junk by name, and is exactly what the carry order reads (owner order,
  // 2026-08-27). The carry itself is proved on a real launch by the
  // end-to-end exam; here the saved spec and the served tables are held.
  async theSavedSortOrdersTheTablesAndTheFirstColumnFollows() {
    const stamp = Date.now().toString(36);
    const s1 = { id: `s1-test-${stamp}-ss`, stage: 1, seq: 999989, name: 'S1 #ss', status: 'running', createdAt: new Date().toISOString(), plan: { units: 3 } };
    const s2 = { id: `s2-test-${stamp}-ss`, stage: 2, seq: 999989, name: 'S2 #ss', status: 'done', createdAt: new Date().toISOString(), plan: { units: 3 } };
    const file = (d) => path.join(SETS_DIR, `${d.id}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file(s1), JSON.stringify(s1));
      fs.writeFileSync(file(s2), JSON.stringify(s2));
      // refused while the set is being written, and junk refused by name
      assert.throws(() => stages.setSetSort(s1.id, [{ key: 'lead', dir: 'asc' }]), /still being written/);
      s1.status = 'done';
      fs.writeFileSync(file(s1), JSON.stringify(s1));
      assert.throws(() => stages.setSetSort(s1.id, [{ key: 'money', dir: 'desc' }]), /is not a column these tables sort by/,
        'a column these tables never had must be refused by name');
      assert.throws(() => stages.setSetSort(s1.id, [{ key: 'lead' }]), /needs a direction/);
      assert.throws(() => stages.setSetSort(s1.id, [{ key: 'lead', dir: 'asc' }, { key: 'lead', dir: 'desc' }]), /picked twice/);
      assert.throws(() => stages.setSetSort(s1.id, [1, 2, 3, 4].map((k) => ({ key: 'lead', dir: 'asc' }))), /three sort priorities at most/);

      // stage 1: ranking order is the default; a saved sort reorders and the
      // first number stays sequential
      const rk = rowstore.writer(s1.id, 'ranking');
      rk.push({ rank: 1, u: 0, beat: 9, pairs: 9, lead: 1.0, score: 5 });
      rk.push({ rank: 2, u: 1, beat: 8, pairs: 9, lead: 3.0, score: 4 });
      rk.push({ rank: 3, u: 2, beat: 7, pairs: 9, lead: 2.0, score: 6 });
      rk.close();
      const rec = rowstore.writer(s1.id, 'records');
      for (let u = 0; u < 3; u++) rec.push({ u, trade: `C${u}`, ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', specs: [], blocks: {} });
      rec.close();
      const saved = stages.setSetSort(s1.id, [{ key: 'lead', dir: 'asc' }]);
      assert.deepStrictEqual(saved.sort, [{ key: 'lead', dir: 'asc' }], 'the sort round-trips the save');
      const t1 = stages.stage1Table(s1.id, 0, 10);
      assert.deepStrictEqual(t1.rows.map((r) => r.trade), ['C0', 'C2', 'C1'], 'lead low to high');
      assert.deepStrictEqual(t1.rows.map((r) => r.rank), [1, 2, 3], 'the first number is sequential under the saved sort');
      stages.setSetSort(s1.id, []);
      const t1b = stages.stage1Table(s1.id, 0, 10);
      assert.deepStrictEqual(t1b.rows.map((r) => r.trade), ['C0', 'C1', 'C2'], 'an empty save puts the fixed rule back');

      // stage 2: two priorities, string then number, and the base tie holds
      const rec2 = rowstore.writer(s2.id, 'records');
      rec2.push({ u: 0, carriedRank: 1, s1rank: 1, trade: 'BBB', ctx1: null, ctx2: null, geometry: 'daily-4d', specs: [], score3: 1, scoreAll: 2, helped: 1, beat: 5, pairs: 9, lead: 0.5 });
      rec2.push({ u: 1, carriedRank: 2, s1rank: 2, trade: 'AAA', ctx1: null, ctx2: null, geometry: 'daily-4d', specs: [], score3: 1, scoreAll: 3, helped: 2, beat: 6, pairs: 9, lead: 0.7 });
      rec2.push({ u: 2, carriedRank: 3, s1rank: 3, trade: 'AAA', ctx1: null, ctx2: null, geometry: 'daily-4d', specs: [], score3: 1, scoreAll: 1, helped: 0, beat: 7, pairs: 9, lead: 0.9 });
      rec2.close();
      stages.setSetSort(s2.id, [{ key: 'trade', dir: 'asc' }, { key: 'helped', dir: 'desc' }]);
      const t2 = stages.stage2Table(s2.id, 0, 10);
      assert.deepStrictEqual(t2.rows.map((r) => [r.trade, r.helped]), [['AAA', 2], ['AAA', 0], ['BBB', 1]],
        'first priority coin A to Z, second fuller board helped high to low');
      assert.deepStrictEqual(t2.rows.map((r) => r.rank), [1, 2, 3]);
    } finally {
      for (const d of [s1, s2]) {
        try { fs.rmSync(file(d), { force: true }); } catch (_) { /* fixture */ }
        try { fs.rmSync(rowstore.storeDir(d.id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
      }
    }
  },

  // What is in the Sweep boxes survives a screen flip, and the progress
  // line carries the cycle counts (owner order, 2026-08-27: "not lose the
  // values loaded to the stage 1/2/3 areas on screen flips ... a decent
  // progress indicator with total number of cycles and progress").
  async theSweepFormAndTheCycleCountsSurviveTheFlip() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const screens = require('../lib/screencontrols');
    const body = screens.drawBody('drawSweep');
    assert.ok(body.includes('restoreSweepForm()'), 'every draw writes the remembered draft back into the boxes');
    // ONE WALK OF THE CONTROLS DOES ALL THREE DUTIES (2026-08-29). There were
    // two walks — one wiring the draft memory and the provenance colours, one
    // wiring the counts off a hand-typed list of ids — and the typed one had
    // fallen behind, so the null set size changed nothing on the cost line.
    assert.ok(body.includes('for (const el of sweepControls()) {'), 'the controls are not walked to be wired');
    for (const [duty, why] of [
      ['rememberSweepForm();', 'the draft is no longer remembered on a change'],
      ['swProvenance();', 'the provenance colours no longer repaint on a change'],
      ['swCountsSoon();', 'the cost lines no longer re-ask on a change'],
    ]) {
      assert.ok(body.includes(duty), why);
    }
    assert.ok(body.includes("el.addEventListener('change', onChange);") && body.includes("el.addEventListener('input', onChange);"),
      'typing must count as a change too — on a typed box (the null set size, the carry, the universe) `change` '
      + 'waits for the box to lose focus, which is how the cost line came to describe boxes the owner had already retyped');
    const fill = ui.slice(ui.indexOf('function fillStageForm('), ui.indexOf('let swSetsCache'));
    assert.ok(/rememberSweepForm\(\);/.test(fill),
      'a programmatic fill never fires change, so copy settings must remember what it wrote');
    const prog = ui.slice(ui.indexOf('async function swProgress('), ui.indexOf('async function swCounts('));
    // RE-AIMED 2026-08-29: the line reported cycles-of-total for the WHOLE run
    // and one duration. It reports the phase in progress now — see
    // everyPhaseOfALongRunReportsItsRateAndWhenItLands for the arithmetic.
    assert.ok(/phaseTotal/.test(prog) && /phaseWord/.test(prog) && /phaseEtaMs/.test(prog) && /phaseEndsAtMs/.test(prog),
      'the progress line must carry how far through this phase, the word for its work, how long is left, and when it lands');
    const lib = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.strictEqual(lib.split('cyclesWord:').length - 1, 3, 'all three launches declare their cycle counts');
    assert.ok(/phase: 'reading the kept votes', done: pi \+ 1, total: parentRecords\.length/.test(lib),
      'the long read before stage 3 dispatch says what it is doing instead of sitting on "writing the plan" — and it '
      + 'reports through the shared reporter, so it carries a rate and a finish time like every other phase');
  },

  // Notes on a record set: refused while it is being written, saved and
  // stamped after, capped at the same length a run's notes are.
  async theRecordSetNotesRefuseWhileWritingAndSaveAfter() {
    const stamp = Date.now().toString(36);
    const doc = { id: `s1-test-${stamp}-n`, stage: 1, seq: 999991, name: 'S1 #notes', status: 'running', createdAt: new Date().toISOString(), plan: { units: 1 } };
    const file = path.join(SETS_DIR, `${doc.id}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      assert.throws(() => stages.setSetNotes(doc.id, 'x'), /still being written/,
        'the orchestrator saves the doc continuously — a concurrent note write would be silently overwritten');
      doc.status = 'done';
      fs.writeFileSync(file, JSON.stringify(doc));
      const out = stages.setSetNotes(doc.id, 'why this set exists');
      assert.strictEqual(out.notes, 'why this set exists');
      assert.ok(out.notesEditedAt, 'the edit stamp is taken on the server');
      assert.strictEqual(stages.getSet(doc.id).notes, 'why this set exists', 'the note must round-trip the doc');
      assert.strictEqual(stages.setSetNotes(doc.id, 'x'.repeat(30000)).notes.length, 20000,
        'notes cap at the same length a run\'s notes do');
      assert.throws(() => stages.setSetNotes('no-such-set', 'x'), /unknown record set/);
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
    }
  },

  // The campaign panel and the opened run's head are ONE piece of code drawn
  // on two screens each (owner order, 2026-08-27: "all formatted the same —
  // recycle / re-use"). Shared functions cannot drift; this holds both screens
  // to them, and holds the control reader to seeing the shared controls on
  // both — which is what obliges the Help tab to describe them on both.
  async theTwoScreensDrawTheSharedPanelsFromOneFunction() {
    const screens = require('../lib/screencontrols');
    {
      const body = screens.drawBody('drawSweep');
      assert.ok(body.includes('campaignPanelHtml('), 'drawSweep must draw the campaign panel from the shared function');
      assert.ok(body.includes('wireCampaignPanel('), 'drawSweep must wire the campaign panel with the shared function');
    }
    {
      const body = screens.drawBody('drawBoards');
      for (const shared of ['campaignNoteHtml(', 'descriptionPanelHtml(', 'notesPanel1(', 'runIdentityPanelHtml(', 'wireNotesSave(']) {
        assert.ok(body.includes(shared), `drawBoards must draw the opened record set's head with ${shared.slice(0, -1)}`);
      }
    }
    // the settings-copy is basic run functionality and Boards keeps it: one
    // named mapping fills the Sweep boxes, the fillSweepForm discipline
    {
      const body = screens.drawBody('drawBoards');
      for (const n of [1, 2, 3]) {
        assert.ok(body.includes(`id="bCopySettings${n}"`), `each Boards section must offer copy settings into the form (stage ${n})`);
      }
      assert.ok(body.includes('fillStageForm(doc)'), 'and it must fill through the one named mapping');
      // the mapping fills ONLY the open set's own stage box — a stage 2 set
      // must not touch the stage 1 box (owner order, 2026-08-27)
      const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
      const fn = src.slice(src.indexOf('function fillStageForm('), src.indexOf('let swSetsCache'));
      const s1Block = fn.slice(fn.indexOf("doc.stage === 1"), fn.indexOf("doc.stage === 2"));
      assert.ok(/#swUni/.test(s1Block) && /#swNull1/.test(s1Block), 'the stage 1 fields fill only under stage === 1');
      assert.ok(!/#swUni|#swNull1|#swLayout/.test(fn.slice(fn.indexOf("doc.stage === 2"))),
        'a stage 2 or 3 set must leave the stage 1 box exactly as it is');
    }
    // Boards is three provenance-linked sections (owner order, 2026-08-27):
    // stage-filtered pickers, a child pulling its parents onto the screen, a
    // parent putting its children away, folds remembered
    {
      const body = screens.drawBody('drawBoards');
      for (const pin of ['bOptions(1, s1sel)', 'bOptions(2, s2sel)', 'bOptions(3, s3sel)']) {
        assert.ok(body.includes(pin), `each section's picker offers only its own stage's sets (${pin})`);
      }
      assert.ok(body.includes('if (s3sel) { s2sel = parentOf(s3sel); s1sel = s2sel ? parentOf(s2sel) : null; }'),
        'a stage 3 selection must put its whole chain on screen');
      assert.ok(body.includes('else if (s2sel) { s1sel = parentOf(s2sel); }'),
        'a stage 2 selection must put its stage 1 parent on screen');
      assert.ok(body.includes("bSaveView({ s1: idv, s2: null, s3: null, fold1: true, openS3: [] })"),
        'picking a stage 1 parent must put the child selections away');
      assert.ok(body.includes('data-bfold') && body.includes('fold1: true, fold2: true, fold3: true'),
        'the sections fold, and a fresh stage 3 pick opens its whole chain');
      assert.ok(/fold\[stage\]\) \{ mount.innerHTML = '<p class="note">put away/.test(body),
        'a folded section says it is put away rather than vanishing');
    }
    // Sweep's titles carry the provenance colors, judged live
    {
      const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
      for (const id of ['swH1', 'swH2', 'swH3']) assert.ok(src.includes(`id="${id}"`), `the ${id} title must exist to be painted`);
      const fn = src.slice(src.indexOf('function swProvenance('), src.indexOf('async function swCounts('));
      assert.ok(/var\(--pos\)/.test(fn) && /var\(--neg\)/.test(fn), 'green normally, red at the point of break');
      assert.ok(fn.includes("rowOf(v('#swFrom2'))") && fn.includes("rowOf(v('#swFrom3'))"),
        'stage 1 is judged against what the stage 2 box names, stage 2 against what the stage 3 box names');
      const swBody = screens.drawBody('drawSweep');
      assert.ok(swBody.includes('swProvenance()'), 'the colors are wired on the page');
      assert.ok(swBody.includes("b.disabled = going"), 'the start buttons sleep while a run is going');
    }
  // The stage 3 tables' newest owner orders (2026-08-27): Apply pegs the
    // coins heading line where the eye left it; the ranked table sorts by one
    // picked column through the same saved-sort door; the coins rows carry
    // their avg test $.
    {
      const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
      assert.ok(src.includes('<thead><tr data-bcoinhead'), 'the coins heading line carries the peg mark');
      assert.ok(src.includes('window.scrollBy(0, again.getBoundingClientRect().top - pegTop);'),
        'Apply puts the heading line back at exactly the height it was measured at');
      assert.ok(src.includes('function bRankSortBtn(') && src.includes("bWireRankSort(doc, mount);"),
        'the ranked table columns carry sort buttons and they are wired');
      assert.ok(src.includes('const spec = !cur ? [{ key, dir: first }]'),
        'picking another ranked column replaces the pick — never stacks it');
      assert.ok(src.includes('title="average test-window money per record') && src.includes('${bMoney(r.avgTest)}'),
        'the every-coin table shows each row-set\'s avg test $');
      // the coins table holds still on EVERY redraw and sorts on one click
      // (owner orders, 2026-08-27)
      assert.ok(src.includes('function bRedrawPeggedToCoinHead('), 'the one peg serves every redraw of the coins table');
      assert.ok(src.includes('bSaveView({ openS3: [...keys] });\n      bRedrawPeggedToCoinHead();'),
        'opening or closing a row\'s records redraws pegged — the page does not move');
      assert.ok(src.split('bRedrawPeggedToCoinHead();').length - 1 >= 4,
        'Apply, the records buttons, the coins page turn and the column sorts all redraw pegged');
      assert.ok(src.includes('data-bcoinsort'), 'the coins columns carry one-click sort buttons');
      assert.ok(src.includes('flip: active ? !cq.flip : false'), 'a second click on the same column turns the order');
    }
    const map = screens.byTab();
    for (const key of ['sweep']) {
      const ids = map[key].controls.map((c) => c.id);
      for (const id of ['cxCampPick', 'cxCamp', 'campSet', 'campTree', 'campDelete']) {
        assert.ok(ids.includes(id), `${key} must expose the campaign control ${id}`);
      }
    }
    for (const key of ['boards']) {
      const ids = map[key].controls.map((c) => c.id);
      for (const id of ['bNotes1', 'bNotesSave1', 'bNotes2', 'bNotesSave2', 'bNotes3', 'bNotesSave3']) {
        assert.ok(ids.includes(id), `${key} must expose the notes control ${id}`);
      }
    }
  },

  // A finished stage 3 set whose tables are missing totals itself when its
  // table is asked for (owner order, 2026-08-27: the durable fix) — with a
  // progress reading while it goes, and the tables served once it lands.
  async theTablesRebuildThemselvesWhenOpened() {
    const stamp = Date.now().toString(36);
    const id = `s3-test-${stamp}-rb`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const doc = {
      id, stage: 3, seq: 999988, name: 'S3 #rb', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 1, settings: 2 }, params: { nullN: 9 },
      recordsVersion: stages.RECORDS_V,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      const mk = (si, label, decision) => ({
        si, label, decision, bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
        entry: 'breakout', gate: 'directional', dMult: 1.5, tHours: 65, trailMult: null, armMult: null,
        quorum: 2, members: 6, pnl: 10, trades: 3,
        holdout: { pnl: 7, trades: 4, stops: 1, vsAlwaysLong: 2 },
        beat: 6, pairs: 9, lead: 1.5, u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
      });
      w.push(mk(0, 'q2/6 x · argmax auto 24/7', 'argmax'));
      w.push(mk(1, 'q2/6 x · directional auto 24/7', 'directional'));
      w.close();

      // an OLD-SHAPE tally sits on disk — the exact picture after the avg
      // test $ deploy — and the whole path re-totals it into today's shape
      const tf = path.join(SETS_DIR, `${id}-tally.json.gz`);
      fs.writeFileSync(tf, zlib.gzipSync(JSON.stringify({ v: 1, builtAt: 'x', rows: 0, ranked: [], coins: [] })));
      assert.strictEqual(stages.stage3Ranked(id, 0, 10), null, 'no tables yet — the tally on disk is of the old shape');
      const kick = stages.ensureTally(id);
      assert.ok(kick.totalling, 'asking for the tables must start the totalling and say so');
      // while it runs, the file it is replacing is NEVER opened — not even
      // when it looks changed (the third out-of-memory death was the polls
      // parsing the whole stale file beside the fold)
      fs.utimesSync(tf, new Date(), new Date());
      const realGunzip = zlib.gunzipSync;
      let parses = 0;
      zlib.gunzipSync = (...a) => { parses += 1; return realGunzip(...a); };
      try {
        assert.strictEqual(stages.readTally(id), null, 'while its totalling runs the file reads as absent');
        assert.strictEqual(parses, 0, 'and it is never opened — it is about to be replaced');
      } finally { zlib.gunzipSync = realGunzip; }
      await stages.tallyWait();
      const again = stages.ensureTally(id);
      assert.deepStrictEqual(again, { ready: true }, 'once it lands the tables read as ready');
      const ranked = stages.stage3Ranked(id, 0, 10);
      assert.ok(ranked && ranked.total === 2, 'the rebuilt tables serve exactly what the records hold');
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(path.join(SETS_DIR, `${id}-tally.json.gz`), { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
    }
  },

  // The budget gate does its arithmetic BEFORE anything runs (owner order,
  // 2026-08-27: warn, flag, stop, with meaningful messages — never a crash
  // or a silent restart because a block was too wide).
  // A filter the screen offers and the service ignores is worse than no
  // filter: the owner narrows a table, the table does not narrow, and
  // nothing says so. Unknown fields are refused BY NAME.
  async theTableFiltersRefuseAnUnknownFieldByName() {
    const rows = [
      { trade: 'ADAUSDT', ctx1: null, score: 5, beat: 9, pairs: 10, lead: 2, voices: 6, rank: 1 },
      { trade: 'BTCUSDT', ctx1: 'ETHUSDT', score: 1, beat: 2, pairs: 10, lead: -1, voices: 3, rank: 2 },
    ];
    assert.strictEqual(stages.applyFilters(1, rows, {}).length, 2, 'no filter set filters nothing');
    assert.strictEqual(stages.applyFilters(1, rows, { trade: '' }).length, 2, 'an empty box filters nothing, never everything');
    assert.deepStrictEqual(stages.applyFilters(1, rows, { trade: 'ada' }).map((r) => r.trade), ['ADAUSDT'], 'text matches any part, ignoring case');
    assert.deepStrictEqual(stages.applyFilters(1, rows, { beatMin: 50 }).map((r) => r.trade), ['ADAUSDT'], 'the share is worked out, not stored');
    assert.deepStrictEqual(stages.applyFilters(1, rows, { ctx: 'eth' }).map((r) => r.trade), ['BTCUSDT'], 'the context coins read as one piece of text');
    assert.deepStrictEqual(stages.applyFilters(1, rows, { voicesMin: 5 }).map((r) => r.trade), ['ADAUSDT']);
    assert.throws(() => stages.applyFilters(1, rows, { nope: 1 }), /is not a filter on the stage 1 table/);
    assert.throws(() => stages.applyFilters(1, rows, { scoreMin: 'abc' }), /needs a number/);
    // a stage 2 field is not a stage 1 field — the lists are per table
    assert.throws(() => stages.applyFilters(1, rows, { scoreAllMin: 1 }), /is not a filter on the stage 1 table/);
    assert.ok(stages.FILTER_DEFS[2].scoreAllMin && stages.FILTER_DEFS[3].holdMin, 'each stage publishes its own list');
  },

  // S6 OF THE LOOP — the owner's twelve interface demands, checked in the
  // source rather than by eye. Every table on Boards must carry filters, a
  // fold and sortable columns, and every filter the screen offers must be a
  // filter the service actually implements.
  async everyTableCarriesFiltersAFoldAndSortableColumns() {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const screens = require('../lib/screencontrols');
    const body = screens.drawBody('drawBoards');
    // one shared implementation, not one per table
    for (const fn of ['function bFilterGrid(', 'function bWireFilters(', 'function bFoldBtn(', 'function bWireTableFold(']) {
      assert.ok(src.includes(fn), `the shared table furniture must exist: ${fn}`);
    }
    // every one of the four tables asks for all three
    for (const key of ['S1', 'S2', 'S3R', 'S3C']) {
      assert.ok(new RegExp(`bFilterGrid\\('${key}'`).test(src), `the ${key} table must offer filters`);
    }
    for (const key of ['S1', 'S2', 'S3R']) {
      assert.ok(new RegExp(`bFoldBtn\\('${key}'`).test(src), `the ${key} table must fold`);
    }
    // the filters the screen offers are the filters the service implements —
    // a box the service ignores is worse than no box
    const defs = require('../lib/stages').FILTER_DEFS;
    const offered = { S1: 1, S2: 2, S3R: 3 };
    for (const [key, stage] of Object.entries(offered)) {
      const at = src.indexOf(`bFilterGrid('${key}'`);
      // the array closes on its own line; what follows the bracket differs by
      // table now that two of them are handed a spread as well, so the end of
      // the list is the bracket and not whatever comes after it
      const block = src.slice(at, src.indexOf('\n  ]', at));
      for (const m of block.matchAll(/\['([a-zA-Z0-9]+)', '[^']*', '(?:text|num|pick)'/g)) {
        assert.ok(defs[stage][m[1]], `the ${key} table offers a "${m[1]}" filter the service does not implement`);
      }
    }
    // every filter carries hover text, and so does every sort button
    const grids = [...src.matchAll(/\['[a-zA-Z0-9]+', '[^']*', '(?:text|num|pick)', '([^']*)'/g)];
    assert.ok(grids.length >= 30, `every filter needs its own hover text — found ${grids.length}`);
    for (const g of grids) assert.ok(g[1].length > 20, `a filter's hover text says too little: "${g[1]}"`);
    // THE SCREEN NEVER COMPUTES A COUNT OF ITS OWN. The removed Sweep worked
    // out the size of a declared block in the page, beside the engine's own
    // enumerator — two copies of one arithmetic, and a whole test file existed
    // to keep them agreeing. This screen asks the engine for every number it
    // shows, so the two cannot disagree because there is only one.
    assert.ok(src.includes("swAsk('api/stage1-count'") && src.includes("swAsk('api/stage3-count'"),
      'the cost lines must come from the engine, not from arithmetic on the page');
    assert.ok(!/const MENUS = \{/.test(src), 'the page is counting settings for itself again');
    // the obsolete ordering box is gone and nothing still reaches for it
    assert.ok(!src.includes("$('#bSort')") && !src.includes("$('#bGo')"),
      'the every-coin table orders by its columns now — the ordering box and its Apply must be gone');
    // the start buttons still sleep while a run is going (demand 12)
    assert.ok(screens.drawBody('drawSweep').includes('b.disabled = going'), 'the start buttons must sleep while a run is going');
    assert.ok(body.includes('bWireFilters(mount)') || src.includes('bWireFilters(mount)'), 'the filters must be wired, not merely drawn');
  },

  // The agreement dial is fully exposed on the screen — every rule the engine
  // can run is choosable, and nothing is reachable only from code (RULE FIVE).
  async everyAgreementRuleIsReachableFromTheScreen() {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const { vocabulary } = require('../lib/vocabulary');
    const offered = (vocabulary().agreeRule || []).map((o) => o.value);
    assert.deepStrictEqual(offered.slice().sort(), require('../lib/agreement').AGREE_RULES.slice().sort(),
      'the screen must offer exactly the rules the engine implements');
    for (const id of ['swAgreeRule', 'swAgreeShare', 'swAgreeBoth', 'swAgreeHold',
      'swPermAgreeRule', 'swPermAgreeShare', 'swPermAgreeBoth', 'swPermAgreeHold']) {
      assert.ok(src.includes(`id="${id}"`), `${id} must exist on Sweep`);
    }
    // and the two committee-size boxes it replaced are gone entirely
    for (const gone of ['swQ6', 'swQ8', 'swPermAgree"']) {
      assert.ok(!src.includes(gone), `${gone} belonged to the old per-size bars and must be gone`);
    }
    // the launch is sent every one of them
    for (const field of ['agreeRule:', 'agreePct:', 'agreeBothModels:', 'agreePersist:',
      'agreePermuteRule:', 'agreePermutePct:', 'agreePermuteBoth:', 'agreePermutePersist:']) {
      assert.ok(src.includes(field), `the launch payload must carry ${field}`);
    }
  },

  async theBudgetGateDoesTheArithmeticUpFront() {
    const GB = 1073741824;
    // fits / tight / refuse, with the numbers said in the message
    const fits = stages.tallyBudgetFor({ settings: 2772, coins: 17, heapLimitBytes: 1792 * 1048576 });
    assert.strictEqual(fits.band, 'fits', 'the design-scale block fits without comment');
    assert.strictEqual(fits.message, null);
    // the calibration pin: the exact block that killed the old totalling
    // reads as TIGHT under the reshaped one — it runs, and it says so
    const owners = stages.tallyBudgetFor({ settings: 177408, coins: 17, heapLimitBytes: 1792 * 1048576 });
    assert.strictEqual(owners.band, 'tight', `the 177,408 × 17 block must read tight, got ${owners.band} at share ${owners.share}`);
    assert.ok(/it will run, but it is tight/.test(owners.message));
    const over = stages.tallyBudgetFor({ settings: 1000000, coins: 17, heapLimitBytes: 1792 * 1048576 });
    assert.strictEqual(over.band, 'refuse');
    assert.ok(/refuses rather than dying mid-total/.test(over.message) && /Shrink it with fewer settings/.test(over.message),
      'the refusal says why and what to shrink');
    // AND IT NAMES THE DIAL THAT DOES NOT MOVE IT (owner, 2026-08-29: "half as
    // many nulls shouldn't take just as much space"). They were right that the
    // figure did not move and wrong about why, and the message was what misled
    // them: it listed three things to shrink beside a pricings figure that DOES
    // react to the null set size, so a fourth lever was the obvious reading.
    assert.ok(/the null set size does not change it/.test(over.message),
      'the refusal does not say that the null set size cannot move this number, so it will be tried');
    assert.ok(/each deal is counted as it is priced and never kept/.test(over.message),
      'and it does not say WHY, which is the only thing that makes it believable');
    // ...and it says how far over the bar the block is, because "shrink it"
    // with no number is an invitation to guess at a screen that takes a moment
    // to answer each time.
    assert.ok(over.fits > 0 && over.fits < 1000000, `the refusal must work out what WOULD fit; got ${over.fits}`);
    assert.ok(over.message.includes(`${over.fits.toLocaleString()} settings fit`)
      && over.message.includes('this block declares 1,000,000'),
    `the refusal must state both numbers; got: ${over.message}`);
    // the arithmetic behind that: it is settings x coins and NOTHING else, so
    // the same block on the same coins is the same size whatever the nulls are
    const a19 = stages.tallyBudgetFor({ settings: 50000, coins: 5, nullN: 19, heapLimitBytes: 1792 * 1048576 });
    const a99 = stages.tallyBudgetFor({ settings: 50000, coins: 5, nullN: 99, heapLimitBytes: 1792 * 1048576 });
    assert.strictEqual(a19.bytes, a99.bytes,
      'the tally size moved with the null set size — every deal is folded into a running count and never kept, so it must not');
    assert.ok(stages.tallyBudgetFor({ settings: 50000, coins: 10, heapLimitBytes: 1792 * 1048576 }).bytes > a19.bytes,
      'the tally size does not grow with the coins, which is one of the two things it IS made of');
    assert.ok(/GB/.test(over.message), 'the refusal carries the arithmetic, not just a verdict');
    // disk: rows against what is actually free
    const disk = stages.storeBudgetFor({ rows: 10000000, freeBytes: 4 * GB });
    assert.strictEqual(disk.band, 'refuse');
    assert.ok(/free on disk/.test(disk.message) && /clear old record sets/.test(disk.message));
    assert.strictEqual(stages.storeBudgetFor({ rows: 1000, freeBytes: 4 * GB }).band, 'fits');
    // and the launch is wired to both gates — the throws must exist in source
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(src.includes("if (heapGate.band === 'refuse') throw new Error(heapGate.message);"),
      'start stage 3 must refuse an over-budget block by the gate own words');
    assert.ok(src.includes("if (diskGate.band === 'refuse') throw new Error(diskGate.message);"),
      'and the disk gate too');
  },

  // A finished set whose tables would not fit is refused with the arithmetic
  // — said on the set and on the screen — never attempted into the same wall.
  async theOverBudgetTablesAreRefusedNotAttempted() {
    const stamp = Date.now().toString(36);
    const id = `s3-test-${stamp}-ob`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const doc = {
      id, stage: 3, seq: 999987, name: 'S3 #ob', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 1, settings: 50000000 },
      params: { nullN: 9, universe: Array.from({ length: 17 }, (_, i) => `C${i}USDT`) },
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const out = stages.ensureTally(id);
      assert.ok(out.failed, 'an impossible totalling must refuse, not start');
      assert.ok(/Shrink it with fewer settings/.test(out.failed), 'and say what to shrink');
      const back = stages.getSet(id);
      assert.ok(/Shrink it with fewer settings/.test(back.tallyError || ''), 'the refusal is recorded on the set itself');
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
    }
  },

  // The votes a stage keeps must round-trip the store byte-exactly at the
  // 4-decimal grain, so a stored vote can never read differently on reload.
  async theKeptVotesRoundTripTheStore() {
    const id = `s1-test-${Date.now().toString(36)}-v`;
    const dir = rowstore.storeDir(id);
    try {
      const w = rowstore.writer(id, 'votes');
      const row = { u: 0, w: 0, i: 0, ts: 1700000000000, y: 1, m: [[0.1234, 0.5432, 0.3334], [0.25, 0.5, 0.25]] };
      w.push(row);
      w.close();
      const back = rowstore.readAll(id, 'votes');
      assert.deepStrictEqual(back, [row]);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* fixture */ }
    }
  },
  // EVERY MEMBER COUNT THE OWNER READS IS COUNTED, NEVER TYPED (owner,
  // 2026-08-28: "check your tool tips on the Sweep page -- are these true?:
  // 'singles' -- '... 3 members each.' ... fix them all").
  //
  // They were not true. They said 3 and 4 — the counts from before a fourth
  // slice of the numbers was added — and they had been wrong on the screen and
  // in the hovers since that landed. Nothing checked them, so nothing noticed;
  // worse, they were reported to the owner as fixed while the hovers still said
  // 3, because "I changed it" was checked by eye and not by anything.
  //
  // So the counts are DERIVED from the code that actually builds the committee
  // and compared against every number the owner can read. A fifth slice
  // tomorrow fails this until both screens and all three hovers move with it.
  async everyMemberCountOnScreenIsTheCountTheCodeBuilds() {
    const { slimViewsFor } = require('../lib/bracketwork');
    const alone = slimViewsFor(1).length;          // a coin judged on its own
    const withOthers = slimViewsFor(2).length;     // alongside one or two others
    assert.ok(alone >= 1 && withOthers > alone,
      `the committee sizes read ${alone} and ${withOthers} — a coin read alongside others must have more to read, not fewer`);

    // stage 1 trains LOGREG on each slice; stage 2 adds BOOST on the same ones
    const work = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    assert.ok(/slimViewsFor\(combo\.size\)\.map\(\(view\) => \(\{ model: 'logreg', view \}\)\)/.test(work),
      'stage 1 no longer trains one LOGREG member per slice, so these counts are derived from the wrong thing');
    assert.ok(/slimViewsFor\(combo\.size\)\.map\(\(view\) => \(\{ model: 'boost', view \}\)\)/.test(work),
      'stage 2 no longer adds one BOOST member per slice');

    const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const HELP = (() => { const box = {}; // eslint-disable-next-line no-new-func
      new Function('window', fs.readFileSync(path.join(ROOT, 'public', 'help-content.js'), 'utf8'))(box);
      return box.HELP; })();

    // 1. THE TWO LINES THE SWEEP SCREEN PRINTS, one per stage.
    const said = `${alone} per coin on its own, ${withOthers} alongside others`;
    assert.strictEqual((src.split(said).length - 1), 2,
      `the Sweep screen must say "${said}" once for the LOGREG members and once for the BOOST members — `
      + `it says it ${src.split(said).length - 1} time(s), so at least one of those lines is stating a count nobody counted`);

    // 2. THE THREE HOVERS, which is where it was actually wrong.
    const c = HELP.sweep.controls;
    for (const [id, first, full] of [
      ['swSingles', alone, alone * 2],
      ['swDoubles', withOthers, withOthers * 2],
      ['swTriples', withOthers, withOthers * 2],
    ]) {
      const text = `${c[id].what} ${c[id].more || ''}`;
      assert.ok(new RegExp(`\\b${first} members after stage 1\\b`).test(text),
        `the ${id} hover does not say ${first} members after stage 1; it says: ${c[id].what}`);
      assert.ok(new RegExp(`\\b${full} once stage 2\\b`).test(text),
        `the ${id} hover does not say ${full} once stage 2 has added the BOOST members; it says: ${c[id].what}`);
      // and no OTHER member count may sit in the same hover contradicting it
      const others = [...text.matchAll(/(\d+) members\b/g)].map((m) => Number(m[1]))
        .filter((n) => n !== first && n !== full);
      assert.deepStrictEqual(others, [],
        `the ${id} hover also states ${others.join(', ')} members, which is not what the code builds`);
    }
  },

  // WHICH RELEASES CAN BE CHAINED (owner decision, 2026-08-29).
  //
  // The parent refusal compared the WHOLE release string, so ANY difference
  // refused — and it cost real work: a patch that fixed a tab which would not
  // draw and a cost line which would not clear, neither able to touch a kept
  // vote, would have refused a finished stage 2 and sent the owner back to
  // re-run the training. Comparing more than the guard's own definition is not
  // caution, it is a different and wrong rule.
  //
  // CLAUDE.md RULE ONE-C defines the FIRST digit as exactly this question:
  // "something already on disk stops being readable or comparable ... anything
  // that makes yesterday's records refuse." So that is what is compared. Driven
  // through the shipped function, never a copy of its logic.
  async theChainRefusesOnTheDigitThatMeansRecordsRefuse() {
    const same = stages.sameEngineLine;
    // a fix or a new control cannot change what a kept vote means, so they pass
    for (const [a, b] of [['3.0.1', '3.0.2'], ['3.0.1', '3.1.0'], ['3.0.1', '3.9.9'], ['3.0.0', '3.0.0']]) {
      assert.strictEqual(same(a, b), true,
        `${a} -> ${b} was refused. Only the first digit means yesterday's records no longer compare; refusing on the `
        + 'others throws away training the change could not have affected.');
    }
    // and the day the arithmetic really moves, it bites
    for (const [a, b] of [['3.0.1', '4.0.0'], ['2.0.0', '3.0.0'], ['4.9.9', '5.0.0']]) {
      assert.strictEqual(same(a, b), false, `${a} -> ${b} was allowed through — that is a first-digit release`);
    }
    // FAILS SAFE on anything it cannot read as a release at all
    assert.strictEqual(same('weird', '3.1.0'), false, 'an unreadable stamp must fall back to refusing');
    assert.strictEqual(same(undefined, '3.1.0'), false, 'a missing stamp must fall back to refusing');
    assert.strictEqual(same('weird', 'weird'), true, 'two identical unreadable stamps are still the same engine');

    // ...AND THE MEASUREMENT BLOCK CHECK IS UNTOUCHED AND RUNS FIRST. It is the
    // one that catches the numbers themselves changing, and narrowing the
    // release check must not have narrowed it by accident.
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    const mAt = src.indexOf('if (pm !== MEASUREMENTS_VERSION) {');
    const eAt = src.indexOf('if (parent.engineVersion && !sameEngineLine(');
    assert.ok(mAt > 0, 'the measurement block refusal is gone');
    assert.ok(eAt > mAt, 'the release check now runs before the measurement block check — the stronger one must be first');
  },

  // A LONG RUN SAYS HOW FAST IT IS GOING AND WHEN IT LANDS (owner order,
  // 2026-08-29: "no idea if it will take 10 hours or 10 minutes to get to 1%
  // ... give some useful information so long runs aren't pure guesswork").
  //
  // What was on screen: "reading the kept votes: 10/10 units · 0% of
  // 332,572,800 pricings". The words named one phase and the percentage
  // belonged to another, only the middle of stage 3's three phases estimated
  // anything at all, and the estimate was a duration rather than a time of day.
  // Driven through the shipped reporter, never a copy of its arithmetic.
  async everyPhaseOfALongRunReportsItsRateAndWhenItLands() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    const at = src.indexOf('function phaseNote(');
    assert.ok(at > 0, 'the shared phase reporter is gone');
    // eslint-disable-next-line no-new-func
    const phaseNote = new Function(`${src.slice(at, src.indexOf('\n}', at) + 2)}; return phaseNote;`)();

    const now = Date.now();
    // NOTHING FINISHED: no estimate, and it must say nothing rather than zero.
    const cold = {};
    phaseNote(cold, { phase: 'pricing the settings', done: 0, total: 10, word: 'units', startedMs: now - 5 * 60000 });
    assert.strictEqual(cold.perf.phaseEtaMs, null, 'an estimate was invented from no completed work');
    assert.strictEqual(cold.perf.phaseEndsAtMs, null, 'a finish time was invented from no completed work');
    assert.ok(/pricing the settings: 0 of 10 units/.test(cold.progress), `the line must still say where it is: ${cold.progress}`);

    // ONE UNIT IN SIX MINUTES, nine to go: 54 minutes, and a clock time to match.
    const warm = {};
    phaseNote(warm, { phase: 'pricing the settings', done: 1, total: 10, word: 'units', startedMs: now - 6 * 60000 });
    assert.strictEqual(Math.round(warm.perf.phaseEtaMs / 60000), 54,
      `1 of 10 in six minutes is 54 minutes left, got ${Math.round(warm.perf.phaseEtaMs / 60000)}`);
    assert.ok(Math.abs(warm.perf.phaseEndsAtMs - (now + warm.perf.phaseEtaMs)) < 2000,
      'the finish time is not now plus what is left — the screen must never have to add a duration to its own clock');

    // THE RATE IS MEASURED FROM THIS PHASE'S OWN START. A phase clocked from
    // the launch inherits the speed of a phase that has already finished, and
    // stage 3's three phases go at wildly different speeds.
    const late = {};
    phaseNote(late, { phase: 'totalling the tables', done: 5, total: 10, word: 'parts', startedMs: now - 10 * 60000 });
    assert.strictEqual(Math.round(late.perf.phaseEtaMs / 60000), 10, 'half of ten parts in ten minutes is ten minutes left');
    assert.strictEqual(late.perf.phaseWord, 'parts', 'the phase must report its own unit of work, not the previous one\'s');

    // EVERY PHASE OF EVERY STAGE GOES THROUGH IT — a phase that reports by hand
    // is the one that will be silent, which is exactly how this started.
    for (const phase of ['training the LOGREG members', 'training the BOOST members',
      'reading the kept votes', 'pricing the settings', 'totalling the tables']) {
      assert.ok(src.includes(`phase: '${phase}'`), `${phase} does not report through the shared reporter`);
    }
    assert.ok(!/doc\.progress = `stage 3:/.test(src) && !/doc\.progress = `reading the kept votes:/.test(src),
      'a phase is still writing its own progress line, so it can drift from the estimate beside it');

    // AND THE SCREEN READS THOSE FIELDS, or the work above never reaches anyone.
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    for (const [f, why] of [
      ['pf.phaseDone', 'how far through this phase'],
      ['pf.phaseTotal', 'of how much'],
      ['pf.phaseEtaMs', 'how long is left'],
      ['pf.phaseEndsAtMs', 'when it lands'],
      ['pf.phaseElapsedMs', 'how long it has been going'],
    ]) {
      assert.ok(ui.includes(f), `the progress line does not read ${f} — ${why}`);
    }
    assert.ok(/no estimate until the first/.test(ui),
      'a phase with nothing finished shows a bare 0% and no rate, which reads as a stuck job');
    assert.ok(/lands about <b>\$\{hhmm\} UTC<\/b>/.test(ui), 'the finish is not given as a time of day');
  },

  // TWO SETTINGS THAT PRICE THE SAME TRADE ARE ONE SETTING (owner order,
  // 2026-08-29). The band is not an independent dimension at pricing time —
  // simCell uses it only as the unit for d, trail and arm — so equal products
  // mean identical orders. Today's menus happen not to collide; nothing
  // checked that, and `auto` can collide on some coins and not others.
  async settingsThatPriceTheSameTradeAreFoldedIntoOne() {
    const S = (band, dMult, over = {}) => ({
      band, dMult, trailMult: null, armMult: null, tHours: 65, entry: 'breakout', gate: 'always',
      decision: 'argmax', weekdaysOnly: false, agreeRule: 'count', agreePct: 50, agreeBoth: false, agreePersist: 0,
      label: `${band}/${dMult}${over.label || ''}`, ...over,
    });
    const same = [{ bandPct: 5 }, { bandPct: 5 }, { bandPct: 5 }];

    // TODAY'S MENUS MUST BE UNTOUCHED. A guard that folds real choices is worse
    // than no guard: it would silently stop pricing settings the owner asked for.
    const b = require('../lib/bracket');
    const real = [];
    for (const bd of [3, 5, 8]) for (const d of b.D_MULTS) real.push(S(bd, d));
    const now = stages.foldSameTradeSettings(real, same);
    assert.strictEqual(now.kept.length, real.length,
      `${now.folded.length} of today's ${real.length} band-and-distance settings were folded — they are all distinct trades`);

    // A FUTURE MENU THAT COLLIDES IS CAUGHT. 3% x 1.0 and 5% x 0.6 set the rails
    // at the same place; adding 0.6 to the distance menu would pay for both.
    const clash = stages.foldSameTradeSettings([S(3, 1), S(5, 0.6)], same);
    assert.strictEqual(clash.kept.length, 1, 'two settings that set the rails at the same distance were both kept');
    assert.strictEqual(clash.folded.length, 1);
    assert.strictEqual(clash.folded[0].kept, '3/1', 'the first one declared is the one kept');

    // ...AND IT HOLDS FOR THE WHOLE SHAPE, not just the distance: the stop and
    // the arm scale by the band too, so a collision needs all three to line up.
    const trails = [S(3, 1, { trailMult: 1, armMult: 0.5, label: 'A' }), S(5, 0.6, { trailMult: 0.6, armMult: 0.3, label: 'B' })];
    assert.strictEqual(stages.foldSameTradeSettings(trails, same).kept.length, 1,
      'the whole priced shape lines up, so these are one trade');
    const trailsDiffer = [S(3, 1, { trailMult: 1, armMult: 0.5, label: 'A' }), S(5, 0.6, { trailMult: 1, armMult: 0.5, label: 'B' })];
    assert.strictEqual(stages.foldSameTradeSettings(trailsDiffer, same).kept.length, 2,
      'the rails match but the stops do not, so these are two trades and both must run');

    // AUTO, WHICH IS THE ONE THE MENUS CANNOT SHOW. It resolves per unit, so it
    // is the same trade as a fixed band only when it lands there on EVERY unit.
    const autoSame = stages.foldSameTradeSettings([S(5, 1), S('auto', 1)], same);
    assert.strictEqual(autoSame.kept.length, 1, 'auto landed on 5% for every unit and was still priced twice');
    const autoDiffers = stages.foldSameTradeSettings([S(5, 1), S('auto', 1)], [{ bandPct: 5 }, { bandPct: 5 }, { bandPct: 9 }]);
    assert.strictEqual(autoDiffers.kept.length, 2,
      'auto differs from 5% on one coin, so they are two settings and folding them would have thrown a real one away');

    // THE TOLERANCE IS A TOLERANCE, and it is nowhere near the menus' own
    // spacing. A measured band never lands exactly on 5.
    assert.strictEqual(stages.foldSameTradeSettings([S(5, 1), S('auto', 1)], [{ bandPct: 5.02 }]).kept.length, 1,
      'a measured band a fifth of a percent off was treated as a different trade');
    assert.strictEqual(stages.foldSameTradeSettings([S(5, 1), S('auto', 1)], [{ bandPct: 5.4 }]).kept.length, 2,
      'a band 8% away was folded — that is wider than the menus\' own finest distinction (3.75 against 4.0)');
    assert.ok(stages.SAME_TRADE_TOLERANCE > 0 && stages.SAME_TRADE_TOLERANCE <= 0.02,
      `the tolerance is ${stages.SAME_TRADE_TOLERANCE}; above about 2% it starts merging choices the menus mean to keep apart`);

    // NOTHING IS FOLDED WITH NO UNITS TO JUDGE AGAINST. Without the records
    // there is no way to resolve auto, and guessing would drop a real setting.
    assert.strictEqual(stages.foldSameTradeSettings([S(3, 1), S(5, 0.6)], []).kept.length, 2,
      'settings were folded with no units in hand to resolve the bands against');
  },

  // AND IT IS SAID, NOT ABSORBED. A block that quietly prices fewer settings
  // than it declared is the same class of surprise as one that prices more.
  async theFoldedSettingsAreReportedNotAbsorbed() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(/declaredSettings: declaredSettings\.length,/.test(src) && /sameTradeFolded: sameTrade\.length,/.test(src),
      'the record set does not record what the block asked for against what was actually priced');
    assert.ok(/out\.declared = declared\.length;/.test(src) && /out\.folded = folded\.length;/.test(src),
      'the count does not report the fold, so the cost line cannot mention it');
    // the count and the launch must fold through the SAME function, or the
    // number on the screen and the number that runs are two different numbers
    // ...and so must the rebuild that reads what the members actually did for
    // a set already priced: it has to reproduce the block that ran, which
    // means the same fold, not a second idea of which settings existed.
    assert.strictEqual(src.split('foldSameTradeSettings(').length - 1, 4,
      'the fold is called somewhere other than its definition, the count, the launch and the rebuild — those must be the '
      + 'only callers, or the number on the cost line and the number that runs come from different arithmetic');
  },

  // NEITHER HEAVY JOB CAN FIRE DURING THE OTHER (owner order, 2026-08-29: "fix
  // both guards so neither can fire during the other").
  //
  // The guards were asymmetric and only one direction held. A stage launch
  // asked batch.batchRunning() and refused while a sweep was going. Nothing
  // asked the other way, because a stage run is tracked as its own active set
  // and is not a batch — so the planted check, which REGENERATES THE FABRICATED
  // PAIR'S CANDLES and then fires a whole sweep, read the box as idle in the
  // middle of a nine-hour stage 3. Two worker pools against a four-worker
  // allowance, and cache writes underneath a job that is reading.
  //
  // Read out of the source both ways, because the fault was never a wrong
  // answer from one guard — it was a question one of them never asked.
  async neitherHeavyJobCanFireDuringTheOther() {
    const lib = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    const bat = fs.readFileSync(path.join(ROOT, 'lib', 'batch.js'), 'utf8');
    const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

    // ONE ANSWER for everything heavy the stages own — the run AND its
    // totalling, which is just as heavy and just as easy to forget.
    assert.strictEqual(typeof stages.stageBusy, 'function', 'there is no way to ask whether a stage run is going');
    assert.strictEqual(stages.stageBusy(), null, 'an idle box must report nothing busy');
    const fn = lib.slice(lib.indexOf('function stageBusy()'), lib.indexOf('\n}', lib.indexOf('function stageBusy()')));
    assert.ok(/activeSet/.test(fn), 'stageBusy does not notice a stage run');
    assert.ok(/tallyRun/.test(fn), 'stageBusy does not notice a totalling, which holds the same workers');

    // A STAGE REFUSES WHILE A SWEEP RUNS (the direction that already held).
    const claim = lib.slice(lib.indexOf('function claimOrRefuse()'), lib.indexOf('\n}', lib.indexOf('function claimOrRefuse()')));
    assert.ok(/batch\.batchRunning\(\)/.test(claim), 'a stage launch no longer asks whether a sweep is going');

    // A SWEEP REFUSES WHILE A STAGE RUNS (the direction that did not).
    const refuse = bat.slice(bat.indexOf('function launchRefusal()'), bat.indexOf('\n}', bat.indexOf('function launchRefusal()')));
    assert.ok(/require\('\.\/stages'\)\.stageBusy\(\)/.test(refuse),
      'a sweep launch does not ask whether a stage run is going — a stage run is not a batch, so batchRunning() reads '
      + 'null all the way through one');
    assert.ok(/require\('\.\/stages'\)/.test(refuse) && !/^const .*require\('\.\/stages'\)/m.test(bat),
      'lib/stages must be required lazily here — it already requires lib/batch, and asking at load time hands back a half-built module');

    // AND THE PLANTED CHECK REFUSES BEFORE IT WRITES ANYTHING. It regenerates
    // cache data and THEN fires its sweep, so leaning on the sweep refusing a
    // moment later would leave the candles already rewritten.
    const route = srv.slice(srv.indexOf("app.post('/api/planted-gate'"), srv.indexOf("app.post('/api/planted-gate'") + 1400);
    assert.ok(/stages\.stageBusy\(\)/.test(route), 'the planted check does not ask whether a stage run is going');
    assert.ok(route.indexOf('stages.stageBusy()') < route.indexOf('generatePlanted'),
      'the planted check regenerates the fabricated pair BEFORE it checks whether the box is free');

    // ...AND THE BUTTON SLEEPS WITH THE REASON rather than taking a press and
    // refusing after it. Same arithmetic on the status as on the refusal, so
    // the screen and the route cannot disagree about whether it can run.
    const status = srv.slice(srv.indexOf("app.get('/api/planted-gate/status'"), srv.indexOf("app.get('/api/planted-gate/status'") + 900);
    assert.ok(/stages\.stageBusy\(\)/.test(status) && /blockedBy/.test(status),
      'the status does not say what would stop the check, so the button cannot sleep');
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(/gate\.blockedBy \? `disabled title=/.test(ui), 'the planted check button does not sleep while the box is busy');
    assert.ok(/waits for \$\{esc\(gate\.blockedBy\)\} to finish/.test(ui),
      'and it does not say what it is waiting for, which is the only thing that makes a sleeping button bearable');
  },

  // FOUR NUMBERS BESIDE EVERY FILTER THAT TAKES ONE (owner order, 2026-08-29:
  // "beside each of the filters boxes i want 4 columns of numbers: mininum,
  // median, average, maximum").
  //
  // The numbers have to describe the rows the table is HOLDING, not the whole
  // set — a spread that ignores the filters in force tells you about a table
  // you are not looking at, and the first thing anybody does with these is set
  // the next floor from them.
  async theFourNumbersBesideEachFilterDescribeTheRowsTheTableIsHolding() {
    const id = `s3-test-${Date.now().toString(36)}-sp`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const doc = {
      id, stage: 3, seq: 999981, name: 'S3 #sp', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 1, settings: 4 }, params: { nullN: 9 },
      recordsVersion: stages.RECORDS_V,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      const mk = (si, tHours, hold) => ({
        si, label: `q2/6 x t${tHours}h · argmax auto 24/7`, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false,
        bandPct: 2, entry: 'breakout', gate: 'directional', dMult: 1.5, tHours, trailMult: null, armMult: null,
        quorum: 2, members: 6, pnl: 10, trades: 3,
        holdout: { pnl: hold, trades: 4, stops: 1, vsAlwaysLong: 2 },
        beat: 3, pairs: 9, lead: 1.5, u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
      });
      w.push(mk(0, 17, 30));
      w.push(mk(1, 41, -4));
      w.push(mk(2, 65, 12));
      w.push(mk(3, 89, 6));
      w.close();
      await stages.buildTally(doc);

      const all = stages.stage3Ranked(id, 0, 10);
      assert.ok(all.spread, 'the served page carries no spread, so the boxes have nothing to show');
      // t: 17 41 65 89 -> an even count, so the middle is the two middle
      // values averaged, and it is NOT one of the values in the column
      const t = all.spread.tMin;
      assert.deepStrictEqual([t.min, t.median, t.avg, t.max], [17, 53, 53, 89]);
      assert.strictEqual(all.spread.tMax, all.spread.tMin,
        'the two boxes that floor and cap the same column must read the same four numbers');
      // held-back money: 30 -4 12 6 -> min -4, middle (6+12)/2 = 9, avg 11
      const h = all.spread.holdMin;
      assert.deepStrictEqual([h.min, h.median, h.avg, h.max], [-4, 9, 11, 30]);
      // a box that takes words, not a number, gets nothing at all
      for (const wordy of ['decision', 'entry', 'gate', 'rule']) {
        assert.ok(!(wordy in all.spread), `"${wordy}" takes words and must not be given four numbers`);
      }

      // AND THEY MOVE WITH THE FILTERS. With the two losing-or-small settings
      // filtered out the spread must describe what is left, not the four.
      const some = stages.stage3Ranked(id, 0, 10, { holdMin: 10 });
      assert.strictEqual(some.total, 2, 'the fixture is wrong if the floor does not leave two rows');
      const h2 = some.spread.holdMin;
      assert.deepStrictEqual([h2.min, h2.median, h2.avg, h2.max], [12, 21, 21, 30],
        'the four numbers still describe the whole set, so they say nothing about the table on screen');
      const t2 = some.spread.tMin;
      assert.deepStrictEqual([t2.min, t2.max], [17, 65], 'and every other column must narrow with it');

      // the every-coin table's floors carry their own four, over its own rows
      const cn = stages.stage3Coins(id, {});
      assert.ok(cn.spread && cn.spread.minHold, 'the every-coin floors have no numbers beside them');
      assert.deepStrictEqual([cn.spread.minHold.min, cn.spread.minHold.max], [-4, 30]);
      const cn2 = stages.stage3Coins(id, { minHold: 10 });
      assert.deepStrictEqual([cn2.spread.minHold.min, cn2.spread.minHold.max], [12, 30],
        'the every-coin numbers must follow its floors too');
    } finally {
      try { fs.unlinkSync(file); } catch (_) { /* gone */ }
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-tally.json.gz`)); } catch (_) { /* gone */ }
      rowstore.remove(id);
    }
  },

  // A column with nothing in it must say so rather than inventing a zero, and
  // the middle of an odd count is the middle value itself.
  async aColumnWithNoNumbersInItSaysSoInsteadOfReadingZero() {
    const rows = [{ a: 1, b: null }, { a: 5, b: null }, { a: 3, b: undefined }];
    const out = stages.spreadOf(rows, { aMin: ['a', 'min'], bMin: ['b', 'min'], cText: ['c', 'text'] });
    assert.deepStrictEqual([out.aMin.min, out.aMin.median, out.aMin.avg, out.aMin.max], [1, 3, 3, 5],
      'an odd count takes the middle value itself');
    assert.strictEqual(out.aMin.n, 3, 'and it says how many rows it read');
    assert.strictEqual(out.bMin, null, 'a column that is empty must read as empty, not as a column of zeroes');
    assert.ok(!('cText' in out), 'a box that takes words gets nothing');
    // rows that carry no number at all must not drag the average down
    const mixed = stages.spreadOf([{ a: 4 }, { a: null }, { a: 8 }], { aMin: ['a', 'min'] });
    assert.deepStrictEqual([mixed.aMin.avg, mixed.aMin.n], [6, 2], 'a missing value is skipped, never counted as zero');
  },

  // WHAT ACTUALLY AGREED REACHES BOTH TABLES AND THE RECORDS (owner order,
  // 2026-08-29: "i should be seeing on the individual records' columns THE
  // EXACT AGREEMENT MATCH FOR THAT ROW (or the AVERAGE OF THE 8 subrows in
  // the case of the second table)").
  //
  // The share a setting was BUILT on is one number and never moves; what its
  // members actually did is another, and it sits at that share or above it.
  // With only the first recorded, a run built on one share printed that share
  // on every row and looked as though the rule demanded exactly it.
  async whatActuallyAgreedIsCarriedIntoBothTablesAndEveryRecord() {
    const id = `s3-test-${Date.now().toString(36)}-ag`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const doc = {
      id, stage: 3, seq: 999979, name: 'S3 #ag', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 1, settings: 2 }, params: { nullN: 9 },
      recordsVersion: stages.RECORDS_V,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      const mk = (si, decision, trade) => ({
        si, label: `count 75% market t65h · ${decision === 'unusual' ? 'argmax' : decision} auto 24/7`,
        decision: decision === 'unusual' ? 'argmax' : decision, bandMode: 'auto', weekdaysOnly: false,
        bandPct: 2, entry: 'market', gate: 'directional', dMult: null, tHours: 65, trailMult: null, armMult: null,
        agreeRule: decision === 'unusual' ? 'unusual' : 'count', agreePct: 75, agreeBoth: false, agreePersist: 0,
        rung: 6, members: 8, voices: 8, pnl: 10, trades: 3,
        holdout: { pnl: 5, trades: 4, stops: 1, vsAlwaysLong: 2 },
        beat: 5, pairs: 9, lead: 1, u: 0, trade, ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
      });
      // setting 0, coin AAA: two records, one each way, 80% and 90% -> 85
      w.push(mk(0, 'argmax', 'AAA'));
      w.push(mk(0, 'directional', 'AAA'));
      // setting 1, coin AAA: one record whose way of asking has no answer
      // stored — a set priced before this was measured, and not yet rebuilt
      w.push(mk(1, 'unusual', 'AAA'));
      w.close();
      // THE ANSWERS LIVE BESIDE THE SET, keyed by the unit and the way of
      // asking, never on the record: two ways of asking over one unit is two
      // numbers, not three records' worth.
      stages.writeAgreed(id, {
        '0|argmax|count|all|75|98|0|0': { agreed: 80, agreedLow: 75, agreedHigh: 100, agreedN: 40 },
        '0|directional|count|all|75|98|0|0': { agreed: 90, agreedLow: 87.5, agreedHigh: 100, agreedN: 12 },
      });
      await stages.buildTally(doc);

      const rk = stages.stage3Ranked(id, 0, 10);
      const r0 = rk.rows.find((r) => r.si === 0);
      const r1 = rk.rows.find((r) => r.si === 1);
      assert.ok(Math.abs(r0.avgAgreed - 85) < 1e-12, `80 and 90 average 85; got ${r0.avgAgreed}`);
      assert.strictEqual(r1.avgAgreed, null,
        'a record priced before the measurement existed must read as absent, never as zero agreement');
      // it is a column the table can be ordered by
      stages.setSetSort(id, [{ key: 'avgAgreed', dir: 'desc' }]);
      assert.deepStrictEqual(stages.stage3Ranked(id, 0, 10).rows.map((r) => r.avgAgreed), [85, null],
        'the ranked table does not sort by what actually agreed, and a missing value must sit last');
      stages.setSetSort(id, []);
      // and a floor on it
      const floored = stages.stage3Ranked(id, 0, 10, { agreedMin: 86 });
      assert.strictEqual(floored.total, 0, 'the floor on what agreed does not bite');
      assert.strictEqual(stages.stage3Ranked(id, 0, 10, { agreedMin: 85 }).total, 1);
      assert.throws(() => stages.stage3Ranked(id, 0, 10, { shareMin: 70 }), /not a filter/,
        'the dial floor must be gone — it hid nothing on a run built on one share');
      // the four numbers beside the box read the column, not the dial
      assert.deepStrictEqual([rk.spread.agreedMin.min, rk.spread.agreedMin.max], [85, 85]);
      assert.strictEqual(rk.spread.agreedMin.n, 1, 'the row with no value must not be counted in the four numbers');

      // the every-coin table: the average of the records underneath it
      const cn = stages.stage3Coins(id, {});
      const cAAA = cn.rows.find((r) => r.cellLabel === 'count 75% market t65h');
      assert.strictEqual(cAAA.rows, 3, 'the fixture is wrong if the coin row does not hold all three records');
      assert.ok(Math.abs(cAAA.avgAgreed - 85) < 1e-12,
        `the coin row averages only the records that HAVE a value: 80 and 90 -> 85; got ${cAAA.avgAgreed}`);
      assert.strictEqual(stages.stage3Coins(id, { minAgreed: 86 }).rows.length, 0, 'the every-coin floor does not bite');
      assert.strictEqual(stages.stage3Coins(id, { sort: 'agreed' }).rows.length, 1, 'the every-coin table cannot sort by it');
      assert.ok(cn.spread && cn.spread.minAgreed, 'the every-coin floor has no four numbers beside it');

      // the records themselves carry their own, with the least and the most
      const got = stages.stage3CoinRows(id, {
        cellLabel: 'count 75% market t65h', trade: 'AAA', ctx1: '', ctx2: '', geometry: 'daily-4d',
      });
      const withVal = (got.rows || []).filter((r) => r.agreed != null);
      assert.strictEqual(withVal.length, 2, 'the records under the row do not carry what actually agreed');
      assert.deepStrictEqual(withVal.map((r) => [r.agreed, r.agreedLow, r.agreedHigh, r.agreedN]).sort((x, y) => x[0] - y[0]),
        [[80, 75, 100, 40], [90, 87.5, 100, 12]],
        'each record must carry ITS OWN figure, with the least and the most it got and how many calls');
    } finally {
      try { fs.unlinkSync(file); } catch (_) { /* gone */ }
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-tally.json.gz`)); } catch (_) { /* gone */ }
      rowstore.remove(id);
    }
  },

  // THE gate FILTER IS A DROPDOWN OF THE ENGINE'S OWN GATES (owner order,
  // 2026-08-29: "where's the drop down selector on gate on table 3.A?").
  //
  // There are three gates and it was a typing box, which let a gate be typed
  // that matches nothing and made "a" keep both `always` and `active`. And it
  // read the STORED gate, which a setting opened at market carries even though
  // the column prints a dash for it — so the filter handed back rows the
  // screen says have no gate.
  async theGateFilterOffersTheEnginesOwnGatesAndTheOnesWithout() {
    const id = `s3-test-${Date.now().toString(36)}-gt`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const doc = {
      id, stage: 3, seq: 999977, name: 'S3 #gt', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 1, settings: 3 }, params: { nullN: 9 },
      recordsVersion: stages.RECORDS_V,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      const mk = (si, entry, gate) => ({
        si, label: `count 75% ${entry} t65h · argmax auto 24/7`, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false,
        bandPct: 2, entry, gate, dMult: entry === 'market' ? null : 1.5, tHours: 65, trailMult: null, armMult: null,
        agreeRule: 'count', agreePct: 75, agreeBoth: false, agreePersist: 0,
        rung: 6, members: 8, voices: 8, pnl: 10, trades: 3,
        holdout: { pnl: 5, trades: 4, stops: 1, vsAlwaysLong: 2 },
        beat: 5, pairs: 9, lead: 1, u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
      });
      w.push(mk(0, 'breakout', 'always'));
      w.push(mk(1, 'breakout', 'active'));
      // opened at market: it carries a gate in the record and the column
      // prints a dash, because no gate applies to it
      w.push(mk(2, 'market', 'always'));
      w.close();
      await stages.buildTally(doc);

      const pick = (g) => stages.stage3Ranked(id, 0, 10, { gate: g }).rows.map((r) => r.si).sort();
      assert.deepStrictEqual(pick('always'), [0], 'picking a gate must not hand back the market row the column shows a dash for');
      assert.deepStrictEqual(pick('active'), [1], '"active" must not also keep "always"');
      assert.deepStrictEqual(pick('does not apply'), [2], 'there is no way to pick the settings no gate applies to');
      assert.strictEqual(stages.stage3Ranked(id, 0, 10).total, 3, 'and an empty box still shows every setting');
    } finally {
      try { fs.unlinkSync(file); } catch (_) { /* gone */ }
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-tally.json.gz`)); } catch (_) { /* gone */ }
      rowstore.remove(id);
    }
  },

  // ...and the box the owner presses is a dropdown, filled from the engine.
  async theGateBoxIsADropdownFilledFromTheEngineNotFromTheScreen() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const fn = ui.slice(ui.indexOf('function bGateFilterSpec('), ui.indexOf('function bFilterGrid('));
    assert.ok(fn.length > 100, 'the gate box no longer has a spec of its own');
    assert.ok(/VOCAB && VOCAB\.gate/.test(fn), 'the gate choices are not read from what the engine serves');
    assert.ok(/'does not apply'/.test(fn), 'there is no choice for the settings no gate applies to');
    assert.ok(!/'always'/.test(fn) && !/'active'/.test(fn) && !/'directional'/.test(fn),
      'a gate is typed into the page — adding one to the engine would leave the screen behind');
    assert.ok(/return \['gate', 'gate', 'text', hoverType\]/.test(fn),
      'with the engine\'s list missing the box must stay a typing box, not offer a short dropdown');
    assert.ok(/bGateFilterSpec\(/.test(ui.slice(ui.indexOf("bFilterGrid('S3R'"))), 'Table 3.A does not use it');
    // and the engine really does serve them
    const vocab = require('../lib/vocabulary');
    const served = (typeof vocab.vocabulary === 'function' ? vocab.vocabulary() : vocab)['gate'];
    assert.ok(Array.isArray(served) && served.length >= 3, 'the engine serves no gate list for the dropdown to read');
  },

  // NOTHING ANYWHERE KNOWS THE RETIRED NAME (RULE NINE). Every set on disk was
  // moved onto today's shape and the code that moved them went out with the
  // job, so there is no longer anywhere that may mention it at all. This is
  // the guard that keeps it so: one translation reintroduced is one place for
  // two vocabularies to drift, which is exactly how a key came to be built two
  // different ways in the first place.
  async noReaderAnywhereKnowsTheRetiredName() {
    for (const f of ['lib/agreement.js', 'lib/stagework.js', 'lib/stages.js', 'lib/vocabulary.js', 'public/construct.js']) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\/[^\n]*/g, '');
      assert.ok(!/unusual/i.test(src),
        `${f} knows the retired name outside a comment — records are migrated, never interpreted`);
    }
    // ONE key, built one way, from either side
    const sw = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    assert.ok(/const agreedKeyOfRecord = \(r\) => agreedKey\(r\.decision, agrOf\(r\)\);/.test(sw),
      'the two keys are two expressions again, so they can disagree again');
    // ...and the stamp stays, because the next shape change needs it
    const st = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(/const RECORDS_V = \d+;/.test(st) && /recordsVersion: RECORDS_V,/.test(st),
      'a new record set no longer says which shape it is in, so the next migration has nothing to read');
  },

  // EVERY DIAL THAT CAN CHANGE A CALL MAKES A SETTING ITS OWN (2026-08-30).
  // The bar was left out of the fold's key, so the same way of weighing at the
  // same share against the two different bars read as ONE trade and half the
  // block was thrown away silently — which is exactly what happened on the
  // owner's set the first time the answers were rebuilt after the split.
  async twoQuorumsThatCanCallDifferentlyAreNeverOneSetting() {
    const both = stages.settingsFor({
      cell: { entry: 'market', tHours: 89 }, agreeRule: 'count', agreePct: 75, agreePermuteBar: true,
    }, [1]);
    assert.strictEqual(both.length, 2, 'the two bars must survive as two settings');
    const { kept, folded } = stages.foldSameTradeSettings(both, [{ trade: 'AAA', bandPct: 2 }]);
    assert.strictEqual(kept.length, 2, `the fold dropped a bar: ${folded.map((f) => f.dropped).join(', ')}`);
    assert.deepStrictEqual(kept.map((k) => k.agreeBar).sort(), ['all', 'own']);
    // ...and the whole grid survives it
    const grid = stages.settingsFor({
      cell: { entry: 'market', tHours: 89 }, agreePermuteRule: true, agreePermuteBar: true, agreePct: 75,
    }, [1]);
    const after = stages.foldSameTradeSettings(grid, [{ trade: 'AAA', bandPct: 2 }]).kept;
    assert.strictEqual(new Set(after.map((k) => `${k.agreeRule}|${k.agreeBar}`)).size, 8,
      'four ways of weighing against two bars is eight settings, and every one must reach the block');
  },

  // NO CACHE INSIDE THE PRICING MAY LIST THE QUORUM'S DIALS BY HAND
  // (2026-08-30). The stream cache did, the bar was added without it, and two
  // settings differing only in their bar shared one cached set of calls — the
  // second priced with the first's. On the owner's own set that made every
  // its-own-history answer an exact copy of its all-of-them twin, including
  // conviction's, which is the one the bar exists to rescue.
  //
  // The cure is structural: one definition of what makes a quorum itself, and
  // every cache keyed through it, so a dial cannot be added without arriving
  // everywhere it matters.
  async everyCacheInThePricingIsKeyedByTheWholeQuorum() {
    const sw = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    // EVERY DIAL THAT CAN CHANGE A CALL, and the day one was added without
    // arriving here the caches confused two settings for each other.
    const key = /const agreedKey = \(decision, agr\) => `([^`]+)`;/.exec(sw);
    assert.ok(key, 'the one definition of what makes a quorum itself is gone');
    for (const dial of ['agr.rule', 'agr.bar', 'agr.pct', 'agr.copy', 'agr.both', 'agr.persist', 'decision']) {
      assert.ok(key[1].includes(dial), `the quorum's key leaves out ${dial}, so two settings that differ only there share one answer`);
    }
    assert.ok(/const key = `\$\{agreedKey\(decision, agr\)\}\|\$\{dealIdx\}\|\$\{slice\}`;/.test(sw),
      'the stream cache lists the quorum dials by hand again, so a dial added tomorrow will be left out of it');
    // ...and nothing else in the file enumerates them by hand either
    const byHand = [...sw.matchAll(/\$\{agr\.pct\}[^`]*\$\{agr\.(both|persist)/g)];
    assert.strictEqual(byHand.length, 1,
      `${byHand.length} places spell out the quorum's dials; only agreedKey may`);
    // the two bars really are two different questions at the same share
    const a = require('../lib/agreement');
    const calls = [[1, 1, 1, 1], [1, 1, 0, -1], [1, 0, 0, -1], [1, 1, 1, 0]];
    const ctx = { calls, families: ['full', 'prices', 'volume', 'pricevol'], weights: a.voiceGroups(calls, 4).weights };
    const asShareOfAll = Math.max(1, Math.ceil(0.75 * 4));
    const asShareOfItsOwn = a.ownHistoryBar(ctx, 4, 'count', 75);
    assert.notStrictEqual(asShareOfAll, asShareOfItsOwn,
      'the fixture cannot tell the two bars apart, so it proves nothing about a cache that confuses them');
  },

  // ONE SETTING'S COINS, FROM THE ROW ITSELF (owner order, 2026-08-30: Table
  // 3.A's rows "should be (a) numbered and (b) have a filter 3.B button ... so
  // that only the (5 in this case) coins under with specific config are
  // displayed in 3.B").
  async aRowOfTableThreeAPinsTableThreeBToItsOwnCoins() {
    const id = `s3-test-${Date.now().toString(36)}-pn`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const doc = {
      id, stage: 3, seq: 999971, name: 'S3 #pn', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 2, settings: 2 }, params: { nullN: 9 },
      recordsVersion: stages.RECORDS_V,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      const mk = (si, cell, trade) => ({
        si, label: `${cell} · argmax auto 24/7`, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false,
        bandPct: 2, entry: 'market', gate: 'directional', dMult: null, tHours: 65, trailMult: null, armMult: null,
        agreeRule: 'count', agreeBar: 'all', agreePct: 75, agreeBoth: false, agreePersist: 0,
        rung: 6, members: 8, voices: 8, pnl: 10, trades: 3,
        holdout: { pnl: 5, trades: 4, stops: 1, vsAlwaysLong: 2 },
        beat: 5, pairs: 9, lead: 1, u: 0, trade, ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
      });
      // one setting on two coins, and another whose name STARTS WITH the first
      w.push(mk(0, 'count 75% market t65h', 'AAA'));
      w.push(mk(0, 'count 75% market t65h', 'BBB'));
      w.push(mk(1, 'count 75% market t65h long', 'CCC'));
      w.close();
      await stages.buildTally(doc);

      assert.strictEqual(stages.stage3Coins(id, {}).total, 3, 'the fixture is wrong if the table does not hold three');
      const pinned = stages.stage3Coins(id, { setting: 'count 75% market t65h' });
      assert.strictEqual(pinned.total, 2, 'pinning must leave exactly the coins that setting was priced on');
      assert.deepStrictEqual(pinned.rows.map((r) => r.trade).sort(), ['AAA', 'BBB']);
      assert.strictEqual(pinned.removed, 1, 'and the line under the table must own up to what it held back');
      // WHOLE, not by containing: a name that is the start of a longer one
      // must not drag the longer one's coins in beside it
      assert.ok(!pinned.rows.some((r) => r.trade === 'CCC'),
        'the pin matches by containing, so a longer setting name is caught by a shorter one');
    } finally {
      try { fs.unlinkSync(file); } catch (_) { /* gone */ }
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-tally.json.gz`)); } catch (_) { /* gone */ }
      rowstore.remove(id);
    }
  },

  // ...and the row carries its number and its button.
  async everyRowOfTableThreeASaysWhereItSitsAndCanPinTheOneBelow() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(/\(from \+ i \+ 1\)\.toLocaleString\(\)/.test(ui),
      'the number is not the row\'s place in the whole table, so page two would start at 1 again');
    assert.ok(/data-bpin3b="\$\{esc\(String\(r\.label\)\.split\(' · '\)\[0\]\)\}"/.test(ui),
      'the button does not carry the setting name Table 3.B is keyed by');
    assert.ok(/btn\.onclick = \(\) => \{[\s\S]{0,600}btn\.dataset\.bpin3b/.test(ui), 'the button is drawn but never wired');
    // A BUTTON THAT WRAPS MAKES EVERY ROW OF THE TABLE TALLER (RULE FOUR).
    // Three words in a narrow column broke over two lines and doubled the
    // height of all 329,280 rows.
    assert.ok(/data-bpin3b="[^"]*"[^>]*white-space:nowrap[^>]*>show in 3\.B<\/button>/.test(ui),
      'the button can wrap, which makes every row of Table 3.A twice as tall');
    assert.ok(/offset: 0 \},\n      \}\);/.test(ui),
      'pinning leaves the every-coin table on whatever page it was, which can be past the end of what is left');
    // EVERY OTHER FLOOR COMES OFF, or some of the setting's coins stay hidden
    // by something set earlier with no hint why
    assert.ok(/all\.S3C = \{ setting: btn\.dataset\.bpin3b \};/.test(ui),
      'pinning adds the setting beside whatever floors were already on, so it cannot show all of its coins');
    // ...and what was there is kept, so one press puts it back
    assert.ok(/s3cBeforePin: before,/.test(ui), 'nothing remembers the filters that were taken off');
    assert.ok(/data-bunpin3b/.test(ui) && /revert filters/.test(ui),
      'there is no way to put the filters back after show in 3.B took them off');
    assert.ok(/all\.S3C = \{ \.\.\.\(bView\(\)\.s3cBeforePin \|\| \{\}\) \};/.test(ui),
      'putting them back does not restore what was remembered');
    assert.ok(/s3cBeforePin: null/.test(ui), 'the remembered filters are never let go of, so the button never goes away');
    // it takes the reader TO Table 3.B rather than holding still: it is
    // pressed from the table above and the answer is the one below
    assert.ok(/bRedrawScrolledToCoinHead\(\);/.test(ui), 'pinning does not bring Table 3.B onto the screen');
    assert.ok(/async function bRedrawScrolledToCoinHead\(\)/.test(ui), 'the scroll-to helper is gone');
    // the box has to be able to show a whole setting name
    assert.ok(/opts === 'wide' \? ' style="width:26rem"' : ''/.test(ui),
      'a text filter cannot be widened, so the setting box cannot show what is in it');
    assert.ok(/'shows only the coins of the setting named here[^']*', 'wide'\]/.test(ui),
      'the setting box is not the wide one, so its own value cannot be read');

    // THE PRESSED BUTTON STAYS MARKED, and the one record it IS is marked
    // too — both off the SAME stored fact, so they cannot disagree about
    // which row of Table 3.A is in play (owner order, 2026-08-30).
    assert.ok(/const bPin = \(\) => bView\(\)\.s3cPin \|\| null;/.test(ui), 'nothing remembers which row was pressed');
    assert.ok(/bPinnedRow\(r\) \? ';font-weight:700' : ''/.test(ui), 'the pressed button does not stay marked');
    assert.ok(/function bPinnedRecord\(r\)/.test(ui) && /const mine = bPinnedRecord\(r\);/.test(ui),
      'no record is picked out of a coin\'s eight as the one that was pressed');
    for (const dial of ['decision', 'bandMode', 'weekdaysOnly']) {
      assert.ok(new RegExp(`p\\.${dial}`).test(ui.slice(ui.indexOf('function bPinnedRecord('), ui.indexOf('// A SET WHOSE BLOCK'))),
        `the highlighted record does not match on ${dial}, so it could mark the wrong one of the eight`);
    }
    assert.ok(/tr\.pinned > td \{/.test(fs.readFileSync(path.join(ROOT, 'public', 'construct.html'), 'utf8')),
      'the highlight has no style, so it marks nothing the eye can see');
    // pressing another, or putting the filters back, lets go of BOTH marks
    assert.ok(/s3cBeforePin: null, s3cPin: null, openS3: \[\]/.test(ui),
      'putting the filters back leaves the button bold and a record highlighted for a setting no longer pinned');
    // ...and every one of the pinned coins opens its records
    assert.ok(/openS3: 'all',/.test(ui), 'the pinned rows do not open their records');
    assert.ok(/view\.openS3 === 'all' \? new Set\(cr\.map\(\(r\) => keyOf\(r\)\)\)/.test(ui),
      'all is not resolved against the rows the table is actually showing');
    // the box that says what it is pinned to, so it can be seen and cleared
    assert.ok(/\['setting', 'Table 3\.A selection setting', 'text',/.test(ui),
      'nothing on Table 3.B shows which setting it is pinned to, so it cannot be seen or undone');
    assert.ok(/setting: coinF\.setting \?\? ''/.test(ui), 'the pin is drawn but never sent');
    // every heading still has a cell under it
    const rk = ui.indexOf("rr.map((r, i) => `<tr>");
    const hs = ui.lastIndexOf('<thead>', rk);
    const n = (x, t) => (x.match(new RegExp(`<${t}[ >]`, 'g')) || []).length;
    assert.strictEqual(n(ui.slice(hs, ui.indexOf('</thead>', hs)), 'th'),
      n(ui.slice(rk, ui.indexOf('<tr><td colspan', rk)), 'td'),
      'Table 3.A has a different number of headings and cells');
    assert.ok(/colspan="23"/.test(ui), 'the "nothing here" line no longer spans the whole of Table 3.A');
  },

  // A BLOCK PRICED BEFORE IT WAS WHOLE CAN BE FILLED IN (owner order,
  // 2026-08-30: the point of moving a set onto today's shape is to have data
  // that exercises it, and a set that cannot answer for three of the eight
  // ways of asking is not that).
  //
  // What is missing is worked out through the LAUNCH'S OWN enumerator, never
  // from a ratio: multiplying the dials out gave 526,848 where the enumerator
  // says 524,832, and a setting priced twice is invisible in a table of half a
  // million rows.
  // AN AUDIT IS ONLY WORTH THE DAMAGE IT CATCHES (owner, 2026-08-30: "how do i
  // know you haven't made a bunch more issues?").
  //
  // A check that passes on a good set proves nothing. So this builds a sound set,
  // confirms it reads sound, and then breaks it in each of the six ways the
  // passes on this screen could break it — one at a time — and requires the
  // audit to name that one and no other.
  async theAuditCatchesEveryWayThesePassesCouldDamageASet() {
    const mkDoc = (id, names, units) => ({
      id, stage: 3, seq: 999960, name: 'S3 #aud', status: 'done', createdAt: new Date().toISOString(),
      plan: { units, settings: names.length, settingLabels: names.slice() },
      params: {}, recordsVersion: stages.RECORDS_V,
    });
    // names built the way a launch builds them, so a sound set really is sound
    const rec = (si, u, over) => ({
      si,
      label: 'count 75% always d1x t17h · argmax auto 24/7',
      decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
      entry: 'breakout', gate: 'always', dMult: 1, tHours: 17, trailMult: null, armMult: null,
      agreeRule: 'count', agreeBar: 'all', agreePct: 75, agreeCopy: 98, agreeBoth: false, agreePersist: 0,
      members: 6, pnl: 1, trades: 3, holdout: { pnl: 2, trades: 1, stops: 0, vsAlwaysLong: 1 },
      beat: 1, pairs: 9, lead: 1, u, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
      ...(over || {}),
    });
    const NAMES = [
      'count 75% always d1x t17h · argmax auto 24/7',
      'count 75% always d1x t41h · argmax auto 24/7',
      'voices 75% +voice98 always d1x t65h · argmax 3% 24/7',
    ];
    const shape = [
      { tHours: 17 },
      { tHours: 41 },
      { tHours: 65, agreeRule: 'voices', bandMode: 3 },
    ];
    const build = async (id, bend) => {
      const names = NAMES.slice();
      const doc = mkDoc(id, names, 2);
      const rows = [];
      for (let u = 0; u < 2; u++) {
        for (let si = 0; si < names.length; si++) rows.push(rec(si, u, { ...shape[si], label: names[si] }));
      }
      bend(rows, doc);
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(path.join(SETS_DIR, `${id}.json`), JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      for (const r of rows) w.push(r);
      await w.close();
      return stages.getSet(id);
    };
    const clean = (id) => {
      try { fs.rmSync(path.join(SETS_DIR, `${id}.json`), { force: true }); } catch (_) { /* fixture */ }
      try { rowstore.remove(id); } catch (_) { /* fixture */ }
    };
    const failing = (res) => res.checks.filter((c) => !c.ok).map((c) => c.name);

    // ---- sound ----
    let id = `s3-test-${Date.now().toString(36)}-a0`;
    try {
      const res = stages.auditRecordSet(await build(id, () => {}));
      assert.deepStrictEqual(failing(res), [], `a sound set does not read as sound: ${JSON.stringify(res.checks.filter((c) => !c.ok), null, 1)}`);
      assert.strictEqual(res.ok, true);
    } finally { clean(id); }

    // ---- each way it can be broken, one at a time ----
    const bends = [
      ['a record lost', (rows) => { rows.pop(); },
        ['every setting has one record per unit', 'none has more or fewer records than there are units', 'every setting covers every unit, none twice']],
      ['a record filed at the wrong place', (rows) => { rows[1].si = 0; },
        ['every record sits at its own setting’s place', 'none has more or fewer records than there are units', 'every setting covers every unit, none twice']],
      ['a record past the end of the list', (rows) => { rows[2].si = 99; },
        // 'every setting has a record' correctly stays quiet: setting 2 still has
        // its other unit's record. The audit was right and this list was wrong.
        ['no record sits past the end of the list', 'none has more or fewer records than there are units', 'every setting covers every unit, none twice']],
      ['a name today would not write', (rows, doc) => {
        rows.forEach((r) => { if (r.si === 2) r.label = 'voices 75% always d1x t65h · argmax 3% 24/7'; });
        doc.plan.settingLabels[2] = 'voices 75% always d1x t65h · argmax 3% 24/7';
      }, ['every name is the one today’s code would write']],
      ['two settings sharing a name', (rows, doc) => { doc.plan.settingLabels[1] = doc.plan.settingLabels[0]; },
        ['no two settings share a name', 'every record sits at its own setting’s place']],
      ['one unit counted twice and another not at all', (rows) => { rows[3].u = 0; },
        ['every setting covers every unit, none twice']],
    ];
    for (const [what, bend, expect] of bends) {
      id = `s3-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        const res = stages.auditRecordSet(await build(id, bend));
        assert.strictEqual(res.ok, false, `the audit passed a set with ${what}`);
        assert.deepStrictEqual(failing(res).sort(), expect.slice().sort(),
          `with ${what} the audit named the wrong checks: ${failing(res).join(', ')}`);
      } finally { clean(id); }
    }
  },

  // A WHOLE-STORE REWRITE MUST NOT HOLD THE WHOLE STORE (found by watching the
  // drop run on the owner's set, 2026-08-30: 1.9 GB of a 1.8 GB ceiling, on a
  // service that had already died of memory once that day).
  //
  // flush() only QUEUES a block for compression — the queue is drained by
  // close(), at the very end. A loop that flushes and never awaits therefore
  // holds every block of the store in memory at once, however carefully it
  // streams the reading. It survived; it should not have had to.
  async everyWholeStoreRewriteDrainsAsItGoes() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    for (const fn of ['renameSettingsToV3', 'dropSettingsNamed', 'undoUnfinishedAppend']) {
      const at = src.indexOf(`async function ${fn}(`);
      assert.ok(at > 0, `${fn} is gone`);
      const body = src.slice(at, src.indexOf('\n}\n', src.indexOf('return {', at)));
      assert.ok(/await w\.drain\(\)/.test(body),
        `${fn} writes a whole store and never drains, so every block of it waits in memory for the close at the end`);
      // and it must actually be inside the block loop, not once at the end
      const loop = body.slice(body.indexOf('for (let b = 0'), body.indexOf('await w.close()'));
      assert.ok(/await w\.drain\(\)/.test(loop),
        `${fn} drains only after the loop, which is the same as not draining at all`);
    }
  },

  // A FIELD ADDED PART-WAY THROUGH A WRITE (found by the audit on the owner's
  // own set, 2026-08-30: twelve records of 5,260,920 do not carry agreeCopy).
  //
  // The store writes its column list from the first row of a run and grows it
  // when a wider row arrives, so rows written BEFORE the growth read back one
  // field short. Nothing has ever been wrong about them — every reader resolves
  // the missing share to the same 98 every other record stores — but a record
  // leaning on a default is a record that does not say what it is.
  //
  // Two things have to hold: the audit has to name the FIELD and count the
  // records that lack it (not the ones that have it), and the pass that
  // rewrites the store has to write it.
  async aFieldMissingFromSomeRecordsIsNamedAndThenWritten() {
    const id = `s3-test-${Date.now().toString(36)}-fld`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const NAMES = ['count 75% always d1x t17h · argmax auto 24/7', 'count 75% always d1x t41h · argmax auto 24/7'];
    const rec = (si, u, withCopy) => {
      const r = {
        si, label: NAMES[si], decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
        entry: 'breakout', gate: 'always', dMult: 1, tHours: si ? 41 : 17, trailMult: null, armMult: null,
        agreeRule: 'count', agreeBar: 'all', agreePct: 75, agreeBoth: false, agreePersist: 0,
        pnl: 1, trades: 1, u, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
      };
      // the narrow rows go FIRST, exactly as they did on the box
      return withCopy ? { ...r, agreeCopy: 98 } : r;
    };
    const doc = {
      id, stage: 3, seq: 999959, name: 'S3 #fld', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 2, settings: 2, settingLabels: NAMES.slice() },
      params: {}, recordsVersion: stages.RECORDS_V,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      w.push(rec(0, 0, false));          // one narrow row, then the store widens
      w.push(rec(0, 1, true));
      w.push(rec(1, 0, true));
      w.push(rec(1, 1, true));
      await w.close();

      const before = stages.auditRecordSet(stages.getSet(id));
      const fieldCheck = before.checks.find((c) => /every field any record carries/.test(c.name));
      assert.ok(fieldCheck, 'the audit does not check that every record carries every field');
      assert.strictEqual(fieldCheck.ok, false, 'a record missing a field read as sound');
      assert.ok(/agreeCopy/.test(fieldCheck.detail), `the audit does not name the field: ${fieldCheck.detail}`);
      assert.ok(/^1 records? do not carry/.test(fieldCheck.detail),
        `the audit counted the records that HAVE the field instead of the ones that do not: ${fieldCheck.detail}`);
      // and nothing else is wrong with this set
      assert.deepStrictEqual(before.checks.filter((c) => !c.ok).map((c) => c.name), [fieldCheck.name],
        'a set that is only short one field reads as broken in other ways too');

      // the pass that rewrites the store writes it — same value, written down
      await stages.dropSettingsNamed(stages.getSet(id), new Set([NAMES[1]]));
      const back = rowstore.readAll(id, 'records').map((x) => x.row || x);
      for (const r of back) {
        assert.strictEqual(r.agreeCopy, 98, `a rewritten record still leans on the default: ${JSON.stringify(r).slice(0, 120)}`);
      }
      const after = stages.auditRecordSet(stages.getSet(id));
      assert.deepStrictEqual(after.checks.filter((c) => !c.ok).map((c) => c.name), [],
        `the set is still not sound after the rewrite: ${JSON.stringify(after.checks.filter((c) => !c.ok))}`);
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
      try { rowstore.remove(id); } catch (_) { /* fixture */ }
    }
  },

  // A FILL-IN THAT DID NOT FINISH (owner order, 2026-08-30: "look at the state
  // of the data and do it right this time and give me the buttons i need to fix
  // the data").
  //
  // Filling in writes its rows one unit at a time and the set's list of setting
  // names once, at the very end. A run that is stopped, or that dies of memory
  // as this box's service did, leaves records at positions the list does not
  // reach with NOTHING written down to say so. It has to be findable from the
  // records alone, and it has to be undoable.
  async anUnfinishedFillInIsFoundFromTheRecordsAloneAndCanBePutBack() {
    const id = `s3-test-${Date.now().toString(36)}-half`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const names = ['count 75% always d1x t17h · argmax auto 24/7', 'count 75% always d1x t41h · argmax auto 24/7'];
    const mk = (si, u, label) => ({
      si, label, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
      entry: 'breakout', gate: 'always', dMult: 1, tHours: 17, trailMult: null, armMult: null,
      agreeRule: 'count', agreeBar: 'all', agreePct: 75, agreeBoth: false, agreePersist: 0,
      members: 6, pnl: 10 + si, trades: 3, holdout: { pnl: 30, trades: 4, stops: 1, vsAlwaysLong: 2 },
      beat: 3, pairs: 9, lead: 1.5, u, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
    });
    const doc = {
      id, stage: 3, seq: 999971, name: 'S3 #half', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 3, settings: 2, settingLabels: names.slice() },
      params: { nullN: 9 }, recordsVersion: stages.RECORDS_V,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      // the whole set: two settings over three units
      for (let u = 0; u < 3; u++) { for (let si = 0; si < 2; si++) w.push(mk(si, u, names[si])); w.flush(); }
      const wholeBytes = null;
      // ...and then a run that got two of the three units through, appending
      // two new settings at positions 2 and 3
      for (let u = 0; u < 2; u++) {
        w.push(mk(2, u, 'count 75% always d1x t65h · argmax auto 24/7'));
        w.push(mk(3, u, 'count 75% always d1x t89h · argmax auto 24/7'));
        w.flush();
      }
      await w.close();
      assert.strictEqual(wholeBytes, null);   // (kept only to name the two phases above)

      // FOUND WITHOUT A NOTE, and for free: six is two settings over three
      // units, and there are ten.
      const gap = stages.unfinishedAppend(stages.getSet(id));
      assert.ok(gap, 'an unfinished run leaves no trace the screen can see');
      assert.deepStrictEqual({ rows: gap.rows, whole: gap.whole, extra: gap.extra }, { rows: 10, whole: 6, extra: 4 },
        'the count of what a whole set would hold is wrong, so the screen would say the wrong thing');

      // and the detail says which units got that far — two whole, none part
      const detail = stages.unfinishedAppendDetail(stages.getSet(id));
      assert.deepStrictEqual({ settings: detail.settings, extra: detail.extra, whole: detail.unitsWhole.length, part: detail.unitsPart.length },
        { settings: 2, extra: 4, whole: 2, part: 0 },
        'the repair cannot tell which units the unfinished run got through');

      // NOTHING MAY BE ADDED TO A SET IN THIS STATE
      let threw = null;
      try { await stages.appendMissingSettings(stages.getSet(id)); } catch (err) { threw = err.message; }
      assert.ok(threw && /past the end of its own list of names/.test(threw),
        `a set with a half-written run was appended to anyway: ${threw}`);

      const out = await stages.undoUnfinishedAppend(stages.getSet(id));
      assert.deepStrictEqual({ rows: out.rows, left: out.left }, { rows: 4, left: 6 },
        'undoing did not take back exactly what the unfinished run wrote');
      const back = rowstore.readAll(id, 'records').map((x) => x.row || x);
      assert.strictEqual(back.length, 6, 'the set is not back to what it held before');
      assert.deepStrictEqual([...new Set(back.map((r) => r.si))].sort((a, b) => a - b), [0, 1],
        'a position past the end of the list survived');
      for (const r of back) assert.strictEqual(r.label, names[r.si], 'a kept record sits at the wrong position');
      assert.ok(!rowstore.exists(id, 'records-undoing'), 'the copy it wrote beside the records was left on disk');
      assert.strictEqual(stages.unfinishedAppend(stages.getSet(id)), null, 'the set still reads as half-written');

      // and again does nothing
      assert.ok((await stages.undoUnfinishedAppend(stages.getSet(id))).already, 'running it a second time did something');
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
      try { rowstore.remove(id); } catch (_) { /* fixture */ }
    }
  },

  // The check that undoing leaves the right number behind cannot be shown
  // working on the happy path, where the counts agree and removing it changes
  // nothing. So this set is genuinely SHORT a record it should have — one
  // setting over two units, and only one of them on disk — as well as carrying
  // an unfinished run. Undoing would then swap in a store missing real work,
  // and the check is the only thing that notices.
  async anUndoThatWouldLeaveTheWrongNumberIsRefused() {
    const id = `s3-test-${Date.now().toString(36)}-uvf`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const names = ['count 75% always d1x t17h · argmax auto 24/7'];
    const mk = (si, u, label) => ({
      si, label, u, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
      entry: 'breakout', gate: 'always', dMult: 1, tHours: 17, trailMult: null, armMult: null,
      agreeRule: 'count', agreeBar: 'all', agreePct: 75, agreeBoth: false, agreePersist: 0, pnl: 1,
    });
    const doc = {
      id, stage: 3, seq: 999969, name: 'S3 #uvf', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 2, settings: 1, settingLabels: names.slice() },
      params: {}, recordsVersion: stages.RECORDS_V,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      w.push(mk(0, 0, names[0]));                                          // unit 1 of 2 — unit 2 is MISSING
      w.push(mk(1, 0, 'count 75% always d1x t41h · argmax auto 24/7'));    // and an unfinished run on top
      w.push(mk(1, 1, 'count 75% always d1x t41h · argmax auto 24/7'));
      await w.close();
      const before = fs.readFileSync(rowstore.storeFile(id, 'records'));

      const gap = stages.unfinishedAppend(stages.getSet(id));
      assert.ok(gap && gap.extra > 0, 'the fixture does not read as carrying an unfinished run');

      let threw = null;
      try { await stages.undoUnfinishedAppend(stages.getSet(id)); } catch (err) { threw = err.message; }
      assert.ok(threw && /nothing was replaced/.test(threw),
        `undoing swapped in a store holding the wrong number of records: ${threw}`);
      assert.ok(before.equals(fs.readFileSync(rowstore.storeFile(id, 'records'))),
        'the records were replaced anyway — this is priced work that cannot be got back');
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
      try { rowstore.remove(id); } catch (_) { /* fixture */ }
    }
  },

  // THE GUARD THAT WAS MISSING. The rename was guarded and the duplicates were
  // not, so the owner pressed straight past the gap and paid seven hours for a
  // run that priced around 1,260 rows that were about to be deleted.
  async theMissingSettingsCannotBePricedWhileDuplicatesAreStillHeld() {
    const id = `s3-test-${Date.now().toString(36)}-sur`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const doc = {
      id, stage: 3, seq: 999970, name: 'S3 #sur', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 1, settings: 1, settingLabels: ['count 75% market t17h · argmax 3% 24/7'] },
      params: { nullN: 9 }, recordsVersion: stages.RECORDS_V,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      // the enumerator needs the box's own price data, so this only has to get
      // as far as the guard: with no stage 2 parent it stops there either way,
      // and the point is WHICH message comes back.
      let threw = null;
      try { await stages.appendMissingSettings(stages.getSet(id)); } catch (err) { threw = err.message; }
      assert.ok(threw, 'pricing did not refuse at all');
      assert.ok(!/is going — one heavy job/.test(threw), `it stopped for the wrong reason: ${threw}`);
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
    }
  },

  // The three refusals are in the pass itself, in the order they have to be
  // asked, and each names what to do about it.
  async everyRefusalIsInThePassAndNotOnlyOnTheScreen() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    const fn = src.slice(src.indexOf('async function appendMissingSettings('), src.indexOf('const AGREED_V ='));
    const at = (needle) => fn.indexOf(needle);
    assert.ok(at('settingsBehind(doc)') > 0, 'nothing refuses while a setting name is behind');
    // the CALL is not enough: `if (false)` around the throw leaves the call
    // sitting there and the refusal gone. The branch itself has to be checked.
    assert.ok(at('undeclaredIn(held,') > 0, 'nothing works out whether the set still holds settings its block does not declare');
    assert.ok(/const surplusNow = undeclaredIn\(held,[\s\S]{0,120}\n  if \(surplusNow\) \{/.test(fn),
      'the count of settings the block does not declare is worked out and then not acted on, so pricing goes ahead over '
      + 'duplicates that are about to be deleted');
    assert.ok(at('unfinishedAppend(doc)') > 0, 'nothing refuses while a half-written run stands');
    // read before used, or the whole pass dies on the spot with a reference error
    assert.ok(at('const held =') < at('undeclaredIn(held,'),
      'the list of names is read AFTER the guard that uses it — a const read before its own line throws, so the pass '
      + 'would die instantly rather than refuse');
    // and the stop is asked between units, on both paths
    assert.ok(/if \(wantsStop\(\)\) break;/.test(fn), 'the one-at-a-time path cannot be stopped');
    assert.ok(/wantsStop\(\);\s+\/\/ asked after every unit/.test(fn), 'the pooled path is never asked to stop');
    assert.ok(/if \(pool && pool\.abort\) pool\.abort\(\)/.test(fn),
      'stopping the pooled path does not abort the pool — forEach takes three arguments and ignores a fourth, so a stop '
      + 'passed that way is a button that silently does nothing');
    assert.ok(/if \(stopped\) \{/.test(fn) && fn.indexOf('if (stopped) {') < fn.indexOf('doc.appends = ['),
      'a stopped run writes the set’s list of names anyway, which hides half-covered settings among whole ones');
  },

  // DROPPING THE SETTINGS THE BLOCK NO LONGER DECLARES (owner order,
  // 2026-08-30: "drop the 1,008 market duplicates GO NOW!").
  //
  // A market setting opens at the candle's open with no price levels, so the
  // band cannot change one cent of it; four settings differing only by band are
  // four copies of one trade, and the enumerator keeps one. A set priced before
  // it worked that out holds all four.
  //
  // THIS DELETES PRICED RECORDS. Everything below is about the ways it could
  // delete the wrong ones, because there is no undo short of a full re-run.
  async theSurplusSettingsGoAndWhatIsLeftIsRenumberedWithNoGaps() {
    const id = `s3-test-${Date.now().toString(36)}-drp`;
    const file = path.join(SETS_DIR, `${id}.json`);
    // five settings; a fake enumerator declares three of them
    const names = ['a', 'b', 'c', 'd', 'e'].map((k) => `count 75% always d0.25x t${k.charCodeAt(0)}h · argmax auto 24/7`);
    const DECLARED = [names[0], names[2], names[4]];
    const mk = (si, u) => ({
      si, label: names[si], decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
      entry: 'breakout', gate: 'always', dMult: 0.25, tHours: 17 + si, trailMult: null, armMult: null,
      agreeRule: 'count', agreeBar: 'all', agreePct: 75, agreeBoth: false, agreePersist: 0,
      members: 6, pnl: 10 + si, trades: 3, holdout: { pnl: 30 + si, trades: 4, stops: 1, vsAlwaysLong: 2 },
      beat: 3, pairs: 9, lead: 1.5, u, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
    });
    const doc = {
      id, stage: 3, seq: 999974, name: 'S3 #drp', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 2, settings: names.length, settingLabels: names.slice() },
      params: { nullN: 9 }, recordsVersion: stages.RECORDS_V,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      for (let u = 0; u < 2; u++) { for (let si = 0; si < names.length; si++) w.push(mk(si, u)); w.flush(); }
      await w.close();
      // What the enumerator would say needs the box's own price data, so the
      // decision is written down here and the surgery is what gets exercised.
      const doomed = stages.undeclaredIn(names, DECLARED);
      assert.deepStrictEqual([...doomed], [names[1], names[3]], 'the wrong settings were picked out to go');

      const out = await stages.dropSettingsNamed(stages.getSet(id), doomed);
      assert.strictEqual(out.settings, 2, 'it did not drop exactly the two settings the block does not declare');
      assert.strictEqual(out.rows, 4, 'two settings over two units is four records');
      assert.strictEqual(out.held, 3, 'the set does not hold the three that were declared');

      const back = rowstore.readAll(id, 'records').map((x) => x.row || x);
      assert.strictEqual(back.length, 6, 'three settings over two units is six records');
      // RENUMBERED DENSELY: the next thing added to this set takes a number
      // nothing on disk is using.
      assert.deepStrictEqual([...new Set(back.map((r) => r.si))].sort((a, b) => a - b), [0, 1, 2],
        'the positions that remain have gaps, so the next setting added would collide with one already here');
      const after = stages.getSet(id);
      assert.deepStrictEqual(after.plan.settingLabels, DECLARED, 'the set’s list of names is not what it kept');
      for (const r of back) {
        assert.strictEqual(r.label, after.plan.settingLabels[r.si],
          `a kept record sits at a position that names a different setting: ${r.si} / ${r.label}`);
      }
      // NOT ONE KEPT RESULT MOVED
      for (const r of back) {
        const was = mk(names.indexOf(r.label), r.u);
        assert.deepStrictEqual({ pnl: r.pnl, hold: r.holdout.pnl, beat: r.beat },
          { pnl: was.pnl, hold: was.holdout.pnl, beat: was.beat }, `dropping moved a result on ${r.label}`);
      }
      assert.ok(!rowstore.exists(id, 'records-dropping'), 'the copy it wrote beside the records was left on disk');
      assert.strictEqual((after.drops || []).length, 1, 'the set does not record that it was pruned');

      // RUNNING IT AGAIN DOES NOTHING, because there is nothing left to drop.
      const again = await stages.dropSettingsNamed(stages.getSet(id), stages.undeclaredIn(DECLARED, DECLARED));
      assert.ok(again.already, 'running it a second time did not find the set already clean');
      assert.strictEqual(rowstore.count(id, 'records'), 6, 'running it a second time changed the record count');
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
      try { rowstore.remove(id); } catch (_) { /* fixture */ }
    }
  },

  // A NAME THAT IS ONLY BEHIND ALSO READS AS UNDECLARED. Dropping before
  // renaming would have deleted 65,856 settings on the owner's set that are
  // nothing worse than badly named.
  async nothingIsDroppedWhileANameIsMerelyBehind() {
    const id = `s3-test-${Date.now().toString(36)}-dbh`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const doc = {
      id, stage: 3, seq: 999973, name: 'S3 #dbh', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 1, settings: 1, settingLabels: ['voices 75% always d1x t17h · argmax auto 24/7'] },
      params: { nullN: 9 }, recordsVersion: 2,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      let threw = null;
      try { await stages.dropSettingsNamed(stages.getSet(id), new Set(['anything'])); } catch (err) { threw = err.message; }
      assert.ok(threw && /named in the older way/.test(threw),
        `a set with a behind name was dropped from, which deletes settings that are only badly named: ${threw}`);
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
    }
  },

  // A record is filed under its setting's POSITION in the set's list of names,
  // and dropping renumbers on exactly that. If the two ever disagree,
  // renumbering scrambles the set — so it refuses rather than guesses.
  async aRecordFiledUnderTheWrongPositionStopsTheWholeThing() {
    const id = `s3-test-${Date.now().toString(36)}-dps`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const names = ['count 75% always d1x t17h · argmax auto 24/7', 'count 75% always d1x t41h · argmax auto 24/7'];
    const doc = {
      id, stage: 3, seq: 999972, name: 'S3 #dps', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 1, settings: 2, settingLabels: names.slice() },
      params: { nullN: 9 }, recordsVersion: stages.RECORDS_V,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      // the second record claims position 0 while carrying the other name
      w.push({ si: 0, label: names[0], u: 0, agreeRule: 'count', agreeBar: 'all', agreePct: 75, agreePersist: 0, entry: 'breakout', gate: 'always', dMult: 1, tHours: 17, trailMult: null, armMult: null, pnl: 1 });
      w.push({ si: 0, label: names[1], u: 0, agreeRule: 'count', agreeBar: 'all', agreePct: 75, agreePersist: 0, entry: 'breakout', gate: 'always', dMult: 1, tHours: 41, trailMult: null, armMult: null, pnl: 2 });
      await w.close();
      const before = fs.readFileSync(rowstore.storeFile(id, 'records'));

      let threw = null;
      try { await stages.dropSettingsNamed(stages.getSet(id), new Set([names[1]])); } catch (err) { threw = err.message; }
      assert.ok(threw && /nothing was changed/.test(threw),
        `records were renumbered against a list they do not agree with: ${threw}`);
      assert.ok(before.equals(fs.readFileSync(rowstore.storeFile(id, 'records'))),
        'the records were replaced anyway — this is priced work that cannot be got back');
      assert.deepStrictEqual(stages.getSet(id).plan.settingLabels, names, 'the set’s list of names was changed anyway');
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
      try { rowstore.remove(id); } catch (_) { /* fixture */ }
    }
  },

  // THE RENAME, RUN END TO END ON A REAL RECORD STORE (owner order,
  // 2026-08-30: "regarding the rename the voices first option ... GO NOW!").
  //
  // Exposing the one-voice share put it into the NAME of every setting that
  // weighs by `voices`. The fields underneath never moved — a record with no
  // share stored already resolves to 98, the number that was in the code — so
  // this is a rename and only a rename. But the name is what a block's declared
  // list is matched against, so until it is done the owner's set reads as
  // holding 65,856 settings its own block does not declare.
  //
  // A real store, written and read back, because every way this can go wrong is
  // in the writing: a row lost, a name half-changed, the spare left in place, a
  // record that is not a `voices` one quietly rewritten.
  async theSettingNamesAreBroughtUpToDateWithoutTouchingAResult() {
    const id = `s3-test-${Date.now().toString(36)}-rn`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const mk = (si, rule, tHours, extra) => ({
      si,
      label: `${rule} 75%${extra && extra.persist ? ` +hold${extra.persist}` : ''} always d0.25x t${tHours}h · argmax auto 24/7`,
      decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
      entry: 'breakout', gate: 'always', dMult: 0.25, tHours, trailMult: null, armMult: null,
      agreeRule: rule, agreeBar: 'all', agreePct: 75,
      agreeBoth: false, agreePersist: (extra && extra.persist) || 0,
      members: 6, pnl: 10, trades: 3,
      holdout: { pnl: 30, trades: 4, stops: 1, vsAlwaysLong: 2 },
      beat: 3, pairs: 9, lead: 1.5, u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
    });
    // four settings, two of which weigh by voices; one of those carries a hold
    const made = [mk(0, 'count', 17), mk(1, 'voices', 41), mk(2, 'families', 65), mk(3, 'voices', 89, { persist: 2 })];
    const doc = {
      id, stage: 3, seq: 999977, name: 'S3 #rn', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 1, settings: 4, settingLabels: made.map((r) => r.label) },
      params: { nullN: 9 }, recordsVersion: 2,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      // two blocks, so the walk really walks
      for (const r of made.slice(0, 2)) w.push(r);
      w.flush();
      for (const r of made.slice(2)) w.push(r);
      await w.close();

      assert.strictEqual(stages.settingsBehind(doc), 2, 'the two voices settings do not read as behind');

      const out = await stages.renameSettingsToV3(stages.getSet(id));
      assert.strictEqual(out.settings, 2, 'it did not rename exactly the two voices settings');
      assert.strictEqual(out.rows, made.length, 'the renamed store holds a different number of records');

      const back = rowstore.readAll(id, 'records').map((x) => x.row || x);
      assert.strictEqual(back.length, made.length, 'a record was lost or gained');
      const byLabel = new Map(back.map((r) => [r.label, r]));
      assert.ok(byLabel.has('voices 75% +voice98 always d0.25x t41h · argmax auto 24/7'),
        `the voices setting was not renamed: ${back.map((r) => r.label).join(' | ')}`);
      assert.ok(byLabel.has('voices 75% +voice98 +hold2 always d0.25x t89h · argmax auto 24/7'),
        'the share goes in the wrong place when the setting also holds its call');
      assert.ok(byLabel.has('count 75% always d0.25x t17h · argmax auto 24/7'),
        'a setting that does not weigh by voices was renamed too');
      assert.ok(byLabel.has('families 75% always d0.25x t65h · argmax auto 24/7'),
        'a setting that does not weigh by voices was renamed too');

      // NOT ONE RESULT MOVED. This is the whole promise the screen makes.
      for (const r of back) {
        const was = made.find((m) => m.si === r.si);
        assert.deepStrictEqual(
          { pnl: r.pnl, trades: r.trades, beat: r.beat, pairs: r.pairs, lead: r.lead, hold: r.holdout.pnl },
          { pnl: was.pnl, trades: was.trades, beat: was.beat, pairs: was.pairs, lead: was.lead, hold: was.holdout.pnl },
          `renaming moved a result on setting ${r.si}`);
      }
      // and every voices record now SAYS its share rather than leaving it assumed
      for (const r of back) if (r.agreeRule === 'voices') assert.strictEqual(r.agreeCopy, 98, 'a renamed record does not carry its share');

      const after = stages.getSet(id);
      assert.strictEqual(stages.settingsBehind(after), 0, 'the set still reads as behind after being brought up to date');
      assert.strictEqual(after.recordsVersion, stages.RECORDS_V, 'the set does not record which shape it is at');
      assert.deepStrictEqual(after.plan.settingLabels.slice().sort(), back.map((r) => r.label).sort(),
        'the set’s own list of names and the names on its records do not agree');

      // the spare is gone: left behind it would be counted as part of the set
      assert.ok(!rowstore.exists(id, 'records-renaming'), 'the copy it wrote beside the records was left on disk');

      // RUNNING IT TWICE CHANGES NOTHING. A migration that is not safe to
      // repeat is one nobody can press again after an interruption.
      const again = await stages.renameSettingsToV3(stages.getSet(id));
      assert.strictEqual(again.settings, 0, 'running it a second time renamed something');
      assert.strictEqual(rowstore.count(id, 'records'), made.length, 'running it a second time changed the record count');
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
      try { rowstore.remove(id); } catch (_) { /* fixture */ }
    }
  },

  // MIGRATE BESIDE, VERIFY, THEN SWAP (RULE NINE). The check that the copy
  // holds as many records as the set did is the only thing standing between a
  // short write and a truncated store swapped in over hours of compute that
  // cannot be re-derived from anything but a full re-run.
  //
  // The happy path cannot show that check working, because on the happy path
  // the counts agree and removing it changes nothing. So this makes them
  // disagree — a sidecar claiming more records than the blocks hold, which is
  // what a service killed mid-write leaves behind — and asks for a refusal.
  async aShortCopyIsRefusedAndTheRecordsAreLeftExactlyAsTheyWere() {
    const id = `s3-test-${Date.now().toString(36)}-vfy`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const mk = (si, rule) => ({
      si, label: `${rule} 75% always d0.25x t17h · argmax auto 24/7`,
      decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
      entry: 'breakout', gate: 'always', dMult: 0.25, tHours: 17, trailMult: null, armMult: null,
      agreeRule: rule, agreeBar: 'all', agreePct: 75, agreeBoth: false, agreePersist: 0,
      members: 6, pnl: 10, trades: 3, holdout: { pnl: 30, trades: 4, stops: 1, vsAlwaysLong: 2 },
      beat: 3, pairs: 9, lead: 1.5, u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
    });
    const made = [mk(0, 'voices'), mk(1, 'count')];
    const doc = {
      id, stage: 3, seq: 999975, name: 'S3 #vfy', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 1, settings: 2, settingLabels: made.map((r) => r.label) },
      params: { nullN: 9 }, recordsVersion: 2,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      for (const r of made) w.push(r);
      await w.close();

      const before = fs.readFileSync(rowstore.storeFile(id, 'records'));
      // a sidecar that claims a record the blocks do not hold
      const meta = `${rowstore.storeFile(id, 'records')}.meta.json`;
      const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
      m.rows += 1;
      fs.writeFileSync(meta, JSON.stringify(m));

      let threw = null;
      try { await stages.renameSettingsToV3(stages.getSet(id)); } catch (err) { threw = err.message; }
      assert.ok(threw && /nothing was replaced/.test(threw),
        `a copy holding fewer records than the set was swapped in anyway: ${threw}`);
      assert.ok(before.equals(fs.readFileSync(rowstore.storeFile(id, 'records'))),
        'the records were replaced despite the copy being short — this is hours of compute that cannot be got back');
      assert.strictEqual(stages.getSet(id).recordsVersion, 2,
        'the set was marked as moved even though it was not');
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
      try { rowstore.remove(id); } catch (_) { /* fixture */ }
    }
  },

  // Pricing the missing settings BEFORE renaming prices every behind-named
  // setting a second time under its new name. The screen says so; this is the
  // guard that actually holds, because the screen is not the only way in.
  async theMissingSettingsCannotBePricedWhileTheNamesAreBehind() {
    const id = `s3-test-${Date.now().toString(36)}-ord`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const doc = {
      id, stage: 3, seq: 999976, name: 'S3 #ord', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 1, settings: 2, settingLabels: ['voices 75% always d1x t17h · argmax auto 24/7', 'count 75% always d1x t17h · argmax auto 24/7'] },
      params: { nullN: 9 }, recordsVersion: 2,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      let threw = null;
      try { await stages.appendMissingSettings(stages.getSet(id)); } catch (err) { threw = err.message; }
      assert.ok(threw && /named in the older way/.test(threw),
        `pricing was allowed while a name was behind, so those settings would be priced twice: ${threw}`);
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
    }
  },

  // The cheap count on the screen and the rename itself must agree about which
  // names are behind — one reads the set's list of names, the other rebuilds
  // each name from its record's own fields, and they are two different reads.
  async theCountOnTheScreenAgreesWithWhatTheRenameWouldActuallyDo() {
    const agreement = require('../lib/agreement');
    for (const rule of agreement.AGREE_RULES) {
      for (const bar of agreement.AGREE_BARS) {
        for (const persist of [0, 2]) {
          const r = {
            entry: 'breakout', gate: 'always', dMult: 1, tHours: 17, trailMult: null, armMult: null,
            agreeRule: rule, agreeBar: bar, agreePct: 75, agreeBoth: false, agreePersist: persist,
          };
          // the name as it was written before the share went into it
          const today = stages.renamedLabelOf({ ...r, label: 'x · argmax auto 24/7' });
          const head = String(today).split(' · ')[0];
          const older = head.replace(/ \+voice\d+/, '');
          assert.strictEqual(stages.BEHIND_V3(older), rule === 'voices',
            `the screen and the rename disagree about "${older}"`);
          assert.strictEqual(stages.BEHIND_V3(head), false,
            `a name written today already reads as behind: "${head}"`);
        }
      }
    }
  },

  // A SET THIS SIZE IS THE NORMAL CASE, AND IT KILLED THE BUTTON (2026-08-30).
  //
  // The next free setting number was worked out with `Math.max(-1, ...list)`.
  // A spread hands every entry to the function as an argument of its own, and
  // engines cap arguments somewhere around 65,000. The owner pressed `fill in
  // the missing settings` on a set holding 329,280 of them and it threw
  // "Maximum call stack size exceeded" before a single row was priced — 0 of 10
  // units, nothing on disk touched, and the only trace was a status line they
  // had no reason to be looking at.
  //
  // 400,000 on purpose: comfortably past any engine's cap, so this fails on the
  // spread and cannot be argued down to a smaller number that happens to fit.
  async theNextFreeSettingNumberSurvivesASetThisLarge() {
    const stages = require('../lib/stages');
    const ranked = [];
    for (let i = 0; i < 400000; i++) ranked.push({ si: i });
    let got;
    try {
      got = stages.nextSettingNumber(ranked);
    } catch (err) {
      assert.fail('the next free setting number cannot be worked out for a set of 400,000 settings — '
        + `it is being spread into a call rather than looped over: ${err.message}`);
    }
    assert.strictEqual(got, 400000, 'and it does not come out one past the highest');
    assert.strictEqual(stages.nextSettingNumber([]), 0, 'an empty set does not start at zero');
    assert.strictEqual(stages.nextSettingNumber([{ si: 7 }, { si: 2 }]), 8, 'it is not reading the highest');
  },

  // A HUNDRED AND SEVENTY THOUSAND MILLION STRING COMPARISONS IS NOT SLOW, IT
  // IS STOPPED (2026-08-30). The same question — which settings the block
  // declares and the records do not hold — was answered in two places, and the
  // two did not agree on how. The line that COUNTS them for the screen used a
  // set. The pass that PRICES them asked an array of 329,280 names whether it
  // contained each of 524,832 labels, one at a time.
  //
  // Nothing on screen would have said so: the button would have been pressed,
  // and the night would have passed with no rows written and no error shown.
  //
  // No stopwatch here. The array itself refuses to be asked, so a lookup done
  // the wrong way fails instantly and for certain rather than by being slow on
  // one machine and fast enough on another.
  async theMissingSettingsAreNeverFoundByAskingAListOncePerSetting() {
    const stages = require('../lib/stages');
    const held = ['one', 'two'];
    held.includes = () => { throw new Error('asked the held list once per setting'); };
    const settings = [{ label: 'one' }, { label: 'three' }, { label: 'two' }, { label: 'four' }];
    let missing;
    try {
      missing = stages.missingSettingsIn(held, settings);
    } catch (err) {
      assert.fail('the missing settings are found by asking the list of held names once per declared '
        + 'setting. On the owner\'s set that is 524,832 questions of a 329,280-long list — it does not '
        + `finish. Build a set of the held names once instead: ${err.message}`);
    }
    assert.deepStrictEqual(missing.map((x) => x.label), ['three', 'four'],
      'and it does not come back with the settings that are actually missing');
  },

  // ONE definition, or the two answers drift again — which is exactly what
  // happened: one of them was right the whole time.
  async theScreensCountAndThePricingPassAskTheSameQuestion() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    const defs = (src.match(/function missingSettingsIn\(/g) || []).length;
    const calls = (src.match(/[^n] missingSettingsIn\(held, settings\)/g) || []).length;
    assert.strictEqual(defs, 1, `the missing settings are defined ${defs} times, not once`);
    assert.strictEqual(calls, 2,
      `the count on the screen and the pass that prices them do not both read the one definition `
      + `(${calls} of 2)`);
    // COMMENTS STRIPPED FIRST. Both lines below forbid a string, and the code
    // that replaced them QUOTES that string in its own comment explaining what
    // it replaced — so a guard reading the raw file fires on the fix itself.
    const code = src.replace(/\/\/[^\n]*/g, '');
    assert.ok(!/settings\.filter\(\(st\) => !held\.includes/.test(code),
      'the pricing pass still works the missing settings out for itself');
    assert.ok(!/Math\.max\(-1, \.\.\./.test(code),
      'the next free setting number is spread into a call again');
  },

  async aBlockPricedBeforeItWasWholeIsFilledInFromItsOwnEnumerator() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    const fn = src.slice(src.indexOf('async function appendMissingSettings('), src.indexOf('const AGREED_V ='));
    assert.ok(fn.length > 400, 'the pass that fills a block in is gone');
    assert.ok(/relaunchShapeOf\(doc\)/.test(fn),
      'what is missing is not read through the launch\'s own enumerator, so it can differ from what a launch would price');
    // RE-AIMED 2026-08-30. This pinned the SPELLING of the subtraction rather
    // than the fact of it — and the spelling it pinned asked an array of
    // 329,280 held names whether it contained each of 524,832 declared labels,
    // one at a time. So the guard was holding the fault in place: the fix it
    // needed was the one thing it forbade. What matters is that the pass reads
    // the SAME definition the screen's count reads, however that is written.
    assert.ok(/const missing = missingSettingsIn\(held, settings\);/.test(fn),
      'missing is not "declared minus what is on disk" read through the one shared definition, so a '
      + 'setting could be priced twice — or the subtraction worked out a second way, which is exactly '
      + 'how the two copies came to disagree');
    // NOTHING ALREADY PRICED IS RENUMBERED. Records are filed under their
    // setting's number and the tables group by it; a reused number silently
    // merges two settings into one row.
    assert.ok(/si: nextSi \+ row\.si,/.test(fn), 'new settings do not take numbers after everything on disk');
    assert.ok(/if \(nextSi !== held\.length\)/.test(fn),
      'nothing checks that the names on the set and the numbers in its records agree before adding to them');
    // both gates, before a row is priced
    assert.ok(/tallyBudgetFor\(\{ settings: held\.length \+ missing\.length/.test(fn),
      'the memory gate is not asked about what the set WOULD hold, so filling in could make its tables unbuildable');
    assert.ok(/storeBudgetFor\(/.test(fn), 'the disk gate is not asked at all');
    assert.ok(/const busy = stageBusy\(\);/.test(fn), 'it can start on top of another heavy job');
    // one payload builder, so what is appended is priced exactly as the first rows were
    assert.ok(/s3Payload\(\{ doc, parent, rec, settings: missing, fee, nullN \}\)/.test(fn),
      'the append builds its own payload, so it can drift from what the launch hands the workers');
    assert.strictEqual((src.match(/function s3Payload\(/g) || []).length, 1, 'there is more than one payload builder');
    // derived files go; the set owns up to having been added to
    assert.ok(/rmSync\(tallyFile\(id\)/.test(fn) && /rmSync\(agreedFile\(id\)/.test(fn),
      'the totals and the answers survive an append, so they describe fewer settings than the set holds');
    assert.ok(/doc\.appends = \[\.\.\.\(doc\.appends \|\| \[\]\), \{/.test(fn) && /engineVersion: ENGINE_VERSION/.test(fn),
      'a set that was added to does not record it, so nothing says it is no longer one run under one engine');
    // ...and the screen offers it, from the same numbers
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(/function bFillInLine\(doc, gap, filling\)/.test(ui), 'nothing on Boards says a block is short of its own plan');
    assert.ok(/data-bfillin="\$\{esc\(doc\.id\)\}"/.test(ui), 'there is no control to fill it in');
    assert.ok(/gap\.gate && gap\.gate\.band === 'refuse'/.test(ui),
      'the button is offered even when the finished tables could not fit, so it would run and then refuse');
    assert.ok(/api\/stageset\/\$\{doc\.id\}\/missing/.test(ui), 'the screen works the gap out for itself instead of asking the engine');
  },

  // THE ONE-VOICE THRESHOLD IS A DIAL, NOT A NUMBER IN THE CODE (owner order,
  // 2026-08-30). It was a default argument nobody ever passed, so a single
  // hidden number decided whether the voices way of weighing could ever fold
  // anything — at 98 two members agreeing nineteen times in twenty are still
  // two voices, and voices was count wearing another name.
  async theOneVoiceThresholdIsADialAndOnlyVoicesPaysForIt() {
    const a = require('../lib/agreement');
    assert.ok(Array.isArray(a.COPY_PCTS) && a.COPY_PCTS.length >= 4, 'there is no menu of thresholds');
    assert.ok(a.COPY_PCTS.includes(a.COPY_DEFAULT), 'the default is not one of the choices, so it cannot be got back to');
    // it changes who the voices are, which is the whole point
    const nearly = [[1, 1, 1, 1, 1], [1, 1, 1, 1, -1]];
    assert.strictEqual(a.voiceGroups(nearly, 5, 0.98).voices, 2);
    assert.strictEqual(a.voiceGroups(nearly, 5, 0.80).voices, 1, 'moving it must change the committee');

    // ONLY voices IS MULTIPLIED BY IT. The other three cannot read it, and
    // paying for identical settings under different names is the fault the
    // share dedup already exists to stop.
    const cell = { entry: 'market', tHours: 89 };
    const swept = stages.settingsFor({ cell, agreeRule: 'voices', agreePct: 75, agreePermuteCopy: true }, [1]);
    assert.strictEqual(swept.length, a.COPY_PCTS.length, 'sweeping it does not reach the voices settings');
    assert.deepStrictEqual(swept.map((x) => x.agreeCopy), a.COPY_PCTS);
    for (const rule of ['count', 'conviction', 'families']) {
      const one = stages.settingsFor({ cell, agreeRule: rule, agreePct: 75, agreePermuteCopy: true }, [1]);
      assert.strictEqual(one.length, 1, `${rule} cannot read the threshold and must not be priced once per value of it`);
    }
    // ...and it is in the name, so two voices settings are never one heading
    assert.deepStrictEqual([...new Set(swept.map((x) => x.label.split(' · ')[0]))].length, a.COPY_PCTS.length,
      'two voices settings on different thresholds share a name');
    assert.ok(/^voices 75% \+voice80 /.test(swept[0].label), `the name does not carry it: ${swept[0].label}`);
    // the same-trade fold keeps them apart, and does NOT keep apart settings
    // that merely carry a threshold no rule of theirs reads
    const kept = stages.foldSameTradeSettings(swept, [{ trade: 'AAA', bandPct: 2 }]).kept;
    assert.strictEqual(kept.length, a.COPY_PCTS.length, 'the fold drops thresholds that price different trades');

    // and the dial is on the screen, fed by the engine
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(/vocabOptions\('agreeCopy', '98'\)/.test(ui), 'the threshold is not a control fed from the engine');
    assert.ok(/agreeCopy: Number\(\$\('#swAgreeCopy'\)\.value\)/.test(ui), 'the control is drawn but never sent');
    assert.ok(/agreePermuteCopy: \$\('#swPermAgreeCopy'\)\.checked/.test(ui), 'it cannot be swept');
    const vocab = require('../lib/vocabulary');
    const served = (typeof vocab.vocabulary === 'function' ? vocab.vocabulary() : vocab).agreeCopy;
    assert.strictEqual(served.length, a.COPY_PCTS.length, 'the engine does not serve every threshold it can run');
    // nothing anywhere still hides it
    const ag = fs.readFileSync(path.join(ROOT, 'lib', 'agreement.js'), 'utf8');
    assert.ok(!/threshold = 0\.98/.test(ag), 'the threshold is a bare number in the code again');
  },

  // AND IT IS ON THE SCREEN — all three tables, with its floors.
  async whatActuallyAgreedIsOnEveryStageThreeTable() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    // the COLUMN HEADINGS only: the name also appears in the line that owns up
    // to an empty column, and counting that as a fourth table would be wrong
    assert.strictEqual((ui.match(/>share that agreed(?:\$\{|<)/g) || []).length, 3,
      'the column must head the ranked table, the every-coin table AND the records under a coin row');
    assert.ok(/bRankSortBtn\(doc, 'avgAgreed', 'desc'\)/.test(ui), 'the ranked column does not sort');
    assert.ok(/bCoinSortBtn\(view, 'agreed', '↓'\)/.test(ui), 'the every-coin column does not sort');
    assert.ok(/'agreedMin', 'share that agreed at least, %'/.test(ui), 'the ranked table has no floor on what actually agreed');
    // THE DIAL COLUMN AND ITS TWO FLOORS ARE GONE (owner order, 2026-08-29:
    // "obviously i don't need/want a column in table 1 ... that reads share
    // 75% LITERALLY 329,280 times"). One share was picked, so the column
    // printed it on every row and the two floors either kept everything or
    // nothing.
    assert.ok(!/'shareMin', 'share at least, %'/.test(ui) && !/'shareMax', 'share at most, %'/.test(ui),
      'the two floors on the share that was ASKED FOR are still there, and on a run built on one share they do nothing');
    assert.ok(!/bRankSortBtn\(doc, 'agreePct'/.test(ui),
      'the ranked table still carries the column of the share that was asked for, repeated once per row');
    assert.ok(/'minAgreed', 'share that agreed at least, %'/.test(ui), 'the every-coin table has no floor on it');
    assert.ok(/minAgreed: coinF\.minAgreed/.test(ui), 'the every-coin floor is drawn but never sent, so it does nothing');
    // the record line says the spread, not just the average — an average of
    // one number and an average of forty read the same without it
    assert.ok(/r\.agreedLow\.toFixed\(1\)/.test(ui) && /r\.agreedHigh\.toFixed\(1\)/.test(ui) && /r\.agreedN/.test(ui),
      'a record shows its average agreement with no idea of its range or how many calls it rests on');
    // every header still has a cell under it
    const rk = ui.indexOf("rr.map((r, i) => `<tr>");
    const rHead = ui.slice(ui.lastIndexOf('<thead>', rk), ui.indexOf('</thead>', ui.lastIndexOf('<thead>', rk)));
    const rBody = ui.slice(rk, ui.indexOf('<tr><td colspan', rk));
    const ck = ui.indexOf('<tbody id="bCoinBody">');
    const cHead = ui.slice(ui.lastIndexOf('<thead>', ck), ui.indexOf('</thead>', ui.lastIndexOf('<thead>', ck)));
    const cBody = ui.slice(ck, ui.indexOf('<tr><td colspan', ck));
    const n = (x, t) => (x.match(new RegExp(`<${t}[ >]`, 'g')) || []).length;
    assert.strictEqual(n(rHead, 'th'), n(rBody, 'td'), 'the ranked table has a different number of headings and cells');
    assert.strictEqual(n(cHead, 'th'), n(cBody, 'td'), 'the every-coin table has a different number of headings and cells');
    // THE SPAN IS COUNTED, NOT TYPED. It was typed, and went stale the moment a
    // column was added — twice. The line has to reach across whatever the
    // table currently holds.
    for (const [name, at] of [['Table 3.A', rk], ['Table 3.B', ck]]) {
      const head = ui.lastIndexOf('<thead>', at);
      const cols = n(ui.slice(head, ui.indexOf('</thead>', head)), 'th');
      const span = /colspan="(\d+)"/.exec(ui.slice(at, ui.indexOf('</tbody>', at)));
      assert.ok(span, `${name} has no "nothing here" line at all`);
      assert.strictEqual(Number(span[1]), cols,
        `${name}'s "nothing here" line spans ${span[1]} of its ${cols} columns`);
    }
  },

  // AND THE PAGE ACTUALLY SHOWS THEM, headed, in the order they were asked
  // for, on BOTH stage 3 tables.
  async everyFilterOnTheStageThreeTablesShowsWhatItsColumnHolds() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(/\], ranked && ranked\.spread\)\}/.test(ui), 'the ranked table does not ask for the four numbers');
    assert.ok(/\], coins && coins\.spread\)\}/.test(ui), 'the every-coin table does not ask for the four numbers');

    const grid = ui.slice(ui.indexOf('function bStat('), ui.indexOf('function bWireFilters('));
    for (const w of ['minimum', 'median', 'average', 'maximum']) {
      assert.ok(grid.includes(`<span class="fhead">${w}</span>`), `the "${w}" column has no heading on the grid`);
    }
    assert.ok(grid.indexOf('>minimum<') < grid.indexOf('>median<')
      && grid.indexOf('>median<') < grid.indexOf('>average<')
      && grid.indexOf('>average<') < grid.indexOf('>maximum<'),
    'the four headings are not in the order they were asked for');
    assert.ok(/bStat\(st\.min\)[\s\S]{0,240}bStat\(st\.median\)[\s\S]{0,240}bStat\(st\.avg\)[\s\S]{0,240}bStat\(st\.max\)/.test(grid),
      'the numbers are not printed in the order their headings promise, so every column is mislabelled');
    assert.ok(/st \? bStat\(st\.min\) : ''/.test(grid),
      'a box with no numbers drops its cells instead of leaving them empty, and every row after it shifts a column left');

    // the printing itself: a whole number keeps its thousands marks and gains
    // no decimal point, money gets two places, and a value below one gets
    // three — 0.043 and 0.004 are not the same lead and two places says so.
    // eslint-disable-next-line no-new-func
    const bStat = new Function(`${ui.slice(ui.indexOf('function bStat('), ui.indexOf('// FOUR NUMBERS BESIDE EVERY FILTER BOX'))}; return bStat;`)();
    assert.strictEqual(bStat(null), '—', 'an absent number must read as absent, not as nothing at all');
    assert.strictEqual(bStat(1234567), '1,234,567');
    assert.strictEqual(bStat(12.5), '12.50');
    assert.strictEqual(bStat(0.0432), '0.043');

    const css = fs.readFileSync(path.join(ROOT, 'public', 'construct.html'), 'utf8');
    assert.ok(/\.filters\.withspread \{[^}]*repeat\(4, max-content\)/.test(css),
      'the four number columns have no grid track, so they wrap underneath the filter boxes');
    assert.ok(/\.filters \.fstat \{[^}]*text-align:right/.test(css), 'the numbers do not line up down their own column');
    assert.ok(/\.filters \.fstat \{[^}]*tabular-nums/.test(css),
      'the numbers are not set in even-width figures, so the digits do not line up between rows');
  },

  // TYPING THE PAGE NUMBER (owner order, 2026-08-29: "on the page selectors on
  // the tables we need to be able to give the exact page number to view").
  // prev and next walk; on a table 4,116 pages long walking is not a way of
  // getting anywhere.
  async everyPageOfATableCanBeReachedByTypingItsNumber() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const pager = ui.slice(ui.indexOf('function bPager('), ui.indexOf('function bSortBtn('));
    assert.ok(/data-bpageto="\$\{key\}"/.test(pager), 'the page selector has no box to type a page into');
    assert.ok(/value="\$\{page\}"/.test(pager), 'the box does not show the page you are on, so it cannot say where you are');
    assert.ok(/data-bpages="\$\{pages\}"/.test(pager) && /data-bper="\$\{n\}"/.test(pager),
      'the box does not carry how many pages there are or how big one is, so nothing can work out where to go');
    assert.ok(/title="the page showing/.test(pager), 'the box carries no hover saying what it is');
    assert.ok(/prev<\/button>/.test(pager) && /next<\/button>/.test(pager),
      'typing a page must be added BESIDE prev and next, not instead of them');

    const wire = ui.slice(ui.indexOf('function bWirePager('), ui.indexOf('function bCoinSortBtn('));
    assert.ok(/Math\.min\(pages, Math\.max\(1, want\)\)/.test(wire),
      'a page number outside the table is not pulled back to a real page');
    assert.ok(/\(page - 1\) \* per/.test(wire), 'the page number is not turned into the row it starts at');
    assert.ok(/el\.onchange = jump;/.test(wire) && /el\.onblur = jump;/.test(wire),
      'a page typed and then clicked away from is dropped');
    assert.ok(/if \(jumped\) return;/.test(wire),
      'change and blur both fire, so without a guard one typed page turns the table twice');
    // the same box on every table that pages, not just the one that was asked about
    assert.strictEqual((ui.match(/\$\{bPager\(/g) || []).length >= 4, true,
      'not every table draws its page selector through bPager, so they cannot all have gained the box');
  },

};
