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
