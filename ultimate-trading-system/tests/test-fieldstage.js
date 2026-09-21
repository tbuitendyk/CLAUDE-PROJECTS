// THE FIELD'S GATE THROUGH STAGE 3 (FIELD-DESIGN.md section F; owner LOOP
// NOW! 2026-09-21): the gate is an axis of the block that multiplies only on
// units the field covers, the launch refuses what it cannot price in words,
// the record row carries the gate and its numbers, and both Boards tables
// carry a column, a sort and a floor for it. Modelled on the 3.207.0 test
// for avg test trades, which is the shape every column on those tables takes.
const { assert } = require('./helpers');
const fs = require('fs');
const path = require('path');
const stages = require('../lib/stages');
const rowstore = require('../lib/rowstore');
const fieldGate = require('../lib/fieldgate');
const sw = require('../lib/stagework');

const SETS_DIR = path.join(__dirname, '..', 'data', 'stagesets');
const BLOCK = {
  cell: { entry: 'market', gate: 'directional', tHours: 65 },
  cellPermute: {}, decision: 'argmax', band: 'auto', weekdaysOnly: false,
  agreeRule: 'count', agreeBar: 'all', agreePct: 50, agreeCopy: 98, agreeBothModels: false, agreePersist: 0,
  confirm: 'off',
};
const REC = (trade, geometry = 'daily-4d') => ({ trade, ctx1: null, ctx2: null, size: 1, geometry, u: 0, plateaus: [], extras: [] });

function theGateIsAnAxisThatMultipliesOnlyWhereTheFieldCovers() {
  // no field: one gate value, null, and every setting reads as it always did
  const plain = stages.settingsFor(BLOCK, [1], null);
  assert(plain.length >= 1 && plain.every((st) => st.field === null && st.fieldId === null), 'a run naming no field carries no gate on its settings');
  assert(!plain[0].label.includes('field'), 'and names them exactly as before');
  // a field with two reads, two minimums and two ladders permuted: eight gates
  const p = { ...BLOCK, fieldId: 'F-1', fieldRead: 'agreement', fieldPermuteRead: true, fieldAgreeMin: '20, 40', fieldPermuteAgreeMin: true, fieldCertMin: '', fieldRule: 'both', fieldSignOnly: false, fieldRungs: '100:1; 50:0.5,100:2', fieldPermuteRungs: true, fieldSilent: '1' };
  const axes = stages.fieldAxesFor(p);
  assert.strictEqual(axes.gates.length, 8, `two reads x two agreement bars x no certainty bar x one sign-only x two ladders is eight gates, got ${axes.gates.length}`);
  const gated = stages.settingsFor(p, [1], null);
  assert.strictEqual(gated.length, plain.length * 8, 'the gate multiplies the block');
  assert(gated.every((st) => st.field && st.fieldId === 'F-1' && st.label.includes(fieldGate.gateLabel(st.field))), 'every setting carries its gate and names it');
  // TWO BARS (3.218.0): a certainty list beside the agreement list, and the
  // rule permuted, multiplies again; with one bar the rule tells nothing apart
  // and is one value whatever its tick says
  const two = stages.fieldAxesFor({ ...p, fieldCertMin: '60, 70', fieldPermuteCertMin: true, fieldPermuteRule: true });
  assert.strictEqual(two.gates.length, 32, `two reads x two agreement bars x two certainty bars x two rules x two ladders is 32 gates, got ${two.gates.length}`);
  assert.deepStrictEqual([...new Set(two.gates.map((g) => g.rule))].sort(), ['both', 'either']);
  assert.strictEqual(stages.fieldAxesFor({ ...p, fieldPermuteRule: true }).gates.length, 8, 'with one bar the rule is not permuted');
  assert.strictEqual(stages.fieldAxesFor({ ...p, fieldRule: 'either' }).gates[0].rule, 'both', 'with one bar the rule is recorded as both, its one value');
  const bare = stages.fieldAxesFor({ ...p, fieldAgreeMin: ' ', fieldPermuteRead: false, fieldPermuteRungs: false });
  assert.strictEqual(bare.gates.length, 1);
  assert.strictEqual(bare.gates[0].agreeMin, null, 'a blank box is no bar');
  assert.ok(fieldGate.gateLabel(bare.gates[0]).includes('no minimum'), fieldGate.gateLabel(bare.gates[0]));
  // the certainty refusal, in words, for a bar or a read on a field built without copies
  const noCopies = { id: 'F-1', name: 'x', dials: { copies: 0 } };
  assert.strictEqual(stages.certaintyRefusal(axes.gates.filter((g) => g.read === 'agreement'), noCopies), null, 'agreement alone asks nothing of the copies');
  assert.match(String(stages.certaintyRefusal(axes.gates, noCopies)), /carries no certainty/, 'a read of certainty needs copies');
  assert.match(String(stages.certaintyRefusal([{ read: 'agreement', agreeMin: 20, certMin: 60 }], noCopies)), /leave the certainty minimum blank/, 'a certainty bar needs copies');
  assert.strictEqual(stages.certaintyRefusal(two.gates, { ...noCopies, dials: { copies: 20 } }), null, 'with copies nothing is refused');
  // the count: the gate multiplies only on a unit the field covers
  const recs = [REC('AAA'), REC('BBB')];
  const pairs = { 'AAA|daily-4d': 'AAA|daily-4d' };
  const counted = stages.countDeclared(p, [1], recs, null, pairs);
  assert.strictEqual(counted.fieldUnits, 1, 'one of the two units is covered');
  assert.strictEqual(counted.fieldGates, 8);
  assert.strictEqual(counted.perUnit[0], counted.perUnit[1] * 8, 'the covered unit holds eight settings for every one the other holds');
  const none = stages.countDeclared(p, [1], recs, null, {});
  assert.strictEqual(none.kept, stages.countDeclared(BLOCK, [1], recs, null, {}).kept, 'with no unit covered every gate value folds to one and the block is what it was');
  // and the launch's own fold says the same as the count (foldKeyRest): the
  // covered unit prices every gate, the other folds the eight into one. The
  // count multiplies by the gates on its own, so only the fold can see the
  // key -- a guard on the key was found not really checked (3.213.1) because
  // nothing here read it.
  const held = stages.heldOnFor(gated, recs, null, pairs);
  assert.strictEqual(held[0].length, gated.length, 'the covered unit prices one setting per gate');
  assert.strictEqual(held[1].length, gated.length / 8, 'the uncovered unit folds the eight gates into one');
  assert.strictEqual(stages.heldOnFor(gated, recs, null, {})[0].length, gated.length / 8, 'with no unit covered the fold holds one gate everywhere');
  // refusals in words
  const bad = (over, words) => {
    let msg = '';
    try { stages.fieldAxesFor({ ...p, ...over }); } catch (err) { msg = err.message; }
    assert(msg.includes(words), `${JSON.stringify(over)} should refuse with "${words}", got "${msg}"`);
  };
  bad({ fieldRead: 'hope' }, 'not a way to read the field');
  bad({ fieldAgreeMin: 'x' }, 'agreement minimum: a read is 0 to 100');
  bad({ fieldCertMin: '10, 10' }, 'certainty minimum repeats a value');
  bad({ fieldRule: 'most' }, 'not a way to combine the minimums');
  bad({ fieldRungs: '50:1' }, 'must reach 100');
  bad({ fieldSilent: '-1' }, 'silent');
}

// THE RECORD ROW, THE TABLES, THE SORTS AND THE FLOORS.
async function theGateIsAColumnASortAndAFloorOnBothTables() {
  assert.strictEqual(stages.TALLY_V, 10, 'the tables carry the field from version 10; an older table is rebuilt on open');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'construct.js'), 'utf8');
  assert.ok(/>field\$\{bRankSortBtn\(doc, 'fieldVerdict', 'desc'\)\}/.test(ui), 'Table 3.A has no field column');
  assert.ok(/>field verdict\$\{bRankSortBtn\(doc, 'fieldVerdict', 'desc'\)\}/.test(ui), 'Table 3.A has no field verdict column, or it does not sort');
  assert.ok(/>field sized \$\$\{bRankSortBtn\(doc, 'fieldSized', 'desc'\)\}/.test(ui), 'Table 3.A has no field sized $ column, or it does not sort');
  assert.ok(/>field blocked, %\$\{bRankSortBtn\(doc, 'fieldBlocked', 'asc'\)\}/.test(ui), 'Table 3.A has no field blocked column, or it does not sort');
  assert.ok(/>field\$\{bCoinSortBtn\(view, 'fieldverdict', '↓'\)\}/.test(ui), 'Table 3.B has no field column');
  assert.ok(/>field sized \$\$\{bCoinSortBtn\(view, 'fieldsized', '↓'\)\}/.test(ui), 'Table 3.B has no field sized $ column, or it does not sort');
  assert.ok(/\['fieldSizedMin', 'field sized \$ at least', 'num'/.test(ui), 'Table 3.A has no floor on field sized $');
  assert.ok(/\['minFieldSized', 'field sized \$ at least', 'num'/.test(ui), 'Table 3.B has no floor on field sized $');
  // and every floor Table 3.B draws reaches the service (the two that did not
  // before 3.212.0 are named here so they can never go quiet again)
  for (const k of ['minTestTrades', 'minBeatNoise', 'minFieldSized', 'maxFieldBlocked', 'minFieldRead']) {
    assert.ok(new RegExp(`${k}: coinF\\.${k} \\?\\? ''`).test(ui), `Table 3.B draws a ${k} floor the page never sends`);
  }
  // the Sweep form: the field group, its ticks bottom-aligned, its params sent and filled
  assert.ok(/id="swGrpField" style="display:flex;align-items:flex-end/.test(ui), 'the field group on Sweep does not bottom-align its ticks to its boxes (RULE FOUR-A)');
  for (const id of ['swField', 'swFieldRead', 'swPermFieldRead', 'swFieldAgreeMin', 'swPermFieldAgreeMin', 'swFieldCertMin', 'swPermFieldCertMin', 'swFieldRule', 'swPermFieldRule', 'swFieldSignOnly', 'swPermFieldSignOnly', 'swFieldRungs', 'swPermFieldRungs', 'swFieldSilent']) {
    assert.ok(ui.includes(`id="${id}"`), `Sweep has no ${id}`);
    assert.ok(new RegExp(`\\$\\('#${id}'\\)`).test(ui), `${id} is drawn and never read into the launch`);
  }
  assert.ok(/setV\('#swField', p\.fieldId \|\| ''\)/.test(ui), 'Copy settings into the form does not carry the field');

  const id = `s3-test-${Date.now().toString(36)}-fg`;
  const file = path.join(SETS_DIR, `${id}.json`);
  const doc = {
    id, stage: 3, seq: 999974, name: 'S3 #fg', status: 'done', createdAt: new Date().toISOString(),
    plan: { units: 1, settings: 3 }, params: { nullN: 9 },
    recordsVersion: stages.RECORDS_V,
  };
  const gate = { read: 'agreement', agreeMin: 20, certMin: null, rule: 'both', signOnly: false, rungs: '50:1,100:2', silent: 1 };
  const totals = (pnl, at1, size, placed, blockedSign, blockedAt1) => ({ pnl, trades: placed, size, at1, blockedAt1, blockedN: blockedSign, placed, blockedSign, blockedMin: 0, silent: 0, readSum: 60 * placed, readN: placed });
  const mk = (si, trade, field) => ({
    si, label: `count 75% market t65h · argmax auto 24/7${field ? fieldGate.gateLabel(field) : ''}`,
    decision: 'argmax', bandMode: 'auto', weekdaysOnly: false,
    bandPct: 2, entry: 'market', gate: 'directional', dMult: null, tHours: 65, trailMult: null, armMult: null,
    agreeRule: 'count', agreePct: 75, agreeBoth: false, agreePersist: 0,
    rung: 6, members: 8, voices: 8, pnl: 10, trades: 6,
    holdout: { pnl: 5, trades: 4, stops: 1, vsAlwaysLong: 2 },
    beat: 5, pairs: 9, lead: 1, u: 0, trade, ctx1: null, ctx2: null, size: 1, geometry: 'daily-4d',
    confirm: 'off',
    field: field ? { ...field, test: field.test, hold: null } : null,
    fieldVerdict: field ? { test: fieldGate.verdictOf(field.test), hold: null } : null,
  });
  try {
    fs.mkdirSync(SETS_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(doc));
    const w = rowstore.writer(id, 'records');
    // setting 0: gated, sized money 30 on AAA (placed 6, 2 blocked that lost) and 10 on BBB
    w.push(mk(0, 'AAA', { ...gate, test: totals(30, 12, 8, 6, 2, -5) }));
    w.push(mk(0, 'BBB', { ...gate, test: totals(10, 9, 6, 6, 0, 0) }));
    // setting 1: gated, the gate cost money on its one coin
    w.push(mk(1, 'AAA', { ...gate, agreeMin: 40, test: totals(4, 8, 4, 4, 2, 3) }));
    // setting 2: no gate at all
    w.push(mk(2, 'AAA', null));
    w.close();
    await stages.buildTally(doc);

    const rk = stages.stage3Ranked(id, 0, 10);
    const by = (si) => rk.rows.find((r) => r.si === si);
    assert.deepStrictEqual([by(0).fieldSized, by(1).fieldSized, by(2).fieldSized], [20, 4, null],
      'field sized $ on Table 3.A is the sized money per coin, averaged, and absent with no gate');
    assert.strictEqual(by(0).fieldVerdict, 'better signal', `setting 0: 40 over 21 at size 1 with the blocked calls losing money, got ${by(0).fieldVerdict}`);
    assert.strictEqual(by(1).fieldVerdict, 'adds nothing', `setting 1: 4 is not above 8 + 3, got ${by(1).fieldVerdict}`);
    assert.strictEqual(by(2).fieldVerdict, null);
    assert(Math.abs(by(0).fieldBlocked - (2 / 14) * 100) < 1e-9, `field blocked on setting 0 is 2 of 14 calls, got ${by(0).fieldBlocked}`);
    assert.strictEqual(by(0).field.rungs, '50:1,100:2', 'the gate rides the ranked row');
    stages.setSetSort(id, [{ key: 'fieldSized', dir: 'desc' }]);
    assert.deepStrictEqual(stages.stage3Ranked(id, 0, 10).rows.map((r) => r.fieldSized), [20, 4, null], 'Table 3.A does not sort by field sized $, or a missing value does not sit last');
    stages.setSetSort(id, [{ key: 'fieldVerdict', dir: 'desc' }]);
    assert.deepStrictEqual(stages.stage3Ranked(id, 0, 10).rows.map((r) => r.si), [0, 1, 2], 'Table 3.A does not sort by field verdict in its written order');
    stages.setSetSort(id, []);
    assert.deepStrictEqual(stages.stage3Ranked(id, 0, 10, { fieldSizedMin: 10 }).rows.map((r) => r.si), [0], 'the floor on field sized $ does not bite on Table 3.A');
    assert.deepStrictEqual(stages.stage3Ranked(id, 0, 10, { fieldBlockedMax: 20 }).rows.map((r) => r.si), [0], 'the ceiling on field blocked does not bite on Table 3.A');
    assert.ok(rk.spread && rk.spread.fieldSizedMin && rk.spread.fieldSizedMin.n === 2, 'the floor has no four numbers beside it, or it counts the row with no value');

    // Table 3.B: one row per gate value, with its own numbers
    const cn = stages.stage3Coins(id, { sort: 'fieldsized' });
    assert.deepStrictEqual(cn.rows.map((r) => [r.trade, r.fieldSized]), [['AAA', 30], ['AAA', 4], ['BBB', 10], ['AAA', null]].sort((a, b) => ((b[1] ?? -1e15) - (a[1] ?? -1e15))),
      'Table 3.B does not carry field sized $ per coin row, or does not sort by it best first');
    assert.strictEqual(new Set(cn.rows.map((r) => r.fieldLabel)).size, 3, 'one coin row per gate value: two gates and none');
    assert.strictEqual(stages.stage3Coins(id, { minFieldSized: 5 }).rows.length, 2, 'the floor on field sized $ does not bite on Table 3.B');
    assert.strictEqual(stages.stage3Coins(id, { maxFieldBlocked: 10 }).rows.length, 1, 'the ceiling on field blocked does not bite on Table 3.B');
    assert.ok(cn.spread && cn.spread.minFieldSized, 'the every-coin floor has no four numbers beside it');
    assert.ok('fieldSized' in cn.rows[0] && 'fieldVerdict' in cn.rows[0], 'the columns must reach the screen with the held-back window hidden');
    // the records under a row are the rows priced under that gate and no other
    const row0 = cn.rows.find((r) => r.trade === 'AAA' && r.fieldSized === 30);
    const under = stages.stage3CoinRows(id, { cellLabel: row0.cellLabel, trade: 'AAA', geometry: 'daily-4d', confirm: 'off', fieldLabel: row0.fieldLabel });
    assert.strictEqual(under.rows.length, 1, `the records under the gated row are its own: ${under.rows.length}`);
    assert.strictEqual(under.rows[0].si, 0);
  } finally {
    try { fs.unlinkSync(file); } catch (_) { /* gone */ }
    try { fs.unlinkSync(path.join(SETS_DIR, `${id}-tally.json.gz`)); } catch (_) { /* gone */ }
    rowstore.remove(id);
  }
}

// THE WINDOW PRICED UNDER THE GATE: sized money is the sum of each multiple
// times its group, the blocked calls are priced once at size 1 beside it, and
// the rich pass reads the calls actually taken.
function theWorkerPricesAWindowUnderTheGate() {
  const days = [{ ts: 100, sign: 1, agreement: 90, certainty: 80, speaking: 5 }, { ts: 200, sign: -1, agreement: 90, certainty: 80, speaking: 5 }];
  const calls = [1, 1, -1, 0];
  const decisionTs = [100, 200, 200, 200];
  const gate = { read: 'agreement', agreeMin: 20, certMin: null, rule: 'both', signOnly: false, rungs: '50:1,100:2', silent: 1 };
  const seen = [];
  const sim = (list) => { seen.push(list.slice()); let pnl = 0; let trades = 0; for (let i = 0; i < list.length; i++) if (list[i]) { pnl += 5 * (i + 1) * list[i]; trades++; } return { pnl, trades, stops: 0 }; };
  const got = sw.priceFieldWindow(calls, decisionTs, days, gate, sim, true);
  // call 0: with the sign, read 90 -> x2; call 1: against -> blocked; call 2: with -> x2
  assert.strictEqual(got.res.pnl, 2 * (5 * 1) + 2 * (5 * 3 * -1), 'sized money');
  assert.strictEqual(got.res.trades, 2);
  assert.strictEqual(got.field.blockedN, 1);
  assert.strictEqual(got.field.blockedAt1, 5 * 2, 'the blocked call at size 1');
  assert.strictEqual(got.field.placed, 2);
  assert.strictEqual(got.field.blockedSign, 1);
  assert.strictEqual(got.parts, null, 'no lean parts under the gate');
  assert.deepStrictEqual(seen[seen.length - 1], [1, 0, -1, 0], 'the rich pass reads the calls actually taken');
}

module.exports = {
  theGateIsAnAxisThatMultipliesOnlyWhereTheFieldCovers,
  theGateIsAColumnASortAndAFloorOnBothTables,
  theWorkerPricesAWindowUnderTheGate,
};
