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
