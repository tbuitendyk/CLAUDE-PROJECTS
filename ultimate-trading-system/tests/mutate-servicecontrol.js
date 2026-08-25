#!/usr/bin/env node
// DOES THE SERVICE CONTROL'S SAFETY NET ACTUALLY CATCH ANYTHING?
//
//   node tests/mutate-servicecontrol.js              every guard
//   node tests/mutate-servicecontrol.js <part-of-a-test-name>   just those
//
// The service control runs as root and starts and stops services, so almost
// every test written for it is a refusal: this may not be stopped, that name may
// not be passed on, nothing happens without the name given twice. A refusal test
// is the easiest kind to get wrong, because it passes whether or not the guard
// it names is there — the request fails for some other reason and the test is
// satisfied.
//
// So each guard is deleted in turn and the suite is run against the damage. The
// test that names that guard has to FAIL. One that does not is not protecting
// anything, and it is worse than nothing because it reads as protection.
//
// It has found two so far, and both were the same mistake wearing different
// clothes: a test that checks something OTHER than the thing it is named after.
//
//   * `aNameThatIsNotAServiceNameNeverReachesSystemctl` accepted "either 400 or
//     404" — so with the name-shape check deleted, a name like
//     "nginx.service; rm -rf /" simply fell through to the
//     does-this-machine-have-it check, was refused by that instead, and the test
//     noticed nothing. It now asserts WHICH refusal.
//
//   * the test on the answer column READ the page's source for the words it
//     expected instead of running it. With the red branch's condition changed
//     from "took the connection and said nothing" to "anything that did not
//     answer" — which puts ssh, the mail service and the tunnel back in red —
//     the words it was grepping for were still there, elsewhere in the same
//     function, and it passed. It now lifts the function out of the page, calls
//     it, and asserts the markup that comes back.
//
// And once in ITSELF, which is the same mistake a third time. It broke only the
// FIRST copy of a guard in a file. The moment the same check was written a
// second time elsewhere in the file it started breaking the wrong copy — the
// real one still stood, the suite stayed green, and it blamed the test. It
// breaks every copy now and says how many it broke.
//
// This is deliberately not part of `npm test`: it runs the whole suite once per
// guard. Run it after changing anything in service-control/.
//
// It restores every file it touches, including when a run throws.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SVC = path.join(ROOT, 'service-control', 'server.js');
const CJS = path.join(ROOT, 'public', 'construct.js');
const UNIT = path.join(ROOT, 'service-control', 'uts-service-control.service');

// file, the text to break, what to break it to, and the test that must notice.
const GUARDS = [
  [SVC, "['nginx.service', 'this is the web server", "['nginx-BROKEN.service', 'this is the web server",
    'theWaysBackCannotBeStoppedOrRestarted', 'a way back can be stopped'],
  [SVC, 'if (confirm !== unit) {', 'if (false) {',
    'nothingHappensUnlessTheNameIsGivenTwice', 'one mistyped request can stop a service'],
  [SVC, 'if (!UNIT_RE.test(unit))', 'if (false && !UNIT_RE.test(unit))',
    'aNameThatIsNotAServiceNameNeverReachesSystemctl', 'any text at all is treated as a service name'],
  [SVC, 'if (!found) return { code: 404', 'if (false) return { code: 404',
    'aServiceThisMachineDoesNotHaveIsTurnedAwayByName', 'a name this machine has never heard of is passed on'],
  [SVC, 'if (want !== PUBLIC_DIR && !want.startsWith(PUBLIC_DIR + path.sep))', 'if (false)',
    'itCannotBeTalkedIntoServingAFileOutsideThePagesFolder', 'any file on the machine can be read out'],
  [SVC, 'return send(res, 405,', 'return servePublic(res, url); // broken on purpose\n  return send(res, 405,',
    'itAnswersNothingButTheTwoThingsItIsFor', 'it answers methods it was never meant to'],
  [SVC, "url = url.replace(/^\\/svc(?=\\/|$)/, '') || '/';", "url = url || '/';",
    'theSameRequestWorksFromBothAddresses', 'the tab works from one address and silently not the other'],
  [CJS, "apiOr('svc/api/services'", "apiOr('api/services'",
    'theServiceTabAsksTheSeparateProcessAndNotTheMainApp', 'the tab asks the very service that will be down'],
  [UNIT, 'Restart=always', 'Restart=on-failure',
    'theControlsOwnUnitAlwaysRestartsAndIsTiny', 'the one way back does not come back on its own'],
  [SVC, "return done({ answered: false, state: 'spoke'", "return done({ answered: false, state: 'silent', wrong: true",
    'somethingAliveThatDoesNotServePagesIsNotReportedAsAFault', 'ssh and the mail service go red every time the tab is opened'],
  [CJS, "a.state === 'silent'", '!a.answered',
    'theScreenShowsOnlyTheOneStateThatIsAFaultAsAFault', 'everything that is not a web page is shown as broken'],
  [SVC, 'const rows = units.map((u) => {', 'const rows = units.filter((u) => !watching.length || watching.includes(u.unit)).map((u) => {',
    'keepingAListNarrowsWhatIsSHOWNAndNeverWhatIsREPORTED', "the owner's list quietly becomes the only thing the machine will report"],
  [CJS, 'const onlyKept = kept > 0 && !svcShowAll;', 'const onlyKept = !svcShowAll;',
    'anEmptyListShowsEverythingRatherThanNothing', 'an empty list draws an empty table, which reads as nothing running'],
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
  // EVERY OCCURRENCE, not the first. This used to break only the first, and the
  // moment the same guard was written a second time somewhere else in the file
  // the harness started breaking the wrong copy: the real one still stood, the
  // suite stayed green, and it reported the guard as unchecked when the fault
  // was its own. Caught by exactly that happening.
  fs.writeFileSync(file, orig.split(from).join(to));
  let out = '';
  try {
    out = execFileSync('npm', ['test'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch (err) {
    out = `${err.stdout || ''}${err.stderr || ''}`;
  } finally {
    fs.writeFileSync(file, orig);
  }
  const caught = new RegExp(`FAIL[^\\n]*${testName}`).test(out);
  if (caught) {
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
