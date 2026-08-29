// THE RELEASE NUMBER MOVES WITH THE CODE, ALWAYS (owner order, 2026-08-29).
//
// The owner's words: "YOU *ALWAYS* MAKE RELEASE NUMBER UPDATES -- no more of
// this adding code willy nilly and not updating the release numbers. that's
// just wrong."
//
// And earlier the same day: "with all the updates today to the system why is
// the release stuck at 2.0.0? check your releases history and make sure you
// don't slack off on that" -- then, when the number still had not moved, "why
// is this still release 2.0.0 seeing we've been adding functionality to the
// sweep and boards continuously over the past few days? are you just
// forgetting?"
//
// The honest answer was yes, in effect: 2.0.0 stood for nine days and 193
// commits, including a new three-stage system, a rebuilt committee, a new
// measurement block, and four screens deleted. Nothing bumped it and nothing
// noticed, because the only thing between the code and the number was somebody
// remembering. That is not a guarantee, and this file is what replaces it.
//
// WHY IT MATTERS BEYOND TIDINESS. The number is not a badge. It is the engine
// identity that evidence is keyed to:
//   * a planted-check PASS belongs to the release that earned it, so a new
//     release starts NOT CHECKED (lib/planted.js gateStatus);
//   * the age-dial exams are cleared per release (lib/httwo.js examStatus);
//   * a stage refuses a parent written by a different release (lib/stages.js);
//   * a greenlight and a live setup each record the release their evidence is
//     about (lib/live/greenlight.js, lib/live/setups.js).
// Shipping changed arithmetic under an unchanged number tells all five that
// nothing changed. That is the real cost of forgetting.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const REPO = path.join(ROOT, '..');
const PREFIX = 'ultimate-trading-system/';

// What counts as PRODUCT: anything that can change a number the owner reads or
// the way the box behaves. Tests, decision records and the word lists are not
// product -- they describe it, and a note about the code is not a change to it.
const PRODUCT = ['lib', 'public', 'server.js', 'live-mirror.js', 'live-produce.js',
  'pilot-refresh.js', 'service-control', 'package.json'];

// `raw` skips the trim, because `git status --porcelain` puts the status in
// the first TWO columns and an unmodified-in-index file leads with a space --
// trimming it shifts every path one character left, which silently ate the
// first letter of every filename the first time this was written.
function git(args, { raw = false, ...opts } = {}) {
  const out = execFileSync('git', args,
    { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'], ...opts });
  return raw ? out : out.trim();
}
function versionAt(commit) {
  try { return JSON.parse(git(['show', `${commit}:${PREFIX}package.json`])).version || null; }
  catch (_) { return null; }
}
function cmp(a, b) {
  const A = a.split('.').map(Number); const B = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
  return 0;
}

module.exports = {
  // The number has to be a real one, and read from ONE place by everything
  // that stamps it -- a second copy is a second answer, and the one that
  // drifts is the one nobody is looking at.
  theReleaseNumberIsReadableAndReadFromOnePlace() {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    assert.ok(/^\d+\.\d+\.\d+$/.test(v || ''),
      `the release number is "${v}" -- it has to be three numbers, because five different records stamp it and compare it`);
    for (const [rel, why] of [
      ['lib/stages.js', 'a record set stamps the release that wrote it'],
      ['lib/batch.js', 'a run stamps the release that wrote it'],
      ['server.js', 'the planted check and the exams are keyed to it'],
      ['lib/live/version.js', 'a live setup and a greenlight each record the release their evidence is about'],
    ]) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      assert.ok(/require\('[./]*package\.json'\)/.test(src) && /\.version/.test(src),
        `${rel} no longer reads the release out of package.json -- ${why}`);
    }
  },

  // THE ONE THAT WOULD HAVE CAUGHT NINE DAYS OF DRIFT. Find the commit where
  // the number last moved; anything product-shaped that changed after it,
  // committed or not, is a release shipping under a number that does not
  // describe it.
  theReleaseNumberHasMovedSinceTheLastProductChange() {
    // No git (the adversarial suite copies lib/ and public/ and nothing else).
    // SAY SO rather than passing: a silent skip is how the number stood still
    // for nine days in the first place.
    assert.ok(fs.existsSync(path.join(REPO, '.git')),
      'this check needs the repository to read when the release last moved, and there is no .git here -- '
      + 'run the suite from a real checkout');
    const head = git(['rev-parse', 'HEAD']);
    const current = versionAt(head);
    assert.ok(current, 'package.json cannot be read at HEAD');

    // Walk back through the commits that touched package.json until the
    // version actually differs from its parent's: that is where it last moved.
    let movedAt = null;
    for (const c of git(['log', '--format=%H', '--', `${PREFIX}package.json`]).split('\n').filter(Boolean)) {
      if (versionAt(c) !== versionAt(`${c}^`)) { movedAt = c; break; }
    }
    assert.ok(movedAt, 'no commit in this history ever set the release number, so there is nothing to measure drift against');

    const paths = PRODUCT.map((p) => `${PREFIX}${p}`);
    const committed = git(['diff', '--name-only', `${movedAt}..${head}`, '--', ...paths]).split('\n').filter(Boolean);
    // ...and anything not yet committed counts too, or the rule only bites
    // after the mistake is already in the history.
    const dirty = git(['status', '--porcelain', '--', ...paths], { raw: true }).split('\n').filter(Boolean)
      .map((l) => (/^..\s(.*)$/.exec(l) || [, l])[1])
      .map((f) => (f.includes(' -> ') ? f.split(' -> ')[1] : f).replace(/^"|"$/g, ''));
    const all = [...new Set([...committed, ...dirty])].sort();

    assert.deepStrictEqual(all, [],
      `the release is ${current}, set at ${movedAt.slice(0, 12)}, and ${all.length} product file(s) have changed since `
      + `without it moving:\n  ${all.slice(0, 20).join('\n  ')}`
      + `${all.length > 20 ? `\n  ...and ${all.length - 20} more` : ''}\n`
      + '     Bump the version in package.json in the same commit as the change.');
  },

  // AND IT ONLY EVER GOES FORWARD. A number that goes backwards makes an older
  // record look newer than it is, and all five comparisons read the wrong way.
  theReleaseNumberOnlyEverGoesForward() {
    if (!fs.existsSync(path.join(REPO, '.git'))) return;
    for (const c of git(['log', '--format=%H', '--', `${PREFIX}package.json`]).split('\n').filter(Boolean).slice(0, 40)) {
      const now = versionAt(c);
      const before = versionAt(`${c}^`);
      if (!now || !before || now === before) continue;
      if (!/^\d+\.\d+\.\d+$/.test(now) || !/^\d+\.\d+\.\d+$/.test(before)) continue;
      assert.ok(cmp(now, before) > 0,
        `${c.slice(0, 12)} moved the release from ${before} to ${now} -- backwards. Every record that stamps the `
        + 'release compares it, so an older set would read as the newer one.');
    }
  },
};
