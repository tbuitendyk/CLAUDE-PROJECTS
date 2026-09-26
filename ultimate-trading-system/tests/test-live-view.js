// Per-setup view + fidelity (plan phase 6): synthetic box journals feed the
// derivation; real and paper ledgers stay separate; fidelity aggregates the
// numbers the pilot exists to measure.
const { assert } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');

const view = require('../lib/live/view');

function withJournal(events, fn) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gc-live-j-')), 'journal.jsonl');
  fs.writeFileSync(f, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return fn(f);
}

module.exports.realBookDerivesOpenClosedAndRealized = function () {
  withJournal([
    { event: 'ENTRY_FILL', setup_id: 'a', chunk_start: 'c1', side: 'LONG', qty: 0.2, price: 100, fee_quote: 0.01, fill_deviation: 0.001, exit_due_ts: 2e9 },
    { event: 'PNL_MTM', price: 105 },
    { event: 'ENTRY_FILL', setup_id: 'a', chunk_start: 'c2', side: 'LONG', qty: 0.2, price: 100, fee_quote: 0.01, fill_deviation: 0.002, exit_due_ts: 3e9 },
    { event: 'EXIT_FILL', setup_id: 'a', chunk_start: 'c1', side: 'LONG', qty: 0.2, price: 110, fee_quote: 0.01, pnl: 1.98 },
  ], (f) => {
    const b = view.deriveSetup(view.readJournal(f).events, 'a');
    assert.strictEqual(b.openPositions.length, 1, 'c2 still open, c1 closed');
    assert.strictEqual(b.openPositions[0].chunk_start, 'c2');
    assert.ok(Math.abs(b.realizedPnl - 1.98) < 1e-9);
    assert.strictEqual(b.markPrice, 105);
    // unrealized on the open c2: (105-100)*0.2 = 1.0
    assert.ok(Math.abs(b.unrealizedPnl - 1.0) < 1e-9);
    assert.strictEqual(b.fidelity.fills, 2, 'both entries counted for fidelity');
    assert.ok(Math.abs(b.fidelity.fillDeviationAvg - 0.0015) < 1e-9);
  });
};

module.exports.paperAndRealLedgersNeverMix = function () {
  withJournal([
    { event: 'ENTRY_FILL', setup_id: 'real', chunk_start: 'r1', side: 'LONG', qty: 0.2, price: 100, exit_due_ts: 2e9 },
    { event: 'EXIT_FILL', setup_id: 'real', chunk_start: 'r1', side: 'LONG', qty: 0.2, price: 110, pnl: 2.0 },
    { event: 'PAPER_ENTRY_FILL', setup_id: 'pap', chunk_start: 'p1', side: 'LONG', qty: 0.2, price: 100, exit_due_ts: 2e9 },
    { event: 'PAPER_EXIT_FILL', setup_id: 'pap', chunk_start: 'p1', side: 'LONG', qty: 0.2, price: 90, pnl: -2.05 },
  ], (f) => {
    const ev = view.readJournal(f).events;
    const real = view.deriveSetup(ev, 'real');
    const pap = view.deriveSetup(ev, 'pap');
    assert.ok(Math.abs(real.realizedPnl - 2.0) < 1e-9);
    assert.strictEqual(real.paperRealizedPnl, 0, 'a real setup has no paper P&L');
    assert.ok(Math.abs(pap.paperRealizedPnl - (-2.05)) < 1e-9);
    assert.strictEqual(pap.realizedPnl, 0, 'a paper setup never books real P&L');
    assert.ok(pap.closedRecent[0].paper === true);
  });
};

module.exports.paperAndRealUnrealizedAreSeparate = function () {
  // R9: after a paper->live transition a setup can hold BOTH books open at once.
  // The summary must keep real unrealized and paper unrealized SEPARATE (as
  // realized already is) — never one mixed number of real + fictional money.
  withJournal([
    { event: 'ENTRY_FILL', setup_id: 'm', chunk_start: 'r1', side: 'LONG', qty: 0.2, price: 100, exit_due_ts: 2e9 },
    { event: 'PAPER_ENTRY_FILL', setup_id: 'm', chunk_start: 'p1', side: 'LONG', qty: 0.4, price: 100, exit_due_ts: 3e9 },
    { event: 'PNL_MTM', price: 110 },
  ], (f) => {
    const b = view.deriveSetup(view.readJournal(f).events, 'm');
    // real open r1: (110-100)*0.2 = 2.0 ; paper open p1: (110-100)*0.4 = 4.0
    assert.ok(Math.abs(b.unrealizedPnl - 2.0) < 1e-9, `real unrealized 2.0, got ${b.unrealizedPnl}`);
    assert.ok(Math.abs(b.paperUnrealizedPnl - 4.0) < 1e-9, `paper unrealized 4.0, got ${b.paperUnrealizedPnl}`);
    assert.strictEqual(b.openPositions.length, 2, 'both books listed');
    assert.strictEqual(b.openPositions.filter((p) => p.paper).length, 1, 'one badged paper');
  });
};

module.exports.fidelityCountsOnlyRealNonRecoveredFills = function () {
  // R16: execution fidelity measures REAL, non-recovered fills vs their decision
  // price. A recovered fill fabricates deviation 0.0 (decision price lost in the
  // crash) and a paper fill is the lab twin — neither belongs in the real average.
  withJournal([
    { event: 'ENTRY_FILL', setup_id: 'f', chunk_start: 'c1', side: 'LONG', qty: 0.2, price: 100, fill_deviation: 0.01, exit_due_ts: 2e9 },
    { event: 'ENTRY_FILL', setup_id: 'f', chunk_start: 'c2', side: 'LONG', qty: 0.2, price: 100, fill_deviation: 0.0, recovered: true, exit_due_ts: 3e9 },
    { event: 'PAPER_ENTRY_FILL', setup_id: 'f', chunk_start: 'p1', side: 'LONG', qty: 0.2, price: 100, fill_deviation: 0.02, exit_due_ts: 4e9 },
  ], (f) => {
    const b = view.deriveSetup(view.readJournal(f).events, 'f');
    assert.strictEqual(b.fidelity.fills, 1, 'only the real non-recovered fill counts for real fidelity');
    assert.ok(Math.abs(b.fidelity.fillDeviationAvg - 0.01) < 1e-9, 'real 0.01, not diluted by a fabricated 0.0');
    assert.strictEqual(b.fidelity.recoveredFills, 1, 'recovered fill counted separately');
    assert.strictEqual(b.fidelity.paperFills, 1, 'paper fill counted separately');
    assert.ok(Math.abs(b.fidelity.paperFillDeviationAvg - 0.02) < 1e-9, 'paper deviation in its own bucket');
  });
};

module.exports.eventsOfOtherSetupsAreIgnored = function () {
  withJournal([
    { event: 'ENTRY_FILL', setup_id: 'a', chunk_start: 'c1', side: 'LONG', qty: 0.2, price: 100, exit_due_ts: 2e9 },
    { event: 'ENTRY_FILL', setup_id: 'b', chunk_start: 'c1', side: 'SHORT', qty: 0.2, price: 100, exit_due_ts: 2e9 },
  ], (f) => {
    const b = view.deriveSetup(view.readJournal(f).events, 'a');
    assert.strictEqual(b.openPositions.length, 1);
    assert.strictEqual(b.openPositions[0].side, 'LONG', 'only this setup\'s position');
  });
};

module.exports.setupStatusMergesRegistryAndBook = function () {
  withJournal([
    { event: 'ENTRY_FILL', setup_id: 's9', chunk_start: 'c1', side: 'LONG', qty: 0.2, price: 100, exit_due_ts: 2e9 },
    { event: 'PNL_MTM', price: 101 },
  ], (f) => {
    const st = view.setupStatus(
      { id: 's9', name: 'nine', state: 'paper', tradedPair: 'LTCUSDT', clipUsd: 20, stopPct: null }, f);
    assert.strictEqual(st.name, 'nine');
    assert.strictEqual(st.paper, true, 'state=paper -> paper flag');
    assert.strictEqual(st.markPrice, 101);
    assert.strictEqual(st.openPositions.length, 1);
    assert.strictEqual(st.journalPresent, true);
  });
};

module.exports.absentJournalIsAStateNotAnError = function () {
  const st = view.setupStatus({ id: 'x', name: 'x', state: 'draft', tradedPair: 'LTCUSDT', clipUsd: 10, stopPct: null },
    '/nonexistent/journal.jsonl');
  assert.strictEqual(st.journalPresent, false);
  assert.strictEqual(st.openPositions.length, 0);
  assert.strictEqual(st.realizedPnl, 0);
};

// THE MERGED LIST HAS TO BE UNMERGED BEFORE IT IS SHOWN. deriveSetup keeps real
// and paper money separate — that is R9, above — and then returns ONE
// openPositions array carrying a per-row paper flag. Every consumer that shows a
// count or a table alongside a branch-selected P&L has to filter it, and none of
// them did: the Trading tab's detail page, its Dashboard cards, and the channel
// summary in lib/live/routes.js all counted both books. On a setup that has
// legally gone paper -> live, the count and the money above it disagreed, with
// fictional positions listed under a real-money heading (audit 2026-08-17).
//
// Watched failing 2026-08-17: dropping any one of the three filters makes its
// own assertion below report 2 where the side has 1.
module.exports.everyConsumerOfTheMergedListFiltersItToOneBook = function () {
  const fs2 = require('fs');
  const path2 = require('path');
  const ROOT2 = path2.join(__dirname, '..');
  const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const LT = strip(fs2.readFileSync(path2.join(ROOT2, 'public', 'trade.html'), 'utf8'));
  const RT = strip(fs2.readFileSync(path2.join(ROOT2, 'lib', 'live', 'routes.js'), 'utf8'));

  const flat = LT.replace(/\s/g, '');
  assert.ok(flat.includes('openHere=(st.openPositions||[]).filter(p=>isP?p.paper:!p.paper)'),
    'the setup detail page no longer filters the merged position list to this side\'s book');
  assert.ok(!/st\.openPositions\.length/.test(LT),
    'something reads the MERGED length again — it must read the filtered list');
  // The Dashboard's filter moved into dashTotals when that was lifted out of the
  // render (QC-162), so it reads isPaper rather than isP. The SOURCE check below
  // only guards against the money being inlined back into drawDash, where no test
  // can execute it; the real guard is now tests/test-dashtotals.js, which RUNS
  // this function against a setup holding both books at once and asserts neither
  // side ever reports the other's money. That is strictly stronger than a grep —
  // the grep was green the whole time the browser check could not discriminate.
  assert.ok(flat.includes('filter(p=>isPaper?p.paper:!p.paper)'),
    'the Dashboard card counts both books again');
  assert.ok(!/g\.f1/.test(LT),
    'a config is being special-cased on the Trading tab again — every config is the same kind now');
  assert.ok(/function dashTotals\(/.test(LT),
    'dashTotals was inlined back into the render, which puts the Dashboard money beyond '
    + 'the reach of test-dashtotals.js — the only test that can tell the two books apart');
  assert.ok(/c === 'paper' \? !!p\.paper : !p\.paper/.test(RT),
    'the channel summary counts both books again — a paper channel would report the real channel\'s open positions');
};

// And the behaviour the filters exist for, on a real derived book.
module.exports.aSetupHoldingBothBooksReportsOnePositionPerSide = function () {
  withJournal([
    { event: 'ENTRY_FILL', setup_id: 'both', chunk_start: 'r1', side: 'LONG', qty: 0.2, price: 100, exit_due_ts: 2e9 },
    { event: 'PAPER_ENTRY_FILL', setup_id: 'both', chunk_start: 'p1', side: 'SHORT', qty: 0.4, price: 100, exit_due_ts: 3e9 },
    { event: 'PNL_MTM', price: 110 },
  ], (f) => {
    const b = view.deriveSetup(view.readJournal(f).events, 'both');
    const real = b.openPositions.filter((p) => !p.paper);
    const paper = b.openPositions.filter((p) => p.paper);
    assert.strictEqual(real.length, 1, 'the real side holds exactly one position');
    assert.strictEqual(paper.length, 1, 'the paper side holds exactly one position');
    assert.strictEqual(b.openPositions.length, 2,
      'the merged list still carries both — the filtering is the consumer\'s job, and this is why');
    assert.strictEqual(real[0].side, 'LONG');
    assert.strictEqual(paper[0].side, 'SHORT');
  });
};

// THE INCIDENTS PANEL MUST SEE WHAT THE EXECUTOR REPORTS. It surfaced four
// event kinds while the executor journals a dozen carrying a setup_id, so a
// rejected order, an UNKNOWN order outcome, an overdue exit, a stale or invalid
// intent, and a period the executor GAVE UP on all rendered nothing — the panel
// said "none — clean" while the record said otherwise. lib/pilotview.js has
// surfaced all of these for F1 all along; only its generalized twin was missing
// them, and an asymmetry between the two is an oversight, not a decision (the
// QC-122 shape, found 2026-08-18 while building a fixture for the runtime pass).
//
// The list is checked against lib/pilotview.js's OWN switch rather than a copy,
// so the two rails cannot drift apart again silently.
//
// Watched failing 2026-08-18: dropping ORDER_REJECT from view.js fails both
// checks below.
module.exports.theSetupScreenSurfacesEveryFailureAnOperatorWouldActdOn = function () {
  const fs2 = require('fs');
  const path2 = require('path');
  const ROOT2 = path2.join(__dirname, '..');
  const kinds = new Set([...fs2.readFileSync(path2.join(ROOT2, 'lib/live/view.js'), 'utf8')
    .matchAll(/case '([A-Z_]+)':/g)].map((m) => m[1]));
  // The failures a PER-PROFILE screen must show. Box-wide ones (ARM_*, HALT_*,
  // CLOCK_DRIFT, BALANCE) belong to the machine and live in lib/boxview.js.
  //
  // This used to compare against the hardcoded config's view module and assert
  // parity with it. That module is gone, so the list is stated outright — which
  // is stronger anyway: parity with another file only ever proved the two agreed,
  // never that either was right. Add a kind here when the executor starts
  // journaling one an operator would act on.
  const perSetup = ['ORDER_REJECT', 'EXIT_OVERDUE', 'ENTRY_GAVE_UP', 'INTENT_STALE',
    'KILL_PRICE_DRIFT', 'FIXED_STOP', 'MIRROR_BREAK', 'ORDER_UNKNOWN',
    'INTENT_INVALID', 'INTENT_DUPLICATE', 'ENTRY_SKIPPED', 'SETUP_HALT_SET'];
  for (const k of perSetup) {
    assert.ok(kinds.has(k),
      `the profile screen does not surface ${k} — it would say "none — clean" while the record said otherwise`);
  }
};

module.exports.aRejectedOrderAppearsInTheSetupsIncidents = function () {
  withJournal([
    { utc: '2026-08-18T01:00:00Z', event: 'ENTRY_FILL', setup_id: 'r', chunk_start: 'c1', side: 'LONG', qty: 0.2, price: 100, exit_due_ts: 2e9 },
    { utc: '2026-08-18T01:05:00Z', event: 'ORDER_REJECT', setup_id: 'r', http: 400, body: 'insufficient margin' },
    { utc: '2026-08-18T01:06:00Z', event: 'ENTRY_GAVE_UP', setup_id: 'r', chunk_start: 'c2' },
  ], (f) => {
    const b = view.deriveSetup(view.readJournal(f).events, 'r');
    const kinds = b.incidents.map((i) => i.kind);
    assert.ok(kinds.includes('ORDER_REJECT'), `a rejected order must be on the screen, got ${JSON.stringify(kinds)}`);
    assert.ok(kinds.includes('ENTRY_GAVE_UP'), 'a period the executor gave up on must be on the screen');
    assert.ok(b.incidents.every((i) => i.detail && i.detail.length),
      'each incident must carry the executor\'s own detail, not just its name');
  });
};

// THE DECISION WAITING TO OPEN (item 7, 3.258.0): the newest decision whose
// entry hour has not come, the last line written for its period, and in words
// what it does -- or that there is no trade, and why
module.exports.thePendingDecisionIsTheNewestWhoseEntryHourHasNotCome = function () {
  const H = 3600000;
  const day = (d) => Date.UTC(2026, 8, d);
  const setup = { id: 's', configSnapshot: { branch: { geometry: 'daily-4d', band: 5 }, cell: { entry: 'breakout', gate: 'active', dMult: 0.75, tHours: 65 } } };
  const size = { clipUsd: 100, fieldSize: 1, multiplier: 1.25, agree: 3, sizingOn: true, quoteUsd: 125 };
  const rec = (d, o = {}) => ({ chunk_start: new Date(day(d)).toISOString(), side: 'LONG', per_member: [1, 1, 1, -1], band_pct: 5, produced_utc: new Date(day(d + 4) + 60000).toISOString(),
    field: { sign: 1, agreement: 92.1, certainty: 85.2, size: 1, why: 'sized: certainty 85 on the rung ×1' }, clip_usd: 125, ...o });
  const now = day(26) + 30 * 60000; // 00:30 on the 26th: the window of the 22nd opens at 01:00
  // the 21st's opened yesterday; the 22nd's is waiting; its last line carries the engine's answer
  const p = view.pendingDecision(setup, [rec(21), rec(22, { engine: { ok: false, traded: true, size } }), rec(22, { engine: { ok: true, traded: true, size, answer: { ok: true, phase: 'waiting' } } })], now);
  assert.deepStrictEqual([p.chunk_start.slice(0, 10), p.entry_utc, p.side, p.traded, p.why], ['2026-09-22', '2026-09-26T01:00:00.000Z', 'LONG', true, null]);
  assert.deepStrictEqual(p.members, { of: 4, up: 3, down: 1, agreeing: 3 });
  assert.deepStrictEqual([p.field.size, p.quoteUsd, p.levelPct, p.holdHours, p.gate], [1, 125, 3.75, 65, 'active']);
  assert.deepStrictEqual(p.engine, { taken: true, said: null });
  // written down but not yet taken: says what the engine said
  const q = view.pendingDecision(setup, [rec(22, { engine: { ok: false, traded: true, size, answer: 'nothing answers on the tunnel\'s port on this machine' } })], now);
  assert.deepStrictEqual(q.engine, { taken: false, said: 'nothing answers on the tunnel\'s port on this machine' });
  // no trade, and why: the field blocked it, the committee stood aside, or it sized to nothing
  const blocked = view.pendingDecision(setup, [rec(22, { side: 'FLAT', field: { sign: 1, agreement: 40, certainty: 62, size: 0, why: 'blocked by minimum: certainty 62 < 70' }, engine: { ok: true, traded: false, why: 'the field blocked the call', answer: 'nothing to send' } })], now);
  assert.deepStrictEqual([blocked.traded, blocked.why, blocked.engine, blocked.members.agreeing], [false, 'the field blocked the call by minimum: certainty 62 < 70', null, null]);
  const aside = view.pendingDecision(setup, [rec(22, { side: 'FLAT', per_member: [1, -1, 0, 0], field: { sign: 1, size: 0, why: 'no call' }, engine: { ok: true, traded: false, why: 'the committee stood aside' } })], now);
  assert.deepStrictEqual([aside.why, aside.members.up, aside.members.down], ['the committee stood aside', 1, 1]);
  const none = view.pendingDecision(setup, [rec(22, { engine: { ok: true, traded: false, why: 'sized to nothing', size: { ...size, quoteUsd: 0 } } })], now);
  assert.deepStrictEqual([none.traded, none.why], [false, 'sized to nothing']);
  // an old order program's record, with no engine: its clip, and nothing asked of an engine
  const old = view.pendingDecision(setup, [rec(22)], now);
  assert.deepStrictEqual([old.quoteUsd, old.engine, old.traded], [125, null, true]);
  // once the hour has come, nothing is waiting
  assert.strictEqual(view.pendingDecision(setup, [rec(22)], day(26) + 1 * H), null);
  assert.strictEqual(view.pendingDecision(setup, [], now), null);
};

// ...AND IT IS DRAWN FIRST ON LIVE, by the one path both books share, every
// tile described
module.exports.thePendingDecisionIsDrawnFirstOnLiveByTheOnePath = function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'trade.html'), 'utf8');
  const fn = src.slice(src.indexOf('function pendingHtml('), src.indexOf('function enginePlansHtml('));
  assert.ok(fn.length > 200, 'the panel has its renderer');
  assert.ok(!/branch|isP\b|isPaper/.test(fn), 'nothing in the panel asks which book it is on');
  const keys = [...fn.matchAll(/tile\('[^']+','([A-Za-z]+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(keys, ['pendCall', 'pendMembers', 'pendField', 'pendRung', 'pendSize', 'pendOpens']);
  const tileBlock = src.slice(src.indexOf('const TILE={'), src.indexOf('const tile=('));
  for (const k of keys) assert.ok(new RegExp(`\\n  ${k}:'`).test(tileBlock), `tile ${k} carries a description`);
  const live = src.slice(src.indexOf('async function drawLive('), src.indexOf('async function drawLive(') + 6000);
  const at = live.indexOf('${pendingHtml(st.pending');
  assert.ok(at > 0 && at < live.indexOf('Reproduce-check') && at < live.indexOf('<div class="grid"'), 'drawn above the check line and the money tiles');
};

// WHICH CONFIG THIS IS (3.260.0): one line under the config's name, drawn by
// one helper on all five Trade tabs of both books, from facts the configs list
// serves -- so two configs cut from the same set can be matched tab to tab
module.exports.everyTradeTabSaysWhichConfigThisIsTheSameWay = function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'trade.html'), 'utf8');
  const body = (name) => { const a = src.indexOf(`async function ${name}(`); const b = src.indexOf('\nasync function ', a + 10); return src.slice(a, b > 0 ? b : a + 20000); };
  for (const tab of ['drawDash', 'drawConfigs', 'drawSetups', 'drawDetail', 'drawLive']) {
    assert.ok(/ident(Html|Sub|Line)\(/.test(body(tab)), `${tab} draws the config's identifying line`);
  }
  // the line itself: the same helper, the facts in one order, nothing asked of the book
  const fn = src.slice(src.indexOf('function identLine('), src.indexOf('const IDENT_WHY='));
  assert.ok(!/branch|isP\b/.test(fn), 'the line does not depend on which book it is on');
  const identLine = new Function('esc', `${fn}; return identLine;`)((t) => String(t));
  const g = { id: 'gl-1', name: 'LTCUSDT stage4', ident: { pair: 'LTCUSDT', geometry: 'daily-4d', entry: 'breakout', gate: 'active', d: 0.75, t: 65, trail: 1.5, arm: 0.5, band: 5, pickedBy: 'named' } };
  assert.strictEqual(identLine(g), 'gl-1 · LTCUSDT daily-4d · breakout active · d 0.75 · t 65 · trail 1.5 · arm 0.5 · band 5% · named by you');
  assert.strictEqual(identLine({ ...g, name: null, ident: { ...g.ident, entry: 'market', gate: 'directional', d: null, trail: null, arm: null, pickedBy: 'depth' } }), 'LTCUSDT daily-4d · market directional · t 65 · band 5% · by depth', 'an unnamed config shows its id as its name, so the line does not repeat it');
  // the configs list serves the facts
  const routes = fs.readFileSync(path.join(__dirname, '..', 'lib', 'live', 'routes.js'), 'utf8');
  assert.ok(/ident: identOf\(g\)/.test(routes), 'the configs list carries what tells one config from another');
};

// THE FIELD AND ITS GATE IN TESTED CONFIGURATION (3.261.0), in the same words
// as the pipeline's step 4b
module.exports.theTestedConfigurationSaysTheFieldAndItsGate = function () {
  const an = require('../lib/live/anatomy');
  const { aSetupConfig } = require('./fixtures-setup');
  const field = { id: 'fld-1', name: 'LTC field', dials: { windowDays: 60, halfLifeDays: 20 }, gate: { read: 'certainty', agreeMin: 40, certMin: 70, rule: 'both', signOnly: false, rungs: '80:0.75,90:1,100:1.25', silent: 0 } };
  const cfg = aSetupConfig({ field });
  const c = an.describeConfig(cfg);
  assert.strictEqual(c.field, 'fld-1, LTC field: rebuilt at every decision from every closed decision over a window of 60 days, half-life 20 days, and read on the decision\'s own day');
  assert.ok(/^the call is BLOCKED when the field's sign is against it, BLOCKED when its agreement is below 40 or its certainty is below 70, and otherwise SIZED by the rung its certainty falls in \(80:0\.75,90:1,100:1\.25/.test(c.fieldGate), c.fieldGate);
  assert.ok(/0× the clip$/.test(c.fieldGate));
  const step = an.describeAnatomy(cfg).pipeline.find((x) => /^4b\. THE FIELD/.test(x));
  assert.ok(step.includes(c.field) && step.includes(c.fieldGate.slice(1)), 'the pipeline says the same words');
  assert.strictEqual(c.agreement, 'how many members say the same thing; enough at 50% of the members', 'the agreement is words, never an object the screen cannot print');
  const none = an.describeConfig(aSetupConfig());
  assert.deepStrictEqual([none.field, none.fieldGate], [null, null], 'no field: a dash on screen');
  assert.strictEqual(an.describeConfig(aSetupConfig({ field: { id: 'x', error: 'the field x cannot be read' } })).field, 'the field x cannot be read');
};

// THE CONFIG EDITOR (3.257.0, 3.262.0): Members train -- rolling, or frozen at
// a date -- and Verbose, each saved with the clip
module.exports.theConfigEditorOffersMembersTrainAndVerbose = function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'trade.html'), 'utf8');
  const detail = src.slice(src.indexOf('async function drawDetail('), src.indexOf('async function drawLive('));
  assert.ok(/<select id="trainIn">/.test(detail) && />rolling<\/option>/.test(detail) && />frozen at<\/option>/.test(detail), 'Members train offers rolling and frozen at');
  assert.ok(/— not set —/.test(detail), 'a book with no choice says so rather than showing one');
  assert.ok(/id="trainAt" type="date"/.test(detail), 'frozen at takes a date');
  assert.ok(/if\(train==='rolling'\) body\.trainPolicy=\{mode:'rolling'\};/.test(detail), 'rolling is saved');
  assert.ok(/body\.trainPolicy=\{mode:'frozen',throughMs:Date\.parse\(day\+'T00:00:00Z'\)\}/.test(detail), 'frozen at is saved at 00:00 UTC of its date');
  assert.ok(/id="verboseIn"/.test(detail) && /verbose:\$\('#verboseIn'\)\.checked/.test(detail), 'Verbose is a tick saved with the clip');
};

// THE PIPELINE'S ENTRY AND EXIT IN THIS CONFIG'S OWN TERMS (3.262.1): a
// breakout is two levels and a stop on the far side, a market entry is an
// order at the hour's open -- never "a market order at the hourly OPEN" and
// "a pure time exit" for everything
module.exports.thePipelineSaysHowThisConfigOpensAndCloses = function () {
  const an = require('../lib/live/anatomy');
  const [e1, x1] = an.entryExitWords({ cell: { entry: 'breakout', gate: 'active', dMult: 0.75, tHours: 65, trailMult: 1.5, armMult: 0.5 } }, {}, 97, 5);
  assert.ok(/^5\. ENTRY — breakout, gate active: at 01:00 UTC, 97h after the window starts, a buying level and a selling level are set 3\.75% either side/.test(e1), e1);
  assert.ok(/Whichever a printed trade reaches first opens the position/.test(e1) && /If none is reached within 65h, nothing opens/.test(e1));
  assert.ok(/^6\. EXIT — the stop is the level on the other side\. Once the best price since the entry has gone 2\.5% its way \(arm 0\.5 × the 5% band\), the stop follows 7\.5% \(trail 1\.5 × band\)/.test(x1), x1);
  const [e2] = an.entryExitWords({ cell: { entry: 'breakout', gate: 'directional', dMult: 0.75, tHours: 65, trailMult: null } }, {}, 97, 5);
  assert.ok(/Only the level on the side of the call can open it/.test(e2));
  const [e3, x3] = an.entryExitWords({ cell: { entry: 'market', gate: 'directional', tHours: 137, trailMult: null } }, { stopPct: 0.11 }, 97, 1.69);
  assert.ok(/^5\. ENTRY — market: a market order in the called direction at the opening price of 01:00 UTC/.test(e3));
  assert.ok(/^6\. EXIT — a stop 11% against the price it opened at \(Stop %\), reached when a printed trade goes past it\. Whatever is still open 137h after 01:00 UTC/.test(x3), x3);
  for (const w of [e1, x1, e2, e3, x3]) assert.ok(!/\bcell\b/.test(w) && !/pure time exit/.test(w), `no forbidden word, no old claim: ${w}`);
  const steps = an.describeAnatomy(require('./fixtures-setup').aSetupConfig(), { stopPct: 0.11 }).pipeline;
  assert.ok(steps.some((s) => /^5\. ENTRY — market:/.test(s)) && steps.some((s) => /^6\. EXIT — a stop 11%/.test(s)), 'the pipeline carries them');
};

// ONE BADGE FOR WHERE A BOOK STANDS, AND A BUTTON IN A ROW OF ITS OWN (3.262.1)
module.exports.aBookShowsOneStateBadgeAndSaveRoutingHasItsOwnRow = function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'trade.html'), 'utf8');
  const detail = src.slice(src.indexOf('async function drawDetail('), src.indexOf('async function drawLive('));
  const at = detail.indexOf('<b style="font-size:1rem">${esc(s.name)}</b>');
  const head = detail.slice(at, detail.indexOf('<div class="spacer">', at));
  assert.ok(!/paperBadge/.test(head) && /bookWords\(ch,s\)/.test(head), 'Setup detail: one badge, in the status words');
  const setups = src.slice(src.indexOf('async function drawSetups('), src.indexOf('async function drawDash('));
  assert.ok(!/paperBadge/.test(setups) && /bookWords\(chanOf\(meta\[s\.id\]\),s\)/.test(setups), 'Setups: one badge, in the status words');
  assert.ok(/<div class="row" style="margin-top:\.5rem"><button id="saveRouting">Save routing<\/button><\/div>/.test(detail), 'Save routing has a row of its own');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'lib', 'live', 'routes.js'), 'utf8');
  assert.ok(/words: ch\.statusLine\(\[\{ channel: c, state: s\.state, open \}\]\)/.test(routes), 'each book\'s words come from the one status vocabulary');
};

// WHETHER THE PLATFORM IS FOLLOWED IS ASKED OF THE LINK, NOT OF A FLAG (3.269.0).
// mirror.status said following from the moment the screen began to watch and
// never took it back, so the Trade screen read "following the platform" for a
// platform that had gone. The link's own answer is what both books draw.
module.exports.theTradeScreenAsksTheLinkWhetherThePlatformIsFollowed = function () {
  const view = fs.readFileSync(path.join(__dirname, '..', 'lib', 'live', 'view.js'), 'utf8');
  assert.ok(view.includes('link: mirror.linkStatus(), lastHealth: mirror.lastHealth,'), 'the view does not ask the link whether the platform is followed');
  assert.ok(!view.includes('link: mirror.status,'), 'the view still reads the flag that never goes back to false');
  const link = fs.readFileSync(path.join(__dirname, '..', 'lib', 'live', 'enginelink.js'), 'utf8');
  assert.ok(/linkStatus\(\) \{\n    const h = require\('\.\/enginehub'\)\.status\(this\.target\.id\);\n    return \{ following: h\.linked,/.test(link), 'the link\'s answer is not whether the platform is linked now');
};
