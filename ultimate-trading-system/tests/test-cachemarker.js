// A SHIPPED CHANGE MUST REACH THE BROWSER (fixed 2026-08-21, after it bit).
//
// Each page asks for its scripts with a ?v= marker on the end, and the server
// rewrites that marker before sending the page. It used to rewrite it to the
// version out of package.json — a number that had not changed in weeks. So
// every deploy served the scripts at the SAME address, and a browser caches by
// address.
//
// What that cost: a whole day of shipped work sat on the box while the owner's
// browser kept serving them the copy from before it, and they asked where their
// new tab was. The comment above the code had predicted exactly this.
//
// The marker is now a short hash of the file's own contents: it changes when
// the file changes, and never when it has not.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

module.exports = {
  // The thing that actually went wrong.
  async theMarkerIsNotAVersionNumberAnybodyHasToRemember() {
    const door = SERVER.slice(SERVER.indexOf("app.get(['/', '/setup.html'"), SERVER.indexOf('app.get(\'/api/healthz\''));
    assert.ok(!/\$\{v\}/.test(door) && !/require\('\.\/package\.json'\)\.version/.test(door),
      'the script marker is a hand-bumped version again — a deploy that does not bump it serves every browser the old file');
    assert.ok(/createHash\('sha1'\)/.test(door),
      'the script marker is not derived from the file contents');
  },

  // And it must be per file, not one marker for all of them.
  async eachScriptIsStampedFromItsOwnContents() {
    const door = SERVER.slice(SERVER.indexOf("app.get(['/', '/setup.html'"), SERVER.indexOf('app.get(\'/api/healthz\''));
    assert.ok(/\(\[\\w.-\]\+\\\.js\)\\\?v=/.test(door) || /\[\\w\.-\]\+\\\.js/.test(door),
      'the rewrite no longer captures the script NAME, so every script would share one marker');
    assert.ok(/stamp\(jsName\)/.test(door), 'the marker is not computed from the script being asked for');
  },

  // The pages must actually carry a marker to rewrite.
  async everyPageAsksForItsScriptsWithAMarker() {
    for (const page of ['construct.html', 'setup.html', 'trade.html']) {
      const html = fs.readFileSync(path.join(ROOT, 'public', page), 'utf8');
      for (const m of html.matchAll(/<script src="([^"]+)"/g)) {
        assert.ok(/\?v=/.test(m[1]),
          `${page} asks for ${m[1]} with no marker, so a change to it will never reach a browser that has it cached`);
      }
    }
  },

  // Two different files must not land on the same marker.
  async twoDifferentScriptsGetDifferentMarkers() {
    const hash = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'public', f))).digest('hex').slice(0, 12);
    assert.notStrictEqual(hash('construct.js'), hash('help-content.js'),
      'two different scripts hash to the same marker');
  },
};
