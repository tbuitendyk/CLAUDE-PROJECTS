'use strict';
// engine/venues/binance-account.js -- WHAT BINANCE SAYS ABOUT ONE TRADING
// ACCOUNT, asked with that account's own keys from the engine's key store
// (loop of 2026-09-25, stage C). Reads only, every one a GET:
//   * the account's fee on a pair (what a paper position pays each way, item 5);
//   * the hourly borrowing rate Binance quotes this account on an isolated pair
//     (what a paper short owes by the hour, D7);
//   * the isolated wallet and the open orders on a pair.
// A read that fails says why in Binance's own words; nothing is ever guessed in
// its place. The secret half of the key never reaches this file: the key
// store's signer signs each request, and records each use with what it was for.
const net = require('../net');

const REST = 'https://api.binance.com';

// Binance's own words for a refusal, or the transport's
function binanceWords(r) {
  if (!r || r.status === 0) return `Binance did not answer: ${(r && r.text) || 'no reason given'}`;
  const j = r.json || {};
  return `Binance answered ${r.status}${j.code != null ? ` (${j.code})` : ''}: ${j.msg || r.text || 'no words'}`;
}

class BinanceAccount {
  constructor({ signer, rest = REST, request = net.request, now = () => Date.now(), recvWindow = 5000 } = {}) {
    if (!signer || typeof signer.sign !== 'function' || typeof signer.header !== 'function') throw new Error('a signer from the key store is needed');
    this.venue = 'Binance';
    this.signer = signer;
    this.rest = rest;
    this.request = request;
    this.now = now;
    this.recvWindow = recvWindow;
    this.offset = 0;
  }

  // Binance refuses a signed request whose time is off by more than the window
  async syncClock() {
    const r = await this.request('GET', `${this.rest}/api/v3/time`);
    if (r.status === 200 && r.json && Number.isFinite(r.json.serverTime)) this.offset = r.json.serverTime - this.now();
    return { ok: r.status === 200, offsetMs: this.offset, ms: r.ms };
  }

  async get(path, params, purpose) {
    const q = new URLSearchParams({ ...params, timestamp: String(this.now() + this.offset), recvWindow: String(this.recvWindow) }).toString();
    const sig = this.signer.sign(q, purpose);
    return this.request('GET', `${this.rest}${path}?${q}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': this.signer.header() } });
  }

  static answer(r, pick) {
    if (r.status !== 200) return { ok: false, why: binanceWords(r), ms: r.ms };
    try { return { ok: true, ms: r.ms, ...pick(r.json) }; } catch (e) { return { ok: false, why: `Binance's answer could not be read: ${e.message}`, ms: r.ms }; }
  }

  // the account's fee each way on a pair, as a fraction of the money traded
  async fee(symbol) {
    const r = await this.get('/sapi/v1/asset/tradeFee', { symbol }, `the fee on ${symbol}`);
    return BinanceAccount.answer(r, (j) => {
      const x = (Array.isArray(j) ? j : []).find((y) => y.symbol === symbol);
      if (!x) throw new Error(`no fee listed for ${symbol}`);
      const maker = Number(x.makerCommission);
      const taker = Number(x.takerCommission);
      if (!Number.isFinite(maker) || !Number.isFinite(taker)) throw new Error(`the fee for ${symbol} is not a number`);
      return { symbol, maker, taker };
    });
  }

  // the rate Binance will charge this account for the next hour of borrowing one asset, isolated
  async hourlyRate(asset) {
    const r = await this.get('/sapi/v1/margin/next-hourly-interest-rate', { assets: asset, isIsolated: 'TRUE' }, `the hourly borrowing rate on ${asset}`);
    return BinanceAccount.answer(r, (j) => {
      const x = (Array.isArray(j) ? j : []).find((y) => y.asset === asset);
      if (!x) throw new Error(`no rate listed for ${asset}`);
      const rate = Number(x.nextHourlyInterestRate);
      if (!Number.isFinite(rate) || rate < 0) throw new Error(`the rate for ${asset} is not a number`);
      return { asset, rate };
    });
  }

  // the isolated wallet of one pair: each side's free, locked, borrowed and owed
  async isolatedWallet(symbol) {
    const r = await this.get('/sapi/v1/margin/isolated/account', { symbols: symbol }, `the isolated wallet of ${symbol}`);
    return BinanceAccount.answer(r, (j) => {
      const a = j && Array.isArray(j.assets) ? j.assets.find((x) => x.symbol === symbol) : null;
      if (!a) throw new Error(`no isolated wallet for ${symbol}`);
      const side = (x) => ({ asset: x.asset, free: Number(x.free), locked: Number(x.locked), borrowed: Number(x.borrowed), interest: Number(x.interest), net: Number(x.netAsset) });
      return { symbol, base: side(a.baseAsset), quote: side(a.quoteAsset), marginLevel: Number(a.marginLevel), tradeEnabled: a.tradeEnabled !== false };
    });
  }

  // what the key itself is allowed to do, as Binance records it
  async restrictions() {
    const r = await this.get('/sapi/v1/account/apiRestrictions', {}, 'checking what the key is allowed to do');
    return BinanceAccount.answer(r, (j) => {
      if (!j || typeof j !== 'object') throw new Error('not an object');
      const b = (k) => j[k] === true;
      return { ipRestrict: b('ipRestrict'), enableWithdrawals: b('enableWithdrawals'), enableInternalTransfer: b('enableInternalTransfer'), permitsUniversalTransfer: b('permitsUniversalTransfer'), enableMargin: b('enableMargin'), enableSpotAndMarginTrading: b('enableSpotAndMarginTrading') };
    });
  }

  // the orders open on one isolated pair: kind, side and prices only
  async openOrders(symbol) {
    const r = await this.get('/sapi/v1/margin/openOrders', { symbol, isIsolated: 'TRUE' }, `the open orders on ${symbol}`);
    return BinanceAccount.answer(r, (j) => {
      if (!Array.isArray(j)) throw new Error('not a list');
      return { symbol, orders: j.map((o) => ({ side: o.side, type: o.type, price: Number(o.price), stopPrice: Number(o.stopPrice), qty: Number(o.origQty), clientOrderId: o.clientOrderId })) };
    });
  }
}

// A KEY THE ENGINE WILL KEEP (item 7): it can trade and borrow on margin, and it
// can move no money anywhere. Anything else is refused in words and the key is
// not kept. TIED TO ONE ADDRESS IS THE OWNER'S CHOICE (owner, 2026-09-25: "the
// api key ... may be NOT IP ADDRESS TIED at the user's discretion ... provided
// the exchange platform allows"): a key open to any address is kept only when
// "these keys may trade from any address" is ticked, and what such a key may do
// is still the exchange's answer, read here like every other permission.
function keyVerdict(r, { anyAddress = false } = {}) {
  const refusals = [];
  if (r.enableWithdrawals) refusals.push('it allows withdrawals');
  if (r.enableInternalTransfer) refusals.push('it allows transfers between accounts');
  if (r.permitsUniversalTransfer) refusals.push('it allows universal transfers');
  if (!r.ipRestrict && anyAddress !== true) refusals.push('it is open to any address, and "these keys may trade from any address" was not ticked');
  if (!r.enableSpotAndMarginTrading) refusals.push('it cannot trade');
  if (!r.enableMargin) refusals.push('it cannot borrow on margin, so it cannot open a short');
  return { ok: refusals.length === 0, refusals, tied: r.ipRestrict === true };
}

module.exports = { BinanceAccount, binanceWords, keyVerdict, REST };
