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
  const calls = [...new Set([...body.matchAll(/\b(draw[A-Z]\w*)\(\)/g)].map((m) => m[0]))];
  assert(calls.length >= 7, `draw() dispatches to only ${calls.length} sections — expected all 7`);
  // The dispatch may be a chain of returns or one expression assigned and then
  // returned; what must hold is that the RESULT reaches the caller, so
  // draw().then(...) has a promise to attach to.
  assert(/return Promise\.resolve\(section\)|return draw[A-Z]/.test(body),
    'draw() does not return the section it rendered — draw().then(...) would throw');
  const assigned = /const section = /.test(body);
  for (const c of calls) {
    const returned = new RegExp(`return\\s+${c.replace('(', '\\(').replace(')', '\\)')}`).test(body);
    assert(assigned || returned,
      `draw() calls ${c} without returning it — draw().then(...) would throw`);
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
// The Setups table used to SYNTHESISE a row client-side for a config that was
// not a setup record at all, and the row hardcoded its protective stop to null —
// a risk parameter reported as absent while the screen two clicks away showed
// the real one. Both the row and the hazard are gone: every row on this table is
// now a real record, so there is nothing left to synthesise a stop for.
function theSetupsTableInventsNoRows() {
  assert(!/id:'f1-pilot'/.test(LT),
    'the Setups table still synthesises a row for a config that is not a setup record');
  assert(!/rows\.unshift\(/.test(LT),
    'something is still being pushed onto the Setups table that did not come from the registry');
}

module.exports.theSetupsTableInventsNoRows = theSetupsTableInventsNoRows;

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

// A DATALIST FILTERS ITS SUGGESTIONS BY WHAT IS ALREADY IN THE BOX. The campaign
// control was an <input list="campNames"> pre-filled with the CURRENT campaign,
// so opening it showed exactly the one entry that matched and every other
// campaign on the box was unreachable without clearing the field first. The
// service was offering three at the time (owner, 2026-08-18: "why does the
// campaign name drop down only contain one entry?").
//
// Watched failing 2026-08-18: restoring list="campNames" on #cxCamp fails this.
function theCampaignPickerShowsEveryCampaignNotJustTheCurrentOne() {
  assert(!/<datalist id="campNames"/.test(CX),
    'the campaign names are back in a datalist — it filters on the box\'s value, so a pre-filled box hides every other name');
  assert(!/id="cxCamp"[^>]*list=/.test(CX),
    '#cxCamp is bound to a suggestion list again — the same filtering hides the other campaigns');
  assert(/<select id="cxCampPick"/.test(CX),
    'there must be a real picker listing every campaign the service reports');
  const i = CX.indexOf('<select id="cxCampPick"');
  const block = CX.slice(i, CX.indexOf('</select>', i));
  assert(/names\.names \|\| \[\]/.test(block),
    'the picker must be fed from the service\'s own campaign list');
  assert(/cxCampPick'\)/.test(CX) && /campPick\.onchange/.test(CX),
    'picking a campaign must actually switch to it');
  // and naming a NEW campaign must still be possible
  assert(/<input id="cxCamp"/.test(CX), 'the box for naming a new campaign is gone');
}

module.exports.theCampaignPickerShowsEveryCampaignNotJustTheCurrentOne = theCampaignPickerShowsEveryCampaignNotJustTheCurrentOne;

// THE DECISION HISTORY MUST SHOW A RUN OF DAYS, NOT A PEEPHOLE. At 190px the
// panel fitted about six rows, so reading a week meant scrolling — and seeing
// the calls TOGETHER is the entire point of that panel (owner, 2026-08-18: "make
// the daily decision history scrollable window taller so we see at least 10 days
// at once").
//
// Measured in the browser, not guessed: at this font and padding a row renders
// 27px and the header 25px, so ten days plus the header needs 295px = 18.4rem.
// The floor below leaves headroom for a slightly larger row without silently
// dropping back under ten. Verified at 22rem: 12 rows fully visible.
function theDecisionHistoryShowsTenDaysAtOnce() {
  const m = LT.match(/\.scrollbox\s*\{[^}]*max-height:\s*([\d.]+)(rem|px)/);
  assert(m, 'the decision history scrollbox lost its max-height');
  const px = m[2] === 'rem' ? parseFloat(m[1]) * 16 : parseFloat(m[1]);
  const needed = 10 * 27 + 25;   // ten rows + the header, measured
  assert(px >= needed,
    `the decision history is ${Math.round(px)}px — ten days plus the header needs ${needed}px, `
    + 'so it would show fewer than the ten the panel exists to show');
}

module.exports.theDecisionHistoryShowsTenDaysAtOnce = theDecisionHistoryShowsTenDaysAtOnce;

// An outage must not render as an empty state (QC-154, owner-facing consequence).
//
// Both tabs used to fetch through a helper that swallowed failures and returned
// a fallback, so a dead endpoint, a 500 or a dropped connection produced the
// EMPTY state: "No greenlighted configs yet", "none — clean", zero open
// positions. Each of those is a specific, reassuring claim about a real-money
// engine, and an outage manufactured it silently. Absence of data and absence
// of an ANSWER must never look the same on the screen.
//
// These read both pages because the fault was symmetric across them, and both
// halves are required: recording a failure that nothing displays is not a
// warning, and a banner nothing feeds can never appear.
function anOutageBandsTheScreenInsteadOfRenderingAnEmptyState() {
  for (const [name, src] of [['constructing.js', CX], ['trading.html', LT]]) {
    assert(/THIS SCREEN IS INCOMPLETE/.test(src),
      `${name} has no outage banner — a failed read renders as "you have nothing"`);
    assert(/apiOr\s*\(/.test(src),
      `${name} does not use the failure-recording fetch helper, so nothing can raise the banner`);
    assert(/fetchFailures/.test(src),
      `${name} does not record which endpoints failed, so the banner cannot name them`);
  }
}

// The recording helper is only worth anything if the plain one REFUSES a bad
// response. If api() resolves a 500 body as data, apiOr never sees a failure
// and the banner never fires — the exact silent path this replaced.
function theFetchHelperTreatsANonOkResponseAsAFailure() {
  for (const [name, src] of [['constructing.js', CX], ['trading.html', LT]]) {
    assert(/(res|r)\.ok/.test(src) && /throw/.test(src),
      `${name}'s fetch helper does not throw on a non-2xx response, so an error body `
      + 'would be rendered as if it were data');
  }
}

module.exports.anOutageBandsTheScreenInsteadOfRenderingAnEmptyState
  = anOutageBandsTheScreenInsteadOfRenderingAnEmptyState;
module.exports.theFetchHelperTreatsANonOkResponseAsAFailure
  = theFetchHelperTreatsANonOkResponseAsAFailure;

// Prose that hardcodes a constant will lie the day the constant moves (QC-158's
// family). The FEE/LEG tooltip is what the owner reads to interpret the number
// beside it, and it spells the lab rate out in words — "0.125% of notional
// ($0.125 at $100 size)". Nothing tied those figures to REAL_FEE_PER_LEG, so a
// change to the constant would leave the explanation quietly wrong while every
// computed number moved. That is exactly the shape of the bug the owner caught:
// a fee figure that no longer describes what is being traded.
function theFeeTooltipQuotesTheConstantItIsExplaining() {
  const { REAL_FEE_PER_LEG } = require('../lib/paper');
  const ratePct = REAL_FEE_PER_LEG;            // dollars per leg at $100 == percent
  const m = LT.match(/feeModel:\s*'([^']*)'/);
  assert(m, 'the FEE/LEG: model tooltip is gone — the number has no stated meaning');
  const prose = m[1];
  assert(prose.includes(`${ratePct}%`),
    `the fee tooltip says something other than the real rate of ${ratePct}% — `
    + `REAL_FEE_PER_LEG is ${REAL_FEE_PER_LEG} and the prose reads: "${prose.slice(0, 120)}"`);
  assert(prose.includes(`$${REAL_FEE_PER_LEG} at $100`),
    `the fee tooltip's worked example does not match REAL_FEE_PER_LEG ($${REAL_FEE_PER_LEG} at $100 size)`);
}

module.exports.theFeeTooltipQuotesTheConstantItIsExplaining
  = theFeeTooltipQuotesTheConstantItIsExplaining;

// The custom-stop box must not offer a value the engine's floor refuses.
//
// The server has enforced MIN_STOP_PCT = 0.005 since the 2026-08-11 review and
// returns a clear 400, so nothing ever silently succeeded — but the input
// advertised min="0.1" (percent), so the spinner walked the operator down to a
// value that could only ever be rejected, and the refusal arrived only after a
// round trip. QC-145's rule: where the page can answer, the page answers.
//
// This ties the three statements of the floor together — the input's min, the
// page's own refusal, and the server constant — so they cannot drift apart. The
// input and the refusal are in PERCENT; the server constant is a FRACTION.
function theCustomStopBoxOffersNothingTheEngineFloorRefuses() {
  const fs2 = require('fs');
  const path2 = require('path');
  const SRV = fs2.readFileSync(path2.join(ROOT, 'server.js'), 'utf8');
  const m = SRV.match(/const MIN_STOP_PCT = ([\d.]+)/);
  assert(m, 'the server no longer declares MIN_STOP_PCT — the floor has no single source');
  const floorPct = Number(m[1]) * 100;

  const inp = CX.match(/id="stopCustomPct"[^>]*min="([\d.]+)"/);
  assert(inp, 'the custom-stop input lost its min — the box would offer any value at all');
  assert(Number(inp[1]) === floorPct,
    `the custom-stop box offers down to ${inp[1]}% while the engine floor is ${floorPct}% — `
    + 'it advertises a value the backend can only refuse');

  assert(new RegExp(`v < ${floorPct}`).test(CX),
    `the page does not refuse below ${floorPct}% itself, so the operator learns the floor only `
    + 'from a failed round trip');
}

module.exports.theCustomStopBoxOffersNothingTheEngineFloorRefuses
  = theCustomStopBoxOffersNothingTheEngineFloorRefuses;

// "View tree" must read the campaign the user JUST picked (owner, 2026-08-18).
//
// The dropdown's onchange POSTed, awaited, then re-rendered — and only the
// re-render put the new name into #cxCamp, which is the box View tree reads.
// A click inside that window fetched the PREVIOUS campaign's tree: a wrong
// answer wearing the clothes of a right one, because the tree renders fine and
// nothing says it is the wrong campaign's. The pick is now reflected into the
// box synchronously, before the await, and the buttons are disabled while the
// switch is in flight so the panel cannot be acted on mid-change.
function theCampaignPickReachesViewTreeBeforeTheRoundTripFinishes() {
  const h = CX.match(/campPick\.onchange\s*=\s*async[\s\S]{0,1400}?\n  \};/);
  assert(h, 'the campaign picker lost its change handler');
  const body = h[0];
  const assignAt = body.indexOf("$('#cxCamp').value = campPick.value");
  const awaitAt = body.indexOf('await tryPost');
  assert(assignAt !== -1,
    'the pick is not copied into #cxCamp, so View tree still reads the old campaign');
  assert(awaitAt !== -1 && assignAt < awaitAt,
    'the pick is copied into #cxCamp only AFTER the await — that is the race, not a fix');
  assert(/tree\.disabled = true/.test(body),
    'View tree is not disabled while the campaign switch is in flight');
}

// F1 must be reachable on the scan target whatever Boards has selected.
//
// The list used to open with a single context-dependent entry that meant F1
// only when no row was selected, and nothing in the tab clears a run's stored
// selection — so with a row selected there was NO path to the live pilot, and
// tuning its protective stop could not be done from the screen at all.
function theLivePilotIsAlwaysOnTheScanTargetList() {
  assert(/<option value="F1"/.test(CX),
    'there is no explicit F1 option — the live pilot is only reachable by accident');
  assert(!/F1 \(no board row selected\)/.test(CX),
    'the context-dependent "F1 (no board row selected)" label is back: that entry means F1 '
    + 'only when nothing is selected, which is exactly what made F1 unreachable');
  // the selected-row option may only exist when a row IS selected
  const opt = CX.match(/\$\{sel \? `<option value="sel"/);
  assert(opt, 'the selected-row option is not gated on a row actually being selected');
}

// The launcher and the sentence describing it must resolve the SAME target.
function theScanTargetProseMatchesWhatTheLauncherWillUse() {
  assert(/const tgt = /.test(CX), 'the resolved scan target is gone');
  assert(/const scanBody = tgt === 'F1'/.test(CX),
    'the launcher no longer derives its body from the resolved target');
  assert(/const target = tgt === 'sel'/.test(CX),
    'the prose no longer derives from the resolved target, so it can describe a different '
    + 'target from the one the scan will actually use');
  assert(/savedTarget === 'sel' && !sel/.test(CX),
    'a stored "sel" preference with nothing selected no longer falls back to F1');
}

module.exports.theCampaignPickReachesViewTreeBeforeTheRoundTripFinishes
  = theCampaignPickReachesViewTreeBeforeTheRoundTripFinishes;
module.exports.theLivePilotIsAlwaysOnTheScanTargetList
  = theLivePilotIsAlwaysOnTheScanTargetList;
module.exports.theScanTargetProseMatchesWhatTheLauncherWillUse
  = theScanTargetProseMatchesWhatTheLauncherWillUse;
