#!/usr/bin/env node
// DOES THE SERVICE CONTROL'S SAFETY NET ACTUALLY CATCH ANYTHING?
//
//   node tests/mutate-servicecontrol.js
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
// It found one immediately. `aNameThatIsNotAServiceNameNeverReachesSystemctl`
// accepted "either 400 or 404" — so with the shape check deleted, a name like
// "nginx.service; rm -rf /" simply fell through to the does-this-machine-have-it
// check, was refused by that instead, and the test noticed nothing at all. It
// now asserts WHICH refusal, and fails when the shape check goes.
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
];

let missed = 0;
for (const [file, from, to, testName, consequence] of GUARDS) {
  const orig = fs.readFileSync(file, 'utf8');
  if (!orig.includes(from)) {
    console.log(`SKIP  ${testName}\n      the guard this breaks is no longer written that way, so nothing was tested`);
    missed++;
    continue;
  }
  fs.writeFileSync(file, orig.replace(from, to));
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
    console.log(`ok    ${testName}`);
  } else {
    missed++;
    console.log(`MISS  ${testName}\n      the guard was deleted and the suite stayed green, so ${consequence}`);
  }
}

console.log(missed
  ? `\n${missed} guard(s) are not really being checked — see above`
  : '\nevery guard was deleted in turn and the suite caught every one');
process.exit(missed ? 1 : 0);
