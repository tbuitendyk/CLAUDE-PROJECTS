// THE TRADING BRAIN. Decides what venue actions a trade actually requires.
//
// WHY THIS MODULE EXISTS (owner, 2026-08-24, after the LTC halt)
// --------------------------------------------------------------
// A venue does not hold "a long position" and "a short position". Binance
// isolated margin holds ONE base-asset balance per wallet, plus a debt. Every
// leg the engine believes in draws on that single pile.
//
// The engine used to hand the venue a bare side and quantity and let the
// venue's convenience flags work out the rest. `MARGIN_BUY` (auto-borrow)
// sounds like "borrow what I am selling". It does not. It borrows only the
// SHORTFALL: it spends free balance first. So on 2026-08-24 a 0.192 short
// opened while 0.794205 of long inventory sat in the wallet, borrowed
// NOTHING, and sold the long's coin instead. The net was still right, but the
// book and the wallet now disagreed by that quantity on both sides at once,
// a downstream checker false-halted a sound account, and the leg could never
// be closed because a short close sizes itself from debt and there was none.
//
// The owner's ruling: decide correctly at the point of decision. Do not build
// machinery to repair a book afterwards — a repair tool is a bandage over a
// wrong decision. And the messy real-world factors that make a decision
// correct (netting, dust, minimum sizes, borrowing) belong HERE, in the part
// that decides, not as fudge tolerances in a checker that runs later.
//
// So: given what the wallet actually holds and owes, and what the engine
// wants to do, this returns the EXPLICIT ORDERED LIST of venue primitives
// that achieves it. No hidden venue behaviour is relied on anywhere.
//
// Pure and deterministic. No network, no clock, no AI, no I/O. Every quantity
// it emits is already rounded to the venue's step, so nothing downstream has
// to guess.

// ---------------------------------------------------------------------------
// Venue rules. Facts about the trading venue, in ONE place, named.
//
// These were previously scattered as constants in the executor and as
// tolerances in the reconciler. A rule the decision cannot see is a rule the
// decision cannot honour.
// ---------------------------------------------------------------------------
const BINANCE_ISOLATED = {
  name: 'binance-isolated',
  qtyStep: 0.001,      // LOT_SIZE stepSize
  minNotional: 5.0,    // smallest order the venue will accept, in quote
  takerFeeRate: 0.001, // 0.1%, charged in the received asset
  // A short close must buy back slightly more than the debt: the buy's fee is
  // taken in the base asset, so buying exactly the debt repays slightly less
  // than the debt and leaves a sliver accruing interest.
  closeFeeBuffer: 0.003,
};

function floorStep(q, step) { return Math.floor((q + 1e-12) / step) * step; }
function ceilStep(q, step) { return Math.ceil((q - 1e-12) / step) * step; }
function round8(q) { return Math.round(q * 1e8) / 1e8; }

// Is this quantity too small for the venue to trade at all? Below the minimum
// notional there is no order to place — the coin is stranded until it grows or
// is swept with something else. Callers must treat dust as a NORMAL outcome,
// never an error: refusing to model it is what produced tolerance fudge
// downstream.
function isDust(qty, price, rules = BINANCE_ISOLATED) {
  if (!(qty > 0) || !(price > 0)) return true;
  return qty * price < rules.minNotional;
}

// ---------------------------------------------------------------------------
// planEntry — open a leg of `qty` on `side`, given what the wallet holds.
//
// wallet: { freeBase, borrowedBase }  as the VENUE reports them, not as the
//                                     journal believes them.
//
// SHORT: borrow the whole quantity, then sell it with no side effect. Never
// auto-borrow. Borrowing explicitly is what makes debt equal the nominal,
// which is what every later step (the close, the reconciliation) assumes.
// It also means the sale cannot reach a concurrent long's inventory.
//
// LONG: buy with no side effect. NOT auto-repay: a buy that repays would
// silently pay down a concurrent short's loan, shrinking a position nobody
// asked to change.
// ---------------------------------------------------------------------------
function planEntry({ side, qty, price, wallet, rules = BINANCE_ISOLATED }) {
  const w = wallet || {};
  const steps = [];
  const notes = [];
  const q = floorStep(qty, rules.qtyStep);

  if (!(q > 0)) {
    return { ok: false, reason: 'quantity rounds to zero at the venue step', steps: [], notes };
  }
  if (isDust(q, price, rules)) {
    return {
      ok: false,
      reason: `order of ${round8(q)} at ${price} is under the venue minimum of ${rules.minNotional}`,
      steps: [], notes,
    };
  }

  if (side === 'SHORT') {
    steps.push({
      action: 'borrow', asset: 'base', qty: round8(q),
      why: 'a short must be funded by its own loan; the venue would otherwise spend '
         + 'free balance first and sell a concurrent long\'s coin',
    });
    steps.push({
      action: 'sell', qty: round8(q), sideEffect: 'NO_SIDE_EFFECT',
      why: 'sell exactly the borrowed coin',
    });
    if ((w.freeBase || 0) > 0) {
      notes.push(`wallet already holds ${round8(w.freeBase)} base; the explicit borrow is what `
               + 'keeps this sale off it');
    }
    return { ok: true, steps, notes };
  }

  if (side === 'LONG') {
    steps.push({
      action: 'buy', qty: round8(q), sideEffect: 'NO_SIDE_EFFECT',
      why: 'no auto-repay: repaying here would silently pay down a concurrent short\'s loan',
    });
    if ((w.borrowedBase || 0) > 0) {
      notes.push(`wallet owes ${round8(w.borrowedBase)} base; this buy deliberately leaves that debt alone`);
    }
    return { ok: true, steps, notes };
  }

  return { ok: false, reason: `unknown side '${side}'`, steps: [], notes };
}

// ---------------------------------------------------------------------------
// planExit — close a leg, given what the wallet holds and what else is open.
//
// LONG close: sell the leg's own size, capped by base that is actually free
// AND not spoken for by the wallet's debt. Selling into the debt would turn
// a long exit into an unplanned short.
//
// SHORT close: buy back and repay. Sized from LIVE DEBT, never the nominal —
// interest means the debt is larger than what was borrowed. If this is the
// last short in the wallet it must clear the whole remaining debt (interest
// from every leg pools onto whoever closes last); if siblings are still open
// it repays only its own share, so it cannot clear a sibling's loan.
//
// A short with no debt behind it is NOT closeable by buying: buying with
// nothing to repay just opens a naked long. That is reported as a decision,
// with the reason, instead of being attempted.
// ---------------------------------------------------------------------------
function planExit({ side, qty, price, wallet, isLastShort = true, rules = BINANCE_ISOLATED }) {
  const w = wallet || {};
  const steps = [];
  const notes = [];
  const freeBase = w.freeBase || 0;
  const debt = w.borrowedBase || 0;

  if (side === 'LONG') {
    const sellable = floorStep(Math.min(qty, Math.max(0, freeBase)), rules.qtyStep);
    if (!(sellable > 0)) {
      return { ok: false, reason: 'no free base to sell; the coin this leg claims is not in the wallet',
               steps: [], notes };
    }
    if (isDust(sellable, price, rules)) {
      return { ok: false, reason: `remaining ${round8(sellable)} is under the venue minimum of `
                                + `${rules.minNotional} — dust, not an error`,
               steps: [], notes, dust: true };
    }
    if (sellable < floorStep(qty, rules.qtyStep)) {
      notes.push(`leg claims ${round8(qty)} but only ${round8(sellable)} is free; selling what exists`);
    }
    steps.push({
      action: 'sell', qty: round8(sellable), sideEffect: 'NO_SIDE_EFFECT',
      why: 'no auto-repay: this is a long being sold, not a short being covered',
    });
    return { ok: true, steps, notes };
  }

  if (side === 'SHORT') {
    if (debt < rules.qtyStep) {
      return {
        ok: false,
        reason: 'no debt outstanding for this short, so there is nothing to buy back — '
              + 'buying now would open a naked long. The loan this leg should have taken '
              + 'was never taken.',
        steps: [], notes, unbacked: true,
      };
    }
    const target = isLastShort ? debt : Math.min(qty, debt);
    const buyQty = ceilStep(target * (1 + rules.closeFeeBuffer), rules.qtyStep);
    if (isDust(buyQty, price, rules)) {
      return { ok: false, reason: `buy-back of ${round8(buyQty)} is under the venue minimum of `
                                + `${rules.minNotional}`,
               steps: [], notes, dust: true };
    }
    steps.push({
      action: 'buy', qty: round8(buyQty), sideEffect: 'AUTO_REPAY',
      why: isLastShort
        ? 'last short in this wallet: clears the entire remaining debt, including the '
        + 'interest that pooled from every leg'
        : 'a sibling short is still open: repays only this leg\'s share, never the pool',
    });
    notes.push(`sized from live debt ${round8(debt)}, not the nominal ${round8(qty)} — interest `
             + 'makes the debt the larger number');
    return { ok: true, steps, notes };
  }

  return { ok: false, reason: `unknown side '${side}'`, steps: [], notes };
}

// ---------------------------------------------------------------------------
// reconcileExpectation — what the wallet SHOULD look like for a set of legs.
//
// The sound invariant is the NET. A wallet carrying both directions cannot
// satisfy two one-sided identities at once, because both draw on one balance:
// the moment a short and a long are open together, free base and debt can each
// be "wrong" while the position is exactly right. Checking them separately is
// what false-halted a correct book.
// ---------------------------------------------------------------------------
function reconcileExpectation(legs, rules = BINANCE_ISOLATED) {
  let longQty = 0, shortQty = 0;
  for (const l of legs || []) {
    if (l.side === 'LONG') longQty += l.qty;
    else if (l.side === 'SHORT') shortQty += l.qty;
  }
  return { longQty: round8(longQty), shortQty: round8(shortQty), net: round8(longQty - shortQty) };
}

// How far the wallet's NET is from the book's net, and whether that gap is
// explainable by dust the venue will not let us trade.
function netDrift({ legs, wallet, price, rules = BINANCE_ISOLATED }) {
  const exp = reconcileExpectation(legs, rules);
  const actual = round8((wallet.freeBase || 0) - (wallet.borrowedBase || 0));
  const drift = round8(actual - exp.net);
  const tolerance = price > 0 ? (rules.minNotional / price) * 1.2 : Infinity;
  return { expectedNet: exp.net, actualNet: actual, drift, tolerance: round8(tolerance),
           withinTolerance: Math.abs(drift) <= tolerance };
}

module.exports = {
  BINANCE_ISOLATED, planEntry, planExit, isDust,
  reconcileExpectation, netDrift, floorStep, ceilStep,
};
