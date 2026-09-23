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

// A finished stage 2 parent with one record and a price-file record that
// matches this box, so a stage 3 launch gets past every gate. The coin has no
// price files, so the run behind the launch ends incomplete, quickly.
// WITH AN OPTIONAL STAGE 1 ABOVE IT (3.186.0), because where a chain took its
// units from is written on the stage 1 alone and every reader of it walks up.
// Left out, the stage 2 has no parent at all -- which is a chain that took its
// units from the boxes, and reads as `none`.
function writeLaunchParent(tag, source = null) {
  const { stampManifest } = require('../lib/manifest');
  const pid = `s2-test-${Date.now().toString(36)}-${tag}`;
  const universe = ['ZZZTESTUSDT'];
  fs.mkdirSync(SETS_DIR, { recursive: true });
  let root = null;
  if (source) {
    root = `s1-test-${Date.now().toString(36)}-${tag}`;
    fs.writeFileSync(path.join(SETS_DIR, `${root}.json`), JSON.stringify({
      id: root, stage: 1, seq: 999983, name: `S1 #${tag}`, status: 'done', createdAt: new Date().toISOString(),
      params: { universe, coinsSource: source, nullN: 3 }, plan: { units: 1 },
    }));
  }
  fs.writeFileSync(path.join(SETS_DIR, `${pid}.json`), JSON.stringify({
    id: pid, stage: 2, seq: 999984, name: `S2 #${tag}`, status: 'done', createdAt: new Date().toISOString(),
    engineVersion: require('../package.json').version, measurements: require('../lib/features').MEASUREMENTS_VERSION,
    parent: root ? { id: root, name: `S1 #${tag}` } : undefined,
    params: { universe, allLoaded: true, windowLayout: 'reserve61', startMonth: '2024-01', endMonth: '2024-03', nullN: 3 },
    dataManifest: stampManifest(pid, universe), plan: { units: 1 },
  }));
  const rec = rowstore.writer(pid, 'records');
  rec.push({ u: 0, carriedRank: 1, s1rank: 1, trade: 'ZZZTESTUSDT', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', bandPct: 2,
    specs: [], score3: 1, scoreAll: 1, helped: 0, beat: 0, pairs: 3, lead: 0, blocks: {} });
  rec.close();
  return pid;
}
const LAUNCH_BLOCK = {
  fee: 0.00125, nullN: 3, keepN: 0, carry: 0, pick: 'count',
  cell: { entry: 'market', tHours: 65 }, decision: 'argmax', band: 3,
  agreeRule: 'count', agreeBar: 'all', agreePct: 50, agreeCopy: 98,
};
// UNTIL THE RUN IS OVER, which is not when the set stops saying `running`. A
// stage 3 run writes `done` or `incomplete` on its set, THEN writes its tally
// file through awaited stream writes, and only after that clears the busy
// marker every launch refuses on. A wait that read the status alone came back
// inside that tail -- under load, 29 times in 40 -- so the next launch was
// refused as "going right now", and the fixture's `finally` deleted a set the
// run then saved again, which is where the stray incomplete sets in
// data/stagesets came from. So this waits on the readout the launch reads,
// stageRunning(), until it no longer names the set.
async function untilEnded(id, ms = 30000) {
  const t0 = Date.now();
  const going = () => stages.getSet(id).status === 'running' || stages.stageRunning() === id;
  while (going() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50));
  // a landed stage 3 set totals its tables in the background, and the next
  // launch refuses while that goes — wait for it, so a test reads the
  // refusal it is asking about and not the one heavy job at a time
  const tally = stages.tallyRunPromise();
  if (tally) await tally.catch(() => {});
  return stages.getSet(id);
}
// the parent, the stage 1 above it when there is one, every set that names it
// as parent (a launch that threw after starting its run leaves one this test
// never learned the id of), and the price-file records of each
// ONE FIXTURE SET AND EVERYTHING IT WROTE. A leftover set in data/stagesets is
// how phantom failures get into other files, so a test that writes one takes it
// away in a finally, whichever way it ends.
function rmSet(id) {
  try { fs.rmSync(path.join(SETS_DIR, `${id}.json`), { force: true }); } catch (_) { /* fixture */ }
  try { fs.rmSync(path.join(SETS_DIR, `${id}-tally.json.gz`), { force: true }); } catch (_) { /* fixture */ }
  try { fs.rmSync(path.join(SETS_DIR, `${id}-agreed.json.gz`), { force: true }); } catch (_) { /* fixture */ }
  try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
}
function cleanLaunchParent(pid) {
  try {
    const up = JSON.parse(fs.readFileSync(path.join(SETS_DIR, `${pid}.json`), 'utf8'));
    if (up && up.parent && up.parent.id) { try { fs.unlinkSync(path.join(SETS_DIR, `${up.parent.id}.json`)); } catch (_) { /* gone */ } }
  } catch (_) { /* the parent is already gone */ }
  const { MANIFEST_DIR } = require('../lib/manifest');
  const kids = stages.listSets().filter((x) => ((x.parent || {}).id === pid || (x.params || {}).from === pid)).map((x) => x.id);
  for (const id of [pid, ...kids]) {
    try { fs.rmSync(path.join(SETS_DIR, `${id}.json`), { force: true }); } catch (_) { /* fixture */ }
    try { fs.rmSync(path.join(SETS_DIR, `${id}-tally.json.gz`), { force: true }); } catch (_) { /* fixture */ }
    try { fs.rmSync(path.join(SETS_DIR, `${id}-agreed.json.gz`), { force: true }); } catch (_) { /* fixture */ }
    try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
    try { fs.rmSync(path.join(MANIFEST_DIR, `${id}.json`), { force: true }); } catch (_) { /* fixture */ }
  }
}

// WHAT A BLANK COIN BOX MEANS IS READ OFF THE CACHE (3.122.0), so a test about
// blank has to say what is downloaded rather than depend on what happens to be
// on the machine it runs on. It stands in for the cache the way the Coins tests
// stand in for the price loader, and puts it back afterwards.
function withDownloaded(list, fn) {
  const dataset = require('../lib/dataset');
  const was = dataset.defaultCoins;
  dataset.defaultCoins = () => list.slice();
  try { return fn(); } finally { dataset.defaultCoins = was; }
}

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
    // both lists named: this test is about the combo arithmetic, and a blank
    // compare list means every coin downloaded now (3.75.0, 3.122.0), which is a
    // different question and is held in its own test below
    assert.strictEqual(stages.unitsFor(u3, { singles: true }, geos, u3).length, 6);
    assert.strictEqual(stages.unitsFor(u3, { doubles: true }, geos, u3).length, 12);
    assert.strictEqual(stages.unitsFor(u3, { triples: true }, geos, u3).length, 6);
    assert.strictEqual(stages.unitsFor(u3, { singles: true, doubles: true, triples: true }, geos, u3).length, 24);
  },

  // The settings block is the sweep's own expandDeclared times the decision,
  // band and 24/5 variants — counted by hand for known ticks.
  async theSettingsBlockCountsByHand() {
    const base = { entry: 'breakout', gate: 'directional', dMult: 1.5, tHours: 65 };
    assert.strictEqual(stages.settingsFor({ cell: base }).length, 1, 'no permute → one setting');
    // nine holding times: the seven-rung 17h+24k ladder, the 60h a weekly 8-day
    // chunk is held for, and the chunk's own -- which is not a number of hours
    // at all but each unit's own hold length, resolved when it is priced
    assert.strictEqual(stages.settingsFor({ cell: base, cellPermute: { tHours: true } }).length, 9, 'eight holding times and the chunk\'s own');
    assert.strictEqual(stages.settingsFor({ cell: base, permuteDecision: true, permuteBand: true, permuteWeekdays: true }).length,
      2 * 4 * 2, 'decision × band menu × 24/5');
    // the TRADE SHAPE block, on its own: breakout gates(2) × d(5) × t(9) ×
    // (static + 4 trails × 3 arms)(13) + market t(9) = 1,179 shapes. The
    // agreement is no longer multiplied in here — it is its own dimension
    // (owner loop, 2026-08-28), which is what stopped a run declaring 8x the
    // settings it could ever tell apart.
    const shapes = stages.settingsFor({
      cell: base,
      cellPermute: { entry: true, gate: true, dMult: true, tHours: true, trail: true, arm: true },
    });
    assert.strictEqual(shapes.length, 1179, 'the shape block must count exactly what the sweep\'s enumerator declares');
    const labels = new Set(shapes.map((x) => x.label));
    assert.strictEqual(labels.size, shapes.length, 'every setting carries a distinct name');
    // and an 'agree' permute on the shape side is IGNORED, never multiplied:
    // the old enumerator crossed both committee bars here, 48 to a cell
    const withAgree = stages.settingsFor({
      cell: { ...base, quorumSingles: 2, quorumContexts: 3 },
      cellPermute: { entry: true, gate: true, dMult: true, tHours: true, trail: true, arm: true, agree: true },
    });
    assert.strictEqual(withAgree.length, 1179, 'the old agree permute must not reach the shape enumerator');
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
      // trained reads no bar and no share, so it carries neither in its name;
      // every other way of weighing opens with its rule and its share
      assert.ok(/^(count|conviction|voices|families) \d+%/.test(x.label) || /^(trained|field)\b/.test(x.label),
        `name must open with the rule and its share: ${x.label}`);
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
    assert.deepStrictEqual([...rules].sort(), ['conviction', 'count', 'families', 'trained', 'voices'],
      'unusual was never a way of weighing — it is count against the own history bar, and the bar is its own dial now');
    // THE FIELD ALONE IS A CHOICE ONLY WHERE A FIELD IS NAMED (3.221.0): a
    // permute on a run naming none leaves it out (above), a run naming one
    // gets it, and asking for it by name with no field is refused in words
    const named = new Set(stages.settingsFor({ cell: { entry: 'market', tHours: 89 }, agreePermuteRule: true, fieldId: 'f-x', fieldAgreeMin: '40', fieldRungs: '100:1' }, [1]).map((x) => x.agreeRule));
    assert.deepStrictEqual([...named].sort(), ['conviction', 'count', 'families', 'field', 'trained', 'voices'],
      'with a field named, quorum by field is among the permuted choices');
    assert.throws(() => stages.settingsFor({ cell: { entry: 'market', tHours: 89 }, agreeRule: 'field' }, [1]),
      /quorum by field reads the field alone — name a field under The field, or pick another quorum by/,
      'field by name with no field must be refused, never priced as a rule that calls nothing');
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

  // THE PLATEAU SHARE IS A DIAL ONLY WHERE A PLATEAU IS (3.205.0): it multiplies
  // the block on a run whose units carry one, is stored as nothing on a run
  // with none, rides every setting's name and record, folds on a unit without
  // a plateau, and is refused by name when off the list.
  // TWO PLATEAU SHARES THAT NEED THE SAME MEMBERS ARE ONE SETTING (3.210.0,
  // owner order: "code the fix for the duplicate plateau share folds", after a
  // run declared 120 settings where ten quorum rungs met twelve plateau shares
  // and three of the twelve could only ever repeat a neighbour). The fold reads
  // what a share RESOLVES TO on every plateau of every shape -- the speaking
  // members per kind, off the records' own specs -- the way the quorum share
  // is folded by rung, and keeps the first share of each group.
  twoPlateauSharesThatNeedTheSameMembersAreOneSetting() {
    const offered = require('../lib/vocabulary').vocabulary().plateauShare.map((o) => Number(o.value));
    assert.deepStrictEqual(offered, [10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100], 'the fixture below is written for this list');
    const nine = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const six = [0, 1, 2, 3, 4, 5];
    const specsFor = (members, silent = []) => ['logreg', 'boost'].flatMap((model) => members.map((at) => ({ model, at, ...(silent.includes(`${model}${at}`) ? { silent: 'thin' } : {}) })));
    const rec = (members, silent = []) => ({ size: 1, extras: members.map(() => ({})), plateaus: [{ centre: members[0], members }], specs: specsFor(members, silent) });
    const nines = stages.shapesOf([rec(nine)]);
    const sixes = stages.shapesOf([rec(six)]);
    assert.deepStrictEqual(nines[0].plateauSizes, [[9, 9]], 'a plateau of nine speaks with nine of each kind');
    assert.deepStrictEqual(sixes[0].plateauSizes, [[6, 6]], 'a plateau at the grid\'s edge speaks with six');
    assert.deepStrictEqual(stages.foldPlateauShares(offered, nines), [10, 20, 25, 40, 50, 60, 70, 80, 90], 'nine members: 25/30, 70/75 and 90/100 each need the same members');
    assert.deepStrictEqual(stages.foldPlateauShares(offered, sixes), [10, 20, 40, 60, 70, 90], 'six members: 20/25/30, 40/50, 70/75/80 and 90/100 each need the same members');
    // a run holding both shapes keeps a share as soon as it differs on EITHER
    assert.deepStrictEqual(stages.foldPlateauShares(offered, stages.shapesOf([rec(nine), rec(six)])), [10, 20, 25, 40, 50, 60, 70, 80, 90],
      'on a mixed run a share is folded only when it needs the same members on every plateau');
    // a silent member is not counted, which is what the stage 3 fold speaks with:
    // one boost member silent makes boost a plateau of eight, and 25% and 30% part company
    const eightBoost = stages.shapesOf([rec(nine, ['boost4'])]);
    assert.deepStrictEqual(eightBoost[0].plateauSizes, [[9, 8]]);
    assert.deepStrictEqual(stages.foldPlateauShares(offered, eightBoost), [10, 20, 25, 30, 40, 50, 60, 70, 80, 90],
      '25% needs 3 of 9 and 2 of 8, 30% needs 3 of 9 and 3 of 8 -- different members, two settings');
    // a record with no specs is read as every member speaking
    assert.deepStrictEqual(stages.shapesOf([{ size: 1, extras: nine.map(() => ({})), plateaus: [{ centre: 4, members: nine }] }])[0].plateauSizes, [[9, 9]]);
    // the whole block folds the same way, and nothing folds where there is no plateau
    const B = { cell: { entry: 'market', tHours: 65 }, agreeRule: 'count', agreeBar: 'all', agreePct: 50, plateauPermutePct: true };
    assert.strictEqual(stages.agreementsFor(B, [1], sixes).length, 6);
    assert.deepStrictEqual(stages.agreementsFor(B, [1], stages.shapesOf([{ size: 1 }])).map((a) => a.plateau), [null]);
    // AND THE TWO ARITHMETICS ARE ONE: the fold at stage 3 needs
    // max(1, ceil(share * speaking)), which is rungFor for a share above 0 up to 100
    const cm = fs.readFileSync(path.join(ROOT, 'lib', 'committee.js'), 'utf8');
    assert.ok(cm.includes('const need = Math.max(1, Math.ceil((pct / 100) * sp.length));'), 'the stage 3 fold no longer needs what the block builder folds on');
    const sw = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(sw.includes('const rungFor = (pct, n) => Math.max(1, Math.min(n, Math.ceil((pct / 100) * n)));'), 'rungFor has moved away from the fold\'s arithmetic');
    for (const n of [1, 2, 3, 6, 8, 9]) for (const pct of offered) {
      assert.strictEqual(Math.max(1, Math.min(n, Math.ceil((pct / 100) * n))), Math.max(1, Math.ceil((pct / 100) * n)), `rungFor and the fold disagree at ${pct}% of ${n}`);
    }
  },
  thePlateauShareIsADialOnlyWhereAPlateauIs() {
    const cell = { entry: 'market', tHours: 65 };
    const B = { cell, agreeRule: 'count', agreeBar: 'all', agreePct: 50 };
    const nine = Array.from({ length: 9 }, () => ({}));
    const withPl = stages.shapesOf([{ size: 1, extras: nine, plateaus: [{ centre: 4, members: [0, 1, 2, 3, 4, 5, 6, 7, 8] }] }]);
    const without = stages.shapesOf([{ size: 1 }]);
    // stored as nothing where nothing reads it, the box's value where a plateau does
    assert.deepStrictEqual(stages.agreementsFor(B, [1], without).map((a) => a.plateau), [null], 'a run with no plateaus records a plateau share');
    assert.deepStrictEqual(stages.agreementsFor({ ...B, plateauPct: 75 }, [1], without).map((a) => a.plateau), [null]);
    assert.deepStrictEqual(stages.agreementsFor(B, [1], withPl).map((a) => a.plateau), [50], 'the box\'s own middle is not the default');
    assert.deepStrictEqual(stages.agreementsFor({ ...B, plateauPct: 75 }, [1], withPl).map((a) => a.plateau), [75]);
    // permute multiplies by the list the box offers, and only where a plateau is
    const offered = require('../lib/vocabulary').vocabulary().plateauShare.map((o) => Number(o.value));
    assert.ok(offered.length >= 10 && offered.includes(50) && offered.includes(100), 'the box offers no real list');
    // ...folded to the shares that need DIFFERENT members on a plateau of nine
    // (3.210.0): 25 and 30 both need 3, 70 and 75 both need 7, 90 and 100 both need 9
    assert.deepStrictEqual(stages.agreementsFor({ ...B, plateauPermutePct: true }, [1], withPl).map((a) => a.plateau), [10, 20, 25, 40, 50, 60, 70, 80, 90]);
    assert.deepStrictEqual(stages.agreementsFor({ ...B, plateauPermutePct: true }, [1], without).map((a) => a.plateau), [null], 'permute multiplies a run with nothing to permute');
    // refused by name when off the list
    assert.throws(() => stages.agreementsFor({ ...B, plateauPct: 33 }, [1], withPl), /33 is not a plateau share/);
    // the name and the record carry it, after the rule and its share
    const named = stages.settingsFor({ ...B, plateauPct: 75 }, [1], withPl);
    assert.strictEqual(named.length, 1);
    assert.strictEqual(named[0].plateauPct, 75);
    assert.ok(/^count 50% \+plateau75% /.test(named[0].label), `the name does not carry the plateau share: ${named[0].label}`);
    assert.ok(!/plateau/.test(stages.settingsFor(B, [1], without)[0].label), 'a run with no plateaus names one');
    assert.strictEqual(stages.settingsFor(B, [1], without)[0].plateauPct, null);
    // the trained way of weighing reads no bar and still carries the plateau share
    const tr = stages.settingsFor({ cell, agreeRule: 'trained', plateauPct: 60 }, [1], withPl);
    assert.ok(/^trained \+plateau60% /.test(tr[0].label), tr[0].label);
    // the committee is its voters: 8 base members and one plateau per kind
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(/const votersOf = \(q\) => membersForSize\(q\.size\) \+ 2 \* \(\(q\.nLoose \?\? q\.nExtras \?\? 0\) \+ \(q\.nPlateaus \|\| 0\)\);/.test(src), 'a plateau is still counted as its extras');
    // on a unit without a plateau every value folds into one setting
    const a = { decision: 'argmax', entry: 'market', gate: 'directional', tHours: 65, agreeRule: 'count', agreeBar: 'all', agreePct: 50, agreeCopy: 98, agreeBoth: false, agreePersist: 0, confirm: 'off', plateauPct: 50 };
    const b = { ...a, plateauPct: 75 };
    const key = (st, has) => src.includes('function foldKeyRest(') && require('../lib/stages').foldKeyRest
      ? require('../lib/stages').foldKeyRest(st, false, 'daily-4d', false, has) : null;
    if (key(a, false) != null) {
      assert.strictEqual(key(a, false), key(b, false), 'two plateau shares are two settings on a unit with no plateau');
      assert.notStrictEqual(key(a, true), key(b, true), 'two plateau shares are one setting on a unit with a plateau');
    } else {
      assert.ok(src.includes("hasPlateau ? (st.plateauPct ?? 'none') : 'none',"), 'the per-unit fold does not read the plateau share only where a plateau is');
    }
    // the launch records it, the stage 3 unit is told its plateaus, the tables carry it, the refusal is gone
    assert.ok(src.includes('plateauPct: plateauPctOrRefuse(params.plateauPct), plateauPermutePct: !!params.plateauPermutePct,'), 'the launch does not record the plateau share');
    assert.ok(src.includes('plateaus: Array.isArray(rec.plateaus) ? rec.plateaus : [],'), 'the stage 3 unit is not told its plateaus');
    assert.strictEqual((src.match(/plateauPct: (st|r)\.plateauPct \?\? null,/g) || []).length, 2, 'the two tables do not both carry the plateau share');
    assert.ok(!/does not fold a plateau to one vote/.test(src), 'stage 3 still refuses a set with plateaus');
    assert.ok(/out\.plateauUnits = records \? records\.filter\(\(r\) => hasPlateauOf\(r\)\)\.length : 0;/.test(src), 'the count line does not say how many units carry a plateau');
    const sw = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    assert.ok(sw.includes("plateau: st.plateauPct == null ? null : Number(st.plateauPct),") && sw.includes("${agr.plateau == null ? '' : '|plateau' + agr.plateau}`;"), 'the quorum\'s identity does not carry the plateau share, so two settings could share one cached stream');
    // and a key without one is byte for byte what every stage 3 set on the box was written under
    const keyOf = require('../lib/stagework').agreedKey;
    assert.strictEqual(keyOf('argmax', { rule: 'count', bar: 'all', pct: 75, copy: 98, both: false, persist: 0, plateau: null }), 'argmax|count|all|75|98|0|0', 'the agreed maps on disk no longer match their own keys');
    assert.strictEqual(keyOf('argmax', { rule: 'count', bar: 'all', pct: 75, copy: 98, both: false, persist: 0, plateau: 60 }), 'argmax|count|all|75|98|0|0|plateau60');
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(/<label class="f" title="[^"]*">plateau share<select id="swPlateauShare">\$\{vocabOptions\('plateauShare', '50'\)\}<\/select><\/label>/.test(ui), 'Sweep has no plateau share box');
    assert.ok(/<input type="checkbox" id="swPermPlateauShare"> permute<\/label>/.test(ui), 'or no permute beside it');
    assert.ok(ui.includes("plateauPct: Number($('#swPlateauShare').value),") && ui.includes("plateauPermutePct: $('#swPermPlateauShare').checked,"), 'the launch does not send it');
    assert.ok(ui.includes("setV('#swPlateauShare', p.plateauPct == null ? 50 : p.plateauPct); setC('#swPermPlateauShare', p.plateauPermutePct);"), 'loading a set back into the boxes drops it');
    assert.ok(/swGhostGroup\('#swGrpPlateau', Array\.isArray\(got\.unitSettings\) && got\.unitSettings\.length > 0 && !got\.plateauUnits\);/.test(ui), 'the box is live on a run with no plateau to read it');
    assert.ok(ui.includes("plateauPct: 'plateau share',"), 'the Funnel cannot name the dial by its box');
    assert.ok(ui.includes('+plateau${r.plateauPct}%'), 'Boards does not say the plateau share a setting used');
  },

  // A STAGE 3 UNIT IS REBUILT WITH ITS EXTRAS (3.206.1), on every window it is
  // priced on, and the soundness check rewrites a name the way today's code
  // writes it. Source-held: the payload is one function every pricing goes
  // through, and the check reads records off disk.
  aStageThreeUnitIsRebuiltWithItsExtrasAndTheNameCheckKnowsThePlateauShareAndTheTChoice() {
    const st = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    const payload = st.slice(st.indexOf('function s3Payload('), st.indexOf('\n}\n', st.indexOf('function s3Payload(')));
    assert.ok(payload.includes("params: (rec.extras || []).length ? { ...doc.params, extras: rec.extras, plateaus: rec.plateaus || [] } : doc.params,"),
      'the stage 3 payload hands a unit the set\'s params without its own extras, so its decision moments are rebuilt without the look-back blocks and refused');
    assert.ok(!/params: doc\.params,/.test(payload), 'a unit without extras is still handed the set\'s params unchanged');
    const check = st.slice(st.indexOf("note('misnamed'") - 1400, st.indexOf("note('misnamed'"));
    assert.ok(check.includes('plateau: agr.plateau,'), 'the name check rewrites a name without the plateau share, so every plateau set reads as misnamed');
    assert.ok(check.includes("const ownT = /\\bt own\\b/.test(String(r.label || '')) && r.geometry && bracketLib.tHoursOn(bracketLib.T_OWN, r.geometry) === r.tHours;")
      && check.includes('shapeLabel(ownT ? { ...r, tHours: bracketLib.T_OWN } : r)'),
      'the name check rewrites t own as the hours one unit priced at, so every t own block reads as misnamed');
    const sw = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    assert.ok(sw.includes('async function unreadChunksFor(combo, geometry, fromTs, extras = []) {')
      && sw.includes("{ allLoaded: true, pinnedFiles: null, extras: Array.isArray(extras) ? extras : [] }")
      && sw.includes('if (Array.isArray(extras) && extras.length) markExtraGates(chunks, extras.map((e) => e.bandPct));'),
      'the unread window is built without the extras, so a member added from a walk set has no columns to read there');
    assert.ok(sw.includes('const got = await unreadChunksFor(combo, geometry, task.unread.fromTs, extras);'), 'the reserve grade does not hand the unit\'s extras to the unread window');
    assert.ok(sw.includes('return gate ? f.map((pr, k) => (gate(holdChunks[k]) ? pr : SAT_OUT.slice())) : f;'), 'an extra speaks ungated on the unread window');
  },

  // THE STAGE 3 COUNT ROUTE SERVES EVERY FIELD THE SCREEN READS (3.206.0). The
  // same hole theProvenanceCheckIsSentEveryFieldItReads closes for the stage
  // headings: 3.205.0 had the screen ghost the plateau share off a field the
  // route never sent, so the box was ghosted on every chain.
  theStageThreeCountRouteServesEveryFieldTheScreenReads() {
    const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const at = UI.indexOf("const r = await swAsk('api/stage3-count'");
    assert.ok(at > 0, 'the screen no longer asks the stage 3 count');
    const body = UI.slice(at, UI.indexOf('\n}\n', at));
    const reads = [...new Set([...body.matchAll(/\bgot\.([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]))];
    assert.ok(reads.length >= 6, `the screen reads only ${reads.length} fields off the count — it is not being read`);
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const r0 = server.indexOf("app.post('/api/stage3-count'");
    const route = server.slice(r0, server.indexOf('\n});\n', r0));
    const served = new Set([
      ...[...route.matchAll(/(?:^|[{,\s])([A-Za-z][A-Za-z0-9]*):/g)].map((m) => m[1]),
      ...[...route.matchAll(/\bout\.([A-Za-z][A-Za-z0-9]*) =/g)].map((m) => m[1]),
    ]);
    const absent = reads.filter((k) => !served.has(k));
    assert.deepStrictEqual(absent, [],
      `the screen reads ${absent.join(', ')} off the stage 3 count and the route never sends ${absent.length > 1 ? 'them' : 'it'}`);
  },

  // THE LAUNCH ANSWERS BEFORE THE SETTINGS ARE BUILT (owner order, 2026-09-02:
  // the press would "go away and do nothing for a minute before crashing
  // without a message", and the run had started). The gates read the count;
  // the block is built behind the answer and held against that count before
  // anything is priced; and the browser stops saying "nothing changed" when
  // it is the gateway that gave up.
  async theStageThreeLaunchAnswersBeforeTheSettingsAreBuilt() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    const start = src.indexOf('function startStage3(params) {');
    const fn = src.slice(start, src.indexOf('\n}\n', src.indexOf('return { id, name: doc.name', start)));
    const answer = fn.indexOf('return { id, name: doc.name');
    const bg = fn.indexOf('(async () => {');
    assert.ok(answer > 0 && bg > 0 && bg < answer, 'the launch has a background part and answers after starting it');
    const before = fn.slice(0, bg);
    const after = fn.slice(bg, answer);
    assert.ok(before.includes('const counted = countDeclared(params, sizes, parentRecords, leans, fieldPairs);'), 'the gates read the count, not the built block — with the leans the launch prices (3.130.0) and the field pairs (3.212.0)');
    assert.ok(!before.includes('settingsFor(params, sizes)') && !before.includes('foldSameTradeSettings('), 'nothing before the answer builds or folds the settings');
    assert.ok(before.includes("if (!counted.kept) throw new Error('the block declared no settings');"), 'an empty block still refuses at the press');
    assert.ok(before.includes('tallyBudgetFor({ settings: counted.kept, units: parentRecords.length, variants: variantsOf(params), declared: counted.declared })') && before.includes('storeBudgetFor({ rows: counted.pricings })'),
      'both budget gates are the count\'s arithmetic — and the disk gate reads what the units hold between them, never settings × units');
    // RE-AIMED 3.187.0: the block is built from the committee shapes its own
    // records carry, which is how the extras reach the fold.
    assert.ok(after.includes('const declaredSettings = settingsFor(params, sizes, shapesOf(parentRecords));') && after.includes('foldSameTradeSettings(declaredSettings, parentRecords, leans, fieldPairs)'),
      'the block is built and folded behind the answer');
    // 3.82.0: the hand-out lives in runStage3Parts, shared with a paused run
    // started again; the launch checks the block, then calls it
    assert.ok(after.indexOf('settings.length !== counted.kept || declaredSettings.length !== counted.declared') < after.indexOf('await runStage3Parts({'),
      'the built block is held against the count before any unit is handed out');
    assert.ok(src.includes("current = { k: part.k, whole: s3Payload({ doc, parent, rec, settings: null, fee, nullN }) };"), 'and the hand-out still reads each unit\'s votes once, at its turn');
    assert.ok(after.indexOf('if (heldOn[u].length !== counted.perUnit[u]) {') < after.indexOf('await runStage3Parts({'),
      'and what each unit holds is held against the count too, unit by unit');
    assert.ok(after.includes('the cost line and the launch disagree, so nothing was priced'), 'and a disagreement says so and stops');
    assert.ok(after.includes('settingLabels: settings.map((s) => s.label),'), 'the names are written onto the plan once the block exists');
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const tp = ui.slice(ui.indexOf('const tryPost = async (p, body, where = WHERE_SWEEP) => {'),
      ui.indexOf('const tryPost = async (p, body, where = WHERE_SWEEP) => {') + 700);
    assert.ok(/HTTP 50\[24\]/.test(tp) && tp.includes('NO ANSWER IN TIME — the service may still be working on it.'),
      'a gateway give-up is told apart from a refusal');
    assert.ok(tp.includes("'FAILED — nothing changed.\\n\\n' + e.message"), 'a real refusal still says nothing changed');
  },

  // THE ANSWER IS RUN, NOT READ (owner report, 2026-09-03: pressing start
  // stage 3 said "nothing changed settings is not defined" — and the run had
  // started). 3.47.0 moved the built settings into the background part and the
  // answer line still read them by name, so every press started a run and then
  // told the browser it had failed. The two tests above read the source and
  // check its shape; neither RUNS the launch, so a broken answer line passed
  // both. This one presses the button against a small stage 2 parent and
  // reads what comes back, then waits for the run behind it to end.
  async theStageThreeLaunchAnswersWithTheCountItWorkedOut() {
    const { stampManifest, MANIFEST_DIR } = require('../lib/manifest');
    const pid = `s2-test-${Date.now().toString(36)}-launch`;
    const pfile = path.join(SETS_DIR, `${pid}.json`);
    const universe = ['ZZZTESTUSDT'];
    let child = null;
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(pfile, JSON.stringify({
        id: pid, stage: 2, seq: 999984, name: 'S2 #launch', status: 'done', createdAt: new Date().toISOString(),
        engineVersion: require('../package.json').version, measurements: require('../lib/features').MEASUREMENTS_VERSION,
        params: { universe, allLoaded: true, windowLayout: 'reserve61', startMonth: '2024-01', endMonth: '2024-03', nullN: 3 },
        dataManifest: stampManifest(pid, universe), plan: { units: 1 },
      }));
      const rec = rowstore.writer(pid, 'records');
      rec.push({ u: 0, carriedRank: 1, s1rank: 1, trade: 'ZZZTESTUSDT', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', bandPct: 2,
        specs: [], score3: 1, scoreAll: 1, helped: 0, beat: 0, pairs: 3, lead: 0, blocks: {} });
      rec.close();
      const got = stages.startStage3({
        from: pid, fee: 0.00125, nullN: 3, keepN: 0, carry: 0, pick: 'count',
        cell: { entry: 'market', tHours: 65 }, decision: 'argmax', band: 3,
        agreeRule: 'count', agreeBar: 'all', agreePct: 50, agreeCopy: 98,
      });
      child = got.id;
      assert.ok(/^s3-/.test(got.id), 'the answer names the set it started');
      assert.strictEqual(got.units, 1, 'the answer counts the units it will price');
      assert.strictEqual(got.settings, 1, 'the answer counts the settings the block declared — one market setting, one agreement');
      assert.strictEqual(stages.getSet(child).plan.settings, got.settings, 'and it is the count the plan was written with');
      // the run behind the answer ends rather than stranding — there are no
      // price files for this coin, so its one unit fails, the failure is
      // written on the set, and the set says it does not match its own plan
      const after = await untilEnded(child);
      assert.notStrictEqual(after.status, 'running', 'the run behind the answer never ended');
      assert.strictEqual(after.status, 'incomplete', `a run whose only unit has no price files ends incomplete, not ${after.status}`);
      assert.strictEqual((after.failures || []).length, 1, 'the failed unit is written on the set');
      assert.ok(/no data for ZZZTESTUSDT/.test(after.failures[0].error), `and says why: ${after.failures[0].error}`);
      assert.ok(/does not match its own plan/.test(after.progress), 'and the set says it does not match its own plan');
    } finally {
      // a launch that threw AFTER starting its run leaves a child this test
      // never learned the id of — found by its parent, so nothing strands
      const strays = stages.listSets().filter((s) => s.stage === 3 && ((s.parent || {}).id === pid || (s.params || {}).from === pid)).map((s) => s.id);
      for (const id of [pid, child, ...strays].filter(Boolean)) {
        try { fs.rmSync(path.join(SETS_DIR, `${id}.json`), { force: true }); } catch (_) { /* fixture */ }
        try { fs.rmSync(path.join(SETS_DIR, `${id}-tally.json.gz`), { force: true }); } catch (_) { /* fixture */ }
        try { fs.rmSync(path.join(SETS_DIR, `${id}-agreed.json.gz`), { force: true }); } catch (_) { /* fixture */ }
        try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
        try { fs.rmSync(path.join(MANIFEST_DIR, `${id}.json`), { force: true }); } catch (_) { /* fixture */ }
      }
    }
  },

  // THE NAME IS THE OWNER'S (owner order, 2026-09-03: "that's my job to name
  // these things and you haven't given me a control"). The launch takes the
  // name from its box; an empty box takes the next free one, the same one the
  // list offers as the greyed suggestion; and a name any set already has is
  // refused before anything is written.
  async theLaunchTakesTheOwnersNameAndRefusesADuplicate() {
    const pid = writeLaunchParent('name');
    // a name of this run's own, so a set a broken earlier run left behind can
    // never be the duplicate this test is about
    const mine = `Named by hand ${pid.slice(-8)}`;
    try {
      const first = stages.startStage3({ ...LAUNCH_BLOCK, from: pid, name: `  ${mine}  ` });
      assert.strictEqual(first.name, mine, 'the answer carries the owner\'s name, trimmed');
      assert.strictEqual(stages.getSet(first.id).name, mine, 'and the set on disk is called that');
      await untilEnded(first.id);
      let refused = null;
      try { stages.startStage3({ ...LAUNCH_BLOCK, from: pid, name: mine.toUpperCase() }); } catch (err) { refused = err.message; }
      assert.ok(refused && new RegExp(`a record set called "${mine.toUpperCase()}" already exists`).test(refused),
        `the same name in another case is the same name, and is refused — got: ${refused || 'a launch'}`);
      assert.strictEqual(stages.listSets().filter((x) => (x.parent || {}).id === pid).length, 1,
        'a refused launch wrote nothing');
      const offered = stages.nextNames()[3];
      assert.ok(/^S3 #\d+$/.test(offered), `the suggestion is the next free number: ${offered}`);
      const second = stages.startStage3({ ...LAUNCH_BLOCK, from: pid, name: '' });
      assert.strictEqual(second.name, offered, 'an empty box takes exactly the name the list offered');
      await untilEnded(second.id);
      assert.notStrictEqual(stages.nextNames()[3], offered, 'and the suggestion moves once that name is taken');
    } finally {
      cleanLaunchParent(pid);
    }
  },

  // RENAMING carries the owner's name into every set that names the renamed
  // one as its parent (RULE NINE), and refuses a duplicate, an empty box, and a
  // set still being written.
  async renamingASetIsTheOwnersAndCarriesToItsChildren() {
    const stamp = Date.now().toString(36);
    const mk = (id, over) => {
      const doc = { id, seq: 999980, status: 'done', createdAt: new Date().toISOString(), plan: { units: 1 }, ...over };
      fs.writeFileSync(path.join(SETS_DIR, `${id}.json`), JSON.stringify(doc));
      return doc;
    };
    const ids = [`s2-test-${stamp}-rn`, `s3-test-${stamp}-rn`, `s4-test-${stamp}-rn`, `s1-test-${stamp}-other`];
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      mk(ids[0], { stage: 2, name: 'S2 #old' });
      mk(ids[1], { stage: 3, name: 'S3 #child', parent: { id: ids[0], name: 'S2 #old' } });
      mk(ids[2], { stage: 4, kind: 'funnel', name: 'Stage 4 #child', parent: { id: ids[0], name: 'S2 #old', release: '3.49.0' } });
      mk(ids[3], { stage: 1, name: 'S1 #taken' });
      const out = stages.setSetName(ids[0], '  Second pass  ');
      assert.strictEqual(out.name, 'Second pass');
      assert.strictEqual(out.was, 'S2 #old');
      assert.ok(out.nameEditedAt, 'the rename is stamped on the server');
      assert.deepStrictEqual(out.childrenRenamed.sort(), [ids[1], ids[2]].sort(), 'both sets that name it as parent are carried');
      assert.strictEqual(stages.getSet(ids[0]).name, 'Second pass');
      assert.strictEqual(stages.getSet(ids[1]).parent.name, 'Second pass', 'the stage 3 child carries the new parent name');
      assert.strictEqual(stages.getSet(ids[2]).parent.name, 'Second pass', 'the stage 4 set carries it too');
      assert.strictEqual(stages.getSet(ids[2]).parent.release, '3.49.0', 'and nothing else on the child\'s parent record moved');
      assert.throws(() => stages.setSetName(ids[0], 's1 #TAKEN'), /already exists/, 'a name another set has, in any case, is refused');
      assert.throws(() => stages.setSetName(ids[0], '   '), /needs a name/, 'an empty box is refused');
      assert.strictEqual(stages.setSetName(ids[0], 'Second pass').name, 'Second pass', 'a set may keep its own name');
      assert.throws(() => stages.setSetName('no-such-set', 'x'), /unknown record set/);
      mk(ids[3], { stage: 1, name: 'S1 #taken', status: 'running' });
      assert.throws(() => stages.setSetName(ids[3], 'anything'), /still being written/, 'a set being written keeps its name until it lands');
    } finally {
      for (const id of ids) { try { fs.rmSync(path.join(SETS_DIR, `${id}.json`), { force: true }); } catch (_) { /* fixture */ } }
    }
  },

  // The box is on every stage of Sweep, beside description, with the next free
  // name greyed in it; the launch sends what is typed and empties the box once
  // a launch has taken it; and the list carries the suggestion from the server.
  // OWNER, 2026-09-05: told earlier in the week that training set the units'
  // knowledge "BY SIMPLY UP or DOWN", that a bunch of small accurate calls can
  // lose badly to one large inaccurate call, and that training would learn to
  // "emphasize MORE a large winning trade than a small one". It was not done.
  // This is it, and these are the numbers it turns on.
  theWeightOfATrainingTradeIsWhatItsDecisionWasWorth() {
    const sw = require('../lib/stagework');
    const wk = (d) => ({ diffPct: d });
    const fee = 0.0005;                       // 0.05% a leg -> a 10 cent round trip on $100
    // A WEEK THAT MOVED IS WORTH ABOUT TWICE THE MOVE; a still week is worth the
    // round trip, never nothing -- calling a still week wrong wastes the fees.
    const raw = sw.moneyWeights([wk(10), wk(0.0001)], fee, 0);
    // 10% of $100 = $10: best +9.90, worst -10.10, so the gap is $20.00
    // ~0%       : best 0, worst -0.10, so the gap is $0.10
    assert.ok(raw[0] / raw[1] > 150 && raw[0] / raw[1] < 250,
      `a landslide must outweigh a crumb by about the ratio of their stakes, not by a made-up number: ${raw[0] / raw[1]}`);
    assert.ok(raw[1] > 0, 'a still week is weightless, so nothing teaches the forecast to stand aside');
    // THE AVERAGE WEEK COUNTS 1, so the strength of the fit means what it meant
    const many = sw.moneyWeights(Array.from({ length: 50 }, (_, i) => wk(1 + (i % 7))), fee, 0);
    const mean = many.reduce((a, b) => a + b, 0) / many.length;
    assert.ok(Math.abs(mean - 1) < 1e-9, `the average weight must be 1, and it is ${mean}`);
    // AND ONE FREAK WEEK CANNOT BE THE WHOLE TRAINING
    const crash = [...Array.from({ length: 200 }, () => wk(3)), wk(-62)];
    assert.ok(Math.max(...sw.moneyWeights(crash, fee, 0)) > 10, 'this fixture does not actually hold an outlier, so the cap proves nothing');
    assert.ok(Math.max(...sw.moneyWeights(crash, fee, 10)) <= 10 + 1e-9, 'the cap does not hold the biggest week down');
    assert.ok(Math.max(...sw.moneyWeights(crash, fee, 5)) <= 5 + 1e-9, 'the cap is not the number the owner set');
    // NOTHING IS WEIGHED UNLESS THE LAUNCH ASKED FOR IT
    assert.equal(sw.weightsFor({}, [wk(5)], fee), null, 'a launch that said nothing is weighing by money anyway');
    assert.equal(sw.weightsFor({ trainOn: 'direction' }, [wk(5)], fee), null, 'direction is being weighed by money');
    assert.ok(Array.isArray(sw.weightsFor({ trainOn: 'money' }, [wk(5), wk(1)], fee)), 'money is not being weighed by money');
    // AND A SET SAYS WHAT IT WAS ACTUALLY TRAINED UNDER, not what was asked for
    assert.deepEqual(sw.weightsSaid({ trainOn: 'money' }, null),
      { by: 'direction', asked: 'money', why: 'no training trade carried a move to weigh by' },
      'a run that could not weigh by money reads as though it did');
    assert.equal(sw.weightsSaid({}, null).by, 'direction', 'a plain run does not say how it was trained');

    // HOW HARD THE CEILING HAD TO WORK (3.121.0, owner order 2026-09-12: "the
    // maximum that we're dealing with perhaps in a chunk of data so that we can
    // evaluate really how much it should be toned down").
    //
    // The record used to carry the largest weight AFTER the ceiling clipped it,
    // so at a ceiling of 5 it read 5 or less whatever the data held and could
    // never say how far anything was being toned down.
    const p5 = { trainOn: 'money', weightCap: 5 };
    const read5 = sw.weightReadingFor(p5, crash, fee);
    const said5 = sw.weightsSaid(p5, sw.moneyWeights(crash, fee, 5), read5);
    assert.ok(said5.biggestBeforeCap > 5,
      `the biggest before the ceiling must be able to exceed it — got ${said5.biggestBeforeCap} at a ceiling of 5`);
    assert.strictEqual(said5.biggestKept, 5, 'and the biggest that survived the ceiling is the ceiling');
    assert.ok(said5.atCeiling >= 1, 'at least one chunk was held at the ceiling and the record must say how many');
    assert.strictEqual(said5.of, crash.length, 'and out of how many');

    // THE NUMBER THAT ANSWERS THE QUESTION DOES NOT MOVE WITH THE CEILING. It
    // is a fact about the data, not about the setting; only how many were held
    // and what survived move.
    const at20 = sw.weightsSaid({ trainOn: 'money', weightCap: 20 },
      sw.moneyWeights(crash, fee, 20), sw.weightReadingFor({ trainOn: 'money', weightCap: 20 }, crash, fee));
    assert.ok(Math.abs(at20.biggestBeforeCap - said5.biggestBeforeCap) < 1e-9,
      'the biggest before the ceiling moved when the ceiling moved, so it is not the biggest before the ceiling');
    assert.ok(at20.biggestKept > said5.biggestKept, 'a higher ceiling must let a bigger weight through');
    assert.ok(at20.atCeiling <= said5.atCeiling, 'a higher ceiling cannot hold MORE chunks down');

    // with the ceiling off, nothing is held and the biggest kept IS the biggest
    const off = sw.weightsSaid({ trainOn: 'money', weightCap: 0 },
      sw.moneyWeights(crash, fee, 0), sw.weightReadingFor({ trainOn: 'money', weightCap: 0 }, crash, fee));
    assert.strictEqual(off.atCeiling, 0, 'with no ceiling nothing can be held at one');
    assert.ok(Math.abs(off.biggestKept - off.biggestBeforeCap) < 0.01,
      'with no ceiling the biggest kept and the biggest before it are the same weight');

    // AND IT IS READ OFF THE STAKES, NOT OFF THE WEIGHTS. Reading it off the
    // weights is exactly how it came to be a number that could never exceed the
    // ceiling, so the two readers share one definition of a chunk's stake.
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'stagework.js'), 'utf8');
    const fn = src.slice(src.indexOf('function moneyWeightReading('), src.indexOf('\n}', src.indexOf('function moneyWeightReading(')));
    assert.ok(/moneyStakes\(/.test(fn), 'the reading builds its own stakes instead of sharing the one definition');
    assert.ok(!/weights/.test(fn), 'the reading looks at the weights, which are already clipped');
  },

  // THE ONE THAT MATTERS: it changes what the forecast LEARNS. A source scan
  // proves the wiring and proves nothing about the fit, so this trains both
  // kinds for real on a board where the two ways of counting disagree, and the
  // owner's sentence is the assertion: "a bunch of small accurate calls can,
  // when money comes into play, lose badly to a single large inaccurate call".
  async countingMoneyRatherThanTradesChangesWhatBothForecastsLearn() {
    const sw = require('../lib/stagework');
    // At the first spot the market went UP by a crumb nine times in ten and
    // DOWN by a landslide the tenth. Counting weeks, up wins nine to one.
    // Counting money, the one landslide outweighs the nine crumbs together.
    // The second spot is clean and must not move either way.
    const rows = [];
    for (let i = 0; i < 200; i++) {
      const big = i % 10 === 4;
      rows.push({ x: [1, 0], label: big ? -1 : 1, diffPct: big ? -12 : 0.3 });
    }
    for (let i = 0; i < 100; i++) rows.push({ x: [0, 1], label: 1, diffPct: 0.4 });
    // dealt through the run, so the validation tail is not one group
    const chunks = [];
    for (let i = 0; i < rows.length; i++) chunks.push(rows[(i * 7 + 3) % rows.length]);
    const weights = sw.moneyWeights(chunks, 0.0005, 0);
    const call = (probs) => { let b = 0; for (let k = 1; k < 3; k++) if (probs[k] > probs[b]) b = k; return [-1, 0, 1][b]; };
    const ask = [{ x: [1, 0] }, { x: [0, 1] }];
    for (const model of ['logreg', 'boost']) {
      // eslint-disable-next-line no-await-in-loop
      const weeks = await sw.trainProbMember({ model, viewIdx: [0, 1], trainChunks: chunks, predictChunks: ask });
      // eslint-disable-next-line no-await-in-loop
      const money = await sw.trainProbMember({ model, viewIdx: [0, 1], trainChunks: chunks, predictChunks: ask, weights });
      assert.equal(call(weeks.probs[0]), 1,
        `${model}: counting weeks must follow the nine crumbs -- if it does not, this board proves nothing`);
      assert.equal(call(money.probs[0]), -1,
        `${model}: counting money still follows the nine crumbs and ignores the landslide, which is the whole fault`);
      assert.equal(call(weeks.probs[1]), 1, `${model}: the clean spot moved when nothing there was in dispute`);
      assert.equal(call(money.probs[1]), 1, `${model}: weighing by money scrambled a spot where the two ways agree`);
    }
  },

  // the weights reach BOTH trainers, and the probe fit is graded on the same
  // yardstick it was trained on
  bothKindsOfForecastAreFittedOnTheWeightsAndGradedOnThem() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    const fit = src.slice(src.indexOf('async function trainProbMember('), src.indexOf('// Shared unit plumbing'));
    assert.ok(fit.includes('tuneAndTrain(Ztr, ytr, { onProgress: () => {}, exampleWeights: wAll })'),
      'the first kind of forecast is still fitted with every week counting the same');
    assert.ok(fit.includes('trainSoftmax(Ztr.slice(0, nSub), ytr.slice(0, nSub), chosenLambda, { weights: wSub })'),
      'its probe fit is unweighted, so the threshold is tuned against a different objective than the model');
    assert.ok(fit.includes('weights: wSub, valWeights: wVal,'),
      'the second kind of forecast is trained weighted and graded unweighted, which is the one mistake its own note warns about');
    assert.ok(fit.includes('trainBoost(Xtr, ytr, { rounds: probe.bestRound, weights: wAll })'),
      'the second kind of forecast is still fitted with every week counting the same');
    // a length that does not line up is refused rather than silently ignored
    assert.ok(fit.includes('throw new Error(`training weights are ${weights.length} long and there are ${Xtr.length} training chunks`)'),
      'weights of the wrong length are quietly dropped, and the run would read as weighted');
    // both stages, and stage 2 cannot differ from its parent
    assert.ok(src.includes('const weights = weightsFor(p, trainChunks, fee);'), 'a stage trains without asking what its weeks are worth');
    assert.equal((src.match(/const weights = weightsFor\(p, trainChunks, fee\);/g) || []).length, 2,
      'only one of the two stages weighs its training, so half a committee is trained differently from the other half');
    const st = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(st.includes("params: { ...parent.params, carry: carried.length,"),
      'stage 2 no longer copies its parent\'s settings, so the two halves of a committee could be trained differently');
  },

  // it is the owner's, it is refused rather than coerced, and the set says it
  howAUnitWasTrainedIsTheOwnersChoiceAndRidesOnTheRecord() {
    const S = require('../lib/stages');
    assert.throws(() => S.startStage1({ sizes: { singles: true }, fee: 0.05, name: 'x', trainOn: 'nonsense' }),
      /is not a way to train/, 'a mistyped way of training quietly becomes the old one');
    assert.throws(() => S.startStage1({ sizes: { singles: true }, fee: 0.05, name: 'x', weightCap: -2 }),
      /must be 0 or more/, 'a nonsense limit is accepted');
    const st = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    const launch = st.slice(st.indexOf('function startStage1(params) {'), st.indexOf('const units = unitsFor('));
    assert.ok(/trainOn,\n    weightCap,/.test(launch), 'the setting never reaches the workers, so the tick does nothing');
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(ui.includes('id="swByMoney"'), 'there is no way to ask for it');
    assert.ok(ui.includes('weigh each trade by the money it was worth'), 'the control does not say what it does');
    assert.ok(ui.includes('id="swCap1"'), 'there is no way to hold one freak week down');
    assert.ok(ui.includes("trainOn: $('#swByMoney').checked ? 'money' : 'direction',"), 'the launch does not carry the tick');
    assert.ok(ui.includes("weightCap: $('#swCap1').value === '' ? undefined : Number($('#swCap1').value),"), 'the launch does not carry the limit');
    // and a record set says how it was trained wherever it is named
    assert.ok(ui.includes('trained by the money each trade was worth') && ui.includes('trained by direction only'),
      'a set does not say how its units were trained, so two sets that cannot be compared look alike');
    assert.ok(ui.includes("setC('#swByMoney', (p.trainOn || 'direction') === 'money');"),
      'choosing a set does not show how it was trained');
    assert.ok(ui.includes("['weigh each trade by the money it was worth', c('#swByMoney') ? 'on' : 'off',"),
      'a form that disagrees with the set stage 2 reads from says nothing');
  },

  // THE STAGE 2 CARRY TAKES THE STAGE 1 TABLE AS BOARDS SHOWS IT (3.220.0,
  // owner order 2026-09-21: "GO NOW! on the stage 1 filters carry fix"). The
  // saved sort and the saved filters both cut it; the launch and the set-up's
  // own line read one definition; the Boards page writes the stage 1 filters
  // onto the set the way it writes the stage 2 filters.
  async theStageTwoCarryTakesOnlyTheRowsTheStageOneFiltersKeep() {
    const id = `s1-test-${Date.now().toString(36)}-cut`;
    const file = path.join(SETS_DIR, `${id}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        id, stage: 1, seq: 999979, name: 'S1 #cut', status: 'done', createdAt: new Date().toISOString(), plan: { units: 3 },
        params: { nullN: 4, fee: 0.00125 },
        sort: [{ key: 'beat', dir: 'desc' }], filters: { beatMin: 60 },
      }));
      const rec = rowstore.writer(id, 'records');
      rec.push({ u: 0, trade: 'C0', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', counts: {}, specs: [], score: 100, beat: 4, pairs: 4, lead: 2, money: 5, beatMoney: 4, leadMoney: 1, nullScores: [], blocks: {} });
      rec.push({ u: 1, trade: 'C1', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', counts: {}, specs: [], score: 90, beat: 2, pairs: 4, lead: 1, money: -1, beatMoney: 1, leadMoney: 0, nullScores: [], blocks: {} });
      rec.push({ u: 2, trade: 'C2', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', counts: {}, specs: [], score: 80, beat: 3, pairs: 4, lead: 1.5, money: 2, beatMoney: 3, leadMoney: 0.5, nullScores: [], blocks: {} });
      rec.close();
      const rk = rowstore.writer(id, 'ranking');
      rk.push({ rank: 1, u: 0, beat: 4, pairs: 4, lead: 2, score: 100 });
      rk.push({ rank: 2, u: 1, beat: 2, pairs: 4, lead: 1, score: 90 });
      rk.push({ rank: 3, u: 2, beat: 3, pairs: 4, lead: 1.5, score: 80 });
      rk.close();
      const doc = stages.getSet(id);
      // the table as Boards shows it: sorted by beat, filtered to 60% and up
      assert.deepStrictEqual(stages.stage1Table(id, 0, 10, doc.filters).rows.map((r) => r.trade), ['C0', 'C2'], 'the screen shows the two that clear 60%');
      const all = stages.stage1Carry(doc, 0);
      assert.deepStrictEqual(all.rows.map((r) => r.u), [0, 2], 'carry 0 takes every row the filters keep, in the saved order');
      assert.strictEqual(all.of, 3, 'of the whole table');
      assert.strictEqual(all.kept, 2, 'the filters keep two');
      assert.notStrictEqual(all.sortedBy, 'the fixed rule', 'and the saved sort is named');
      assert.deepStrictEqual(stages.stage1Carry(doc, 1).rows.map((r) => r.u), [0], 'carry 1 takes the top of those');
      // no filters saved: the whole table, in the fixed rule when no sort is saved either
      doc.filters = null; doc.sort = null;
      const plain = stages.stage1Carry(doc, 0);
      assert.deepStrictEqual(plain.rows.map((r) => r.u), [0, 1, 2]);
      assert.strictEqual(plain.kept, 3);
      assert.strictEqual(plain.sortedBy, 'the fixed rule');
      // the set-up's own line reads the same definition
      const pv = stages.stage1CarryPreview(id, 1);
      assert.deepStrictEqual([pv.carry, pv.of, pv.kept], [1, 3, 2], 'the preview counts what the launch would carry');
    } finally {
      try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
    }
    // the launch, the route and the screens use it
    const st = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(st.includes('  const cut = stage1Carry(parent, carry);\n  const carried = cut.rows;'), 'the stage 2 launch carries through stage1Carry');
    assert.ok(st.includes('carry: carried.length, of: cut.of, kept: cut.kept,'), 'and the set records what the filters kept');
    const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.ok(srv.includes("app.get('/api/stageset/:id/carry', (req, res) => {"), 'the set-up can ask what the carry would take');
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(ui.includes('<p class="note warn" id="swCut2" style="margin:.2rem 0 .4rem;display:none"></p>'), 'the stage 2 set-up has the line');
    assert.ok(ui.includes("the filters saved on the parent's table leave <b>${Number(got.kept).toLocaleString()}</b> of its ${Number(got.of).toLocaleString()} rows, and the carry takes the top of those. Press Clear filters under its table on Boards to carry from the whole set."), 'and it says what the stage 3 set-up says');
    assert.ok(ui.includes("if ((key === 'S1' || key === 'S2') && doc && doc.id) await tryPost("), 'Clear filters under the stage 1 table clears them off the set too');
    // AND THE STAGE 1 TABLE'S WIRING IS HANDED ITS SET (3.220.1, owner: "i set
    // a filter of 86 rows on stage 1 and stage 2 sweep is doing all 1530
    // units"): without it Apply saved nothing and the carry took everything
    assert.ok(ui.includes("  bWireFilters(mount, doc);\n  bWireTableFold(mount);\n  await bWireMembers(doc, mount, 'S1');"), 'the stage 1 table\'s filter wiring is not handed its set, so Apply cannot save onto it');
    assert.ok(ui.includes("par.carry === (par.kept != null ? par.kept : par.of)"), 'carry 0 against a filtered parent reads as a mismatch on the stage 3 heading');
  },

  async theNameBoxIsOnEveryStageOfSweepAndTheLaunchSendsIt() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    const list = srv.slice(srv.indexOf("app.get('/api/stagesets'"), srv.indexOf('\n}));', srv.indexOf("app.get('/api/stagesets'")));
    assert.ok(list.includes('nextNames: stages.nextNames(),') && list.includes("coinsDownloaded: require('./lib/dataset').defaultCoins(),"),
      'the record-set list does not carry the next free names, or what a blank coin box resolves to');
    assert.ok(list.includes("app.get('/api/stagesets', (req, res) => res.json({") && list.includes('running: stages.stageRunning(), sets: stages.listSets().filter((s) => !s.exam),'),
      'and it is still the list of sets that carries them');
    assert.ok(ui.includes("  const nextNames = st.nextNames || {};"), 'Sweep does not read the next free names off the list');
    for (const n of [1, 2, 3]) {
      assert.ok(ui.includes(`      <label class="f">name<input id="swName${n}" placeholder="\${esc(nextNames[${n}] || '')}" maxlength="80" style="width:17rem"></label>\n      <label class="f" style="flex:1">description<input id="swDesc${n}" style="width:100%"></label>`),
        `the stage ${n} name box is not beside description with the next free name greyed in it`);
      assert.ok(ui.includes(`      name: $('#swName${n}').value,`), `the stage ${n} launch does not send the name`);
      // THE NAME THE OWNER TYPED STAYS IN THE BOX (3.67.1, owner report). This
      // used to require the opposite -- the box emptied itself the moment the
      // launch went through -- so the one thing on screen saying which set had
      // just been started disappeared at the moment it became true. A second
      // launch under the same name is refused by the service in words, which
      // is what stops a name being taken twice; an emptied box only hid it.
      // a press answers pending when the gateway dropped the answer (3.83.0); the form is saved on a real answer
      assert.ok(ui.includes(`if (got && !got.pending) { rememberSweepForm(); say('#swOut${n}'`),
        `the stage ${n} launch does not save the form with the name still in it`);
      assert.ok(!ui.includes(`$('#swName${n}').value = '';`),
        `the stage ${n} box empties itself of the name the owner typed`);
    }
    assert.ok(ui.includes("for (const n of [1, 2, 3]) { const b = $(`#swName${n}`); if (b && st.nextNames) b.placeholder = st.nextNames[n] || ''; }"),
      'the greyed suggestion does not move when a launch takes a name');
  },

  // STAGE 3 PRICES IN PARTS, NOT UNITS (owner order, 2026-09-02: "we're
  // running 1.75M settings with 36.7M pricings and we're getting about 1 cpu
  // worth of effort and no status updates"). Each unit's settings are cut into
  // enough parts to feed every worker, each part numbered from its place in the
  // block, the votes read once per unit, a unit finished when all its parts
  // land and failed once; and the line counts parts as they land.
  async theStageThreePricingIsHandedOutInParts() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    const start = src.indexOf('function startStage3(params) {');
    const launch = src.slice(start, src.indexOf('\n}\n', src.indexOf('return { id, name: doc.name', start)));
    // 3.82.0: the loop is runStage3Parts, shared with a paused run started
    // again; the launch builds each unit's own list and hands it over
    const fn = src.slice(src.indexOf('async function runStage3Parts('), src.indexOf('\nasync function finishStage3('));
    // THE UNIT'S OWN LIST (3.52.0): a unit is handed only the settings that
    // place different orders on it, each carrying its place in the block, so
    // its records file there whichever part priced them
    // BY NUMBER INTO THE ONE BLOCK (3.220.2): the place is stamped on the
    // block once, a unit's list is numbers, and nothing copies a setting per unit
    assert.ok(launch.includes('stampPlaces(settings);') && launch.includes('const work = parentRecords.map((rec, pi) => ({ rec, idx: heldOn[pi], drop: null }));'),
      'a unit is handed the NUMBERS of its own settings into the one block, each setting stamped with its place once');
    assert.ok(!src.includes('{ ...settings[i], si: i }'), 'a setting is copied per unit again — 20.8 million copies on the block that killed the service');
    assert.ok(fn.includes('const partsPerUnit = Math.max(1, Math.min(mine.length, workersN * 4));'), 'enough parts to feed every worker several times over, never more parts than the unit holds');
    assert.ok(fn.includes("if (!current || current.k !== part.k) current = { k: part.k, whole: s3Payload({ doc, parent, rec, settings: null, fee, nullN }) };"), 'the votes are read once per unit, at its turn');
    assert.ok(fn.includes('settings[j - part.from] = block[idx[j]];') && fn.includes('const payloads = { length: parts.length, at: payloadAt };'),
      'each part reads its settings out of the block by number when the pool asks for it');
    assert.ok(!fn.includes('payloads.push('), 'every part is built before the first pricing again — every unit\'s votes in memory at once');
    assert.ok(!/siFrom/.test(fn), 'a part no longer numbers its rows from an offset — the place travels on the setting');
    assert.ok(fn.includes("phase: 'pricing the settings', done: doc.perf.partsDone, total: parts.length, word: 'parts', startedMs: tPrice,"), 'progress counts parts as they land');
    assert.ok(fn.includes('if (landed[part.k] === partsOf[part.k]) doc.perf.unitsDone++;'), 'a unit is finished when all of ITS parts have landed — units are cut into different numbers of parts now');
    assert.ok(fn.includes('} else if (!settled.ok && !failedUnits.has(part.k)) {'), 'a unit fails once, whichever part failed first');
    assert.ok(fn.includes('doc.perf.cyclesDone = live.pricedSettings() * (1 + nullN + keepN);'), 'the pricings done follow the settings priced, not the units');
    // and the unit task numbers its rows from the part's place in the block
    const sw = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    const task = sw.slice(sw.indexOf('async function s3UnitTask(task) {'), sw.indexOf('\n}\n', sw.indexOf('async function s3UnitTask(task) {')));
    assert.ok(task.includes('if (!Number.isInteger(st.si) || st.si < 0) throw new Error(`the setting "${st.label}" was handed to a unit without its place in the block`);'),
      'a setting handed over without its place in the block is refused, not filed at zero');
    assert.strictEqual(task.split('si: st.si').length - 1, 2, 'both row shapes file the record at the setting\'s own place, whichever part priced it');
    assert.ok(!/siFrom/.test(task), 'the unit task no longer numbers rows from an offset');
  },

  // THE START-AGAIN AND THE POOL HOLD THE SAME RULE (3.220.2): a paused run
  // started again numbers its units' settings into the one block too, and the
  // pool takes a lazy list so no part exists before its turn.
  async theLaunchHandsEachUnitItsSettingsByNumberAndBuildsAPartAtItsTurn() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(src.includes('function stampPlaces(block) {\n  for (let i = 0; i < block.length; i++) block[i].si = i;\n  return block;\n}'),
      'the place in the block is not stamped on the block itself');
    const again = src.slice(src.indexOf('function continueStage3(id) {'), src.indexOf('\nfunction tallyBudgetFor('));
    assert.ok(again.length > 1000, 'the start-again is not where it was');
    assert.ok(again.includes('stampPlaces(settings);'), 'a start-again does not stamp the rebuilt block');
    assert.ok(again.includes('      const mine = heldOn[pi];                                   // numbers into the one block (3.220.2)'), 'a start-again copies a setting per unit again');
    assert.ok(again.includes('const todo = mine.filter((i) => !got.has(i));'), 'what is not on disk is not found by number');
    assert.ok(again.includes('work.push({ rec, idx: [...todo, ...extra].sort((a, b) => a - b), drop: drop.size ? drop : null });'),
      'a unit is not handed its numbers in block order');
    assert.ok(again.includes('runStage3Parts({ doc, parent, pool, w, parentRecords, block: settings, work, fee, nullN, keepN, live, t0 })'),
      'the start-again does not hand the block over');
    // and the pool walks a lazy list the same way it walks an array
    const pool = fs.readFileSync(path.join(ROOT, 'lib', 'pool.js'), 'utf8');
    assert.ok(pool.includes('const at = Array.isArray(payloads) ? (i) => payloads[i] : (i) => payloads.at(i);'), 'the pool cannot take a lazy list');
    assert.ok(pool.includes('payload = at(i);\n          settled = { ok: true, value: await this.run(kind, payload) };'), 'a payload is not built when its lane takes its number');
  },

  // THE COUNT IS THE LAUNCH'S FOLD WITHOUT THE SETTINGS (owner order,
  // 2026-09-02: "HTTP 504 ... we need a longer timeout or other fix"). The
  // cost line's number is worked out from the block's axes and its shapes,
  // never by building every setting -- and it must equal, to the setting, what
  // the launch gets by building them all and folding the ones that price the
  // same trade. Held equal here on blocks that fold for every reason a block
  // can: market cells with no geometry, an auto band that lands on a fixed
  // one across every unit, and a block with nothing to fold at all.
  async theStageThreeCountIsTheLaunchsFoldWithoutTheSettings() {
    const same = (b, sizes, records, why, leans = null) => {
      // BOTH SIDES ARE GIVEN THE SAME COMMITTEE SHAPES (3.187.0). The fast
      // count reads them off the records; the slow build has to be handed the
      // same ones or this compares two different blocks. With `sizes` null and
      // records present the two used to differ -- the count fell back to a
      // committee of one and the records held two sizes.
      const slow = stages.settingsFor(b, sizes, stages.shapesOf(records));
      const fold = stages.foldSameTradeSettings(slow, records, leans);
      const fast = stages.countDeclared(b, sizes, records, leans);
      assert.deepStrictEqual([fast.declared, fast.kept, fast.folded], [slow.length, fold.kept.length, fold.folded.length], why);
      // AND UNIT BY UNIT (3.52.0): what each unit will price, and the sum
      assert.deepStrictEqual(fast.perUnit, fold.heldOn.map((h) => h.length), `${why}: the count and the fold disagree about what a unit holds`);
      assert.strictEqual(fast.pricings, fold.heldOn.reduce((a, h) => a + h.length, 0), `${why}: the pricings are not the sum of what the units hold`);
      return fast;
    };
    const unit = (trade, bandPct, size = 1, geometry = 'daily-4d') => ({ trade, ctx1: size > 1 ? 'ETHUSDT' : null, ctx2: null, size, geometry, bandPct });
    const spread = [unit('AAAUSDT', 2.1), unit('BBBUSDT', 4.4), unit('CCCUSDT', 6.3, 2)];
    const onFive = [unit('AAAUSDT', 5), unit('BBBUSDT', 5), unit('CCCUSDT', 5)];
    const cell = { entry: 'breakout', gate: 'active', dMult: 1, tHours: 41, trailMult: 1, armMult: 0 };
    // the owner's kind of block: every trade dial permuted, every axis permuted
    const big = { cell, cellPermute: { entry: true, gate: true, dMult: true, tHours: true, trail: true, arm: true },
      permuteDecision: true, permuteBand: true, agreePermuteRule: true, agreePermutePct: true, agreePermuteBar: true };
    const a = same(big, [1, 2], spread, 'the full block, units with bands of their own');
    assert.ok(a.folded > 0, 'market cells carry no geometry, so their bands fold — the fixture must fold something');
    const b = same(big, [1, 2], onFive, 'the full block, every unit at 5%: auto lands on the 5% band and folds into it');
    assert.ok(b.kept < a.kept, 'an auto band that resolves to a fixed one on every unit folds more, not less');
    same({ cell: { entry: 'market', tHours: 65 }, permuteBand: true, agreePermutePct: true }, [1], spread, 'market only: every band is one trade');
    same({ cell, permuteBand: true }, [1], spread, 'one breakout shape across the bands: nothing to fold');
    same({ cell }, [1], [], 'no units yet: declared is kept');
    same({ cell, cellPermute: { dMult: true, trail: true, arm: true }, permuteBand: true, agreePermuteRule: true }, [1, 3], onFive, 'shapes and bands with the voices rule and its copies');
    // A UNIT WITH NO WEEKDAY VERSION holds one of each pair of 24/5 values and
    // the daily unit beside it holds both: different counts, one block
    const weekly = [unit('AAAUSDT', 2.1), unit('WWWUSDT', 2.1, 1, 'weekly-8d')];
    const w = same({ cell, permuteWeekdays: true, permuteBand: true }, [1], weekly, 'a daily unit and a weekly unit, 24/5 both ways');
    assert.strictEqual(w.perUnit[1] * 2, w.perUnit[0], 'the weekly unit holds half of what the daily unit holds');
    assert.strictEqual(w.kept, w.perUnit[0], 'nothing is folded out of the block itself while the daily unit still prices both values');
    assert.strictEqual(w.weekdaysApply, true, 'a daily unit is being priced, so 24/5 applies');
    const onlyWeekly = same({ cell, permuteWeekdays: true }, [1], [unit('WWWUSDT', 2.1, 1, 'weekly-8d'), unit('VVVUSDT', 3.3, 1, 'weekly-8d')], 'weekly units only');
    assert.strictEqual(onlyWeekly.weekdaysApply, false, 'no unit being priced has a weekday version, so 24/5 is ghosted');
    assert.strictEqual(onlyWeekly.kept * 2, onlyWeekly.declared, 'with only weekly units the second value of 24/5 leaves the block altogether');
    // and it is the count the cost line reads
    const d = stages.stage3Declared({ ...big });
    assert.strictEqual(d.settings, stages.countDeclared(big, null, []).kept, 'with no parent named the count is the block itself');
    assert.deepStrictEqual([d.pricings, d.unitSettings, d.weekdaysApply], [0, [], true], 'with no parent named there is nothing per unit yet, and 24/5 is not ghosted');
    // THE CONFIRM DIAL (3.130.0, COINS.md section 11): on a unit that carries
    // a lean its three values price three different sets of trades; on any
    // other unit they place the same orders and are one setting there
    const lean = { 'AAAUSDT|daily-4d': { band: 140, yardstick: 3.2, rising: -1, falling: 1 } };
    const plain = same({ cell, permuteBand: true }, [1], spread, 'no confirm asked for');
    const noLean = same({ cell, permuteBand: true, permuteConfirm: true }, [1], spread, 'confirm permuted with no lean anywhere');
    assert.strictEqual(noLean.declared, plain.declared * 4, 'four values are declared (3.206.0: strictly confirmed)');
    assert.strictEqual(noLean.kept, plain.kept, 'and with no lean on any unit they fold to one everywhere');
    assert.deepStrictEqual(noLean.perUnit, plain.perUnit, 'every unit holds exactly what it held without the dial');
    assert.strictEqual(noLean.leanUnits, 0);
    const withLean = same({ cell, permuteBand: true, permuteConfirm: true }, [1], spread, 'confirm permuted, one unit with a lean', lean);
    assert.strictEqual(withLean.leanUnits, 1, 'one of the three units carries a lean');
    assert.strictEqual(withLean.perUnit[0], plain.perUnit[0] * 4, 'the unit with the lean prices all four values');
    assert.deepStrictEqual(withLean.perUnit.slice(1), plain.perUnit.slice(1), 'the other units price one');
    assert.strictEqual(withLean.kept, plain.kept * 4, 'every value is kept in the block as soon as one unit prices it');
    assert.strictEqual(withLean.pricings, plain.pricings + 3 * plain.perUnit[0], 'the pricings grow by the lean unit\'s three extra copies alone');
    const sizedOnly = same({ cell, permuteBand: true, confirm: 'sized' }, [1], spread, 'sized alone, one unit with a lean', lean);
    assert.deepStrictEqual([sizedOnly.declared, sizedOnly.kept, sizedOnly.perUnit], [plain.declared, plain.kept, plain.perUnit], 'one value of confirm multiplies nothing');
    assert.strictEqual(sizedOnly.leanUnits, 1);
  },

  // THE DIAL NAMES ITS SETTINGS AND REFUSES WHAT IT CANNOT PRICE (3.130.0).
  // off leaves every name exactly as it was, so a block that never asked for
  // the lean is named as every block before this release; the other two
  // values say so at the end of the name, sized with its two multipliers.
  async theConfirmDialNamesItsSettingsAndRefusesBadValues() {
    const cell = { entry: 'market', tHours: 65 };
    const one = stages.settingsFor({ cell, agreeRule: 'count', agreePct: 50 }, [1]);
    assert.strictEqual(one.length, 1);
    assert.deepStrictEqual([one[0].confirm, one[0].kx, one[0].ux], ['off', 2, 1], 'off, with the default multipliers on the record');
    assert.ok(!/confirm|sized/.test(one[0].label), `off adds nothing to the name: ${one[0].label}`);
    const three = stages.settingsFor({ cell, agreeRule: 'count', agreePct: 50, permuteConfirm: true }, [1]);
    assert.deepStrictEqual(three.map((st) => st.confirm), ['off', 'confirmed only', 'strictly confirmed', 'sized'], 'the values in the dial\'s own order (3.206.0: strictly confirmed)');
    assert.strictEqual(three[1].label, `${one[0].label} \u00b7 confirmed only`);
    assert.strictEqual(three[2].label, `${one[0].label} \u00b7 strictly confirmed`, 'the fourth value must reach the name, or two settings share one');
    assert.strictEqual(three[3].label, `${one[0].label} \u00b7 sized \u00d72/\u00d71`);
    const typed = stages.settingsFor({ cell, agreeRule: 'count', agreePct: 50, confirm: 'sized', confirmedX: '3', unconfirmedX: 0.5 }, [1]);
    assert.strictEqual(typed[0].label, `${one[0].label} \u00b7 sized \u00d73/\u00d70.5`, 'the boxes as typed, in the name');
    assert.deepStrictEqual([typed[0].kx, typed[0].ux], [3, 0.5]);
    assert.throws(() => stages.settingsFor({ cell, confirm: 'maybe' }, [1]), /"maybe" is not a value of confirm \(off \/ confirmed only \/ strictly confirmed \/ sized\)/);
    assert.throws(() => stages.settingsFor({ cell, confirm: 'sized', confirmedX: -1 }, [1]), /confirmed \u00d7 must be a number of zero or more/);
    assert.throws(() => stages.settingsFor({ cell, confirm: 'sized', unconfirmedX: 'two' }, [1]), /unconfirmed \u00d7 must be a number of zero or more/);
    // whether a block asks for the lean at all
    assert.strictEqual(stages.confirmWanted({ cell }), false);
    assert.strictEqual(stages.confirmWanted({ cell, confirm: 'off' }), false);
    assert.strictEqual(stages.confirmWanted({ cell, confirm: 'confirmed only' }), true);
    assert.strictEqual(stages.confirmWanted({ cell, permuteConfirm: true }), true);
    assert.deepStrictEqual([stages.confirmLabel('off', 2, 1), stages.confirmLabel('confirmed only', 2, 1), stages.confirmLabel('strictly confirmed', 2, 1), stages.confirmLabel('sized', 2, 1)],
      ['', ' \u00b7 confirmed only', ' \u00b7 strictly confirmed', ' \u00b7 sized \u00d72/\u00d71']);
    // the Funnel reads it as one more dial, and every screen offers the engine's list
    assert.ok(require('../lib/funnel').CATEGORICAL_DIALS.includes('confirm'), 'the Funnel must read confirm as a dial');
    const vocab = require('../lib/vocabulary').vocabulary();
    assert.deepStrictEqual(vocab.confirm.map((o) => o.value), ['off', 'confirmed only', 'strictly confirmed', 'sized'], 'the dial\'s box is filled from the engine\'s list');
    assert.deepStrictEqual(vocab.confirmVerdict.map((o) => o.value), ['adds nothing', 'just leverage', 'adds value', 'better signal']);
    for (const o of vocab.confirmVerdict) assert.ok(o.why && o.why.length > 20, `${o.value} carries what it rests on for the hover`);
  },

  // A LAUNCH THAT ASKS FOR THE LEAN AND HAS NO UNIT TO READ IT ON IS REFUSED
  // IN WORDS (3.130.0): pricing three copies of the same trades would be a
  // block three times the size that says nothing. The count says the same
  // thing before the press, so the screen can grey the dial.
  async aLaunchAskingForConfirmRefusesWhenNoUnitPasses() {
    // and anything an earlier run left behind goes first, so a leftover cannot
    // make this run refuse for a reason that has nothing to do with confirm
    for (const x of stages.listSets()) if (/^confirm off /.test(String(x.name || ''))) rmSet(x.id);
    const pid = writeLaunchParent('confirm');
    try {
      const d = stages.stage3Declared({ ...LAUNCH_BLOCK, from: pid, confirm: 'sized' });
      assert.deepStrictEqual([d.leanUnits, d.confirmWanted], [0, true], 'the count says no unit carries a lean, and that the dial asked');
      assert.strictEqual(stages.stage3Declared({ ...LAUNCH_BLOCK, from: pid }).confirmWanted, false, 'off asks for nothing');
      let refused = null;
      try { stages.startStage3({ ...LAUNCH_BLOCK, from: pid, confirm: 'sized' }); } catch (err) { refused = err.message; }
      // RE-AIMED 3.186.0 (owner order): the lean is read off the list the CHAIN
      // took its units from, so the refusal has to say WHICH list -- and this
      // chain read neither, which no amount of ticking on Coins can fix. A
      // sentence that sent the owner off to tick rows would be worse than none.
      assert.ok(refused && /this record set was not built from anything ticked on Coins/.test(refused)
        && /price a record set built from Candidates for Sweep/.test(refused),
        `expected the refusal in words, got: ${refused || 'a launch'}`);
      assert.ok(!/pick a parent whose units pass/.test(refused), 'it still tells the owner to go and tick rows this chain will never read');
      assert.strictEqual(stages.listSets().filter((x) => (x.params || {}).from === pid).length, 0, 'nothing was written');
      // permuted, the same: the block asked for the lean
      refused = null;
      try { stages.startStage3({ ...LAUNCH_BLOCK, from: pid, permuteConfirm: true }); } catch (err) { refused = err.message; }
      assert.ok(refused && /confirm would change nothing/.test(refused), `permute asks for the lean too: ${refused || 'a launch'}`);
      // and a launch at off writes its (empty) leans and the dial's value on the set
      //
      // THE NAME IS UNIQUE PER RUN (3.189.0). It used to be `confirm off ` plus
      // the last six characters of the parent's id -- which are always
      // `onfirm`, from the tag -- so every run asked for the same name. A set
      // left behind by the previous run then made this one refuse with "a
      // record set called that already exists", and the suite failed on
      // alternate runs. The leftover happens because the launch's own
      // background finish can write the set again after the clean-up has
      // deleted it; a unique name makes that harmless instead of poisonous.
      const got = stages.startStage3({ ...LAUNCH_BLOCK, from: pid, name: `confirm off ${pid.slice(8, 22)}` });
      const doc = stages.getSet(got.id);
      assert.deepStrictEqual([doc.params.confirm, doc.params.permuteConfirm, doc.params.confirmedX, doc.params.unconfirmedX, doc.params.confirmLeans],
        ['off', false, 2, 1, {}], 'the set says what it used');
      await untilEnded(got.id);
    } finally { cleanLaunchParent(pid); }
  },

  // A SET LISTING READS SET DOCUMENTS AND NOTHING ELSE (3.189.0, owner order,
  // after an outage).
  //
  // WHAT HAPPENED. listSets accepted any file ending in .json and parsed each
  // one in full. The Funnel writes its own numbers beside the sets as
  // `<id>.funnelrich.json`, so every listing parsed that file as though it were
  // a set. The screens POLL the listing; once the file grew, calls arrived
  // faster than they finished, the main thread never came free, and every page
  // and route timed out at the gateway for hours. A walk running at the time
  // was starved to a halt and lost. The listing also carried a row with no id
  // for each sidecar, which is what the `None None None` lines in the set
  // reports were.
  //
  // Measured on this box: one listing went from 0.8ms to 97ms with a 10MB
  // sidecar present, and back to 1.3ms with the rule below.
  theSetListingReadsSetDocumentsAndNotTheSidecarsBesideThem() {
    // THE RULE ITSELF, on names alone -- no files, no parsing. A set is
    // `<id>.json` and an id carries no dot; every sidecar is `<id>.<kind>.json`
    // or `.json.gz`. Stated this way a sidecar added tomorrow is excluded
    // without anybody remembering to come back here.
    for (const f of ['s1-abc-1.json', 's3-mtqf7tp2-2.json', 's4-mu3l1eg6-15.json', 's1-test-mu8nb1sc-memold.json']) {
      assert.ok(stages.isSetDocument(f), `${f} is a set document and the listing would skip it`);
    }
    for (const f of ['s3-mtqf7tp2-2.funnelrich.json', 's3-abc-1-tally.json.gz', 's3-abc-1-agreed.json.gz',
      's3-abc-1-capture.json.gz', 's3-abc-1-halflife-r1.json.gz', 's3-abc-1-reserve-LTCUSDT.json.gz',
      's3-abc-1.funnelrich.json.v4', 's3-abc-1.funnelrich', 'checkpoints', 's3-abc-1__keptfigs', 'notes.txt']) {
      assert.ok(!stages.isSetDocument(f), `${f} is not a set document and the listing would parse it as one`);
    }
    // AND THE LISTING USES IT, so the rule is not a spare part
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(/fs\.readdirSync\(SETS_DIR\)\.filter\(isSetDocument\)/.test(src),
      'the listing is back to accepting every file that ends in .json');
    // THROUGH THE REAL LISTING, with a real sidecar on disk: it is not listed,
    // and no row comes back without an id. A row with no id is the shape the
    // screens were being handed for three hours.
    fs.mkdirSync(SETS_DIR, { recursive: true });
    const id = `s1-test-${Date.now().toString(36)}-list`;
    const side = path.join(SETS_DIR, `${id}.funnelrich.json`);
    try {
      fs.writeFileSync(path.join(SETS_DIR, `${id}.json`), JSON.stringify({
        id, stage: 1, seq: 999978, name: 'S1 #list', status: 'done', createdAt: new Date().toISOString(), params: {}, plan: { units: 1 },
      }));
      // valid JSON, and NOT a set -- which is exactly why it used to get through
      fs.writeFileSync(side, JSON.stringify({ v: 4, settings: { a: { units: { u0: { x: 1 } } } } }));
      const rows = stages.listSets();
      assert.ok(rows.some((r) => r.id === id), 'the set itself is no longer listed');
      assert.deepStrictEqual(rows.filter((r) => r.id == null), [], 'a sidecar is still being listed as a set with no id');
      assert.deepStrictEqual(rows.filter((r) => String(r.id || '').includes('funnelrich')), [], 'a sidecar is listed under its own name');
    } finally {
      try { fs.rmSync(side, { force: true }); } catch (_) { /* fixture */ }
      rmSet(id);
    }
  },

  // THE FOLD READS THE COMMITTEE SHAPES THE RUN REALLY HOLDS (3.187.0, owner
  // order: "make sure that the stage three launch includes the extras being
  // set"). This was PARKED at 3.184.0 and is closed here.
  //
  // What was wrong. Two agreement shares are one setting when they land on the
  // same rung, and the rung depends on how many members there ARE. The fold
  // read that count off `params.nExtras` -- a number on the stage 3 block that
  // NOTHING EVER SET. It was therefore nought on every run: correct on every
  // set that exists, because none carries an extra, and wrong the first time a
  // stage 3 prices a parent built from a walk set. Two genuinely different
  // settings would have folded into one, silently.
  //
  // It is read off the RECORDS now, as `sizes` always has been. And as PAIRS,
  // not as a cross of two lists: one unit can be a single carrying two extras
  // while the next is a triple carrying none, and a cross would invent a
  // committee shape the run does not hold.
  //
  // THE PRICING WAS NEVER WRONG, only the fold. At pricing time the rung comes
  // from the member list itself (lib/committee.js denomFor), which has always
  // had the extras in it -- so the fault was the cost line and the launch
  // building fewer settings than the units could tell apart, never a trade
  // placed at the wrong bar.
  theFoldCountsTheExtrasTheRecordsActuallyCarry() {
    const cell = { entry: 'market', tHours: 65 };
    const B = { cell, agreeRule: 'count', agreeBar: 'all', agreePermutePct: true };
    // the pairs, off the records, exactly as `sizes` is read
    assert.deepStrictEqual(stages.shapesOf([{ size: 1 }, { size: 1, extras: null }]), [{ size: 1, nExtras: 0, nPlateaus: 0, nLoose: 0, plateauSizes: [] }],
      'two units with no extras are one committee shape');
    assert.deepStrictEqual(stages.shapesOf([{ size: 1 }, { size: 1, extras: [{}, {}] }]),
      [{ size: 1, nExtras: 0, nPlateaus: 0, nLoose: 0, plateauSizes: [] }, { size: 1, nExtras: 2, nPlateaus: 0, nLoose: 2, plateauSizes: [] }], 'a unit carrying extras is its own committee shape');
    assert.deepStrictEqual(stages.shapesOf([{ ctx1: 'A', ctx2: 'B', extras: [{}] }]), [{ size: 3, nExtras: 1, nPlateaus: 0, nLoose: 1, plateauSizes: [] }],
      'a record with no size of its own is read off what it is alongside');
    // 3.205.0: a plateau is one voter per kind however many extras it holds, so
    // nine extras in one plateau are a committee of 8 + 2, not 8 + 18
    const nine = Array.from({ length: 9 }, () => ({}));
    assert.deepStrictEqual(stages.shapesOf([{ size: 1, extras: nine, plateaus: [{ centre: 4, members: [0, 1, 2, 3, 4, 5, 6, 7, 8] }] }]),
      [{ size: 1, nExtras: 9, nPlateaus: 1, nLoose: 0, plateauSizes: [[9, 9]] }], 'a plateau is counted as its nine extras, speaking with nine of each kind');
    assert.deepStrictEqual(stages.shapesOf([{ size: 1, extras: [{}, {}, {}, {}], plateaus: [{ centre: 1, members: [0, 1, 2] }] }]),
      [{ size: 1, nExtras: 4, nPlateaus: 1, nLoose: 1, plateauSizes: [[3, 3]] }], 'an extra outside every plateau is not counted as loose');
    assert.deepStrictEqual(stages.shapesOf([]), [], 'no records is no shapes');
    // AND THE FOLD SEES THEM. A committee of 8 and one of 12 land on different
    // rungs, so shares that folded into one when both were read as 8 no longer do.
    const plain = stages.agreementsFor(B, [1], stages.shapesOf([{ size: 1 }]));
    const withEx = stages.agreementsFor(B, [1], stages.shapesOf([{ size: 1 }, { size: 1, extras: [{}, {}] }]));
    assert.ok(withEx.length > plain.length,
      `a run whose units carry extras folds to ${withEx.length} shares and one whose units do not folds to ${plain.length} — the extras are still invisible to the fold`);
    // NOUGHT IS EXACTLY WHAT IT WAS BEFORE, on every set that exists today
    assert.strictEqual(plain.length, stages.agreementsFor(B, [1]).length, 'a run with no extras no longer folds the way it always has');
    assert.strictEqual(plain.length, stages.agreementsFor(B, [1], []).length, 'no records is read as something other than the sizes given');
    // families counts KINDS of evidence, and an extra is its own kind: its
    // slice is its own and no base member shares it (lib/committee.js reads
    // `families` straight off the member list, which is what this mirrors)
    const F = { cell, agreeRule: 'families', agreeBar: 'all', agreePermutePct: true };
    assert.ok(stages.agreementsFor(F, [1], stages.shapesOf([{ size: 1, extras: [{}] }])).length
      > stages.agreementsFor(F, [1], stages.shapesOf([{ size: 1 }])).length,
      'a member from a walk set is not counted as a kind of evidence of its own');
    // AND EVERY READER OF THE BLOCK IS HANDED THEM -- the cost line, the
    // launch's plan, and both readers of a saved set. A reader left out would
    // build a different number of settings from the one beside it, which the
    // launch refuses on and calls a disagreement.
    //
    // THE FIFTH IS THE QUORUM LINE (3.195.1). The screen used to have the
    // number 8 typed into it, which is wrong on every unit carrying a member
    // from a walk set -- and share is a share of whatever the unit holds, so
    // the screen was saying 50% meant 4 when on the owner's run it meant 5. It
    // is counted now, and counted off THESE shapes on purpose: the fold and the
    // line have to agree, or the screen names one committee and the pricing
    // uses another.
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.strictEqual((src.match(/shapesOf\(/g) || []).length, 5,
      'a reader of the block is not handed the committee shapes, or a sixth reader was added without this test being looked at again');
    assert.ok(/out\.committees = records/.test(src)
      && /shapesOf\(records\)\.map\(\(q\) => votersOf\(q\)\)/.test(src),
      'the quorum line is counted off the same shapes the fold reads, never typed');
    const UI2 = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(!/judged by 8 members/.test(UI2), 'the committee size is typed into the screen again');
    assert.ok(/swSayQuorum\(got\.committees, got\.plateauUnits\)/.test(UI2), 'and the line is written from what the run will hold');
    assert.ok(/const agrees = agreementsFor\(params, sizes, shapesOf\(records\)\);/.test(src), 'the cost line does not read the shapes off its own records');
    assert.ok(/const declaredSettings = settingsFor\(params, sizes, shapesOf\(parentRecords\)\);/.test(src), 'the launch does not build its plan from the shapes it will price');
    assert.ok(/foldSameTradeSettings\(settingsFor\(doc\.params \|\| \{\}, sizes, shapesOf\(parentRecords\)\)/.test(src), 'a paused run started again rebuilds a different block from the one it paused with');
    assert.ok(/foldSameTradeSettings\(settingsFor\(doc\.params \|\| \{\}, sizes, shapesOf\(records\)\)/.test(src), 'a finished set is read back with a different block from the one that priced it');
    assert.ok(!/params\.nExtras/.test(src), 'the block still carries a member count that nothing sets');
  },

  // EVERY UNIT'S COMMITTEE IS ON SCREEN, MEMBER BY MEMBER (3.186.0, owner
  // order: "the extra member details on screen"). RULE ELEVEN clause 3 -- if
  // it is stored, show it. Each of these numbers was already being written on
  // the record and none of it could be seen.
  //
  // Read through a record written exactly as stage 1 writes one, so the reader
  // is held to the shape on disk and not to a shape convenient to the test.
  theCommitteeOfOneUnitIsReadableMemberByMember() {
    const id = `s1-test-${Date.now().toString(36)}-mem`;
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(path.join(SETS_DIR, `${id}.json`), JSON.stringify({
        id, stage: 1, seq: 999981, name: 'S1 #mem', status: 'done', createdAt: new Date().toISOString(),
        params: {}, plan: { units: 1 },
      }));
      const w = rowstore.writer(id, 'records');
      w.push({
        u: 0, trade: 'LTCUSDT', ctx1: null, ctx2: null, size: 1, geometry: 'daily-3d', bandPct: 2.5,
        specs: [{ model: 'logreg', view: 'full', from: 'own' }, { model: 'boost', view: 'prices', from: 'own' },
          { model: 'logreg', view: 'extra0', from: 'extra0', at: 0 }],
        extras: [{ lookbackHours: 720, bandPct: 90, from: { set: 'W-4', name: 'test-walk-4', key: 'k' } }],
        extraBandPcts: [4.2], tooEarly: 6,
        perMember: [{ from: 'own', score: 55.1, beat: 9, deals: 10, lead: 2.2, spoke: 80, chunks: 100, rightWhenSpoke: 44 },
          { from: 'own', score: 51, beat: 5, deals: 10, lead: 0.3, spoke: 20, chunks: 100, rightWhenSpoke: 12 },
          { from: 'extra0', score: 58.9, beat: 10, deals: 10, lead: 3.4, spoke: 12, chunks: 100, rightWhenSpoke: 9 }],
        blocks: {},
      });
      w.close();
      const d = stages.unitMembers(id, 0);
      // THE COUNT IS THE LIST'S LENGTH, never worked out from the combo size
      assert.deepStrictEqual([d.members, d.nExtras, d.tooEarly, d.scored], [3, 1, 6, true], 'the unit does not say what it holds');
      assert.deepStrictEqual([d.trade, d.geometry, d.bandPct], ['LTCUSDT', 'daily-3d', 2.5], 'the unit does not name itself');
      // A MEMBER ADDED FROM A WALK SET IS THE ONE WHOSE SPEC CARRIES A PLACE in
      // the extras list -- read off the record, never from the member's number
      assert.deepStrictEqual(d.rows.map((m) => m.at), [null, null, 0], 'which members came from a walk set is worked out, not read');
      const ex = d.rows[2];
      assert.deepStrictEqual([ex.lookbackHours, ex.bandPct, ex.fromSet], [720, 4.2, 'test-walk-4'],
        'the look-back, the band and the walk set a member came from are not all on screen');
      // THE BAND IS THE ONE IT WAS MARKED AT, which for an extra is the band
      // the unit RESOLVED, not the number the walk row carried
      assert.notStrictEqual(ex.bandPct, 90, 'the extra shows the walk row\'s own number instead of the band the unit resolved');
      // AND BOTH ARE ON SCREEN (3.188.0), because they are not the same thing:
      // 4.2 is the percent of price it was marked at, and 0.90 is the walk's
      // own number -- a MULTIPLE of what the coin usually moves over the window
      // being forecast, which is what the owner ticked. Showing one and not the
      // other hides either what they chose or what it came to, and substituting
      // one for the other is the defect 3.188.0 closes.
      assert.strictEqual(ex.bandTimesUsual, 0.9, 'the walk\'s own number is not on screen beside the percent it worked out to');
      assert.deepStrictEqual(d.rows.slice(0, 2).map((m) => m.bandTimesUsual), [null, null],
        'a member the unit always had is given a multiple it never read');
      const page = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
      assert.ok(/\$\{Number\(m\.bandTimesUsual\)\.toFixed\(2\)\}\\u00d7 usual/.test(page) || page.includes('× usual'),
        'the members table shows the percent and not the multiple the walk found');
      assert.deepStrictEqual(d.rows.slice(0, 2).map((m) => m.bandPct), [2.5, 2.5], 'a member the unit always had is marked at the unit\'s own band');
      // EACH MEMBER READ ON ITS OWN, which is what stops a quiet member hiding
      // inside the pooled number (design section E, and therefore F2)
      assert.deepStrictEqual(d.rows.map((m) => [m.score, m.beat, m.deals, m.lead]),
        [[55.1, 9, 10, 2.2], [51, 5, 10, 0.3], [58.9, 10, 10, 3.4]], 'a member\'s own score and its own deals are not on screen');
      // AND HOW OFTEN IT SPOKE, separately from how it did overall (F3)
      assert.deepStrictEqual(d.rows.map((m) => [m.spoke, m.chunks, m.rightWhenSpoke]),
        [[80, 100, 44], [20, 100, 12], [12, 100, 9]], 'how often a member spoke, and how it did when it spoke, are not on screen');
      assert.strictEqual(stages.unitMembers(id, 7), null, 'a unit number no record carries is answered as though it existed');
      assert.strictEqual(stages.unitMembers('s1-no-such-set', 0), null, 'a record set that is not there is answered as though it were');
      // A SET FINISHED BEFORE PER-MEMBER SCORING SAYS SO rather than drawing a
      // committee of silent members (RULE ELEVEN clause 6)
      const old = `s1-test-${Date.now().toString(36)}-memold`;
      fs.writeFileSync(path.join(SETS_DIR, `${old}.json`), JSON.stringify({
        id: old, stage: 1, seq: 999980, name: 'S1 #memold', status: 'done', createdAt: new Date().toISOString(), params: {}, plan: { units: 1 },
      }));
      const w2 = rowstore.writer(old, 'records');
      w2.push({ u: 0, trade: 'LTCUSDT', ctx1: null, ctx2: null, size: 1, geometry: 'daily-3d', bandPct: 2, specs: [{ model: 'logreg', view: 'full', from: 'own' }], blocks: {} });
      w2.close();
      const o = stages.unitMembers(old, 0);
      assert.deepStrictEqual([o.scored, o.members, o.nExtras], [false, 1, 0], 'a set with no per-member readings does not say so');
      assert.strictEqual(o.rows[0].spoke, null, 'a reading that was never taken is reported as a number');
      rmSet(old);
    } finally { rmSet(id); }
  },

  // AND THE SCREEN DRAWS IT (3.186.0). The press sits in the cell that already
  // holds the head count -- the thing it is about (RULE ELEVEN clause 4) -- on
  // BOTH tables, because a unit has a committee at stage 1 and a bigger one at
  // stage 2 and the owner reads them on the same screen.
  theMembersOfAUnitAreOnBoardsOnBothTables() {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    // the press, in the members cell of each table
    assert.ok(/<td \$\{btdN\}>\$\{bMembersBtn\('S1', r\.u\)\}\$\{r\.members == null \? '—' : r\.members\}<\/td>/.test(src), 'stage 1\'s head count does not open the members');
    assert.ok(/<td \$\{btdN\}>\$\{bMembersBtn\('S2', r\.u\)\}\$\{r\.members\} — \$\{r\.logreg\} LOGREG \+ \$\{r\.boost\} BOOST<\/td>/.test(src), 'stage 2\'s head count does not open the members');
    // AND THE PRESS TAKES NO WORDS WITH IT. A label passed in as an argument is
    // a label the word-list generator cannot see, and LOGREG and BOOST went off
    // the Boards list that way once already (RULE ONE-A: a list with holes is
    // worse than no list).
    assert.ok(/function bMembersBtn\(stage, u\) \{/.test(src), 'the press swallows the cell\'s words again');
    // IT OPENS UNDER THE ROW IT WAS ASKED FROM (3.199.0, owner order: "open up
    // the members immediately below the record it was hit on without moving the
    // parent table"). It used to draw into one slot at the very bottom of the
    // panel, past the table, the paging bar and a paragraph of notes, so
    // pressing + on the fortieth row put the answer off the screen.
    for (const st of ['S1', 'S2']) {
      assert.ok(!src.includes(`<div data-bmempanel="${st}"></div>`), `the ${st} members still open in a slot at the bottom of the panel`);
      assert.ok(src.includes(`await bWireMembers(doc, mount, '${st}');`), `the ${st} table's press is drawn and never wired`);
    }
    // AND THE TABLE IS NOT REDRAWN TO DO IT: one row is put in after the
    // record's own row and taken out again on close, so every other row keeps
    // the DOM node it had and nothing re-renders under the owner.
    const wire = src.slice(src.indexOf('async function bWireMembers(doc, mount, stage) {'),
      src.indexOf('async function bDrawStage1('));
    assert.ok(/const row = btn \? btn\.closest\('tr'\) : null;/.test(wire), 'the panel is not placed against the row it was asked from');
    assert.ok(/row\.after\(holder\);/.test(wire), 'the panel is not put in straight after that row');
    assert.ok(/colspan="\$\{row\.children\.length\}"/.test(wire), 'the panel row is not as wide as the table it sits in');
    assert.ok(/tr\[data-bmemrow="\$\{stage\}"\]/.test(wire), 'the opened row cannot be found again to take it out');
    assert.ok(!/innerHTML = bMembersPanel/.test(wire) || /holder\.innerHTML/.test(wire),
      'the panel is written into a slot rather than into its own row');
    // and closing takes the row out rather than blanking a slot that is gone
    const shut = src.slice(src.indexOf('function bWireMemberClose(doc, mount, stage) {'), src.indexOf('\n}\n', src.indexOf('function bWireMemberClose(doc, mount, stage) {')));
    assert.ok(/querySelectorAll\(`tr\[data-bmemrow=/.test(shut), 'Close still blanks a slot instead of removing the row');
    // ONE OPEN UNIT PER TABLE, so opening one on stage 1 does not close the one
    // open on stage 2
    assert.ok(/const bMemberOpen = \{ S1: null, S2: null \};/.test(src), 'the two tables share which unit is open');
    // EVERY STORED NUMBER HAS A COLUMN. Named as the tables above already name
    // them where the same job is being done (RULE ELEVEN clause 5).
    const panel = src.slice(src.indexOf('function bMembersPanel('), src.indexOf('function bMembersBtn('));
    for (const col of ['>member</th>', '>kind</th>', '>reads</th>', '>look-back</th>', '>band</th>', '>from</th>', '>plateau</th>',
      '>forecast score</th>', '>beat its own null set</th>', '>lead over null set</th>', '>spoke</th>', '>right when it spoke</th>']) {
      assert.ok(panel.includes(col), `the members table has no ${col.replace(/[<>/th]/g, '')} column`);
    }
    // and each one is filled from the answer, not left as decoration
    for (const f of ['m.lookbackHours', 'm.bandPct', 'm.fromSet', 'm.score', 'm.beat', 'm.lead', 'm.spoke', 'm.rightWhenSpoke']) {
      assert.ok(panel.includes(f), `the ${f} column is drawn and never filled`);
    }
    // THE STORED NAME OF WHAT A MEMBER READS IS BESIDE THE PLAIN WORDS, so
    // nothing about the member is hidden (RULE FIVE) and the owner still has
    // something they can point at (RULE ONE)
    assert.ok(/const B_VIEW_WORDS = \{/.test(src) && /pricevol: 'prices and volume'/.test(src), 'what a member reads is shown as a name off no screen');
    assert.ok(/<span class="muted">\(\$\{esc\(String\(m\.view \|\| ''\)\)\}\)<\/span>/.test(panel), 'the stored name is hidden rather than shown beside the words');
    // A SET WITH NO READINGS SAYS SO instead of drawing blank columns
    // ...AND IT SAYS SOMETHING TRUE (3.195.0). It used to say the set was
    // finished before each member was read on its own, which was false of every
    // stage 2 set on the box: the reading WAS taken, and the stage 2 record
    // writer dropped it. A message that explains a shortfall with the wrong
    // reason is worse than a blank column (RULE ELEVEN clause 6).
    assert.ok(/d\.scored \? '' :/.test(panel) && /blank because nothing was stored/.test(panel),
      'a set with no readings draws a committee of silent members');
    assert.ok(!/finished before each member was read on its own/.test(panel),
      'and it still blames a release rather than saying nothing was stored');
    // and the route the page reads it through
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.ok(server.includes("app.get('/api/stageset/:id/unit/:u/members'"), 'there is no way for the page to ask for a unit\'s members');
    assert.ok(/stages\.unitMembers\(req\.params\.id, req\.params\.u\)/.test(server), 'the route does not read the engine\'s own answer');
  },

  // THE READING COMES FROM THE LIST THIS CHAIN TOOK ITS UNITS FROM, AND FROM
  // NO OTHER (3.186.0, owner order: "fix the confirmation greying to check the
  // set's source").
  //
  // What was wrong. The lean was read off whatever Coins held at the moment of
  // the count or the launch, whatever the record set was. Two ways that spent
  // the owner's money on a fact about a different run:
  //
  //   * a set launched with `ignore what is on Coins`, whose coin happened to
  //     be ticked when start was pressed, priced a reading its training had
  //     never met;
  //   * a set launched from a walk set read the OTHER box's reading wherever a
  //     passer held the same coin and chunk shape, because passerLeans gives
  //     the passer the key (lib/coinsrun.js) and nothing downstream knew.
  //
  // Where a chain took its units from is written on its STAGE 1 and nowhere
  // else, so it is found by walking up -- checked here through a real chain on
  // disk, not by handing the function a made-up document.
  theReadingComesFromTheListTheChainTookItsUnitsFrom() {
    const coinsrun = require('../lib/coinsrun');
    const key = 'ZZZTESTUSDT|daily-4d';
    const PASSER = { band: 40, yardstick: 1, rising: 0.6, falling: -0.4, lookback: 'own', from: { source: 'passer' } };
    const WALK = { band: 90, yardstick: 1, rising: 0.9, falling: -0.9, lookback: 720, from: { set: 'W-9', name: 'a walk', key: 'k' } };
    // THE RULE ITSELF, with the two maps in front of it and nothing else in the
    // way. This is the only way to prove the `walk` case: there the walk's
    // reading must win on a coin and chunk shape that the passer holds
    // everywhere else, and no fixture on disk can put the box in that state.
    // 3.206.0 (owner order): COINS LENDS A LEAN TO THE PASSERS ONLY. A walk
    // chain's units carry their plateaus' leans on their own records, so
    // `walk` reads nothing off Coins and `both` is the passers alone.
    assert.strictEqual(coinsrun.pickLeans('passers', { [key]: PASSER })[key].band, 40, 'passers reads the passer');
    assert.deepStrictEqual(coinsrun.pickLeans('walk', { [key]: PASSER }), {}, 'a walk chain still reads a lean off Coins');
    assert.strictEqual(coinsrun.pickLeans('both', { [key]: PASSER })[key].band, 40, 'both is the passers, which is what every set written before the choice priced with');
    assert.deepStrictEqual(coinsrun.pickLeans('none', { [key]: PASSER }), {}, 'a run that read no list carries no reading');
    assert.throws(() => coinsrun.pickLeans('sometimes', {}), /there is no unit source called "sometimes"/, 'a name no screen offers is coerced instead of refused');
    assert.deepStrictEqual(coinsrun.leansFrom('walk'), {}, 'the real reader lends a walk chain a lean');
    // A UNIT WITH A PLATEAU LEANS THE WAY ITS PLATEAU LEANS, off its own record
    const withPlateau = {
      trade: 'ZZZTESTUSDT', geometry: 'daily-4d',
      extras: [
        { lookbackHours: 48, bandPct: 100, from: { set: 'W-9', name: 'nine', key: 'a' }, lean: { rising: -1, falling: 1, yardstick: 3.1 } },
        { lookbackHours: 96, bandPct: 100, from: { set: 'W-9', name: 'nine', key: 'b' }, lean: { rising: -1, falling: 0, yardstick: 4.2 } },
        { lookbackHours: 96, bandPct: 150, from: { set: 'W-9', name: 'nine', key: 'c' }, lean: null },
      ],
      plateaus: [{ centre: 1, members: [0, 1, 2] }],
    };
    const pl = stages.confirmLeansFor([withPlateau], 'walk')[key];
    assert.ok(pl && pl.plateau === true, 'a unit with a plateau is not handed its plateau\'s lean');
    assert.deepStrictEqual(pl.rows.map((r) => [r.lookback, r.band, r.yardstick, r.rising, r.falling, r.key]),
      [[48, 100, 3.1, -1, 1, 'a'], [96, 100, 4.2, -1, 0, 'b']], 'every row of the plateau with a lean, at its own look-back and band; the one without is left out');
    assert.deepStrictEqual(pl.from, { set: 'W-9', name: 'nine', rows: 2, of: 3 });
    assert.deepStrictEqual(stages.confirmLeansFor([{ ...withPlateau, extras: withPlateau.extras.map((e) => ({ ...e, lean: null })) }], 'walk'), {},
      'a plateau whose rows carry no lean is given one');
    // AND THE WIRING: the chain's own source reaches the reader, and nothing
    // else does. Patched at the seam stages.js really calls.
    const wasL = coinsrun.leansFrom;
    const asked = [];
    coinsrun.leansFrom = (src) => { asked.push(src); return src === 'passers' ? { [key]: PASSER } : src === 'both' ? { [key]: PASSER } : {}; };
    const ids = [];
    try {
      const recs = [{ trade: 'ZZZTESTUSDT', geometry: 'daily-4d' }];
      assert.deepStrictEqual(stages.confirmLeansFor(recs, 'walk'), {}, 'a walk chain without a plateau is lent a lean');
      assert.strictEqual(stages.confirmLeansFor(recs, 'passers')[key].band, 40, 'the named source does not reach the reader');
      assert.deepStrictEqual(stages.confirmLeansFor(recs, 'none'), {}, 'a run that read no list carries no reading');
      // AND THE CHAIN ANSWERS FOR ITSELF, walked from the stage 3's parent up
      for (const [source, band] of [['passers', 40], ['walk', null], ['none', null]]) {
        const pid = writeLaunchParent(`src-${source}`, source === 'none' ? null : source);
        ids.push(pid);
        assert.strictEqual(stages.coinsSourceOf(stages.getSet(pid)), source, `a chain whose stage 1 says ${source} is read as something else`);
        const d = stages.stage3Declared({ ...LAUNCH_BLOCK, from: pid, confirm: 'sized' });
        assert.strictEqual(d.leanSource, source, 'the count does not tell the screen which list it looked in');
        assert.strictEqual(d.leanUnits, band == null ? 0 : 1, `the count read the wrong number of units carrying a reading under ${source}`);
      }
      // a set written BEFORE the choice existed, launched from Coins: 'both'
      const old = writeLaunchParent('src-old', null);
      ids.push(old);
      const root = JSON.parse(fs.readFileSync(path.join(SETS_DIR, `${old}.json`), 'utf8'));
      const rid = `s1-test-${Date.now().toString(36)}-old`;
      fs.writeFileSync(path.join(SETS_DIR, `${rid}.json`), JSON.stringify({
        id: rid, stage: 1, seq: 999982, name: 'S1 #old', status: 'done', createdAt: new Date().toISOString(),
        params: { universe: ['ZZZTESTUSDT'], passers: [{ coin: 'ZZZTESTUSDT', geometry: 'daily-4d' }], nullN: 3 }, plan: { units: 1 },
      }));
      root.parent = { id: rid, name: 'S1 #old' };
      fs.writeFileSync(path.join(SETS_DIR, `${old}.json`), JSON.stringify(root));
      assert.strictEqual(stages.coinsSourceOf(stages.getSet(old)), 'both', 'a set launched from Coins before the choice existed read both lists');
      // AND A STAGE 1 THAT EXISTS AND NAMES NEITHER reads as none, not both.
      // This is the commonest chain on the box -- every set launched from the
      // boxes on Sweep -- and reading it as 'both' would price a lean it never
      // met. Separate from the case above, where there is no stage 1 at all.
      const bare = writeLaunchParent('src-bare', null);
      ids.push(bare);
      const bDoc = JSON.parse(fs.readFileSync(path.join(SETS_DIR, `${bare}.json`), 'utf8'));
      const bid = `s1-test-${Date.now().toString(36)}-bare`;
      fs.writeFileSync(path.join(SETS_DIR, `${bid}.json`), JSON.stringify({
        id: bid, stage: 1, seq: 999979, name: 'S1 #bare', status: 'done', createdAt: new Date().toISOString(),
        params: { universe: ['ZZZTESTUSDT'], nullN: 3 }, plan: { units: 1 },
      }));
      bDoc.parent = { id: bid, name: 'S1 #bare' };
      fs.writeFileSync(path.join(SETS_DIR, `${bare}.json`), JSON.stringify(bDoc));
      assert.strictEqual(stages.coinsSourceOf(stages.getSet(bare)), 'none',
        'a stage 1 that took its units from the boxes is read as one that read a list off Coins');
      assert.deepStrictEqual(stages.stage3Declared({ ...LAUNCH_BLOCK, from: bare, confirm: 'sized' }).leanUnits, 0,
        'a chain built from the boxes still finds a reading to price');
      assert.deepStrictEqual(asked, ['walk', 'passers', 'none', 'passers', 'walk', 'none', 'none'],
        'the count asked a list the chain did not name, or failed to ask the one it did');
    } finally {
      coinsrun.leansFrom = wasL;
      for (const id of ids) cleanLaunchParent(id);
    }
  },

  // AND THE SCREEN SAYS WHY IT IS GREYED, in three different sentences
  // (3.186.0). "Greyed" on its own sends the owner to tick rows that a chain
  // built from the boxes will never read, which is RULE ELEVEN clause 6: a
  // message that papers over a shortfall instead of naming it.
  theGreyedConfirmationSaysWhichListItLookedIn() {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(/swSayWhyNoConfirm\(noLean \? got\.leanSource : null\);/.test(src), 'the reason is not said beside the greying');
    assert.ok(/<p class="note warn" id="swWhyConfirm"/.test(src), 'there is nowhere on the screen for the reason to appear');
    const words = src.slice(src.indexOf('const SW_NO_CONFIRM = {'), src.indexOf('function swSayWhyNoConfirm('));
    for (const k of ['none:', 'passers:', 'walk:', 'both:']) assert.ok(words.includes(k), `no sentence for ${k}`);
    // the one that cannot be fixed by ticking says so, and does not send them off to tick
    const none = words.slice(words.indexOf('none:'), words.indexOf('passers:'));
    assert.ok(/Ticking rows on Coins will not change that/.test(none), 'the one reason a tick cannot fix does not say so');
    // each of the other two names the box it looked in, as Coins draws it
    assert.ok(/ticked under coins and shapes that pass on Coins/.test(words) && /ticked from a walk set on Coins/.test(words),
      'the two that name a box do not name it as Coins draws it');
    // and the service hands the screen the answer it needs to choose between them
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.ok(/leanSource: d\.leanSource \|\| null/.test(server), 'the count route does not hand the screen which list it looked in');
  },

  // THE TALLY CARRIES THE LEAN AND THE VERDICT (3.130.0): per setting, from
  // the six numbers summed over every coin; per coin, from the records under
  // it that carried a lean. The words come from the one rule in lib/confirm.js
  // and are held to it here by hand.
  async theTallyCarriesTheLeanAndTheVerdictPerSettingAndPerCoin() {
    const C = require('../lib/confirm');
    const id = `s3-test-${Date.now().toString(36)}-lean`;
    try {
      // the set itself, so the ranked table and its saved sort can be read
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(path.join(SETS_DIR, `${id}.json`), JSON.stringify({
        id, stage: 3, seq: 999986, name: 'S3 #lean', status: 'done', createdAt: new Date().toISOString(),
        plan: { units: 1, settings: 2 }, params: { nullN: 3 }, recordsVersion: stages.RECORDS_V,
      }));
      const w = rowstore.writer(id, 'records');
      const mk = (si, label, trade, confirm, lean, verdict, test = 10) => ({
        si, label, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
        entry: 'market', gate: null, dMult: null, tHours: 65, trailMult: null, armMult: null,
        quorum: 2, members: 6, pnl: test, trades: 3,
        holdout: { pnl: 1, trades: 4, stops: 1, vsAlwaysLong: 0 },
        beat: 1, pairs: 3, lead: null, u: 0, trade, ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
        confirm, lean, verdict,
      });
      const partsA = { c: { pnl: 8, n: 4 }, u: { pnl: -3, n: 3 }, z: { pnl: 1, n: 1 } };   // better signal on its own
      const partsB = { c: { pnl: 4, n: 4 }, u: { pnl: 3, n: 3 }, z: { pnl: 1, n: 1 } };    // just leverage on its own
      w.push(mk(0, 'q x \u00b7 argmax auto 24/7 \u00b7 sized \u00d72/\u00d71', 'AAA', 'sized',
        { kx: 2, ux: 1, test: partsA, testSize: 8 + 3 + 1, hold: null, holdSize: null }, { test: C.verdictOf(partsA, 2, 1), hold: null }));
      w.push(mk(0, 'q x \u00b7 argmax auto 24/7 \u00b7 sized \u00d72/\u00d71', 'BBB', 'sized',
        { kx: 2, ux: 1, test: partsB, testSize: 8 + 3 + 1, hold: null, holdSize: null }, { test: C.verdictOf(partsB, 2, 1), hold: null }));
      // the same setting at off on a third coin: no lean, no word
      w.push(mk(1, 'q x \u00b7 argmax auto 24/7', 'AAA', 'off', null, null));
      w.close();
      const tally = await stages.buildTally({ id });
      const r0 = tally.ranked.find((r) => r.si === 0);
      const r1 = tally.ranked.find((r) => r.si === 1);
      assert.deepStrictEqual([r0.confirm, r0.kx, r0.ux], ['sized', 2, 1], 'the dial and its multipliers ride the ranked row');
      assert.deepStrictEqual(r0.lean, C.addParts(C.addParts(null, partsA), partsB), 'the six numbers summed over the coins');
      // by hand: c 12 of 8, u 0 of 6, z 2 of 2. At size 1: 14 over 16. Sized:
      // 24 + 0 + 2 = 26 over 16 + 6 + 2 = 24. More money, more per unit of
      // size, and the confirmed trades make 1.5 each against 0 and 1.
      assert.strictEqual(r0.verdict, 'better signal');
      assert.strictEqual(C.verdictOf(r0.lean, 2, 1), 'better signal', 'and it is the one rule\'s word');
      assert.deepStrictEqual([r1.confirm, r1.lean, r1.verdict], ['off', null, null], 'off carries no lean and no word');
      const kA = tally.coins.find((k) => k.trade === 'AAA' && k.cellLabel === 'q x' && k.confirm === 'sized');
      const kB = tally.coins.find((k) => k.trade === 'BBB');
      assert.strictEqual(kA.verdict, 'better signal', 'coin AAA: its one record with a lean');
      assert.strictEqual(kB.verdict, 'just leverage', 'coin BBB: doubling trades that make the same per trade as the rest');
      assert.deepStrictEqual(kA.lean, { test: partsA, hold: null }, 'the per-coin row keeps the six numbers it judged');
      // ONE COIN ROW PER VALUE OF CONFIRM (3.131.0). The off record and the
      // sized record of the same short setting were once summed under one coin
      // row, which judged the sum of both by the first row's multipliers.
      assert.strictEqual(kA.rows, 1, 'the sized record alone is under the sized coin row');
      const kOff = tally.coins.find((k) => k.trade === 'AAA' && k.cellLabel === 'q x' && k.confirm === 'off');
      assert.ok(kOff && kOff !== kA, 'the off record of the same coin and short setting is not its own row');
      assert.deepStrictEqual([kOff.rows, kOff.lean, kOff.verdict], [1, null, null], 'the off row carries a lean or a word');
      assert.deepStrictEqual([kA.confirm, kA.kx, kA.ux], ['sized', 2, 1], 'the coin row does not say which value of confirm it is');
      // and the tables sort by the word in its written order, best first
      const byVerdict = stages.stage3Coins(id, { sort: 'verdict' });
      assert.deepStrictEqual(byVerdict.rows.map((r) => r.verdict), ['better signal', 'just leverage', null], 'best word first, a row with none last');
      const turned = stages.stage3Coins(id, { sort: 'verdict', flip: '1' });
      assert.deepStrictEqual(turned.rows.map((r) => r.verdict), [null, 'just leverage', 'better signal']);
      // and by the dial's own written order: off, confirmed only, sized
      assert.deepStrictEqual(stages.stage3Coins(id, { sort: 'confirm' }).rows.map((r) => r.confirm), ['off', 'sized', 'sized'], 'confirm does not sort in the dial\'s written order');
      stages.setSetSort(id, [{ key: 'verdict', dir: 'desc' }]);
      assert.deepStrictEqual(stages.stage3Ranked(id, 0, 10).rows.map((r) => r.verdict), ['better signal', null], 'a row with no word sits last');
      // the sharded fold gives the same words
      const sw = require('../lib/stagework');
      const acc = sw.newTallyAcc();
      for (const r of rowstore.readAll(id, 'records').map((x) => x.row || x)) sw.tallyFold(acc, r, 0);
      const s0 = acc.perSetting.get(0);
      assert.strictEqual(sw.verdictOfCells([...s0.perCoin.values()], s0), 'better signal');
      assert.strictEqual(sw.verdictOfCoin([...acc.perCoin.values()].find((k) => k.trade === 'AAA' && k.cellLabel === 'q x' && k.confirm === 'sized')), 'better signal');
      assert.strictEqual(sw.verdictOfCoin([...acc.perCoin.values()].find((k) => k.trade === 'BBB')), 'just leverage');
      assert.strictEqual(sw.verdictOfCoin(null), null, 'no coin, no word');
    } finally {
      try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(path.join(SETS_DIR, `${id}-tally.json.gz`), { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(path.join(SETS_DIR, `${id}-agreed.json.gz`), { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(path.join(SETS_DIR, `${id}.json`), { force: true }); } catch (_) { /* fixture */ }
    }
  },

  // THE WORKER PRICES EVERY WINDOW THROUGH THE LEAN SPLIT (3.130.0), read from
  // the source because s3UnitTask cannot run without a real unit: the real
  // test window, its kept scrambles, the held-back window, its kept scrambles
  // and the null-set deals all go through the one function, and nothing in
  // the task calls the simulator directly any more.
  async theWorkerPricesEveryWindowThroughTheLeanSplit() {
    const sw = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    const task = sw.slice(sw.indexOf('async function s3UnitTask(task) {'), sw.indexOf('\n}\n', sw.indexOf('async function s3UnitTask(task) {')));
    // the one direct call left is Tune's per-trade capture (3.92.0), which
    // prices each entry on its own -- at the size the field or the lean gave
    // it since 3.235.0, where before it was size 1 and carried neither
    // two simulators in the task since 3.212.0: the lean split's and the field
    // gate's, both inside the pricers; nothing prices a window beside them
    assert.strictEqual(task.split('bracketLib.simCell(').length - 1, 2, 'the task must not price a window beside the lean split and the field gate');
    assert.strictEqual(task.split('priceOn(').length - 1, 5, 'every window goes through the one chooser between the lean split and the field gate: five windows');
    assert.ok(task.includes('const one = bracketLib.simCell(cell, [chunksArr[i]], [call], tradeMap, geo, bandPct, fee, undefined, [size]);'), 'and that one call is the per-trade capture, each trade at its own size (3.235.0)');
    const st = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(st.includes('    lean: leanOf((doc.params || {}).confirmLeans, rec),'), 'every unit is handed the lean the set wrote for it');
    assert.strictEqual(task.split('priceLean(cell,').length - 1, 1, 'the lean split is reached only through the chooser');
    // 3.206.0: the lean is folded per setting at its plateau share, so each window asks for it by share
    assert.ok(task.includes("const tPriced = priceOn(testChunks, tIdx, testCallsAll, maps.trade, 'test', true);"), 'the real test window asks for the rich pass');
    assert.ok(task.includes("const hPriced = priceOn(holdChunks, hIdx, holdCallsAll, holdTrade, 'hold', true);"), 'so does the real held-back window');
    assert.ok(task.includes("priceOn(testChunks, tIdx, dt, maps.trade, 'test', false).res"), 'the kept scrambles skip it');
    assert.ok(task.includes("confirm: st.confirm || 'off',") && task.includes('lean: tPriced.parts ? {') && task.includes('verdict: tPriced.parts ? {'),
      'every record carries the dial, and a record with a lean carries its six numbers and its word');
    // the signs come from the same arithmetic Coins reads the windows with
    // 3.171.0: AND AT THE LEAN'S OWN LOOK-BACK. windowMoves has taken a list of
    // look-backs since 2026-09-17 and this called it with none, so every lean
    // coloured its windows at the chunk shape's own span -- 24 hours on Daily
    // 1-day -- while the walk found coins alive at 240 and above.
    // 3.206.0: the lean is a LIST of rows -- one for a passer, every row of the
    // plateau for a walk-set unit -- each read at its own look-back, band and
    // yardstick, then folded at the setting's plateau share
    assert.ok(task.includes('const wm = windowLib.windowMoves(tradeMap, geometry, backs);')
      && task.includes('windowLib.readingsUnderBand(series, row.band, row.yardstick)'),
      'the lean is read at each row\'s band, at its own yardstick, and at ITS OWN LOOK-BACK, by the one window arithmetic (lib/windowmove.js), not a copy of it');
    assert.ok(task.includes("const backOf = (row) => (row.lookback == null || row.lookback === 'own' ? null : Number(row.lookback));"),
      "and `own` is a real value here -- the shape's own span -- so a lean that names no look-back reads exactly as it always did");
    assert.ok(task.includes("const leanRows = task.lean ? (Array.isArray(task.lean.rows) ? task.lean.rows : [task.lean]) : [];"),
      'a passer\'s one lean and a plateau\'s rows are not read through the one list');
    assert.ok(task.includes("if (!foldedLean.has(key)) foldedLean.set(key, confirmLib.foldLeanSigns(rows, pct));"),
      'the plateau\'s rows are not folded through the confirmation library\'s own fold');
    assert.ok(!/require\('\.\/coins'\)/.test(sw), 'the worker must not reach lib/coins.js: through the vocabulary it would reach the orchestrator');
    const fn = sw.slice(sw.indexOf('function priceLeanWindow('), sw.indexOf('function partsCents('));
    assert.ok(fn.includes("if (!signs || confirm === 'off') return { res: bracketLib.simCell(cell, ch, calls, tradeMap, geo, bandPct, fee), parts: null };"),
      'off and no lean price exactly as before this release');
  },

  // THE SCREENS (3.130.0): the dial and its two boxes on Sweep, sent with the
  // block and greyed off the count; the two columns on Boards' Table 3.A and
  // the one on Table 3.B, each cell drawn from the engine's word.
  async theConfirmDialIsOnSweepAndItsVerdictOnBoards() {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const screens = require('../lib/screencontrols');
    const sweep = screens.drawBody('drawSweep');
    for (const piece of ['<div id="swGrpConfirm"', '>confirm<select id="swConfirm">${vocabOptions(\'confirm\', \'off\')}</select></label>',
      '<input type="checkbox" id="swPermConfirm"> permute', '>confirmed \u00d7<input id="swConfirmedX" type="number" value="2" min="0"',
      '>unconfirmed \u00d7<input id="swUnconfirmedX" type="number" value="1" min="0"']) {
      assert.ok(sweep.includes(piece), `Sweep must draw: ${piece}`);
    }
    assert.ok(/confirm: \$\('#swConfirm'\)\.value, permuteConfirm: \$\('#swPermConfirm'\)\.checked,\s*confirmedX: \$\('#swConfirmedX'\)\.value, unconfirmedX: \$\('#swUnconfirmedX'\)\.value,/.test(src),
      'the block sends the dial, its permute and the two boxes');
    assert.ok(src.includes("const noLean = Array.isArray(got.unitSettings) && got.unitSettings.length > 0 && !got.leanUnits;") && src.includes("swGhostGroup('#swGrpConfirm', noLean);"),
      'the dial is greyed when the count says no unit being priced carries a lean');
    assert.ok(src.includes("setV('#swConfirm', p.confirm || 'off'); setC('#swPermConfirm', p.permuteConfirm);"), 'a set\'s boxes fill the dial back in');
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.ok(server.includes('leanUnits: d.leanUnits == null ? null : d.leanUnits, confirmWanted: !!d.confirmWanted'), 'the count route hands the screen the lean count');
    const boards = screens.drawBody('drawBoards');
    for (const piece of [">confirm${bRankSortBtn(doc, 'confirm', 'asc')}</th>", ">confirm verdict${bRankSortBtn(doc, 'verdict', 'desc')}</th>",
      '${bConfirm(r)}</td>', ">confirm verdict${bCoinSortBtn(view, 'verdict', '\u2193')}</th>",
      "<td ${btd}>${bVerdict(r.verdict, r.lean ? r.lean.test : null, r.confirm, r.kx, r.ux)}</td>"]) {
      assert.ok(boards.includes(piece), `Boards must draw: ${piece}`);
    }
    // 3.131.0: each hands the word its six numbers, and the records under a row have their own two verdict cells
    assert.strictEqual(boards.split('${bVerdict(r.verdict, ').length - 1, 2, 'a verdict cell on Table 3.A and one on Table 3.B');
    const cell = src.slice(src.indexOf('function bVerdict(word, parts = null, confirm = null, kx = null, ux = null) {'), src.indexOf('function bRankSortBtn('));
    assert.ok(cell.includes('VOCAB.confirmVerdict') && cell.includes('title="${esc(hit.why)}"'), 'the hover on the word is the engine\'s own reason');
    // the sorts the screen offers are sorts the service implements
    const keys = require('../lib/stages');
    assert.ok(keys.S3_SORTS.includes('verdict'), 'Table 3.B sorts by the word');
    assert.doesNotThrow(() => keys.validateSort(3, [{ key: 'verdict', dir: 'desc' }]));
    assert.doesNotThrow(() => keys.validateSort(3, [{ key: 'confirm', dir: 'asc' }]));
  },

  // THE FORECAST SCORE SAYS WHAT IT IS OUT OF (3.130.1, owner order: "make a
  // slash and then the denominator ... and then a space and a percentage in
  // parenthesis"). The sum alone cannot be read: a unit with more test chunks
  // scores higher for the same skill. The count is on every record already,
  // so the table serves it and the cell divides on the fly.
  async theForecastScoreShowsItsDenominatorAndShare() {
    const id = `s1-test-${Date.now().toString(36)}-fs`;
    const file = path.join(SETS_DIR, `${id}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ id, stage: 1, seq: 999980, name: 'S1 #fs', status: 'done', createdAt: new Date().toISOString(), plan: { units: 2 }, params: { nullN: 4, fee: 0.00125 } }));
      const rec = rowstore.writer(id, 'records');
      rec.push({ u: 0, trade: 'C0', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', bandPct: 2, counts: { train: 900, test: 200, hold: 200 }, specs: [], score: 180, beat: 4, pairs: 4, lead: 2, nullScores: [], blocks: {} });
      rec.push({ u: 1, trade: 'C1', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', bandPct: 2, counts: {}, specs: [], score: 9, beat: 2, pairs: 4, lead: 1, nullScores: [], blocks: {} });
      rec.close();
      const rk = rowstore.writer(id, 'ranking');
      rk.push({ rank: 1, u: 0, beat: 4, pairs: 4, lead: 2, score: 180 });
      rk.push({ rank: 2, u: 1, beat: 2, pairs: 4, lead: 1, score: 9 });
      rk.close();
      const rows = stages.stage1Table(id, 0, 10).rows;
      assert.deepStrictEqual(rows.map((r) => [r.trade, r.score, r.testChunks]), [['C0', 180, 200], ['C1', 9, null]],
        'the test chunk count rides on the row off the record\'s counts; a record without one reads blank');
    } finally {
      try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
    }
    // the cell, run exactly as the screen runs it
    const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const at = src.indexOf('function bForecastScore(score, n) {');
    assert.ok(at > 0, 'the cell helper is gone');
    const fn = new Function(`${src.slice(at, src.indexOf('\n}\n', at) + 3)}; return bForecastScore;`)();
    assert.strictEqual(fn(180, 200), '180.0 / 200 (90.0%)', 'the sum, a slash, the count, and the share in brackets');
    assert.strictEqual(fn(66.6667, 200), '66.7 / 200 (33.3%)', 'a third on everything reads 33.3%');
    assert.strictEqual(fn(9, null), '9.0', 'no count on the record: the sum alone, never a made-up share');
    assert.strictEqual(fn(9, 0), '9.0', 'a count of nothing is no denominator');
    assert.strictEqual(fn(null, 200), '\u2014');
    assert.ok(src.includes('<td ${btdN}>${bForecastScore(r.score, r.testChunks)}</td>'), 'the stage 1 table draws the score through the helper');
    assert.ok(/title="the sureness the pooled votes placed on what actually happened, summed over the test window; then a slash and how many test chunks/.test(src),
      'the heading says what the three parts of the cell are');
  },

  // A SET LAUNCHED FROM THE COINS LIST IS HELD UP TO THE TICK, NOT TO THE
  // GREYED BOXES (3.130.3, owner order: "fix it so the tick is compared
  // instead"). Under "only what is ticked on Coins" the launch
  // never reads trade coins or chunk shape, so comparing them painted Stage 2
  // red for ever. Read from the source, the way the chain routine's own test
  // reads it, plus the launch's record and the route that hands the screen
  // the pairs ticked now.
  // A NEW STAGE 1 TAKES THE STAGE 2 HEADING OFF GREEN (3.196.0, owner order:
  // "as soon that start stage 1 begins the stage 2 sweep is no longer of that
  // provenance, so turn it red").
  //
  // Stage 1 has no picker, so "the section above" used to mean its boxes and
  // nothing else -- and a new stage 1 run launched from the same boxes moved
  // none of them. Two greens went on saying the chain was linked while stage 1
  // had moved to a set the stage 2 box had never heard of.
  //
  // THE REDUCER IS RUN, NOT READ. It is lifted out of the file by its own text
  // and exercised, so this cannot pass against a line that says the right words
  // and picks the wrong set.
  theStageTwoHeadingGoesRedWhenANewerStageOneExists() {
    const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    // ONE FUNCTION SAYS WHAT A SECTION IS SHOWING (3.209.0), lifted out by its
    // own text and run, so this cannot pass against words that pick the wrong set
    const m = /\n  function swShownSet\(sets, stage, name\) \{\n([\s\S]*?)\n  \}\n/.exec(UI);
    assert.ok(m, 'the page no longer works out which set a stage section is showing');
    // eslint-disable-next-line no-new-func
    const shown = new Function('sets', 'stage', 'name', m[1]);
    const newest = (sets) => shown(sets, 1, '');

    const at = (d) => `2026-09-${d}T00:00:00.000Z`;
    const s1a = { id: 's1-a', stage: 1, name: 'S1 #1', status: 'done', createdAt: at('18') };
    const s1b = { id: 's1-b', stage: 1, name: 'S1 #2', status: 'done', createdAt: at('19') };
    const s1run = { id: 's1-c', stage: 1, name: 'S1 #3', status: 'running', createdAt: at('20') };
    const s2 = { id: 's2-a', stage: 2, name: 'S2 #1', status: 'done', createdAt: at('19') };
    const s2b = { id: 's2-b', stage: 2, name: 'S2 #2', status: 'done', createdAt: at('20') };
    const s2run = { id: 's2-c', stage: 2, name: 'S2 #3', status: 'running', createdAt: at('21') };

    assert.strictEqual(newest([s1a, s2]).id, 's1-a', 'with one stage 1 set it is the one being shown');
    assert.strictEqual(newest([s1a, s1b, s2]).id, 's1-b', 'a newer stage 1 set is what the section shows');
    assert.strictEqual(newest([s1b, s1a]).id, 's1-b', 'and the order the list arrives in does not decide it');
    // A RUNNING ONE COUNTS. The owner's words are "as soon that start stage 1
    // BEGINS" -- the set exists from the press, and that is when the older
    // pairing stops being what stage 1 is showing.
    assert.strictEqual(newest([s1a, s1b, s1run]).id, 's1-c', 'a stage 1 run that has begun is what the section is showing');
    assert.strictEqual(newest([s2]), null, 'with no stage 1 set there is nothing being shown');
    // and a stage 2 set is never mistaken for one
    assert.strictEqual(newest([s2, s1a]).id, 's1-a', 'only stage 1 sets are looked at');

    // THE NAME BOX POINTS (3.209.0, owner order: "if that copy settings button
    // is used on BOTH then they should BOTH be green"). Copy settings into the
    // form puts the set's name in the section's name box, and a section whose
    // name box names a set of its own stage is showing THAT set, however many
    // newer ones exist. Blank, or a name that is no set yet, falls back to the
    // newest — the run about to be started.
    assert.strictEqual(shown([s1a, s1b, s1run], 1, 'S1 #1').id, 's1-a', 'the set named in the name box is what the section shows, newer sets or not');
    assert.strictEqual(shown([s1a, s1b, s1run], 1, '  S1 #1 ').id, 's1-a', 'the name is read trimmed');
    assert.strictEqual(shown([s1a, s1b, s1run], 1, 'S1 #9').id, 's1-c', 'a name that is no set yet falls back to the newest');
    assert.strictEqual(shown([s1a, s2], 1, 'S2 #1').id, 's1-a', "a stage 2 set's name never makes the stage 1 section show it");
    assert.strictEqual(shown([s2, s2b, s2run], 2, 'S2 #1').id, 's2-a', 'and the stage 2 section reads its own name box the same way');
    assert.strictEqual(shown([], 1, 'S1 #1'), null, 'with no set at all there is nothing being shown');

    // THE HEADING ACTS ON IT, and says how to go green — which is NOT "set the
    // boxes back": the way back is to choose the newer set, or to put the
    // named set's name in the name box, which is what the copy does.
    const fn = UI.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const body = fn.slice(fn.indexOf('function swProvenance() {'), fn.indexOf('\n}\n', fn.indexOf('function swProvenance() {')));
    assert.ok(/const s1Shown = swShownSet\(sets, 1, v\('#swName1'\)\);/.test(body),
      'the stage 1 section does not read its own name box to say what it is showing');
    assert.ok(/const s2Shown = swShownSet\(sets, 2, v\('#swName2'\)\);/.test(body),
      'the stage 2 section does not read its own name box to say what it is showing');
    assert.ok(/or put \$\{s1row\.name\} in the stage 1 name box/.test(body) && /or put \$\{s2row\.name\} in the stage 2 name box/.test(body),
      'the red line does not say that the name box is a way back');
    assert.ok(/else if \(s1Shown && s1Shown\.id !== s1row\.id\) \{/.test(body),
      'the heading does not act on a stage 1 set newer than the one its box names');
    assert.ok(/paint\('#swH2', false,/.test(body) && /Choose \$\{s1Shown\.name\} here and this goes green again/.test(body),
      'it goes red and names the set to choose');
    assert.ok(/sayWhy\('#swWhy2', \{[\s\S]*?say:/.test(body),
      'and it says why on the screen, not only in a hover');
    assert.ok(/const made = s1Shown\.status === 'done' \? 'has since made' : 'is making';/.test(body),
      'a run still going is described as going, not as finished');

    // AND STAGE 3 THE SAME WAY (3.197.0, owner order: "fix stage 3 the same
    // way"). Stage 3 asked only whether the stage 2 set it names came out of
    // the stage 1 set in the stage 2 box -- make a SECOND stage 2 from that
    // same stage 1 and that answers yes, so stage 3 stayed green while the
    // section above had moved on. The reducer is run here too.
    const newest2 = (sets) => shown(sets, 2, '');
    assert.strictEqual(newest2([s1a, s1b, s2]).id, 's2-a', 'only stage 2 sets are looked at');
    assert.strictEqual(newest2([s2, s2b]).id, 's2-b', 'a newer stage 2 set is what the section shows');
    assert.strictEqual(newest2([s2b, s2, s2run]).id, 's2-c', 'a stage 2 run that has begun is what the section is showing');
    assert.strictEqual(newest2([s1a]), null, 'with no stage 2 set there is nothing being shown');
    assert.ok(/else if \(!cont && s2Shown && s2Shown\.id !== s2row\.id\) \{/.test(body),
      'the stage 3 heading does not act on a stage 2 set newer than the one its box names');
    // A PAUSED RUN IS NOT OVERTAKEN. It was priced from its own parent and
    // carrying on builds nothing from stage 2, so there is no other set to
    // point it at -- reddening it would be a colour with no way back.
    assert.ok(/else if \(!cont &&/.test(body),
      'a paused stage 3 run is reddened by a newer stage 2 it can never be pointed at');
    assert.ok(/Choose \$\{s2Shown\.name\} here and this goes green again/.test(body),
      'the stage 3 red does not name the set to choose');

    // AND LOADING A SET'S SETTINGS BACK SETS THE COLOURS AGAIN (3.197.0, owner:
    // "if we load the settings from a sweep on boards back to the set on sweep
    // the colors should be set again properly of course").
    //
    // Copy settings into the form writes straight into the boxes, which fires
    // no change, so none of the wiring behind them ran. Three holes, one cause:
    // the three choices were left wherever they were, so a set run from a walk
    // set loaded as though it had been run from the boxes; the greyed boxes
    // still matched the source selected BEFORE the load; and the colours stayed
    // as they were until the four-second poll quietly corrected them.
    const fill = UI.slice(UI.indexOf('function fillStageForm(doc) {'), UI.indexOf('\n}\n', UI.indexOf('function fillStageForm(doc) {')));
    assert.ok(/const srcBox = \{ none: '#swSourceOff', passers: '#swSourcePass', walk: '#swSourceWalk' \}\[src\] \|\| null;/.test(fill),
      'the load does not put back where the run took its units from');
    assert.ok(/if \(srcBox\) setC\(srcBox, true\);/.test(fill),
      'a source the screen has no control for is forced to the nearest one rather than left alone');
    assert.ok(/setC\('#swPlainUnits', p\.plainUnits === true\);/.test(fill),
      'the load does not put back whether the run was the control arm');
    for (const call of ['swPassersGrey();', 'swProvenance();', 'swCounts();']) {
      assert.ok(fill.includes(call), `the load does not settle the screen: ${call} is not called after it`);
    }
    // AND THE NAME RIDES WITH THE COPY, ON EVERY STAGE (3.209.0, owner order:
    // "the settings INCLUDING the name must be loaded to the appropriate Sweep
    // section"). Each stage's block fills its own name box and no other.
    const blockOf = (n) => fill.slice(fill.indexOf(`doc.stage === ${n}`), n < 3 ? fill.indexOf(`doc.stage === ${n + 1}`) : fill.length);
    for (const n of [1, 2, 3]) {
      assert.ok(blockOf(n).includes(`setV('#swName${n}', doc.name || '');`), `a stage ${n} set's copy does not carry its name into the stage ${n} name box`);
      for (const other of [1, 2, 3].filter((x) => x !== n)) {
        assert.ok(!blockOf(n).includes(`#swName${other}`), `a stage ${n} set's copy must leave the stage ${other} name box alone`);
      }
    }
  },

  // THE SPLIT FOR EXTRA MEMBERS STARTS GHOSTED AFTER A LOAD (3.209.1, owner:
  // "when the settings for a stage one section of sweep are loaded from
  // boards and the checkbox 'leave the extra members out' is set, the 'split
  // for extra members' should START ghosted, not be selectable until that
  // checkbox is unchecked and rechecked").
  //
  // The greying lived as a const inside drawSweep, and fillStageForm called
  // it from module scope -- a call to a name that is not in scope, which
  // throws, so after a load nothing past the boxes ran: no greying, no
  // colours, no counts, until the poll or a tick came round. A source scan
  // saw the call and could not see the scope. This test RUNS the load
  // against stub boxes and reads the box's state.
  theSplitForExtraMembersStartsGhostedAfterALoadWithTheControlArmOn() {
    const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(/\nfunction swPassersGrey\(\) \{/.test(UI), 'the greying is not a function of the page — a load from Boards cannot reach a const inside drawSweep');
    assert.ok(!/const swPassersGrey = /.test(UI), 'the greying is declared twice');
    const lift = (start, end, tail) => { const at = UI.indexOf(start); assert.ok(at >= 0, `${start} is not on the page`); return UI.slice(at, UI.indexOf(end, at) + tail); };
    const src = [
      lift('const swSourceNow = () => {', '\n};\n', 4),
      lift('function swPassersGrey() {', '\n}\n', 3),
      lift('function fillStageForm(doc) {', '\n}\n', 3),
    ].join('\n');
    const page = () => {
      const els = new Map();
      const $ = (sel) => { const id = String(sel).replace(/^#/, ''); if (!els.has(id)) els.set(id, { id, value: '', checked: false, disabled: false }); return els.get(id); };
      for (const [id, value] of [['swSourceOff', 'none'], ['swSourcePass', 'passers'], ['swSourceWalk', 'walk']]) $(`#${id}`).value = value;
      return $;
    };
    // eslint-disable-next-line no-new-func
    const load = new Function('$', 'rememberSweepForm', 'swProvenance', 'swCounts', 'doc', `${src}\nfillStageForm(doc);`);
    const settled = { remembered: 0, painted: 0, counted: 0 };
    const run = ($, params) => load($, () => { settled.remembered++; }, () => { settled.painted++; }, () => { settled.counted++; },
      { stage: 1, name: 'S1 #x', desc: '', params: { coinsSource: 'walk', sizes: { singles: true }, universe: ['LTCUSDT'], ...params } });
    let $ = page();
    run($, { plainUnits: true });
    assert.strictEqual($('#swPlainUnits').checked, true, 'the fixture is wrong if the control arm did not load');
    assert.strictEqual($('#swExtraShare').disabled, true, 'split for extra members must START ghosted after a load with leave the extra members out ticked');
    assert.strictEqual($('#swPlainUnits').disabled, false, 'the control arm tick itself is live under the walk set');
    assert.deepStrictEqual(settled, { remembered: 1, painted: 1, counted: 1 }, 'the load must settle the screen: remember, colours, counts — all three, after the boxes');
    $ = page();
    run($, { plainUnits: false });
    assert.strictEqual($('#swExtraShare').disabled, false, 'with the control arm off, the split box is live');
    $ = page();
    run($, { coinsSource: 'passers', plainUnits: false });
    assert.strictEqual($('#swExtraShare').disabled, true, 'under coins and shapes that pass the split box is ghosted');
    assert.strictEqual($('#swPlainUnits').disabled, true, 'and so is the control arm tick');
  },
  theStageHeadingsCompareTheTickForASetLaunchedFromCoins() {
    const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const fn = UI.slice(UI.indexOf('function swProvenance() {'), UI.indexOf('\n}\n', UI.indexOf('function swProvenance() {')));
    // RE-AIMED 3.185.0: the tick became a choice of three, so what is compared
    // is the NAME of the source, not on against off. A set written before this
    // carries no source of its own and read both lists, so it reads as both --
    // which says what happened rather than guessing.
    assert.ok(fn.includes('const wantSource = swSourceNow();'), 'the chosen source is read as a thing of its own');
    assert.ok(fn.includes('const setPairs = Array.isArray(p.passers) && p.passers.length ? p.passers : null;'), 'and the set says whether it was launched with it');
    assert.ok(fn.includes("const setSource = p.coinsSource || (setPairs ? 'both' : 'none');"), 'a set written before the choice existed reads as both');
    assert.ok(fn.includes("const tickBox = wantSource !== 'none';"), 'either list counts as taking the units off Coins');
    // NAMED AS THE SCREEN NAMES THEM. Every one of these three is the label on
    // its own choice, character for character.
    for (const w of ['ignore what is on Coins', 'what is ticked under coins and shapes that pass', 'what is ticked from a walk set']) {
      assert.ok(fn.includes(`'${w}'`), `the comparison does not name the choice by its label: ${w}`);
      assert.ok(UI.includes(`> ${w}</label>`), `that label is not on the screen: ${w}`);
    }
    assert.ok(fn.includes("['where this run takes its units from', sourceWords[wantSource] || wantSource, sourceWords[setSource] || setSource],"), 'the source is compared, name against name');
    assert.ok(fn.includes("? (tickBox && setPairs ? [['Candidates for Sweep', pairWords(swPassersNow[wantSource]), pairWords(setPairs)]] : [])"),
      'with both on, the pairs ticked now are held up to the pairs the set recorded — for the source the screen has chosen');
    assert.ok(/: \[\['trade coins', wantUni\.split/.test(fn) && /\['chunk shape', shape\(c\('#swPermGeom'\), v\('#swGeom'\)\)/.test(fn),
      'without the tick on either side the two boxes are compared as before');
    // the launch records the pairs on the set, which is what the screen reads
    const LIB = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(LIB.includes('passers: passers || null, campaign:'), 'the launch writes the pairs it ran, or null, on the set');
    // and the pairs ticked now ride on the same answer the headings already read the downloaded coins off
    const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    // ONE LIST PER SOURCE, AND THE HEADING READS THE ONE THE SCREEN CHOSE
    // (3.194.2). Served as a single list resolved with no argument -- which is
    // `both` -- a run launched from the walk list alone was held up to both
    // lists, so with anything ticked under coins and shapes that pass the
    // heading was red for ever and no box could change it.
    assert.ok(SRV.includes("for (const src of ['passers', 'walk', 'both']) {")
      && SRV.includes("out[src] = require('./lib/coinsrun').passingUnits(src);"),
      'the stagesets answer carries the pairs ticked on Coins now, resolved once per source');
    assert.ok(UI.includes('swPassersNow = st.passersTicked || {};')
      && UI.includes("if (st.passersTicked && typeof st.passersTicked === 'object') swPassersNow = st.passersTicked;"),
      'the screen keeps them on the draw and on every poll');
    assert.ok(/pairWords\(swPassersNow\[wantSource\]\)/.test(fn),
      'and the heading compares the list for the source the screen has chosen, never a different one');
  },

  // THE CEILING BOX AND ITS COLUMN NAME EACH OTHER EXACTLY (3.130.2, owner
  // order): the box on Sweep sets the ceiling, the column on Boards reports
  // what it did, and each says so using the other's label as the screen
  // draws it -- never a paraphrase, and never a name that is on no screen.
  async theCeilingBoxAndItsColumnNameEachOther() {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const help = fs.readFileSync(path.join(ROOT, 'public', 'help-content.js'), 'utf8');
    const box = '>the most one trade may count for<input id="swCap1"';
    assert.ok(src.includes(box), 'the box is drawn with that label on Sweep');
    const heads = [...src.matchAll(/<th [^>]*title="([^"]*)">biggest before the ceiling/g)].map((m) => m[1]);
    assert.strictEqual(heads.length, 2, 'the column is drawn on the stage 1 and stage 2 tables');
    for (const h of heads) {
      assert.ok(h.includes('the box called the most one trade may count for on Sweep'), 'the column names the box by its label');
      assert.ok(h.includes('weigh each trade by the money it was worth ticked on Sweep'), 'and the tick that switches it on');
      assert.ok(!/the ceiling you set/.test(h), 'no paraphrase in place of the name');
    }
    const entry = help.slice(help.indexOf('      swCap1: {'), help.indexOf('      swNull1: {'));
    assert.ok(entry.includes('the column called biggest before the ceiling on Boards, stage 1 table'), 'the box names the column by its label');
    assert.ok(entry.includes('weigh each trade by the money it was worth is ticked'), 'and the tick, by its label');
    const st = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(st.includes('throw new Error(`the most one trade may count for must be 0 or more'), 'the refusal names the box as the screen does');
    assert.ok(!/most one week may count for/.test(st), 'a name that is on no screen is gone');
    assert.throws(() => stages.startStage1({ universe: ['ZZZTESTUSDT'], sizes: { singles: true }, geometries: ['daily-4d'], fee: 0.00125, nullN: 4, windowLayout: 'reserve61', weightCap: -1 }), /the most one trade may count for must be 0 or more/);
  },


  // WHAT EACH UNIT HOLDS (3.52.0, owner order 2026-09-04: "fold duplicates
  // per unit, which would let units hold different setting counts"). Two
  // settings are one ON A UNIT when they place the same orders there: the
  // same resolved geometry (auto and a fixed band can be one geometry on
  // this unit and two on that), the same effective 24/5 (a shape with no
  // weekday version reads both values alike), the same everything else.
  async aUnitHoldsOnlyTheSettingsThatPlaceDifferentOrdersOnIt() {
    const unit = (trade, bandPct, geometry) => ({ trade, ctx1: null, ctx2: null, size: 1, geometry, bandPct });
    const cell = { entry: 'breakout', gate: 'active', dMult: 1, tHours: 41, trailMult: 1, armMult: 0 };
    // 24/5 both ways: the daily unit holds both, the weekly unit the first of each pair
    const both = stages.settingsFor({ cell, permuteWeekdays: true }, [1]);
    assert.strictEqual(both.length, 2);
    const held = stages.heldOnFor(both, [unit('AAAUSDT', 2, 'daily-4d'), unit('WWWUSDT', 2, 'weekly-8d')]);
    assert.deepStrictEqual(held, [[0, 1], [0]], 'the weekly unit reads 24/5 both ways alike, so it prices the pair once, keeping the first in block order');
    // auto against a fixed band: one geometry on the unit whose own band IS
    // that number, two on any other
    const bands = stages.settingsFor({ cell, permuteBand: true }, [1]);
    const auto = bands.findIndex((s) => s.band === 'auto');
    const five = bands.findIndex((s) => Number(s.band) === 5);
    assert.ok(auto >= 0 && five >= 0, 'the fixture block holds auto and the 5% band');
    const onFive = stages.heldOnFor(bands, [unit('AAAUSDT', 5, 'daily-4d'), unit('BBBUSDT', 2.1, 'daily-4d')]);
    assert.ok(onFive[0].length === bands.length - 1 && !(onFive[0].includes(auto) && onFive[0].includes(five)),
      'on a unit whose own band is 5%, auto and 5% place the same orders and only one is held');
    assert.strictEqual(onFive[1].length, bands.length, 'on a unit whose own band is 2.1%, auto and 5% differ and both are held');
    // the whole-block fold is the union: a setting no unit holds leaves the
    // block, everything else stays and heldOn points into what stays
    const fold = stages.foldSameTradeSettings(both, [unit('WWWUSDT', 2, 'weekly-8d'), unit('VVVUSDT', 3, 'weekly-8d')]);
    assert.strictEqual(fold.kept.length, 1, 'with only weekly units the second value of 24/5 is priced by nobody and leaves');
    assert.deepStrictEqual(fold.heldOn, [[0], [0]]);
    assert.deepStrictEqual(fold.folded.map((f) => [f.dropped, f.kept]), [[both[1].label, both[0].label]], 'the fold says what was dropped into what');
    assert.deepStrictEqual(fold.unitFolded, [0, 0], 'nothing kept was folded on either unit');
    const mixed = stages.foldSameTradeSettings(both, [unit('AAAUSDT', 2, 'daily-4d'), unit('WWWUSDT', 2, 'weekly-8d')]);
    assert.strictEqual(mixed.kept.length, 2, 'the daily unit prices both, so both stay in the block');
    assert.deepStrictEqual([mixed.heldOn, mixed.unitFolded], [[[0, 1], [0]], [0, 1]], 'and the weekly unit is one short of the block');
    // what a set says it holds adds up to its pricings; a set that does not
    // say is not judged
    assert.strictEqual(stages.pricingsOf({ plan: { unitSettings: [{ u: 0, held: 2 }, { u: 3, held: 1 }] } }), 3);
    assert.strictEqual(stages.pricingsOf({ plan: { settingLabels: ['x'] } }), null);
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

  // PICKING RECORDS ON THE STAGE 2 TABLE (owner order, 2026-09-02: "a check
  // box on the left side of every record", and under the stage 3 set-up
  // "N records" or "Selected records"). The picks save on the set like its
  // sort; the launch prices exactly the picked records under Selected
  // records and the carry under N records; every place that resolves a stage
  // 3 set's units again reads the exact list the set recorded.
  async thePickedRecordsSaveOnTheSetAndTheStageThreeLaunchPricesExactlyThose() {
    const id = `s2-test-${Date.now().toString(36)}-pk`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const cell = { entry: 'market', tHours: 65 };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        id, stage: 2, seq: 999985, name: 'S2 #pk', status: 'done', createdAt: new Date().toISOString(),
        plan: { units: 3 }, params: { universe: ['AAA', 'BBB', 'CCC'] },
      }));
      const w = rowstore.writer(id, 'records');
      w.push({ u: 0, carriedRank: 1, s1rank: 1, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', specs: [], scoreAll: 5, score3: 4 });
      w.push({ u: 1, carriedRank: 2, s1rank: 2, trade: 'BBB', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', specs: [], scoreAll: 9, score3: 8 });
      w.push({ u: 2, carriedRank: 3, s1rank: 3, trade: 'CCC', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', specs: [], scoreAll: 7, score3: 6 });
      w.close();
      // the picks save on the set, deduped and in record order; a number the
      // set does not hold is refused, not dropped
      assert.deepStrictEqual(stages.setSetPicked(id, [2, 0, 2]).picked, [0, 2]);
      assert.deepStrictEqual(stages.getSet(id).picked, [0, 2], 'saved on the record set');
      assert.throws(() => stages.setSetPicked(id, [0, 7]), /no record numbered 7/);
      assert.deepStrictEqual(stages.getSet(id).picked, [0, 2], 'a refused save changes nothing');
      // the table serves each record's number and the picks
      const t2 = stages.stage2Table(id, 0, 10);
      assert.deepStrictEqual(t2.picked, [0, 2]);
      assert.deepStrictEqual(t2.rows.map((r) => r.u).sort(), [0, 1, 2], 'every row says which record it is');
      assert.strictEqual(stages.listSets().find((x) => x.id === id).picked, 2, 'the set list says how many are picked');
      // the resolver: Selected records is exactly the picked ones, whatever the carry says
      const parent = stages.getSet(id);
      const sel = stages.stage3UnitsFor(parent, 5, [0, 2]);
      assert.deepStrictEqual(sel.records.map((r) => r.u), [0, 2]);
      assert.deepStrictEqual(sel.selected, [0, 2]);
      assert.strictEqual(stages.stage3UnitsFor(parent, 0, []).records.length, 0, 'nothing picked resolves to nothing');
      const top = stages.stage3UnitsFor(parent, 1);
      assert.deepStrictEqual(top.records.map((r) => r.u), [1], 'N records takes the top of the table');
      assert.strictEqual(top.selected, null);
      // how a set says what it priced, read one way everywhere
      assert.deepStrictEqual(stages.unitsChoiceOf({ carry: 5, selected: [0, 2] }), { carry: 0, selected: [0, 2] });
      assert.deepStrictEqual(stages.unitsChoiceOf({ carry: 3 }), { carry: 3, selected: null });
      assert.deepStrictEqual(stages.unitsChoiceOf({ carry: 3, selected: null }), { carry: 3, selected: null });
      // the launch's own resolution, from what the set-up asked
      assert.deepStrictEqual(stages.PICK_CHOICES, ['count', 'selected']);
      assert.deepStrictEqual(stages.stage3RecordsFor(parent, { pick: 'selected' }).records.map((r) => r.u), [0, 2]);
      assert.strictEqual(stages.stage3RecordsFor(parent, { pick: 'count', carry: 0 }).records.length, 3);
      assert.strictEqual(stages.stage3RecordsFor(parent, { carry: 2 }).records.length, 2, 'nothing said is N records');
      assert.throws(() => stages.stage3RecordsFor(parent, { pick: 'bogus' }), /records to price must be N records or Selected records/);
      // the cost line counts what the launch would price
      assert.strictEqual(stages.stage3Declared({ from: id, pick: 'selected', cell, agreePermutePct: true }).units, 2);
      assert.strictEqual(stages.stage3Declared({ from: id, pick: 'count', carry: 0, cell, agreePermutePct: true }).units, 3);
      // a rebuild or a relaunch prices the exact list the set recorded, not the table's picks today
      stages.setSetPicked(id, [1]);
      const shape = stages.relaunchShapeOf({ parent: { id }, params: { selected: [0, 2], cell, agreePermutePct: true } });
      assert.deepStrictEqual(shape.records.map((r) => r.u), [0, 2], 'the set\'s own list, whatever is picked now');
      assert.strictEqual(stages.relaunchShapeOf({ parent: { id }, params: { carry: 1, cell, agreePermutePct: true } }).records.length, 1);
      // and with nothing picked, Selected records refuses rather than pricing nothing or everything
      stages.setSetPicked(id, []);
      assert.throws(() => stages.stage3RecordsFor(stages.getSet(id), { pick: 'selected' }), /nothing is picked on S2 #pk/);
      assert.strictEqual(stages.stage3Declared({ from: id, pick: 'selected', cell, agreePermutePct: true }).units, null, 'the cost line says nothing rather than refusing');
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
      const coins = stages.stage3Coins(id, { sort: 'money', minPairs: 30, heldBack: '1' });
      assert.strictEqual(coins.rows.length, 1, 'only the 38-comparison row clears a floor of 30');
      assert.strictEqual(coins.removed, 2, 'and the line under the table owns up to both rows held back');
      const sorted = stages.stage3Coins(id, { sort: 'money', minPairs: 10, heldBack: '1' });
      assert.deepStrictEqual(sorted.rows.map((r) => r.avgHold), [20, 7, -4], 'money sort, whole set, best first');
      assert.deepStrictEqual(sorted.rows.map((r) => r.avgTest), [18, 9, -4], 'and every served row carries its avg test $');
      // one click on a column sorts it; a second click turns the whole order
      // the other way (owner order, 2026-08-27)
      const byTest = stages.stage3Coins(id, { sort: 'test', minPairs: 10, heldBack: '1' });
      assert.deepStrictEqual(byTest.rows.map((r) => r.avgTest), [18, 9, -4], 'avg test $ sorts the whole set, best first');
      const turned = stages.stage3Coins(id, { sort: 'test', flip: '1', minPairs: 10, heldBack: '1' });
      assert.deepStrictEqual(turned.rows.map((r) => r.avgTest), [-4, 9, 18], 'a second click turns the whole order the other way');
      const byRows = stages.stage3Coins(id, { sort: 'rows', minPairs: 10, heldBack: '1' });
      assert.strictEqual(byRows.rows[0].rows, 2, 'rows sorts by how many records the row averages');
      const floored = stages.stage3Coins(id, { minVsLong: 0, heldBack: '1' });
      assert.ok(floored.rows.every((r) => r.avgVsLong >= 0), 'the vs always-long floor holds');
      // EVERY FLOOR THE TABLE OFFERS MUST ACTUALLY REMOVE ROWS. avg test $ was
      // drawn, sent and never read: a floor of a million on the owner's own
      // 411,600-row table removed nothing. A box that does nothing is worse
      // than no box, so each one is held here against a floor above every
      // value in its column.
      for (const [box, col] of [['minTest', 'avgTest'], ['minHold', 'avgHold'], ['minTrades', 'avgTrades'],
        ['minVsLong', 'avgVsLong'], ['minPairs', 'pairs']]) {
        const all = stages.stage3Coins(id, { heldBack: '1' });
        assert.ok(all.rows.some((r) => r[col] != null), `the fixture has no ${col} to floor`);
        const none = stages.stage3Coins(id, { [box]: 1e9, heldBack: '1' });
        assert.strictEqual(none.rows.length, 0, `the "${box}" floor removes nothing — the box is drawn and never read`);
        assert.strictEqual(none.removed, all.total, `and the line under the table does not own up to what "${box}" held back`);
      }
      // AND BEHIND THE TICK (3.131.0): a held-back floor is not applied, the
      // held-back numbers do not leave the service, a held-back sort is set
      // aside and the page is told which; the test floor still bites.
      const hidden = stages.stage3Coins(id, { minPairs: 1e9, minHold: 1e9, minTrades: 1e9, minVsLong: 1e9, minShare: 1e9 });
      assert.strictEqual(hidden.total, 3, 'a held-back floor is applied while the window is hidden');
      assert.deepStrictEqual([hidden.heldBack, hidden.sortSetAside], [false, null]);
      for (const r of hidden.rows) for (const k of ['share', 'beat', 'pairs', 'avgHold', 'avgTrades', 'avgVsLong', 'noiseHold']) assert.ok(!(k in r), `${k} leaves the service with the window hidden`);
      assert.ok(hidden.rows.every((r) => r.avgTest != null), 'the test money does not ride with the window hidden');
      assert.strictEqual(stages.stage3Coins(id, { minTest: 1e9 }).total, 0, 'the test floor does not bite with the window hidden');
      const aside = stages.stage3Coins(id, { sort: 'money' });
      assert.strictEqual(aside.sortSetAside, 'money', 'a held-back sort is not set aside while the window is hidden, or the page is not told which');
      assert.deepStrictEqual(aside.rows.map((r) => r.avgTest), stages.stage3Coins(id, { sort: 'beatnoise' }).rows.map((r) => r.avgTest), 'with the sort set aside the table does not read in its own order');

      // the records under a row come back from only its blocks, grouped right
      const got = stages.stage3CoinRows(id, { cellLabel: 'q2/6 x', trade: 'AAA', ctx1: '', ctx2: '', geometry: 'daily-4d' });
      assert.strictEqual(got.shown, 2);
      assert.deepStrictEqual(got.rows.map((r) => r.decision).sort(), ['argmax', 'directional']);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(path.join(SETS_DIR, `${id}-tally.json.gz`), { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(path.join(SETS_DIR, `${id}-agreed.json.gz`), { force: true }); } catch (_) { /* fixture */ }
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
      // a parent whose record of the files it read is gone cannot be proved unchanged (3.84.0: the pin)
      assert.throws(() => stages.startStage2({ from: drifted.id }), /cannot be proved unchanged: the record of which price files it read is gone/);
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
        rec.push({ u, trade: `C${u}`, ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', bandPct: 2, counts: {}, specs: [], score: 10 - u, beat: u, pairs: 19, lead: u, nullScores: [], blocks: {},
          // what the run was trained under, including how hard the ceiling had
          // to work (3.121.0) -- stored on every record and, before this, read
          // by nothing at all
          trainedOn: { by: 'money', cap: 10, biggestKept: 10, of: 400, biggestBeforeCap: 31.5 + u, atCeiling: 4 + u } });
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
      // AND THE TABLE CARRIES HOW HARD THE CEILING HAD TO WORK (3.121.0). It
      // was on the record from the start and reached no screen at all.
      assert.deepStrictEqual(page.rows.map((r) => r.biggestBeforeCap), [33.5, 32.5],
        'the stage 1 table does not serve the biggest weight before the ceiling');
      assert.deepStrictEqual(page.rows.map((r) => r.atCeiling), [6, 5],
        'the stage 1 table does not serve how many were held at the ceiling');
      assert.strictEqual(page2.rows[0].biggestBeforeCap, 31.5, 'and it is the row\'s own, not the first row\'s');
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
      rec2.push({ u: 0, carriedRank: 1, s1rank: 1, trade: 'C0', ctx1: null, ctx2: null, geometry: 'daily-4d', specs: [], score3: 4, scoreAll: 5, helped: 1, beat: 17, pairs: 19, lead: 2.5,
        trainedOn: { by: 'money', cap: 10, biggestKept: 10, of: 400, biggestBeforeCap: 12.5, atCeiling: 2 } });
      rec2.push({ u: 1, carriedRank: 2, s1rank: 2, trade: 'C1', ctx1: null, ctx2: null, geometry: 'daily-4d', specs: [], score3: 8, scoreAll: 9, helped: 1, beat: 19, pairs: 19, lead: 4,
        trainedOn: { by: 'money', cap: 10, biggestKept: 10, of: 400, biggestBeforeCap: 44.25, atCeiling: 9 } });
      // and one unit trained by direction, which carries neither number -- the
      // blank the screen prints has to come from the record, not from a gap
      rec2.push({ u: 2, carriedRank: 3, s1rank: 3, trade: 'C2', ctx1: null, ctx2: null, geometry: 'daily-4d', specs: [], score3: 8.5, scoreAll: 9, helped: 0.5, beat: 12, pairs: 19, lead: 1,
        trainedOn: { by: 'direction' } });
      rec2.close();
      const t2 = stages.stage2Table(id2, 0, 10);
      assert.deepStrictEqual(t2.rows.map((r) => r.trade), ['C1', 'C2', 'C0'],
        'best all-members score first; the tie keeps its carry order');
      assert.deepStrictEqual(t2.rows.map((r) => r.rank), [1, 2, 3],
        'stage 2 order is the table\'s own sequence, never an echo of the stage 1 order');
      // the unit's stage 1 reading rides along for the table's null set columns
      assert.deepStrictEqual(t2.rows.map((r) => [r.beat, r.pairs, r.lead]), [[19, 19, 4], [12, 19, 1], [17, 19, 2.5]],
        'beat its own null set and lead over null set are served with each carried row');
      // AND THE STAGE 2 TABLE CARRIES HOW HARD THE CEILING HAD TO WORK TOO
      // (3.121.0), row by row, in the table's own order -- C1 first, then C2
      // which was trained by direction and so has neither number, then C0.
      assert.deepStrictEqual(t2.rows.map((r) => r.biggestBeforeCap), [44.25, null, 12.5],
        'the stage 2 table does not serve the biggest weight before the ceiling');
      assert.deepStrictEqual(t2.rows.map((r) => r.atCeiling), [9, null, 2],
        'the stage 2 table does not serve how many were held at the ceiling');
      const raw = stages.stage2Rows(id2);
      assert.deepStrictEqual(raw.map((r) => [r.u, r.biggestBeforeCap, r.atCeiling]),
        [[0, 12.5, 2], [1, 44.25, 9], [2, null, null]],
        'the rows the carry reads must carry the same two numbers the table draws');
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
      const mk = (si, tHours, hold, beat, noiseTest) => ({
        si, label: `q2/6 x t${tHours}h · argmax auto 24/7`, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false,
        bandPct: 2, entry: 'breakout', gate: 'directional', dMult: 1.5, tHours, trailMult: null, armMult: null,
        quorum: 2, members: 6, pnl: 10, trades: 3,
        holdout: { pnl: hold, trades: 4, stops: 1, vsAlwaysLong: 2 },
        beat, pairs: 9, lead: 1.5, noiseTest, noiseHold: null,
        u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
      });
      // EVERY ROW MAKES THE SAME TEST MONEY (10), so what separates them is
      // only the scrambled copies each one beat. The three orders are made
      // deliberately different from each other so this cannot pass by accident:
      //   by the kept scrambled copies (test)  t41 3 of 4, t17 2 of 4, t65 1 of 4
      //   by beat its own null set (held-back) t65 8 of 9, t41 5 of 9, t17 3 of 9
      //   by setting number                    t17, t65, t41
      w.push(mk(0, 17, 30, 3, [1, 2, 30, 40]));
      w.push(mk(1, 65, -4, 8, [1, 20, 30, 40]));
      w.push(mk(2, 41, 12, 5, [1, 2, 3, 40]));
      w.close();
      await stages.buildTally(doc);

      // NOTHING PICKED: the totalling's own order -- beat the kept null money,
      // best first, which is a TEST reading. Not beat its own null set, which
      // is worked out on the held-back stretch and would give [65, 41, 17].
      assert.deepStrictEqual(stages.stage3Ranked(id, 0, 10).rows.map((r) => r.tHours), [41, 17, 65]);
      // and the stored list holds that same order, so the tally a walk is
      // handed and the table the owner reads cannot be two orders
      assert.deepStrictEqual(stages.readTally(id).ranked.map((r) => r.tHours), [41, 17, 65]);
      // one column picked: the whole list reorders, and the pick echoes back
      stages.setSetSort(id, [{ key: 'avgHold', dir: 'desc' }]);
      const byHold = stages.stage3Ranked(id, 0, 10, null, { heldBack: true });
      assert.deepStrictEqual(byHold.rows.map((r) => r.avgHold), [30, 12, -4], 'the picked column orders the whole table');
      assert.deepStrictEqual(byHold.sort, [{ key: 'avgHold', dir: 'desc' }], 'the served page says what ordered it');
      // BEHIND THE TICK (3.131.0) a held-back sort is set aside: the page is
      // told which, the table reads in its own order, and the column is not served
      const aside = stages.stage3Ranked(id, 0, 10);
      assert.deepStrictEqual(aside.sortSetAside, [{ key: 'avgHold', dir: 'desc' }], 'the page is not told the saved sort was set aside');
      assert.deepStrictEqual([aside.sort, aside.heldBack], [[], false]);
      assert.deepStrictEqual(aside.rows.map((r) => r.tHours), [41, 17, 65], 'with the sort set aside the table does not read in its own order');
      assert.ok(aside.rows.every((r) => !('avgHold' in r)), 'the held-back column leaves the service with the window hidden');
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
      try { fs.rmSync(path.join(SETS_DIR, `${id}-agreed.json.gz`), { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
    }
  },

  // THE TABLE'S OWN ORDER CANNOT BE MOVED BY THE HELD-BACK STRETCH (owner
  // order, 2026-09-12; SELECTION-DESIGN.md, the history budget rule). The
  // positive half is above: the kept scrambled copies -- a test reading --
  // decide it. This is the negative half, and it is the one that matters,
  // because the fault it guards against is an order nobody chose.
  //
  // Three sets, identical in everything the test window sees and as different
  // as they can be made in everything the held-back window sees. If any part
  // of the held-back reading reaches the order, at least two of the three come
  // back different.
  async theRankedTablesOwnOrderNeverReadsTheHeldBackStretch() {
    const stamp = Date.now().toString(36);
    const made = [];
    const build = async (tag, rows) => {
      const id = `s3-test-${stamp}-${tag}`;
      const file = path.join(SETS_DIR, `${id}.json`);
      made.push({ id, file });
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        id, stage: 3, seq: 999986, name: `S3 #${tag}`, status: 'done', createdAt: new Date().toISOString(),
        plan: { units: 1, settings: rows.length }, params: { nullN: 9 },
        recordsVersion: stages.RECORDS_V,
      }));
      const w = rowstore.writer(id, 'records');
      for (const [si, tHours, hold, beat, noiseTest] of rows) {
        w.push({
          si, label: `q2/6 x t${tHours}h · argmax auto 24/7`, decision: 'argmax', bandMode: 'auto',
          weekdaysOnly: false, bandPct: 2, entry: 'breakout', gate: 'directional', dMult: 1.5, tHours,
          trailMult: null, armMult: null, quorum: 2, members: 6, pnl: 10, trades: 3,
          holdout: { pnl: hold, trades: 4, stops: 1, vsAlwaysLong: hold },
          beat, pairs: 9, lead: hold, noiseTest, noiseHold: null,
          u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
        });
      }
      w.close();
      await stages.buildTally({ id });
      return stages.stage3Ranked(id, 0, 10).rows.map((r) => r.tHours);
    };
    try {
      // the same three test readings both times: t41 beats 3 of its 4 kept
      // scrambled copies, t17 beats 2, t65 beats 1
      const nA = [1, 2, 30, 40];       // setting 0, t17 -- 2 of 4
      const nB = [1, 20, 30, 40];      // setting 1, t65 -- 1 of 4
      const nC = [1, 2, 3, 40];        // setting 2, t41 -- 3 of 4
      const kind = await build('hk', [[0, 17, 30, 3, nA], [1, 65, -4, 8, nB], [2, 41, 12, 5, nC]]);
      const cruel = await build('hc', [[0, 17, -900, 9, nA], [1, 65, 800, 0, nB], [2, 41, 0, 4, nC]]);
      assert.deepStrictEqual(kind, [41, 17, 65], 'the kept scrambled copies order it');
      assert.deepStrictEqual(cruel, kind,
        'held-back money, its comparisons and its lead were all turned upside down and the order did not move');

      // AND WHERE THERE IS NOTHING TEST-SIDE TO ORDER BY -- a set that kept no
      // scrambled copies, which is every set totalled before they existed --
      // the fallback is the setting number, never the held-back reading.
      const bare = await build('hn', [[0, 17, -900, 9, null], [1, 65, 800, 0, null], [2, 41, 0, 4, null]]);
      assert.deepStrictEqual(bare, [17, 65, 41],
        'no kept scrambled copies: setting order, not the order the held-back comparisons would give');
    } finally {
      for (const m of made) {
        try { fs.rmSync(m.file, { force: true }); } catch (_) { /* fixture */ }
        try { fs.rmSync(path.join(SETS_DIR, `${m.id}-tally.json.gz`), { force: true }); } catch (_) { /* fixture */ }
        try { fs.rmSync(path.join(SETS_DIR, `${m.id}-agreed.json.gz`), { force: true }); } catch (_) { /* fixture */ }
        try { fs.rmSync(rowstore.storeDir(m.id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
      }
    }
  },

  // A SET TOTALLED BEFORE THIS ORDER EXISTED READS IN IT ANYWAY (3.114.0).
  // This is why the order is applied in two places and not one. Every stage 3
  // set on the box was totalled while the stored order was worked out from the
  // held-back stretch, and re-totalling them to change a sort would be hours of
  // compute for a display order. So the table sorts what it reads as well.
  //
  // The tally is written back with its settings in a deliberately wrong order
  // and the read has to put them right. Nothing in the file says which order it
  // was written in -- so this cannot be passing by reading a marker, and no
  // reader has to ask how old a set is (RULE NINE).
  async aSetTotalledBeforeThisOrderExistedStillReadsInIt() {
    const id = `s3-test-${Date.now().toString(36)}-ro`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const tf = path.join(SETS_DIR, `${id}-tally.json.gz`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        id, stage: 3, seq: 999985, name: 'S3 #ro', status: 'done', createdAt: new Date().toISOString(),
        plan: { units: 1, settings: 3 }, params: { nullN: 9 }, recordsVersion: stages.RECORDS_V,
      }));
      const w = rowstore.writer(id, 'records');
      const mk = (si, tHours, noiseTest) => ({
        si, label: `q2/6 x t${tHours}h · argmax auto 24/7`, decision: 'argmax', bandMode: 'auto',
        weekdaysOnly: false, bandPct: 2, entry: 'breakout', gate: 'directional', dMult: 1.5, tHours,
        trailMult: null, armMult: null, quorum: 2, members: 6, pnl: 10, trades: 3,
        holdout: { pnl: 5, trades: 4, stops: 1, vsAlwaysLong: 2 },
        beat: 4, pairs: 9, lead: 1, noiseTest, noiseHold: null,
        u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
      });
      w.push(mk(0, 17, [1, 2, 30, 40]));      // beats 2 of 4
      w.push(mk(1, 65, [1, 20, 30, 40]));     // beats 1 of 4
      w.push(mk(2, 41, [1, 2, 3, 40]));       // beats 3 of 4
      w.close();
      await stages.buildTally({ id });
      assert.deepStrictEqual(stages.stage3Ranked(id, 0, 10).rows.map((r) => r.tHours), [41, 17, 65],
        'the freshly totalled set reads in the order this release writes');

      // REWRITE THE STORED FILE with the settings in the wrong order, exactly
      // as a set totalled under an older order sits on disk today. The head
      // line and the coins lines are put back untouched, so only the order of
      // the settings differs from what was written a moment ago.
      const lines = zlib.gunzipSync(fs.readFileSync(tf)).toString('utf8').split('\n');
      const head = JSON.parse(lines[0]);
      const settings = lines.slice(1, 1 + head.ranked);
      assert.strictEqual(settings.length, 3, 'the fixture holds three settings');
      const rest = lines.slice(1 + head.ranked);
      const wrong = [settings[1], settings[0], settings[2]];      // 65, 41, 17 -- none of them right
      fs.writeFileSync(tf, zlib.gzipSync(Buffer.from([lines[0], ...wrong, ...rest].join('\n'), 'utf8')));
      const then = new Date(Date.now() + 4000);
      fs.utimesSync(tf, then, then);          // the read remembers a file by its stamp and size

      assert.deepStrictEqual(stages.stage3Ranked(id, 0, 10).rows.map((r) => r.tHours), [41, 17, 65],
        'a set whose stored order is wrong is still served in the order the table promises');
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(tf, { force: true }); } catch (_) { /* fixture */ }
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
      // the older shape is one object for the whole file, which is what it was
      // until a tally outgrew what a string may hold (2026-08-30)
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
      // and the shape it writes NOW is one object per line, with the two counts
      // in the header — written here the way the totalling writes it rather
      // than as a single object, which is the thing that changed
      fs.writeFileSync(tf, zlib.gzipSync(`${JSON.stringify({ v: NOW, builtAt: 'xx', rows: 0, ranked: 0, coins: 0 })}\n`));
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
      assert.throws(() => stages.setSetSort(s1.id, [{ key: 'avgHold', dir: 'desc' }]), /is not a column these tables sort by/,
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
    // Four now: the three launches and the pass that fills in the kept
    // scrambles on a set priced before the column existed. A long job that
    // does not declare its cycle count shows no rate and no finish time.
    assert.strictEqual(lib.split('cyclesWord:').length - 1, 4,
      'every long job must declare its cycle count — the three launches and the kept-scramble fill');
    // 3.220.2: there is no long read before dispatch any more -- a unit's votes
    // are read at its turn, inside the pricing phase, and that phase reports
    // from its first part with nothing finished yet
    assert.ok(!/phase: 'reading the kept votes'/.test(lib), 'a read of every unit\'s votes before the first pricing is back');
    assert.ok(/phase: 'pricing the settings', done: 0, total: parts\.length, word: 'parts', startedMs: tPrice,/.test(lib),
      'the pricing phase does not announce itself before the first part lands, so the screen sits on "writing the plan"');
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
      for (const pin of ['bOptions(1, s1sel)', 'bOptions(2, s2sel, s1sel)', 'bOptions(3, s3sel, s2sel)']) {
        assert.ok(body.includes(pin), `each section's picker offers only its own stage's sets, narrowed to what came out of the pick above (${pin})`);
      }
      assert.ok(body.includes('if (s3sel) { s2sel = parentOf(s3sel); s1sel = s2sel ? parentOf(s2sel) : null; }'),
        'a stage 3 selection must put its whole chain on screen');
      assert.ok(body.includes('else if (s2sel) { s1sel = parentOf(s2sel); }'),
        'a stage 2 selection must put its stage 1 parent on screen');
      assert.ok(body.includes("bSaveView({ s1: idv, s2: null, s3: null, fold1: true, openS3: [] })"),
        'picking a stage 1 parent must put the child selections away');
      assert.ok(body.includes('data-bfold') && body.includes('fold1: true, fold2: true, fold3: true'),
        'the sections fold, and a fresh stage 3 pick opens its whole chain');
      // 3.107.0: the sentence moved into one constant, shared with the
      // Funnel's own put away press, so the two screens cannot come to leave
      // different words where their panels were.
      assert.ok(/fold\[stage\]\) \{ mount.innerHTML = putAwayNote;/.test(body),
        'a folded section says it is put away rather than vanishing');
    }
    // EACH BOARDS BOX OFFERS ONLY WHAT CAME OUT OF THE PICK ABOVE IT (owner
    // order, 2026-09-02: "why is Stage 3 on boards offering me a pick of S3 #1
    // which is not related"): the stage 2 box lists the picked stage 1 set's
    // children, the stage 3 box the picked stage 2 set's, walked by parent links
    {
      const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
      const draw = src.slice(src.indexOf('async function drawBoards('), src.indexOf('const btd = '));
      assert.ok(draw.includes('${bOptions(2, s2sel, s1sel)}'), 'the stage 2 box is narrowed to what came out of the picked stage 1 set');
      assert.ok(draw.includes('${bOptions(3, s3sel, s2sel)}'), 'the stage 3 box is narrowed to what came out of the picked stage 2 set');
      assert.ok(draw.includes('const descendsFrom = (x, ancestorId) =>') && draw.includes('(!above || descendsFrom(x, above.id))'),
        'descent is walked through the parent links, and a box with nothing picked above it lists every set of its stage');
      assert.ok(draw.includes('nothing came out of ${esc(above.name)} yet'), 'an empty box says so rather than offering unrelated sets');
    }
    // Sweep's titles carry the provenance colors, judged live
    {
      const src = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
      for (const id of ['swH1', 'swH2', 'swH3']) assert.ok(src.includes(`id="${id}"`), `the ${id} title must exist to be painted`);
      const fn = src.slice(src.indexOf('function swProvenance('), src.indexOf('async function swCounts('));
      assert.ok(/var\(--pos\)/.test(fn) && /var\(--neg\)/.test(fn), 'green normally, red at the point of break');
      assert.ok(fn.includes("rowOf(v('#swFrom2'))") && fn.includes("rowOf(v('#swFrom3'))"),
        'stage 2 is judged by the stage 1 set its box names, stage 3 by the stage 2 set its box names');
      // EACH TITLE IS JUDGED BY ITS OWN BOX (owner order, 2026-09-02: "why is
      // Stage 2 red ... should be GREEN and Stage 3 should be red"): the red
      // lands on the section whose box breaks the chain, never the one above it
      // Stage 1 is the root: it reads from no record set, so it is never
      // painted red -- and since 3.76.3 it is not painted green either, because
      // green claims a check it has never made.
      assert.ok(/paint\('#swH1', \(c\('#swSingles'\)/.test(fn),
        'stage 1 does not go green off its own section being set up');
      assert.ok(!/paint\('#swH1', (?:false|!)/.test(fn), 'stage 1 names no record set, so it can never be the section painted red');
      const s2 = fn.slice(fn.indexOf("const s1row = rowOf(v('#swFrom2'));"), fn.indexOf("const s3v = v('#swFrom3');"));
      // the RED lands on stage 2, whose box names the set
      assert.ok(s2.includes("paint('#swH2', !mismatch,"), 'a stage 1 set that no longer matches the stage 1 boxes paints STAGE 2, whose box names it');
      assert.ok(!/paint\('#swH1'/.test(s2), 'the stage 2 block paints the section above it');
      const s3 = fn.slice(fn.indexOf("const s3v = v('#swFrom3');"));
      assert.ok(s3.includes("paint('#swH3', !mismatch,"),
        'a stage 2 set that was not carried out of the stage 1 set the stage 2 box names paints STAGE 3, whose box names it');
      assert.ok(!/paint\('#swH2'/.test(s3), 'the stage 3 block paints the section above it');
      const swBody = screens.drawBody('drawSweep');
      assert.ok(swBody.includes('swProvenance()'), 'the colors are wired on the page');
      assert.ok(swBody.includes("b.disabled = !!held"), 'the start buttons sleep while ANY heavy job is going, not a stage run alone (3.163.0)');
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
      // -- since 3.222.1 by repainting the table in place, pegged to its heading line
      assert.ok(src.includes('async function bRepaintTable(stage, opts = {}) {'), 'the one repaint serves every control of the coins table');
      assert.ok(src.includes("bSaveView({ openS3: [...keys] });\n      bRepaintTable(3, { peg: '[data-bcoinhead]' });"),
        'opening or closing a row\'s records repaints pegged — the page does not move');
      assert.ok(src.split("bRepaintTable(3, { peg: '[data-bcoinhead]' });").length - 1 >= 4,
        'the records buttons, the column sorts, Revert filters and the held-back tick all repaint pegged');
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
      try { fs.rmSync(path.join(SETS_DIR, `${id}-agreed.json.gz`), { force: true }); } catch (_) { /* fixture */ }
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
    // the stage 3 tables fold no longer: each is alone on its own tab (3.239.1)
    for (const key of ['S1', 'S2']) {
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
    assert.ok(screens.drawBody('drawSweep').includes('b.disabled = !!held'), 'the start buttons must sleep while ANY heavy job is going (3.163.0)');
    assert.ok(body.includes('bWireFilters(mount, doc)') || src.includes('bWireFilters(mount, doc)'), 'the filters must be wired, not merely drawn');
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
    // the calibration block was seventeen units of one coin each, so units
    // stand where coins stood and the numbers are the ones that were measured
    const fits = stages.tallyBudgetFor({ settings: 2772, units: 17, heapLimitBytes: 1792 * 1048576 });
    assert.strictEqual(fits.band, 'fits', 'the design-scale block fits without comment');
    assert.strictEqual(fits.message, null);
    // the calibration pin: the exact block that killed the old totalling
    // reads as TIGHT under the reshaped one — it runs, and it says so
    const owners = stages.tallyBudgetFor({ settings: 177408, units: 17, heapLimitBytes: 1792 * 1048576 });
    assert.strictEqual(owners.band, 'tight', `the 177,408 × 17 block must read tight, got ${owners.band} at share ${owners.share}`);
    assert.ok(/it will run, but it is tight/.test(owners.message));
    const over = stages.tallyBudgetFor({ settings: 1000000, units: 17, heapLimitBytes: 1792 * 1048576 });
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
    // THE LAUNCH'S OWN TERM (3.220.2, owner: "put the launch-time term into the
    // memory gate so it refuses with the real number"): the block and every
    // unit's list of the settings it holds, counted beside the tables
    const noUnits = stages.tallyBudgetFor({ settings: 242176, heapLimitBytes: 3072 * 1048576 });
    const withUnits = stages.tallyBudgetFor({ settings: 242176, units: 86, declared: 272448, heapLimitBytes: 3072 * 1048576 });
    assert.strictEqual(noUnits.launchBytes, 0, 'with no units named there is no launch term');
    assert.strictEqual(withUnits.launchBytes, 272448 * 400 + 242176 * 86 * 16,
      'the launch term is the declared block at 400 bytes a setting plus every unit\'s list at 16 bytes a number');
    assert.strictEqual(withUnits.bytes, withUnits.tableBytes + withUnits.launchBytes, 'the gate adds the two');
    assert.ok(withUnits.share > noUnits.share, 'and the launch term moves the share');
    assert.ok(/the launch itself about/.test(withUnits.message) && /every unit's list of the settings it holds/.test(withUnits.message),
      'the message names the launch term');
    assert.ok(withUnits.fits < noUnits.fits, 'and fewer settings fit once the launch is counted');
    const small = stages.tallyBudgetFor({ settings: 3168, units: 86, declared: 3564, heapLimitBytes: 3072 * 1048576 });
    assert.strictEqual(small.band, 'fits', 'the 3,168 × 86 control block still fits without comment');
    // THE TABLES ARE COUNTED PER UNIT (3.220.4, owner order 2026-09-22): the
    // 169,248-setting block on 86 units read "tight" at 1.2 GB by coins when
    // Table 3.B would have held 7.3 million rows; by units it refuses, and one
    // gate value of it, 56,416 settings, fits
    const doubles = stages.tallyBudgetFor({ settings: 169248, units: 86, variants: 2, declared: 204336, heapLimitBytes: 3072 * 1048576 });
    assert.strictEqual(doubles.rows, 84624 * 86, 'Table 3.B rows are short settings × units, decision being a sub-row');
    assert.strictEqual(doubles.band, 'refuse', `the block that would die totalling reads ${doubles.band} at share ${doubles.share}`);
    assert.ok(/on each of the 86 unit\(s\)/.test(doubles.message) && /7,277,664 rows/.test(doubles.message) && !/coin\(s\)/.test(doubles.message),
      `the refusal counts units and rows, never coins: ${doubles.message}`);
    const oneGate = stages.tallyBudgetFor({ settings: 56416, units: 86, variants: 2, declared: 68112, heapLimitBytes: 3072 * 1048576 });
    assert.strictEqual(oneGate.band, 'fits', `one gate value of it fits, got ${oneGate.band} at share ${oneGate.share}`);
    assert.ok(stages.tallyBudgetFor({ settings: 56416, units: 86, variants: 1, declared: 68112, heapLimitBytes: 3072 * 1048576 }).bytes > oneGate.bytes,
      'a block that permutes nothing has a row per setting per unit, and costs more');
    // and the variants are read off the block's own axes
    assert.strictEqual(stages.variantsOf({ permuteDecision: true, permuteBand: true, permuteWeekdays: true }), 16, 'decision × band × 24/5');
    assert.strictEqual(stages.variantsOf({ decision: 'argmax', band: 'auto' }), 1);
    // ...and it says how far over the bar the block is, because "shrink it"
    // with no number is an invitation to guess at a screen that takes a moment
    // to answer each time.
    assert.ok(over.fits > 0 && over.fits < 1000000, `the refusal must work out what WOULD fit; got ${over.fits}`);
    assert.ok(over.message.includes(`${over.fits.toLocaleString()} settings fit`)
      && over.message.includes('this block declares 1,000,000'),
    `the refusal must state both numbers; got: ${over.message}`);
    // the arithmetic behind that: it is settings x coins and NOTHING else, so
    // the same block on the same coins is the same size whatever the nulls are
    const a19 = stages.tallyBudgetFor({ settings: 50000, units: 5, nullN: 19, heapLimitBytes: 1792 * 1048576 });
    const a99 = stages.tallyBudgetFor({ settings: 50000, units: 5, nullN: 99, heapLimitBytes: 1792 * 1048576 });
    assert.strictEqual(a19.bytes, a99.bytes,
      'the tally size moved with the null set size — every deal is folded into a running count and never kept, so it must not');
    assert.ok(stages.tallyBudgetFor({ settings: 50000, units: 10, heapLimitBytes: 1792 * 1048576 }).bytes > a19.bytes,
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

    // stage 1 trains LOGREG on each slice; stage 2 adds BOOST on the same ones.
    // RE-AIMED 3.183.0: the committee is now a list the unit carries, so both
    // stages build it through memberSpecs. The counts the screen prints are
    // still the BASE counts, which is what these two lines are about.
    const work = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    assert.ok(/memberSpecs\('logreg', combo\.size, extras\.length\)/.test(work),
      'stage 1 no longer builds its committee through memberSpecs, so these counts are derived from the wrong thing');
    assert.ok(/memberSpecs\('boost', combo\.size, extras\.length\)/.test(work),
      'stage 2 no longer adds one BOOST member per slice through memberSpecs');
    // AND WITH NO EXTRAS IT IS EXACTLY WHAT IT WAS: same count, same views, in
    // the same order. An extra adds one and only one, at the end.
    const { memberSpecs } = require('../lib/bracketwork');
    for (const size of [1, 2, 3]) {
      const base = memberSpecs('logreg', size);
      assert.deepStrictEqual(base.map((s) => s.view), slimViewsFor(size), `size ${size}: the base slices, in order`);
      assert.ok(base.every((s) => s.at == null), 'and none of them is an extra');
      assert.strictEqual(memberSpecs('logreg', size, 0).length, base.length, 'asking for none is the same as not asking');
      const plusOne = memberSpecs('logreg', size, 1);
      assert.strictEqual(plusOne.length, base.length + 1, `size ${size}: one extra is one more member`);
      assert.deepStrictEqual(plusOne.slice(0, base.length), base, 'and it is added at the end, never in place of one');
      assert.strictEqual(plusOne[base.length].at, 0, 'the extra says which of the unit\u2019s extras it reads');
      assert.strictEqual(memberSpecs('logreg', size, 3).length, base.length + 3, 'a third is one more entry, not another branch');
    }

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
    // (3.220.2: reading the kept votes is no longer a phase of its own -- a
    // unit's votes are read at its turn, inside pricing the settings)
    for (const phase of ['training the LOGREG members', 'training the BOOST members',
      'pricing the settings', 'totalling the tables']) {
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
      band, dMult, trailMult: null, armMult: null, tHours: 65, entry: 'breakout', gate: 'active',
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
    assert.ok(/out\.declared = counted\.declared;/.test(src) && /out\.folded = counted\.folded;/.test(src),
      'the count does not report the fold, so the cost line cannot mention it');
    // the launch and the rebuild must fold through the SAME function, or the
    // block that runs and the block read back for a set already priced are two
    // different ideas of which settings existed
    assert.strictEqual(src.split('foldSameTradeSettings(').length - 1, 4,
      'the fold is called somewhere other than its definition, the launch, the rebuild and a paused run started again (3.82.0) — those must be the '
      + 'only callers, or the number that runs and the number read back come from different arithmetic');
    // and the count, which no longer builds the settings (3.46.3), must read
    // the SAME shape pass the fold reads, or the number on the cost line and
    // the number that runs are two different numbers
    assert.strictEqual(src.split('shapeRepsFor(').length - 1, 4,
      'the shape pass is read somewhere other than its definition, the per-unit holdings, the fold\'s dropped-into names and the count — or by fewer than all three');
    const held = src.slice(src.indexOf('function heldOnFor('), src.indexOf('function foldSameTradeSettings('));
    const fold = src.slice(src.indexOf('function foldSameTradeSettings('), src.indexOf('function pricingsOf('));
    const count = src.slice(src.indexOf('function countDeclared('), src.indexOf('function stage3Declared('));
    assert.ok(held.includes('shapeRepsFor(settings, [rec])') && count.includes('shapeRepsFor(items.map((x) => x.shape), [rec])'),
      'the holdings and the count both work out which shapes are the same trade ON ONE UNIT through shapeRepsFor');
    assert.ok(fold.includes('const heldOn = heldOnFor(settings, records, leans, fieldPairs);'), 'the fold is built from the per-unit holdings, not beside them — and hands them the leans (3.130.0) and the field pairs (3.212.0)');
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

    // ONE ANSWER for everything heavy the stages own — the run AND its
    // totalling, which is just as heavy and just as easy to forget.
    assert.strictEqual(typeof stages.stageBusy, 'function', 'there is no way to ask whether a stage run is going');
    assert.strictEqual(stages.stageBusy(), null, 'an idle box must report nothing busy');
    const fn = lib.slice(lib.indexOf('function stageBusy()'), lib.indexOf('\n}', lib.indexOf('function stageBusy()')));
    assert.ok(/activeSet/.test(fn), 'stageBusy does not notice a stage run');
    assert.ok(/tallyRun/.test(fn), 'stageBusy does not notice a totalling, which holds the same workers');

    // THE OLDER SWEEP ENGINE IS GONE (3.97.0): a stage launch asks nothing of
    // it any more, and the stage-engine check's own launches still pass while
    // it runs (the claim takes the launch's params since 3.87.0).
    const claim = lib.slice(lib.indexOf('function claimOrRefuse(params = {})'), lib.indexOf('\n}', lib.indexOf('function claimOrRefuse(params = {})')));
    assert.ok(!/batch\./.test(claim), 'a stage launch still asks after the retired sweep engine');
    assert.ok(/examBusy\(\)/.test(claim), 'a stage launch no longer refuses while the stage-engine check runs');
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

      const all = stages.stage3Ranked(id, 0, 10, null, { heldBack: true });
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
      const some = stages.stage3Ranked(id, 0, 10, { holdMin: 10 }, { heldBack: true });
      assert.strictEqual(some.total, 2, 'the fixture is wrong if the floor does not leave two rows');
      const h2 = some.spread.holdMin;
      assert.deepStrictEqual([h2.min, h2.median, h2.avg, h2.max], [12, 21, 21, 30],
        'the four numbers still describe the whole set, so they say nothing about the table on screen');
      const t2 = some.spread.tMin;
      assert.deepStrictEqual([t2.min, t2.max], [17, 65], 'and every other column must narrow with it');

      // the every-coin table's floors carry their own four, over its own rows
      const cn = stages.stage3Coins(id, { heldBack: '1' });
      assert.ok(cn.spread && cn.spread.minHold, 'the every-coin floors have no numbers beside them');
      assert.deepStrictEqual([cn.spread.minHold.min, cn.spread.minHold.max], [-4, 30]);
      const cn2 = stages.stage3Coins(id, { minHold: 10, heldBack: '1' });
      assert.deepStrictEqual([cn2.spread.minHold.min, cn2.spread.minHold.max], [12, 30],
        'the every-coin numbers must follow its floors too');
      // BEHIND THE TICK (3.131.0): a held-back floor is not applied, and the
      // four numbers beside its box are not served, on either table
      const hid = stages.stage3Ranked(id, 0, 10, { holdMin: 10 });
      assert.strictEqual(hid.total, 4, 'the held-back floor is applied while the window is hidden');
      assert.ok(!('holdMin' in hid.spread) && ('tMin' in hid.spread), 'the four numbers beside a held-back box are served while the window is hidden, or a dial box lost its four');
      const hidC = stages.stage3Coins(id, { minHold: 10 });
      assert.strictEqual(hidC.total, cn.total, 'the every-coin held-back floor is applied while the window is hidden');
      assert.ok(!('minHold' in hidC.spread) && ('minTest' in hidC.spread), 'the every-coin numbers beside a held-back box are served while the window is hidden, or the test box lost its four');
    } finally {
      try { fs.unlinkSync(file); } catch (_) { /* gone */ }
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-tally.json.gz`)); } catch (_) { /* gone */ }
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-agreed.json.gz`)); } catch (_) { /* gone */ }
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
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-agreed.json.gz`)); } catch (_) { /* gone */ }
      rowstore.remove(id);
    }
  },

  // A RECORD PRICED UNDER A PLATEAU SHARE FINDS ITS ANSWER (3.206.2, owner:
  // "strange that there's no 'SHARE THAT AGREED' at all on this table").
  //
  // Since 3.205.0 the plateau share is part of the way of asking, so a unit's
  // answers are filed under a name that ends in it. The record never carried
  // it, so every record on a walk-set chain looked its answer up under the
  // shorter name, found nothing, and the column was a dash on all three
  // tables -- with no note, because the answers were there. Now the record
  // carries the share, the totalling carries it onto the ranked row, and a
  // set whose records and answers are keyed differently says so on the screen.
  async aRecordPricedUnderAPlateauShareFindsItsAnswerAndAMismatchIsSaid() {
    const sw = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stagework.js'), 'utf8');
    // the record row carries it beside the other quorum fields, from the same
    // agr the key is built from
    assert.ok(/agreeBoth: agr\.both, agreePersist: agr\.persist,\n(?:\s*\/\/[^\n]*\n)*\s*plateauPct: agr\.plateau,/.test(sw),
      'the priced record does not carry the plateau share its answer is filed under');
    assert.ok(/plateauPct: r\.plateauPct \?\? null,/.test(sw), 'the tally does not carry the plateau share onto the setting row');

    const id = `s3-test-${Date.now().toString(36)}-pl`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const doc = {
      id, stage: 3, seq: 999976, name: 'S3 #pl', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 1, settings: 2 }, params: { nullN: 9 },
      recordsVersion: stages.RECORDS_V,
    };
    const mk = (si, decision, plateauPct) => ({
      si, label: `count 75% +plateau25% market t65h · ${decision} auto 24/7`,
      decision, bandMode: 'auto', weekdaysOnly: false,
      bandPct: 2, entry: 'market', gate: 'directional', dMult: null, tHours: 65, trailMult: null, armMult: null,
      agreeRule: 'count', agreePct: 75, agreeBoth: false, agreePersist: 0,
      ...(plateauPct == null ? {} : { plateauPct }),
      rung: 6, members: 8, voices: 8, pnl: 10, trades: 3,
      holdout: { pnl: 5, trades: 4, stops: 1, vsAlwaysLong: 2 },
      beat: 5, pairs: 9, lead: 1, u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
    });
    // filed the way a unit files them since 3.205.0: the name ends in the share
    const answers = {
      '0|argmax|count|all|75|98|0|0|plateau25': { agreed: 80, agreedLow: 75, agreedHigh: 100, agreedN: 40 },
      '0|directional|count|all|75|98|0|0|plateau25': { agreed: 90, agreedLow: 87.5, agreedHigh: 100, agreedN: 12 },
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      let w = rowstore.writer(id, 'records');
      w.push(mk(0, 'argmax', 25));
      w.push(mk(0, 'directional', 25));
      w.close();
      stages.writeAgreed(id, answers);
      await stages.buildTally(doc);
      const rk = stages.stage3Ranked(id, 0, 10);
      const r0 = rk.rows.find((r) => r.si === 0);
      assert.ok(r0 && r0.avgAgreed != null && Math.abs(r0.avgAgreed - 85) < 1e-12,
        `a record priced under a plateau share must find its answer: 80 and 90 -> 85; got ${r0 && r0.avgAgreed}`);
      assert.strictEqual(r0.plateauPct, 25, 'the ranked row must say the plateau share it was priced under');
      assert.strictEqual(rk.agreedError, null, 'a set whose records found their answers must not be flagged');
      const cn = stages.stage3Coins(id, {});
      assert.ok(cn.rows.length === 1 && Math.abs(cn.rows[0].avgAgreed - 85) < 1e-12,
        `the every-coin table must average the same two answers; got ${JSON.stringify(cn.rows.map((r) => r.avgAgreed))}`);
      const got = stages.stage3CoinRows(id, { cellLabel: 'count 75% +plateau25% market t65h', trade: 'AAA', ctx1: '', ctx2: '', geometry: 'daily-4d' });
      assert.deepStrictEqual((got.rows || []).map((r) => r.agreed).sort((a, b) => a - b), [80, 90],
        'the records under the row must carry their own figures');

      // THE MISMATCH IS SAID, NOT LEFT AS A DASH: the same answers, and
      // records written without the share, which is what 3.205.0 to 3.206.1 wrote
      rowstore.remove(id);
      w = rowstore.writer(id, 'records');
      w.push(mk(0, 'argmax', null));
      w.push(mk(0, 'directional', null));
      w.close();
      await stages.buildTally(doc);
      const rk2 = stages.stage3Ranked(id, 0, 10);
      assert.strictEqual(rk2.rows.find((r) => r.si === 0).avgAgreed, null,
        'the fixture is wrong if a record without the share still finds an answer filed under it');
      assert.ok(rk2.agreedError && /keyed differently/.test(rk2.agreedError) && /Price the set again/.test(rk2.agreedError),
        `a set whose records and answers are keyed differently must say so on the screen; got ${JSON.stringify(rk2.agreedError)}`);
      // and the note goes the moment the records find their answers again
      rowstore.remove(id);
      w = rowstore.writer(id, 'records');
      w.push(mk(0, 'argmax', 25));
      w.close();
      await stages.buildTally(doc);
      assert.strictEqual(stages.stage3Ranked(id, 0, 10).agreedError, null, 'the note must clear once the records find their answers');
    } finally {
      try { fs.unlinkSync(file); } catch (_) { /* gone */ }
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-tally.json.gz`)); } catch (_) { /* gone */ }
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-agreed.json.gz`)); } catch (_) { /* gone */ }
      rowstore.remove(id);
    }
  },

  // HOW OFTEN A SETTING ACTUALLY TRADES IS ON BOTH TABLES (3.207.0, owner:
  // "we need to be able to sort and/or filter these things somehow by a
  // number of test trades so we can see which ones are active enough to
  // pursue").
  //
  // Every record has carried its test-window entry count since 3.131.0 and the
  // ranked row averaged it for the Funnel's trade floor, but neither table
  // showed it: the only trades columns were held-back ones, behind the tick.
  // Now avg test trades is a column, a sort and a floor on Table 3.A and on
  // Table 3.B, outside the tick because it reads the test window -- and the
  // every-coin table's held-back trades column says held-back, since two kinds
  // of trades now sit on it (RULE ELEVEN: a label names the thing).
  async howOftenASettingTradesIsAColumnASortAndAFloorOnBothTables() {
    assert.ok(stages.TALLY_V >= 9, 'the every-coin rows sum test trades from version 9; an older table is rebuilt on open');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
    assert.ok(/>avg test trades\$\{bRankSortBtn\(doc, 'testTrades', 'desc'\)\}/.test(ui), 'Table 3.A has no avg test trades column, or it does not sort');
    assert.ok(/>avg test trades\$\{bCoinSortBtn\(view, 'testtrades', '↓'\)\}/.test(ui), 'Table 3.B has no avg test trades column, or it does not sort');
    assert.ok(/\['testTradesMin', 'avg test trades at least', 'num'/.test(ui), 'Table 3.A has no floor on avg test trades');
    assert.ok(/\['minTestTrades', 'avg test trades at least', 'num'/.test(ui), 'Table 3.B has no floor on avg test trades');
    // outside the held-back tick on both tables: the column sits between avg
    // test $ and the held-back block, never inside it
    const a = ui.slice(ui.indexOf(">avg test $${bRankSortBtn(doc, 'avgTest', 'desc')}"), ui.indexOf(">avg test trades${bRankSortBtn(doc, 'testTrades', 'desc')}"));
    assert.ok(a.length > 0 && !a.includes('bHeldBack ?'), 'Table 3.A hides avg test trades behind the held-back tick');
    const b = ui.slice(ui.indexOf(">avg test $${bCoinSortBtn(view, 'test', '↓')}"), ui.indexOf(">avg test trades${bCoinSortBtn(view, 'testtrades', '↓')}"));
    assert.ok(b.length > 0 && !b.includes('bHeldBack ?'), 'Table 3.B hides avg test trades behind the held-back tick');
    // and the held-back trades column on Table 3.B says which trades it is
    assert.ok(!/>avg trades\$\{/.test(ui), 'Table 3.B still has a bare avg trades column beside avg test trades');
    assert.ok(/>avg held-back trades\$\{bCoinSortBtn\(view, 'trades', '↓'\)\}/.test(ui), "Table 3.B's held-back trades column is not named held-back");
    assert.ok(/\['minTrades', 'avg held-back trades at least', 'num'/.test(ui), "Table 3.B's held-back trades floor is not named held-back");
    assert.ok(/trades: 'avg held-back trades'/.test(ui), 'the set-aside sentence still calls it avg trades');

    const id = `s3-test-${Date.now().toString(36)}-tt`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const doc = {
      id, stage: 3, seq: 999975, name: 'S3 #tt', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 1, settings: 3 }, params: { nullN: 9 },
      recordsVersion: stages.RECORDS_V,
    };
    const mk = (si, pct, trade, trades) => ({
      si, label: `count ${pct}% market t65h · argmax auto 24/7`,
      decision: 'argmax', bandMode: 'auto', weekdaysOnly: false,
      bandPct: 2, entry: 'market', gate: 'directional', dMult: null, tHours: 65, trailMult: null, armMult: null,
      agreeRule: 'count', agreePct: pct, agreeBoth: false, agreePersist: 0,
      rung: 6, members: 8, voices: 8, pnl: 10, trades,
      holdout: { pnl: 5, trades: 4, stops: 1, vsAlwaysLong: 2 },
      beat: 5, pairs: 9, lead: 1, u: 0, trade, ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
    });
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      w.push(mk(0, 75, 'AAA', 6));   // setting 0: 6 on AAA and 2 on BBB -> 4 a coin
      w.push(mk(0, 75, 'BBB', 2));
      w.push(mk(1, 90, 'AAA', 12));  // setting 1: 12 on its one coin
      w.push(mk(2, 95, 'AAA', null)); // setting 2: a record priced before the count existed
      w.close();
      await stages.buildTally(doc);

      // Table 3.A: the number, the sort and the floor
      const rk = stages.stage3Ranked(id, 0, 10);
      const by = (si) => rk.rows.find((r) => r.si === si);
      assert.deepStrictEqual([by(0).testTrades, by(1).testTrades, by(2).testTrades], [4, 12, null],
        'avg test trades on Table 3.A is entries per coin on the test window, averaged over the coins, and absent where no record carried it');
      assert.ok(rk.spread && rk.spread.testTradesMin && rk.spread.testTradesMin.n === 2, 'the floor has no four numbers beside it, or it counts the row with no value');
      stages.setSetSort(id, [{ key: 'testTrades', dir: 'desc' }]);
      assert.deepStrictEqual(stages.stage3Ranked(id, 0, 10).rows.map((r) => r.testTrades), [12, 4, null],
        'Table 3.A does not sort by avg test trades, or a missing value does not sit last');
      stages.setSetSort(id, []);
      assert.deepStrictEqual(stages.stage3Ranked(id, 0, 10, { testTradesMin: 5 }).rows.map((r) => r.si), [1],
        'the floor on avg test trades does not bite on Table 3.A');
      // the calls above ran with the held-back window hidden (the default); it
      // bites the same with the window shown, because it reads the test window
      assert.strictEqual(stages.stage3Ranked(id, 0, 10, { testTradesMin: 5 }, { heldBack: true }).total, 1,
        'the floor must bite with the held-back window shown as well as hidden');

      // Table 3.B: the same per coin row
      const cn = stages.stage3Coins(id, { sort: 'testtrades' });
      assert.deepStrictEqual(cn.rows.map((r) => [r.trade, r.avgTestTrades]), [['AAA', 12], ['AAA', 6], ['BBB', 2], ['AAA', null]],
        'Table 3.B does not carry avg test trades per coin row, or does not sort by it best first');
      assert.strictEqual(stages.stage3Coins(id, { minTestTrades: 5 }).rows.length, 2, 'the floor on avg test trades does not bite on Table 3.B');
      assert.ok(cn.spread && cn.spread.minTestTrades, 'the every-coin floor has no four numbers beside it');
      assert.ok('avgTestTrades' in cn.rows[0], 'the column must reach the screen with the held-back window hidden');
    } finally {
      try { fs.unlinkSync(file); } catch (_) { /* gone */ }
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-tally.json.gz`)); } catch (_) { /* gone */ }
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-agreed.json.gz`)); } catch (_) { /* gone */ }
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
      w.push(mk(0, 'breakout', 'directional'));
      w.push(mk(1, 'breakout', 'active'));
      // opened at market: it carries a gate in the record and the column
      // prints a dash, because no gate applies to it
      w.push(mk(2, 'market', 'directional'));
      w.close();
      await stages.buildTally(doc);

      const pick = (g) => stages.stage3Ranked(id, 0, 10, { gate: g }).rows.map((r) => r.si).sort();
      assert.deepStrictEqual(pick('directional'), [0], 'picking a gate must not hand back the market row the column shows a dash for');
      assert.deepStrictEqual(pick('active'), [1], '"active" must not also keep "directional"');
      assert.deepStrictEqual(pick('does not apply'), [2], 'there is no way to pick the settings no gate applies to');
      assert.strictEqual(stages.stage3Ranked(id, 0, 10).total, 3, 'and an empty box still shows every setting');
    } finally {
      try { fs.unlinkSync(file); } catch (_) { /* gone */ }
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-tally.json.gz`)); } catch (_) { /* gone */ }
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-agreed.json.gz`)); } catch (_) { /* gone */ }
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
    assert.ok(Array.isArray(served) && served.length >= 2, 'the engine serves no gate list for the dropdown to read');
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
    assert.deepStrictEqual(after.map((k) => `${k.agreeRule}|${k.agreeBar}`).sort(),
      ['conviction|all', 'conviction|own', 'count|all', 'count|own', 'families|all', 'families|own',
        'trained|null', 'voices|all', 'voices|own'],
      'four ways of weighing against two bars is eight settings, and every one must reach the block — '
      + 'and trained, which reads no bar, is the ninth, ONCE, carrying no bar at all');
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
    for (const dial of ['agr.rule', 'agr.bar', 'agr.pct', 'agr.copy', 'agr.both', 'agr.persist', 'agr.plateau', 'decision']) {
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
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-agreed.json.gz`)); } catch (_) { /* gone */ }
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
    assert.ok(/data-bpin3b="[^"]*"[^>]*white-space:nowrap[^>]*>Show in 3\.B<\/button>/.test(ui),
      'the button can wrap, which makes every row of Table 3.A twice as tall');
    assert.ok(/offset: 0 \},\n      \}\);/.test(ui),
      'pinning leaves the every-coin table on whatever page it was, which can be past the end of what is left');
    // EVERY OTHER FLOOR COMES OFF, or some of the setting's coins stay hidden
    // by something set earlier with no hint why
    assert.ok(/all\.S3C = \{ setting: btn\.dataset\.bpin3b \};/.test(ui),
      'pinning adds the setting beside whatever floors were already on, so it cannot show all of its coins');
    // ...and what was there is kept, so one press puts it back
    assert.ok(/s3cBeforePin: before,/.test(ui), 'nothing remembers the filters that were taken off');
    assert.ok(/data-bunpin3b/.test(ui) && /Revert filters/.test(ui),
      'there is no way to put the filters back after Show in 3.B took them off');
    assert.ok(/all\.S3C = \{ \.\.\.\(bView\(\)\.s3cBeforePin \|\| \{\}\) \};/.test(ui),
      'putting them back does not restore what was remembered');
    assert.ok(/s3cBeforePin: null/.test(ui), 'the remembered filters are never let go of, so the button never goes away');
    // it takes the reader TO Table 3.B rather than holding still: it is
    // pressed from the table above and the answer is the one below
    assert.ok(/bRepaintTable\(3, \{ scrollTo: '\[data-bcoinhead\]' \}\);/.test(ui), 'pinning does not bring Table 3.B onto the screen');
    assert.ok(/const to = opts\.scrollTo \? document\.querySelector\(opts\.scrollTo\) : null;/.test(ui), 'the repaint cannot bring a table onto the screen');
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
    assert.ok(/colspan="31"/.test(ui), 'the "nothing here" line no longer spans the whole of Table 3.A (31 columns since the field, 3.212.0)');
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
  // NOTHING TO SAY WHEN THERE IS NOTHING TO DO (owner order, 2026-08-30).
  //
  // The drop line and the fill-in line each reported their finished state —
  // that nothing was surplus or missing, and how many times the set had been
  // dropped from or added to. Both true. The owner's call was to take them out:
  // a line that can never go away is not information, it is furniture. What was
  // done to a set is still recorded on the set.
  async aFinishedSetSaysNothingAboutBeingFinished() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    for (const [what, gone] of [
      ['the drop line', 'Settings were dropped from it'],
      ['the fill-in line', 'It was filled in'],
      ['either line', 'every setting this set holds is one its block declares'],
      ['either line', 'every setting this block declares is priced'],
    ]) {
      assert.ok(!ui.includes(gone), `${what} is back to reporting its finished state: "${gone}"`);
    }
    // and each returns nothing at all in that state, rather than something else
    const drop = ui.slice(ui.indexOf('function bDropLine('), ui.indexOf('function bFillInLine('));
    assert.ok(/if \(!surplus\) return '';/.test(drop),
      'the drop line still draws something when nothing is surplus');
    // sliced to the NEXT function, not to a character count — a window guessed
    // by eye stops short the moment the code above it grows.
    const fillAt = ui.indexOf('function bFillInLine(');
    const fill = ui.slice(fillAt, ui.indexOf('\nfunction ', fillAt + 10));
    assert.ok(/if \(!gap\.missing\) return '';/.test(fill),
      'the fill-in line still draws something when nothing is missing');
  },

  // WHAT THE BLOCK DECLARES IS WORKED OUT ONCE (owner order, 2026-08-30: "fix
  // the /missing caching").
  //
  // Every Boards draw asked, and answering meant rebuilding the whole block
  // through the launch's enumerator — 18,675 ms measured on the owner's set, on
  // the one thread that answers everything else, for every tab switch, filter,
  // page turn and sort.
  //
  // The danger in caching it is not slowness, it is a STALE ANSWER: the numbers
  // on that line say how many settings the set is missing and how many it holds
  // that its block does not declare, and those change the moment a rename, a
  // drop or a fill-in touches the set. A cache that misses that would tell the
  // owner the wrong count with total confidence. So this runs the real thing
  // against a real parent and checks the answer MOVES when it must.
  async whatTheBlockDeclaresIsWorkedOutOnceAndTheAnswerStillMoves() {
    const stamp = Date.now().toString(36);
    const pid = `s2-test-${stamp}-mc`;
    const id = `s3-test-${stamp}-mc`;
    const pfile = path.join(SETS_DIR, `${pid}.json`);
    const file = path.join(SETS_DIR, `${id}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      // a stage 2 parent with two carried units
      fs.writeFileSync(pfile, JSON.stringify({
        id: pid, stage: 2, seq: 999958, name: 'S2 #mc', status: 'done',
        createdAt: '2026-08-27T02:00:00.000Z', plan: { units: 2 },
      }));
      const pw = rowstore.writer(pid, 'records');
      for (let i = 0; i < 2; i++) {
        pw.push({
          carriedRank: i, trade: i ? 'BBBUSDT' : 'AAAUSDT', ctx1: null, ctx2: null, size: 1,
          geometry: 'daily-4d', bandPct: 2 + i, scoreAll: 1 - i * 0.1, specs: [{}, {}],
        });
      }
      await pw.close();

      // a stage 3 set off it, with every permute off so the block is tiny
      const params = {
        from: pid, carry: 0, nullN: 9, fee: 0, universe: ['AAAUSDT', 'BBBUSDT'],
        decision: 'argmax', band: 'auto', weekdaysOnly: false,
        // no armMult: it is meaningless without a trailMult and the launch says so
        cell: { tHours: 17, entry: 'breakout', gate: 'active', dMult: 1 },
        cellPermute: {}, agreeRule: 'count', agreeBar: 'all', agreePct: 75, agreePersist: 0,
      };
      const doc = {
        id, stage: 3, seq: 999957, name: 'S3 #mc', status: 'done',
        createdAt: '2026-08-27T03:00:00.000Z', parent: { id: pid, name: 'S2 #mc' },
        params, plan: { units: 2, settings: 0, settingLabels: [] }, recordsVersion: stages.RECORDS_V,
      };
      fs.writeFileSync(file, JSON.stringify(doc));

      const first = stages.missingSettingsOf(id);
      assert.ok(first && !first.why, `the block could not be read at all: ${first && first.why}`);
      assert.ok(first.declared > 0, 'the block declares nothing, so this fixture proves nothing');
      assert.strictEqual(first.held, 0, 'the set was built holding nothing');
      assert.strictEqual(first.missing, first.declared, 'holding nothing, everything the block declares is missing');
      assert.strictEqual(first.surplus, 0, 'holding nothing, nothing can be surplus');

      // ASKED AGAIN, THE SAME ANSWER COMES BACK — and comes back as the very
      // same object, which is the only way to be sure it was not worked out
      // twice. This is the whole point of the change.
      assert.strictEqual(stages.missingSettingsOf(id), first,
        'asking twice with nothing changed worked the whole block out again — that is the 18-second '
        + 'answer the owner pays for on every tab switch');

      // ...AND THE LIST BEHIND IT SURVIVES A CHANGE TO WHAT THE SET HOLDS,
      // because a rename or a drop cannot change what the BLOCK declares.
      const keyBefore = stages.declaredKeyFor(stages.getSet(id));

      // now the set holds one of them, as a rename or a fill-in would leave it
      const declared = stages.declaredLabelsFor(stages.getSet(id));
      doc.plan.settingLabels = [declared[0]];
      doc.plan.settings = 1;
      fs.writeFileSync(file, JSON.stringify(doc));

      const second = stages.missingSettingsOf(id);
      assert.notStrictEqual(second, first,
        'the answer did not move after the set changed what it holds — the owner would be shown the '
        + 'old count with total confidence');
      assert.strictEqual(second.held, 1, 'it did not notice the set now holds one');
      assert.strictEqual(second.missing, first.declared - 1, 'the missing count did not come down by the one now held');
      assert.strictEqual(second.surplus, 0, 'a setting the block declares read as surplus');
      assert.strictEqual(stages.declaredKeyFor(stages.getSet(id)), keyBefore,
        'changing what the set HOLDS threw away the list of what its block DECLARES — those are '
        + 'different things, and rebuilding it is the eighteen seconds this change exists to avoid');

      // and something the block does NOT declare reads as surplus
      doc.plan.settingLabels = [declared[0], 'a setting no block would ever declare'];
      doc.plan.settings = 2;
      fs.writeFileSync(file, JSON.stringify(doc));
      const third = stages.missingSettingsOf(id);
      assert.strictEqual(third.surplus, 1, 'a setting the block does not declare did not read as surplus');
      assert.strictEqual(third.missing, first.declared - 1, 'a surplus setting was counted as covering a declared one');
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(pfile, { force: true }); } catch (_) { /* fixture */ }
      try { rowstore.remove(pid); } catch (_) { /* fixture */ }
    }
  },

  // The key is the whole contract: what it includes is what invalidates, and
  // what it leaves out is what survives. Each line here is one of those.
  async theListIsThrownAwayForTheRightReasonsAndKeptForTheRest() {
    const base = {
      id: 'x', parent: { id: 'p-nonexistent' },
      params: { from: 'p-nonexistent', carry: 0, band: 'auto' },
      plan: { settingLabels: ['a', 'b'] },
    };
    const k = (d) => stages.declaredKeyFor(d);
    assert.strictEqual(k(base), k({ ...base }), 'the same set gives two different keys');
    assert.notStrictEqual(k(base), k({ ...base, params: { ...base.params, carry: 10 } }),
      'carrying a different number of units did not throw the list away — a different carry is a '
      + 'different set of units and so a different block');
    assert.notStrictEqual(k(base), k({ ...base, params: { ...base.params, band: 3 } }),
      'a different band did not throw the list away');
    assert.notStrictEqual(k(base), k({ ...base, id: 'y' }), 'two different sets share a key');
    // and the one that must NOT invalidate
    assert.strictEqual(k(base), k({ ...base, plan: { settingLabels: ['a', 'b', 'c', 'd'] } }),
      'changing what the set HOLDS threw away what its block DECLARES');

    // THE PARENT, WHICH THE FIRST HALF OF THIS TEST CANNOT SEE. Above, every
    // case names a parent that does not exist, so a key that ignored the parent
    // entirely would pass all of them — it did, when this was first written.
    // The parent decides which units are carried and what band each one used,
    // so a parent that changes IS a different block.
    const stamp = Date.now().toString(36);
    const pid = `s2-test-${stamp}-pk`;
    const pfile = path.join(SETS_DIR, `${pid}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      const withParent = { ...base, parent: { id: pid }, params: { ...base.params, from: pid } };
      fs.writeFileSync(pfile, JSON.stringify({ id: pid, stage: 2, plan: { units: 1 } }));
      const before = k(withParent);
      assert.notStrictEqual(before, k(base),
        'two sets built off different parents share a key, so one would be answered with the other’s block');
      // the parent's saved sort changes which units are carried, and saving it
      // rewrites the parent's file — which is what this must notice
      fs.writeFileSync(pfile, JSON.stringify({ id: pid, stage: 2, plan: { units: 1 }, sort: [{ key: 'score', dir: 'desc' }] }));
      assert.notStrictEqual(k(withParent), before,
        'the parent changed and the list of what the block declares was kept — the carried units and '
        + 'their bands come from the parent, so that answer is now for a block that no longer exists');
    } finally {
      try { fs.rmSync(pfile, { force: true }); } catch (_) { /* fixture */ }
    }
  },

  // A TALLY BIGGER THAN A STRING CAN BE (found on the owner's own box,
  // 2026-08-30, after the tables "rebuilt" three times and never appeared).
  //
  // Their tally inflates to 553,814,407 bytes. V8 will not make a string longer
  // than 536,870,888, so turning the whole file into one THREW — and the catch
  // around it reported "there is no tally", which is the single answer that
  // makes the caller build another. Twenty minutes a time, producing a file
  // exactly as unreadable, for ever, with the reason discarded.
  //
  // A test below that limit proves nothing at all, so this one crosses it. It
  // costs one big buffer and almost no time: the reader stops at the third
  // newline and never looks at the rest.
  async aTallyTooBigToBeAStringIsStillRead() {
    const LIMIT = require('buffer').constants.MAX_STRING_LENGTH;
    const head = `${JSON.stringify({ v: stages.TALLY_V, builtAt: 'x', rows: 2, ranked: 1, coins: 1 })}\n`;
    const one = `${JSON.stringify({ si: 0, label: 'a', beat: 1, pairs: 2 })}\n`;
    const two = `${JSON.stringify({ cellLabel: 'a', trade: 'AAA', share: 0.5 })}\n`;
    const body = Buffer.from(head + one + two, 'utf8');
    // just past what a string may hold, with no newline in the padding
    const buf = Buffer.alloc(LIMIT + 4096, 0x20);
    body.copy(buf, 0);

    // THE PREMISE: the way it used to be read cannot work at this size.
    assert.throws(() => buf.toString('utf8'),
      'a buffer past the string limit no longer throws when stringified — if that is true the '
      + 'original fault is gone and this test should be reconsidered, not deleted');

    // AND THE FIX: reading it line by line does.
    const t = stages.parseTally(buf);
    assert.strictEqual(t.v, stages.TALLY_V, 'the version did not survive');
    assert.strictEqual(t.rows, 2, 'the row count did not survive');
    assert.deepStrictEqual(t.ranked.map((r) => r.label), ['a'], 'the settings did not survive');
    assert.deepStrictEqual(t.coins.map((r) => r.trade), ['AAA'], 'the coin rows did not survive');
  },

  // A NEW-SHAPE TALLY CUT OFF MID-WRITE. The last line has no newline, so the
  // reader is asked for a "line" that runs to the end of the file — and if that
  // remainder is huge, building a string of it is the same mistake in the same
  // function. It must say what is wrong instead, in its own words.
  async aTallyCutOffMidWriteSaysSoRatherThanBuildingAHugeString() {
    const LIMIT = require('buffer').constants.MAX_STRING_LENGTH;
    const head = `${JSON.stringify({ v: stages.TALLY_V, builtAt: 'x', rows: 9, ranked: 2, coins: 0 })}\n`;
    const buf = Buffer.alloc(LIMIT + 4096, 0x20);
    Buffer.from(head, 'utf8').copy(buf, 0);            // a header, then no newline ever again
    assert.throws(() => stages.parseTally(buf), (err) => {
      assert.ok(/stops without ending its last line/.test(err.message),
        `it stringified the unterminated remainder instead of saying what was wrong: ${err.message}`);
      return true;
    }, 'a truncated tally was read as though it were whole');
  },

  // AND THE OLDER SHAPE AT THAT SIZE TOO. The older shape is one object with no
  // newline anywhere, so looking for "the end of the first line" is looking to
  // the end of the file — and turning THAT into a string is the very thing this
  // avoids. It threw, the throw read as damage, and damage is the one verdict
  // that does not rebuild. The fix for the unreadable file refused to rebuild
  // the unreadable file, live on the owner's box (2026-08-30).
  async anOlderShapeTooBigToBeAStringStillReadsAsOldAndNotAsBroken() {
    const LIMIT = require('buffer').constants.MAX_STRING_LENGTH;
    const buf = Buffer.alloc(LIMIT + 4096, 0x20);      // no newline anywhere
    Buffer.from('{"v":4,"ranked":[', 'utf8').copy(buf, 0);
    assert.throws(() => buf.toString('utf8'), 'the premise is gone');
    let t = null;
    t = stages.parseTally(buf);                        // must not throw
    assert.notStrictEqual(t.v, stages.TALLY_V,
      'an oversized older tally reads as current, so it would be served');
    assert.strictEqual(t.v, -1,
      'an oversized older tally reads as damaged rather than old — damage is never rebuilt, so the '
      + 'tables would never come back');
  },

  // An older tally is one object for the whole file. It must read as an older
  // SHAPE — rebuilt quietly — and never as damage, which would be reported and
  // never rebuilt.
  async theOlderShapeReadsAsOldAndNotAsBroken() {
    const old = Buffer.from(JSON.stringify({ v: 4, builtAt: 'x', rows: 1, ranked: [{ si: 0 }], coins: [] }), 'utf8');
    const t = stages.parseTally(old);
    assert.notStrictEqual(t.v, stages.TALLY_V,
      'a tally of the older shape reads as current, so it would be served with columns the screens no longer show');
  },

  // What a build writes, its reader must read. These two are the pair that came
  // apart, so they are held together here rather than each checked alone.
  async whatTheTotallingWritesIsWhatTheReaderReads() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    assert.ok(!/gunzipSync\([^)]*\)\.toString\('utf8'\)/.test(src),
      'something still turns a whole gzipped file into one string — that is the fault, and it is '
      + 'invisible until the file grows past 536,870,888 bytes');
    const writer = src.slice(src.indexOf('// The header carries the two counts'), src.indexOf('await new Promise((resolve) => { ws.on(\'finish\''));
    assert.ok(/"ranked":\$\{ranked\.length\},"coins":\$\{coins\.length\}\}\\n/.test(writer),
      'the header no longer carries the two counts, so the reader cannot tell where the settings end');
    assert.strictEqual((writer.match(/\\n`\)/g) || []).length, 3,
      'the tally is not written one entry per line, so the reader cannot take it a line at a time');
  },

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
      plan: { units, settings: names.length, settingLabels: names.slice(),
        unitSettings: Array.from({ length: units }, (_, u) => ({ u, held: names.length })), pricings: units * names.length },
      params: {}, recordsVersion: stages.RECORDS_V,
    });
    // names built the way a launch builds them, so a sound set really is sound
    const rec = (si, u, over) => ({
      si,
      label: 'count 75% active d1x t17h · argmax auto 24/7',
      decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
      entry: 'breakout', gate: 'active', dMult: 1, tHours: 17, trailMult: null, armMult: null,
      agreeRule: 'count', agreeBar: 'all', agreePct: 75, agreeCopy: 98, agreeBoth: false, agreePersist: 0,
      members: 6, pnl: 1, trades: 3, holdout: { pnl: 2, trades: 1, stops: 0, vsAlwaysLong: 1 },
      beat: 1, pairs: 9, lead: 1, u, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
      ...(over || {}),
    });
    const NAMES = [
      'count 75% active d1x t17h · argmax auto 24/7',
      'count 75% active d1x t41h · argmax auto 24/7',
      'voices 75% +voice98 active d1x t65h · argmax 3% 24/7',
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
      // this fixture has no stage 2 parent, so WHICH settings each unit holds
      // cannot be checked against the block — and the audit says so
      const exact = res.checks.find((c) => c.name === 'every unit holds exactly the settings that place different orders on it');
      assert.ok(exact && /not checked/.test(exact.detail), 'a block that cannot be rebuilt is said to be unchecked, never silently passed');
    } finally { clean(id); }

    // ---- each way it can be broken, one at a time ----
    const bends = [
      ['a record lost', (rows) => { rows.pop(); },
        ['the records add up to what the units say they hold', 'every unit holds the records it says it does']],
      ['a record filed at the wrong place', (rows) => { rows[1].si = 0; },
        ['every record sits at its own setting’s place', 'no unit holds a setting twice']],
      ['a record past the end of the list', (rows) => { rows[2].si = 99; },
        // 'every setting has a record' correctly stays quiet: setting 2 still has
        // its other unit's record. The audit was right and this list was wrong.
        // A record past the end is not one of the unit's, so that unit is short.
        ['no record sits past the end of the list', 'every unit holds the records it says it does']],
      ['the set says a unit holds more than it does', (rows, doc) => { doc.plan.unitSettings[0].held = 99; },
        ['the records add up to what the units say they hold', 'every unit holds the records it says it does']],
      ['a name today would not write', (rows, doc) => {
        rows.forEach((r) => { if (r.si === 2) r.label = 'voices 75% active d1x t65h · argmax 3% 24/7'; });
        doc.plan.settingLabels[2] = 'voices 75% active d1x t65h · argmax 3% 24/7';
      }, ['every name is the one today’s code would write']],
      ['two settings sharing a name', (rows, doc) => { doc.plan.settingLabels[1] = doc.plan.settingLabels[0]; },
        ['no two settings share a name', 'every record sits at its own setting’s place']],
      ['one unit counted twice and another not at all', (rows) => { rows[3].u = 0; },
        ['every unit holds the records it says it does', 'no unit holds a setting twice']],
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
    for (const fn of ['dropSettingsNamed', 'undoUnfinishedAppend']) {
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
    const NAMES = ['count 75% active d1x t17h · argmax auto 24/7', 'count 75% active d1x t41h · argmax auto 24/7'];
    const rec = (si, u, withCopy) => {
      const r = {
        si, label: NAMES[si], decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
        entry: 'breakout', gate: 'active', dMult: 1, tHours: si ? 41 : 17, trailMult: null, armMult: null,
        agreeRule: 'count', agreeBar: 'all', agreePct: 75, agreeBoth: false, agreePersist: 0,
        pnl: 1, trades: 1, u, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
      };
      // the narrow rows go FIRST, exactly as they did on the box
      return withCopy ? { ...r, agreeCopy: 98 } : r;
    };
    const doc = {
      id, stage: 3, seq: 999959, name: 'S3 #fld', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 2, settings: 2, settingLabels: NAMES.slice(), unitSettings: [{ u: 0, held: 2 }, { u: 1, held: 2 }], pricings: 4 },
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
    const names = ['count 75% active d1x t17h · argmax auto 24/7', 'count 75% active d1x t41h · argmax auto 24/7'];
    const mk = (si, u, label) => ({
      si, label, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
      entry: 'breakout', gate: 'active', dMult: 1, tHours: 17, trailMult: null, armMult: null,
      agreeRule: 'count', agreeBar: 'all', agreePct: 75, agreeBoth: false, agreePersist: 0,
      members: 6, pnl: 10 + si, trades: 3, holdout: { pnl: 30, trades: 4, stops: 1, vsAlwaysLong: 2 },
      beat: 3, pairs: 9, lead: 1.5, u, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
    });
    const doc = {
      id, stage: 3, seq: 999971, name: 'S3 #half', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 3, settings: 2, settingLabels: names.slice(), unitSettings: [{ u: 0, held: 2 }, { u: 1, held: 2 }, { u: 2, held: 2 }], pricings: 6 },
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
        w.push(mk(2, u, 'count 75% active d1x t65h · argmax auto 24/7'));
        w.push(mk(3, u, 'count 75% active d1x t89h · argmax auto 24/7'));
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
    const names = ['count 75% active d1x t17h · argmax auto 24/7'];
    const mk = (si, u, label) => ({
      si, label, u, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
      entry: 'breakout', gate: 'active', dMult: 1, tHours: 17, trailMult: null, armMult: null,
      agreeRule: 'count', agreeBar: 'all', agreePct: 75, agreeBoth: false, agreePersist: 0, pnl: 1,
    });
    const doc = {
      id, stage: 3, seq: 999969, name: 'S3 #uvf', status: 'done', createdAt: new Date().toISOString(),
      plan: { units: 2, settings: 1, settingLabels: names.slice(), unitSettings: [{ u: 0, held: 1 }, { u: 1, held: 1 }], pricings: 2 },
      params: {}, recordsVersion: stages.RECORDS_V,
    };
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(doc));
      const w = rowstore.writer(id, 'records');
      w.push(mk(0, 0, names[0]));                                          // unit 1 of 2 — unit 2 is MISSING
      w.push(mk(1, 0, 'count 75% active d1x t41h · argmax auto 24/7'));    // and an unfinished run on top
      w.push(mk(1, 1, 'count 75% active d1x t41h · argmax auto 24/7'));
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

  // The two refusals are in the pass itself, in the order they have to be
  // asked, and each names what to do about it.
  async everyRefusalIsInThePassAndNotOnlyOnTheScreen() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    const fn = src.slice(src.indexOf('async function appendMissingSettings('), src.indexOf('const AGREED_V ='));
    const at = (needle) => fn.indexOf(needle);
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
    const names = ['a', 'b', 'c', 'd', 'e'].map((k) => `count 75% active d0.25x t${k.charCodeAt(0)}h · argmax auto 24/7`);
    const DECLARED = [names[0], names[2], names[4]];
    const mk = (si, u) => ({
      si, label: names[si], decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
      entry: 'breakout', gate: 'active', dMult: 0.25, tHours: 17 + si, trailMult: null, armMult: null,
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

  async aRecordFiledUnderTheWrongPositionStopsTheWholeThing() {
    const id = `s3-test-${Date.now().toString(36)}-dps`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const names = ['count 75% active d1x t17h · argmax auto 24/7', 'count 75% active d1x t41h · argmax auto 24/7'];
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
      w.push({ si: 0, label: names[0], u: 0, agreeRule: 'count', agreeBar: 'all', agreePct: 75, agreePersist: 0, entry: 'breakout', gate: 'active', dMult: 1, tHours: 17, trailMult: null, armMult: null, pnl: 1 });
      w.push({ si: 0, label: names[1], u: 0, agreeRule: 'count', agreeBar: 'all', agreePct: 75, agreePersist: 0, entry: 'breakout', gate: 'active', dMult: 1, tHours: 41, trailMult: null, armMult: null, pnl: 2 });
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
    // RE-AIMED 2026-08-30 again, and for the better reason. The screen's count
    // no longer needs the setting OBJECTS — it reads the block's list of names
    // out of the cache — so the two callers stopped sharing one call. What must
    // still hold is that they share one DIFFERENCE, and they do: everything
    // goes through undeclaredIn, including missingSettingsIn, which used to
    // keep its own copy of it in the opposite argument order.
    const defs = (src.match(/function missingSettingsIn\(/g) || []).length;
    assert.strictEqual(defs, 1, `the missing settings are defined ${defs} times, not once`);
    const diffs = (src.match(/const undeclaredIn = /g) || []).length;
    assert.strictEqual(diffs, 1, `the set difference is defined ${diffs} times, not once`);
    const fn = src.slice(src.indexOf('function missingSettingsIn('), src.indexOf('function nextSettingNumber('));
    assert.ok(/undeclaredIn\(/.test(fn),
      'the pass that prices the missing settings works the difference out for itself again, instead '
      + 'of taking the one every other caller takes');
    assert.ok(!/new Set\(held\)/.test(fn),
      'it is back to keeping its own set of the held names — that is the second copy, and the last '
      + 'time there were two they disagreed about how');
    // and the screen's count reads the cached list rather than rebuilding it
    const of = src.slice(src.indexOf('function missingSettingsOf('), src.indexOf('function missingSettingsOf(') + 1800);
    assert.ok(/declaredLabelsFor\(doc\)/.test(of) && !/relaunchShapeOf\(doc\)/.test(of),
      'the count on the screen rebuilds the whole block again — that is the eighteen and a half '
      + 'seconds the owner pays on every tab switch, filter, page turn and sort');
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
    assert.ok(/const newSi = new Map\(missing\.map\(\(st, k\) => \[st\.si, nextSi \+ k\]\)\);/.test(fn) && /si: row\.si,/.test(fn),
      'new settings do not take numbers after everything on disk, carried on the setting to the worker');
    assert.ok(/if \(nextSi !== held\.length\)/.test(fn),
      'nothing checks that the names on the set and the numbers in its records agree before adding to them');
    // both gates, before a row is priced
    assert.ok(/tallyBudgetFor\(\{ settings: held\.length \+ missing\.length/.test(fn),
      'the memory gate is not asked about what the set WOULD hold, so filling in could make its tables unbuildable');
    assert.ok(/storeBudgetFor\(/.test(fn), 'the disk gate is not asked at all');
    assert.ok(/const busy = stageBusy\(\);/.test(fn), 'it can start on top of another heavy job');
    // one payload builder, so what is appended is priced exactly as the first rows were
    assert.ok(/s3Payload\(\{ doc, parent, rec, settings: missing\.filter\(\(st\) => mine\.has\(st\.si\)\)\.map\(\(st\) => \(\{ \.\.\.st, si: newSi\.get\(st\.si\) \}\)\), fee, nullN \}\)/.test(fn),
      'the append builds its own payload, so it can drift from what the launch hands the workers — and a unit is handed only the missing settings it holds, each carrying its new place');
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
    assert.ok(/Prev<\/button>/.test(pager) && /Next<\/button>/.test(pager),
      'typing a page must be added BESIDE Prev and Next, not instead of them');

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


  // TUNING-SLICE MONEY (3.46.0): the members' lean priced on the label window,
  // pencilled by hand, and held against copies dealt onto other days of the
  // same slice. A copy whose money equals the real to the cent is NOT beaten.
  theTuningSliceMoneyPricesTheLeanOfTheVotesAgainstItsNullSet() {
    const HOUR = 3600 * 1000;
    const geo = { entryOffsetH: 1, exitOffsetH: 3 };
    const t0 = Date.UTC(2024, 0, 1);
    const chunks = [0, 1, 2, 3].map((i) => ({ startTs: t0 + i * 24 * HOUR }));
    const mapFor = (exits) => {
      const m = new Map();
      chunks.forEach((c, i) => {
        m.set(c.startTs + 1 * HOUR, { open: 100, high: 100, low: 100, close: 100 });
        m.set(c.startTs + 3 * HOUR, { open: exits[i], high: exits[i], low: exits[i], close: exits[i] });
      });
      return m;
    };
    // two members: lean up, up, an exact tie, down
    const m1 = [[0.2, 0.3, 0.5], [0.1, 0.2, 0.7], [0.4, 0.2, 0.4], [0.7, 0.2, 0.1]];
    const m2 = [[0.3, 0.3, 0.4], [0.3, 0.3, 0.4], [0.3, 0.4, 0.3], [0.6, 0.3, 0.1]];
    const calls = sw.directionCalls([m1, m2], [0, 1], 4);
    assert.deepStrictEqual(calls, [1, 1, 0, -1], 'buy when the members lean up, sell when they lean down, nothing on a tie');
    assert.deepStrictEqual(sw.directionCalls([m1, m2], [1], 4), [1, 1, 0, -1], 'one member alone leans the same way here');
    // $100 a trade: +10 on the rise, -5 on the fall, stood aside, -4 short into a rise
    const tm = mapFor([110, 95, 100, 104]);
    const gross = sw.directionMoney(chunks, calls, tm, geo, 0);
    assert.ok(Math.abs(gross.pnl - 1) < 1e-9, `the pencil says +1.00 before fees, got ${gross.pnl}`);
    assert.strictEqual(gross.trades, 3);
    // a fee of 0.1% a leg is 20 cents a round trip on $100: three trades, 60 cents
    const net = sw.directionMoney(chunks, calls, tm, geo, 0.001);
    assert.ok(Math.abs(net.pnl - 0.4) < 1e-9, `after fees +0.40, got ${net.pnl}`);
    assert.throws(() => sw.directionMoney(chunks, calls, tm, geo, undefined), /fee % each way is required/);
    // against its null set: the same calls dealt onto other days, in cents, strictly beaten
    const got = sw.moneyAgainstNull({ chunks, calls, tradeMap: tm, geo, fee: 0.001, seed: 7, unitKey: 'X|||daily-1d', nullN: 5 });
    assert.strictEqual(got.money, 0.4);
    assert.strictEqual(got.pairs, 5);
    assert.strictEqual(got.nullMoney.length, 5);
    assert.strictEqual(got.chunks, 4);
    for (let d = 0; d < 5; d++) {
      const order = sw.dealOrder(7, 'X|||daily-1d', `s1val#${d}`, 4);
      const want = sw.cents(sw.directionMoney(chunks, order.map((k) => calls[k]), tm, geo, 0.001).pnl);
      assert.strictEqual(got.nullMoney[d], want, `copy ${d} is the real calls on the dealt days`);
    }
    assert.strictEqual(got.beat, got.nullMoney.filter((m) => got.money > m).length, 'beat counts the copies the real money strictly exceeds');
    assert.strictEqual(got.lead, sw.leadOver(got.money, got.nullMoney));
    // every day ends at the same price, so every copy earns exactly the real
    // money: nothing is beaten, whatever the order
    const flat = mapFor([105, 105, 105, 105]);
    const tie = sw.moneyAgainstNull({ chunks, calls, tradeMap: flat, geo, fee: 0.001, seed: 7, unitKey: 'X|||daily-1d', nullN: 6 });
    assert.ok(tie.nullMoney.every((m) => m === tie.money), 'the fixture must make every copy equal the real');
    assert.strictEqual(tie.beat, 0, 'a copy equal to the real to the cent is not beaten');
    assert.strictEqual(tie.lead, 0);
    // the tuning slice is the last nVal training chunks, sized from the votes on it
    const train = Array.from({ length: 10 }, (_, i) => ({ startTs: i }));
    assert.deepStrictEqual(sw.tuningSliceOf(train, [[1, 2, 3, 4], [1, 2, 3, 4]]).map((c) => c.startTs), [6, 7, 8, 9]);
    assert.throws(() => sw.tuningSliceOf(train, [[1, 2, 3], [1, 2]]), /disagree in length/);
    assert.throws(() => sw.tuningSliceOf(train.slice(0, 2), [[1, 2, 3]]), /more tuning-slice votes/);
    assert.throws(() => sw.tuningSliceOf(train, [[]]), /no votes on the tuning slice/);
    assert.strictEqual(sw.TUNING_TAG, 's1val');
  },

  // The stage 1 and 2 tables serve the tuning-slice money, sort and filter by
  // it through the same saved-sort machinery, and say when a set was written
  // before the money existed -- and the fill refuses without a fee.
  async theStageTablesServeTheTuningSliceMoney() {
    const id = `s1-test-${Date.now().toString(36)}-m`;
    const file = path.join(SETS_DIR, `${id}.json`);
    const idOld = `${id}-old`;
    const fileOld = path.join(SETS_DIR, `${idOld}.json`);
    const id2 = `s2-test-${Date.now().toString(36)}-m`;
    const file2 = path.join(SETS_DIR, `${id2}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ id, stage: 1, seq: 999981, name: 'S1 #money', status: 'done', createdAt: new Date().toISOString(), plan: { units: 3 }, params: { nullN: 4, fee: 0.00125 } }));
      const rec = rowstore.writer(id, 'records');
      // beat (forecast score) runs one way, beatMoney the other, so a sort by
      // the money share cannot be a sort by the score share in disguise
      const units = [
        { u: 0, beat: 4, lead: 2, score: 10, money: -3.5, beatMoney: 0, leadMoney: -1.2 },
        { u: 1, beat: 2, lead: 1, score: 9, money: 12.25, beatMoney: 4, leadMoney: 2.1 },
        { u: 2, beat: 3, lead: 1.5, score: 8, money: 1, beatMoney: 2, leadMoney: 0.3 },
      ];
      for (const x of units) {
        rec.push({ u: x.u, trade: `C${x.u}`, ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', bandPct: 2, counts: {}, specs: [], score: x.score, beat: x.beat, pairs: 4, lead: x.lead, nullScores: [], money: x.money, moneyTrades: 3, moneyChunks: 4, nullMoney: [0, 0, 0, 0], beatMoney: x.beatMoney, leadMoney: x.leadMoney, blocks: {} });
      }
      rec.close();
      const rk = rowstore.writer(id, 'ranking');
      rk.push({ rank: 1, u: 0, beat: 4, pairs: 4, lead: 2, score: 10, money: -3.5, beatMoney: 0, leadMoney: -1.2 });
      rk.push({ rank: 2, u: 2, beat: 3, pairs: 4, lead: 1.5, score: 8, money: 1, beatMoney: 2, leadMoney: 0.3 });
      rk.push({ rank: 3, u: 1, beat: 2, pairs: 4, lead: 1, score: 9, money: 12.25, beatMoney: 4, leadMoney: 2.1 });
      rk.close();
      const page = stages.stage1Table(id, 0, 10);
      assert.deepStrictEqual(page.rows.map((r) => [r.trade, r.money, r.beatMoney, r.leadMoney]),
        [['C0', -3.5, 0, -1.2], ['C2', 1, 2, 0.3], ['C1', 12.25, 4, 2.1]], 'the fixed rule still orders; the money rides on every row');
      stages.setSetSort(id, [{ key: 'beatMoney', dir: 'desc' }]);
      assert.deepStrictEqual(stages.stage1Table(id, 0, 10).rows.map((r) => r.trade), ['C1', 'C2', 'C0'], 'sorted by the share of its null set the tuning-slice $ beat');
      stages.setSetSort(id, [{ key: 'money', dir: 'asc' }]);
      assert.deepStrictEqual(stages.stage1Table(id, 0, 10).rows.map((r) => r.trade), ['C0', 'C2', 'C1'], 'and by the money itself');
      assert.deepStrictEqual(stages.stage1Table(id, 0, 10, { moneyMin: 0 }).rows.map((r) => r.trade), ['C2', 'C1'], 'a floor on the money');
      assert.deepStrictEqual(stages.stage1Table(id, 0, 10, { beatMoneyMin: 60 }).rows.map((r) => r.trade), ['C1'], 'a floor on the money share, in percent');
      assert.strictEqual(stages.sortLabel([{ key: 'beatMoney', dir: 'desc' }]), 'beat its own null set — tuning-slice $ high to low', 'the chain line says the column\'s own words');
      // a record carrying no money reads as nothing, never as zero
      fs.writeFileSync(fileOld, JSON.stringify({ id: idOld, stage: 1, seq: 999980, name: 'S1 #old', status: 'done', createdAt: new Date().toISOString(), plan: { units: 1 }, params: { nullN: 4 } }));
      const old = rowstore.writer(idOld, 'records');
      old.push({ u: 0, trade: 'C0', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', bandPct: 2, counts: {}, specs: [], score: 10, beat: 4, pairs: 4, lead: 2, nullScores: [], blocks: {} });
      old.close();
      const rko = rowstore.writer(idOld, 'ranking');
      rko.push({ rank: 1, u: 0, beat: 4, pairs: 4, lead: 2, score: 10 });
      rko.close();
      assert.deepStrictEqual(stages.stage1Table(idOld, 0, 10).rows.map((r) => [r.money, r.beatMoney, r.leadMoney]), [[null, null, null]], 'and the money reads as nothing, never as zero');
      // the stage 2 table: both money readings and the sort
      fs.writeFileSync(file2, JSON.stringify({ id: id2, stage: 2, seq: 999979, name: 'S2 #money', status: 'done', createdAt: new Date().toISOString(), plan: { units: 2 }, params: { nullN: 4, fee: 0.00125 } }));
      const rec2 = rowstore.writer(id2, 'records');
      rec2.push({ u: 0, carriedRank: 1, s1rank: 1, trade: 'C0', ctx1: null, ctx2: null, geometry: 'daily-4d', specs: [], score3: 4, scoreAll: 5, helped: 1, beat: 3, pairs: 4, lead: 2.5, money3: -3.5, money: 2, nullMoney: [0, 0, 0, 0], beatMoney: 3, leadMoney: 0.8 });
      rec2.push({ u: 1, carriedRank: 2, s1rank: 2, trade: 'C1', ctx1: null, ctx2: null, geometry: 'daily-4d', specs: [], score3: 8, scoreAll: 9, helped: 1, beat: 4, pairs: 4, lead: 4, money3: 12.25, money: -1, nullMoney: [0, 0, 0, 0], beatMoney: 1, leadMoney: -0.4 });
      rec2.close();
      const t2 = stages.stage2Table(id2, 0, 10);
      assert.deepStrictEqual(t2.rows.map((r) => [r.trade, r.money3, r.moneyAll, r.beatMoney, r.leadMoney]), [['C1', 12.25, -1, 1, -0.4], ['C0', -3.5, 2, 3, 0.8]]);
      stages.setSetSort(id2, [{ key: 'moneyAll', dir: 'desc' }]);
      assert.deepStrictEqual(stages.stage2Table(id2, 0, 10).rows.map((r) => r.trade), ['C0', 'C1'], 'sorted by the tuning-slice $ with every member pooled');
      assert.deepStrictEqual(stages.stage2Table(id2, 0, 10, { moneyAllMin: 0 }).rows.map((r) => r.trade), ['C0']);
    } finally {
      for (const [f, sid] of [[file, id], [fileOld, idOld], [file2, id2]]) {
        try { fs.rmSync(f, { force: true }); } catch (_) { /* fixture */ }
        try { fs.rmSync(rowstore.storeDir(sid), { recursive: true, force: true }); } catch (_) { /* fixture */ }
      }
    }
  },

  // THE TWO BOXES THAT NAME A PARENT FOLLOW WHAT IS ON THE BOX (3.76.1, owner
  // order 2026-09-06: "the stage one sweep just finished. the stage two box
  // still says no finished stage one record set on this box. Fix that. When
  // the stage one sweep finishes, you must refresh the stage two boxes. When
  // the stage two sweep finishes, obviously, you must refresh the stage three
  // box.").
  //
  // Both were filled once, when the screen was drawn, and never again -- so a
  // run watched from this screen landed, its set finished and on disk, and the
  // only way to see it in the box below was to reload the page.
  //
  // The half that already worked is the model: the poll refreshes the greyed
  // name suggestion in each name box on every tick. The boxes that name a
  // parent now do the same, off the same fetch, through the same builder a
  // fresh draw uses -- and on the tick that finds the run has ENDED, which is
  // the one the owner is sitting there waiting for.
  theTwoBoxesThatNameAParentAreRebuiltWhenWhatIsOnTheBoxMoves() {
    // whole-line comments stripped: a test that matches the sentence
    // DESCRIBING a fault passes without the fault being fixed
    const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const prog = UI.indexOf('async function swProgress(');
    assert.ok(prog >= 0, 'swProgress is gone');
    const ended = UI.indexOf('if (!st.running) {', prog);
    const refill = UI.indexOf('swRefillParents(', prog);
    assert.ok(refill >= 0, 'the poll never rebuilds the two boxes that name a parent');
    assert.ok(refill < ended,
      'the rebuild sits after the not-running branch returns, so the tick that finds the run has ENDED -- the only '
      + 'one that matters -- skips it, and the box goes on saying there is no finished set');
    // the list held in hand moves with them: the heading colours and the stage
    // 3 cost line are both judged off it, so a stale copy answers for a box
    // that has just changed
    const cache = UI.indexOf('swSetsCache = st.sets', prog);
    assert.ok(cache >= 0 && cache < refill, 'the set list held in hand is not refreshed before the boxes are rebuilt');

    const i = UI.indexOf('function swRefillParents(');
    assert.ok(i >= 0, 'swRefillParents is gone');
    const fn = UI.slice(i, UI.indexOf('\n}\n', i));
    assert.ok(/\['#swFrom2', 1\], \['#swFrom3', 2\]/.test(fn),
      'both boxes are not covered -- the owner asked for the stage 2 box on a stage 1 landing AND the stage 3 box on a stage 2 one');
    assert.strictEqual((fn.match(/swSetOptions\(/g) || []).length, 2,
      'the rebuild does not go through the same builder the draw uses, so the two screens can say different things');
    assert.ok(/swSetOptions\(sets, stage, box\.value \|\| null\)/.test(fn),
      "the rebuild drops the owner's choice instead of keeping the set the box already names");
    // COMPARED WITHOUT THE SELECTION, or the owner picking a set reads as the
    // list having moved and the next tick rewrites the box under their cursor,
    // which closes an open dropdown -- every four seconds
    assert.ok(/swSetOptions\(sets, stage, null\)/.test(fn),
      'the comparison includes which option is selected, so the owner picking a set counts as the list moving');
    assert.ok(/if \(swParentShown\.get\(sel\) === shape\) continue;/.test(fn),
      'a box with nothing new in it is rewritten anyway, which closes a dropdown the owner has open');

    // THE COLOURS ARE SET ON EVERY TICK, NOT ONLY WHEN A BOX MOVED (3.76.2).
    // Filling the box and setting the colour are two answers to one event, and
    // hanging the second off the first is what leaves them disagreeing: a
    // heading is judged from the set its own box names, the row behind that
    // set, and the boxes in the section above -- and rebuilding the options
    // only ever watches the first.
    const paint = UI.indexOf('swProvenance();', prog);
    const guard = UI.indexOf('if (swMoved) {', prog);
    assert.ok(paint > refill, 'the poll never repaints the stage headings');
    assert.ok(guard > paint,
      'the heading colours are set only when the boxes moved, so a colour judged off the section above it or off the '
      + 'row behind the named set is left saying what was true a tick ago');
    // re-asking the counts is NOT free -- it blanks both cost lines to an
    // asking note -- so it stays behind the boxes actually having moved, or it
    // would flicker them for as long as the page is open
    const gated = UI.slice(guard, guard + 200);
    for (const duty of ['rememberSweepForm();', 'swCountsSoon();']) {
      assert.ok(gated.indexOf(duty) > 0, `a rebuilt box does not ${duty.slice(0, -3)} the way one changed by hand does`);
    }
    assert.ok(!/swCountsSoon\(\);[\s\S]{0,40}\n  \}/.test(UI.slice(paint, guard)),
      'the counts are re-asked on every tick, which blanks both cost lines to an asking note every four seconds');

    // the draw tells the poll what it put on screen, so the first tick after
    // opening Sweep rewrites neither box
    const draw = UI.indexOf('async function drawSweep(');
    const seed = UI.slice(draw, draw + 1200);
    assert.ok(/swParentShown\.set\('#swFrom2', swOpt1\);/.test(seed) && /swParentShown\.set\('#swFrom3', swOpt2\);/.test(seed),
      'the draw does not tell the poll what it put on screen, so the first tick rewrites both boxes');
    assert.ok(/<select id="swFrom2" style="min-width:24rem">\$\{swOpt1\}<\/select>/.test(UI)
      && /<select id="swFrom3" style="min-width:24rem">\$\{swOpt2\}<\/select>/.test(UI),
      'the draw builds its options a second time instead of the one it seeded with, so the two can drift apart');
  },

  // THE CARRY READS THE TABLE AS THE OWNER HAS IT (3.78.0, owner order
  // 2026-09-06: "the carry from table 2 must NOT ignore filters!").
  //
  // The filters on the stage 2 table were a view and nothing more. The carry
  // read the raw records, so the owner could cut the table to the rows they
  // meant to carry, press start, and get the top N of a table they were not
  // looking at -- silently, with the screen showing the other one.
  //
  // Two halves are tested: the filters live on the record set now, so a launch
  // can read them at all; and the carry goes through the same rows, order and
  // filters the screen does.
  theCarryTakesTheTopOfTheTableTheOwnerIsLookingAt() {
    const id = `s2-test-${Date.now().toString(36)}-flt`;
    const file = path.join(SETS_DIR, `${id}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({
        id, stage: 2, seq: 999960, name: 'S2 #flt', status: 'done', createdAt: new Date().toISOString(),
        plan: { units: 6 }, params: { nullN: 20 },
      }));
      // six units: three weekly, three daily, and a money order that does NOT
      // line up with the shapes -- so a filter on shape and a cut by rank can
      // be told apart
      const w = rowstore.writer(id, 'records');
      const units = [
        { u: 0, geometry: 'weekly-8d', scoreAll: 9, beatMoney: 20 },
        { u: 1, geometry: 'daily-4d', scoreAll: 8, beatMoney: 19 },
        { u: 2, geometry: 'weekly-8d', scoreAll: 7, beatMoney: 18 },
        { u: 3, geometry: 'daily-4d', scoreAll: 6, beatMoney: 17 },
        { u: 4, geometry: 'weekly-8d', scoreAll: 5, beatMoney: 16 },
        { u: 5, geometry: 'daily-4d', scoreAll: 4, beatMoney: 4 },
      ];
      for (const x of units) {
        w.push({
          u: x.u, carriedRank: x.u + 1, s1rank: x.u + 1, trade: `C${x.u}`, ctx1: null, ctx2: null,
          geometry: x.geometry, specs: [], score3: 1, scoreAll: x.scoreAll, helped: 0,
          beat: 10, pairs: 20, lead: 1, money: 5, beatMoney: x.beatMoney, leadMoney: 1, blocks: {},
        });
      }
      w.close();

      const carried = (carry) => stages.stage3UnitsFor(stages.getSet(id), carry).records.map((r) => r.u);

      // with nothing saved, the carry is the whole table in its own order
      assert.deepStrictEqual(carried(0), [0, 1, 2, 3, 4, 5], 'the unfiltered carry is not the whole table');
      assert.deepStrictEqual(carried(3), [0, 1, 2], 'the unfiltered carry does not take the top of the table');

      // THE FILTERS SAVE ON THE SET, through the one definition of what a
      // filter is -- a box the table does not offer is refused by name
      assert.throws(() => stages.setSetFilters(id, { notAFilter: '1' }), /is not a filter on the stage 2 table/,
        'a filter the table never offered is saved anyway, and the launch would read something the owner cannot see');
      stages.setSetFilters(id, { geometry: 'daily' });
      assert.deepStrictEqual(stages.getSet(id).filters, { geometry: 'daily' }, 'the filters are not on the record set');

      // ...AND THE CARRY READS THEM
      assert.deepStrictEqual(carried(0), [1, 3, 5],
        'carry forward 0 still prices every record on the set instead of every record the table is showing');
      assert.deepStrictEqual(carried(2), [1, 3],
        'the carry takes the top of the WHOLE set rather than the top of the table the owner filtered');

      // a filter on a field that only exists once the row is built -- this is
      // the class that would have matched nothing against a raw record
      stages.setSetFilters(id, { beatMoneyMin: '80' });
      assert.deepStrictEqual(carried(0), [0, 1, 2, 3, 4],
        'a filter on a share worked out from two fields of the record does not reach the carry');

      // TICKS ARE NOT FILTERED. A tick is the owner naming that record, and
      // nothing may quietly take it back off the list.
      const picked = stages.stage3UnitsFor(stages.getSet(id), 0, [0, 5]).records.map((r) => r.u);
      assert.deepStrictEqual(picked, [0, 5], 'a saved filter cuts records the owner ticked by hand');

      // and clearing them puts the whole table back
      stages.setSetFilters(id, {});
      assert.strictEqual(stages.getSet(id).filters, null, 'an empty filter list is stored rather than put away');
      assert.deepStrictEqual(carried(0), [0, 1, 2, 3, 4, 5], 'cleared filters still cut the carry');

      // THE SCREEN AND THE CARRY READ THE SAME THREE STEPS. Whatever the table
      // shows for a filter is exactly what the carry takes the top of.
      stages.setSetFilters(id, { geometry: 'weekly' });
      const shown = stages.stage2Table(id, 0, 100, { geometry: 'weekly' }).rows.map((r) => r.u);
      assert.deepStrictEqual(carried(0), shown,
        `the table shows ${JSON.stringify(shown)} and the carry takes ${JSON.stringify(carried(0))} — they are two different tables`);
    } finally {
      try { fs.rmSync(file, { force: true }); } catch (_) { /* fixture */ }
      try { fs.rmSync(rowstore.storeDir(id), { recursive: true, force: true }); } catch (_) { /* fixture */ }
    }
  },

  // A STAGE 3 LAUNCH WAS REFUSED FOR PRICE FILES THAT NEVER MOVED (3.77.1,
  // owner 2026-09-06: "this message on the s3 sweep is wrong ... the price
  // files changed since S2 #1 was written (all 16 coins listed)").
  //
  // Nothing had changed. A stage 1 set's plan carries its unit list, so the set
  // is fingerprinted over every coin in it -- seventeen for the owner's LTCUSDT
  // triples. A STAGE 2 set's plan carries only a count, so working the coins
  // out that way fell through to its trade coins and gave ONE. The stage 3
  // launch held a seventeen-coin fingerprint up to a one-coin fingerprint,
  // found sixteen coins in the first and not the second, and called them price
  // files that had changed. Every stage 3 launch out of a stage 2 set was
  // refused on a comparison that was never like for like.
  //
  // Two things are wrong there and both are tested: which coins get read again,
  // and calling a coverage difference a change in the data.
  theCoinsReadAgainAreTheOnesTheRecordWasFingerprintedOver() {
    const seventeen = ['LTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'SOLUSDT', 'DOGEUSDT', 'LINKUSDT',
      'DOTUSDT', 'AVAXUSDT', 'TRXUSDT', 'XLMUSDT', 'ETCUSDT', 'ATOMUSDT', 'BCHUSDT', 'UNIUSDT', 'ZECUSDT'];
    const manifest = { overallDigest: 'abc', symbols: Object.fromEntries(seventeen.map((c) => [c, { digest: 'd', files: 1, bytes: 1 }])) };

    // the owner's own stage 2 set: a plan with a count and no unit list
    const s2 = { name: 'S2 #1', stage: 2, plan: { units: 600 }, params: { universe: ['LTCUSDT'] }, dataManifest: manifest };
    assert.deepStrictEqual(stages.coinsFingerprinted(s2).slice().sort(), seventeen.slice().sort(),
      'the coins read again come from the set\'s trade coins rather than from what it was actually fingerprinted over, '
      + 'so a seventeen-coin record is held up to a one-coin reading and sixteen coins report as changed');

    // a stage 1 set answers the same, off the same record
    const s1 = {
      name: 'S1 #1', stage: 1, dataManifest: manifest,
      plan: { units: 2, unitList: [{ trade: 'LTCUSDT', ctx1: 'ETHUSDT', ctx2: 'BNBUSDT' }] },
      params: { universe: ['LTCUSDT'] },
    };
    assert.deepStrictEqual(stages.coinsFingerprinted(s1).slice().sort(), seventeen.slice().sort(),
      'a set with a unit list is read over something other than its own price-file record');

    // and a set with no record at all still answers, off its units
    const bare = { name: 'S1 #new', stage: 1, plan: { units: 1, unitList: [{ trade: 'AAAUSDT', ctx1: 'BBBUSDT' }] }, params: {} };
    assert.deepStrictEqual(stages.coinsFingerprinted(bare), ['AAAUSDT', 'BBBUSDT'],
      'a set carrying no price-file record yet cannot say which coins to read');

    // A COVERAGE DIFFERENCE IS NOT A PRICE-FILE CHANGE, and must not say it is.
    const moved = stages.manifestComplaint({ same: false, changed: ['LTCUSDT'], onlyA: [], onlyB: [] }, 'S2 #1');
    assert.ok(/price files changed since S2 #1 was written \(LTCUSDT\)/.test(moved), moved);
    const uneven = stages.manifestComplaint({ same: false, changed: [], onlyA: ['ETHUSDT', 'BNBUSDT'], onlyB: [] }, 'S2 #1');
    assert.ok(!/price files changed/.test(uneven),
      `two fingerprints over different coins are reported as changed data: ${uneven}`);
    assert.ok(/not measured over the same coins/.test(uneven) && /ETHUSDT, BNBUSDT/.test(uneven), uneven);
    // a real change is named even when the coverage differs too -- the moved
    // file is the thing that stops a launch, and it is what gets said
    const both = stages.manifestComplaint({ same: false, changed: ['XRPUSDT'], onlyA: ['ETHUSDT'], onlyB: [] }, 'S2 #1');
    assert.ok(/price files changed/.test(both) && /XRPUSDT/.test(both), both);

    // and both readers read the record itself, so neither can drift: since
    // 3.84.0 a set is pinned to the files its stamp lists, and the chain check
    // and the fill ask whether THOSE files are intact -- nothing is stamped
    // afresh over coins worked out some other way
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    for (const who of ['check-', 'unitfill-']) {
      assert.ok(!src.includes(`stampManifest(\`${who}`), `the ${who.replace('-', '')} check stamps afresh instead of reading the pinned files off the record`);
    }
    const chain = src.slice(src.indexOf('function parentOrRefuse('), src.indexOf('const recordsInHand'));
    assert.ok(chain.includes('pinnedIntact(parent.dataManifest)') && chain.includes('pinComplaint(pinned, parent.name)'), 'the chain check asks whether the parent\'s pinned files are intact, and names the files');
    const fill = src.slice(src.indexOf('function unitFillRefusal('), src.indexOf('function parentOrRefuse('));
    assert.ok(fill.includes('pinnedIntact(doc.dataManifest)') && fill.includes('pinComplaint(pinned, doc.name)'), 'the fill asks whether the set\'s pinned files are intact, and names the files');
    assert.ok(!/\[\.\.\.diff\.changed, \.\.\.diff\.onlyA, \.\.\.diff\.onlyB\]/.test(src),
      'a refusal still lumps coins that moved together with coins that were never read, and calls them all changed');
  },

  // A FIELD THE CHECK READS AND THE SERVICE DOES NOT SEND (3.76.5, owner:
  // "still red — the line says trade coins don't match").
  //
  // The screen judges a stage 1 record set on nine things. The service hands
  // the page a TRIMMED copy of a set's params, and two of the nine -- `compare`
  // and `trainOn` -- were never in it. Both were added to what a run records
  // without being added to what is served, so on the page they read as absent:
  // every set launched with doubles or triples disagreed about the compare
  // coins, and every set trained by the money each trade was worth disagreed
  // about that. Stage 2 was red on arrival and no box could clear it.
  //
  // The two sides are held together here by NAME. Every field the check names
  // is looked up in what publicParams actually returns, so adding a comparison
  // to one side and not the other fails the suite instead of painting a
  // heading red for ever.
  theProvenanceCheckIsSentEveryFieldItReads() {
    const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const at = UI.indexOf('function swProvenance() {');
    const whole = UI.slice(at, UI.indexOf('\n}\n', at));
    // ONLY the block where `p` IS the record set's params. Scanned whole, this
    // also picks up the `p` that is a paragraph element further down, and a
    // test that reports style and innerHTML as missing fields is noise.
    const from = whole.indexOf('const p = s1row.params || {};');
    const fn = whole.slice(from, whole.indexOf("paint('#swH2'", from));
    assert.ok(fn.length > 300, 'the stage 2 judgement is gone');
    const sent = stages.publicParams({ params: {} });
    const reads = [...new Set([...fn.matchAll(/\bp\.([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]))];
    assert.ok(reads.length >= 6, `the check reads only ${reads.length} fields off the record set — it is not being read`);
    const absent = reads.filter((k) => !(k in sent));
    assert.deepStrictEqual(absent, [],
      `the stage heading judges a record set by ${absent.join(', ')}, and the service never sends `
      + `${absent.length > 1 ? 'those fields' : 'that field'} to the page — so every set disagrees about `
      + `${absent.length > 1 ? 'them' : 'it'} and the heading is red whatever the owner types`);
  },

  // THE STAGE HEADINGS, RUN RATHER THAN GREPPED (3.76.4, owner: "STILL RED").
  //
  // The tests around these colours all scanned the source for spellings, and a
  // spelling test cannot answer the only question that matters: given a record
  // set that WAS launched from these boxes, what colour comes out? So this one
  // lifts swProvenance out of the page, gives it a stub screen and the exact
  // params the owner's own S1 #1 recorded, and reads the answer.
  //
  // It also reads the line the screen now prints under a red heading, because
  // a colour with no way to act on it cost three sittings: the reason lived in
  // the heading's hover and nowhere else.
  theStageHeadingsFollowTheOwnersTruthTableRowForRow() {
    const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const at = UI.indexOf('function swProvenance() {');
    assert.ok(at > 0, 'swProvenance is gone');
    const body = UI.slice(at, UI.indexOf('\n}\n', at) + 3);
    // ITS OWN LIST, NOT THE MACHINE'S CACHE. This is a truth table about
    // colours; which coins are downloaded where it runs is not part of it.
    // BTCUSDT is deliberately NOT in it: two rows below type that coin into a
    // box precisely because it is one the set was not run with.
    const DEFAULTS = ['LTCUSDT', 'ETHUSDT', 'XRPUSDT', 'ADAUSDT', 'SOLUSDT'];

    // the owner's own set, read off the box 2026-09-06
    // THROUGH publicParams, WHICH IS WHAT THE PAGE ACTUALLY RECEIVES. Handing
    // this test the whole set document is how the last fault got through: the
    // check read `compare` and `trainOn`, the service sent neither, and a test
    // fed the full document could never see it (owner, 2026-09-06: "STILL
    // RED"). What the screen is given is what the screen is tested on.
    const S1 = {
      id: 's1-a', name: 'S1 #1',
      params: stages.publicParams({
        params: {
          universe: ['LTCUSDT'], compare: DEFAULTS.slice(),
          sizes: { singles: false, doubles: false, triples: true },
          geometries: ['weekly-8d', 'daily-1d', 'daily-2d', 'daily-3d', 'daily-4d'],
          windowLayout: 'reserve61', trainOn: 'money', weightCap: 5, nullN: 20, fee: 0.00125,
          allLoaded: true, startMonth: '2019-11', endMonth: '2026-09',
        },
      }),
    };
    const S2 = { id: 's2-a', name: 'S2 #1', parent: { id: 's1-a', name: 'S1 #1', carry: 600, of: 600 } };
    const run = (over = {}, ticksOver = {}) => {
      const BOX = {
        '#swUni': 'LTCUSDT', '#swCompare': '', '#swLayout': 'reserve61', '#swGeom': 'daily-4d',
        '#swNull1': '20', '#swStart': '2019-11', '#swEnd': '2026-09',
        '#swFrom2': 's1-a', '#swFrom3': 's2-a', '#swCarry': '600', ...over,
      };
      const TICK = {
        '#swSingles': false, '#swDoubles': false, '#swTriples': true,
        '#swPermGeom': true, '#swByMoney': true, '#swAllData': true, ...ticksOver,
      };
      // WHERE THIS RUN TAKES ITS UNITS FROM (3.185.0): three choices, one of
      // which is on. Each carries the value the launch is sent, so the reader
      // below is the page's own and not a second copy of it.
      const SOURCE = {
        '#swSourceOff': 'none', '#swSourcePass': 'passers', '#swSourceWalk': 'walk',
      };
      const el = {};
      // eslint-disable-next-line no-unused-vars
      const $ = (sel) => {
        if (/^#sw(H|Why)/.test(sel)) { el[sel] = el[sel] || { style: { color: 'UNSET' }, title: '', innerHTML: '' }; return el[sel]; }
        if (sel in SOURCE) return { checked: (ticksOver.source || 'none') === SOURCE[sel], value: SOURCE[sel] };
        if (sel in TICK) return { checked: TICK[sel], value: '' };
        return { value: BOX[sel] === undefined ? '' : BOX[sel] };
      };
      // eslint-disable-next-line no-unused-vars
      const esc = (x) => String(x);
      // WHAT A BLANK COIN BOX RESOLVES TO, the way the page has it (3.122.0):
      // off /api/stagesets, not off the vocabulary -- the vocabulary holds the
      // CHOICES a control offers and no control offers a coin list.
      // eslint-disable-next-line no-unused-vars
      const swDefaultCoins = DEFAULTS.slice();
      // eslint-disable-next-line no-unused-vars
      const swSetsCache = [S1, S2];
      // eslint-disable-next-line no-unused-vars
      const swPassersNow = [];
      // eslint-disable-next-line no-unused-vars
      const VOCAB = { geometry: [{ value: 'daily-4d', label: 'daily 4-day' }] };
      // THE PAGE'S OWN READER, SLICED OUT RATHER THAN RETYPED (3.185.0). A
      // second copy here would let the screen and this check disagree about
      // which of the three is on, which is the one thing it is checking.
      const srcFn = UI.slice(UI.indexOf('const swSourceNow = () => {'), UI.indexOf('\n};\n', UI.indexOf('const swSourceNow = () => {')) + 3);
      assert.ok(srcFn.length > 60 && srcFn.length < 500, 'the page no longer reads the chosen source in one place');
      // eslint-disable-next-line no-eval
      eval(`${srcFn}\n${body}\nswProvenance();`);
      const colour = (k) => {
        const c = (el[k] || { style: {} }).style.color;
        return c === '' ? 'black' : c === 'var(--pos)' ? 'green' : c === 'var(--neg)' ? 'red' : c;
      };
      return {
        h1: colour('#swH1'), h2: colour('#swH2'), h3: colour('#swH3'),
        why2: (el['#swWhy2'] || {}).innerHTML || '', why3: (el['#swWhy3'] || {}).innerHTML || '',
      };
    };

    // THE OWNER'S TRUTH TABLE, 2026-09-06, ROW FOR ROW. Nothing else decides
    // these colours, and every row here is one line they wrote.
    const ROWS = [
      ['all empty',
        { '#swFrom2': '', '#swFrom3': '' }, { '#swSingles': false, '#swDoubles': false, '#swTriples': false },
        ['black', 'black', 'black']],
      ['s1 set, others empty',
        { '#swFrom2': '', '#swFrom3': '' }, {},
        ['green', 'black', 'black']],
      ["s1 set, s2 doesn't match, s3 empty",
        { '#swNull1': '19', '#swFrom3': '' }, {},
        ['green', 'red', 'black']],
      ['s1 set, s2 matches, s3 empty',
        { '#swFrom3': '' }, {},
        ['green', 'green', 'black']],
      ["s1 set, s2 matches, s3 doesn't match",
        { '#swCarry': '100' }, {},
        ['green', 'green', 'red']],
      ['s1 set, s2 matches, s3 matches',
        {}, {},
        ['green', 'green', 'green']],
      // and the three the owner added after, which settle it: no section's
      // colour is gated on the one above it being green -- each answers for
      // its own box and nothing else
      ["s1 set, s2 empty, s3 doesn't match",
        { '#swFrom2': '' }, {},
        ['green', 'black', 'red']],
      ["s1 set, s2 doesn't match, s3 matches s1",
        { '#swNull1': '19' }, {},
        ['green', 'red', 'green']],
      ["s1 set, s2 doesn't match, s3 doesn't match",
        { '#swNull1': '19', '#swCarry': '100' }, {},
        ['green', 'red', 'red']],
    ];
    for (const [label, box, tick, want] of ROWS) {
      const r = run(box, tick);
      assert.deepStrictEqual([r.h1, r.h2, r.h3], want,
        `${label} must read ${want.join(' ')} — got ${[r.h1, r.h2, r.h3].join(' ')}`);
    }

    // AND EVERY WAY OF BREAKING IT NAMES THE CONTROL AND BOTH VALUES, because a
    // colour with no way to act on it cost three sittings.
    const cases = [
      ['null set size', { '#swNull1': '19' }, {}, 'h2', 'why2', ['19', '20']],
      ['chunk shape', {}, { '#swPermGeom': false }, 'h2', 'why2', ['daily-4d', 'every chunk shape']],
      ['compare coins', { '#swCompare': 'BTCUSDT' }, {}, 'h2', 'why2', ['BTCUSDT', 'LTCUSDT']],
      ['weigh each trade by the money it was worth', {}, { '#swByMoney': false }, 'h2', 'why2', ['off', 'on']],
      ['trade coins', { '#swUni': 'BTCUSDT' }, {}, 'h2', 'why2', ['BTCUSDT', 'LTCUSDT']],
      ['carry forward', { '#swCarry': '100' }, {}, 'h3', 'why3', ['100', '600 of 600']],
    ];
    for (const [what, box, tick, head, line, values] of cases) {
      const r = run(box, tick);
      assert.strictEqual(r[head], 'red', `${what} disagrees with the record set and the heading is ${r[head]}`);
      const said = r[line].replace(/<[^>]+>/g, '');
      assert.ok(said.includes(what), `the screen does not name the control that disagrees: ${said}`);
      for (const val of values) {
        assert.ok(said.includes(val), `the screen does not say ${val}, so there is no way to act on it: ${said}`);
      }
    }
    assert.strictEqual(run().why2, '', 'a green section still prints a reason');

    // WHERE THIS RUN TAKES ITS UNITS FROM IS ITSELF COMPARED (3.185.0). The
    // owner's set above took its units from the boxes, so choosing either of
    // the two lists disagrees with it, and the screen says which two it is
    // holding up to each other -- by the labels the choices carry.
    for (const [choice, label] of [['passers', 'what is ticked under coins and shapes that pass'], ['walk', 'what is ticked from a walk set']]) {
      const r = run({}, { source: choice });
      assert.strictEqual(r.h2, 'red', `choosing ${label} against a set that read neither list reads ${r.h2}`);
      const said = r.why2.replace(/<[^>]+>/g, '');
      assert.ok(said.includes('where this run takes its units from'), `the screen does not name the control that disagrees: ${said}`);
      assert.ok(said.includes(label) && said.includes('ignore what is on Coins'), `the screen does not say both sides by their labels: ${said}`);
    }
    assert.strictEqual(run({}, { source: 'none' }).h2, 'green', 'the set took its units from the boxes, and so does the screen');

    // AND THE PICKER ALWAYS OFFERS THAT EMPTY ENTRY, whatever is on the box.
    const opts = UI.slice(UI.indexOf('function swSetOptions('), UI.indexOf('\n}\n', UI.indexOf('function swSetOptions(')));
    assert.ok(/<option value=""\$\{on\}>— none —<\/option>/.test(opts),
      'a box with record sets on it offers no way back to naming nothing');
    assert.ok(/const on = selected \? '' : ' selected';/.test(opts),
      'the empty entry is not what an unset box shows, so the first record set on the list is named without the owner choosing it');
  },

  // A BOX IS COMPARED AS THE LAUNCH RESOLVED IT (3.76.3, owner: "you've got
  // state 2 red that matches exactly with stage 1. that's dumb. it should be
  // green" / "if nothing's loaded how can nothing match or not match the
  // previous? OBVIOUSLY it should be black in that case").
  //
  // A stage 1 run writes down what it ACTUALLY read, never what was typed --
  // RULE NINE, and right. Blank `compare coins` is recorded as the seventeen
  // default pairs, blank month boxes as the months it fell back to. The stage
  // heading held those up to the RAW box, so every set launched from a blank
  // compare coins box painted Stage 2 red the moment it appeared in the box
  // below, and nothing the owner could type would make it green.
  //
  // This reads BOTH files, because that is where the drift lives: the rule is
  // written twice, once in the launch and once in the screen, and nothing else
  // makes them move together.
  theStageHeadingsCompareABoxTheWayTheLaunchResolvesIt() {
    const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8')
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const LIB = fs.readFileSync(path.join(ROOT, 'lib', 'stages.js'), 'utf8');
    const fn = UI.slice(UI.indexOf('function swProvenance() {'), UI.indexOf('\n}\n', UI.indexOf('function swProvenance() {')));
    assert.ok(fn.length > 400, 'swProvenance is gone');

    // THE COMPARE COINS. The launch records the resolved list, and records it
    // EMPTY when neither doubles nor triples reads it; the screen must do both.
    assert.ok(LIB.includes("const compareUsed = (compare.length ? compare : defaultCoins())\n    .filter(() => sizes.doubles || sizes.triples);"),
      'the launch no longer resolves the compare coins this way — the screen below copies this rule and has to move with it');
    assert.ok(/const wantCmp = \(\(c\('#swDoubles'\) \|\| c\('#swTriples'\)\) \? \(boxCmp\.length \? boxCmp : defaults\) : \[\]\)/.test(fn),
      'the compare coins are compared as typed, so a blank box reads as disagreeing with the seventeen default pairs the run actually read — Stage 2 is red for ever');
    assert.ok(/\['compare coins', wantCmp \? wantCmp\.split/.test(fn),
      'the resolved compare coins are worked out and then not the thing compared');
    assert.ok(!/boxCmp !== setCmp/.test(fn), 'the raw box is still what decides');

    // THE MONTHS, the same fault in the same shape
    assert.ok(LIB.includes("startMonth: params.startMonth || '2018-01',") && LIB.includes("endMonth: params.endMonth || '2026-06',"),
      'the launch no longer falls back to those months — the screen below copies them and has to move with it');
    assert.ok(/months\(c\('#swAllData'\), v\('#swStart'\) \|\| '2018-01', v\('#swEnd'\) \|\| '2026-06'\)/.test(fn),
      'a blank month box reads as disagreeing with the month the run actually used');

    // AND THE THIRD COLOUR. A heading with nothing to check claims nothing.
    assert.ok(/if \(ok === null\) \{\n      h\.style\.color = '';/.test(fn),
      'there are only two colours, so a heading with nothing to compare still claims green');
    assert.ok(/paint\('#swH1', \(c\('#swSingles'\) \|\| c\('#swDoubles'\) \|\| c\('#swTriples'\)\) \? true : null,/.test(fn),
      'stage 1 does not go green off its own section being set up, so the top of the truth table cannot hold');
    assert.ok(/if \(!v\('#swFrom2'\)\) paint\('#swH2', null,/.test(fn), 'an empty stage 1 box still paints Stage 2 green');
    assert.ok(/if \(!v\('#swFrom3'\)\) paint\('#swH3', null,/.test(fn), 'an empty stage 2 box still paints Stage 3 green');
    assert.ok(!/names no record set yet\)/.test(fn), 'green still claims to cover the case that is now black');
  },

  // The fee is the owner's, typed on the stage 1 panel and sent with the
  // launch as a share of the position; a launch without one is refused by
  // sentence before anything is written.
  theFeeIsDeclaredOnTheStageOnePanelAndSentWithTheLaunch() {
    const UI = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(UI.includes('<label class="f">fee % each way<input id="swFee1" type="number" value="0.125"'), 'the stage 1 panel offers the fee, with the same words the stage 3 panel uses');
    assert.ok(UI.includes("nullN: Number($('#swNull1').value) || 0, fee: Number($('#swFee1').value) / 100, desc: $('#swDesc1').value,"),
      'the launch sends it as a share of the position');
    assert.ok(UI.includes("setV('#swFee1', p.fee != null ? p.fee * 100 : 0.125);"), 'and a remembered set restores it');
    assert.throws(() => stages.startStage1({ sizes: { singles: true }, nullN: 3 }), /fee % each way must be a real cost/, 'no fee, no launch');
    assert.throws(() => stages.startStage1({ sizes: { singles: true }, nullN: 3, fee: 0.2 }), /fee % each way must be a real cost/, 'a fee outside 0 to 5% is refused too');
    assert.strictEqual(stages.feeOrRefuse(0.00125, 'x'), 0.00125);
    // the stage 1 and 2 tables carry the money columns and the fill-in beside them
    const s1 = UI.slice(UI.indexOf('async function bDrawStage1('), UI.indexOf('\nasync function bDrawStage2('));
    for (const th of ["tuning-slice $${bSortBtn(doc, 'money', 'desc')}", "beat its own null set — tuning-slice $${bSortBtn(doc, 'beatMoney', 'desc')}", "lead over null set — tuning-slice $${bSortBtn(doc, 'leadMoney', 'desc')}"]) {
      assert.ok(s1.includes(th), `the stage 1 table has the column ${th}`);
    }
    // THE EMPTY ROW SPANS EXACTLY THE COLUMNS THERE ARE, counted rather than
    // typed: a typed colspan goes stale the moment a column is added, which is
    // what happened when this one gained a column (3.121.0).
    const spans = (block, what) => {
      const heads = (block.match(/<th /g) || []).length;
      const span = /colspan="(\d+)" class="empty"/.exec(block);
      assert.ok(span, `${what}: the empty row has no colspan at all`);
      assert.strictEqual(Number(span[1]), heads,
        `${what}: the empty row spans ${span[1]} of ${heads} columns`);
    };
    spans(s1, 'the stage 1 table');
    const s2 = UI.slice(UI.indexOf('async function bDrawStage2('), UI.indexOf('\nasync function bDrawStage3('));
    for (const th of ["tuning-slice $ — stage 1 members${bSortBtn(doc, 'money3', 'desc')}", "tuning-slice $ — all members${bSortBtn(doc, 'moneyAll', 'desc')}", "beat its own null set — tuning-slice $${bSortBtn(doc, 'beatMoney', 'desc')}", "lead over null set — tuning-slice $${bSortBtn(doc, 'leadMoney', 'desc')}"]) {
      assert.ok(s2.includes(th), `the stage 2 table has the column ${th}`);
    }
    spans(s2, 'the stage 2 table');
    // and both carry the reading that says whether the ceiling is doing anything
    for (const [block, what] of [[s1, 'stage 1'], [s2, 'stage 2']]) {
      assert.ok(block.includes("biggest before the ceiling${bSortBtn(doc, 'biggestBeforeCap', 'desc')}"),
        `the ${what} table does not say how big the biggest weight was before the ceiling`);
      assert.ok(/r\.atCeiling/.test(block), `the ${what} table does not say how many were held at the ceiling`);
    }
    assert.ok(!s2.includes('the BOOST members never face a null set'), 'the sentence that said the BOOST members never face a null set is gone');
    // every sortable key on the stage 1 and 2 tables has the words the chain line prints
    for (const key of Object.keys(stages.FILTER_DEFS[1]).concat(Object.keys(stages.FILTER_DEFS[2]))) assert.ok(key, key);
    for (const stage of [1, 2]) {
      for (const key of ['money', 'money3', 'moneyAll', 'beatMoney', 'leadMoney']) {
        if (stage === 1 && (key === 'money3' || key === 'moneyAll')) continue;
        if (stage === 2 && key === 'money') continue;
        assert.doesNotThrow(() => stages.validateSort(stage, [{ key, dir: 'desc' }]), `${key} sorts the stage ${stage} table`);
      }
    }
  },

  // THE TRAINING SETUP IS ONE SETTING, NOT AN APPROXIMATION OF ONE (3.71.0,
  // owner question 2026-09-05: "is there a fixed set of Stage 3 settings that
  // accurately represents exactly the conditions under which the Stage 1 and
  // Stage 2 unit trainings work?").
  //
  // The answer only holds if the way of weighing that reads no bar behaves
  // like one setting everywhere: one row in the block however many bars and
  // shares are being permuted beside it, carrying neither on the record and
  // neither in its name. If a bar or a share leaks back in, the block gains
  // copies of one trade and every record starts reporting a number the rule
  // never looked at.
  async theTrainingSetupIsOneSettingWithNoBarAndNoShare() {
    const agreement = require('../lib/agreement');
    const cell = { entry: 'market', tHours: 60 };
    const alone = stages.settingsFor({ cell, agreeRule: 'trained', agreeBar: 'own', agreePct: 75 }, [1]);
    assert.strictEqual(alone.length, 1, 'one way of weighing, one setting');
    assert.strictEqual(alone[0].agreeBar, null, 'a rule that reads no bar must store none');
    assert.strictEqual(alone[0].agreePct, null, 'a rule that reads no bar must store no share');
    assert.strictEqual(alone[0].label.split(' \u00b7 ')[0], 'trained market t60h',
      'the name must carry neither the bar nor the share, because the rule read neither');
    // every bar and every share permuted at once: still ONE trained setting
    const swept = stages.settingsFor({
      cell, agreeRule: 'trained', agreePermuteBar: true, agreePermutePct: true, agreePermuteCopy: true,
    }, [1]);
    assert.strictEqual(swept.length, 1,
      'permuting a bar and a share that the rule cannot read must not multiply the block');
    // ...while the two it CAN read still do multiply it, because those are not
    // bars: both kinds is a make-up requirement and hold is a noise filter
    const mods = stages.settingsFor({ cell, agreeRule: 'trained', agreePermuteBoth: true, agreePermutePersist: true }, [1]);
    assert.ok(mods.length > 1, 'both kinds and hold are not bars and must still reach the block');
    for (const st of mods) {
      assert.strictEqual(st.agreeBar, null, `${st.label} gained a bar`);
      assert.strictEqual(st.agreePct, null, `${st.label} gained a share`);
    }
    // and the list of rules that read no bar is the engine's, not a copy: a
    // second one added tomorrow is held to all of the above without anybody
    // remembering to come back here
    // (the field alone needs a field named, or it is refused rather than priced)
    const aField = { fieldId: 'f-x', fieldAgreeMin: '40', fieldRungs: '100:1' };
    for (const rule of agreement.AGREE_RULES) {
      if (!agreement.READS_NO_BAR.has(rule)) continue;
      const one = stages.settingsFor({ cell, agreeRule: rule, agreePermuteBar: true, agreePermutePct: true, ...(rule === 'field' ? aField : {}) }, [1]);
      assert.strictEqual(one.length, 1, `${rule} reads no bar and must be one setting`);
      assert.deepStrictEqual([one[0].agreeBar, one[0].agreePct], [null, null], `${rule} must store neither`);
    }
    // AND THE FIELD ALONE NEVER GAINS A +both TWIN (3.221.0): both kinds is a
    // test of the members, which the field never reads, so permuting it would
    // price the same trades twice under two names; hold is not a bar and still applies
    const fieldMods = stages.settingsFor({ cell, agreeRule: 'field', agreePermuteBoth: true, agreePermutePersist: true, ...aField }, [1]);
    assert.ok(fieldMods.length > 1 && fieldMods.some((st) => st.agreePersist > 0), 'hold is not a bar and must still reach the block under the field');
    assert.ok(fieldMods.every((st) => !st.agreeBoth && !/\+both/.test(st.label)), `the field gained a +both twin: ${fieldMods.map((st) => st.label).join(' | ')}`);
    assert.ok(fieldMods.every((st) => /^field(?: \+hold\d+)? market t60h$/.test(st.label.split(' \u00b7 ')[0])),
      `the field's name must carry neither a bar nor a share: ${fieldMods.map((st) => st.label).join(' | ')}`);
  },

  // A ROW WRITTEN UNDER A NO-BAR RULE SAYS SO ON THE SCREEN rather than
  // reading as the default bar. The bar column is derived from the stored
  // value, and 'all of them' is what a missing bar used to read as -- which
  // would tell the owner a bar was used when none was.
  async aRowWithNoBarSaysTheBarDoesNotApply() {
    const rows = [
      { label: 'none', agreeBar: null }, { label: 'own', agreeBar: 'own' }, { label: 'all', agreeBar: 'all' },
    ];
    // the bar filter reads the same derived value the column prints, so
    // filtering on it is the column's own answer put to a question
    const said = (want) => stages.applyFilters(3, rows, { bar: want }).map((r) => r.label);
    assert.deepStrictEqual(said('does not apply'), ['none'],
      'a row written under a rule that reads no bar must not read as the default bar');
    assert.deepStrictEqual(said('its own history'), ['own']);
    assert.deepStrictEqual(said('all of them'), ['all']);
  },

  // t SET TO THE CHUNK'S OWN HOLD LENGTH IS RESOLVED PER UNIT (3.72.0, owner
  // order 2026-09-06: "the chunk's own, no new field").
  //
  // One setting, a different number of hours on each unit -- and every reader
  // must get the SAME number for a unit or the run is incoherent: priced at
  // one hold, measured against controls at another, reported as a third. They
  // all go through one function, and this holds that function to the chunk
  // shapes the system implements.
  async theChunksOwnHoldLengthIsResolvedAgainstTheUnitBeingPriced() {
    const { GEOMETRIES } = require('../lib/dataset');
    const b = require('../lib/bracket');
    assert.strictEqual(b.tHoursOn(b.T_OWN, 'weekly-8d'), 60);
    assert.strictEqual(b.tHoursOn(b.T_OWN, 'daily-1d'), 17);
    assert.strictEqual(b.tHoursOn(b.T_OWN, 'daily-2d'), 17);
    assert.strictEqual(b.tHoursOn(b.T_OWN, 'daily-3d'), 41);
    assert.strictEqual(b.tHoursOn(b.T_OWN, 'daily-4d'), 41);
    assert.strictEqual(b.tHoursOn(89, 'weekly-8d'), 89, 'a number of hours passes through untouched');
    assert.throws(() => b.tHoursOn(b.T_OWN, 'not-a-shape'), /not a chunk shape/,
      'an unknown chunk shape must throw rather than quietly pick a number');
    // every shape the system implements resolves, and to a value t can be set
    // to flat as well -- otherwise a setting could price at a hold the grid
    // cannot express and no other setting could ever be compared with it
    for (const g of Object.keys(GEOMETRIES)) {
      const h = b.tHoursOn(b.T_OWN, g);
      assert.ok(b.T_HOURS.includes(h), `${g} resolves to ${h}h and the t menu cannot offer it`);
    }
    // THE NAME SAYS WHAT WAS ASKED FOR, not what one unit made of it
    const own = stages.settingsFor({ cell: { entry: 'market', tHours: b.T_OWN }, agreeRule: 'trained' }, [1]);
    assert.strictEqual(own.length, 1);
    assert.ok(own[0].label.startsWith('trained market t own '), `the name must carry the choice: ${own[0].label}`);
    // AND THE PRICING RESOLVES IT ONCE, WITH EVERY USE READING THAT ONE NUMBER.
    // Read from the source because s3UnitTask cannot run without a real unit's
    // chunks -- and without this nothing at all reads the line: deleting the
    // resolution left the whole suite green while every unit would have died
    // at the first setting the training setup priced.
    //
    // Three uses have to agree or the run is incoherent: the trade is placed at
    // one hold, the four hold controls it is measured against are worked out at
    // a second, and the record reports a third.
    const sw = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    const task = sw.slice(sw.indexOf('async function s3UnitTask(task) {'), sw.indexOf('\n}\n', sw.indexOf('async function s3UnitTask(task) {')));
    assert.ok(task.includes('const tHours = bracketLib.tHoursOn(st.tHours, geometry);'),
      'the pricing must resolve t against the unit it is pricing, through the one resolver');
    assert.ok(task.includes('const cell = { entry: st.entry, gate: st.gate, dMult: st.dMult, tHours, trailMult'),
      'the trade must be placed at the resolved hold');
    assert.ok(task.includes("holdControlsFor(holdChunks, hIdx, tHours, stream.weekdaysOnly ? 'wk' : 'all')"),
      'the four hold controls must be worked out at the SAME hold the trade was placed at, or the row is measured against a different trade');
    assert.ok(/entry: st\.entry, gate: st\.gate, dMult: st\.dMult \?\? null, tHours,/.test(task),
      'the record must keep the hold it was actually priced at');
    const afterResolve = task.slice(task.indexOf('const tHours = bracketLib.tHoursOn') + 'const tHours = bracketLib.tHoursOn(st.tHours, geometry);'.length);
    assert.ok(!/st\.tHours/.test(afterResolve),
      'nothing after the resolution may read the unresolved value again');
  },

  // AND THE FOLD RESOLVES IT THE SAME WAY. On a daily 3-day unit the chunk's
  // own hold length IS 41 hours, so a setting asking for it and a setting
  // asking for 41h place the identical orders there and must be ONE setting on
  // that unit -- while on a weekly unit, where it is 60, they are two. Getting
  // this wrong prices the same trade twice on every daily unit in a run.
  async theChunksOwnFoldsIntoTheHoursItLandsOnForThatUnit() {
    const b = require('../lib/bracket');
    const both = stages.settingsFor({
      cell: { entry: 'market', tHours: 41 }, agreeRule: 'count', agreePct: 50,
    }, [1]).concat(stages.settingsFor({
      cell: { entry: 'market', tHours: b.T_OWN }, agreeRule: 'count', agreePct: 50,
    }, [1]));
    assert.strictEqual(both.length, 2, 'the fixture must offer both ways of asking for the same hold');
    const daily = stages.foldSameTradeSettings(both, [{ trade: 'AAA', bandPct: 2, geometry: 'daily-3d' }]);
    assert.strictEqual(daily.kept.length, 1,
      'on a daily 3-day unit the chunk\'s own IS 41h, so the two are one setting and must be priced once');
    assert.strictEqual(daily.kept[0].tHours, 41, 'and the one kept is the first of them in block order');
    const weekly = stages.foldSameTradeSettings(both, [{ trade: 'AAA', bandPct: 2, geometry: 'weekly-8d' }]);
    assert.strictEqual(weekly.kept.length, 2,
      'on a weekly unit the chunk\'s own is 60h, which is a different trade from 41h');
    // and a run holding both units keeps both settings, with the daily unit
    // holding one of them and the weekly unit holding both
    const mixed = stages.foldSameTradeSettings(both, [
      { trade: 'AAA', bandPct: 2, geometry: 'daily-3d' }, { trade: 'AAA', bandPct: 2, geometry: 'weekly-8d' },
    ]);
    assert.strictEqual(mixed.kept.length, 2);
    assert.deepStrictEqual(mixed.heldOn.map((l) => l.length), [1, 2],
      'the daily unit prices one of them and the weekly unit prices both');
  },

  // THE PRICER MUST NOT PUT BACK WHAT THE BLOCK LEFT OUT. A setting written
  // under a way of weighing that reads no bar carries no bar and no share, and
  // both of those are read back through one function -- so a default there
  // would quietly restore them on every row, and the record would report a bar
  // that was never consulted. The rung is the same fault one step along: it is
  // what the setting had to clear, and a rule with nothing to clear must leave
  // it EMPTY rather than print the number some other rule would have landed on.
  //
  // Read from the source because both live inside the pricing closure and
  // neither is reachable without a unit's real chunks; the arithmetic they
  // guard is held by tests/test-agreement.js (trainedReadsNoBarAtAnyLevel).
  async theNoBarRuleIsNotGivenABarBackInsideThePricing() {
    const sw = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    const agr = sw.slice(sw.indexOf('const agrOf = (st) => ({'), sw.indexOf('});', sw.indexOf('const agrOf = (st) => ({')));
    assert.ok(agr.includes("bar: agreement.READS_NO_BAR.has(st.agreeRule || 'count') ? null : (st.agreeBar === 'own' ? 'own' : 'all'),"),
      'the bar read off a setting must stay empty for a rule that reads none');
    assert.ok(agr.includes("pct: agreement.READS_NO_BAR.has(st.agreeRule || 'count') ? null : (Number(st.agreePct) || 50),"),
      'the share read off a setting must stay empty for a rule that reads none');
    // the one definition of what is enough lives in lib/committee.js since 3.91.0, shared with the live path
    const cm = fs.readFileSync(path.join(ROOT, 'lib', 'committee.js'), 'utf8');
    assert.ok(cm.includes('const levelFor = (agr, decision) => (agreement.READS_NO_BAR.has(agr.rule) ? null'),
      'the rung a setting had to clear must be empty for a rule with nothing to clear');
    assert.ok(sw.includes('const levelFor = (agr, decision) => C.levelFor(agr, decision);'), 'and the pricing reads it from there, never a copy of its own');
    // and the tally skips an empty rung rather than counting it as zero: one
    // trained setting in a block must not drag the average of the settings
    // that did read a bar
    assert.ok(sw.includes('if (r.rung != null) { c.rung += r.rung; c.rungN++; }'),
      'an empty rung must be left out of the average, not counted as nothing');
  },

  // A RULE THAT READS THE MEMBERS' LEANS MUST BE HANDED THEM. Building the
  // leans is not free, so the pricer builds them only for the rules that read
  // them -- and a rule left off that list is handed null and crashes at the
  // first moment it is priced, on a whole run, after the trainings are done.
  //
  // The list lives in lib/agreement.js beside the rules themselves, and BOTH
  // halves are checked: that the pricer asks the list rather than naming a
  // rule, and that the list is the true set of rules that need the leans --
  // read by trying each rule with none and seeing which ones cannot cope.
  async everyRuleThatReadsTheMembersLeansIsHandedThem() {
    const agreement = require('../lib/agreement');
    // the two places that build a quorum: the pricing's per-slice one, and the
    // shared definition's (lib/committee.js since 3.91.0), which the bar reads
    const swSrc = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    const cmSrc = fs.readFileSync(path.join(ROOT, 'lib', 'committee.js'), 'utf8');
    const asked = [
      // (3.205.0: both read the folded voters' leans, `f.probs`)
      ...[...swSrc.matchAll(/probs: ([^\n]+?) \? f\.probs : null/g)].map((m) => m[1]),
      ...[...cmSrc.matchAll(/probs: ([^\n]+?) \? f\.probs : null/g)].map((m) => m[1]),
    ];
    assert.strictEqual(asked.length, 2, 'both places that build a quorum must decide whether to build the leans');
    for (const test of asked) {
      assert.strictEqual(test, 'agreement.READS_LEANS.has(agr.rule)',
        `the pricer names a rule instead of asking the list (${test}), so the next rule that reads leans gets none`);
    }
    // and the list is the truth: a rule NOT on it must survive with no leans
    // at all, a rule ON it must be the reason it is on it
    const calls = [[1, -1], [1, 1]];
    const noProbs = { calls, probs: null, models: ['logreg', 'boost'], families: ['a', 'b'], weights: [1, 1] };
    for (const rule of agreement.AGREE_RULES) {
      const copes = (() => {
        try { agreement.agreementStream(noProbs, rule, 1); return true; } catch (_) { return false; }
      })();
      assert.strictEqual(copes, !agreement.READS_LEANS.has(rule),
        `${rule} ${copes ? 'does not need' : 'needs'} the leans, and the list says the opposite`);
    }
  },

  // THE UNITS A RUN LOST, PUT BACK (3.73.0, owner order 2026-09-06: "can you
  // give me a button to fix issues like that without wasting another 18 hours
  // on a run?").
  //
  // Eighteen units out of 10,200 cost a whole eighteen-hour run, because a set
  // short even one unit is stamped incomplete and an incomplete set is refused
  // as a parent. Which units are absent is SUBTRACTION -- every record carries
  // its own place in the plan -- and this pins that, both when nothing is
  // missing and when the gaps are scattered rather than at the end.
  async theUnitsARunLostAreFoundBySubtractingWhatIsThereFromThePlan() {
    const pid = writeLaunchParent('gaps');
    try {
      const file = path.join(SETS_DIR, `${pid}.json`);
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      // a stage 1 set whose plan names five units, holding records for three
      const unit = (trade, geometry) => ({ trade, ctx1: null, ctx2: null, size: 1, geometry });
      doc.stage = 1;
      doc.plan = {
        units: 5,
        unitList: [unit('AAAUSDT', 'daily-4d'), unit('BBBUSDT', 'daily-4d'), unit('CCCUSDT', 'daily-4d'),
          unit('DDDUSDT', 'daily-4d'), unit('EEEUSDT', 'daily-4d')],
      };
      fs.writeFileSync(file, JSON.stringify(doc));
      fs.rmSync(rowstore.storeDir(pid), { recursive: true, force: true });
      const rec = rowstore.writer(pid, 'records');
      // written OUT OF ORDER and with gaps at 1 and 3, because a run finishes
      // its units in whatever order they land and the gaps are wherever they
      // failed -- never conveniently at the end
      for (const u of [2, 0, 4]) rec.push({ u, trade: 'ZZZ', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', blocks: {} });
      rec.close();
      const gaps = stages.missingUnitsOf(stages.getSet(pid));
      assert.strictEqual(gaps.total, 5);
      assert.strictEqual(gaps.have, 3);
      assert.deepStrictEqual(gaps.missing.map((m) => m.i), [1, 3],
        'the absent units are the plan positions no record claims, whatever order the records were written in');
      assert.deepStrictEqual(gaps.missing.map((m) => m.unit.trade), ['BBBUSDT', 'DDDUSDT'],
        'and each carries the unit the plan named at that position, so it can be run again exactly as planned');
      // nothing missing reads as nothing missing, never as "cannot tell"
      const rec2 = rowstore.writer(pid, 'records');
      for (const u of [1, 3]) rec2.push({ u, trade: 'ZZZ', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d', blocks: {} });
      rec2.close();
      const after = stages.missingUnitsOf(stages.getSet(pid));
      assert.strictEqual(after.missing.length, 0, 'a whole set has no gaps');
    } finally { cleanLaunchParent(pid); }
  },

  // AND IT REFUSES RATHER THAN MIXING. A unit trained under different
  // conditions would sit in the same table, be ranked against the rest and be
  // carried to stage 2 beside them, with nothing anywhere able to tell them
  // apart. Three things make one incomparable and each has to refuse BY NAME,
  // before anything runs -- a silent mismatch is the whole harm.
  async fillingInUnitsRefusesAnythingThatWouldNotBeComparable() {
    const pid = writeLaunchParent('refuse');
    try {
      const file = path.join(SETS_DIR, `${pid}.json`);
      const base = JSON.parse(fs.readFileSync(file, 'utf8'));
      base.stage = 1;
      base.plan = { units: 1, unitList: [{ trade: 'ZZZTESTUSDT', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d' }] };
      const withDoc = (over) => { fs.writeFileSync(file, JSON.stringify({ ...base, ...over })); return stages.getSet(pid); };
      assert.match(String(stages.unitFillRefusal(withDoc({ measurements: 1 }))), /measurement block/,
        'a different measurement block must refuse: the new unit would be trained on numbers the rest has never seen');
      assert.match(String(stages.unitFillRefusal(withDoc({ engineVersion: '1.0.0' }))), /engine 1\.0\.0/,
        'a different first digit of the release must refuse by name');
      assert.match(String(stages.unitFillRefusal(withDoc({ dataManifest: null }))), /no readable price-file record/,
        'a set that cannot prove its data is unchanged must refuse');
      // AND A SET WHOSE PRICE FILES HAVE MOVED, which is the one that actually
      // bites: the record is perfectly readable and simply no longer describes
      // what is on disk. A unit trained on today's candles would join units
      // trained on yesterday's with nothing able to tell them apart, so the
      // refusal has to NAME what moved. Since 3.84.0 a set is pinned to the
      // files it was launched on, so what moved is a FILE: one is stamped,
      // then rewritten with other candles.
      const { stampManifest, MANIFEST_DIR } = require('../lib/manifest');
      const priceFile = path.join(ROOT, 'data', 'cache', 'ZZZTESTUSDT-1h-2024-01.json');
      fs.mkdirSync(path.dirname(priceFile), { recursive: true });
      fs.writeFileSync(priceFile, JSON.stringify([{ ts: 1704067200000, open: 1, high: 2, low: 1, close: 1, quoteVolume: 1 }]));
      try {
        const moved = stampManifest(`${pid}-moved`, ['ZZZTESTUSDT']);
        assert.strictEqual(stages.unitFillRefusal(withDoc({ dataManifest: moved })), null, 'freshly stamped, the pinned file is intact');
        fs.writeFileSync(priceFile, JSON.stringify([{ ts: 1704067200000, open: 1, high: 2, low: 1, close: 9, quoteVolume: 1 }]));
        assert.match(String(stages.unitFillRefusal(withDoc({ dataManifest: moved }))), /1 of the price files .* was launched on has changed since/,
          'price files that moved since the set was written must refuse rather than mixing two kinds of unit');
        assert.match(String(stages.unitFillRefusal(withDoc({ dataManifest: moved }))), /\(ZZZTESTUSDT-1h-2024-01\.json\)/,
          'and the refusal must name the file that moved, or there is nothing to act on');
        // a record whose list of files is gone cannot be proved either way
        assert.match(String(stages.unitFillRefusal(withDoc({ dataManifest: { ...moved, detailFile: 'manifests/zzz-gone.json' } }))), /cannot be proved unchanged/,
          'a set whose record of its files is gone must refuse');
      } finally {
        fs.rmSync(priceFile, { force: true });
        fs.rmSync(path.join(MANIFEST_DIR, `${pid}-moved.json`), { force: true });
      }
      assert.match(String(stages.unitFillRefusal(withDoc({ stage: 3 }))), /only a stage 1 record set/,
        'only stage 1 holds units to put back');
      assert.match(String(stages.unitFillRefusal(withDoc({ status: 'running' }))), /still going/,
        'a run that has not finished is not something to fill in');
      // and an untouched set refuses nothing
      assert.strictEqual(stages.unitFillRefusal(withDoc({})), null,
        'a set written by this box on unchanged price files must be fillable');
    } finally { cleanLaunchParent(pid); }
  },

  // WHAT IS ON DISK IS READ BEFORE THE NETWORK IS ASKED (3.73.0, owner order
  // 2026-09-06: "you make a system that gives me sept 1/26 end date on all
  // data, then that data must be available. otherwise you're delivering a
  // faulty product").
  //
  // It WAS available. A month held as day files rather than as one whole-month
  // file is still a month the box holds, and the loader asked the network for
  // the whole-month file anyway, was told it does not exist, and only then read
  // the day files that were there all along -- about forty thousand pointless
  // requests over a ten thousand unit run, eighteen of which met a network blip
  // and took their units down.
  //
  // Read from the source: reaching the network needs a network, which a test
  // must never do. The ORDER is the whole fix and the order is what is pinned.
  async theLoaderReadsWhatIsOnDiskBeforeAskingTheNetwork() {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'pipeline.js'), 'utf8');
    const fn = src.slice(src.indexOf('async function loadSymbol(symbol, months, onProgress)'),
      src.indexOf('\n}\n', src.indexOf('async function loadSymbol(symbol, months, onProgress)')));
    const disk = fn.indexOf('monthFromDayFiles(symbol, year, month)');
    const net = fn.indexOf('await monthlyKlines(symbol, year, month)');
    assert.ok(disk > 0 && net > 0, 'the loader must still have both a disk path and a network path');
    assert.ok(disk < net, 'the day files on disk must be read BEFORE the network is asked, not after it refuses');
    assert.ok(fn.includes('if (!fs.existsSync(cachePath(symbol, year, month))) {'),
      'and the network is skipped only when there is no whole-month file, so a cached month still wins');
    assert.ok(/missing\.push\(mm\);[\s\S]{0,200}?monthCounts\[mm\] = tally\(onDisk\);/.test(fn),
      'a month with no whole-month file still counts as one without a bundle — that is what keeps the day files refreshed');
    // AND A MONTH THE EXCHANGE SAYS DOES NOT EXIST IS NOT ASKED ABOUT TWICE.
    // Four of the owner's coins were not listed until 2020 and the current
    // month never has a whole-month file at all; every one of those answered
    // 404, once per unit, for ever.
    const bin = fs.readFileSync(path.join(ROOT, 'lib', 'binance.js'), 'utf8');
    assert.ok(bin.includes('if (notPublished.has(nk)) return null;'), 'a month already known not to exist is not asked about again');
    assert.ok(bin.includes('if (res.status === 404) { notPublished.add(nk); return null; }'),
      'and only a definite "this does not exist" is remembered');
    assert.ok(!/notPublished\.add/.test(bin.replace('if (res.status === 404) { notPublished.add(nk); return null; }', '')),
      'a NETWORK failure must never be remembered as "does not exist" — that would hide an outage as missing data');
  },

  // REBUILDING THE ORDERING MUST NOT TAKE THE RECORD SET WITH IT (3.73.1).
  //
  // This is the test that was missing. On 2026-09-06 the fill-in rebuilt the
  // ordering with `rowstore.remove(id, 'ranking')`, believing the second
  // argument named one store. It does not exist: remove takes the record set
  // and deletes the WHOLE store directory. An eighteen-hour run of 10,200
  // units was destroyed the first time the owner pressed the control -- the
  // records, the votes, the tau votes and the models, all of them, with only
  // the freshly written ordering left behind.
  //
  // Nothing caught it because every test around it read SOURCE or checked
  // arithmetic. This one builds a real store on disk, rebuilds the ordering
  // through the real code, and reads every other store back afterwards.
  async rebuildingTheOrderingLeavesEveryOtherStoreExactlyWhereItWas() {
    const id = `s1-rebuild-${Date.now().toString(36)}`;
    try {
      // a real store, in the shape a finished stage 1 run leaves behind
      const rows = {
        records: [
          { u: 0, trade: 'AAAUSDT', beat: 5, pairs: 10, lead: 0.5, score: 1, money: 10, beatMoney: 5, leadMoney: 0.5 },
          { u: 1, trade: 'BBBUSDT', beat: 9, pairs: 10, lead: 2.0, score: 2, money: 20, beatMoney: 9, leadMoney: 2.0 },
          { u: 2, trade: 'CCCUSDT', beat: 7, pairs: 10, lead: 1.0, score: 3, money: 30, beatMoney: 7, leadMoney: 1.0 },
        ],
        votes: [{ u: 0, w: 0, ts: 1, m: [[0.1, 0.2, 0.7]] }, { u: 1, w: 0, ts: 1, m: [[0.3, 0.3, 0.4]] }],
        tau: [{ u: 0, mi: 0, probs: [0.5] }],
        models: [{ u: 0, mi: 0, saved: { w: [1, 2, 3] } }],
        ranking: [{ rank: 1, u: 0, beat: 5, pairs: 10, lead: 0.5, score: 1, money: 10, beatMoney: 5, leadMoney: 0.5 }],
      };
      for (const [name, list] of Object.entries(rows)) {
        const w = rowstore.writer(id, name);
        for (const r of list) w.push(r);
        await w.close();
      }
      // every store is really there before the rebuild, or this proves nothing
      for (const name of Object.keys(rows)) {
        assert.strictEqual(rowstore.count(id, name), rows[name].length, `the fixture did not write ${name}`);
      }
      const out = await stages.rebuildRanking(id, rows.records);
      assert.strictEqual(out.rows, 3, 'the rebuilt ordering holds one row per record');
      // THE WHOLE POINT: everything else is untouched, row for row
      for (const name of ['records', 'votes', 'tau', 'models']) {
        assert.strictEqual(rowstore.count(id, name), rows[name].length,
          `rebuilding the ordering destroyed ${name} — this is exactly the fault that cost an 18-hour run`);
        assert.deepStrictEqual(rowstore.readAll(id, name), rows[name], `${name} came back changed`);
      }
      // and the ordering itself is right: beat high to low, lead breaking ties
      assert.deepStrictEqual(rowstore.readAll(id, 'ranking').map((r) => [r.rank, r.u]), [[1, 1], [2, 2], [3, 0]],
        'the ordering must be the same total order the launch settles on');
      // the spare it was built under is not left lying about
      assert.strictEqual(rowstore.exists(id, 'ranking-rebuilding'), false,
        'the copy it was built as must take the real name, not sit beside it for ever');
    } finally {
      try { rowstore.remove(id); } catch (_) { /* fixture */ }
    }
  },

  // AND THE WHOLE FILL, PRESSED FOR REAL. The units cannot train -- the coin
  // has no price files -- so every one of them fails, which is the case that
  // matters: a fill that achieves nothing must still leave the set exactly as
  // it found it, and must say what failed rather than going quiet.
  async aFillThatTrainsNothingStillLeavesTheSetWhole() {
    const pid = writeLaunchParent('wholefill');
    try {
      const file = path.join(SETS_DIR, `${pid}.json`);
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      doc.stage = 1;
      doc.status = 'incomplete';
      doc.seed = 1;
      doc.plan = {
        units: 2,
        unitList: [
          { trade: 'ZZZTESTUSDT', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d' },
          { trade: 'ZZZTESTUSDT', ctx1: null, ctx2: null, size: 1, geometry: 'daily-3d' },
        ],
      };
      doc.counts = { unitsScored: 1, failures: 1 };
      doc.failures = [{ unit: 'ZZZTESTUSDT||daily-3d', error: 'fetch failed' }];
      fs.writeFileSync(file, JSON.stringify(doc));
      // the set holds unit 0 and everything a finished run writes beside it
      const before = {
        votes: [{ u: 0, w: 0, ts: 1, m: [[0.2, 0.3, 0.5]] }],
        tau: [{ u: 0, mi: 0, probs: [0.5] }],
        models: [{ u: 0, mi: 0, saved: { w: [1] } }],
      };
      for (const [name, list] of Object.entries(before)) {
        const w = rowstore.writer(pid, name);
        for (const r of list) w.push(r);
        await w.close();
      }
      const gaps = stages.missingUnitsOf(stages.getSet(pid));
      assert.deepStrictEqual(gaps.missing.map((m) => m.i), [1], 'the fixture must be short exactly one unit');
      const run = stages.fillMissingUnitsStart(pid);
      await run.promise;
      // NOTHING TRAINED, AND NOTHING WAS LOST
      assert.strictEqual(run.added, 0, 'a coin with no price files cannot train');
      for (const [name, list] of Object.entries(before)) {
        assert.strictEqual(rowstore.count(pid, name), list.length,
          `the fill destroyed ${name} — a fill that achieves nothing must leave the set exactly as it found it`);
      }
      assert.strictEqual(rowstore.count(pid, 'records'), 1, 'the record already there is still there');
      const after = stages.getSet(pid);
      assert.strictEqual(after.status, 'incomplete', 'a set still short a unit must not be stamped finished');
      assert.strictEqual((after.failures || []).length, 1, 'and it must say which unit is still missing, not go quiet');
      assert.strictEqual(rowstore.count(pid, 'ranking'), 1, 'the ordering was rebuilt from the records that are there');
    } finally { cleanLaunchParent(pid); }
  },

  // ONE COIN READ AGAINST A WHOLE FIELD (3.75.0, owner order 2026-09-06: "just
  // make two boxes: trade coins and compare coins so LTCUSDT can be compared
  // to the universe of others").
  //
  // What is traded and what it is read against used to be ONE list, so the
  // coins a unit was read against were always the other members of that same
  // list. Asking for one coin against everything else was therefore
  // impossible: with one coin in the list there is no second or third to draw
  // from, doubles and triples produced nothing, and the launch refused with
  // "the universe and sizes produced no units" -- which is true, useless, and
  // reads as a fault in the system rather than in the boxes.
  async oneTradedCoinCanBeReadAgainstAWholeFieldOfOthers() {
    const g = ['daily-4d'];
    const field = ['AAAUSDT', 'BBBUSDT', 'CCCUSDT', 'DDDUSDT'];
    // THE CASE THAT FAILED: one traded coin, triples
    const tri = stages.unitsFor(['LTCUSDT'], { triples: true }, g, field);
    assert.strictEqual(tri.length, 6, 'one coin against four others is every PAIR of them: 4 choose 2');
    for (const u of tri) {
      assert.strictEqual(u.trade, 'LTCUSDT', 'only the trade coins are ever traded');
      assert.ok(field.includes(u.ctx1) && field.includes(u.ctx2), 'and it is read against the compare coins');
    }
    const dbl = stages.unitsFor(['LTCUSDT'], { doubles: true }, g, field);
    assert.strictEqual(dbl.length, 4, 'one coin against four others is four doubles');
    // A COIN IS NEVER READ AGAINST ITSELF, whichever list it came from
    const both = stages.unitsFor(['AAAUSDT'], { doubles: true }, g, ['AAAUSDT', 'BBBUSDT']);
    assert.deepStrictEqual(both.map((u) => u.ctx1), ['BBBUSDT'],
      'a coin in both lists must not be read against itself');
    // BLANK COMPARE COINS IS THE UNIVERSE, not the trade coins (owner,
    // 2026-09-06: "BLANK = THE UNIVERSE"). One coin typed into trade coins
    // with nothing beside it is somebody asking for that coin against
    // everything, which is the whole reason the box exists — and the trade box
    // already reads blank the same way, on its own label.
    const DEF = ['LTCUSDT', 'AAAUSDT', 'BBBUSDT', 'CCCUSDT', 'DDDUSDT'];
    withDownloaded(DEF, () => {
      const blank = stages.unitsFor(['LTCUSDT'], { triples: true }, g, []);
      const spelled = stages.unitsFor(['LTCUSDT'], { triples: true }, g, DEF);
      assert.deepStrictEqual(blank, spelled, 'blank must be every downloaded coin spelled out, exactly');
      assert.ok(blank.length > 0, 'and it must produce units — this is the case that refused');
      // a coin in trade coins that is ALSO downloaded is still never read
      // against itself, so the count is over the others alone
      const n = DEF.length - (DEF.includes('LTCUSDT') ? 1 : 0);
      assert.strictEqual(blank.length, (n * (n - 1)) / 2 * g.length, 'every pair of the others, per shape, and no pair holding the coin itself');
    });
    // AND A BOX WITH NOTHING DOWNLOADED MEANS NOTHING (3.122.0). Blank used to
    // be a typed list that always had seventeen names in it; read off the cache
    // it can be empty, and the launch has to say so rather than build no units
    // and leave the owner guessing which box was wrong.
    withDownloaded([], () => {
      assert.deepStrictEqual(stages.unitsFor(['LTCUSDT'], { triples: true }, g, []), [],
        'nothing downloaded means nothing to read a coin against');
    });
    // AND SINGLES NEVER READS IT. There is nothing for a coin on its own to be
    // read against, so whatever is in the box changes nothing at all.
    assert.deepStrictEqual(stages.unitsFor(['LTCUSDT'], { singles: true }, g, ['AAAUSDT', 'BBBUSDT']),
      stages.unitsFor(['LTCUSDT'], { singles: true }, g, []),
      'the compare coins must not change a singles run in any way');
  },

  // AND THE REFUSAL NAMES WHICH BOX IS WRONG AND BY HOW MUCH (owner, 2026-09-06:
  // "what's this nonsense?"). "the universe and sizes produced no units" names
  // both boxes, neither number, and nothing to do about it.
  async aLaunchWithNothingToScoreSaysWhichBoxIsShortAndByHowMany() {
    // compare coins spelled out and holding nothing but the traded coin: there
    // is no OTHER coin in it, so a triple has nothing to read LTCUSDT against.
    // (Blank would be every coin downloaded and would run — that is the point
    // of the box, and it is held in the test above.)
    const base = { sizes: { triples: true }, nullN: 3, fee: 0.00125, universe: ['LTCUSDT'], compare: ['LTCUSDT'], name: `t-${Date.now().toString(36)}` };
    let msg = '';
    try { stages.startStage1(base); } catch (err) { msg = String(err.message); }
    assert.match(msg, /triples reads each traded coin against 2 other coins/, 'it must say what the shape needs');
    assert.match(msg, /compare coins offers 0 that are not itself/, 'and how many the box really offers, which is the number that matters');
    assert.match(msg, /or tick singles/, 'and what to do about it');
    // and a BLANK box is the universe, so the same shape has plenty to score.
    // Asked of the enumerator, not of startStage1: launching a real run inside
    // a test claims the one heavy-job slot and every assertion after it reads
    // "one heavy job at a time" instead of what it was checking.
    assert.ok(withDownloaded(['LTCUSDT', 'AAAUSDT', 'BBBUSDT', 'CCCUSDT'],
      () => stages.unitsFor(['LTCUSDT'], { triples: true }, ['daily-4d'], []).length) > 0,
      'one coin with a blank compare box must have plenty to score — it is that coin against every coin downloaded');
    // doubles is short by one, and says so in its own words
    let msg2 = '';
    try { stages.startStage1({ ...base, sizes: { doubles: true } }); } catch (err) { msg2 = String(err.message); }
    assert.match(msg2, /doubles reads each traded coin against 1 other coin/, 'one coin, not "1 coins"');
  },

  // THE COINS AND SHAPES TICKED ON COINS AS UNITS (owner GO NOW! 2026-09-14).
  // Each pair builds its own units at its own shape and nothing else is built;
  // a launch with `passers: true` reads them off Coins and refuses when there
  // are none; a set relaunched from its own record uses the pairs as written.
  aLaunchCanTakeTheCoinsAndShapesTickedOnCoins() {
    const sizes = { singles: true, doubles: false, triples: false };
    const pairs = [{ coin: 'ltcusdt', geometry: 'daily-3d' }, { coin: 'ATOMUSDT', geometry: 'daily-2d' }, { coin: 'BCHUSDT', geometry: 'weekly-8d' }, { coin: 'BCHUSDT', geometry: 'daily-1d' }];
    const units = stages.unitsForPassers(pairs, sizes, []);
    assert.deepStrictEqual(units.map((u) => `${u.trade}@${u.geometry}`), ['LTCUSDT@daily-3d', 'ATOMUSDT@daily-2d', 'BCHUSDT@weekly-8d', 'BCHUSDT@daily-1d'], 'one unit per pair, at its own shape, the coin upper-cased');
    assert.ok(units.every((u) => u.size === 1 && u.ctx1 === null), 'singles read nothing against');
    assert.deepStrictEqual(stages.unitsForPassers([{ coin: 'LTCUSDT', geometry: 'no-such-shape' }, { coin: '', geometry: 'daily-1d' }], sizes, []), [], 'a pair with no coin or no such shape builds nothing');
    // 3.203.0: a pair's extras and the families over them ride onto every unit it makes
    const plat = [{ centre: 1, members: [0, 1, 2], from: { set: 'W-1' } }];
    const ex = [{ lookbackHours: 24, bandPct: 100 }, { lookbackHours: 48, bandPct: 100 }, { lookbackHours: 96, bandPct: 100 }];
    const withFam = stages.unitsForPassers([{ coin: 'LTCUSDT', geometry: 'daily-3d', extras: ex, plateaus: plat }], { singles: false, doubles: true, triples: false }, ['LTCUSDT', 'AAAUSDT', 'BBBUSDT']);
    assert.strictEqual(withFam.length, 2);
    assert.ok(withFam.every((u) => u.extras === ex && u.plateaus === plat), 'the extras and their plateaus do not reach every unit the pair makes');
    assert.ok(!('plateaus' in stages.unitsForPassers(pairs.slice(0, 1), sizes, [])[0]), 'a pair with no extras grows a plateaus field it has no use for');
    // doubles: each pair still at its own shape, read against the compare coins
    const dbl = stages.unitsForPassers(pairs.slice(0, 1), { singles: false, doubles: true, triples: false }, ['LTCUSDT', 'AAAUSDT', 'BBBUSDT']);
    assert.deepStrictEqual(dbl.map((u) => `${u.trade}+${u.ctx1}@${u.geometry}`), ['LTCUSDT+AAAUSDT@daily-3d', 'LTCUSDT+BBBUSDT@daily-3d']);
    // the launch refuses with nothing ticked, before anything is written
    // RE-AIMED 3.185.0: the tick became a choice of three, named by the screen
    // as where this run takes its units from, so the launch is asked for a
    // source BY NAME. Each of the two lists refuses in its own words, because
    // with two of them the owner has to be told which one it looked in.
    const coinsrun = require('../lib/coinsrun');
    const was = coinsrun.passingUnits;
    const asked = [];
    coinsrun.passingUnits = (src) => { asked.push(src); return []; };
    try {
      assert.throws(() => stages.startStage1({ coinsSource: 'passers', sizes, nullN: 3, fee: 0.00125, name: `p-${Date.now().toString(36)}` }), /nothing is ticked under coins and shapes that pass, at the top of Coins/);
      assert.throws(() => stages.startStage1({ coinsSource: 'walk', sizes, nullN: 3, fee: 0.00125, name: `w-${Date.now().toString(36)}` }), /no row is ticked from a walk set, at the top of Coins/);
      assert.deepStrictEqual(asked, ['passers', 'walk'], 'the launch asks the list the owner named, and no other');
      // a name no screen offers is refused, never coerced
      assert.throws(() => stages.startStage1({ coinsSource: 'sometimes', sizes, nullN: 3, fee: 0.00125, name: `x-${Date.now().toString(36)}` }), /there is no unit source called "sometimes"/);
    } finally { coinsrun.passingUnits = was; }
    // and the launch's own source: pairs replace the boxes and are written on the set
    const st = fs.readFileSync(path.join(__dirname, '..', 'lib', 'stages.js'), 'utf8');
    const launch = st.slice(st.indexOf('function startStage1(params) {'), st.indexOf('const setName = nameOrRefuse(params.name, 1);'));
    assert.ok(/const source = params\.coinsSource == null \? 'none' : String\(params\.coinsSource\);/.test(launch), 'the launch reads the source by name');
    assert.ok(/&& source !== 'none'\)\n\s+\? require\('\.\/coinsrun'\)\.passingUnits\(source\)/.test(launch), 'a named source reads that list off Coins');
    assert.ok(/const units = passers \? unitsForPassers\(passers, sizes, compare\) : unitsFor\(universe, sizes, geometries, compare\);/.test(launch), 'the pairs build the units');
    assert.ok(/\? \[\.\.\.new Set\(passers\.map\(\(x\) => x\.coin\)\)\]/.test(launch) && /\? \[\.\.\.new Set\(passers\.map\(\(x\) => x\.geometry\)\)\]/.test(launch), 'the universe and the shapes are read off the pairs');
    assert.ok(/coinsSource: source, plainUnits: plain, passers: passers \|\| null, campaign:/.test(st), 'the source and the pairs are written on the set');
    // THE CONTROL ARM IS ONE LIST, NOT TWO (3.194.0, owner order: "how do you
    // propose I do a 1 to 1 comparison ... that's the only way I can get a
    // matching set of units"). Same units, extra members left out -- and the
    // extras are dropped in ONE place, wrapping both branches, so what the run
    // uses and what the set records are the same list. Recording units with
    // extras a run did not use would grow members on a relaunch (RULE NINE).
    assert.ok(/const plain = params\.plainUnits === true;/.test(launch), 'the launch reads the control arm by name');
    assert.ok(/const passers = dropExtras\(/.test(launch), 'and drops the extras once, around both branches');
    assert.ok(!/passersUsed/.test(launch), 'never as a second list beside the first');
  },

  // THE 80/20 LAYOUT IS GONE FROM STAGE 1 (owner order, 2026-09-08). It kept no
  // held-back slice; the Sweep's box no longer offers it, a launch that asks
  // for it is refused by name, and the chunk split always keeps one.
  theEightyTwentyLayoutIsGoneFromStageOne() {
    const values = (require('../lib/vocabulary').vocabulary().windowLayout || []).map((c) => c.value);
    assert.deepStrictEqual(values, ['split70', 'reserve61'], `the window layout box offers ${JSON.stringify(values)}`);
    const base = { universe: ['BTCUSDT'], sizes: { singles: true }, geometry: 'daily-1d', nullN: 9, fee: 0.00125 };
    let msg = '';
    try { stages.startStage1({ ...base, windowLayout: 'legacy80' }); } catch (err) { msg = String(err.message); }
    assert.match(msg, /the 80\/20 window layout was removed/, 'a launch asking for it is refused by name');
    const sw = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8');
    assert.ok(!/legacy80/.test(sw.replace(/\/\/[^\n]*/g, '')), 'the chunk split no longer knows the name');
    // re-aimed 3.94.0 at the retrain layout's own splitter; RE-AIMED 3.111.0 at
    // the invariant that only that layout reached a split with no held-back
    // slice; RE-AIMED AGAIN 3.142.0, when that layout and its splitter went
    // (the History retrain run uses the set's own layout and is judged on the
    // Held window). The invariant now: NOTHING reaches a split without a
    // held-back slice, because none exists -- a pass is split with its judge,
    // everything else with the split that keeps a held-back slice.
    const pick = sw.slice(sw.indexOf('const split = passCut'), sw.indexOf('// THE ACTUAL DATE RANGES'));
    assert.ok(pick.length > 80 && pick.length < 900, 'the chunk split no longer chooses its splitter in one place');
    const bw = require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'bracketwork.js'), 'utf8');
    assert.ok(!/splitAndLabelAt|retrain72/.test(sw.replace(/\/\/[^\n]*/g, '')) && !/splitAndLabelAt|retrain72/.test(bw.replace(/\/\/[^\n]*/g, '')),
      'a splitter that returns no held-back slice, or the layout that reached it, is back');
    // RE-AIMED 3.183.0: both splitters now also take the extras' bands, which
    // are declared numbers and never fitted. The invariant is unchanged - a
    // pass is split with its judge, everything else with a held-back slice.
    assert.ok(/passCut\s*\?\s*splitAndLabelPass\(workChunks, branch, passCut\.nTrain, passCut\.judge, extraBands\)\s*:\s*splitAndLabel\(workChunks, branch, true, extraBands\);/.test(pick),
      'the split is no longer: a pass with its judge, everything else with a held-back slice');
    // and a pass really does come back with one, run rather than read
    const made = require('../lib/bracketwork').splitAndLabelPass(
      Array.from({ length: 400 }, (_, i) => ({ startTs: i, diffPct: (i % 31) - 15 })), { band: 'auto' }, 280, 40);
    assert.strictEqual(made.holdChunks.length, 40, 'a pass comes back with no held-back slice, so its judge would never be priced');
  },

  // A PRICED RECORD NAMES THE CHOICES THAT MADE IT (owner order, 2026-08-26;
  // moved here from the older engine's totals tests when that engine was
  // retired, 3.97.0). A record that does not name its decision, band and 24/5
  // is an anonymous number in a table read to learn which choices work — so
  // the stage 3 write site is pinned, and the screen must show them.
  theRecordedRowNamesItsChoices() {
    const work = fs.readFileSync(path.join(ROOT, 'lib', 'stagework.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
    assert.ok(/decision: stream\.decision,/.test(work)
      && /bandMode: stream\.band === 'auto' \? 'auto' : Number\(stream\.band\),/.test(work)
      && /weekdaysOnly: !!stream\.weekdaysOnly,/.test(work),
      'a priced stage 3 record no longer names the choices that made it');
    const page = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
    const head = page.slice(page.indexOf("api/stageset/${doc.id}/coin-rows"), page.indexOf('</thead>', page.indexOf("api/stageset/${doc.id}/coin-rows")));
    assert.ok(head.length > 200, 'the opened records rows are gone from the every-coin table');
    for (const col of ['>decision</th>', '>band</th>', '>24/5</th>']) {
      assert.ok(head.includes(col), `the records table no longer shows its ${col.replace(/[<>/th]/g, '')} column`);
    }
    const tt = head.indexOf('>test trades</th>');
    const bc = head.indexOf('>beat its own null set</th>');
    const hb = head.indexOf('>held-back $</th>');
    assert.ok(tt >= 0 && bc >= 0 && hb >= 0 && tt < bc && bc < hb,
      'the records\' beat its own null set column is missing or out of its ordered place');
  },

  // THE HELD-BACK WINDOW IS BEHIND A TICK ON BOARDS (3.131.0, owner order:
  // "hide it behind a tick that we can select, and it will count as a look the
  // way tune does"). Off, the held-back numbers do not leave the service; on,
  // one dated look is written on the stage 3 set, and Verify counts it.
  async theHeldBackWindowIsBehindATickOnBoards() {
    const stamp = Date.now().toString(36);
    const id = `s3-test-${stamp}-tick`;
    const s1 = `s1-test-${stamp}-tick`;
    const busy = `s3-test-${stamp}-busy`;
    const setFile = (x) => path.join(SETS_DIR, `${x}.json`);
    try {
      fs.mkdirSync(SETS_DIR, { recursive: true });
      const base = { createdAt: new Date().toISOString(), plan: { units: 1, settings: 2 }, params: { nullN: 3 }, recordsVersion: stages.RECORDS_V };
      fs.writeFileSync(setFile(id), JSON.stringify({ ...base, id, stage: 3, seq: 999985, name: 'S3 #tick', status: 'done' }));
      fs.writeFileSync(setFile(s1), JSON.stringify({ ...base, id: s1, stage: 1, seq: 999984, name: 'S1 #tick', status: 'done' }));
      fs.writeFileSync(setFile(busy), JSON.stringify({ ...base, id: busy, stage: 3, seq: 999983, name: 'S3 #busy', status: 'running' }));
      const w = rowstore.writer(id, 'records');
      const mk = (si, label, hold) => ({
        si, label, decision: 'argmax', bandMode: 'auto', weekdaysOnly: false, bandPct: 2,
        entry: 'market', gate: null, dMult: null, tHours: 65, trailMult: null, armMult: null,
        quorum: 2, members: 6, pnl: 10 + si, trades: 3,
        holdout: { pnl: hold, trades: 4, stops: 1, vsAlwaysLong: 2 },
        beat: 2, pairs: 3, lead: 0.5, u: 0, trade: 'AAA', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
        confirm: 'off', lean: null, verdict: null,
      });
      w.push(mk(0, 'q x · argmax auto 24/7', 30));
      w.push(mk(1, 'q y · argmax auto 24/7', -4));
      w.close();
      await stages.buildTally({ id });

      // OFF: the held-back numbers do not leave the service, on either table
      const off = stages.stage3Ranked(id, 0, 10);
      assert.deepStrictEqual([off.heldBack, off.sortSetAside, off.total], [false, null, 2]);
      for (const r of off.rows) for (const k of ['avgHold', 'avgTrades', 'avgVsLong', 'beat', 'pairs', 'avgLead', 'coinsInMoney']) assert.ok(!(k in r), `${k} left the service with the window hidden`);
      assert.ok(off.rows.every((r) => r.avgTest != null), 'the test money does not ride with the window hidden');
      // and the totalled rows carry the test-trade count, because a Funnel board
      // read on all units together IS these rows and its trade floor reads it
      assert.ok(off.rows.every((r) => r.testTrades === 3), 'a totalled row carries no test-trade count, so a floor on it drops every row of a board read on all units together');
      const blend = await stages.funnelBoard(id, stages.readTally(id), 'all');
      assert.deepStrictEqual(blend.all.map((r) => r.testTrades), [3, 3], 'the blended board has no test-trade count');
      assert.strictEqual(require('../lib/funnel').ladderFor(blend.all, 'testTrades', 'min').measured, 2, 'the ladder on the blended board measures nothing');
      const on = stages.stage3Ranked(id, 0, 10, null, { heldBack: true });
      assert.deepStrictEqual([on.heldBack, on.rows.map((r) => r.avgHold).sort((a, b) => a - b)], [true, [-4, 30]], 'with the tick on the held-back column is not served');
      const offC = stages.stage3Coins(id, {});
      assert.deepStrictEqual([offC.heldBack, offC.total], [false, 2]);
      for (const r of offC.rows) for (const k of ['share', 'beat', 'pairs', 'avgHold', 'avgTrades', 'avgVsLong']) assert.ok(!(k in r), `${k} left the every-coin table with the window hidden`);
      assert.deepStrictEqual(stages.stage3Coins(id, { heldBack: '1' }).rows.map((r) => r.avgHold).sort((a, b) => a - b), [-4, 30]);
      // a request that is not exactly '1' is off: the service cannot be talked into a look by a stale or malformed request
      assert.strictEqual(stages.stage3Coins(id, { heldBack: 'true' }).heldBack, false);
      assert.strictEqual(stages.stage3Ranked(id, 0, 10, null, { heldBack: 'yes' }).heldBack, true, 'the ranked door decides the tick, and hands the service a boolean');

      // ON: one dated look on the set per tick, whichever tables were open
      assert.strictEqual(stages.getSet(id).heldBackLooks, undefined, 'a fresh set carries looks');
      const first = stages.recordHeldBackLook(id, ['Table 3.A', 'Table 3.B']);
      assert.strictEqual(first.looks, 1);
      assert.deepStrictEqual([first.look.on, first.look.tables], ['Boards', ['Table 3.A', 'Table 3.B']]);
      assert.ok(!Number.isNaN(Date.parse(first.look.at)), 'the look is not dated');
      const second = stages.recordHeldBackLook(id, ['Table 3.A', 'Table 3.B', 'records']);
      assert.strictEqual(second.looks, 2, 'the second tick on is not a second look');
      const looks = stages.getSet(id).heldBackLooks;
      assert.strictEqual(looks.length, 2, 'the looks are not written on the set');
      assert.deepStrictEqual(looks[1].tables, ['Table 3.A', 'Table 3.B', 'records']);
      assert.strictEqual(stages.recordHeldBackLook(id, null).look.tables.length, 0, 'no table list is a refusal rather than an empty list');
      assert.strictEqual(stages.recordHeldBackLook(id, new Array(20).fill('x')).look.tables.length, 8, 'the table list is not capped');
      // refusals: unknown, not stage 3, still being written -- and a refusal writes nothing
      for (const [bad, why] of [['no-such-set', /unknown record set/], [s1, /only a stage 3 record set/], [busy, /still being written/]]) {
        let threw = null;
        try { stages.recordHeldBackLook(bad, []); } catch (e) { threw = e.message; }
        assert.ok(threw && why.test(threw), `${bad}: expected ${why}, got ${threw}`);
      }
      assert.strictEqual(stages.getSet(busy).heldBackLooks, undefined, 'a refusal wrote a look');

      // VERIFY COUNTS THEM, the way it counts a scan on Tune
      const seen = stages.verifyLooksOf({ parent: { id }, steps: [1, 2], backSteps: [1] }, null, 0);
      assert.strictEqual(seen.boardLooks, 4);
      assert.ok(seen.what.some((w) => w === 'Boards showed the held-back columns of S3 #tick 4 time(s), each a counted look'), seen.what.join(' | '));
      assert.strictEqual(seen.unstamped, 4, 'the walk\'s own looks are no longer counted');
      const none = stages.verifyLooksOf({ parent: { id: busy }, steps: [], backSteps: [] }, null, 0);
      assert.strictEqual(none.boardLooks, 0);
      assert.ok(none.what.some((w) => w === 'Boards has not shown the held-back columns of S3 #busy since they went behind a tick'), none.what.join(' | '));

      // the doors: the ranked table is asked with the tick, and the look has its own door
      const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
      assert.ok(srv.includes("{ heldBack: String(req.query.heldBack || '') === '1' }"), 'the ranked door does not pass the tick to the service');
      assert.ok(srv.includes("app.post('/api/stageset/:id/held-back-look'") && srv.includes('stages.recordHeldBackLook(req.params.id, (req.body || {}).tables)'),
        'there is no door for the look, or it does not write one');
    } finally {
      for (const x of [id, s1, busy]) { try { fs.unlinkSync(setFile(x)); } catch (_) { /* gone */ } }
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-tally.json.gz`)); } catch (_) { /* gone */ }
      try { fs.unlinkSync(path.join(SETS_DIR, `${id}-agreed.json.gz`)); } catch (_) { /* gone */ }
      rowstore.remove(id);
    }
  },

  // THE SCREEN SIDE OF THE TICK (3.131.0): off on every visit, one tick above
  // Table 3.A covering Table 3.A, Table 3.B and the records under a row, the
  // look written before anything held-back is drawn, and every held-back
  // column of the three tables inside the tick, head and cell alike.
  theBoardsScreenKeepsTheHeldBackColumnsBehindTheTick() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(ui.includes('let bHeldBack = false;'), 'the tick has no page state');
    // off on every visit: the tab click and the return from a Sweep launch both put it back
    const tabs = ui.slice(ui.indexOf("$('#tabs').querySelectorAll('.tab').forEach((t) => {"), ui.indexOf('draw().then(() => restoreScroll(tab));  // and back to where we were on this one'));
    assert.ok(tabs.includes('bHeldBack = false;'), 'a tab click does not hide the held-back window again');
    assert.ok(ui.includes("    tab = 'sweep';\n    bHeldBack = false;"), 'the return to Sweep does not hide the held-back window again');
    // the tick itself, above Table 3.A, and the note when a saved sort is set aside
    assert.ok(ui.includes('<input type="checkbox" id="bHeldBack" ${bHeldBack ? \'checked\' : \'\'}> show the held-back window</label>'), 'the tick is not drawn, or not by that name');
    assert.ok(ui.indexOf('id="bHeldBack"') < ui.indexOf('<b>Table 3.A: Settings, ranked</b>'), 'the tick is not above Table 3.A');
    assert.ok(ui.includes('the sort saved on this set reads the held-back window (${esc(bHeldBackSortWords(ranked.sortSetAside))}); it is set aside while the window is hidden'),
      'the page does not say a saved held-back sort was set aside');
    assert.ok(ui.includes('Table 3.B was sorting by ${esc(B_HELD_BACK_WORDS_3B[coins.sortSetAside] || coins.sortSetAside)}, a held-back column; while the window is hidden it reads by beat the kept null money'),
      'the page does not say which held-back column Table 3.B was sorting by');
    // the words the two notes name a set-aside sort by are the headings on the screen, tied to their sort keys
    const words3A = new Function(`${ui.slice(ui.indexOf('const B_HELD_BACK_WORDS_3A = '), ui.indexOf('const B_HELD_BACK_WORDS_3B = '))}; return B_HELD_BACK_WORDS_3A;`)();
    const words3B = new Function(`${ui.slice(ui.indexOf('const B_HELD_BACK_WORDS_3B = '), ui.indexOf('function bHeldBackSortWords('))}; return B_HELD_BACK_WORDS_3B;`)();
    assert.deepStrictEqual(Object.keys(words3A).sort(), ['avgHold', 'avgLead', 'avgTrades', 'avgVsLong', 'beat', 'coinsInMoney'], 'Table 3.A: a held-back sort key has no screen word');
    assert.deepStrictEqual(Object.keys(words3B).sort(), ['money', 'pairs', 'share', 'trades', 'vslong'], 'Table 3.B: a held-back sort key has no screen word');
    for (const [key, word] of Object.entries(words3A)) assert.ok(ui.includes(`>${word}\${bRankSortBtn(doc, '${key}'`), `Table 3.A: "${word}" is not the heading sorted by ${key}`);
    for (const [key, word] of Object.entries(words3B)) assert.ok(ui.includes(`>${word}\${bCoinSortBtn(view, '${key}'`), `Table 3.B: "${word}" is not the heading sorted by ${key}`);
    // both tables are asked with the tick, and the every-coin table's own order changes with it
    assert.strictEqual(ui.split("heldBack: bHeldBack ? '1' : '',").length - 1, 2, 'the two table requests do not both carry the tick');
    assert.ok(ui.includes("sort: coinsQ.sort || (bHeldBack ? 'share' : 'beatnoise')"), 'the every-coin table does not read in its own order with the window hidden');
    // the look is written before anything held-back is drawn, and a failed write draws nothing
    const wire = ui.slice(ui.indexOf("const hb = $(mount).querySelector('#bHeldBack');"), ui.indexOf("$(mount).querySelectorAll('[data-brec]')"));
    assert.ok(wire.includes("const tables = ['Table 3.A', 'Table 3.B', ...(openKeys.size ? ['records'] : [])];"), 'the look does not say which tables were open');
    assert.ok(wire.includes('const r = await tryPost(`api/stageset/${doc.id}/held-back-look`, { tables });'), 'ticking on writes no look');
    assert.ok(wire.includes('if (!r) { bHeldBack = false; hb.checked = false; return; }'), 'a failed write still draws the held-back columns');
    assert.ok(wire.indexOf('tryPost(') < wire.indexOf("bRepaintTable(3, { peg: '[data-bcoinhead]' });"), 'the columns are drawn before the look is written');
    // EVERY held-back column of the three tables sits inside the tick, head and
    // cell alike. Read within the stage 3 drawer: the Funnel's cut table draws
    // avg held-back $ too, and that is the once-only look the cut is for.
    const start = ui.indexOf('async function bDrawStage3(');
    const nextFn = /\n(?:async )?function /g;
    nextFn.lastIndex = start + 1;
    const b3 = ui.slice(start, nextFn.exec(ui).index);
    assert.ok(b3.includes('coin-rows?') && b3.includes("querySelector('#bHeldBack')"), 'the records under a row and the tick are not drawn by the stage 3 drawer');
    const blocks = [];
    for (let at = 0; ;) {
      const s = b3.indexOf('${bHeldBack ? `', at);
      if (s < 0) break;
      const e = b3.indexOf("` : ''}", s);
      assert.ok(e > s, 'a tick block does not close');
      blocks.push(b3.slice(s, e));
      at = e;
    }
    const heads = blocks.flatMap((b) => [...b.matchAll(/<th [^>]*>(.*?)(?=\$\{|<)/g)].map((m) => m[1]));
    const cells = blocks.reduce((a, b) => a + (b.match(/<td /g) || []).length, 0);
    assert.deepStrictEqual(heads, [
      'avg held-back $', 'avg held-back trades', 'avg vs always-long $', 'beat its own null set', 'lead over null set', 'coins in the money',
      'beat its own null set', 'comparisons', 'avg held-back', 'avg held-back trades', 'avg vs always-long',
      'beat its own null set', 'held-back $', 'held-back trades', 'held-back stops', 'vs always-long', 'held-back verdict',
    ], 'the held-back columns inside the tick are not the seventeen of Table 3.A, Table 3.B and the records under a row');
    assert.strictEqual(cells, heads.length, 'a held-back heading and its cells are not inside the tick together');
    assert.strictEqual(b3.split('...(bHeldBack ? [').length - 1, 4, 'the floors on the held-back columns are not inside the tick on both tables');
    // and none of those headings is drawn outside the tick
    const outside = blocks.reduce((x, b) => x.replace(b, ''), b3);
    for (const h of ['>avg held-back $${', '>avg held-back trades', '>coins in the money', '>comparisons', '>held-back verdict']) {
      assert.ok(!outside.includes(h), `"${h}" is drawn outside the tick too`);
    }
    // confirm prints as a value on both tables and the records, and the six numbers go under the word
    assert.strictEqual(ui.split('<td ${btd}>${bConfirm(r)}</td>').length - 1, 2, 'Table 3.A and Table 3.B do not both print confirm through bConfirm');
    assert.ok(ui.includes('<td ${btd}>${bVerdict(r.verdict, r.lean, r.confirm, r.kx, r.ux)}</td>'), 'Table 3.A does not hand the word its six numbers');
    assert.ok(ui.includes('<td ${btd}>${bVerdict(r.verdict, r.lean ? r.lean.test : null, r.confirm, r.kx, r.ux)}</td>'), 'Table 3.B does not hand the word its six numbers');
    assert.ok(ui.includes("confirm${bCoinSortBtn(view, 'confirm', '↑')}</th>"), 'Table 3.B has no confirm column');
    assert.ok(ui.includes("const keyOf = (r) => [r.cellLabel, r.trade, r.ctx1 || '', r.ctx2 || '', r.geometry, r.confirm || 'off', r.fieldLabel || ''].join('|');"),
      'a coin row is not keyed by its value of confirm and of the field\'s gate, so two rows of one coin open and close together');
    assert.ok(ui.includes("const q = new URLSearchParams({ cellLabel, trade, ctx1, ctx2, geometry, confirm: confirm || 'off', fieldLabel: fieldLabel || '' }).toString();"),
      'the records under a row are not asked for by the row\'s value of confirm and of the field\'s gate');
    assert.ok(ui.includes('or sized with its multipliers">confirm</th>') && ui.includes('Empty on a record priced with confirm off or with no lean.">verdict</th>'),
      'the records under a row do not show confirm and verdict');
    assert.ok(ui.includes('${bConfirm({ confirm: r.confirm, lean: r.lean, kx: r.lean ? r.lean.kx : null, ux: r.lean ? r.lean.ux : null })}'), 'a record\'s confirm is not printed through bConfirm');
    assert.ok(ui.includes('${bVerdict(r.verdict ? r.verdict.test : null, r.lean ? r.lean.test : null, r.confirm, r.lean ? r.lean.kx : null, r.lean ? r.lean.ux : null)}'),
      'a record\'s test verdict does not carry its six numbers');
    assert.ok(ui.includes('${bVerdict(r.verdict ? r.verdict.hold : null, r.lean ? r.lean.hold : null, r.confirm, r.lean ? r.lean.kx : null, r.lean ? r.lean.ux : null)}'),
      'a record\'s held-back verdict does not carry its six numbers');
    const help = fs.readFileSync(path.join(ROOT, 'public', 'help-content.js'), 'utf8');
    assert.ok(help.includes('bHeldBack: {'), 'the tick has no help entry');
  },

  // OFF IS PRINTED AS A VALUE, AND THE SIX NUMBERS ARE ON THE SCREEN (3.131.0,
  // owner order: "put that off marker on as opposed to a dash ... I don't want
  // them hiding just behind the tooltip"). The page's own helpers, run here.
  theConfirmCellPrintsOffAndTheSixNumbersShowUnderTheWord() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const body = ui.slice(ui.indexOf('function bConfirm(r) {'), ui.indexOf('function bRankSortBtn('));
    const { bConfirm, bLeanNumbers, bVerdict } = new Function([
      "const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');",
      "const money = (v) => '$' + Number(v).toFixed(2);",
      "const VOCAB = { confirmVerdict: [{ value: 'better signal', why: 'the rule' }] };",
      body,
      'return { bConfirm, bLeanNumbers, bVerdict };',
    ].join('\n'))();
    // off is printed as a value, not a dash
    assert.strictEqual(bConfirm({ confirm: 'off' }), 'off');
    assert.strictEqual(bConfirm({}), 'off', 'a record priced before the dial existed was priced off');
    assert.strictEqual(bConfirm({ confirm: 'sized', kx: 2, ux: 1, lean: { c: {} } }), 'sized <span class="muted">×2/×1</span>');
    assert.strictEqual(bConfirm({ confirm: 'confirmed only', lean: { c: {} } }), 'confirmed only');
    assert.strictEqual(bConfirm({ confirm: 'confirmed only', lean: null }), 'confirmed only <span class="muted">(no unit carried a lean)</span>');
    // the six numbers, visible under the word, never made up
    const parts = { c: { pnl: 8, n: 4 }, u: { pnl: -3, n: 3 }, z: { pnl: 1, n: 1 } };
    assert.strictEqual(bLeanNumbers(null, 'sized', 2, 1), '', 'numbers are made up where there is no lean');
    assert.strictEqual(bLeanNumbers({ c: parts.c }, 'sized', 2, 1), '', 'half a lean prints half the numbers');
    assert.strictEqual(bLeanNumbers(parts, 'sized', 2, 1),
      // 3.228.0: a block that may wrap between its parts, never one line that may not
      '<div class="muted bnums"><span style="white-space:nowrap">confirmed $8.00 over 4</span> · <span style="white-space:nowrap">unconfirmed $-3.00 over 3</span> · <span style="white-space:nowrap">no lean $1.00 over 1</span> · <span style="white-space:nowrap">at size 1 $6.00 → sized $14.00</span></div>');
    assert.ok(bLeanNumbers(parts, 'confirmed only').endsWith('at size 1 $6.00 → confirmed only $9.00</span></div>'), 'confirmed only does not drop the unconfirmed trades');
    assert.ok(bLeanNumbers(parts, 'off').endsWith('at size 1 $6.00</span></div>'), 'off has money under it beyond the money at size 1');
    // the word carries them on the screen, with a hover for the rule; no word, no numbers
    const v = bVerdict('better signal', parts, 'sized', 2, 1);
    assert.ok(v.startsWith('<div class="bwords"><span title="the rule">better signal</span><div class="muted'), v);
    assert.ok(!/title="[^"]*confirmed \$/.test(v), 'the six numbers are in a hover, not on the screen');
    assert.strictEqual(bVerdict('better signal'), '<div class="bwords"><span title="the rule">better signal</span></div>');
    assert.strictEqual(bVerdict(null, parts, 'sized', 2, 1), '<span class="muted">—</span>', 'no word, no numbers');
  },
};
