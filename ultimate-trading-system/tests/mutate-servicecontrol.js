#!/usr/bin/env node
// DOES THE COMPUTE HAND'S SAFETY NET ACTUALLY CATCH ANYTHING?
//
//   node tests/mutate-servicecontrol.js              every guard
//   node tests/mutate-servicecontrol.js <part-of-a-test-name>   just those
//
// The control runs as root and most of what is written about it is a refusal —
// and a refusal test is the easiest kind to get wrong: it passes whether or not
// the guard it names is there, because the request failed for some other
// reason. So each guard is deleted in turn (or, where the safety is an absence,
// the danger is added back) and the suite is run against the damage. The test
// that names that guard has to FAIL. One that does not is protecting nothing,
// and it is worse than nothing because it reads as protection.
//
// Finds so far, every one the same mistake in different clothes — a test
// checking something OTHER than the thing it is named after: a refusal test
// that accepted either of two answers; a test that grepped a page for words
// instead of running it; and this harness itself breaking only the FIRST copy
// of a guard that appeared twice.
//
// It restores every file it touches, including when a run throws.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SVC = path.join(ROOT, 'service-control', 'server.js');
const SETUP = path.join(ROOT, 'public', 'setup.html');
const UNIT = path.join(ROOT, 'service-control', 'uts-service-control.service');
const COMPUTE = path.join(ROOT, 'lib', 'compute.js');
const BATCH = path.join(ROOT, 'lib', 'batch.js');

// file, the text to break, what to break it to, the test that must notice, and
// what it would cost if nobody did.
const GUARDS = [
  [SVC, '  if (!UNITS.includes(unit)) {\n    return { code: 400, body: { error: `"${unit}" is not one of this system\'s services (${UNITS.join(\', \')})` } };\n  }\n  if (!ACTIONS.includes(action))',
    '  if (!ACTIONS.includes(action))',
    'aServiceNotOnTheListIsRefusedAndNothingRuns', 'any service on the machine can be stopped from a phone'],
  [SVC, "if (unit === SELF_UNIT && action !== 'start')", 'if (false)',
    'evenWhenListedByHandTheControlRefusesToStopItself', 'the owner can strand themselves with one press'],
  [SVC, "if (String((body || {}).confirm || '') !== unit) {\n    return { code: 400, body: { error: `to ${action}",
    "if (false) {\n    return { code: 400, body: { error: `to ${action}",
    'nothingHappensUnlessTheNameIsGivenTwice', 'one mistyped request stops a service'],
  [SVC, 'if (!Number.isFinite(pct) || pct < 10 || pct > cores * 100)', 'if (false)',
    'theCeilingIsBoundedAndAppliedWithSetProperty', 'a ceiling of 1% starves a service into the very outage this exists to end'],
  [SVC, 'if (want !== PUBLIC_DIR && !want.startsWith(PUBLIC_DIR + path.sep))', 'if (false)',
    'itCannotBeTalkedIntoServingAFileOutsideThePagesFolder', 'any file on the machine can be read out'],
  [SVC, "return send(res, 405,", "return servePublic(res, url); // broken on purpose\n  return send(res, 405,",
    'itAnswersNothingButTheThingsItIsFor', 'it answers methods it was never meant to'],
  [SVC, "url = url.replace(/^\\/svc(?=\\/|$)/, '') || '/';", "url = url || '/';",
    'theSameRequestWorksFromBothAddresses', 'the controls work from one address and silently not the other — and the other is the one used during an outage'],
  [SETUP, "'svc/api/service'", "'api/service'",
    'theComputeTabActsThroughTheSeparateProgram', 'the buttons ask the very service that will be down'],
  [UNIT, 'Restart=always', 'Restart=on-failure',
    'theControlsOwnUnitAlwaysRestartsAndIsTiny', 'the one way back does not come back on its own'],
  [COMPUTE, 'if (!platforms().some((p) => p.id === platformId)) {', 'if (false) {',
    'aRoleCanOnlyPointAtAPlatformThatExists', 'a role can be pointed at a platform that does not exist, silently'],
  [BATCH, "const elsewhere = require('./compute').sweepRunsHereOr();\n  if (elsewhere) return elsewhere;",
    '',
    'theSweepLauncherReadsTheRoleAndRefusesAnUnreachablePlatform', 'the Compute tab choice becomes a decoration nothing reads'],
  [path.join(ROOT, 'lib', 'replication.js'), 'if (saved && saved.rowsSeen === rows) {', 'if (saved) {',
    'aSaveThatIsBehindSaysSoAndAFreshOneServesInstantly', 'a tally from an earlier sitting wears a finished run\'s face'],
  [path.join(ROOT, 'lib', 'batch.js'), "try { require('./replication').startTotals(doc.id); }",
    "try { void (doc.id); }",
    'theBuildRunsOffTheAnsweringThreadAndFiresAtCompletion', 'a finished run is never totalled until somebody waits the minutes for it'],
  [path.join(ROOT, 'lib', 'replication.js'), '  kept.sort(orders[key]);\n', '',
    'theFloorSaysWhatItRemovedAndPagesContinueOneOrder', 'page one of the every-coin table is whatever order the tally fell out in, presented as the top'],
  [path.join(ROOT, 'lib', 'replication.js'), 'if (saved && saved.v === TALLY_V && saved.rowsSeen === rows) {', 'if (saved && saved.rowsSeen === rows) {',
    'aTallyFromBeforeThePerCoinScoreRebuildsForTheCoinView', 'a save with no per-coin counts is served to the per-coin view as fresh, showing every coin unscored'],
  [path.join(ROOT, 'lib', 'replication.js'), 'avgHold: a.hold ? (a.sum || 0) / a.hold : null,', 'avgHold: a.sum || 0,',
    'theAveragesMatchThePencil', 'a 16-row sum is shown under the heading that says average, which is the exact uselessness the owner ordered out'],
  [path.join(ROOT, 'lib', 'replication.js'), 'avgTrades: a.hold ? (a.t || 0) / a.hold : null,', 'avgTrades: a.t || 0,',
    'theAveragesMatchThePencil', 'the trades column sums instead of averaging and reads 16 times too big'],
  [path.join(ROOT, 'lib', 'replication.js'), '    } else if (hold != null) {', "    } else if (hold != null) {\n      a.t += (r.holdout.trades || 0);",
    'theAveragesMatchThePencil', 'the scrambled copies\' trades pour into the average, which then measures the machinery instead of the coin'],
  [path.join(ROOT, 'lib', 'replication.js'), "  const got = rowstore.readBlocks(doc.id, 'replication', a.b);",
    "  const got = rowstore.readBlocks(doc.id, 'replication', (rowstore.blocksOf(doc.id, 'replication') || []).map((x, i) => i));",
    'theRecordsBehindACoinRowComeFromOnlyItsBlocks', 'opening one coin\'s records unpacks the whole store — the ten-minute freeze back under a new button'],
  [path.join(ROOT, 'lib', 'replication.js'), '      if (starts && starts.length) a.b = [...new Set(a.at.map(blockOfRow))].sort((x, y) => x - y);', '',
    'theRecordsBehindACoinRowComeFromOnlyItsBlocks', 'no save ever carries the record index, so the records button answers nothing forever'],
  [path.join(ROOT, 'lib', 'replication.js'), '      delete a.at;', '',
    'theRecordsBehindACoinRowComeFromOnlyItsBlocks', 'millions of row positions ride along in a file that is read back on every open'],
  [path.join(ROOT, 'lib', 'planted.js'), "  if ((!doc.edgeCensus || !doc.edgeCensus.length) && rowstore.exists(doc.id, 'census')) {", 'if (false) {',
    'theVerdictReadsRowsTheDocumentOnlyCounts', 'every gate run since the rows moved to disk reads UNREADABLE and the planted check fails healthy engines forever'],
  [path.join(ROOT, 'lib', 'planted.js'), '  if (prev && prev.readerV === GATE_READER_V\n    && prev.status === doc.status', '  if (prev && prev.status === doc.status',
    'aKeptVerdictFromTheOldReaderIsRetakenWhileTheRowsExist', 'the wrong FAIL kept by the blind reader is trusted until the run is deleted'],
  [path.join(ROOT, 'lib', 'planted.js'), '  if (prev && prev.runDeleted) return prev;', '',
    'aDeletedRunsVerdictIsNeverRetaken', 'a deleted run\'s kept PASS is retaken with no rows and manufactured into the very UNREADABLE the record exists to outlive'],
  [path.join(ROOT, 'lib', 'batch.js'), "        try { require('./planted').recordGate(hydrate(doc)); } catch (_) { /* the strip re-reads live runs anyway */ }", '',
    'theBootSweepRetakesStaleGateRecords', 'a wrong kept verdict lies in wait until somebody edits notes or deletes the run'],
  [path.join(ROOT, 'lib', 'replication.js'), '\n    && totalsInHand.mtimeMs === st.mtimeMs && totalsInHand.size === st.size) {', ') {',
    'theTotalsAreParsedOnceAndNeverServedStale', 'the build worker finishes a fresh tally and every screen keeps serving yesterday\'s from memory'],
  [path.join(ROOT, 'lib', 'replication.js'), '    totalsInHand = { runId, mtimeMs: st.mtimeMs, size: st.size, totals };\n    return totals;', '    return totals;',
    'theTotalsAreParsedOnceAndNeverServedStale', 'the cache caches nothing and every ask parses the whole file again'],
  [BATCH, '              decision: l.decision ?? null, bandMode: l.bandMode ?? null,\n              weekdaysOnly: l.weekdaysOnly ?? null, key: l.key ?? null,', '',
    'theRecordedRowNamesItsChoices', 'every new run\'s records go back to being anonymous settings in the very table read to learn which settings carry signal'],
  [path.join(ROOT, 'public', 'construct.js'), "were recovered from this run's own unit records", 'are shown',
    'theRecordedRowNamesItsChoices', 'recovered names wear the face of written ones — the reader cannot weigh what kind of fact they are'],
  [path.join(ROOT, 'lib', 'choices.js'), '|| cur.labels.has(label)', '',
    'theOrderNamesWhatNoFieldCan', 'two same-signature units melt into one span and the vote wears the argmax\'s name'],
  [path.join(ROOT, 'lib', 'choices.js'), 'if (census[j].sig === cur.sig) { hit = j; break; }', 'if (true) { hit = j; break; }',
    'theOrderNamesWhatNoFieldCan', 'a span claims whatever census record the pointer happens to sit on, fields be damned'],
  [path.join(ROOT, 'lib', 'choices.js'), 'if (list.length <= 1) continue;', 'if (true) continue;',
    'duplicateClaimsInOneGroupAreBothStripped', 'a proven misalignment keeps its names and one unit wears another\'s choices'],
  [path.join(ROOT, 'lib', 'replication.js'), 'const s = choices.namesAt(units, ats[i]);', 'const s = choices.namesAt(units, i);',
    'theRecordsServeTheRecoveredNamesAndSaySo', 'records are named by their position IN THE ANSWER instead of in the store — every expansion past the first block lies'],
  [path.join(ROOT, 'public', 'construct.html'), '<button class="themebtn" id="themebtn">◐ theme</button>',
    '<button class="themebtn" id="cpubtn">CPU —</button>\n      <button class="themebtn" id="themebtn">◐ theme</button>',
    'theCpuDialLivesOnTheComputeTabAlone', 'the removed CPU button grows back beside the theme button and the dial has two homes again'],
  [path.join(ROOT, 'public', 'construct.js'), 'openRecs.byKey.set(key, got);', '',
    'theOpenRecordsSurviveARedraw', 'opened records fold on every redraw again and the remembered scroll lands short'],
  [path.join(ROOT, 'public', 'construct.js'), 'if (!el.title) el.title = text;', 'el.title = text;',
    'everyControlsHelpBecomesItsHover', 'the wired hover overwrites every hand-written warning in the templates'],
  [path.join(ROOT, 'public', 'construct.js'), "drawSweep = ((fn) => async (...a) => { const r = await fn(...a); hoverFromHelp('sweep'); return r; })(drawSweep);", '',
    'everyControlsHelpBecomesItsHover', 'the Sweep controls go back to having no hovers at all'],
  [path.join(ROOT, 'lib', 'replication.js'), 'avgVsLong: a.vln ? (a.vl || 0) / a.vln : null,', 'avgVsLong: a.vl || 0,',
    'theAveragesMatchThePencil', 'the vs always-long column sums instead of averaging and reads 16 times too big'],
  [path.join(ROOT, 'lib', 'replication.js'), '    } else if (hold != null) {', "    } else if (hold != null) {\n      a.vl += (r.holdout.vsAlwaysLong || 0); a.vln++;",
    'theAveragesMatchThePencil', 'the scrambled copies thin the vs always-long average toward zero'],
  [path.join(ROOT, 'lib', 'replication.js'), '    vslong: (a, b) => byVsL(a, b) || byShare(a, b),\n', '',
    'theAveragesMatchThePencil', 'the new sort choice silently orders by nothing'],
  [path.join(ROOT, 'lib', 'replication.js'), 'if (!saved || !(saved.v >= SPANS_FROM_V)) {', 'if (!saved || saved.v !== TALLY_V) {',
    'aV3SaveKeepsTheRecordsWorkingWhileTheAveragesRebuild', 'every records button goes dark for the whole fifteen-minute rebuild after any tally change'],
  [path.join(ROOT, 'lib', 'replication.js'), 'const scoped = only ? rows.filter((r) => r.label === only) : rows;', 'const scoped = rows;',
    'aLabelNarrowsToOneConfigurationsCoins', 'an opened line shows every configuration\'s coins under one configuration\'s name'],
  [path.join(ROOT, 'public', 'construct.js'), 'Replication — ${Number(rep.configs || 0).toLocaleString()} declared configs, ranked', 'Replication — ${scored.length} declared configs, ranked',
    'theRankedHeadingCountsEveryConfigurationNotThePage', 'the heading names the page length as the number of configurations the run declared'],
];

const only = process.argv[2] || '';

let missed = 0;
for (const [file, from, to, testName, consequence] of GUARDS) {
  if (only && !testName.toLowerCase().includes(only.toLowerCase())) continue;
  const orig = fs.readFileSync(file, 'utf8');
  const hits = orig.split(from).length - 1;
  if (!hits) {
    console.log(`SKIP  ${testName}\n      the guard this breaks is no longer written that way, so nothing was tested`);
    missed++;
    continue;
  }
  // EVERY occurrence, not the first — a guard written twice must break twice.
  fs.writeFileSync(file, orig.split(from).join(to));
  let out = '';
  try {
    out = execFileSync('npm', ['test'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch (err) {
    out = `${err.stdout || ''}${err.stderr || ''}`;
  } finally {
    fs.writeFileSync(file, orig);
  }
  if (new RegExp(`FAIL[^\\n]*${testName}`).test(out)) {
    console.log(`ok    ${testName}${hits > 1 ? `  (${hits} copies of that guard broken)` : ''}`);
  } else {
    missed++;
    console.log(`MISS  ${testName}\n      the guard was deleted and the suite stayed green, so ${consequence}`);
  }
}

console.log(missed
  ? `\n${missed} guard(s) are not really being checked — see above`
  : '\nevery guard was deleted in turn and the suite caught every one');
process.exit(missed ? 1 : 0);
