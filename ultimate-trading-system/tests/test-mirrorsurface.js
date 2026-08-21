// The reproduce-check has to REACH the screen.
//
// live-mirror.js re-runs every setup's recorded decisions against fresh data and
// writes data/live/mirror.json. Nothing read that file, so the Trade screen's
// reproduce-check line said "not run yet" permanently and its MIRROR BREAK
// banner could never appear. A check that runs, finds a break and cannot tell
// anyone is worse than no check at all: silence reads as "clean".
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const ROUTES = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'routes.js'), 'utf8');
const SCREEN = fs.readFileSync(path.join(ROOT, 'public', 'trade.html'), 'utf8');
const WRITER = fs.readFileSync(path.join(ROOT, 'live-mirror.js'), 'utf8');

module.exports = {
  // Both ends must name the same file, or the link is broken again.
  async theWriterAndTheReaderNameTheSameFile() {
    assert.ok(/mirror\.json/.test(WRITER), 'live-mirror.js no longer writes mirror.json');
    assert.ok(/mirror\.json/.test(ROUTES), 'the status handler no longer reads mirror.json');
  },

  // The screen keys off st.mirror; the payload must actually carry it.
  async theStatusPayloadCarriesWhatTheScreenReads() {
    assert.ok(/\bmirror\b\s*[,}]/.test(ROUTES) && /mirror\s*=/.test(ROUTES),
      'the status handler does not attach a mirror field');
    assert.ok(/st\.mirror/.test(SCREEN), 'the screen no longer reads st.mirror');
  },

  // The per-setup record and the screen must agree on field names. The writer
  // stores setup_id/checked/breaks; the screen reads breaks and checked.
  async theRecordAndTheScreenAgreeOnFieldNames() {
    assert.ok(/setup_id/.test(ROUTES), 'the handler does not match on setup_id');
    assert.ok(/st\.mirror\.breaks/.test(SCREEN) && /st\.mirror\.checked/.test(SCREEN),
      'the screen reads fields the record does not carry');
  },

  // An absent file must render as "not run yet", never as clean. This is the
  // whole failure mode: a missing answer must not look like a good one.
  async anAbsentRecordIsNotRunYetAndNeverClean() {
    assert.ok(/catch \(_\) \{ \/\* never run, or unreadable/.test(ROUTES),
      'a missing or unreadable file no longer falls through to null');
    assert.ok(/st\.mirror==null[\s\S]{0,80}not run yet/.test(SCREEN),
      'the screen no longer distinguishes "not run yet" from a clean result');
  },
};
