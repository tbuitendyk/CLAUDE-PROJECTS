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
const pilotview = require(path.join(ROOT, 'lib', 'pilotview'));
const liveview = require(path.join(ROOT, 'lib', 'live', 'view'));
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'trading.html'), 'utf8');

// ---- margin level reaches both views ----------------------------------------

function thePilotViewCarriesMarginLevelAndFloor() {
  const d = pilotview.derive([
    { event: 'RUN_STATUS', utc: '2026-08-19T04:00:00Z', armed: true, halted: false, margin_floor: 2.5 },
    { event: 'BALANCE', utc: '2026-08-19T04:00:01Z', base_net: -0.4, base_free: 0,
      quote_free: 219.5, quote_net: 219.5, margin_level: 11.03 },
  ]);
  assert.strictEqual(d.walletBalance.marginLevel, 11.03,
    'the pilot view drops margin_level — the screen cannot show what it is not given');
  assert.strictEqual(d.marginFloor, 2.5,
    'the pilot view drops the floor the box reports it is enforcing');
}

function aJournalWithoutMarginLevelStillReadsCleanly() {
  // Every BALANCE line written before 2026-08-19 lacks the field. It must come
  // back null, never NaN and never 0 — 0 would render as a liquidation.
  const d = pilotview.derive([
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

function pilotClosedRowsCarryTheEntryTime() {
  const d = pilotview.derive([
    { event: 'ENTRY_FILL', utc: '2026-08-18T01:10:03Z', chunk_start: '2026-08-14T00:00:00.000Z',
      side: 'SHORT', qty: 0.224, price: 44.57, exit_due_ts: 1787508602 },
    { event: 'EXIT_FILL', utc: '2026-08-19T18:00:00Z', chunk_start: '2026-08-14T00:00:00.000Z',
      side: 'SHORT', price: 44.10, pnl: 0.1 },
  ]);
  const row = d.closedRecent[0];
  assert.strictEqual(row.entry_utc, '2026-08-18T01:10:03Z',
    'a closed row has no entry time, so the screen can only name it by its window');
}

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
  const cells = HTML.match(/entryCell\(/g) || [];
  assert.ok(cells.length >= 4,
    `all four position tables must use the shared entry cell; found ${cells.length}`);
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
  assert.ok(/id="btnStart" \$\{d\.armed\|\|d\.armPending\?'disabled':''\}/.test(HTML),
    'START is not held while a request is in flight');
  assert.ok(/id="btnStop" \$\{!d\.armed\|\|d\.armPending\?'disabled':''\}/.test(HTML),
    'STOP is not held while a request is in flight');
  assert.ok(!/\$\{d\.armed&&!d\.armPending\?'disabled':''\}/.test(HTML),
    'the old both-buttons-live predicate is still present');
}

function pressingTheSwitchSaysSomethingHappened() {
  // A successful press and a press that did nothing looked identical for the
  // ~5 minutes until the box collected the request.
  assert.ok(/Waiting on the box/.test(HTML),
    'START/STOP still give no feedback, so a press that worked looks like one that failed');
}

function theOwnerSetsTheFloorAndNoDefaultIsInvented() {
  assert.ok(/api\/pilot\/margin-floor/.test(HTML),
    'there is no control for the owner to set the floor');
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(/floor: null/.test(server),
    'the margin floor must default to none — a threshold nobody chose must not start braking');
}

module.exports = {
  thePilotViewCarriesMarginLevelAndFloor,
  aJournalWithoutMarginLevelStillReadsCleanly,
  theSetupViewCarriesTheSameMarginFacts,
  pilotClosedRowsCarryTheEntryTime,
  setupClosedRowsCarryTheEntryTimeToo,
  paperClosedRowsCarryTheEntryTimeToo,
  noPositionTableIsStillHeadedByTheWindow,
  theEntryCellNeverInventsAFillTime,
  bothSwitchButtonsAreHeldWhileARequestIsInFlight,
  pressingTheSwitchSaysSomethingHappened,
  theOwnerSetsTheFloorAndNoDefaultIsInvented,
};
