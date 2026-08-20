// Margin level, and naming a trade by WHEN IT OPENED (owner, 2026-08-19).
//
// Two owner findings, tested together because they share a rule: whatever the
// Live Trading screens show, the Paper Books screens must show too (RULE TWO).
// The two are rendered by separate duplicated code paths, so a fix landing in
// one and not the other leaves two screens describing the same system and
// disagreeing — which is exactly how both of these defects survived.
//
// 1. MARGIN LEVEL. "i don't see the margin level anywhere on the screen. why
//    would you choose to hide that from me?" Nothing hid it: the executor had
//    it in every account response it fetched, journaled four fields off that
//    object and dropped this one, so the screen was never given it and nothing
//    gated on it. On a borrow-to-short engine that is the distance to a forced
//    liquidation.
//
// 2. ENTRY DATES. "do not use the window days with CHUNK. that's not how humans
//    think. use ENTRY and entry dates." The tables led with the feature
//    window's start, which is 97h before anything happens — so a position
//    bought on the 18th was listed as the 14th.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const boxview = require(path.join(ROOT, 'lib', 'boxview'));
const liveview = require(path.join(ROOT, 'lib', 'live', 'view'));
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'trade.html'), 'utf8');

// ---- margin level reaches both views ----------------------------------------

function theBoxViewCarriesMarginLevelAndFloor() {
  const d = boxview.derive([
    { event: 'RUN_STATUS', utc: '2026-08-19T04:00:00Z', armed: true, halted: false, margin_floor: 2.5 },
    { event: 'BALANCE', utc: '2026-08-19T04:00:01Z', base_net: -0.4, base_free: 0,
      quote_free: 219.5, quote_net: 219.5, margin_level: 11.03 },
  ]);
  assert.strictEqual(d.walletBalance.marginLevel, 11.03,
    'the box view drops margin_level — the screen cannot show what it is not given');
  assert.strictEqual(d.marginFloor, 2.5,
    'the box view drops the floor the box reports it is enforcing');
}

function aJournalWithoutMarginLevelStillReadsCleanly() {
  // Every BALANCE line written before 2026-08-19 lacks the field. It must come
  // back null, never NaN and never 0 — 0 would render as a liquidation.
  const d = boxview.derive([
    { event: 'BALANCE', utc: '2026-08-18T04:00:00Z', base_net: -0.4, base_free: 0,
      quote_free: 219.5, quote_net: 219.5 },
  ]);
  assert.strictEqual(d.walletBalance.marginLevel, null,
    'an old BALANCE line must yield null, not a number that reads as danger');
}

function theSetupViewCarriesTheSameMarginFacts() {
  // Box-level events carry no setup_id; the setup view must still pick them up,
  // or Live Trading shows a margin level and the setup screens show nothing.
  const st = liveview.deriveSetup([
    { event: 'RUN_STATUS', utc: '2026-08-19T04:00:00Z', margin_floor: 2.5 },
    { event: 'BALANCE', utc: '2026-08-19T04:00:01Z', margin_level: 11.03 },
  ], 'setup-x');
  assert.ok(st.walletBalance && st.walletBalance.marginLevel === 11.03,
    'the setup view ignores margin_level, so its screen disagrees with LIVE (RULE TWO)');
  assert.strictEqual(st.marginFloor, 2.5, 'the setup view drops the enforced floor');
}

// ---- entry times reach the closed rows on BOTH paths -------------------------

function setupClosedRowsCarryTheEntryTimeToo() {
  const st = liveview.deriveSetup([
    { event: 'ENTRY_FILL', setup_id: 's1', utc: '2026-08-18T01:10:03Z',
      chunk_start: '2026-08-14T00:00:00.000Z', side: 'SHORT', qty: 0.2, price: 44.57 },
    { event: 'EXIT_FILL', setup_id: 's1', utc: '2026-08-19T18:00:00Z',
      chunk_start: '2026-08-14T00:00:00.000Z', side: 'SHORT', price: 44.10, pnl: 0.1 },
  ], 's1');
  assert.strictEqual(st.closedRecent[0].entry_utc, '2026-08-18T01:10:03Z',
    'the setup path lost entry_utc on close — the two screens would disagree');
}

function paperClosedRowsCarryTheEntryTimeToo() {
  const st = liveview.deriveSetup([
    { event: 'PAPER_ENTRY_FILL', setup_id: 's1', utc: '2026-08-18T01:10:03Z',
      chunk_start: '2026-08-14T00:00:00.000Z', side: 'SHORT', qty: 0.2, price: 44.57 },
    { event: 'PAPER_EXIT_FILL', setup_id: 's1', utc: '2026-08-19T18:00:00Z',
      chunk_start: '2026-08-14T00:00:00.000Z', side: 'SHORT', price: 44.10, pnl: 0.1 },
  ], 's1');
  assert.strictEqual(st.closedRecent[0].entry_utc, '2026-08-18T01:10:03Z',
    'the PAPER book lost entry_utc — Paper Books and Live Trading must not drift');
}

// ---- the screen itself -------------------------------------------------------

function noPositionTableIsStillHeadedByTheWindow() {
  assert.ok(!/th\('chunk','chunk'\)/.test(HTML),
    'a table still leads with the feature window, which is not the day anything happened');
  // Two tables now, not four: the duplicate screen for the one hardcoded config
  // is gone, so open positions and recent closed are each rendered exactly once.
  const cells = HTML.match(/entryCell\(/g) || [];
  assert.ok(cells.length >= 2,
    `both position tables must use the shared entry cell; found ${cells.length}`);
}

function theEntryCellNeverInventsAFillTime() {
  // A position filled before entry_utc was recorded has no entry time. Falling
  // back to the window would print a date that is wrong by four days.
  assert.ok(/no fill time recorded/.test(HTML),
    'the entry cell has no honest empty state, so it will show the window as if it were the fill');
}

function bothSwitchButtonsAreHeldWhileARequestIsInFlight() {
  // The old predicates were `armed && !armPending` and `!armed && !armPending`,
  // which unlock BOTH buttons whenever a request is pending — the owner watched
  // exactly that and said it "doesn't make any sense".
  assert.ok(/id="btnStart" \$\{b\.armed\|\|b\.armPending\?'disabled':''\}/.test(HTML),
    'START is not held while a request is in flight');
  assert.ok(/id="btnStop" \$\{!b\.armed\|\|b\.armPending\?'disabled':''\}/.test(HTML),
    'STOP is not held while a request is in flight');
  assert.ok(!/armed&&!\w+\.armPending\?'disabled':''/.test(HTML),
    'the old both-buttons-live predicate is still present');
}

function pressingTheSwitchSaysSomethingHappened() {
  // A successful press and a press that did nothing looked identical for the
  // ~5 minutes until the box collected the request.
  assert.ok(/Waiting on the box/.test(HTML),
    'START/STOP still give no feedback, so a press that worked looks like one that failed');
}

// ---- the floor must be VISIBLE the moment it is set -------------------------

function theFloorIsReportedEvenWhenTheLevelIsUnknown() {
  // The first version returned early on a null level and never mentioned the
  // floor, so the owner set one and the status line said only "not recorded
  // yet" — their setting appeared to vanish.
  const src = HTML.match(/const marginCell=[\s\S]*?\n};/)[0];
  assert.ok(!/if\(lvl==null\)\s*return/.test(src),
    'marginCell still returns early on an unknown level, hiding the floor with it');
  assert.ok(/not recorded yet/.test(src) && /no floor set/.test(src),
    'marginCell must be able to report an unknown level AND the floor state together');
}

function aSavedFloorShowsAsPendingUntilTheBoxConfirms() {
  const src = HTML.match(/const marginCell=[\s\S]*?\n};/)[0];
  assert.ok(/saved, waiting on the box/.test(src),
    'a floor the box has not yet picked up reads as "no floor set", which is the opposite of the truth');
  assert.ok(/marginFloorRequested/.test(HTML),
    'the screen never receives the floor the owner requested, so it cannot show it pending');
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(/marginFloorRequested: readMarginFloor\(\)/.test(server),
    '/api/pilot does not expose the requested floor');
  const routes = fs.readFileSync(path.join(ROOT, 'lib', 'live', 'routes.js'), 'utf8');
  assert.ok(/marginFloorRequested/.test(routes),
    'the setup status route omits the requested floor, so the two screens disagree (RULE TWO)');
}

// ---- RULE FOUR: controls line up, and never style against a phantom class ----

function noControlStylesAgainstAClassThatDoesNotExist() {
  // The "Set the floor" button sat wrong because it used class="f" and there is
  // no .f rule in the stylesheet. Catch that shape generally rather than the one
  // instance: every class used in the markup must be defined or be a known
  // framework/state class set from script.
  const KNOWN = new Set(['row', 'spacer', 'muted', 'pos', 'neg', 'warn', 'tabs', 'tab', 'on',
    'panel', 'tile', 'k', 'v', 'grid', 'badge', 'b-paper', 'b-live', 'b-stopped', 'b-idle',
    'pri', 'danger', 'themebtn', 'sub', 'empty', 'clickable', 'banner', 'halted', 'stopped',
    'running', 'switch', 'master', 'start', 'stop', 'f1', 'branch']);
  const used = new Set();
  for (const m of HTML.matchAll(/class="([^"$]+)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) used.add(c);
  }
  const undefinedClasses = [...used].filter((c) => !KNOWN.has(c) && !new RegExp(`\\.${c}\\b[^;]*\\{`).test(HTML));
  assert.deepStrictEqual(undefinedClasses, [],
    `these classes are styled against but never defined: ${undefinedClasses.join(', ')}`);
}

function theFloorControlAlignsLikeEveryOtherControl() {
  const block = HTML.match(/<button id="mfSet">[\s\S]{0,400}/)[0];
  assert.ok(!/align-items:flex-end/.test(HTML.slice(HTML.indexOf('Margin floor'), HTML.indexOf('<button id="mfSet">'))),
    'the floor control overrides the row alignment, putting the button off its label baseline');
  const label = HTML.match(/<label[^>]*>margin floor[\s\S]{0,300}?<\/label>/);
  assert.ok(label && /class="muted"/.test(label[0]),
    'the floor control does not use the same label pattern as the other controls on this page');
  assert.ok(block.length > 0, 'the Set the floor button is missing');
}

function theOwnerSetsTheFloorAndNoDefaultIsInvented() {
  assert.ok(/api\/pilot\/margin-floor/.test(HTML),
    'there is no control for the owner to set the floor');
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(/floor: null/.test(server),
    'the margin floor must default to none — a threshold nobody chose must not start braking');
}

module.exports = {
  theBoxViewCarriesMarginLevelAndFloor,
  aJournalWithoutMarginLevelStillReadsCleanly,
  theSetupViewCarriesTheSameMarginFacts,
  setupClosedRowsCarryTheEntryTimeToo,
  paperClosedRowsCarryTheEntryTimeToo,
  noPositionTableIsStillHeadedByTheWindow,
  theEntryCellNeverInventsAFillTime,
  bothSwitchButtonsAreHeldWhileARequestIsInFlight,
  pressingTheSwitchSaysSomethingHappened,
  theOwnerSetsTheFloorAndNoDefaultIsInvented,
  theFloorIsReportedEvenWhenTheLevelIsUnknown,
  aSavedFloorShowsAsPendingUntilTheBoxConfirms,
  noControlStylesAgainstAClassThatDoesNotExist,
  theFloorControlAlignsLikeEveryOtherControl,
};
