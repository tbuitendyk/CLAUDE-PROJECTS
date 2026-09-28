'use strict';
// engine/venues/binance-live.js -- THE LIVE EXCHANGE MODULE: real orders on
// Binance margin, sent with the trading account's own keys out of the key store
// (loop of 2026-09-25, stage D; owner 2026-09-28: fix "this release of the
// platform places no real orders"). Until this file there was nothing on the
// platform that placed one, and every screen that said so was telling the truth.
//
// ONE PATH WITH PAPER (S2, and item 2 of the read-back). The engine's order
// logic has no branch on mode: it decides WHEN to send, hands the same order
// action to whichever module the plan's mode names, and this module decides only
// what that order does on the exchange. So the size is worked out here exactly as
// engine/venues/simulated.js works it out -- the same step, the same smallest
// quantity, the same smallest order, off the same live order book -- and a
// refusal reads in the same words. What differs is the last step, and only that:
// paper moves a wallet of its own, this sends the order to Binance.
//
// WHAT IT SENDS, and nothing else: one market order per leg, because the engine
// watches the price itself and sends the moment a printed trade reaches a level
// (D1). It holds nothing on the exchange -- no resting stop, no trailing stop,
// no pair of orders where one cancels the other -- and says so in capabilities(),
// so the engine keeps doing that work. A venue module may hold them natively one
// day, behind the same action, chosen from what the probe shows (item 8).
//
// WHAT THE ORDER DOES TO THE POT is the same arithmetic paper does to its own
// wallet: a long buys with the account's own quote; a short borrows the coin and
// sells it; closing a short buys it back and repays; closing a long sells what it
// holds. Binance is told which of those it is on every order.
//
// THE POT IS NEVER GUESSED. Cross and isolated are different money on Binance.
// An account whose margin was not recorded is REFUSED IN WORDS, exactly as its
// keyed reads are, rather than having a real order aimed at the wrong pot.
//
// A RESTART CANNOT DOUBLE A POSITION. Every order carries a name of its own,
// worked out from the plan's own order id and from nothing else, so the same
// order sent twice is the same name twice and Binance keeps the first. And
// ANYTHING BUT A CLEAN ANSWER IS ASKED ABOUT BEFORE IT IS CALLED A REFUSAL: a
// timeout, a dropped connection or a 5xx can each leave a real order standing,
// and money in the market that the platform believes was never sent is the one
// failure this module must not have.
//
// No AI anywhere: deterministic arithmetic over printed prices and the
// exchange's own answer.
const crypto = require('crypto');
const net = require('../net');
const { binanceWords, REST } = require('./binance-account');
const { floorToStep } = require('./simulated');

const MODE = 'live';
// Binance takes a client's own name for an order: 36 characters of a short
// alphabet. A plan's order id is neither, so the name is worked out from it --
// the same id always gives the same name, which is what makes a repeat safe.
const nameOf = (orderId) => `uts${crypto.createHash('sha256').update(String(orderId)).digest('hex').slice(0, 20)}`;
// the exchange saying it has never heard of an order: an answer, not a failure
const NO_SUCH_ORDER = -2013;

// WHAT THE FILLS COST, in the money the account counts in. Binance charges each
// fill in one asset: the quote asset (already the money), the coin itself
// (priced at the price that fill got, which is the same trade), or something
// else -- BNB, most often -- which cannot be priced here without asking another
// question. What cannot be priced is never guessed: it is carried out whole,
// asset and amount, and left out of the money.
function feeOf(fills, { baseAsset, quoteAsset }) {
  let usd = 0;
  const unpriced = [];
  for (const x of fills) {
    const c = Number(x.commission);
    const asset = x.commissionAsset;
    if (!Number.isFinite(c) || c === 0) continue;
    if (asset === quoteAsset) usd += c;
    else if (asset === baseAsset) usd += c * Number(x.price);
    else {
      const had = unpriced.find((y) => y.asset === asset);
      if (had) had.amount += c; else unpriced.push({ asset, amount: c });
    }
  }
  return { usd, unpriced };
}

class BinanceLive {
  // `keys` is asked for one account's signer and which pot it trades; it is the
  // key store and nothing else ever holds a secret half here.
  constructor({ market, keys, rest = REST, request = net.request, now = () => Date.now(), recvWindow = 5000, maxBookAgeMs = 3000, resyncMs = 30 * 60000, chases = 3 } = {}) {
    if (typeof keys !== 'function') throw new Error('a way to reach each account\'s signer and its pot is needed');
    this.venue = 'Binance';
    this.market = market;
    this.keys = keys;
    this.rest = rest;
    this.request = request;
    this.now = now;
    this.recvWindow = recvWindow;
    this.maxBookAgeMs = maxBookAgeMs;
    this.resyncMs = resyncMs;
    this.chases = chases;
    this.offset = 0;
    this.syncedAt = 0;
    this.borrowRateHr = null;
    this.borrowRateSource = null;
  }

  // WHAT THIS MODULE HOLDS ON THE EXCHANGE: nothing. The engine watches and
  // sends (D1). Stated rather than assumed, so the engine never stops doing a
  // job in the belief that the venue is doing it.
  capabilities() { return { name: 'binance', mode: MODE, nativeStop: false, nativeTrailing: false, linkedOrders: false, shorts: true }; }

  // the same two the simulated module has: the runner prefers the rate quoted to
  // the account itself (read with its key) and falls back to these
  borrowRate() { return { rate: this.borrowRateHr, source: this.borrowRateSource }; }
  setBorrowRate(rate, source) { this.borrowRateHr = rate; this.borrowRateSource = source; }

  // Binance refuses a signed request whose time is off by more than the window
  async syncClock() {
    const r = await this.request('GET', `${this.rest}/api/v3/time`);
    if (r.status === 200 && r.json && Number.isFinite(r.json.serverTime)) { this.offset = r.json.serverTime - this.now(); this.syncedAt = this.now(); }
    return { ok: r.status === 200, offsetMs: this.offset };
  }

  async signed(method, path, params, signer, purpose) {
    if (this.now() - this.syncedAt > this.resyncMs) await this.syncClock();
    const q = new URLSearchParams({ ...params, timestamp: String(this.now() + this.offset), recvWindow: String(this.recvWindow) }).toString();
    const sig = signer.sign(q, purpose);
    return this.request(method, `${this.rest}${path}?${q}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': signer.header() } });
  }

  // ---- one real order ------------------------------------------------------
  async placeOrder(o) {
    if (o.mode !== MODE) return { status: 'refused', why: `this is the live exchange and the order says ${JSON.stringify(o.mode)}` };
    if (!o.account) return { status: 'refused', why: 'this setup names no trading account in Sub-account key, so there is no key to sign a real order with' };
    let signer = null;
    let margin = null;
    try { ({ signer = null, margin = null } = this.keys(o.account) || {}); } catch (e) { return { status: 'refused', why: e.message }; }
    if (!signer) return { status: 'refused', why: `no keys are kept on this platform for the trading account ${o.account}` };
    if (margin !== 'cross' && margin !== 'isolated') return { status: 'refused', why: `this account's margin is not recorded on this platform, so a real order cannot be sent to the right pot: send ${o.account}'s keys again so the choice made on its checklist travels with them` };
    let f;
    try { f = await this.market.filtersOf(o.symbol); } catch (e) { return { status: 'refused', why: e.message }; }

    // THE SIZE, worked out as paper works it out. An exit is the quantity held;
    // an entry is the money the plan was sized at, over the price it would pay.
    const book = this.market.book(o.symbol);
    const at = this.now();
    const buying = o.side === 'BUY';
    let want;
    if (o.qty != null) want = Number(o.qty);
    else {
      if (!book || !book.asks.length || !book.bids.length) return { status: 'refused', why: 'no live order book for this symbol yet' };
      const age = at - book.ts;
      if (age > this.maxBookAgeMs) return { status: 'refused', why: `the live order book is ${Math.round(age / 1000)} seconds old` };
      want = Number(o.quoteUsd) / (buying ? book.asks[0][0] : book.bids[0][0]);
    }
    want = floorToStep(want, f.stepSize);
    if (!(want > 0) || (f.minQty && want < f.minQty - 1e-12)) return { status: 'refused', why: `the quantity ${want} is under the exchange's smallest step or quantity` };
    const ref = book && book.asks.length && book.bids.length ? (buying ? book.asks[0][0] : book.bids[0][0]) : null;
    if (ref != null && f.minNotional && ref * want < f.minNotional) return { status: 'refused', why: `the order is worth ${(ref * want).toFixed(2)}, under the exchange's smallest order of ${f.minNotional}` };

    // WHAT THE ORDER DOES TO THE POT, in Binance's own words for it
    const sideEffect = o.purpose === 'enter' ? (buying ? 'NO_SIDE_EFFECT' : 'MARGIN_BUY') : (buying ? 'AUTO_REPAY' : 'NO_SIDE_EFFECT');
    const name = nameOf(o.orderId);

    // AN EXIT THAT FILLS SHORT IS CHASED. A market order the book cannot fill
    // whole leaves the rest unfilled, and on the way out that is real coin
    // nobody is managing -- so the remainder is sent again, under a name of its
    // own, a bounded number of times. An entry is never chased: a smaller
    // position is honest, spending more than the plan's size is not.
    const tries = o.purpose === 'exit' ? 1 + this.chases : 1;
    const parts = [];
    let why = null;
    let left = want;
    for (let i = 0; i < tries && left > 1e-12; i++) {
      const bit = floorToStep(left, f.stepSize);
      if (!(bit > 0) || (f.minQty && bit < f.minQty - 1e-12)) break;
      const p = await this.one(o, { signer, margin, qty: bit, name: i === 0 ? name : `${name}r${i}`, sideEffect, filters: f });
      if (p.status !== 'filled') { why = p.why; break; }
      parts.push(p);
      left = want - parts.reduce((a, x) => a + x.qty, 0);
    }
    const qty = parts.reduce((a, x) => a + x.qty, 0);
    if (!(qty > 0)) return { status: 'refused', why: why || 'the exchange filled none of it' };

    const cost = parts.reduce((a, x) => a + x.price * x.qty, 0);
    const feeUsd = parts.reduce((a, x) => a + x.feeUsd, 0);
    const unpriced = [];
    for (const p of parts) for (const u of p.unpriced) { const had = unpriced.find((y) => y.asset === u.asset); if (had) had.amount += u.amount; else unpriced.push({ ...u }); }
    const last = this.market.trade(o.symbol);
    return {
      status: 'filled', mode: MODE, price: cost / qty, qty, feeUsd, ts: parts[parts.length - 1].ts,
      against: {
        venue: this.venue, margin, sideEffect, orderName: name, asked: want, short: Math.max(0, want - qty),
        parts: parts.map((p) => ({ name: p.name, exchangeOrderId: p.exchangeOrderId, said: p.said, price: p.price, qty: p.qty, feeUsd: p.feeUsd, status: p.exStatus, levels: p.levels, confirmed: p.confirmed || false })),
        // what the fee really was, and anything Binance charged in an asset this
        // platform cannot price without asking another question: never guessed
        feeSource: 'Binance, what it charged on the fills', feeUnpriced: unpriced,
        bookTs: book ? book.ts : null, bookAgeMs: book ? at - book.ts : null,
        bestBid: book && book.bids.length ? book.bids[0][0] : null, bestAsk: book && book.asks.length ? book.asks[0][0] : null,
        lastTrade: last ? { price: last.price, ts: last.ts } : null, atLevel: o.atLevel ?? null,
        ...(why ? { thenRefused: why } : {}),
      },
    };
  }

  // ONE ORDER SENT, AND THE ANSWER MADE SURE OF
  async one(o, { signer, margin, qty, name, sideEffect, filters }) {
    const params = {
      symbol: o.symbol, side: o.side, type: 'MARKET', quantity: String(qty),
      newClientOrderId: name, sideEffectType: sideEffect, newOrderRespType: 'FULL',
      ...(margin === 'isolated' ? { isIsolated: 'TRUE' } : {}),
    };
    const purpose = `a real ${o.side} of ${qty} ${o.symbol} on ${margin} margin (${o.purpose})`;
    const r = await this.signed('POST', '/sapi/v1/margin/order', params, signer, purpose);
    if (r.status === 200) return this.read(r.json, { name, filters });
    // NOT A CLEAN ANSWER: the exchange is asked whether the order stands before
    // any of this is called a refusal. A name already taken lands here too, and
    // the order it names is this plan's own order sent again after a restart.
    const said = binanceWords(r);
    const back = await this.ask({ signer, margin, symbol: o.symbol, name });
    if (back.found) return { ...this.read(back.order, { name, filters }), said, confirmed: true };
    if (back.unsure) return { status: 'refused', why: `${said}; and the exchange could not then be asked whether the order stands (${back.why}), so nothing further was sent under its name` };
    return { status: 'refused', why: said };
  }

  // does an order of this name stand on the exchange?
  async ask({ signer, margin, symbol, name }) {
    const r = await this.signed('GET', '/sapi/v1/margin/order', { symbol, origClientOrderId: name, ...(margin === 'isolated' ? { isIsolated: 'TRUE' } : {}) }, signer, `asking whether the order named ${name} stands`);
    if (r.status === 200 && r.json && r.json.clientOrderId === name) return { found: true, order: r.json };
    if (r.json && Number(r.json.code) === NO_SUCH_ORDER) return { found: false };
    return { unsure: true, why: binanceWords(r) };
  }

  // Binance's answer about one order, in the shape the runner's fill is built from
  read(j, { name, filters }) {
    const executed = Number(j && j.executedQty);
    const spent = Number(j && j.cummulativeQuoteQty);
    const fills = Array.isArray(j && j.fills) ? j.fills : [];
    const exStatus = (j && j.status) || 'no status';
    if (!Number.isFinite(executed) || executed <= 0) return { status: 'refused', why: `the exchange took the order and filled none of it (${exStatus})` };
    const price = Number.isFinite(spent) && spent > 0 ? spent / executed
      : fills.reduce((a, x) => a + Number(x.price) * Number(x.qty), 0) / executed;
    const fee = feeOf(fills, filters);
    return {
      status: 'filled', name, exchangeOrderId: (j && j.orderId) != null ? String(j.orderId) : null, exStatus,
      price, qty: executed, feeUsd: fee.usd, unpriced: fee.unpriced,
      levels: fills.map((x) => [Number(x.price), Number(x.qty)]),
      ts: Number.isFinite(Number(j && j.transactTime)) ? Number(j.transactTime) : this.now(),
    };
  }
}

module.exports = { BinanceLive, nameOf, feeOf, MODE };
