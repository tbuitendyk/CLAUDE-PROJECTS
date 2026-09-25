// Greenlight + shuttle (plan phase 4): config construction from the lab's own
// selection anchor, freeze rules, provenance chain integrity, and the
// no-hand-built-configs door. Synthetic lab docs; scratch dirs for both
// registries.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.GC_SETUPS_DIR = process.env.GC_SETUPS_DIR
  || fs.mkdtempSync(path.join(os.tmpdir(), 'gc-gl-setups-'));
process.env.GC_GREENLIGHTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-gl-'));

const gl = require('../lib/live/greenlight');
const reg = require('../lib/live/setups');









// DETERMINISTIC guard for the same-millisecond ordering defect (was: list sorted
// only on millisecond createdUtc; two mints in one ms tied and fell through to
// filesystem readdir order — undefined "newest first"). We seed two records with
// EQUAL createdUtc whose filenames sort OLDER-first, but whose creation order
// (seq) is NEWER = gl-zzz-newer. Without the seq tiebreak the tie leaves them in
// readdir (filename) order = oldest first -> this FAILS. With it -> newest first.
// Reintroducing the bug (dropping the seq compare) was watched turning this red.
module.exports.sameMillisecondMintsSortByCreationOrderNotFilename = function () {
  const dir = process.env.GC_GREENLIGHTS_DIR;
  const T = '2030-01-01T00:00:00.000Z';            // equal ms for both -> forces the tie
  // filename order (readdir is lexical here): 'gl-aaa-older' < 'gl-zzz-newer'
  fs.writeFileSync(path.join(dir, 'gl-aaa-older.json'),
    JSON.stringify({ id: 'gl-aaa-older', createdUtc: T, seq: 10, why: 'older' }));
  fs.writeFileSync(path.join(dir, 'gl-zzz-newer.json'),
    JSON.stringify({ id: 'gl-zzz-newer', createdUtc: T, seq: 11, why: 'newer' }));
  const list = gl.listGreenlights();
  const iOld = list.findIndex((x) => x.id === 'gl-aaa-older');
  const iNew = list.findIndex((x) => x.id === 'gl-zzz-newer');
  assert.ok(iNew >= 0 && iOld >= 0, 'both seeded records listed');
  assert.ok(iNew < iOld,
    `newer (seq 11) must precede older (seq 10) despite filename order; got new@${iNew} old@${iOld}`);
};



// ---- THE STAGE 4 DOOR (3.90.0) ----
// A synthetic source shaped like what lib/stages.js hands over: a three-coin
// unit, a survivor with the agreement it carries, the members as the stage 2
// set trained them, the verdict block that stood.
function stage4Src(over = {}) {
  return {
    set: { id: 's4-test-1', stage: 4, name: 'S4 #1 - LTCUSDT daily-4d', release: '3.90.0', unit: 'LTCUSDT|XRPUSDT|BCHUSDT|daily-4d', unitName: 'LTCUSDT + XRPUSDT + BCHUSDT daily-4d', ruleSentence: 'gate is directional; t is 41h to 89h', counts: { survivors: 3 }, parent: { id: 's3-test-1', name: 'S3 #1' }, stage2: { id: 's2-test-1', name: 'S2 #1' }, campaign: 'ltc-drill' },
    gate: { id: 's4-test-1-v1', at: '2026-09-08T00:00:00.000Z', release: '3.90.0', look: 1 },
    unit: { trade: 'LTCUSDT', ctx1: 'XRPUSDT', ctx2: 'BCHUSDT', size: 3, geometry: 'daily-4d' },
    survivor: { si: 4, label: 'count 50% market t65h · argmax auto 24/7', decision: 'argmax', bandMode: 'auto', bandPct: 1.69, weekdaysOnly: false, entry: 'market', gate: 'directional', dMult: null, tHours: 65, trailMult: null, armMult: null, agreeRule: 'count', agreeBar: 'all', agreePct: 50, agreeCopy: 98, agreeBoth: false, agreePersist: 0, members: 8, avgRung: 4, avgVoices: 5, avgTest: 12.5, avgHold: 4.2 },
    pick: { by: 'depth', measure: 'neighbours', index: 1, si: 4, label: 'count 50% market t65h · argmax auto 24/7', deviance: 0.25, nearby: { survived: 3, of: 4 }, tied: 1, of: 3 },
    survivors: [],
    members: [{ model: 'logreg', view: 'full' }, { model: 'logreg', view: 'prices' }, { model: 'logreg', view: 'volume' }, { model: 'logreg', view: 'pricevol' }, { model: 'boost', view: 'full' }, { model: 'boost', view: 'prices' }, { model: 'boost', view: 'volume' }, { model: 'boost', view: 'pricevol' }],
    training: { trainOn: 'direction', weightCap: null, windowLayout: 'reserve61', startMonth: '2023-01', endMonth: '2026-06', allLoaded: false, nullN: 9 },
    fee: 0.00125,
    readings: { held: { money: 4.2, trades: 12 }, reserve: { money: 1.1, trades: 6, look: 1 } },
    ...over,
  };
}

// THE SURVIVOR'S AGREEMENT IS FROZEN AS IT CARRIES IT, and no integer quorum is
// invented for it; the record names the set, the block, the pick and how it was
// chosen; the fee the set was priced under rides under the name every reader
// of a greenlight already looks for.
module.exports.aStage4GreenlightFreezesTheSurvivorsAgreementNotAQuorum = function () {
  const rec = gl.greenlightFromStage4(stage4Src(), { name: 'LTC depth pick', why: 'verdict PASS; reserve grade look 1 PASS' });
  const cfg = rec.configSnapshot;
  assert.strictEqual(cfg.engine, 'stages');
  assert.strictEqual(cfg.stage, 'stages');
  assert.deepStrictEqual(cfg.combo, { trade: 'LTCUSDT', ctx1: 'XRPUSDT', ctx2: 'BCHUSDT', size: 3 });
  assert.deepStrictEqual(cfg.branch, { geometry: 'daily-4d', decision: 'argmax', band: 1.69, weekdaysOnly: false });
  assert.strictEqual(cfg.members.length, 8, 'the members as the stage 2 set trained them');
  assert.strictEqual(cfg.cell.quorum, null, 'no integer quorum is invented');
  assert.deepStrictEqual({ entry: cfg.cell.entry, gate: cfg.cell.gate, tHours: cfg.cell.tHours, dMult: cfg.cell.dMult }, { entry: 'market', gate: 'directional', tHours: 65, dMult: null });
  assert.deepStrictEqual(cfg.agreement, { rule: 'count', bar: 'all', pct: 50, copy: 98, both: false, persist: 0, plateau: null, rung: 4, members: 8, voices: 5 });
  assert.strictEqual(cfg.training.trainOn, 'direction');
  assert.strictEqual(rec.target, 'stage4');
  // how surrounded it is, and by what measure (3.248.0)
  assert.deepStrictEqual(rec.pick, { by: 'depth', measure: 'neighbours', label: 'count 50% market t65h · argmax auto 24/7', si: 4, deviance: 0.25, nearby: { survived: 3, of: 4 }, tied: 1, of: 3 });
  assert.deepStrictEqual({ set: rec.sourceSet.id, block: rec.sourceSet.block.id, parent: rec.sourceSet.parent.id, stage2: rec.sourceSet.stage2.id }, { set: 's4-test-1', block: 's4-test-1-v1', parent: 's3-test-1', stage2: 's2-test-1' });
  assert.strictEqual(rec.sourceRun.feePerLeg, 0.00125, 'the fee rides under the name every reader looks for');
  assert.deepStrictEqual(rec.rowSummary.holdout, { pnl: 4.2, trades: 12 });
  assert.deepStrictEqual(rec.rowSummary.unread, { pnl: 1.1, trades: 6, look: 1 });
  assert.ok(gl.listGreenlights().some((g) => g.id === rec.id), 'it is listed with the others');
  // and the shared vocabulary reads it back as valid
  const { validateConfig } = require('../lib/live/configschema');
  assert.strictEqual(validateConfig(cfg).ok, true, validateConfig(cfg).errors.join('; '));
  // a named pick is recorded as named
  const named = gl.greenlightFromStage4(stage4Src({ pick: { by: 'named', measure: 'neighbours', index: 0, si: 2, label: 'count 50% market t41h · argmax auto 24/7', deviance: 1, nearby: { survived: 0, of: 2 }, of: 3 } }), { name: 'LTC named', why: 'my pick' });
  assert.strictEqual(named.pick.by, 'named');
  assert.deepStrictEqual([named.pick.deviance, named.pick.nearby, named.pick.tied], [1, { survived: 0, of: 2 }, null], 'a named pick records how surrounded it is, and no tie');
};

// REFUSED IN WORDS: no verdict, a single coin, no members, no band. A trade
// shape the executor does not do yet is not refused here since 3.252.0 --
// aBreakoutSurvivorIsGreenlightedAsPricedAndCannotBeStartedUntilTheExecutorDoesIt.
module.exports.aStage4GreenlightRefusesInWordsAndShuttlesOnlyIntoADraft = function () {
  const cases = [
    [() => gl.greenlightFromStage4(stage4Src({ gate: null }), { name: 'x', why: 'x' }), /no verdict on this set is PASS/],
    [() => gl.greenlightFromStage4(stage4Src({ unit: { trade: 'LTCUSDT', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d' } }), { name: 'x', why: 'x' }), /a coin read on its own/],
    [() => gl.greenlightFromStage4(stage4Src({ members: [] }), { name: 'x', why: 'x' }), /names no members/],
    [() => gl.greenlightFromStage4(stage4Src({ survivor: { ...stage4Src().survivor, bandPct: null } }), { name: 'x', why: 'x' }), /band/],
    [() => gl.greenlightFromStage4(stage4Src(), { name: 'x' }), /WHY/],
    [() => gl.greenlightFromStage4(stage4Src(), { why: 'x' }), /NAME|name/],
    [() => gl.greenlightFromStage4(stage4Src({ survivor: { ...stage4Src().survivor, agreeRule: 'majority' } }), { name: 'x', why: 'x' }), /agreement\.rule/],
    // 3.130.0: the live path reads no lean off Coins, so a survivor priced
    // with confirm past off cannot be traded as it was priced
    [() => gl.greenlightFromStage4(stage4Src({ survivor: { ...stage4Src().survivor, confirm: 'sized' } }), { name: 'x', why: 'x' }), /priced with confirm set to sized, and the live path has no reading of the coin's own lean yet/],
  ];
  for (const [fn, re] of cases) {
    let err = null;
    try { fn(); } catch (e) { err = e; }
    assert.ok(err && re.test(err.message), `expected /${re.source}/, got: ${err && err.message}`);
  }
  // the dry read's refusal is the same words the press throws
  assert.strictEqual(gl.stage4Refusal(stage4Src()), null);
  assert.strictEqual(gl.stage4Refusal(stage4Src({ survivor: { ...stage4Src().survivor, confirm: 'off' } })), null, 'a survivor priced at off is what every survivor before 3.130.0 was');
  assert.ok(/a coin read on its own/.test(gl.stage4Refusal(stage4Src({ unit: { trade: 'LTCUSDT', ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d' } }))));
  // MINTED, IT SHUTTLES INTO A DRAFT AND PASSES THE LIVE DOOR (3.91.0: the live
  // path speaks its agreement) -- and a draft trades nothing: only the owner's
  // Activate press on the Trade tab puts it to work, never anything in a loop.
  const rec = gl.greenlightFromStage4(stage4Src(), { name: 'LTC depth pick', why: 'x' });
  const { setup } = gl.shuttle(rec.id, { name: 'LTC draft', clipUsd: 100, trainPolicy: { mode: 'rolling' } });
  assert.strictEqual(setup.state, 'draft', 'a shuttle makes a draft, and a draft trades nothing');
  assert.strictEqual(setup.configSnapshot.engine, 'stages');
  assert.deepStrictEqual(gl.getGreenlight(rec.id).shuttledSetupIds, [setup.id]);
  const { liveExecutable } = require('../lib/live/configschema');
  assert.strictEqual(liveExecutable(rec.configSnapshot).ok, true, liveExecutable(rec.configSnapshot).errors.join('; '));
  let threw = null;
  // a way of weighing that reads no bar carries none, and a bar-reading one must carry its bar
  const trained = gl.greenlightFromStage4(stage4Src({ survivor: { ...stage4Src().survivor, agreeRule: 'trained', agreeBar: null, agreePct: null } }), { name: 'trained', why: 'x' });
  assert.deepStrictEqual({ rule: trained.configSnapshot.agreement.rule, bar: trained.configSnapshot.agreement.bar, pct: trained.configSnapshot.agreement.pct }, { rule: 'trained', bar: null, pct: null });
  threw = null;
  try { gl.greenlightFromStage4(stage4Src({ survivor: { ...stage4Src().survivor, agreeBar: null } }), { name: 'x', why: 'x' }); } catch (e) { threw = e; }
  assert.ok(threw && /agreement\.bar/.test(threw.message), threw && threw.message);
};

// THE PROMOTION IS NOT THE START (3.252.0, owner 2026-09-25: "update the system
// to NOT refuse the promotion to Trade due to breakout instead of market ... i
// want to be able to promote a row to Trade based on the current design and
// then we are going to shift the focus to implementing on the Trade tab, first
// as a paper trade"). A survivor priced with breakout entry, the active gate, a
// trailing stop and an arm is greenlighted exactly as it was priced; what the
// live executor does not do yet is said in words; and the one door into Paper
// Books and Live Trading still refuses it, so nothing built from it can trade.
module.exports.aBreakoutSurvivorIsGreenlightedAsPricedAndCannotBeStartedUntilTheExecutorDoesIt = function () {
  const shape = { entry: 'breakout', gate: 'active', dMult: 0.75, tHours: 65, trailMult: 1, armMult: 0.5 };
  const src = stage4Src({ survivor: { ...stage4Src().survivor, ...shape } });
  assert.strictEqual(gl.stage4Refusal(src), null, 'the shape is not a refusal');
  const rec = gl.greenlightFromStage4(src, { name: 'LTC breakout', why: 'held set PASS' });
  const c = rec.configSnapshot.cell;
  assert.deepStrictEqual({ entry: c.entry, gate: c.gate, dMult: c.dMult, tHours: c.tHours, trailMult: c.trailMult, armMult: c.armMult }, shape, 'frozen exactly as it was priced');
  assert.ok(gl.listGreenlights().some((g) => g.id === rec.id), 'and listed, which is what puts it on the Trade tab');
  const words = [
    'its entry is breakout, and the live executor only does market entry',
    'its gate is active, and the live executor only does the directional gate',
    'it carries a trailing stop, which the live executor does not have',
    'it carries an arm, which the live executor does not have',
  ];
  assert.deepStrictEqual(gl.notYetStartable(c), words, 'what the live executor does not do yet, in words');
  assert.deepStrictEqual(gl.notYetStartable(src.survivor), words, 'the same words off the survivor, before the press');
  assert.deepStrictEqual(gl.notYetStartable(stage4Src().survivor), [], 'a market survivor on the directional gate carries none');
  // THE DOOR INTO PAPER BOOKS AND LIVE TRADING STILL REFUSES IT
  const { liveExecutable } = require('../lib/live/configschema');
  assert.strictEqual(liveExecutable(rec.configSnapshot).ok, false);
  const { setup } = gl.shuttle(rec.id, { name: 'LTC breakout draft', clipUsd: 100, trainPolicy: { mode: 'rolling' } });
  assert.strictEqual(setup.state, 'draft', 'a shuttle makes a draft, and a draft trades nothing');
  for (const to of ['paper', 'live']) {
    let threw = null;
    try { reg.transition(setup.id, to, 'owner', 'test'); } catch (e) { threw = e; }
    assert.ok(threw && threw.code === 'NOT_LIVE_EXECUTABLE' && /only does MARKET entry/.test(threw.message), `${to}: ${threw && threw.message}`);
    assert.strictEqual(reg.getSetup(setup.id).state, 'draft', `${to}: still a draft`);
  }
};

// A CONFIG'S NAME TAKES 100 CHARACTERS (3.252.2, owner 2026-09-25: "make the
// Greenlight name field 100 characters"), and so does every deployment a
// rename carries it to -- a setup that took only 80 would refuse the rename.
module.exports.aConfigNameTakesAHundredCharactersEverywhereItIsCarried = function () {
  const n100 = 'N'.repeat(100);
  assert.strictEqual(gl.NAME_MAX, 100);
  const rec = gl.greenlightFromStage4(stage4Src(), { name: n100, why: 'x' });
  assert.strictEqual(rec.name, n100, 'a hundred characters, kept whole');
  let threw = null;
  try { gl.greenlightFromStage4(stage4Src(), { name: `${n100}N`, why: 'x' }); } catch (e) { threw = e; }
  assert.ok(threw && /name: 100 characters or fewer/.test(threw.message), threw && threw.message);
  const { setup } = gl.shuttle(rec.id, { name: rec.name, clipUsd: 100, trainPolicy: { mode: 'rolling' } });
  assert.strictEqual(setup.name, n100, 'the deployment takes the whole name');
  const renamed = gl.relabel(rec.id, { name: 'R'.repeat(100) });
  assert.deepStrictEqual(renamed.renamedSetups, [setup.id], 'a rename reaches it');
  assert.strictEqual(reg.getSetup(setup.id).name, 'R'.repeat(100));
};
