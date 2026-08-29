// WHAT A RUN WILL COST, BEFORE IT IS LAUNCHED (owner order, 2026-08-22).
//
// "you need to have a status line near the Start sweep button that gives an
// accurate estimate of the resources that the run will require (memory and
// storage and CPU time) and that reports on available resources so that the
// effects can be adequately judged before hitting the sweep"
//
// Every hard stop this system has hit was arithmetic available before the
// button was pressed: a heap exhausted five minutes into a five-hour job; a run
// document that could no longer be turned into text; thirty-one hours of first
// pass in front of a second pass that could never have finished. Nobody was
// told any of it in advance because nobody counted.
//
// The two properties that make an estimate worth reading, and what each is:
//
//   * IT PRICES THE RUN THAT WOULD START. The count comes from batch.planFor,
//     the same function the launcher builds its plan with. A second copy of
//     that arithmetic would be a second answer, and the one that drifted would
//     be the one nobody checked.
//   * IT NEVER INVENTS A NUMBER. The time figure exists only because finished
//     runs record how fast they went. With no history it reports having none.
//
// Watched failing 2026-08-22: pricing promoteUnits as promoteK when null boards
// are set fails aRunThatPromotesEveryUnitIsPricedThatWay; returning a default
// rate with no history fails timeIsNotGuessedWhenNothingHasBeenMeasured.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');

function withScratch(fn) {
  const realData = path.join(ROOT, 'data');
  const stash = `${realData}.stash-est-${process.pid}`;
  const had = fs.existsSync(realData);
  if (had) fs.renameSync(realData, stash);
  fs.mkdirSync(path.join(realData, 'batches'), { recursive: true });
  const mods = ['lib/estimate', 'lib/batch'];
  mods.forEach((m) => { delete require.cache[require.resolve(path.join(ROOT, m))]; });
  try {
    return fn({ realData, estimate: require(path.join(ROOT, 'lib/estimate')) });
  } finally {
    fs.rmSync(realData, { recursive: true, force: true });
    if (had) fs.renameSync(stash, realData);
    mods.forEach((m) => { delete require.cache[require.resolve(path.join(ROOT, m))]; });
  }
}

const BASE = {
  universe: ['ETHUSDT', 'BNBUSDT'], sizes: { singles: true },
  windowLayout: 'split70', allLoaded: true,
  permute: { geometry: true, decision: true, band: true, weekdays: true },
};

module.exports = {
  // The count has to be the run's own count, or the price is for something else.
  theCountComesFromTheRunsOwnPlan() {
    withScratch(({ estimate }) => {
      const batch = require('../lib/batch');
      const params = { ...BASE, labelShiftReps: 3 };
      const plan = batch.planFor(params);
      const out = estimate.estimate(params, { poolSize: 4 });
      assert.strictEqual(out.plan.units, plan.units.length, 'the estimate must count the units the run will build');
      assert.strictEqual(out.plan.slimRuns, plan.slimRuns, 'and the trainings the first pass will do');
      assert.strictEqual(out.plan.combos, plan.combos.length);
      assert.strictEqual(out.plan.branches, plan.branches.length);
      // 2 assets x 72 branches x (3 null boards + 1)
      assert.strictEqual(out.plan.units, 2 * 72 * 4);
    });
  },

  // THE TRAP THE OWNER HIT. promote top K stops applying when null boards are
  // set or a declared config is named, and an estimate that priced the second
  // pass at K would have understated their run by a factor of two thousand.
  aRunThatPromotesEveryUnitIsPricedThatWay() {
    withScratch(({ estimate }) => {
      const small = estimate.estimate({ ...BASE, labelShiftReps: 0, promoteK: 25 }, { poolSize: 4 });
      assert.strictEqual(small.plan.everyUnitPromoted, false, 'with nothing forcing it, the top of the board goes through');
      assert.strictEqual(small.plan.promoteUnits, 25, 'and that is what promote top K says');

      const nulls = estimate.estimate({ ...BASE, labelShiftReps: 5, promoteK: 25 }, { poolSize: 4 });
      assert.strictEqual(nulls.plan.everyUnitPromoted, true);
      assert.strictEqual(nulls.plan.promoteUnits, nulls.plan.units, 'null boards send every unit through the second pass');
      assert.ok(/null boards/.test(nulls.plan.whyEveryUnit), `it must say why: ${nulls.plan.whyEveryUnit}`);

      const declared = estimate.estimate({
        ...BASE, labelShiftReps: 0, promoteK: 25,
        declared: { entry: 'breakout', gate: 'always', dMult: 1, tHours: 41, quorumSingles: 2 },
      }, { poolSize: 4 });
      assert.strictEqual(declared.plan.everyUnitPromoted, true, 'a declared config does the same');
      assert.ok(/declared/.test(declared.plan.whyEveryUnit), `it must say why: ${declared.plan.whyEveryUnit}`);
    });
  },

  // The one that would have caught the 413-million-row run before it started.
  theDeclaredRowsAreCountedAndTheDiskIsPriced() {
    withScratch(({ estimate }) => {
      const out = estimate.estimate({
        ...BASE, labelShiftReps: 40, trailing: true,
        declared: { entry: 'breakout', gate: 'always', dMult: 0.25, tHours: 17, quorumSingles: 1 },
        declaredPermute: { entry: true, gate: true, dMult: true, tHours: true, trail: true, arm: true, agree: true },
      }, { poolSize: 4 });
      assert.strictEqual(out.plan.declaredConfigs, 8232, 'every declared permute ticked is 8,232 configurations');
      assert.strictEqual(out.rows.replication, out.plan.promoteUnits * 8232,
        'one row per promoted unit per configuration — that product is the whole problem');
      // built from the rows and their measured stored size, not from a round
      // number — the multiplier is whatever the store currently costs
      assert.strictEqual(out.bytes,
        out.rows.slim * estimate.BYTES_PER_ROW.slim
        + out.rows.census * estimate.BYTES_PER_ROW.census
        + out.rows.replication * estimate.BYTES_PER_ROW.replication,
        'the disk figure must be the rows times what a stored row measures, and nothing else');
      assert.ok(out.warnings.some((w) => /rows for the declared configs/.test(w)),
        `a run this size must say so in words: ${JSON.stringify(out.warnings)}`);
    });
  },

  // A number with nothing behind it is worse than a blank.
  timeIsNotGuessedWhenNothingHasBeenMeasured() {
    withScratch(({ estimate }) => {
      const out = estimate.estimate(BASE, { poolSize: 4 });
      assert.strictEqual(out.time.seconds, null, 'with no finished run there is no time estimate');
      assert.strictEqual(out.time.samples, 0);
      assert.ok(out.warnings.some((w) => /no finished run has been measured/.test(w)),
        'and it must say that plainly rather than leaving a blank to be read as zero');
    });
  },

  // ...and once a run has finished, its measured rate is what gets used.
  aFinishedRunTeachesTheEstimateHowFastThisBoxIs() {
    withScratch(({ estimate }) => {
      estimate.recordRate({ id: 'r1', finishedAt: 'x', perf: { secPerTraining: 0.30, workers: 4, runsDone: 900 } });
      estimate.recordRate({ id: 'r2', finishedAt: 'x', perf: { secPerTraining: 0.50, workers: 4, runsDone: 900 } });
      estimate.recordRate({ id: 'r3', finishedAt: 'x', perf: { secPerTraining: 0.40, workers: 4, runsDone: 900 } });
      const m = estimate.medianRate();
      assert.strictEqual(m.samples, 3);
      assert.strictEqual(m.secPerTraining, 0.40, 'the median of what this box actually did');

      const out = estimate.estimate(BASE, { poolSize: 4 });
      assert.ok(out.time.seconds > 0, 'and now there is a time figure');
      assert.strictEqual(out.time.samples, 3, 'with how many runs it rests on');
      const expected = Math.round((out.plan.slimRuns + out.plan.promoteRuns) * 0.40);
      assert.strictEqual(out.time.seconds, expected, 'seconds = trainings x measured seconds per training');

      // a run with no measurable rate must not poison the record
      estimate.recordRate({ id: 'bad', perf: { secPerTraining: 0 } });
      estimate.recordRate({ id: 'bad2', perf: {} });
      assert.strictEqual(estimate.medianRate().samples, 3, 'a run that measured nothing contributes nothing');
    });
  },

  // THE ROW SIZES ARE MEASURED, NOT REASONED ABOUT (owner asked whether the
  // figures still held, 2026-08-22). The first version of these was written by
  // eye and understated a stored replication row by more than two to one, so an
  // estimate of 61.6 GB was really about 125 GB. A disk figure that flatters is
  // the same silence that let a run die at hour forty, wearing a number.
  //
  // So the constants are checked against the store itself, writing the rows the
  // sweep really writes.
  //
  // Watched failing 2026-08-22: putting replication back to 160 fails this.
  theRowSizesAreWhatTheStoreActuallyWrites() {
    withScratch(({ estimate }) => {
      const rowstore = require('../lib/rowstore');
      // THE ROWS HAVE TO VARY THE WAY REAL ONES DO. A first attempt wrote
      // near-identical rows and measured 4 bytes each once they were squashed,
      // which measures how well repetition compresses and says nothing about a
      // run. Several assets, several chunk shapes, every number different.
      const assets = ['ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'SOLUSDT', 'LTCUSDT', 'LINKUSDT', 'DOTUSDT'];
      const shapes = ['daily-1d', 'daily-2d', 'daily-3d', 'daily-4d', 'weekly-8d'];
      const labels = [];
      for (const g of ['always', 'active', 'directional']) {
        for (const d of [0.25, 0.5, 0.75, 1, 1.5]) {
          for (const t of [17, 41, 65, 89, 113, 137, 161]) labels.push(`q4/6 ${g} d${d}x t${t}h trail1x/arm0.5x`);
        }
      }
      let rnd = 1;
      const R = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
      const samples = {
        replication: (i) => ({
          declaredLabel: labels[i % labels.length], nullDealSeed: i % 21 ? i % 21 : null,
          trade: assets[i % assets.length], ctx1: null, ctx2: null, geometry: shapes[i % shapes.length],
          bandPct: +(0.8 + R() * 1.2).toFixed(4), windowLayout: 'reserve61', entry: 'breakout',
          quorum: 1 + (i % 6), members: 6, pnl: +(R() * 4000 - 2000).toFixed(2), trades: 10 + (i % 200),
          wins: 5 + (i % 90), grossPerTrade: +(R() * 40 - 10).toFixed(3), stops: i % 30, ambiguous: i % 4,
          controlPnl: +(R() * 1500).toFixed(2), vsControl: +(R() * 900 - 300).toFixed(2),
          metrics: { testAcc: +(0.45 + R() * 0.2).toFixed(4), edge: +(R() * 0.1 - 0.03).toFixed(4) },
          holds: { alwaysLong: +(R() * 1200).toFixed(2), buyHold: +(R() * 1100).toFixed(2) },
          trailMult: [0.5, 1, 1.5, 2][i % 4], armMult: [0, 0.5, 1][i % 3], trailAmbiguous: i % 7,
          holdout: { pnl: +(R() * 600 - 200).toFixed(2), trades: 5 + (i % 40), vsAlwaysLong: +(R() * 90 - 30).toFixed(2) },
          vsAlwaysLong: +(R() * 900 - 300).toFixed(2), vsBuyHold: +(R() * 950 - 350).toFixed(2),
        }),
        slim: (i) => ({
          key: `${assets[i % assets.length]}|||${shapes[i % shapes.length]}|argmax|auto|24-7|n${i % 21}`,
          trade: assets[i % assets.length], ctx1: null, ctx2: null, geometry: shapes[i % shapes.length],
          decision: i % 2 ? 'argmax' : 'directional', bandPct: +(0.8 + R() * 1.2).toFixed(4),
          nullDealSeed: i % 21 ? i % 21 : null, pnl: +(R() * 3000 - 1500).toFixed(2),
          trades: 10 + (i % 200), holdPnl: +(R() * 500 - 200).toFixed(2),
        }),
      };
      for (const [name, mk] of Object.entries(samples)) {
        const id = `bracketlab-size-${name}`;
        const w = rowstore.writer(id, name);
        for (let i = 0; i < 20000; i++) w.push(mk(i));
        w.close();
        const measured = rowstore.bytes(id) / 20000;
        const claimed = estimate.BYTES_PER_ROW[name];
        assert.ok(Math.abs(measured - claimed) / measured < 0.2,
          `a stored ${name} row measures ${Math.round(measured)} bytes and the estimate prices it at ${claimed} — `
          + 'a disk figure that flatters is worse than none');
      }
    });
  },

  // Memory that grows with the RUN, kept apart from memory the box happens to
  // have. Only the part that scales is counted, and the part that does not is
  // deliberately left out rather than folded in where it would hide it.
  theMemoryFigureIsWhatTheRunAddsNotWhatTheBoxHolds() {
    withScratch(({ estimate }) => {
      const small = estimate.estimate({ ...BASE, labelShiftReps: 0 }, { poolSize: 4 });
      const big = estimate.estimate({ ...BASE, labelShiftReps: 40 }, { poolSize: 4 });
      assert.ok(big.memory.bytes > small.memory.bytes * 20,
        'a run with forty null copies holds far more unit records than one without');
      assert.ok(big.memory.bytes < big.box.memTotalMb * 1048576,
        'and the figure must be the run\'s own share, not the whole machine');
      assert.strictEqual(big.memory.workers, 4, 'the settings are held once per worker, so the count matters');
    });
  },

  // What the box HAS, beside what the run WANTS — the comparison is the point.
  itReportsWhatTheBoxHasNotJustWhatTheRunWants() {
    withScratch(({ estimate }) => {
      const out = estimate.estimate(BASE, { poolSize: 4 });
      const b = out.box;
      assert.ok(b.memTotalMb > 0 && b.memFreeMb > 0, 'memory, so the run can be judged against it');
      assert.ok(b.cpus > 0, 'and the processors it will share');
      assert.ok(b.diskFreeBytes === null || b.diskFreeBytes > 0, 'and the disk, or nothing rather than a wrong number');
      assert.ok(b.heapCeilingMb > 0, 'and the ceiling that killed the first wide sweep');
    });
  },

  // A run the launcher would refuse must be refused HERE, where it costs nothing.
  aRefusalIsAnEstimateToo() {
    withScratch(({ estimate }) => {
      assert.throws(() => estimate.estimate({ ...BASE, sizes: { singles: false, doubles: false, triples: false } }),
        /tick at least one/, 'a run that cannot start should say so before the button, not after');
    });
  },

  // The screen must ask, and must ask about the run it would actually send.
  // RE-AIMED 2026-08-28 at the surviving screen. This checked that the old
  // Sweep built its request in ONE place (sweepBody) so the run that was priced
  // and the run that was started could not be two different runs, and that the
  // cost sat above Start sweep where it is read before the button rather than
  // after. Both screens it named are deleted; the three-stage Sweep holds the
  // same two properties, and holds the first one harder — the counter and the
  // launch resolve the block through the same server function rather than
  // merely sending the same body.
  theScreenAsksAndPricesTheRealRequest() {
    const ui = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    assert.ok(/function swBlockParams\(\)/.test(ui),
      'the stage 3 block must be built in one place — two copies are two different runs, the one priced and the one started');
    assert.ok(/askPost\('api\/stage3-count', \{\n\s*\.\.\.swBlockParams\(\)/.test(ui),
      'and the count must be asked for THAT block');
    const launch = ui.slice(ui.indexOf("tryPost('api/stage3', {"), ui.indexOf("tryPost('api/stage3', {") + 400);
    assert.ok(/\.\.\.swBlockParams\(\),/.test(launch),
      'and the launch must send the same one — not a second hand-written copy of the block');
    // The cost has to be beside the button that spends it, or it is read after
    // the press instead of before it. Stage 3's sits above start stage 3;
    // stage 1's is the note immediately under the row start stage 1 is in.
    // RECORDED, NOT ASSERTED AWAY: those two are not the same placement, and
    // the owner's rule when this was written was that the cost is read BEFORE
    // the button. Moving swCost1 above its row is a screen change and waits
    // for the owner.
    for (const [cost, button] of [['id="swCost1"', 'id="swGo1"'], ['id="swCount"', 'id="swGo3"']]) {
      assert.ok(ui.includes(cost), `${cost} — the cost must be on the screen`);
      assert.ok(Math.abs(ui.indexOf(cost) - ui.indexOf(button)) < 700,
        `${cost} is nowhere near ${button} — a cost that is not beside the button that spends it is read after the press`);
    }
    // ONE resolution, server side: the counter and the launch both go through
    // stage3Declared, so the cost line and the refusal cannot be two numbers.
    assert.ok(/app\.post\('\/api\/stage3-count'/.test(server), 'the server must offer the count');
    const route = server.slice(server.indexOf("app.post('/api/stage3-count'"), server.indexOf("app.post('/api/stage1'"));
    assert.ok(!/csrfGuard/.test(route), 'it changes nothing, so it needs no guard');
    assert.ok(/stages\.stage3Declared\(b\)/.test(route),
      'the count must ride the launch\'s own resolution, not a second copy of the arithmetic');
    assert.ok(/error: err\.message/.test(route), 'and a refusal comes back as an answer, not as a failure');
  },
};
