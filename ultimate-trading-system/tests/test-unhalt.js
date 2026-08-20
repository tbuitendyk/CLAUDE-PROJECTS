// "Clear the halt" must actually clear the halt (owner, 2026-08-19: "I've been
// pressing the button to clear the halt state").
//
// THE DEFECT, in three parts:
//
//  1. CADENCE vs FRESHNESS. The box accepts an unhalt request for 900 seconds
//     (ARM_REQUEST_FRESH_S). The per-profile request was carried by
//     live-produce-and-push.sh, which runs ONCE AN HOUR on live-tick.timer. So
//     the window could only be met if the owner happened to press in the ~7
//     minutes before the tick. Proven in the box journal: UNHALT_STALE_REQUEST,
//     age_s 2567 — 43 minutes — against a 900-second limit. The BOX-LEVEL clear
//     never had this problem because it rides the 5-minute sync. The per-profile
//     one was simply put in the wrong script.
//
//  2. A REFUSAL LOOKED LIKE A DELIVERY. mx_executor.py returned 0 whatever
//     happened, and the carry deleted the request whenever ssh exited 0 — so
//     each press was consumed by its own failure.
//
//  3. SILENCE. Nothing on screen ever said the clear had been refused, so the
//     only available response was to press it again.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'trade.html'), 'utf8');
const ROUTES = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'routes.js'), 'utf8');

function theSignedPayloadCoversTheSetup() {
  // A clear minted for one profile must not lift another's.
  assert.ok(/unhalt\|\$\{s\.id\}\|\$\{nonce\}\|\$\{utc\}/.test(ROUTES),
    'the unhalt signature no longer covers setup id, nonce AND utc in that order — '
    + 'it must match the executor byte for byte or every clear is refused as unsigned');
}

function aPressReportsWhatHappenedToIt() {
  assert.ok(/unhaltPending/.test(ROUTES) && /unhaltRefused/.test(ROUTES),
    'the status route does not report whether a clear is waiting or was refused, '
    + 'so a rejected press is invisible and the only response is to press again');
  assert.ok(/Your last press was REFUSED by the box/.test(HTML),
    'the screen never tells the owner their clear was refused');
  assert.ok(/A clear is written and waiting for the box to collect it/.test(HTML),
    'the screen does not show a clear as pending');
}

function aFreshPressSupersedesAnOldRefusal() {
  const handler = ROUTES.match(/setups\/:id\/unhalt'[\s\S]{0,1600}?\n  \}\);/)[0];
  assert.ok(/unlinkSync\(path\.join\(dir, `\$\{s\.id\}\.refused\.json`\)\)/.test(handler),
    'pressing again leaves the old refusal marker, so the screen shows a refusal '
    + 'and a pending request at once with no way to tell which is current');
}

function theScreenNoLongerPromisesACadenceItDoesNotHave() {
  assert.ok(!/carries it on its next sync \(a few minutes\)/.test(HTML),
    'the screen still promises "a few minutes" — that wording described the box-level '
    + 'carry and was inherited by a control that ran hourly, so it stated something impossible');
  assert.ok(/within about 5 minutes/.test(HTML),
    'the screen does not tell the owner how long to expect to wait');
}

function aFailedRequestSaysSoRatherThanNothing() {
  assert.ok(/the request could not be written — nothing was sent/.test(HTML),
    'a request that could not even be written clears the message area, which looks '
    + 'identical to a successful press');
}

module.exports = {
  theSignedPayloadCoversTheSetup,
  aPressReportsWhatHappenedToIt,
  aFreshPressSupersedesAnOldRefusal,
  theScreenNoLongerPromisesACadenceItDoesNotHave,
  aFailedRequestSaysSoRatherThanNothing,
};
