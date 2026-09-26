'use strict';
// engine/venues/simulated.js -- THE SIMULATED EXCHANGE that answers Paper Books
// (owner, 2026-09-25: "the paper books side needs to do exactly what the live
// trading side does except that the calls to the trading server indicate
// simulated trading"; "whatever makes the most sense for the most accurate
// simulation possible"; no practice platform, ever).
//
// It takes the same calls the venue module takes, answers them from simulated
// orders and a simulated wallet, and fills against the venue's LIVE market:
//   * a market order is filled by walking the live order book for its size --
//     buys up the asks, sells down the bids -- so a large order pays for the
//     depth it eats, as it would live;
//   * the delay the live venue takes to fill (measured by the probe) is waited
//     out before the book is read, so paper pays for the time live pays for;
//   * the venue's own steps and minimums are applied, so paper refuses what
//     live would refuse;
//   * the account's own fee is charged on each leg, and a short owes borrowing
//     by the hour at the rate the venue quotes (read live by the venue module;
//     where it has not been read, each record says so rather than guess);
//   * every fill records what it was filled against -- the levels it took, the
//     book's age, the best prices and the last trade -- so its accuracy can be
//     checked.
// The engine decides WHEN to send an order (when a printed trade reaches a
// level); this module decides only what the order would have cost.
const MODE = 'simulated';

const floorToStep = (q, step) => (step > 0 ? Math.floor(q / step + 1e-9) * step : q);

class SimulatedExchange {
  constructor({ market, feePerLeg, delayMs = 0, maxBookAgeMs = 3000, borrowRateHr = null, borrowRateSource = null, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    this.market = market;
    this.feePerLeg = feePerLeg;
    this.delayMs = delayMs;
    this.maxBookAgeMs = maxBookAgeMs;
    this.borrowRateHr = borrowRateHr;
    this.borrowRateSource = borrowRateSource;
    this.now = now;
    this.sleep = sleep;
    this.wallets = new Map();
  }

  // what this exchange holds orders for natively: nothing -- the engine watches and sends
  capabilities() { return { name: 'simulated', nativeStop: false, nativeTrailing: false, linkedOrders: false, shorts: true }; }

  wallet(setupId, startUsd = null) {
    if (!this.wallets.has(setupId)) this.wallets.set(setupId, { setupId, quote: Number(startUsd) || 0, base: 0, borrowed: 0, feesUsd: 0, interestUsd: 0 });
    return this.wallets.get(setupId);
  }

  // the levels a quantity takes off one side of the book, and what they cost
  static walk(levels, qty) {
    let left = qty;
    let cost = 0;
    const took = [];
    for (const [price, avail] of levels) {
      if (left <= 1e-12) break;
      const q = Math.min(left, avail);
      took.push([price, q]);
      cost += price * q;
      left -= q;
    }
    return { took, cost, short: left > 1e-12 ? left : 0 };
  }

  async placeOrder(o) {
    if (o.mode !== MODE) return { status: 'refused', why: `this is the simulated exchange and the order says ${JSON.stringify(o.mode)}` };
    if (this.delayMs > 0) await this.sleep(this.delayMs);
    const book = this.market.book(o.symbol);
    const at = this.now();
    if (!book || !book.asks.length || !book.bids.length) return { status: 'refused', why: 'no live order book for this symbol yet' };
    const age = at - book.ts;
    if (age > this.maxBookAgeMs) return { status: 'refused', why: `the live order book is ${Math.round(age / 1000)} seconds old` };
    let f;
    try { f = await this.market.filtersOf(o.symbol); } catch (e) { return { status: 'refused', why: e.message }; }
    const bestAsk = book.asks[0][0];
    const bestBid = book.bids[0][0];
    const buying = o.side === 'BUY';
    let qty = o.qty != null ? Number(o.qty) : floorToStep(Number(o.quoteUsd) / (buying ? bestAsk : bestBid), f.stepSize);
    qty = floorToStep(qty, f.stepSize);
    if (!(qty > 0) || (f.minQty && qty < f.minQty - 1e-12)) return { status: 'refused', why: `the quantity ${qty} is under the exchange's smallest step or quantity` };
    const w = Walk(buying ? book.asks : book.bids, qty);
    if (w.short > 0) return { status: 'refused', why: `the live order book's top ${buying ? book.asks.length : book.bids.length} levels hold less than ${qty}` };
    const price = w.cost / qty;
    const notional = price * qty;
    if (f.minNotional && notional < f.minNotional) return { status: 'refused', why: `the order is worth ${notional.toFixed(2)}, under the exchange's smallest order of ${f.minNotional}` };
    // THE FEE THE ORDER CARRIES: the account's own, read from the venue with its
    // key, or else the setup's; the engine's own setting only when neither came
    const feePerLeg = Number.isFinite(o.feePerLeg) ? o.feePerLeg : this.feePerLeg;
    const feeSource = Number.isFinite(o.feePerLeg) ? (o.feeSource || 'the setup') : 'the platform\'s own setting';
    const feeUsd = notional * feePerLeg;
    const wal = this.wallet(o.setupId, o.walletStartUsd);
    // the wallet moves as a margin wallet would: a long buys with quote; a short
    // borrows the coin and sells it; closing buys back and repays
    if (o.purpose === 'enter' && buying) { wal.quote -= notional + feeUsd; wal.base += qty; }
    else if (o.purpose === 'enter') { wal.borrowed += qty; wal.quote += notional - feeUsd; wal.borrowedAt = at; }
    else if (buying) { wal.quote -= notional + feeUsd; wal.borrowed = Math.max(0, wal.borrowed - qty); }
    else { wal.quote += notional - feeUsd; wal.base = Math.max(0, wal.base - qty); }
    wal.feesUsd += feeUsd;
    const last = this.market.trade(o.symbol);
    return {
      status: 'filled', mode: MODE, price, qty, feeUsd, ts: at,
      against: {
        levels: w.took, bookTs: book.ts, bookAgeMs: age, bestBid, bestAsk, lastTrade: last ? { price: last.price, ts: last.ts } : null,
        bookShort: w.short || 0, delayMs: this.delayMs, atLevel: o.atLevel ?? null, feePerLeg, feeSource,
      },
    };
  }

  // THE BORROWING RATE a short is charged by the hour: the one the venue quotes,
  // read live by the venue module and handed here; null until it has been read,
  // and every hour charged without it is recorded as unpriced, never guessed
  borrowRate() { return { rate: this.borrowRateHr, source: this.borrowRateSource }; }
  setBorrowRate(rate, source) { this.borrowRateHr = rate; this.borrowRateSource = source; }

  // money taken from a simulated wallet for something that is not an order: the borrowing on a short
  charge(setupId, usd, what) {
    const wal = this.wallet(setupId);
    wal.quote -= usd;
    if (what === 'interest') wal.interestUsd += usd;
    return wal;
  }
}
const Walk = (levels, qty) => SimulatedExchange.walk(levels, qty);

module.exports = { SimulatedExchange, floorToStep, MODE };
