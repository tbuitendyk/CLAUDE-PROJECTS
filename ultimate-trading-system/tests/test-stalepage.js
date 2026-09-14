// A PAGE OLDER THAN THE BOX IS REFUSED, NOT SERVED (3.137.0). Owner, 2026-09-14,
// after the third press in one evening landed from a page loaded before the
// deploy that had just changed it: "could you please do this right already?".
// The engine stamps every page with its release, every ask carries the stamp
// back, a mismatch is refused with one answer, and the page reloads itself on
// that answer. Each test name is the assertion a mutation guard aims at.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');
const S = require('../lib/stalepage');

const ROOT = path.join(__dirname, '..');
const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

module.exports = {
  // THE REFUSAL: only a stamp from another release is refused. No stamp is a
  // script or a probe, never a page, and is let through.
  aPageStampedWithAnotherReleaseIsRefusedAndOneWithNoStampIsNot() {
    assert.strictEqual(S.refusal('3.137.0', '3.137.0'), null, 'the page the box served is refused');
    assert.strictEqual(S.refusal(undefined, '3.137.0'), null, 'an ask with no stamp is refused -- a probe or a script is not a page');
    assert.strictEqual(S.refusal('', '3.137.0'), null, 'an empty stamp is refused');
    const no = S.refusal('3.136.0', '3.137.0');
    assert.ok(no && no.code === 409, 'a page from the previous release is served rather than refused');
    assert.strictEqual(no.body.stalePage, true, 'the refusal does not say it is a stale page, so the page cannot tell it from any other refusal');
    assert.strictEqual(no.body.release, '3.137.0');
    assert.ok(/loaded under release 3\.136\.0 and the box now runs 3\.137\.0 — reload the page/.test(no.body.error), `the refusal does not name both releases: ${no.body.error}`);
    assert.ok(S.refusal('3.138.0', '3.137.0'), 'a page NEWER than the box is served -- the box is the release, whichever way the mismatch runs');
  },

  // THE STAMP goes into the head, before any script, and a page without the
  // charset line is left alone rather than stamped somewhere a page cannot read.
  theStampGoesIntoTheHeadBeforeAnyScript() {
    const page = '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>x</title>\n<script src="a.js?v=1"></script>\n</head><body></body></html>';
    const out = S.stamp(page, '3.137.0');
    assert.ok(out.includes('<meta charset="utf-8">\n<meta name="uts-release" content="3.137.0">'), 'the stamp is not right after the charset line');
    assert.ok(out.indexOf('uts-release') < out.indexOf('<script'), 'the stamp comes after a script, which could ask before it is there');
    assert.strictEqual(S.stamp('<html><body></body></html>', '3.137.0'), '<html><body></body></html>', 'a page with no charset line is changed');
    for (const f of ['public/construct.html', 'public/trade.html', 'public/setup.html']) {
      assert.ok(src(f).includes('<meta charset="utf-8">'), `${f} has no charset line, so it would be served unstamped`);
    }
  },

  // THE ENGINE refuses before every route, and stamps every page it serves.
  theEngineRefusesBeforeEveryRouteAndStampsEveryPageItServes() {
    const server = src('server.js');
    const guard = server.indexOf("app.use('/api', (req, res, next) => {");
    assert.ok(guard > 0, 'the engine has no refusal for a page older than itself');
    assert.ok(server.includes('const no = stalepage.refusal(req.get(stalepage.HEADER), RELEASE);')
      && server.includes('return no ? res.status(no.code).json(no.body) : next();'), 'the refusal is not the one lib/stalepage.js works out');
    assert.ok(guard < server.indexOf("app.get('/api/"), 'the refusal sits after a route, which that route escapes');
    assert.ok(guard < server.indexOf("app.get(['/', '/setup.html'"), 'the refusal sits after the page door');
    const door = server.slice(server.indexOf("app.get(['/', '/setup.html'"), server.indexOf("app.get('/api/healthz'"));
    assert.ok(/res\.type\('html'\)\.send\(stalepage\.stamp\(html\.replace\(/.test(door) && /, RELEASE\)\);/.test(door), 'the page door serves a page without its release');
    assert.strictEqual(S.HEADER, 'x-uts-release');
    assert.strictEqual(S.META, 'uts-release');
  },

  // THE PAGES read the stamp, send it with every ask -- both kinds, both pages
  // (RULE TWO: Trade is one file above both branches) -- and reload on the one
  // answer that says they are older than the box. No ask goes out without it.
  everyAskFromEveryPageCarriesTheStampAndThePageReloadsWhenRefused() {
    for (const f of ['public/construct.js', 'public/trade.html']) {
      const page = src(f);
      assert.ok(page.includes(`const PAGE_RELEASE = (document.querySelector('meta[name="uts-release"]') || {}).content || '';`), `${f}: the page does not read its own release`);
      assert.ok(page.includes(`const releaseHeaders = () => (PAGE_RELEASE ? { 'X-UTS-Release': PAGE_RELEASE } : {});`), `${f}: the release is not put on the ask`);
      assert.ok(page.includes('if (!j || !j.stalePage) return false;\n  window.location.reload();'), `${f}: the page does not reload itself on the refusal`);
      assert.ok(page.includes('if (r.status !== 409) return false;'), `${f}: any refusal reloads the page, not only the stale-page one`);
      const fetches = page.split('fetch(').length - 1;
      const stamped = page.split('releaseHeaders()').length - 1;       // its definition reads `releaseHeaders = () =>`, which is not a call
      assert.strictEqual(fetches, 2, `${f}: the page asks in more places than the two helpers -- an ask outside them carries no stamp`);
      assert.strictEqual(stamped, 2, `${f}: an ask goes out without the stamp`);
      assert.strictEqual(page.split('await stalePage(r)').length - 1, 2, `${f}: an answer is read without asking whether it is the refusal`);
    }
    // the Setup page is served by the always-up program, unstamped, and asks
    // without a stamp: it must not carry one it cannot have
    assert.ok(!src('public/setup.html').includes('X-UTS-Release'), 'the Setup page sends a stamp it is never given');
  },
};
