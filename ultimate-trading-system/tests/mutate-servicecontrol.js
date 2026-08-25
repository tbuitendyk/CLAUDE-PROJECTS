#!/usr/bin/env node
// DOES THE RESTART BUTTON'S SAFETY NET ACTUALLY CATCH ANYTHING?
//
//   node tests/mutate-servicecontrol.js              every guard
//   node tests/mutate-servicecontrol.js <part-of-a-test-name>   just those
//
// The control runs as root. Most of what is written about it is a refusal, and
// a refusal test is the easiest kind to get wrong: it passes whether or not the
// guard it names is there, because the request failed for some other reason.
//
// So each guard is deleted in turn and the suite is run against the damage. The
// test that names that guard has to FAIL. One that does not is protecting
// nothing, and it is worse than nothing because it reads as protection.
//
// IT HAS FOUND THREE, and every one was the same mistake: something checking
// other than the thing it is named after.
//
//   * a refusal test that accepted "either of two answers", so deleting one of
//     the two guards changed nothing it could see;
//   * a test that GREPPED the page's source for the words it expected instead
//     of running it, so the words being present somewhere else satisfied it;
//   * and this harness itself, which broke only the FIRST copy of a guard in a
//     file. The moment the same check appeared twice it started breaking the
//     wrong one, and blamed the test.
//
// Run it after changing anything in service-control/. It restores every file it
// touches, including when a run throws.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SVC = path.join(ROOT, 'service-control', 'server.js');
const CJS = path.join(ROOT, 'public', 'construct.js');
const UNIT = path.join(ROOT, 'service-control', 'uts-service-control.service');

// file, the text to break, what to break it to, the test that must notice, and
// what it would cost if nobody did.
const GUARDS = [
  [SVC, "const UNIT = process.env.UTS_UNIT || 'ultimate-trading-system.service';",
    "const UNIT = process.env.UTS_UNIT || 'nginx.service';",
    'restartingTouchesTheTradingServiceAndNothingElse', 'the button restarts the wrong service'],
  // THIS ONE ADDS THE DANGER BACK rather than deleting a guard, because there
  // is no guard to delete: the safety is that no unit can be NAMED in a
  // request, and an absence cannot be mutated away. So the mutation puts the
  // name back — which is exactly the regression worth fearing — and the test
  // has to notice that a body can now aim it somewhere else.
  [SVC, '    req.resume();\n    return restart().then((r) => send(res, r.code, r.body)).catch((e) => send(res, 500, { error: e.message }));',
    "    let raw = '';\n    req.on('data', (c) => { raw += c; });\n    req.on('end', () => {\n"
    + "      let b = {}; try { b = JSON.parse(raw || '{}'); } catch (_) { b = {}; }\n"
    + "      if (b.unit) { run('systemctl', ['restart', b.unit]).then(() => send(res, 200, { ok: true, unit: b.unit, was: '?', now: '?' })); return; }\n"
    + '      restart().then((r) => send(res, r.code, r.body)).catch((e) => send(res, 500, { error: e.message }));\n'
    + '    });\n    return undefined;',
    'nothingSentInCanAimItAtAnotherService', 'a request body can aim the restart at any service on the machine'],
  [SVC, 'if (want !== PUBLIC_DIR && !want.startsWith(PUBLIC_DIR + path.sep))', 'if (false)',
    'itCannotBeTalkedIntoServingAFileOutsideThePagesFolder', 'any file on the machine can be read out'],
  [SVC, "return send(res, 405,", "return servePublic(res, url); // broken on purpose\n  return send(res, 405,",
    'itAnswersNothingButTheTwoThingsItIsFor', 'it answers methods it was never meant to'],
  [SVC, "url = url.replace(/^\\/svc(?=\\/|$)/, '') || '/';", "url = url || '/';",
    'theSameRequestWorksFromBothAddresses', 'the button works from one address and silently not the other — and the other is the one used when the service is down'],
  [CJS, "tryPost('svc/api/restart'", "tryPost('api/restart'",
    'theButtonGoesThroughTheSeparateProgramAndNotTheMainApp', 'the button asks the very service that will be down'],
  [UNIT, 'Restart=always', 'Restart=on-failure',
    'theControlsOwnUnitAlwaysRestartsAndIsTiny', 'the one way back does not come back on its own'],
  [SVC, "const server = http.createServer((req, res) => {",
    "const listUnits = 1; const watching = 1;\nconst server = http.createServer((req, res) => {",
    'itHasNotGrownBackIntoAServiceBrowser', 'it grows back into the service browser that was thrown out'],
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
  // EVERY occurrence, not the first — see the header.
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
