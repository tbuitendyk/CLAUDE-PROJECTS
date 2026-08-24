// THE 2026-08-24 HALT, and the rule that prevents it, as tests.
//
// A venue holds ONE base balance per wallet. Every leg the engine believes in
// draws on that one pile. The engine used to hand the venue a side and a
// quantity and let `MARGIN_BUY` auto-borrow work out the rest — but auto-borrow
// covers only the SHORTFALL, spending free balance first. With a long's
// inventory in the wallet, a "short" borrowed nothing and sold the long's coin.
//
// The owner's ruling: decide correctly up front, and put the messy real-world
// factors (netting, dust, minimum sizes, borrowing) in the deciding part —
// not in a checker downstream, and never in a repair tool afterwards.
const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const tp = require(path.join(ROOT, 'lib', 'live', 'tradeplan'));
const venue = require(path.join(ROOT, 'lib', 'live', 'venue'));

const PRICE = 52.0;

function aShortBesideALongBorrowsItsWholeQuantity() {
  // The live wallet on 2026-08-24: four longs' inventory sitting free.
  const plan = tp.planEntry({
    side: 'SHORT', qty: 0.192, price: PRICE,
    wallet: { freeBase: 0.794205, borrowedBase: 0 },
  });
  assert.ok(plan.ok, `plan refused: ${plan.reason}`);
  const borrow = plan.steps.find((s) => s.action === 'borrow');
  assert.ok(borrow, 'a short with long inventory present must still BORROW — without an explicit '
                  + 'loan the venue sells the long\'s coin and the leg can never be closed');
  assert.strictEqual(borrow.qty, 0.192, 'the borrow must be the WHOLE quantity, not the shortfall');
  const sell = plan.steps.find((s) => s.action === 'sell');
  assert.strictEqual(sell.sideEffect, 'NO_SIDE_EFFECT',
    'the sell must not auto-borrow: the loan is already explicit');
  assert.ok(plan.steps.indexOf(borrow) < plan.steps.indexOf(sell), 'borrow must come before the sell');
}

function aLongEntryNeverRepaysAConcurrentShortsLoan() {
  const plan = tp.planEntry({
    side: 'LONG', qty: 0.2, price: PRICE,
    wallet: { freeBase: 0, borrowedBase: 0.222 },
  });
  assert.ok(plan.ok, `plan refused: ${plan.reason}`);
  const buy = plan.steps.find((s) => s.action === 'buy');
  assert.strictEqual(buy.sideEffect, 'NO_SIDE_EFFECT',
    'AUTO_REPAY here would silently pay down a concurrent short, shrinking a position '
  + 'nobody asked to change');
}

function aShortWithNoDebtIsReportedNotBoughtBack() {
  // Exactly the stranded 0.192 leg: the loan it should have taken never existed.
  const plan = tp.planExit({
    side: 'SHORT', qty: 0.192, price: PRICE,
    wallet: { freeBase: 0.602205, borrowedBase: 0 }, isLastShort: true,
  });
  assert.strictEqual(plan.ok, false, 'buying with nothing to repay just opens a naked long');
  assert.strictEqual(plan.unbacked, true, 'the caller must be able to tell this apart from dust');
  assert.ok(/never taken/.test(plan.reason), `the reason must name the cause, got: ${plan.reason}`);
  assert.strictEqual(plan.steps.length, 0, 'no order may be emitted');
}

function aShortCloseIsSizedFromLiveDebtNotTheNominal() {
  // Interest means the debt is bigger than what was borrowed.
  const plan = tp.planExit({
    side: 'SHORT', qty: 0.1, price: PRICE,
    wallet: { freeBase: 0, borrowedBase: 0.1015 }, isLastShort: true,
  });
  assert.ok(plan.ok, `plan refused: ${plan.reason}`);
  const buy = plan.steps[0];
  assert.ok(buy.qty >= 0.1015, `the last short must clear the WHOLE debt including pooled `
                             + `interest; got ${buy.qty} against debt 0.1015`);
  assert.strictEqual(buy.sideEffect, 'AUTO_REPAY');
}

function aShortWithSiblingsOpenRepaysOnlyItsOwnShare() {
  const plan = tp.planExit({
    side: 'SHORT', qty: 0.192, price: PRICE,
    wallet: { freeBase: 0, borrowedBase: 0.414319 }, isLastShort: false,
  });
  assert.ok(plan.ok, `plan refused: ${plan.reason}`);
  assert.ok(plan.steps[0].qty < 0.414319,
    'a leg that is not the last must never clear a sibling short\'s loan');
}

function aLongExitNeverSellsIntoTheDebt() {
  // The book claims 0.794205 long but only 0.602205 is free — selling the
  // full nominal would borrow the difference and open an unplanned short.
  const plan = tp.planExit({
    side: 'LONG', qty: 0.211788, price: PRICE,
    wallet: { freeBase: 0.15, borrowedBase: 0 },
  });
  assert.ok(plan.ok, `plan refused: ${plan.reason}`);
  assert.ok(plan.steps[0].qty <= 0.15,
    'the sell must be capped by base that actually exists, never the nominal');
  assert.strictEqual(plan.steps[0].sideEffect, 'NO_SIDE_EFFECT');
}

function dustIsANormalOutcomeWithItsOwnFlag() {
  const plan = tp.planExit({
    side: 'LONG', qty: 0.002, price: PRICE,   // ~$0.10, under the $5 minimum
    wallet: { freeBase: 0.002, borrowedBase: 0 },
  });
  assert.strictEqual(plan.ok, false);
  assert.strictEqual(plan.dust, true,
    'dust must be a named outcome the decision layer owns, not a tolerance fudged into a '
  + 'checker that runs afterwards');
}

function theSoundInvariantIsTheNet() {
  // The real 2026-08-24 numbers, before the manual borrow. Both one-sided
  // identities were "wrong" by 0.192 in opposite directions; the NET was right.
  const legs = [
    { side: 'SHORT', qty: 0.225 }, { side: 'LONG', qty: 0.211788 },
    { side: 'LONG', qty: 0.206793 }, { side: 'LONG', qty: 0.185814 },
    { side: 'LONG', qty: 0.18981 }, { side: 'SHORT', qty: 0.192 },
  ];
  const d = tp.netDrift({ legs, wallet: { freeBase: 0.602205, borrowedBase: 0.2223083 }, price: 51.92 });
  assert.ok(d.withinTolerance,
    `the net was correct to ${d.drift} yet the box halted — checking the two sides separately `
  + 'is what false-halted a sound account');
  assert.ok(Math.abs(d.drift) < 0.01, `net drift should be pennies, got ${d.drift}`);
}

function anIncompleteVenueAdapterCannotPassItselfOff() {
  const half = { name: 'half', price: () => 1, balances: () => ({}) };
  const d = venue.describe(half);
  assert.strictEqual(d.ok, false, 'an adapter missing writes must not report ok');
  assert.strictEqual(d.canTrade, false, 'it cannot trade without placeOrder/borrow/repay');
  assert.throws(() => venue.registerVenue(half), /missing/,
    'registering an incomplete adapter must be refused, loudly');
}

function theTradingSurfaceIsEnumerable() {
  const inv = venue.inventory();
  for (const need of ['balances', 'placeOrder', 'borrow', 'repay']) {
    assert.ok(inv.capabilities.some((c) => c.name === need),
      `'${need}' must be declared in the contract — a capability nobody can see is one `
    + 'nobody can verify, which is how the trading surface ended up welded into another project');
  }
  assert.ok(inv.capabilities.every((c) => c.doc && c.doc.length > 10),
    'every capability says what it does, in the data, not in prose elsewhere');
}

module.exports = {
  aShortBesideALongBorrowsItsWholeQuantity,
  aLongEntryNeverRepaysAConcurrentShortsLoan,
  aShortWithNoDebtIsReportedNotBoughtBack,
  aShortCloseIsSizedFromLiveDebtNotTheNominal,
  aShortWithSiblingsOpenRepaysOnlyItsOwnShare,
  aLongExitNeverSellsIntoTheDebt,
  dustIsANormalOutcomeWithItsOwnFlag,
  theSoundInvariantIsTheNet,
  anIncompleteVenueAdapterCannotPassItselfOff,
  theTradingSurfaceIsEnumerable,
};
