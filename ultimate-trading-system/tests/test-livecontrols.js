// The two controls that put real money at risk.
//
// Both had the same shape of fault: an empty request was treated as an
// instruction. The arm route armed on anything that was not an explicit
// refusal, so a request carrying nothing at all started the live engine. The
// stop route recorded silence as the owner deliberately choosing to run with no
// protective stop, and the screen then displayed that as their decision.
//
// These are source-level contracts. The over-the-wire behaviour was checked by
// hand against a running server when the fix went in; this pins the shape so it
// cannot quietly regress.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const TRADE = fs.readFileSync(path.join(ROOT, 'public', 'trade.html'), 'utf8');

const handler = (route) => {
  const i = SERVER.indexOf(`app.post('${route}'`);
  assert.ok(i >= 0, `${route} is gone`);
  return SERVER.slice(i, i + 1800);
};

module.exports = {
  // Silence is not consent. The default on this route must be to refuse.
  async armingRequiresAnExplicitYes() {
    const h = handler('/api/pilot/arm');
    assert.ok(/req\.body\.armed !== true/.test(h),
      'the arm route no longer requires armed === true, so an empty request would arm the live engine');
    assert.ok(/!req\.body \|\|/.test(h), 'a request with no body at all is not refused');
  },

  // Requiring the yes is only safe if the real button sends it. A fix that
  // breaks the owner's master switch is not a fix.
  async theRealStartButtonSendsThatYes() {
    assert.ok(/post\('api\/pilot\/arm',\s*\{\s*armed\s*:\s*true\s*\}\)/.test(TRADE),
      'the START engine button does not send {armed:true} — the fix would break the real control');
  },

  // Stopping must never be harder than starting.
  async disarmingIsNotMadeHarder() {
    assert.ok(/post\('api\/pilot\/disarm'\)/.test(TRADE),
      'disarm now needs an argument — the safe direction must stay the easy one');
  },

  // Its declared twin has always had this guard; the difference was an oversight.
  async theStopControlIsGuardedLikeItsTwin() {
    assert.ok(/app\.post\('\/api\/pilot\/stop-apply', csrfGuard/.test(SERVER),
      'stop-apply has no cross-site guard while margin-floor does');
    assert.ok(/app\.post\('\/api\/pilot\/margin-floor', csrfGuard/.test(SERVER),
      'margin-floor lost its guard');
  },

  // "No stop" and "you did not say" are different answers, and only one of them
  // is a decision the owner made.
  async clearingTheStopMustBeSaidOutLoud() {
    const h = handler('/api/pilot/stop-apply');
    assert.ok(/hasOwnProperty\.call\(req\.body, 'stopPct'\)/.test(h),
      'an absent stopPct is no longer distinguished from an explicit null');
  },

  // And the button that clears it must still send the explicit null, or the
  // owner loses the ability to choose no stop at all.
  async theClearButtonStillSendsAnExplicitNull() {
    const CX = fs.readFileSync(path.join(ROOT, 'public', 'construct.js'), 'utf8');
    assert.ok(/applyStop\(null\)/.test(CX),
      'No stop (clear) no longer sends an explicit null, so clearing would now be refused');
  },
};
