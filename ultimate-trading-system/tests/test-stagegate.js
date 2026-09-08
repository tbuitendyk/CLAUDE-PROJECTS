// V0: the three-stage engine's own planted check (3.87.0, VERIFY-DESIGN.md V0
// and decision 9; loop record step 2). The declaration and the grading are
// pure and tested here on fabricated verdict blocks; the exam itself trains
// for real and is run by hand (tests/adversarial/stage-gate.js) or from the
// button on Verify. Each test name is the assertion a mutation guard aims at.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { assert } = require('./helpers');
const G = require('../lib/stagegate');
const stages = require('../lib/stages');

const ROOT = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// a verdict block the way lib/stages.js stamps one, trimmed to what the grade reads
function block({ real = 5, positive = true, known = true, beatsBuy = true, buyHold = 2, beats = 20, copies = 20, bar = 20, pass = true, survivors = 3, kept = 20 } = {}) {
  return {
    heldBack: { real, of: survivors, positive, comparisons: { known, beatsBuyHold: known ? beatsBuy : null, buyHold: known ? { lo: buyHold, hi: buyHold } : null } },
    copies: { copies, beats, bar, pass },
    survivors: { survivors, rows: Array.from({ length: survivors }, (_, i) => ({ label: `s${i}`, copiesKept: kept })) },
  };
}
const planted = () => block();
const fair = () => block({ real: -0.5, positive: false, beatsBuy: false, beats: 3, pass: false });

module.exports = {
  // THE EXAM IS DECLARED BEFORE IT RUNS: the coins, the span, the seeds, the
  // copy count, the launches and the rule are constants nothing computes, and
  // the runner reads them in that order.
  theExamIsDeclaredBeforeAnythingIsLaunched() {
    for (const k of ['SPAN', 'SEEDS', 'RULE', 'STAGE1', 'STAGE2', 'STAGE3', 'GATES']) assert.ok(Object.isFrozen(G[k]), `${k} is declared, not computed`);
    assert.deepStrictEqual(G.RULE, { ranges: { tHours: { min: 17, max: 17 } }, allowed: {}, floors: {} }, 'the plant\'s own horizon on the daily-1d shape, no cut');
    assert.strictEqual(G.STAGE3.cellPermute.tHours, true, 'the block permutes the dial the rule ranges');
    assert.strictEqual(G.STAGE3.permuteDecision, true, 'and both decisions, so the rule keeps more than one survivor');
    const { GEOMETRIES } = require('../lib/dataset');
    const g = GEOMETRIES[G.STAGE1.geometry];
    assert.strictEqual(g.exitOffsetH - g.entryOffsetH, 17, 'the hold the rule keeps is the chunk\'s own on that shape');
    assert.ok(require('../lib/bracket').T_HOURS.includes(17), 'and it is a rung the ladder holds');
    assert.strictEqual(G.STAGE3.nullN, G.COPIES);
    assert.strictEqual(G.STAGE3.keepN, G.COPIES, 'every copy is kept, so the verdict can read them');
    assert.strictEqual(G.STAGE1.windowLayout, 'reserve61', 'a sealed window, so the cut records one');
    const s = src('lib/stages.js');
    const run = s.slice(s.indexOf('async function runStageGate('), s.indexOf('function stageGateStatus('));
    const order = ['generateFabricated(', 'startStage1(', 'startStage2(', 'startStage3(', 'cutFunnelSet(', 'funnelVerifyRun(', 'G.grade(', 'G.writeRecord('];
    let at = -1;
    for (const step of order) { const i = run.indexOf(step); assert.ok(i > at, `${step} comes after what precedes it`); at = i; }
    assert.ok(/rule: G\.RULE/.test(run), 'the cut takes the declared rule, never one worked out from the numbers');
    assert.ok(/barPct: 100/.test(run), 'and the verdict is read at the exam\'s own bar: all of the copies');
  },

  theGradeReadsFiveGatesAndAllMustStand() {
    const ok = G.grade({ planted: planted(), fair: fair(), s3: { failures: [] } });
    assert.strictEqual(ok.pass, true, ok.sentences.join(' | '));
    assert.deepStrictEqual(ok.checks.map((c) => c.rule), ['G1', 'G2', 'G3', 'G4', 'G5']);
    assert.ok(ok.checks.every((c) => c.pass));
    const fails = {
      G1: { planted: block({ real: -1, positive: false }) },
      G2: { planted: block({ beatsBuy: false }) },
      G3: { planted: block({ beats: 19, pass: false }) },
      G4: { fair: block({ beats: 20, pass: true }) },
      G5: { s3: { failures: [{ unit: 'x' }] } },
    };
    for (const [rule, over] of Object.entries(fails)) {
      const g = G.grade({ planted: planted(), fair: fair(), s3: { failures: [] }, ...over });
      assert.strictEqual(g.pass, false, `${rule} alone fails the exam`);
      assert.deepStrictEqual(g.checks.filter((c) => !c.pass).map((c) => c.rule), [rule], `only ${rule} fails`);
      assert.ok(g.sentences.some((t) => t.startsWith(`FAIL ${rule}:`)), `and the sentence says ${rule}`);
    }
    // unknown comparisons never pass G2
    const unknown = G.grade({ planted: block({ known: false }), fair: fair(), s3: { failures: [] } });
    assert.strictEqual(unknown.checks[1].pass, false);
    assert.ok(/not known on the planted coin, and unknown never passes/.test(unknown.sentences[1]));
  },

  aFairCoinClearingTheBarFailsTheExam() {
    const g = G.grade({ planted: planted(), fair: block({ beats: 20, pass: true }), s3: { failures: [] } });
    assert.strictEqual(g.pass, false);
    assert.ok(/CLEARS the bar: the instrument invents things/.test(g.sentences[3]), g.sentences[3]);
    // a fair coin read at fewer copies than declared is not a pass either
    const short = G.grade({ planted: planted(), fair: block({ copies: 10, bar: 10, beats: 2, pass: false }), s3: { failures: [] } });
    assert.strictEqual(short.checks[3].pass, false, 'G4 needs the declared copy count');
  },

  // THE BAR IS ALL OF THE COPIES, AND THE CHANCE IS WORKED OUT FIRST. An 85%
  // bar can never be brought under 5% by any copy count; all of 20 is 1 in 21.
  theBarIsAllTheCopiesAndTheChanceIsUnderFivePercent() {
    assert.strictEqual(G.COPIES, 20);
    assert.ok(G.chanceOf(G.COPIES) < 0.05, 'a fair coin clears the bar by chance less than one time in twenty');
    assert.ok(Math.abs(G.chanceOf(20) - 1 / 21) < 1e-12);
    const F = require('../lib/funnel');
    for (const K of [10, 20, 80, 100, 200, 1000]) {
      const bar = F.barOf({ k: K, barPct: 85 });
      assert.ok(F.chanceOf(bar, K) > 0.05, `an 85% bar of ${K} copies is cleared by chance ${Math.round(100 * F.chanceOf(bar, K))}% of the time — never under 5%`);
    }
    const g = G.grade({ planted: planted(), fair: fair(), s3: { failures: [] } });
    assert.strictEqual(g.bar, 20);
    assert.ok(g.sentences[2].includes('the bar being all 20 (a fair coin clears that about 1 in 21 times)'), g.sentences[2]);
    assert.strictEqual(g.checks[2].pass, true);
    const softer = G.grade({ planted: block({ bar: 17 }), fair: fair(), s3: { failures: [] } });
    assert.strictEqual(softer.checks[2].pass, false, 'a verdict read at a softer bar does not pass G3');
  },

  // PASS BELONGS TO THE EXACT RELEASE. Another release's pass reads NOT CHECKED
  // and says which release it was; a torn record is reported, never skipped.
  passBelongsToTheExactRelease() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-gate-'));
    try {
      assert.deepStrictEqual({ state: G.status('3.87.0', { dir }).state, last: G.status('3.87.0', { dir }).last }, { state: 'NOT CHECKED', last: null });
      fs.writeFileSync(path.join(dir, 'sg-a.json'), JSON.stringify({ id: 'sg-a', at: '2026-09-08T01:00:00.000Z', release: '3.86.1', pass: true, sentences: ['ok'] }));
      const older = G.status('3.87.0', { dir });
      assert.strictEqual(older.state, 'NOT CHECKED');
      assert.ok(/the last check was under release 3\.86\.1; this release has not been checked/.test(older.detail));
      fs.writeFileSync(path.join(dir, 'sg-b.json'), JSON.stringify({ id: 'sg-b', at: '2026-09-08T02:00:00.000Z', release: '3.87.0', pass: true, sentences: ['ok'], chance: 1 / 21, copies: 20 }));
      const mine = G.status('3.87.0', { dir });
      assert.deepStrictEqual({ state: mine.state, id: mine.last.id, chance: mine.last.chance }, { state: 'PASS', id: 'sg-b', chance: 1 / 21 });
      fs.writeFileSync(path.join(dir, 'sg-c.json'), JSON.stringify({ id: 'sg-c', at: '2026-09-08T03:00:00.000Z', release: '3.87.0', pass: false, sentences: ['FAIL G4: ...'] }));
      assert.strictEqual(G.status('3.87.0', { dir }).state, 'FAIL', 'the newest record decides');
      assert.strictEqual(G.status('3.87.0', { dir, running: 'the stage-engine check (stage 2)' }).state, 'RUNNING');
      fs.writeFileSync(path.join(dir, 'sg-d.json'), '{ torn');
      const torn = G.status('3.87.0', { dir });
      assert.strictEqual(torn.state, 'UNREADABLE', 'a torn newest record is never skipped into an older PASS');
      assert.strictEqual(G.status('3.87.0', { dir }).records, 4);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  },

  // THE FABRICATED COINS NEVER MEET A REAL RUN: stage 1 refuses both reserved
  // pairs unless the exam itself is launching them.
  theLauncherRefusesTheReservedCoinsUnlessTheExamLaunchesThem() {
    const base = { sizes: { singles: true }, geometry: 'daily-1d', windowLayout: 'reserve61', startMonth: '2024-01', endMonth: '2024-12', nullN: 9, fee: 0.00125 };
    for (const sym of [G.PLANT, G.FAIR, require('../lib/planted').PLANTED_SYMBOL]) {
      let threw = null;
      try { stages.startStage1({ ...base, universe: [sym, 'BTCUSDT'] }); } catch (e) { threw = e.message; }
      assert.ok(/is a reserved fabricated coin — it never enters a real run/.test(threw || ''), `${sym}: ${threw}`);
      threw = null;
      try { stages.startStage1({ ...base, universe: ['BTCUSDT'], compare: [sym] }); } catch (e) { threw = e.message; }
      assert.ok(/is a reserved fabricated coin/.test(threw || ''), `${sym} alongside: ${threw}`);
    }
    assert.ok(G.isExamSymbol('plantedstageausdt') && !G.isExamSymbol('BTCUSDT'));
    const s = src('lib/stages.js');
    assert.ok(/if \(reserved && !params\.exam\) \{/.test(s), 'the exam\'s own launch is the one way in');
  },

  // THE EXAM'S SETS STAY OFF EVERY LIST A SCREEN DRAWS FROM, and are deleted when it lands.
  theExamsSetsStayOffEveryScreenAndAreDeletedWhenItLands() {
    const s = src('lib/stages.js');
    assert.strictEqual(s.split('    exam: !!params.exam,').length - 1, 3, 'every stage birth stamps whether the set is the exam\'s');
    assert.ok(/doc\.exam = !!state\.exam;/.test(s), 'and the cut stamps it on a Stage 4 set');
    assert.ok(/exam: !!d\.exam,/.test(s), 'the list row carries it');
    assert.ok(/\.filter\(\(d\) => !d\.exam\)\n    \.filter\(\(d\) => \(d\.unit \|\| null\) === want\)/.test(s), 'the Funnel\'s own picker leaves them out');
    const server = src('server.js');
    assert.ok(server.includes("sets: stages.listSets().filter((s) => !s.exam)"), 'Boards\' list leaves them out');
    assert.ok(server.includes("sets: stages.listFunnelSets(parent).filter((d) => !d.exam).map((d) => ({"), 'and the Stage 4 list leaves them out');
    const cleanup = s.slice(s.indexOf('function examCleanup('), s.indexOf('async function runStageGate('));
    assert.ok(/run\.sets\.slice\(\)\.reverse\(\)/.test(cleanup) && /deleteSet\(id, id\)/.test(cleanup), 'children first, through the same door the owner deletes a set by');
    assert.ok(/G\.SYMBOLS\.some\(\(s\) => f\.startsWith/.test(cleanup), 'and the fabricated candles go');
    assert.ok(/\.finally\(\(\) => \{ try \{ examCleanup\(run\); \}/.test(s), 'whatever ends the exam, the cleanup runs');
  },

  // ONE HEAVY JOB AT A TIME, BOTH WAYS: the exam refuses while anything runs,
  // and every other launch refuses while the exam runs -- except its own.
  theExamRefusesWhileTheBoxIsBusyAndTheBoxRefusesWhileTheExamRuns() {
    const s = src('lib/stages.js');
    const start = s.slice(s.indexOf('function stageGateStart('), s.indexOf('function listFunnelSets('));
    assert.ok(/batch\.batchRunning\(\)/.test(start) && /anyJobRunning\(\)/.test(start) && /stageBusy\(\)/.test(start), 'a sweep, a data job, a stage run, a totalling and a rebuild all refuse it');
    assert.ok(/if \(busy\) throw new Error/.test(start));
    const busy = s.slice(s.indexOf('function stageBusy()'), s.indexOf('function claimOrRefuse('));
    assert.ok(/if \(examBusy\(\)\) return examBusy\(\);/.test(busy), 'while it runs, the box reads as busy to everything that asks');
    const claim = s.slice(s.indexOf('function claimOrRefuse('), s.indexOf('function cancelStage('));
    assert.ok(/if \(examBusy\(\) && !\(params && params\.exam\)\) throw new Error/.test(claim), 'a launch that is not the exam\'s refuses while it runs');
    for (const fn of ['startStage1', 'startStage2', 'startStage3']) assert.ok(s.includes(`function ${fn}(params) {\n  claimOrRefuse(params);`), `${fn} hands its params to the claim`);
    assert.ok(/funnelVerifyRun\(getSet\(cuts\[which\]\.id\), \{ barPct: 100 \}\)/.test(s), 'the exam presses the verdict directly, holding the box');
  },

  // A STAGE 4 VERDICT RECORDS WHICH STAGE GATE STOOD, beside the planted check.
  theVerdictRecordsWhichStageGateStood() {
    const s = src('lib/stages.js');
    assert.ok(/const sg = require\('\.\/stagegate'\)\.status\(ENGINE_VERSION, \{ running: examBusy\(\) \}\);/.test(s), 'the footing asks the stage gate');
    assert.ok(/const \{ gate, stageGate, \.\.\.rest \} = footing;/.test(s) && /rules, gate, stageGate, footing: rest,/.test(s), 'and it rides on the block');
    const V = require('../lib/funnelverify');
    const rules = V.declareRules({ kind: 'scrambles', k: 10, barPct: 80 });
    const base = { rules, gate: { state: 'PASS', engineVersion: '3.87.0' }, footing: { ok: true, had: 1 }, looks: { unstamped: 1 }, heldBack: { real: 1, of: 1, positive: true, pass: true, comparisons: { known: true, beatsBuyHold: true, beatsShortHold: true } }, copies: { copies: 10, beats: 10, bar: 8, barPct: 80, chance: 0.27, pass: true }, survivors: { survivors: 1, passing: 1, byChance: 0.27 }, sanity: { known: true, ok: true, board: { losing: 0.6 }, threshold: 50 } };
    const stood = V.buildBlock({ ...base, stageGate: { state: 'PASS', release: '3.87.0' } });
    assert.ok(/the stage-engine check stood \(release 3\.87\.0\)/.test(stood.verdict.sentence), stood.verdict.sentence);
    const none = V.buildBlock({ ...base, stageGate: { state: 'NOT CHECKED', release: null } });
    assert.ok(/no stage-engine check stood \(NOT CHECKED\)/.test(none.verdict.sentence));
    assert.strictEqual(stood.verdict.pass, none.verdict.pass, 'printed, never a gate on the set: the check certifies the instrument, not the result');
  },

  theScreenOffersTheCheckBesideThePlantedOne() {
    const ui = src('public/construct.js');
    const panel = ui.slice(ui.indexOf('function vStageGateHtml('), ui.indexOf('function vSetBoxHtml('));
    assert.ok(/<button id="sgRun" class="pri"/.test(panel) && /Run the stage-engine check<\/button>/.test(panel), 'the press');
    assert.ok(/\$\{vStageGateHtml\(sg\)\}/.test(panel), 'drawn inside the planted check\'s panel');
    assert.ok(/current: <b class="\$\{cls\}">\$\{esc\(s\.state \|\| 'NOT CHECKED'\)\}<\/b>/.test(panel), 'the state, in the planted check\'s own words');
    assert.ok(/A pass belongs to the release that earned it; a new release starts NOT CHECKED\./.test(panel));
    assert.ok(/1 in \$\{Number\(s\.last && s\.last\.copies \? s\.last\.copies : 20\) \+ 1\} times/.test(panel), 'the chance is printed beside the verdict');
    const draw = ui.slice(ui.indexOf('async function drawVerify()'), ui.indexOf('async function vStageGateFollow('));
    assert.ok(/api\/stage-gate\/status/.test(draw) && /tryPost\('api\/stage-gate', \{\}/.test(draw), 'the two doors');
    assert.ok(/if \(sg && sg\.state === 'RUNNING'\) vStageGateFollow\(\);/.test(draw), 'a check already running is watched on arrival');
    const follow = ui.slice(ui.indexOf('async function vStageGateFollow('), ui.indexOf('async function vFollow('));
    assert.ok(/if \(vStageGateWatching\) return;/.test(follow), 'one watcher per page');
    assert.ok(/if \(s\.state === 'RUNNING'\)/.test(follow) && /drawVerify\(\);/.test(follow), 'it redraws from the record when it lands');
    const server = src('server.js');
    assert.ok(server.includes("app.get('/api/stage-gate/status'") && server.includes("app.post('/api/stage-gate'"), 'the doors exist');
  },
};
