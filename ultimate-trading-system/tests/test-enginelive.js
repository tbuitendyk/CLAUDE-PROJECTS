'use strict';
// tests/test-enginelive.js -- THE LIVE EXCHANGE MODULE (engine/venues/binance-live.js).
// Nothing here reaches an exchange: every request is answered by a stub that
// records what was asked, so what is checked is the arithmetic, the words of a
// refusal and the shape of what goes out.
const assert = require('assert');
const { BinanceLive, nameOf, feeOf } = require('../engine/venues/binance-live');

const FILTERS = { tickSize: 0.01, stepSize: 0.001, minQty: 0.001, minNotional: 5, baseAsset: 'LTC', quoteAsset: 'USDT' };
function fakeMarket(now) {
  return {
    books: new Map([['LTCUSDT', { bids: [[72.6, 5]], asks: [[72.7, 5]], ts: now }]]),
    book(s) { return this.books.get(s) || null; },
    trade: () => ({ price: 72.63, ts: now }),
    filtersOf: async () => FILTERS,
  };
}
// one order's answer, in Binance's own shape
const answer = (over = {}) => ({
  symbol: 'LTCUSDT', orderId: 991, clientOrderId: over.clientOrderId || null, transactTime: 1700000000000,
  status: 'FILLED', type: 'MARKET', side: 'BUY', origQty: '1.375', executedQty: '1.375', cummulativeQuoteQty: '100.05',
  fills: [{ price: '72.7', qty: '0.500', commission: '0.03635', commissionAsset: 'USDT' },
    { price: '72.8', qty: '0.875', commission: '0.000875', commissionAsset: 'LTC' }],
  ...over,
});
// a stub exchange: every call recorded, answered from a list of replies
function stub(replies) {
  const seen = [];
  const request = async (method, url, opts) => {
    const u = new URL(url);
    if (u.pathname === '/api/v3/time') return { status: 200, json: { serverTime: 1700000000000 }, ms: 1 };
    const q = Object.fromEntries(u.searchParams.entries());
    seen.push({ method, path: u.pathname, q, header: (opts && opts.headers && opts.headers['X-MBX-APIKEY']) || null });
    const r = replies.shift();
    if (!r) throw new Error(`no reply left for ${method} ${u.pathname}`);
    if (r.json && r.json.clientOrderId === null) r.json.clientOrderId = q.newClientOrderId || q.origClientOrderId || null;
    return { ms: 2, ...r };
  };
  return { seen, request };
}
const signed = [];
const signer = { header: () => 'PUBLIC-HALF', sign: (payload, why) => { signed.push({ payload, why }); return 'SIG'; } };
const liveOn = (replies, margin, extra = {}) => {
  const now = 1700000000000;
  const s = stub(replies);
  const mod = new BinanceLive({ market: fakeMarket(now), keys: () => ({ signer, margin }), request: s.request, now: () => now, ...extra });
  return { mod, seen: s.seen };
};
const enter = { mode: 'live', orderId: 'setup-a|2026-09-22#1', account: 'binance-sub-1', symbol: 'LTCUSDT', side: 'BUY', purpose: 'enter', type: 'market', quoteUsd: 100, qty: null, atLevel: 72.625 };
const exit = { ...enter, orderId: 'setup-a|2026-09-22#2', side: 'SELL', purpose: 'exit', quoteUsd: null, qty: 1.375 };

module.exports = {
  // ONE MARKET ORDER PER LEG, sized exactly as paper sizes it, aimed at the pot
  // the account actually trades, and named from the plan's own order id
  async aRealOrderIsOneMarketOrderSizedAsPaperSizesItAndAimedAtTheAccountsOwnPot() {
    const { mod, seen } = liveOn([{ status: 200, json: answer({ clientOrderId: null }) }], 'cross');
    const r = await mod.placeOrder(enter);
    assert.strictEqual(r.status, 'filled');
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].method, 'POST');
    assert.strictEqual(seen[0].path, '/sapi/v1/margin/order');
    assert.strictEqual(seen[0].header, 'PUBLIC-HALF', 'the public half goes in the header');
    // 100 / 72.7 floored to the exchange's step, exactly as the simulated module floors it
    assert.deepStrictEqual([seen[0].q.symbol, seen[0].q.side, seen[0].q.type, seen[0].q.quantity], ['LTCUSDT', 'BUY', 'MARKET', '1.375']);
    assert.strictEqual(seen[0].q.newClientOrderId, nameOf(enter.orderId), 'the order carries a name worked out from the plan\'s order id');
    assert.ok(/^[.A-Za-z0-9_:/-]{1,36}$/.test(seen[0].q.newClientOrderId), 'and it is a name the exchange takes');
    assert.strictEqual(seen[0].q.isIsolated, undefined, 'a cross account is never told isIsolated');
    assert.ok(seen[0].q.signature === undefined ? false : true, 'every request is signed');
    // what it cost: the money spent over what was filled, and the fees charged
    assert.ok(Math.abs(r.price - 100.05 / 1.375) < 1e-12, String(r.price));
    assert.strictEqual(r.qty, 1.375);
    assert.ok(Math.abs(r.feeUsd - (0.03635 + 0.000875 * 72.8)) < 1e-12, String(r.feeUsd));
    assert.deepStrictEqual([r.against.margin, r.against.sideEffect, r.against.short, r.against.atLevel], ['cross', 'NO_SIDE_EFFECT', 0, 72.625]);
    assert.deepStrictEqual(r.against.parts.map((p) => [p.qty, p.status]), [[1.375, 'FILLED']]);
    // AN ISOLATED ACCOUNT SAYS SO, on the order and on nothing else
    const iso = liveOn([{ status: 200, json: answer({ clientOrderId: null }) }], 'isolated');
    await iso.mod.placeOrder(enter);
    assert.strictEqual(iso.seen[0].q.isIsolated, 'TRUE');
  },

  // WHAT AN ORDER DOES TO THE POT is the same arithmetic paper does to its own
  // wallet: a long buys with quote, a short borrows and sells, closing a short
  // repays, closing a long sells what is held
  async whatARealOrderDoesToThePotIsWhatPaperDoesToItsWallet() {
    const of = async (o) => {
      const { mod, seen } = liveOn([{ status: 200, json: answer({ clientOrderId: null }) }], 'cross');
      await mod.placeOrder(o);
      return seen[0].q.sideEffectType;
    };
    assert.strictEqual(await of({ ...enter, side: 'BUY', purpose: 'enter' }), 'NO_SIDE_EFFECT', 'a long buys with the account\'s own money');
    assert.strictEqual(await of({ ...enter, side: 'SELL', purpose: 'enter' }), 'MARGIN_BUY', 'a short borrows the coin and sells it');
    assert.strictEqual(await of({ ...exit, side: 'BUY', purpose: 'exit' }), 'AUTO_REPAY', 'closing a short buys it back and repays');
    assert.strictEqual(await of({ ...exit, side: 'SELL', purpose: 'exit' }), 'NO_SIDE_EFFECT', 'closing a long sells what it holds');
  },

  // NOTHING IS SENT THAT CANNOT BE AIMED OR SIGNED, and each refusal says what to do
  async aRealOrderIsNeverSentUntilItCanBeAimedAndSigned() {
    const unrecorded = liveOn([], null);
    const a = await unrecorded.mod.placeOrder(enter);
    assert.strictEqual(a.status, 'refused');
    assert.ok(/margin is not recorded on this platform/.test(a.why) && /send binance-sub-1's keys again/.test(a.why), a.why);
    assert.deepStrictEqual(unrecorded.seen, [], 'and the exchange is asked nothing at all');
    const noKeys = { mod: new BinanceLive({ market: fakeMarket(0), keys: () => { const e = new Error('no keys are stored for the trading account binance-sub-1'); throw e; }, request: async () => { throw new Error('nothing should be sent'); } }) };
    assert.ok(/no keys are stored/.test((await noKeys.mod.placeOrder(enter)).why));
    const noAccount = liveOn([], 'cross');
    const c = await noAccount.mod.placeOrder({ ...enter, account: null });
    assert.ok(/names no trading account in Sub-account key/.test(c.why), c.why);
    assert.deepStrictEqual(noAccount.seen, []);
    // and a simulated order never reaches the live module, whatever else it says
    const wrong = liveOn([], 'cross');
    assert.ok(/this is the live exchange and the order says "simulated"/.test((await wrong.mod.placeOrder({ ...enter, mode: 'simulated' })).why));
    assert.deepStrictEqual(wrong.seen, []);
  },

  // A RESTART CANNOT DOUBLE A POSITION: the same plan's order has the same name,
  // and anything but a clean answer is asked about before it is called a refusal
  async anOrderThatMayStandIsAskedAboutBeforeItIsCalledARefusal() {
    // the exchange already holds this name -- the order this plan sent before a restart
    const dup = liveOn([
      { status: 400, json: { code: -2010, msg: 'Duplicate order sent.' } },
      { status: 200, json: answer({ clientOrderId: nameOf(enter.orderId) }) },
    ], 'cross');
    const r = await dup.mod.placeOrder(enter);
    assert.strictEqual(r.status, 'filled', 'the order that already stands is the fill, not a second order');
    assert.deepStrictEqual(dup.seen.map((x) => [x.method, x.path]), [['POST', '/sapi/v1/margin/order'], ['GET', '/sapi/v1/margin/order']]);
    assert.strictEqual(dup.seen[1].q.origClientOrderId, nameOf(enter.orderId));
    assert.deepStrictEqual([r.against.parts[0].confirmed, /Duplicate order sent/.test(r.against.parts[0].said)], [true, true]);
    // no answer at all, and the order did land: the fill is read back, never sent again
    const lost = liveOn([
      { status: 0, json: null, text: 'socket hang up' },
      { status: 200, json: answer({ clientOrderId: nameOf(enter.orderId) }) },
    ], 'cross');
    assert.strictEqual((await lost.mod.placeOrder(enter)).status, 'filled');
    // no answer, and the exchange has never heard of it: a true refusal
    const never = liveOn([
      { status: 0, json: null, text: 'socket hang up' },
      { status: 400, json: { code: -2013, msg: 'Order does not exist.' } },
    ], 'cross');
    const n = await never.mod.placeOrder(enter);
    assert.ok(n.status === 'refused' && /Binance did not answer: socket hang up/.test(n.why), n.why);
    // no answer, and the exchange cannot be asked either: said as exactly that
    const unsure = liveOn([
      { status: 503, json: null, text: 'Service Unavailable' },
      { status: 0, json: null, text: 'socket hang up' },
    ], 'cross');
    const u = await unsure.mod.placeOrder(enter);
    assert.ok(u.status === 'refused' && /could not then be asked whether the order stands/.test(u.why) && /nothing further was sent under its name/.test(u.why), u.why);
  },

  // AN EXIT THAT FILLS SHORT IS CHASED -- real coin on the way out is nobody's
  // otherwise -- AND AN ENTRY IS NOT: a smaller position is honest, spending
  // more than the plan's size is not
  async anExitThatFillsShortIsChasedAndAnEntryIsNot() {
    const part = (qty, spent, st) => answer({ clientOrderId: null, status: st, executedQty: String(qty), cummulativeQuoteQty: String(spent), fills: [{ price: String(spent / qty), qty: String(qty), commission: '0', commissionAsset: 'USDT' }] });
    const out = liveOn([{ status: 200, json: part(1, 72.6, 'EXPIRED') }, { status: 200, json: part(0.375, 27.2, 'FILLED') }], 'cross');
    const r = await out.mod.placeOrder(exit);
    assert.deepStrictEqual([r.status, r.qty, r.against.short], ['filled', 1.375, 0]);
    assert.deepStrictEqual(out.seen.map((x) => x.q.quantity), ['1.375', '0.375'], 'the rest is sent again, and only the rest');
    assert.strictEqual(out.seen[1].q.newClientOrderId, `${nameOf(exit.orderId)}r1`, 'under a name of its own');
    assert.ok(Math.abs(r.price - (72.6 + 27.2) / 1.375) < 1e-9, String(r.price));
    // the chase is bounded: it stops, says how much stood, and never runs on
    const stuck = liveOn([1, 2, 3, 4].map(() => ({ status: 200, json: part(0.2, 14.5, 'EXPIRED') })), 'cross');
    const s = await stuck.mod.placeOrder(exit);
    assert.deepStrictEqual([stuck.seen.length, s.qty, Math.round(s.against.short * 1000)], [4, 0.8, 575]);
    // an entry is sent once, and what did not fill is written down
    const inn = liveOn([{ status: 200, json: part(1, 72.7, 'EXPIRED') }], 'cross');
    const i = await inn.mod.placeOrder(enter);
    assert.deepStrictEqual([inn.seen.length, i.qty, i.against.short], [1, 1, 0.375]);
  },

  // THE FEE IS WHAT BINANCE CHARGED, and what cannot be priced here is carried
  // out whole rather than guessed at
  theFeeIsWhatBinanceChargedAndWhatCannotBePricedIsNeverGuessed() {
    const f = feeOf([
      { price: '72.7', qty: '0.5', commission: '0.05', commissionAsset: 'USDT' },
      { price: '72.8', qty: '0.5', commission: '0.001', commissionAsset: 'LTC' },
      { price: '72.8', qty: '0.5', commission: '0.004', commissionAsset: 'BNB' },
      { price: '72.8', qty: '0.5', commission: '0.006', commissionAsset: 'BNB' },
      { price: '72.8', qty: '0.5', commission: '0', commissionAsset: 'USDT' },
    ], FILTERS);
    assert.ok(Math.abs(f.usd - (0.05 + 0.001 * 72.8)) < 1e-12, String(f.usd));
    assert.deepStrictEqual(f.unpriced, [{ asset: 'BNB', amount: 0.01 }], 'BNB cannot be priced without another question, so it is named and left out of the money');
  },

  // WHAT THIS MODULE HOLDS ON THE EXCHANGE: nothing. Stated, so the engine never
  // stops watching in the belief that the venue is watching for it.
  theLiveModuleHoldsNothingOnTheExchangeAndSaysSo() {
    const { mod } = liveOn([], 'cross');
    assert.deepStrictEqual(mod.capabilities(), { name: 'binance', mode: 'live', nativeStop: false, nativeTrailing: false, linkedOrders: false, shorts: true });
    assert.deepStrictEqual(mod.borrowRate(), { rate: null, source: null }, 'and it quotes no borrowing rate until one is read');
    mod.setBorrowRate(0.00001, 'Binance');
    assert.deepStrictEqual(mod.borrowRate(), { rate: 0.00001, source: 'Binance' });
  },
};
