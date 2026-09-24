// THE FIELD'S GATE ON A TRADE (FIELD-DESIGN.md sections D and F; owner LOOP
// NOW! 2026-09-21): the rungs, the blocks, the sizing, the money under the
// sizes, and the verdict in its written order -- each held to numbers known
// before the gate was asked.
const { assert } = require('./helpers');
const G = require('../lib/fieldgate');

function theRungsAreReadInWordsAndClimbTo100() {
  const r = G.parseRungs('20:0.5, 50:1, 80:1.5, 100:2');
  assert.deepStrictEqual(r.map((x) => [x.upTo, x.x]), [[20, 0.5], [50, 1], [80, 1.5], [100, 2]]);
  assert.strictEqual(G.rungFor(r, 0), 0.5);
  assert.strictEqual(G.rungFor(r, 20), 0.5, 'a read on the rung is in it');
  assert.strictEqual(G.rungFor(r, 20.1), 1);
  assert.strictEqual(G.rungFor(r, 100), 2);
  const bad = (text, words) => {
    let msg = '';
    try { G.parseRungs(text); } catch (err) { msg = err.message; }
    assert(msg.includes(words), `${JSON.stringify(text)} should refuse with "${words}", got "${msg}"`);
  };
  bad('', 'is empty');
  bad('50:1, 20:0.5', 'must climb');
  bad('50:1', 'must reach 100');
  bad('abc', 'is not a rung');
  bad('120:1', '0 to 100');
  assert.deepStrictEqual(G.parseRungLists('100:1; 50:0.5,100:2'), ['100:1', '50:0.5,100:2'], 'ladders are split on semicolons');
  assert.deepStrictEqual(G.parseMinimums('30, 10, 20'), [10, 20, 30]);
  let m = '';
  try { G.parseMinimums('10, 10'); } catch (err) { m = err.message; }
  assert(m.includes('repeats'), m);
  const g = G.checkGate({ read: 'certainty', agreeMin: '20', certMin: '', signOnly: false, rungs: '100:1', silent: '0.5' });
  assert.deepStrictEqual(g, { read: 'certainty', agreeMin: 20, certMin: null, rule: 'both', signOnly: false, rungs: '100:1', silent: 0.5 });
  assert.strictEqual(G.gateLabel(g), ' · field agreement≥20 sized by certainty ×100:1 silent×0.5');
  assert.strictEqual(G.gateLabel(null), '', 'no gate, no name');
}

// THE BLOCKS AND THE SIZES: sign against the call blocks; the read below the
// minimum blocks unless sign only; silence trades at the silent multiple;
// otherwise the rung.
function theGateBlocksSizesAndLetsSilenceThrough() {
  const days = [
    { ts: 100, sign: 1, agreement: 90, certainty: 80, speaking: 5 },
    { ts: 200, sign: -1, agreement: 10, certainty: 50, speaking: 5 },
    { ts: 300, sign: 0, agreement: 0, certainty: 0, speaking: 0 },
    { ts: 400, sign: 1, agreement: 40, certainty: 10, speaking: 3 },
  ];
  const gate = { read: 'agreement', agreeMin: 30, certMin: null, rule: 'both', signOnly: false, rungs: '50:1,100:2', silent: 0.5 };
  const calls = [1, 1, -1, 1, 0, -1];
  const ts = [100, 200, 300, 400, 400, 50];
  const got = G.sizesFor(days, ts, calls, gate);
  assert.deepStrictEqual(Array.from(got.sizes), [2, 0, 0.5, 1, 0, 0.5]);
  // 100: sign with the call, read 90 -> the top rung; 200: sign against -> blocked;
  // 300: silent -> half; 400: with, read 40 -> rung 1; the 0 call is nothing;
  // 50: before the first day -> silent
  assert.strictEqual(got.placed, 2);
  assert.strictEqual(got.blockedSign, 1);
  assert.strictEqual(got.blockedMin, 0);
  assert.strictEqual(got.silent, 2);
  assert.strictEqual(got.readSum, 130);
  const min = G.sizesFor(days, ts, calls, { ...gate, agreeMin: 50 });
  assert.deepStrictEqual(Array.from(min.sizes), [2, 0, 0.5, 0, 0, 0.5], 'a read below the minimum blocks');
  assert.strictEqual(min.blockedMin, 1);
  const only = G.sizesFor(days, ts, calls, { ...gate, agreeMin: 50, signOnly: true });
  assert.deepStrictEqual(Array.from(only.sizes), [2, 0, 0.5, 1, 0, 0.5], 'sign only ignores the minimum');
  const cert = G.sizesFor(days, ts, calls, { ...gate, read: 'certainty', agreeMin: null, certMin: 30 });
  assert.deepStrictEqual(Array.from(cert.sizes), [2, 0, 0.5, 0, 0, 0.5], 'a bar on certainty blocks on certainty, and the read sizes by it');
}

// THE MONEY UNDER THE SIZES: grouped by multiple, each group priced alone,
// a trade at twice the size exactly twice the money; the blocked calls priced
// once at size 1 beside them.
function theMoneyIsTheSumOfEachMultipleTimesItsGroup() {
  const calls = [1, -1, 1, 1, -1, 0];
  const sizes = [2, 0, 0.5, 1, 1, 0];
  // a simulator that pays call i exactly (i + 1) dollars per placed call, so
  // the arithmetic can be checked by hand
  const sim = (list) => { let pnl = 0; let trades = 0; for (let i = 0; i < list.length; i++) if (list[i]) { pnl += (i + 1); trades++; } return { pnl, trades, stops: 0 }; };
  const got = G.priceGated(calls, sizes, sim);
  // groups: x2 -> call 0 ($1); x0.5 -> call 2 ($3); x1 -> calls 3 and 4 ($4 + $5)
  assert.strictEqual(got.pnl, 2 * 1 + 0.5 * 3 + 1 * 9);
  assert.strictEqual(got.trades, 4);
  assert.strictEqual(got.size, 2 + 0.5 + 2);
  assert.strictEqual(got.at1, 1 + 3 + 9);
  assert.strictEqual(got.blockedAt1, 2, 'the blocked call 1 at size 1');
  assert.strictEqual(got.blockedN, 1);
  assert.deepStrictEqual(got.taken, [1, 0, 1, 1, -1, 0], 'the calls actually taken, for the rich pass');
}

// THE VERDICT, in the order it was written down before any number existed.
function theVerdictFollowsItsWrittenOrder() {
  assert.strictEqual(G.verdictOf(null), null);
  assert.strictEqual(G.verdictOf({ pnl: 0, at1: 0, size: 0, trades: 0, blockedAt1: 0, blockedN: 0 }), null, 'nothing touched, no verdict');
  // sized money not above every call at size 1 (placed at 1 + blocked at 1)
  assert.strictEqual(G.verdictOf({ pnl: 10, at1: 8, size: 4, trades: 4, blockedAt1: 3, blockedN: 1 }), 'adds nothing');
  // above it, but not per unit of size: 12 over size 8 (1.5) against 11 over 5 calls (2.2)
  assert.strictEqual(G.verdictOf({ pnl: 12, at1: 8, size: 8, trades: 4, blockedAt1: 3, blockedN: 1 }), 'just leverage');
  // above it and per unit too, but the blocked call had made money at size 1
  assert.strictEqual(G.verdictOf({ pnl: 14, at1: 8, size: 4, trades: 4, blockedAt1: 3, blockedN: 1 }), 'adds value');
  // and with the blocked calls having lost money: the blocks were right
  assert.strictEqual(G.verdictOf({ pnl: 10, at1: 8, size: 4, trades: 4, blockedAt1: -3, blockedN: 1 }), 'better signal');
  // sizing alone, nothing blocked, can add value but never claim a better signal
  assert.strictEqual(G.verdictOf({ pnl: 12, at1: 8, size: 5, trades: 4, blockedAt1: 0, blockedN: 0 }), 'adds value');
  for (const w of G.VERDICTS) assert(G.verdictWhy(w), `${w} has its rule in words`);
  // the sums a tally keeps, and the share of calls blocked
  const a = G.addTotals(null, { pnl: 1, trades: 1, size: 1, at1: 1, blockedAt1: -1, blockedN: 1, placed: 1, blockedSign: 1, blockedMin: 0, silent: 2, readSum: 40, readN: 1 });
  const b = G.addTotals(a, { pnl: 2, trades: 2, size: 3, at1: 2, blockedAt1: 0, blockedN: 0, placed: 2, blockedSign: 0, blockedMin: 1, silent: 0, readSum: 100, readN: 2 });
  assert.strictEqual(b.pnl, 3); assert.strictEqual(b.n, 2); assert.strictEqual(b.blockedMin, 1); assert.strictEqual(b.readN, 3);
  assert(Math.abs(G.blockedShare(b) - (2 / 7) * 100) < 1e-9, 'blocked share is blocks over every call the gate saw');
  const c = G.totalsCents({ pnl: 1.005, trades: 1, size: 1.23456, at1: 0.999, blockedAt1: 0, blockedN: 0, placed: 1, blockedSign: 0, blockedMin: 0, silent: 0, readSum: 1.234, readN: 1 });
  assert.strictEqual(c.size, 1.235); assert.strictEqual(c.at1, 1);
}

// TWO MINIMUMS, ONE ON EACH NUMBER (3.218.0, owner GO NOW! 2026-09-21: "the
// dual read functionality"). `both` blocks when either bar is missed, `either`
// only when both are; a blank box is no bar; a bar of 0 blocks nothing, a
// missing number included; the read names only what the rungs size by; and
// the names, the live path's words and the record shape all say the same.
function theTwoMinimumsCombineByBothOrEither() {
  const days = [
    { ts: 100, sign: 1, agreement: 90, certainty: 80, speaking: 5 },   // clears both bars
    { ts: 200, sign: 1, agreement: 90, certainty: 20, speaking: 5 },   // agreement only
    { ts: 300, sign: 1, agreement: 30, certainty: 80, speaking: 5 },   // certainty only
    { ts: 400, sign: 1, agreement: 30, certainty: 20, speaking: 5 },   // neither
    { ts: 500, sign: 1, agreement: 90, certainty: null, speaking: 5 }, // no certainty on file
  ];
  const calls = [1, 1, 1, 1, 1];
  const ts = [100, 200, 300, 400, 500];
  const base = { read: 'agreement', agreeMin: 40, certMin: 60, rule: 'both', signOnly: false, rungs: '50:1,100:2', silent: 1 };
  const both = G.sizesFor(days, ts, calls, base);
  assert.deepStrictEqual(Array.from(both.sizes), [2, 0, 0, 0, 0], 'both: missing either bar blocks');
  assert.strictEqual(both.blockedMin, 4);
  const either = G.sizesFor(days, ts, calls, { ...base, rule: 'either' });
  assert.deepStrictEqual(Array.from(either.sizes), [2, 2, 1, 0, 2], 'either: only missing both bars blocks; the rungs still read agreement');
  assert.strictEqual(either.blockedMin, 1);
  const byCert = G.sizesFor(days, ts, calls, { ...base, rule: 'either', read: 'certainty' });
  assert.deepStrictEqual(Array.from(byCert.sizes), [2, 1, 2, 0, 1], 'the read names the number the rungs size by, and a missing one sizes as 0');
  const one = G.sizesFor(days, ts, calls, { ...base, certMin: null, rule: 'either' });
  assert.deepStrictEqual(Array.from(one.sizes), [2, 2, 0, 0, 2], 'a blank certainty box is no bar on certainty, whatever the rule says');
  const none = G.sizesFor(days, ts, calls, { ...base, agreeMin: null, certMin: null });
  assert.deepStrictEqual(Array.from(none.sizes), [2, 2, 1, 1, 2], 'no bar at all: only the sign can block');
  const zero = G.sizesFor(days, ts, calls, { ...base, agreeMin: 0, certMin: 0 });
  assert.deepStrictEqual(Array.from(zero.sizes), [2, 2, 1, 1, 2], 'a bar of 0 blocks nothing, a missing certainty included');
  // the names: the rule only where there are two bars to combine
  assert.strictEqual(G.gateLabel(base), ' · field agreement≥40 & certainty≥60 sized by agreement ×50:1,100:2 silent×1');
  assert.strictEqual(G.gateLabel({ ...base, rule: 'either' }), ' · field agreement≥40 | certainty≥60 sized by agreement ×50:1,100:2 silent×1');
  assert.strictEqual(G.gateLabel({ ...base, certMin: null, rule: 'either' }), ' · field agreement≥40 sized by agreement ×50:1,100:2 silent×1', 'one bar names no rule');
  assert.strictEqual(G.gateLabel({ ...base, agreeMin: null, certMin: null }), ' · field no minimum sized by agreement ×50:1,100:2 silent×1');
  // the words the live path prints on Trade when it blocks
  assert.strictEqual(G.minimumWords(days[3], base), 'agreement 30 below 40 and certainty 20 below 60');
  assert.strictEqual(G.minimumWords(days[1], base), 'certainty 20 below 60');
  assert.strictEqual(G.minimumWords(days[4], base), 'certainty none below 60', 'a missing number is said, not invented');
  // and the block as the anatomy of a live setup says it
  assert.strictEqual(G.blockWords(base), ', BLOCKED when its agreement is below 40 or its certainty is below 60');
  assert.strictEqual(G.blockWords({ ...base, rule: 'either' }), ', BLOCKED when both its agreement is below 40 and its certainty is below 60');
  assert.strictEqual(G.blockWords({ ...base, agreeMin: null, certMin: null }), '');
  // the record shape has one home
  assert.deepStrictEqual(G.gateRecord({ ...base, test: { placed: 1 }, hold: null }), base, 'gateRecord carries the seven fields and nothing else');
  // checked, and refused in words that name the box
  const bad = (g, words) => {
    let m = '';
    try { G.checkGate(g); } catch (err) { m = err.message; }
    assert(m.includes(words), `${JSON.stringify(g)} should refuse with "${words}", got "${m}"`);
  };
  bad({ ...base, rule: 'most' }, 'not a way to combine the minimums');
  bad({ ...base, certMin: 101 }, 'certainty minimum: a read is 0 to 100');
  bad({ ...base, agreeMin: 'x' }, 'agreement minimum: a read is 0 to 100');
  assert.deepStrictEqual(G.minimumsOf('', 'agreement minimum'), [null], 'a blank box is one value, no bar');
  assert.deepStrictEqual(G.minimumsOf(' 40, 20 ', 'agreement minimum'), [20, 40]);
  let m = '';
  try { G.minimumsOf('10, 10', 'certainty minimum'); } catch (err) { m = err.message; }
  assert.strictEqual(m, 'certainty minimum repeats a value');
}

// THE RICH FIGURES UNDER THE GATE ARE THE TRADES AT THEIR RUNGS' SIZES
// (3.235.0, owner order 2026-09-23: "all upstream processes use the correct
// resulting trade sizes IN EVERY SINGLE TRADE INSTANCE"). The window's total is
// the size groups' arithmetic to the bit, as before; the drawdown, worst and
// best trade, thirds and money per trade are the placed trades at their sizes.
function theRichFiguresUnderTheGateAreTheTradesAtTheirSizes() {
  const { simCell } = require('../lib/bracket');
  const { GEOMETRIES } = require('../lib/dataset');
  const { FEE_PER_LEG: FEE, NOTIONAL } = require('../lib/paper');
  const sw = require('../lib/stagework');
  const geo = GEOMETRIES['daily-3d'];
  const HOUR = 3600000;
  const t0 = Date.UTC(2024, 0, 1);
  const periods = [0, 1, 2, 3, 4, 5].map((i) => ({ startTs: t0 + i * 7 * 24 * HOUR }));
  const m = new Map();
  periods.forEach((p, i) => {
    const up = [true, false, true, false, false, true][i];
    for (let h = 0; h <= 80; h++) {
      const o = 100 + (up ? 1 : -1) * h * 0.2;
      m.set(p.startTs + geo.entryOffsetH * HOUR + h * HOUR, { open: o, high: o + 0.6, low: o - 0.6, close: o });
    }
  });
  const cell = { entry: 'market', gate: null, dMult: null, tHours: 41, trailMult: null, armMult: null };
  const calls = [1, 1, 1, 1, 1, 1];
  const ts = [10, 20, 30, 40, 50, 60];
  const days = [
    { ts: 10, sign: 1, agreement: 90, certainty: 80, speaking: 5 },
    { ts: 20, sign: -1, agreement: 90, certainty: 80, speaking: 5 },
    { ts: 30, sign: 0, agreement: 0, certainty: 0, speaking: 0 },
    { ts: 40, sign: 1, agreement: 40, certainty: 50, speaking: 5 },
    { ts: 50, sign: 1, agreement: 95, certainty: 80, speaking: 5 },
    { ts: 60, sign: 1, agreement: 60, certainty: 80, speaking: 5 },
  ];
  const gate = { read: 'agreement', agreeMin: 30, certMin: null, rule: 'both', signOnly: false, rungs: '50:1,100:2', silent: 0.5 };
  const size = [2, 0, 0.5, 1, 2, 2];
  assert.deepStrictEqual(Array.from(G.sizesFor(days, ts, calls, gate).sizes), size, 'the fixture sizes as intended');
  const sim = (list, sizes = null) => simCell(cell, periods, list, m, geo, 2, FEE, undefined, sizes);
  const got = sw.priceFieldWindow(calls, ts, days, gate, sim, true);
  assert.strictEqual(got.res.pnl, G.priceGated(calls, size, sim).pnl, 'the total is the size groups\' own arithmetic, to the bit');
  const one = periods.map((p) => simCell(cell, [p], [1], m, geo, 2, FEE).pnl);
  const placed = [0, 2, 3, 4, 5];
  const sized = placed.map((i) => one[i] * size[i]);
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);
  near(got.res.pnl, sized.reduce((a, v) => a + v, 0), 'and it is the placed trades at their sizes');
  assert.strictEqual(got.res.trades, 5, 'the blocked call is not a trade');
  near(got.res.worstTrade, Math.min(...sized), 'the worst trade at its size');
  near(got.res.bestTrade, Math.max(...sized), 'the best trade at its size');
  let cum = 0; let peak = 0; let dd = 0;
  for (const v of sized) { cum += v; if (cum > peak) peak = cum; if (peak - cum > dd) dd = peak - cum; }
  near(got.res.maxDrawdown, dd, 'the drawdown of the sized trades');
  const thirds = [0, 0, 0];
  placed.forEach((i, j) => { thirds[i < 2 ? 0 : (i < 4 ? 1 : 2)] += sized[j]; });
  [0, 1, 2].forEach((j) => near(got.res.pnlThirds[j], thirds[j], `third ${j + 1}`));
  near(got.res.grossPerTrade, (got.res.pnl + (2 + 0.5 + 1 + 2 + 2) * NOTIONAL * 2 * FEE) / 5, 'the money per trade, the round trip paid on each size');
  assert.strictEqual(got.field.at1, G.priceGated(calls, size, sim).at1, 'the placed trades at size 1 stay what they were');
}

// THE GATE AS SIX FUNNEL DIALS (3.243.0, owner order 2026-09-24): a blank
// minimum is no bar; a box that changes nothing on the setting reads none
function theGateIsSixFunnelDialsAndABoxThatChangesNothingReadsNone() {
  const none = { fieldAgreeMin: null, fieldCertMin: null, fieldRule: null, fieldSignOnly: null, fieldSizeBy: null, fieldRungs: null };
  assert.deepStrictEqual(G.funnelDialsOf(null), none, 'a setting with no field reads none on all six');
  const gate = (o) => G.gateRecord(G.checkGate({ read: 'agreement', agreeMin: '', certMin: '', rule: 'both', rungs: '20:0.5,100:2', silent: 1, ...o }));
  assert.deepStrictEqual(G.funnelDialsOf(gate({ agreeMin: '20' })),
    { fieldAgreeMin: 20, fieldCertMin: 'no bar', fieldRule: null, fieldSignOnly: false, fieldSizeBy: 'agreement', fieldRungs: '20:0.5,100:2' },
    'one bar: the blank minimum is no bar, and must pass has nothing to combine');
  assert.deepStrictEqual(G.funnelDialsOf(gate({ read: 'certainty', agreeMin: '20', certMin: '40', rule: 'either' })),
    { fieldAgreeMin: 20, fieldCertMin: 40, fieldRule: 'either', fieldSignOnly: false, fieldSizeBy: 'certainty', fieldRungs: '20:0.5,100:2' },
    'two bars: must pass is read');
  assert.deepStrictEqual(G.funnelDialsOf(gate({ agreeMin: '20', certMin: '40', rule: 'either', signOnly: true })),
    { fieldAgreeMin: null, fieldCertMin: null, fieldRule: null, fieldSignOnly: true, fieldSizeBy: 'agreement', fieldRungs: '20:0.5,100:2' },
    'sign only ignores both minimums, so they and must pass read none; read and size rungs still size the trade');
  assert.deepStrictEqual(G.funnelDialsOf(gate({})),
    { fieldAgreeMin: 'no bar', fieldCertMin: 'no bar', fieldRule: null, fieldSignOnly: false, fieldSizeBy: 'agreement', fieldRungs: '20:0.5,100:2' },
    'no bar on either');
  assert.strictEqual(G.funnelDialsOf(gate({ agreeMin: '0' })).fieldAgreeMin, 0, 'a bar of 0 is its own value, not no bar');
}

module.exports = {
  theRungsAreReadInWordsAndClimbTo100,
  theGateIsSixFunnelDialsAndABoxThatChangesNothingReadsNone,
  theGateBlocksSizesAndLetsSilenceThrough,
  theTwoMinimumsCombineByBothOrEither,
  theMoneyIsTheSumOfEachMultipleTimesItsGroup,
  theVerdictFollowsItsWrittenOrder,
  theRichFiguresUnderTheGateAreTheTradesAtTheirSizes,
};
