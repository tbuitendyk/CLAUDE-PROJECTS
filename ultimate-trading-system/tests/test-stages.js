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
      assert.ok(/^(count|conviction|voices|families|unusual) \d+%/.test(x.label), `name must open with the rule and its share: ${x.label}`);
    }
    // ONE dial, every committee size: the same share is a legal setting for a
    // run of coins on their own and for a run read alongside others
    const singles = stages.settingsFor({ cell: { entry: 'market', tHours: 89 }, agreeRule: 'count', agreePct: 50 }, [1]);
    const mixed = stages.settingsFor({ cell: { entry: 'market', tHours: 89 }, agreeRule: 'count', agreePct: 50 }, [1, 3]);
    assert.strictEqual(singles.length, 1);
    assert.strictEqual(mixed.length, 1);
    assert.strictEqual(singles[0].label, mixed[0].label, 'one share, one name, whatever the committee holds');
    // every rule reaches the block, and each is named on the setting
    const rules = new Set(stages.settingsFor({ cell: { entry: 'market', tHours: 89 }, agreePermuteRule: true }, [1]).map((x) => x.agreeRule));
    assert.deepStrictEqual([...rules].sort(), ['conviction', 'count', 'families', 'unusual', 'voices']);
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
      fs.writeFileSync(tf, zlib.gzipSync(JSON.stringify({ v: 1, builtAt: 'x', rows: 0, ranked: [], coins: [] })));
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
      fs.writeFileSync(tf, zlib.gzipSync(JSON.stringify({ v: 2, builtAt: 'xx', rows: 0, ranked: [], coins: [] })));
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
      for (const shared of ['campaignNoteHtml(', 'descriptionPanelHtml(', 'notesPanelHtml(', 'runIdentityPanelHtml(', 'wireNotesSave(']) {
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
      for (const id of ['bNotes', 'bNotesSave']) {
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
      const block = src.slice(at, src.indexOf('])}', at));
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

};
