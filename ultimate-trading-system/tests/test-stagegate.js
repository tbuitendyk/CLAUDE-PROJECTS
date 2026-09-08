// V0: the stage-engine check (3.87.0, VERIFY-DESIGN.md V0
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

  // FOUR YEARS, AND THE LAUNCH MONTHS FOLLOW THE SPAN (owner order, 2026-09-08).
  // One year starved stage 1 on the daily shape and the check failed on
  // itself; the four-year run passes. The months stage 1 is launched on are
  // read off the span, so the two cannot drift apart and quietly fabricate
  // four years while training on one.
  theCheckBuildsFourYearsAndItsMonthsFollowItsSpan() {
    assert.deepStrictEqual(G.SPAN, { fromMonth: '2021-01', toDate: '2024-12-31' }, 'the check builds four years of fabricated prices');
    assert.strictEqual(G.STAGE1.startMonth, G.SPAN.fromMonth, 'stage 1 is launched from the span\'s first month');
    assert.strictEqual(G.STAGE1.endMonth, G.SPAN.toDate.slice(0, 7), 'and through its last');
    const s = src('lib/stages.js');
    assert.ok(/span: \{ \.\.\.G\.SPAN \}, planted: summary\(blocks\.planted\)/.test(s), 'the record carries the span it was built on');
    const ui = src('public/setup.html');
    assert.ok(/built on fabricated prices from \$\{esc\(last\.span\.fromMonth\)\} to \$\{esc\(last\.span\.toDate\)\}/.test(ui), 'and the last check on Setup\'s Version tab says it');
  },

  // THE FABRICATED COINS NEVER MEET A REAL RUN: stage 1 refuses both reserved
  // pairs unless the exam itself is launching them.
  theLauncherRefusesTheReservedCoinsUnlessTheExamLaunchesThem() {
    const base = { sizes: { singles: true }, geometry: 'daily-1d', windowLayout: 'reserve61', startMonth: '2024-01', endMonth: '2024-12', nullN: 9, fee: 0.00125 };
    for (const sym of [G.PLANT, G.FAIR]) {
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
    // the same filter leaves out a half-life set (3.95.0), which stands on its source and is not offered to cut again
    assert.ok(/\.filter\(\(d\) => !d\.exam && !d\.derived\)\n    \.filter\(\(d\) => \(d\.unit \|\| null\) === want\)/.test(s), 'the Funnel\'s own picker leaves them out');
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
    // the two conditions live in the one definition the status carries too (3.98.0)
    const start = s.slice(s.indexOf('function stageGateBlockedBy('), s.indexOf('function listFunnelSets('));
    assert.ok(/anyJobRunning\(\)/.test(start) && /stageBusy\(\)/.test(start), 'a data job, a stage run, a totalling and a rebuild all refuse it');
    assert.ok(/const busy = stageGateBlockedBy\(\);\n  if \(busy\) throw new Error/.test(start), 'the press refuses on that one answer');
    const busy = s.slice(s.indexOf('function stageBusy()'), s.indexOf('function claimOrRefuse('));
    assert.ok(/if \(examBusy\(\)\) return examBusy\(\);/.test(busy), 'while it runs, the box reads as busy to everything that asks');
    const claim = s.slice(s.indexOf('function claimOrRefuse('), s.indexOf('function cancelStage('));
    assert.ok(/if \(examBusy\(\) && !\(params && params\.exam\)\) throw new Error/.test(claim), 'a launch that is not the exam\'s refuses while it runs');
    for (const fn of ['startStage1', 'startStage2', 'startStage3']) assert.ok(s.includes(`function ${fn}(params) {\n  claimOrRefuse(params);`), `${fn} hands its params to the claim`);
    assert.ok(/funnelVerifyRun\(getSet\(cuts\[which\]\.id\), \{ barPct: 100 \}\)/.test(s), 'the exam presses the verdict directly, holding the box');
  },

  // A STAGE 4 VERDICT RECORDS WHICH STAGE GATE STOOD.
  theVerdictRecordsWhichStageGateStood() {
    const s = src('lib/stages.js');
    assert.ok(/const sg = require\('\.\/stagegate'\)\.status\(ENGINE_VERSION, \{ running: examBusy\(\) \}\);/.test(s), 'the footing asks the stage gate');
    assert.ok(/const \{ stageGate, \.\.\.rest \} = footing;/.test(s) && /rules, stageGate, footing: rest,/.test(s), 'and it rides on the block');
    const V = require('../lib/funnelverify');
    const rules = V.declareRules({ kind: 'scrambles', k: 10, barPct: 80 });
    const base = { rules, footing: { ok: true, had: 1 }, looks: { unstamped: 1 }, heldBack: { real: 1, of: 1, positive: true, pass: true, comparisons: { known: true, beatsBuyHold: true, beatsShortHold: true } }, copies: { copies: 10, beats: 10, bar: 8, barPct: 80, chance: 0.27, pass: true }, survivors: { survivors: 1, passing: 1, byChance: 0.27 }, sanity: { known: true, ok: true, board: { losing: 0.6 }, threshold: 50 } };
    const stood = V.buildBlock({ ...base, stageGate: { state: 'PASS', release: '3.87.0' } });
    assert.ok(/the stage-engine check stood \(release 3\.87\.0\)/.test(stood.verdict.sentence), stood.verdict.sentence);
    const none = V.buildBlock({ ...base, stageGate: { state: 'NOT CHECKED', release: null } });
    assert.ok(/no stage-engine check stood \(NOT CHECKED\)/.test(none.verdict.sentence));
    assert.ok(!/planted/.test(stood.verdict.sentence) && !/planted/.test(none.verdict.sentence), 'the sentence still opens on the retired check');
    assert.strictEqual(stood.verdict.pass, none.verdict.pass, 'printed, never a gate on the set: the check certifies the instrument, not the result');
  },

  // THE CHECK LIVES ON SETUP, UNDER VERSION (owner order, 2026-09-08), and
  // since the older sweep path was retired (3.97.0) it is the release's one
  // check: the planted check that certified that path went with it. The panel
  // is drawn from the check's own status and nothing else, and the marker
  // beside "stage-engine check:" on every Construct screen opens the tab.
  theCheckLivesOnSetupsVersionTabAndTheMarkerGoesThere() {
    const page = src('public/setup.html');
    const at = ['data-tab="account">Account', 'data-tab="compute">Compute', 'data-tab="version">Version'].map((t) => page.indexOf(t));
    assert.ok(at.every((i) => i >= 0) && at[0] < at[1] && at[1] < at[2], 'Version is not the tab after Compute on Setup');
    const panel = page.slice(page.indexOf('function stageGateHtml('), page.indexOf('function drawVersion('));
    assert.ok(panel.length > 100, 'the panel is not drawn on Setup');
    assert.ok(/<button id="sgRun" class="pri"/.test(panel) && /Run the stage-engine check<\/button>/.test(panel), 'the press');
    assert.ok(/current: <b class="\$\{cls\}">\$\{esc\(s\.state \|\| 'NOT CHECKED'\)\}<\/b>/.test(panel), 'the state, in the check\'s own words');
    assert.ok(/A pass belongs to the release that earned it; a new release starts NOT CHECKED\./.test(panel));
    assert.ok(/1 in \$\{Number\(s\.last && s\.last\.copies \? s\.last\.copies : 20\) \+ 1\} times/.test(panel), 'the chance is printed beside the verdict');
    const draw = page.slice(page.indexOf('async function loadVersion()'), page.indexOf('function draw()'));
    assert.ok(/getJson\('api\/stage-gate\/status'\)/.test(draw) && /postJson\('api\/stage-gate', \{\}\)/.test(draw), 'the two doors');
    assert.ok(/tab === 'version'/.test(page) && /refreshVersion\(true\)/.test(page), 'nothing draws the Version tab');
    // a check already going is followed on arrival: the tab re-reads every five
    // seconds while it shows, and redraws only when the reading changed
    assert.ok(/setInterval\(\(\) => refreshVersion\(false\), 5000\)/.test(page), 'a running check is not followed while the tab is open');
    assert.ok(/if \(force \|\| before !== JSON\.stringify\(\[vSg, vErr\]\)\) drawVersion\(\);/.test(draw), 'the tab redraws on every re-read, or never');
    assert.ok(/the trading service did not answer, so the check cannot be shown/.test(draw), 'a service that did not answer reads as NOT CHECKED');
    for (const gone of ['planted check', 'pgRun', 'api/planted-gate']) assert.ok(!page.includes(gone), `the retired check is still on Setup: ${gone}`);
    // and nothing of it is left on Construct but the marker, which reads the
    // check's own status and opens Setup on Version
    const ui = src('public/construct.js');
    for (const gone of ['id="pgRun"', 'id="sgRun"', 'vPlantedPanelHtml', 'vStageGateHtml', 'Run the planted check', 'Run the stage-engine check', 'api/planted-gate', 'planted check:']) {
      assert.ok(!ui.includes(gone), `still on Construct: ${gone}`);
    }
    const strip = ui.slice(ui.indexOf('async function renderStrip()'), ui.indexOf('// ---- Data'));
    assert.ok(/api\('api\/stage-gate\/status'\)/.test(strip), 'the marker does not read the stage-engine check\'s own status');
    assert.ok(/stage-engine check:/.test(strip), 'the marker lost its label');
    assert.ok(/localStorage\.setItem\('setup-tab', 'version'\)/.test(strip) && /window\.location\.href = 'setup\.html'/.test(strip), 'the marker beside "stage-engine check:" does not open Setup on Version');
    assert.ok(!/tab = 'verify'/.test(strip), 'the marker still opens Verify');
    const help = src('public/help-content.js');
    for (const id of ['pgRun', 'sgRun']) assert.ok(!new RegExp(`\\b${id}: \\{`).test(help), `the help still describes ${id} on Verify`);
    assert.ok(/lives on the Setup page, under Version/.test(help), 'the Verify help does not say where the check went');
    assert.ok(!/planted check/.test(help), 'the help still names the retired check');
    const server = src('server.js');
    assert.ok(server.includes("app.get('/api/stage-gate/status'") && server.includes("app.post('/api/stage-gate'"), 'the doors exist');
    assert.ok(!server.includes("'/api/planted-gate"), 'the retired check\'s doors are still served');
  },

  // THE BOX'S BUSY ANSWER LIVES ON THE CHECK'S STATUS (3.98.0): the one door
  // the deploy gate reads and the press sleeps on, so the two cannot disagree.
  // The planted check's status carried it until that check was retired (3.97.0).
  theBoxsBusyAnswerLivesOnTheChecksStatus() {
    const s = src('lib/stages.js');
    assert.ok(/function stageGateBlockedBy\(\) \{\n  return require\('\.\/jobs'\)\.anyJobRunning\(\) \? 'a data job is running' : \(stageBusy\(\) \|\| require\('\.\/compute'\)\.sweepRunsHereOr\(\)\);\n\}/.test(s), 'one definition of what the box is busy with (a data job, the stage engine\'s own busy answer, and where "sweep processor" runs on)');
    assert.ok(/out\.blockedBy = stageGateBlockedBy\(\);/.test(s), 'the status does not carry it');
    assert.ok(/const busy = stageGateBlockedBy\(\);/.test(s), 'the press does not refuse on the same answer');
    const st = stages.stageGateStatus();
    assert.ok('blockedBy' in st, 'the field is missing, so a reader cannot tell a free box from a release without the answer');
    assert.strictEqual(st.blockedBy, null, 'an idle box reads as busy');
    const page = src('public/setup.html');
    assert.ok(/s\.blockedBy \? `disabled title="sleeping: \$\{esc\(s\.blockedBy\)\}/.test(page), 'the press does not sleep on the answer');
    assert.ok(/sleeping — \$\{esc\(s\.blockedBy\)\}/.test(page), 'the reason is not printed beside the press');
  },
};
