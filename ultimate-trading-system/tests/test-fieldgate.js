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
  const g = G.checkGate({ read: 'certainty', minimum: '20', signOnly: false, rungs: '100:1', silent: '0.5' });
  assert.deepStrictEqual(g, { read: 'certainty', minimum: 20, signOnly: false, rungs: '100:1', silent: 0.5 });
  assert.strictEqual(G.gateLabel(g), ' · field certainty≥20 ×100:1 silent×0.5');
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
  const gate = { read: 'agreement', minimum: 30, signOnly: false, rungs: '50:1,100:2', silent: 0.5 };
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
  const min = G.sizesFor(days, ts, calls, { ...gate, minimum: 50 });
  assert.deepStrictEqual(Array.from(min.sizes), [2, 0, 0.5, 0, 0, 0.5], 'a read below the minimum blocks');
  assert.strictEqual(min.blockedMin, 1);
  const only = G.sizesFor(days, ts, calls, { ...gate, minimum: 50, signOnly: true });
  assert.deepStrictEqual(Array.from(only.sizes), [2, 0, 0.5, 1, 0, 0.5], 'sign only ignores the minimum');
  const cert = G.sizesFor(days, ts, calls, { ...gate, read: 'certainty', minimum: 30 });
  assert.deepStrictEqual(Array.from(cert.sizes), [2, 0, 0.5, 0, 0, 0.5], 'the read dial chooses certainty');
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

module.exports = {
  theRungsAreReadInWordsAndClimbTo100,
  theGateBlocksSizesAndLetsSilenceThrough,
  theMoneyIsTheSumOfEachMultipleTimesItsGroup,
  theVerdictFollowsItsWrittenOrder,
};
