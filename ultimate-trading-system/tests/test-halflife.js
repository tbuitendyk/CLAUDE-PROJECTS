// THE HISTORY HALF-LIFE RUN (3.94.0, AGEDIAL-DESIGN.md): the same records
// retrained with recent history weighted more, priced beside the unweighted
// column on the stretch the retraining never touched. Run for real on the
// fabricated chain the stage-engine check uses (one year here: the plumbing,
// not the calibration), on both layouts.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const stages = require('../lib/stages');
const sw = require('../lib/stagework');
const HL = require('../lib/halflife');
const G = require('../lib/stagegate');
const Pl = require('../lib/fabricated');
const rowstore = require('../lib/rowstore');

// ONE YEAR IS ENOUGH FOR THE PLUMBING (see tests/test-unreadgrade.js)
const SPAN = { fromMonth: '2024-01', toDate: '2024-12-31' };
const S1 = { ...G.STAGE1, startMonth: SPAN.fromMonth, endMonth: SPAN.toDate.slice(0, 7) };
const ROOT = path.join(__dirname, '..');
const SETS_DIR = path.join(ROOT, 'data', 'stagesets');
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const src2 = src;
const cents = (v) => Math.round(Number(v) * 100);

async function waitSet(id, label, ms = 10 * 60 * 1000) {
  const t0 = Date.now();
  for (;;) {
    const doc = stages.getSet(id);
    if (doc && doc.status !== 'running') return doc;
    if (Date.now() - t0 > ms) throw new Error(`${label} did not finish`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 250); });
  }
}
async function settle(statusOf, label) {
  for (let i = 0; i < 6000; i++) {
    const st = statusOf();
    if (st.error) throw new Error(`${label}: ${st.error}`);
    if (st.result) return st.result;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
  throw new Error(`${label} did not land`);
}
// the same launches the stage-engine check makes, on the same two coins, on the layout asked for
async function chain(tag, windowLayout = 'reserve61') {
  const made = [];
  // WHAT A FAILED LAUNCH MADE IS REMOVED BEFORE THE THROW: a set left behind
  // collides on its name with the next run of this very test.
  const cleanup = () => {
    for (const id of made.slice().reverse()) {
      try { stages.deleteSet(id, id); } catch (_) { /* never written */ }
      try { fs.rmSync(stages.funnelRichFile(id), { force: true }); } catch (_) { /* none */ }
      try { fs.rmSync(path.join(SETS_DIR, `${id}-agreed.json.gz`), { force: true }); } catch (_) { /* none */ }
      try { fs.rmSync(stages.captureFile(id), { force: true }); } catch (_) { /* none */ }
      for (const f of fs.readdirSync(SETS_DIR)) if (f.startsWith(`${id}-halflife-`)) { try { fs.rmSync(path.join(SETS_DIR, f), { force: true }); } catch (_) { /* none */ } }
    }
    const { CACHE_DIR } = require('../lib/binance');
    let files = [];
    try { files = fs.readdirSync(CACHE_DIR); } catch (_) { files = []; }
    for (const f of files) {
      if (G.SYMBOLS.some((sym) => f.startsWith(`${sym}-1h-`))) { try { fs.rmSync(path.join(CACHE_DIR, f), { force: true }); } catch (_) { /* best effort */ } }
    }
  };
  let s1;
  let s2;
  let s3;
  let cut;
  let plant;
  try {
  Pl.generateFabricated(SPAN, G.PLANT, G.SEEDS[G.PLANT], 0);
  Pl.generateFabricated(SPAN, G.FAIR, G.SEEDS[G.FAIR], 1);
  s1 = stages.startStage1({ ...S1, windowLayout, exam: true, name: `${tag} S1` });
  made.push(s1.id);
  const d1 = await waitSet(s1.id, 'stage 1');
  if (d1.status !== 'done') throw new Error(`stage 1 ended ${d1.status}: ${JSON.stringify(d1.failures || [])}`);
  s2 = stages.startStage2({ ...G.STAGE2, from: s1.id, exam: true, name: `${tag} S2` });
  made.push(s2.id);
  const d2 = await waitSet(s2.id, 'stage 2');
  if (d2.status !== 'done') throw new Error(`stage 2 ended ${d2.status}: ${JSON.stringify(d2.failures || [])}`);
  s3 = stages.startStage3({ ...G.STAGE3, from: s2.id, exam: true, name: `${tag} S3` });
  made.push(s3.id);
  const d3 = await waitSet(s3.id, 'stage 3');
  if (d3.status !== 'done') throw new Error(`stage 3 ended ${d3.status}: ${JSON.stringify(d3.failures || [])}`);
  const t = stages.readTally(s3.id) || await stages.buildTally(stages.getSet(s3.id));
  const units = stages.unitsOfSet(t, s3.id);
  plant = (units.find((u) => u.trade === G.PLANT) || {}).key;
  if (!plant) throw new Error('the stage 3 set does not hold the planted coin');
  cut = await stages.cutFunnelSet(s3.id, { rule: G.RULE, closing: { key: 'rule' }, unit: plant, barPct: 100, exam: true, name: `${tag} planted` });
  made.push(cut.id);
  } catch (err) { cleanup(); throw err; }
  return { s1: s1.id, s2: s2.id, s3: s3.id, cut, plant, made, cleanup };
}
// the verdict pressed and the gate opened by hand when the engine's own verdict on the plant fails (decision 76)
async function gated(c) {
  stages.funnelVerifyStart(c.cut.id, { barPct: 100 });
  await settle(() => stages.funnelVerifyStatus(c.cut.id), 'the verdict');
  const withVerdict = stages.getSet(c.cut.id);
  if (!withVerdict.verify[0].verdict.pass) {
    const file = path.join(SETS_DIR, `${c.cut.id}.json`);
    const on = JSON.parse(fs.readFileSync(file, 'utf8'));
    on.verify[0].verdict.pass = true;
    fs.writeFileSync(file, JSON.stringify(on));
  }
  return stages.getSet(c.cut.id);
}
async function ran(c, months) {
  stages.halfLifeStart(c.cut.id, { months });
  const r = await settle(() => stages.halfLifeStatus(c.cut.id), 'the half-life run');
  const set = stages.getSet(c.cut.id);
  return { result: r, block: set.halflife[0], set, file: stages.readHalfLifeRun(c.cut.id, set.halflife[0].id) };
}

module.exports = {
  // THE RETRAIN LAYOUT: a 61/13/13/13 set retrains on the first 72% and tests
  // on the next 15%, with no held-back slice, and the Reserve begins exactly
  // where the sealed layout's seal began.
  async theRetrainLayoutTrainsOnSeventyTwoAndTestsOnFifteenLeavingTheReserveWhereItWas() {
    Pl.generateFabricated(SPAN, G.PLANT, G.SEEDS[G.PLANT], 0);
    try {
      const combo = { trade: G.PLANT, ctx1: null, ctx2: null, size: 1 };
      const base = { allLoaded: false, startMonth: S1.startMonth, endMonth: S1.endMonth, trainOn: 'direction', weightCap: sw.WEIGHT_CAP_DEFAULT, pinnedFiles: null };
      const sealed = await sw.unitChunks(combo, S1.geometry, { ...base, windowLayout: 'reserve61' });
      const re = await sw.unitChunks(combo, S1.geometry, { ...base, windowLayout: 'retrain72' });
      assert.strictEqual(re.reserve.fromTs, sealed.reserve.fromTs, 'the Reserve begins where the seal began');
      assert.strictEqual(re.reserve.chunks, sealed.reserve.chunks, 'and holds the same chunks');
      const total = sealed.split.trainChunks.length + sealed.split.testChunks.length + sealed.split.holdChunks.length + sealed.reserve.chunks;
      assert.strictEqual(re.split.holdChunks.length, 0, 'no held-back slice: the retraining reaches through it');
      assert.strictEqual(re.split.trainChunks.length, Math.round(total * 0.72), `train is 72% of all ${total} chunks`);
      assert.strictEqual(re.split.trainChunks.length + re.split.testChunks.length + re.reserve.chunks, total, 'and test is the rest before the Reserve');
      assert.ok(re.split.testChunks.length >= Math.round(total * 0.15) - 1 && re.split.testChunks.length <= Math.round(total * 0.15) + 1, `test is about 15% (${re.split.testChunks.length} of ${total})`);
      assert.deepStrictEqual(re.windows.hold, null, 'the windows say there is no held-back slice');
      assert.deepStrictEqual(HL.retrainLayoutOf('reserve61'), { layout: 'retrain72', judge: 'reserve', judgeWord: 'Reserve', train: 72, test: 15, untouched: 13 });
      assert.deepStrictEqual(HL.retrainLayoutOf('split70'), { layout: 'split70', judge: 'hold', judgeWord: 'Held', train: 70, test: 15, untouched: 15 });
      assert.throws(() => HL.retrainLayoutOf('legacy80'), /no half-life run for a set built on the 'legacy80' layout/);
    } finally {
      const { CACHE_DIR } = require('../lib/binance');
      for (const f of fs.readdirSync(CACHE_DIR)) if (f.startsWith(`${G.PLANT}-1h-`)) fs.rmSync(path.join(CACHE_DIR, f), { force: true });
    }
  },

  // THE WEIGHT multiplies into the set's own; a starved half-life is refused
  // in the floor's words; the table's reading rules hold: a cent, ties to the
  // unweighted side, the shorter half-life among equals.
  theAgeWeightMultipliesIntoTheSetsOwnWeightsAndAStarvedHalfLifeIsRefusedInWords() {
    const DAY = 86400000;
    const t0 = Date.UTC(2024, 0, 1);
    const chunks = Array.from({ length: 200 }, (_, i) => ({ startTs: t0 + i * DAY, diffPct: (i % 3) - 1 }));
    const direction = HL.halfLifeWeights({ trainOn: 'direction' }, chunks, 0.00125, 365);
    assert.strictEqual(direction.weights.length, 200);
    assert.strictEqual(direction.weights[199], 1, 'the newest day weighs 1');
    assert.ok(Math.abs(direction.weights[0] - Math.pow(0.5, 199 / 365)) < 1e-12, 'the oldest day weighs 0.5^(age/H)');
    assert.ok(Math.abs(direction.effectiveDays - direction.weights.reduce((a, b) => a + b, 0)) < 1e-9, 'effective days are the sum of the age weights');
    assert.strictEqual(direction.weighedByMoney, false);
    const money = HL.halfLifeWeights({ trainOn: 'money', weightCap: 10 }, chunks, 0.00125, 365);
    const base = sw.weightsFor({ trainOn: 'money', weightCap: 10 }, chunks, 0.00125);
    assert.strictEqual(money.weighedByMoney, true);
    for (let i = 0; i < 200; i += 37) assert.ok(Math.abs(money.weights[i] - base[i] * Math.pow(0.5, (199 - i) / 365)) < 1e-12, `day ${i}: the age weight times the money weight`);
    assert.strictEqual(HL.daysOfMonths(12), 365, 'twelve mean months');
    assert.deepStrictEqual(HL.HALF_LIVES_MONTHS, [12, 18, 24, 30, 36, 48]);
    // the reading of a table
    const columns = [{ key: 'h12' }, { key: 'h24' }, { key: 'none' }];
    assert.strictEqual(HL.bestOf({ h12: 10.004, h24: 9, none: 10 }, columns), 'none', 'less than a cent better is not better');
    assert.strictEqual(HL.bestOf({ h12: 10.01, h24: 9, none: 10 }, columns), 'h12', 'a cent better is');
    assert.strictEqual(HL.bestOf({ h12: 12, h24: 12, none: 10 }, columns), 'h12', 'equal half-lives: the shorter');
    assert.strictEqual(HL.bestOf({ h12: null, h24: 12, none: 10 }, columns), 'h24', 'a refused column is not in the running');
    assert.strictEqual(HL.bestOf({ h12: null, h24: null, none: 10 }, columns), 'none');
    assert.strictEqual(HL.bestOf({ h12: 3, h24: null, none: null }, columns), 'h12', 'no unweighted figure: the best half-life');
    const read = HL.readTable([{ label: 'a', money: { h12: 10.01, h24: 9, none: 10 } }, { label: 'b', money: { h12: 1, h24: 2, none: 5 } }], columns);
    assert.deepStrictEqual(read.wins, { h12: 1, h24: 0, none: 1 });
    assert.deepStrictEqual(read.rows.map((r) => r.best), ['h12', 'none']);
    assert.ok(Math.abs(read.averages.h24 - 5.5) < 1e-12 && Math.abs(read.averages.none - 7.5) < 1e-12);
  },

  // THE RUN, FOR REAL, ON A 61/13/13/13 SET: refused until the verdict passed;
  // every survivor a row; the unweighted column is the reserve grade's own
  // money to the cent on the same chunks; the retrained columns are priced on
  // those chunks too; best per row by the declared rules; the retrained
  // members are kept beside the set; a second press is look 2.
  async theRunPricesEveryColumnOnOneStretchAndTheUnweightedColumnIsTheRecordsOwn() {
    const c = await chain('half-life test');
    try {
      let threw = null;
      try { stages.halfLifeStart(c.cut.id, { months: [12] }); } catch (e) { threw = e.message; }
      assert.strictEqual(threw, stages.UNREAD_NO_PASS, 'no verdict, no run');
      const withVerdict = await gated(c);
      let dry = await stages.halfLifeDry(c.cut.id);
      assert.deepStrictEqual({ refused: dry.refused, judge: dry.layout.judge, months: dry.halfLives, runs: dry.runs.length }, { refused: null, judge: 'reserve', months: [12, 18, 24, 30, 36, 48], runs: 0 });
      threw = null;
      try { stages.halfLifeStart(c.cut.id, { months: [] }); } catch (e) { threw = e.message; }
      assert.ok(/tick at least one half-life/.test(threw), threw);
      threw = null;
      try { stages.halfLifeStart(c.cut.id, { months: [7] }); } catch (e) { threw = e.message; }
      assert.ok(/7 is not one of the half-lives offered/.test(threw), threw);
      // the reserve grade first, so its money is on record for the same window
      stages.unreadGradeStart(c.cut.id, {});
      await settle(() => stages.unreadGradeStatus(c.cut.id), 'the reserve grade');
      const grade = stages.getSet(c.cut.id).unread[0];
      const { result, block, file } = await ran(c, [48, 12]);
      assert.deepStrictEqual({ look: result.look, columns: block.columns.map((x) => x.key), judge: block.judge, layout: block.layout }, { look: 1, columns: ['h12', 'h48', 'none'], judge: 'reserve', layout: 'retrain72' }, 'shortest to longest, the unweighted last');
      assert.strictEqual(block.rows.length, withVerdict.survivors.length, 'every survivor a row');
      assert.deepStrictEqual(block.missing, []);
      assert.strictEqual(block.window.fromTs, grade.window.fromTs, 'the same Reserve stretch as the grade');
      assert.strictEqual(block.window.seenToTs, grade.window.seenToTs, 'read as far as the grade read');
      for (const col of block.columns) {
        if (col.key === 'none') continue;
        assert.strictEqual(col.refused, null, `${col.key} was not refused: ${col.refused}`);
        assert.ok(col.effectiveDays > 0 && col.effectiveDays <= block.counts.train, `${col.key}: effective days ${col.effectiveDays} of ${block.counts.train} training chunks`);
      }
      assert.ok(block.columns[0].effectiveDays < block.columns[1].effectiveDays, 'a shorter half-life sees fewer effective days');
      for (const r of block.rows) {
        const g = grade.rows.find((x) => x.label === r.label);
        assert.ok(g, `${r.label} is on the grade`);
        assert.strictEqual(cents(r.money.none), cents(g.money), `${r.label}: the unweighted column is the reserve grade's money`);
        assert.strictEqual(r.trades.none, g.trades, 'and its trades');
        for (const k of ['h12', 'h48']) assert.ok(Number.isFinite(r.money[k]), `${r.label}: ${k} has a figure`);
        assert.strictEqual(r.best, HL.bestOf(r.money, block.columns), `${r.label}: best by the declared rule`);
      }
      const wins = Object.values(block.wins).reduce((a, b) => a + b, 0);
      assert.strictEqual(wins, block.rows.length, 'every row has one winner');
      assert.ok(Math.abs(block.averages.none - block.rows.reduce((a, r) => a + r.money.none, 0) / block.rows.length) < 1e-9, 'the unweighted average');
      // the retrained members are kept beside the set, both kinds, with their saved models
      assert.ok(file && file.halfLives.length === 2, 'the run file holds both half-lives');
      for (const h of file.halfLives) {
        assert.ok(h.members.length >= 2 && h.members.every((m) => m.saved && m.saved.kind && Array.isArray(m.probs) && Array.isArray(m.tauProbs)), `${h.halfLifeMonths}: members with saved models and votes`);
        assert.ok(h.members.some((m) => m.spec.model === 'logreg') && h.members.some((m) => m.spec.model === 'boost'), 'both kinds retrained');
        assert.strictEqual(h.ts.hold.length, 0, 'no held-back votes on the retrain layout');
      }
      // the retrained forecasts are not the originals wearing new names
      const rec2 = rowstore.readAll(c.s2, 'records').find((r) => r.trade === G.PLANT);
      const votes = rowstore.readBlocks(c.s2, 'votes', Array.from({ length: rec2.blocks.votes[1] - rec2.blocks.votes[0] }, (_, i) => rec2.blocks.votes[0] + i)).map((x) => x.row).filter((r) => r.u === rec2.u);
      const origTest = votes.filter((v) => v.w === 0).map((v) => v.m[0]);
      const h12 = file.halfLives.find((h) => h.halfLifeMonths === 12);
      assert.notDeepStrictEqual(h12.members[0].probs.slice(0, 5), origTest.slice(0, 5), 'retrained votes differ from the stored ones');
      // look 2, appended
      const again = await ran(c, [12]);
      assert.strictEqual(again.result.look, 2);
      assert.strictEqual(again.set.halflife.length, 2, 'every press appends, newest first');
      assert.strictEqual(again.set.halflife[1].id, block.id);
      dry = await stages.halfLifeDry(c.cut.id);
      assert.strictEqual(dry.looks, 2);
    } finally { c.cleanup(); }
  },

  // ON A 70/15/15 SET the judge is the Held window, and the unweighted column
  // must be the stage 3 record's own held-back money to the cent: the same
  // pass, the same chunks, the same votes.
  async onASeventyFifteenSetTheUnweightedColumnIsTheRecordsHeldBackMoneyToTheCent() {
    const c = await chain('half-life split70 test', 'split70');
    try {
      await gated(c);
      const dry = await stages.halfLifeDry(c.cut.id);
      assert.strictEqual(dry.layout.judge, 'hold');
      const { block, file } = await ran(c, [24]);
      assert.deepStrictEqual(block.columns.map((x) => x.key), ['h24', 'none']);
      const s3rows = rowstore.readAll(c.s3, 'records').filter((r) => r.trade === G.PLANT);
      for (const r of block.rows) {
        const row = s3rows.find((x) => x.label === r.label);
        assert.ok(row, `${r.label} is on the stage 3 record`);
        assert.strictEqual(cents(r.money.none), cents(row.holdout.pnl), `${r.label}: the unweighted column is the record's held-back money`);
        assert.strictEqual(r.trades.none, row.holdout.trades);
        assert.ok(Number.isFinite(r.money.h24), 'the retrained column has a figure');
      }
      assert.ok(file.halfLives[0].ts.hold.length > 0, 'the held-back votes ride on the retrain');
    } finally { c.cleanup(); }
  },

  // THE 4.h SET FROM THE TABLE (3.95.0): only rows a half-life won, each with
  // its half-life; it stands on its source and is refused where its own numbers
  // would mislead; the capture reads its retrained members and reprices the
  // table's own test money to the cent; the greenlight source carries the
  // half-life forward.
  async theBuildKeepsOnlyRowsAHalfLifeWonAndEachRecordCarriesIts() {
    const c = await chain('half-life build test');
    try {
      await gated(c);
      const { block } = await ran(c, [12, 48]);
      const improved = block.rows.filter((r) => r.best && r.best !== 'none');
      // refused without a name, without a run, and on a table nothing improved on
      let threw = null;
      try { stages.buildHalfLifeSet(c.cut.id, { runId: block.id, name: '' }); } catch (e) { threw = e.message; }
      assert.ok(/name the half-life set/.test(threw), threw);
      threw = null;
      try { stages.buildHalfLifeSet(c.cut.id, { runId: 'no-such-run', name: 'x' }); } catch (e) { threw = e.message; }
      assert.ok(/name which half-life table/.test(threw), threw);
      if (!improved.length) {
        threw = null;
        try { stages.buildHalfLifeSet(c.cut.id, { runId: block.id, name: 'half-life build test set' }); } catch (e) { threw = e.message; }
        assert.ok(/no record improved/.test(threw), threw);
        return;   // the fabricated year gave the half-lives nothing to win; the rest is covered when they do
      }
      const built = stages.buildHalfLifeSet(c.cut.id, { runId: block.id, name: 'half-life build test set' });
      c.made.push(built.id);
      assert.deepStrictEqual({ survivors: built.survivors, of: built.of, from: built.from, run: built.run }, { survivors: improved.length, of: block.rows.length, from: c.cut.id, run: block.id });
      const d = stages.getSet(built.id);
      assert.deepStrictEqual(d.survivors.map((s) => s.label), improved.map((r) => r.label), 'only the rows a half-life won, in the table\'s order');
      for (const s of d.survivors) {
        const r = improved.find((x) => x.label === s.label);
        assert.strictEqual(s.halfLife, Number(String(r.best).slice(1)), `${s.label}: carries the half-life that won`);
        assert.strictEqual(s.money.judge, r.money[r.best]);
        assert.strictEqual(s.money.unweighted, r.money.none);
      }
      assert.deepStrictEqual({ kind: d.derived.kind, from: d.derived.from, run: d.derived.run, judge: d.derived.judge, unit: d.unit, parent: d.parent.id }, { kind: 'halflife', from: c.cut.id, run: block.id, judge: 'reserve', unit: c.plant, parent: c.s3 });
      assert.deepStrictEqual(d.rule, stages.getSet(c.cut.id).rule, 'the source\'s rule rides on it');
      // its standing is its source's; the readings that would mislead refuse it
      assert.deepStrictEqual(stages.gateOfSet(d), stages.unreadGateOf(stages.getSet(c.cut.id)), 'the gate is the source\'s PASS');
      const vd = await stages.funnelVerifyDry(built.id);
      assert.ok(/half-life set built from/.test(vd.refused) && /half-life set built from/.test(vd.rideRefused), vd.refused);
      threw = null;
      try { stages.funnelVerifyStart(built.id, {}); } catch (e) { threw = e.message; }
      assert.ok(/half-life set built from/.test(threw), threw);
      assert.ok(/half-life set built from/.test((await stages.unreadGradeDry(built.id)).refused));
      assert.ok(/half-life set built from/.test((await stages.halfLifeDry(built.id)).refused));
      assert.ok(!stages.funnelCutsFor(c.s3, c.plant).some((x) => x.id === built.id), 'the Funnel\'s own list leaves it out');
      assert.ok(stages.listFunnelSets().some((x) => x.id === built.id && x.derived), 'the server\'s list carries it, marked');
      assert.ok((await stages.halfLifeDry(c.cut.id)).built.some((b) => b.id === built.id && b.run === block.id), 'the source says what was built from it');
      // the capture reads the retrained members: each record's test entries reprice the table's own test money to the cent
      const cd = await stages.tuneCaptureDry(built.id);
      assert.strictEqual(cd.refused, null, cd.refused);
      stages.tuneCaptureStart(built.id);
      await settle(() => stages.tuneCaptureStatus(built.id), 'the capture of the half-life set');
      const cap = stages.readCapture(built.id);
      assert.strictEqual(cap.survivors.length, d.survivors.length, 'every record captured');
      for (const sv of cap.survivors) {
        const s = d.survivors.find((x) => x.label === sv.label);
        assert.strictEqual(sv.halfLife, s.halfLife, `${sv.label}: the capture carries the half-life`);
        assert.strictEqual(sv.entries.hold.length, 0, 'no held-back entries on the retrain layout');
        const r = block.rows.find((x) => x.label === sv.label);
        assert.strictEqual(cents(sv.entries.test.reduce((a, e) => a + e.usd, 0)), cents(r.test[r.best]), `${sv.label}: the captured test entries reprice the table's own test money at that half-life`);
        assert.ok(sv.entries.train.length > 0, 'the members forecast the retrain training window');
      }
      assert.strictEqual(stages.getSet(built.id).capture.rows[0].halfLife, d.survivors[0].halfLife, 'the summary carries it too');
      // the greenlight source carries the half-life forward
      const src = await stages.stage4GreenlightSource(built.id, { pick: 'depth' });
      assert.deepStrictEqual({ gate: src.gate.id, derived: src.set.derived.from }, { gate: stages.unreadGateOf(stages.getSet(c.cut.id)).id, derived: c.cut.id });
      const HLm = src.survivor.halfLife;
      assert.ok([12, 48].includes(HLm), `the survivor carries its half-life (${HLm})`);
      assert.strictEqual(src.training.halfLife, HL.daysOfMonths(HLm), 'in days, for the live path');
      assert.strictEqual(src.training.halfLifeMonths, HLm);
      assert.strictEqual(src.readings.halfLife.months, HLm);
      assert.ok(src.survivors.every((x) => [12, 48].includes(x.halfLife)), 'every listed survivor carries one');
      // A TABLE WHERE ONE ROW NOTHING IMPROVED ON. The fabricated year lets a
      // half-life win every row, so a build that kept every row would read the
      // same as one that keeps only the winners — the guard on that filter was
      // missed for exactly this reason. Mark one row as the unweighted column's
      // in the stored table, and the build must leave it out; mark them all,
      // and it must refuse in words.
      const sourceDoc = stages.getSet(c.cut.id);
      const storedRows = sourceDoc.halflife.find((r) => r.id === block.id).rows;
      const victim = storedRows.find((r) => r.best && r.best !== 'none');
      victim.best = 'none';
      fs.writeFileSync(path.join(ROOT, 'data', 'stagesets', `${c.cut.id}.json`), JSON.stringify(sourceDoc));
      const again = stages.buildHalfLifeSet(c.cut.id, { runId: block.id, name: 'half-life build test set, one row out' });
      c.made.push(again.id);
      assert.strictEqual(again.survivors, improved.length - 1, 'the row nothing improved on is counted out');
      assert.deepStrictEqual(stages.getSet(again.id).survivors.map((s) => s.label), improved.map((r) => r.label).filter((l) => l !== victim.label), 'and left out of the set, the rest in the table\'s order');
      for (const r of storedRows) r.best = 'none';
      fs.writeFileSync(path.join(ROOT, 'data', 'stagesets', `${c.cut.id}.json`), JSON.stringify(sourceDoc));
      threw = null;
      try { stages.buildHalfLifeSet(c.cut.id, { runId: block.id, name: 'half-life build test set, none' }); } catch (e) { threw = e.message; }
      assert.ok(/no record improved/.test(threw), threw);
    } finally { c.cleanup(); }
  },

  // THE HALF-LIFE TRAVELS: the shared vocabulary accepts it on a stage-engine
  // configuration and refuses it elsewhere; the live path's training weights
  // carry the same age factor the History run multiplied in; the anatomy and
  // both Trade branches say it through the one drawing path.
  theHalfLifeTravelsIntoTheCaptureTheGreenlightAndTheLivePath() {
    const { validateConfig } = require('../lib/live/configschema');
    const gl = require('../lib/live/greenlight');
    const ss = require('../lib/live/stagesignal');
    const base = {
      engine: 'stages', combo: { trade: 'LTCUSDT', ctx1: 'XRPUSDT', ctx2: 'BCHUSDT', size: 3 },
      branch: { geometry: 'daily-4d', decision: 'argmax', band: 1.69, weekdaysOnly: false }, stage: 'stages',
      members: [{ model: 'logreg', view: 'full' }, { model: 'boost', view: 'full' }],
      cell: { quorum: null, entry: 'market', gate: 'directional', dMult: null, tHours: 65, trailMult: null, armMult: null },
      agreement: { rule: 'count', bar: 'all', pct: 50, copy: 98, both: false, persist: 0, rung: 1, members: 2, voices: null },
      training: { trainOn: 'direction', weightCap: null, windowLayout: 'reserve61', startMonth: '2023-01', endMonth: '2026-06', allLoaded: false, nullN: 9, halfLife: 365, halfLifeMonths: 12 },
      configVersion: 'half-life-test',
    };
    assert.strictEqual(validateConfig(base).ok, true, validateConfig(base).errors.join('; '));
    assert.ok(!validateConfig({ ...base, training: { ...base.training, halfLife: -3 } }).ok, 'a half-life must be positive days');
    assert.ok(!validateConfig({ ...base, engine: undefined, stage: 'promoted', agreement: undefined, cell: { ...base.cell, quorum: 1 }, training: { halfLife: 365 } }).ok, 'the older engine carries no half-life');
    // the greenlight from a source that carries one
    const src = {
      set: { id: 's4-hl', stage: 4, name: 'S4 hl', release: '3.95.0', unit: 'LTCUSDT|XRPUSDT|BCHUSDT|daily-4d', unitName: 'LTC + XRP + BCH daily-4d', ruleSentence: 't 41 to 89', counts: { survivors: 1 }, parent: { id: 's3-1', name: 'S3' }, stage2: { id: 's2-1', name: 'S2' }, derived: { kind: 'halflife', from: 's4-src', fromName: 'S4 src', run: 's4-src-h1', judgeWord: 'Reserve' } },
      gate: { id: 's4-src-v1', at: '2026-09-08T00:00:00.000Z', release: '3.95.0', look: 1 },
      unit: { trade: 'LTCUSDT', ctx1: 'XRPUSDT', ctx2: 'BCHUSDT', size: 3, geometry: 'daily-4d' },
      survivor: { si: 4, label: 'count 50% market t65h · argmax auto 24/7', decision: 'argmax', bandMode: 'auto', bandPct: 1.69, weekdaysOnly: false, entry: 'market', gate: 'directional', dMult: null, tHours: 65, trailMult: null, armMult: null, agreeRule: 'count', agreeBar: 'all', agreePct: 50, agreeCopy: 98, agreeBoth: false, agreePersist: 0, members: 2, halfLife: 12 },
      pick: { by: 'depth', index: 0, si: 4, label: 'count 50% market t65h · argmax auto 24/7', worst: 0, mean: 0, per: {}, of: 1 },
      survivors: [], members: [{ model: 'logreg', view: 'full' }, { model: 'boost', view: 'full' }],
      training: { ...base.training }, fee: 0.00125,
      readings: { heldBack: null, unread: null, halfLife: { months: 12, judge: 'Reserve', money: 3.2, unweighted: 1.1 } },
    };
    const cfg = gl.configFromStage4(src);
    assert.deepStrictEqual({ h: cfg.training.halfLife, m: cfg.training.halfLifeMonths }, { h: 365, m: 12 }, 'the frozen configuration carries the half-life');
    // the live path's training weights carry the same age factor as the History run
    const DAY = 86400000;
    const t0 = Date.UTC(2024, 0, 1);
    const chunks = Array.from({ length: 120 }, (_, i) => ({ startTs: t0 + i * DAY, diffPct: (i % 3) - 1 }));
    const w = ss.trainingWeightsFor({ trainOn: 'direction', halfLife: 365 }, chunks, 0.00125);
    const expect = HL.halfLifeWeights({ trainOn: 'direction' }, chunks, 0.00125, 365).weights;
    assert.deepStrictEqual(w, expect, 'the one definition, through the live path');
    assert.strictEqual(ss.trainingWeightsFor({ trainOn: 'direction' }, chunks, 0.00125), null, 'no half-life, the set\'s own weighing');
    // and the words: the anatomy and both Trade branches through the one path
    const an = require('../lib/live/anatomy');
    const words = an.describeAnatomy(cfg, {});
    assert.ok(/a training day 12 months old counts half as much as today's/.test(words.pipeline[2]), words.pipeline[2]);
    assert.strictEqual(an.describeConfig(cfg).halfLifeMonths, 12);
    const trade = src2('public/trade.html');
    assert.ok(/cfgRow\('Recent history weighted', `half-life \$\{esc\(String\(c\.training\.halfLifeMonths/.test(trade), 'the Trade rows print it, on both branches through the one path');
    const ui = src2('public/construct.js');
    assert.ok(/id="hHlBuild"/.test(ui) && /id="hHlName"/.test(ui), 'the build row is on History');
    assert.ok(/half-life set from \$\{esc\(x\.derived\.fromName \|\| x\.derived\.from\)\}/.test(ui), 'Tune and Greenlight name a half-life set by its source');
    assert.ok(/\.filter\(\(x\) => !x\.derived\);\n  const chosen = vRememberedSet\(sets\);/.test(ui) && /\.filter\(\(x\) => !x\.derived\);\n  const hChosen = hRememberedSet\(hSets\);/.test(ui), 'Verify and History leave half-life sets out');
    assert.ok(src2('server.js').includes("'/api/funnel/set/:id/halflife/build'"), 'the build is served');
  },

  // THE SCREEN AND THE ROUTES: the panel is drawn by top-level helpers, the
  // six tick boxes and the press are on History, the three routes are served,
  // the worker knows the task, and the reserve grade's press is untouched.
  theTableAndThePressAreOnHistoryWithTheirRoutes() {
    const ui = src('public/construct.js');
    for (const fn of ['hHalfLifePanelHtml', 'hHalfLifeBlockHtml', 'hHalfLifeFollow']) assert.ok(new RegExp(`^(async )?function ${fn}\\(`, 'm').test(ui), `${fn} must be a top-level helper`);
    assert.ok(/\$\{hHalfLifePanelHtml\(hChosen, hl\)\}/.test(ui), 'the panel is drawn on History under the reserve grade');
    for (const id of ['hHl12', 'hHl18', 'hHl24', 'hHl30', 'hHl36', 'hHl48', 'hHalfLife']) assert.ok(ui.includes(`id="${id}"`), `${id} is on the screen`);
    assert.ok(ui.includes('id="hGrade"') && /Run the reserve grade on this set/.test(ui), 'the reserve grade stays as it was');
    assert.ok(/api\/funnel\/set\/\$\{encodeURIComponent\(id\)\}\/halflife\/status/.test(ui), 'the run is polled');
    const srv = src('server.js');
    for (const r of ['/api/funnel/set/:id/halflife', '/api/funnel/set/:id/halflife/status']) assert.ok(srv.includes(`'${r}'`), `${r} is served`);
    for (const f of ['lib/pool.js', 'lib/worker.js']) assert.ok(/hlTrain: require\('\.\/halflife'\)\.hlTrainTask,/.test(src(f)), `${f} knows the retrain task`);
  },
};
