// Three defects the runtime harness (tests/browser.js) found on 2026-08-17 by
// actually loading the Constructing tab in a browser and pressing its buttons.
// Every one of them was invisible to every static check the repo had, and two
// of them were invisible to a person too — the button changed the tab, so it
// LOOKED like it had worked.
//
// 1. draw() returned undefined while every section function it calls is async.
//    "copy settings into the form" does `draw().then(fill)`, so it threw
//    "Cannot read properties of undefined (reading 'then')" on every click and
//    filled nothing.
// 2. Tool 1's scramble run was a free-text box. Empty or mistyped, the answer
//    was a 400 saying "unknown scramble run" — the operator's job to decode.
//    The service has listed exactly the eligible runs the whole time
//    (/api/bracketlab/verdict-sources); this tab never called it.
// 3. Compare's run A / run B were the same free-text boxes with the same 400.
//
// Watched failing 2026-08-17: reverting draw() to `if (...) drawData();` fails
// everySectionIsReachableFromDrawAsAPromise; putting <input id="t1null"> back
// fails runIdsArePickedFromTheServersListNeverTyped; deleting the
// verdict-sources call fails theTabActuallyCallsTheEndpointThatFeedsThePickers.
const fs = require('fs');
const path = require('path');
const { assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
// Strip line comments before matching. A previous test in this repo passed by
// matching the very sentence that DESCRIBED the bug it was meant to forbid.
const CX = fs.readFileSync(path.join(ROOT, 'public', 'constructing.js'), 'utf8')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

function drawBody() {
  const i = CX.indexOf('\nfunction draw() {');
  assert(i >= 0, 'constructing.js no longer defines draw()');
  return CX.slice(i, CX.indexOf('\n}', i));
}

// Every section render is async, so anything that needs the section to EXIST
// before it touches it has to await draw(). A branch that calls without
// returning silently hands back undefined.
function everySectionIsReachableFromDrawAsAPromise() {
  const body = drawBody();
  const calls = [...body.matchAll(/\b(draw[A-Z]\w*)\(\)/g)].map((m) => m[0]);
  assert(calls.length >= 7, `draw() dispatches to only ${calls.length} sections — expected all 7`);
  for (const c of calls) {
    const re = new RegExp(`return\\s+${c.replace('(', '\\(').replace(')', '\\)')}`);
    assert(re.test(body), `draw() calls ${c} without returning it — draw().then(...) would throw`);
  }
}

// The one caller that actually depends on it, pinned by name so the reason the
// rule exists cannot be lost.
function copySettingsWaitsForTheSweepFormToExist() {
  assert(/draw\(\)\.then\(/.test(CX),
    'nothing awaits draw() any more — if "copy settings into the form" changed, update this test deliberately');
  const i = CX.indexOf('#bCopySettings');
  assert(i >= 0, 'the copy-settings button is gone from Boards');
  const block = CX.slice(i, i + 3000);
  assert(/draw\(\)\.then\(/.test(block),
    'copy settings no longer waits for the Sweep section to render before filling it');
}

// A run id is never typed. The server can list the runs each tool accepts, so
// offering a free-text box turns every slip into a 400 the operator must
// decode — the same complaint the owner raised about the stop tuner's target.
function runIdsArePickedFromTheServersListNeverTyped() {
  for (const id of ['t1null', 'cmpA', 'cmpB']) {
    assert(!new RegExp(`<input id="${id}"`).test(CX),
      `#${id} is a free-text box — run ids come from the server's list, not the keyboard`);
    assert(new RegExp(`<select id="${id}"`).test(CX),
      `#${id} is not a <select> — it must offer the runs the server says are eligible`);
  }
}

function theTabActuallyCallsTheEndpointThatFeedsThePickers() {
  assert(/api\/bracketlab\/verdict-sources/.test(CX),
    'constructing.js never calls verdict-sources — the pickers would be listing nothing');
  // scramble draws for Tool 1, real rows for Compare: the two filters are the
  // whole point of the endpoint, and a picker built without one offers runs the
  // tool cannot read.
  assert(/scrambleDraws\s*>\s*0/.test(CX),
    'the Tool 1 picker does not filter on scrambleDraws — it would offer runs with no null draws');
  assert(/realRows\s*>\s*0/.test(CX),
    'the Compare picker does not filter on realRows — it would offer runs with nothing to compare');
}

// Nothing is asked of the server that the page can already see is unanswerable.
function anEmptyPickerRefusesInPlainWordsInsteadOfAsking() {
  const t1 = CX.slice(CX.indexOf("if (t1) t1.onclick"), CX.indexOf("if (t1) t1.onclick") + 900);
  assert(/if \(!nullId\)/.test(t1),
    'Tool 1 posts even with no scramble run picked — the server answers 400 and the operator decodes it');
  const cmp = CX.slice(CX.indexOf("$('#cmpGo').onclick"), CX.indexOf("$('#cmpGo').onclick") + 700);
  assert(/if \(!a\)/.test(cmp),
    'Compare posts even with no run A picked — same 400, same decoding');
}

module.exports = {
  everySectionIsReachableFromDrawAsAPromise,
  copySettingsWaitsForTheSweepFormToExist,
  runIdsArePickedFromTheServersListNeverTyped,
  theTabActuallyCallsTheEndpointThatFeedsThePickers,
  anEmptyPickerRefusesInPlainWordsInsteadOfAsking,
};

// ---- Trading tab ------------------------------------------------------------
const LT = fs.readFileSync(path.join(ROOT, 'public', 'trading.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

// A RISK PARAMETER IS NEVER A LITERAL ON A SCREEN. The Setups table synthesises
// the F1 pilot's row client-side and had stopPct pinned to null, so it reported
// "no protective stop" whatever stop was actually applied — while the LIVE page
// two clicks away rendered the real one from the same fetch. fetchConfigs
// already returns the pilot; drawSetups was throwing it away (audit 2026-08-17).
//
// Watched failing 2026-08-17: restoring `stopPct:null` on that row fails this.
function theF1RowReportsTheStopThatIsActuallyApplied() {
  const i = LT.indexOf("id:'f1-pilot'");
  assert(i >= 0, 'the Setups table no longer synthesises the F1 pilot row');
  const row = LT.slice(i, i + 400);
  assert(/pilot\s*&&\s*pilot\.fixedStopPct/.test(row),
    'the F1 row hardcodes its protective stop instead of reading the applied value — a risk parameter must never be a literal on a screen');
  assert(!/stopPct\s*:\s*null\s*,/.test(row),
    'stopPct is pinned to null again on the F1 row');
  assert(/const \[\{configs, pilot\}/.test(LT),
    'drawSetups no longer destructures the pilot, so it cannot know the applied stop');
}

module.exports.theF1RowReportsTheStopThatIsActuallyApplied = theF1RowReportsTheStopThatIsActuallyApplied;

// A SECTION STARTS ONE POLL CHAIN, NOT ONE PER VISIT. drawSweep armed a poller
// on every visit and each re-armed itself against the freshly rendered element,
// so it never hit its bail-out: five visits meant five chains hitting the box
// every five seconds, forever. CLAUDE.md names this failure mode explicitly —
// never check a running job more often than it could plausibly need
// (audit 2026-08-17).
//
// Watched failing 2026-08-17: dropping the clearTimeout at the top of drawSweep,
// or re-arming with a bare setTimeout, fails this.
function everyPollingSectionCancelsItsPreviousChain() {
  for (const [fn, handle] of [['drawSweep', 'sweepPoll'], ['drawTune', 'tunePoll']]) {
    const i = CX.indexOf(`async function ${fn}(`);
    assert(i >= 0, `${fn} is gone`);
    const head = CX.slice(i, i + 200);
    assert(new RegExp(`clearTimeout\\(${handle}\\)`).test(head),
      `${fn} does not cancel its previous poll chain on redraw — visits would stack pollers`);
  }
  // and nothing re-arms without going through the handle
  const bare = [...CX.matchAll(/(\w+\s*=\s*)?setTimeout\((pollProgress|drawTune)\s*,/g)]
    .filter((m) => !/^(sweepPoll|tunePoll)\s*=\s*$/.test(m[1] || ''));
  assert.deepStrictEqual(bare.map((m) => m[0]), [],
    'a poll re-arms with a bare setTimeout — assigning the handle is what makes it cancellable');
}

// A control's authored description must survive being enabled.
function enablingAControlDoesNotEraseItsDescription() {
  const i = CX.indexOf('const off = (wrap, sel, disabled, why)');
  assert(i >= 0, 'the agree-quorum enable/disable helper is gone');
  const body = CX.slice(i, i + 500);
  assert(/dataset\.baseTitle/.test(body),
    'the helper does not remember the authored tooltip — enabling a control blanks its description');
  assert(!/title = disabled \? why : ''/.test(body),
    'the tooltip is blanked on enable again; it must be restored, not erased');
}

// The trim prompt must pre-fill a value the endpoint accepts.
function theTrimPromptPreFillsAMonthNotADay() {
  const i = CX.indexOf('class="ds-trim"');
  assert(i >= 0, 'the trim button is gone from the Data section');
  const tag = CX.slice(i, CX.indexOf('>', i));
  assert(/r\.toMonth/.test(tag),
    'trim pre-fills the day-precision "to" — the endpoint accepts YYYY-MM only, so it refused on every pair with fresh day files');
  assert(/slice\(0, 7\)/.test(tag), 'the fallback must still be trimmed to a month');
}

module.exports.everyPollingSectionCancelsItsPreviousChain = everyPollingSectionCancelsItsPreviousChain;
module.exports.enablingAControlDoesNotEraseItsDescription = enablingAControlDoesNotEraseItsDescription;
module.exports.theTrimPromptPreFillsAMonthNotADay = theTrimPromptPreFillsAMonthNotADay;
