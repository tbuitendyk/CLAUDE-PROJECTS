'use strict';
// engine/venues/binance-account.js -- WHAT BINANCE SAYS ABOUT ONE TRADING
// ACCOUNT, asked with that account's own keys from the engine's key store
// (loop of 2026-09-25, stage C). Reads only, every one a GET:
//   * the account's fee on a pair (what a paper position pays each way, item 5);
//   * the hourly borrowing rate Binance quotes this account (what a paper short
//     owes by the hour, D7);
//   * the wallet and the open orders on a pair.
// EACH ACCOUNT IS ASKED ABOUT ITS OWN POT (owner, 2026-09-28: the account this
// engine trades is "a valid cross margin account that's funded already", not the
// isolated wallet the old order program runs out of; then "I AUTHORIZE IT TO BE
// PLUMBED THROUGH"). Binance keeps cross and isolated apart -- different money,
// different endpoints -- so a read aimed at the wrong one answers about an
// account this engine does not trade. Which it is was already the owner's own
// choice on the account's checklist (lib/accountsetup.js, the `margin` choice);
// it now travels with the keys and is kept beside them, so these three ask the
// question that matches the pot. It is never guessed: an account whose margin
// was not recorded is REFUSED IN WORDS, and the words say to send its keys
// again so the choice travels with them.
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

// THE TWO POTS come from the key store, which is where an account's record
// lives: one list, read here rather than kept a second time.
const { MARGINS, marginOrNull } = require('../keystore');

class BinanceAccount {
  constructor({ signer, margin = null, rest = REST, request = net.request, now = () => Date.now(), recvWindow = 5000 } = {}) {
    if (!signer || typeof signer.sign !== 'function' || typeof signer.header !== 'function') throw new Error('a signer from the key store is needed');
    this.venue = 'Binance';
    this.signer = signer;
    // null until the account says which pot it is. Never defaulted: a read of the
    // wrong pot answers about money this account does not trade.
    this.margin = marginOrNull(margin);
    this.rest = rest;
    this.request = request;
    this.now = now;
    this.recvWindow = recvWindow;
    this.offset = 0;
  }

  // WHAT A READ SAYS WHEN THE POT IS NOT RECORDED. Not a guess and not a silence:
  // the reading comes back unanswered, with what to do about it.
  unrecorded(what) {
    return { ok: false, why: `this account's margin is not recorded on this platform, so ${what} cannot be asked of the right pot: send this account's keys again so the choice made on its checklist travels with them` };
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
    // a refusal says what the exchange said: its status and its own code beside its words
    if (r.status !== 200) return { ok: false, why: binanceWords(r), ms: r.ms, status: r.status, code: r.json && Number.isFinite(r.json.code) ? r.json.code : null };
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

  // the rate Binance will charge this account for the next hour of borrowing one
  // asset, out of the pot this account trades
  async hourlyRate(asset) {
    if (!this.margin) return this.unrecorded(`the hourly borrowing rate on ${asset}`);
    const r = await this.get('/sapi/v1/margin/next-hourly-interest-rate', { assets: asset, isIsolated: this.margin === 'isolated' ? 'TRUE' : 'FALSE' }, `the hourly borrowing rate on ${asset} (${this.margin})`);
    return BinanceAccount.answer(r, (j) => {
      const x = (Array.isArray(j) ? j : []).find((y) => y.asset === asset);
      if (!x) throw new Error(`no rate listed for ${asset}`);
      const rate = Number(x.nextHourlyInterestRate);
      if (!Number.isFinite(rate) || rate < 0) throw new Error(`the rate for ${asset} is not a number`);
      return { asset, rate };
    });
  }

  // THE WALLET, whichever pot this account is: each side's free, locked, borrowed
  // and owed, and the level the pot stands at. One shape either way, so a reader
  // of it never has to ask which pot it came from -- only `margin` says that.
  // An isolated pair has a wallet of its own or it has none, and none is a
  // refusal in Binance's terms. A cross pot is one wallet for the whole account,
  // and an asset it does not list is an asset the account holds none of, which is
  // a fact rather than a failure and reads as zero.
  async wallet(symbol, baseAsset, quoteAsset) {
    if (!this.margin) return this.unrecorded(`the wallet behind ${symbol}`);
    const side = (x, name) => ({ asset: name, free: Number(x.free || 0), locked: Number(x.locked || 0), borrowed: Number(x.borrowed || 0), interest: Number(x.interest || 0), net: Number(x.netAsset || 0) });
    if (this.margin === 'isolated') {
      const r = await this.get('/sapi/v1/margin/isolated/account', { symbols: symbol }, `the isolated wallet of ${symbol}`);
      return BinanceAccount.answer(r, (j) => {
        const a = j && Array.isArray(j.assets) ? j.assets.find((x) => x.symbol === symbol) : null;
        if (!a) throw new Error(`no isolated wallet for ${symbol}`);
        return { margin: 'isolated', symbol, base: side(a.baseAsset, a.baseAsset.asset), quote: side(a.quoteAsset, a.quoteAsset.asset), marginLevel: Number(a.marginLevel), tradeEnabled: a.tradeEnabled !== false };
      });
    }
    const r = await this.get('/sapi/v1/margin/account', {}, `the cross wallet behind ${symbol}`);
    return BinanceAccount.answer(r, (j) => {
      const rows = j && Array.isArray(j.userAssets) ? j.userAssets : null;
      if (!rows) throw new Error('this account has no cross wallet');
      const of = (name) => side(rows.find((y) => y.asset === name) || {}, name);
      return { margin: 'cross', symbol, base: of(baseAsset), quote: of(quoteAsset), marginLevel: Number(j.marginLevel), tradeEnabled: j.tradeEnabled !== false, borrowEnabled: j.borrowEnabled !== false };
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

  // the orders open on one pair, in the pot this account trades: kind, side and
  // prices only. Asked of the wrong pot this comes back EMPTY rather than wrong,
  // which reads as "no orders" -- so it is the read that most needs the mode.
  async openOrders(symbol) {
    if (!this.margin) return this.unrecorded(`the open orders on ${symbol}`);
    const q = this.margin === 'isolated' ? { symbol, isIsolated: 'TRUE' } : { symbol };
    const r = await this.get('/sapi/v1/margin/openOrders', q, `the open orders on ${symbol} (${this.margin})`);
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
// the account's "Where it may trade from" says "open to any address" (3.280.0: chosen
// in that one place, and carried with every send and every check), and what such a
// key may do is still the exchange's answer, read here like every other permission.
function keyVerdict(r, { anyAddress = false } = {}) {
  const refusals = [];
  if (r.enableWithdrawals) refusals.push('it allows withdrawals');
  if (r.enableInternalTransfer) refusals.push('it allows transfers between accounts');
  if (r.permitsUniversalTransfer) refusals.push('it allows universal transfers');
  if (!r.ipRestrict && anyAddress !== true) refusals.push('it is open to any address, and "Where it may trade from" in the account\'s checklist is not "open to any address"');
  if (!r.enableSpotAndMarginTrading) refusals.push('it cannot trade');
  if (!r.enableMargin) refusals.push('it cannot borrow on margin, so it cannot open a short');
  return { ok: refusals.length === 0, refusals, tied: r.ipRestrict === true };
}

// WHAT ONE CHECK OF A KEY COMES TO (3.279.0, owner 2026-09-27: a key Binance refuses is not kept;
// "kept, but not checked" only when the exchange could not be asked). An answer about what the key
// may do is the verdict above. The exchange refusing the key itself -- a key it does not know
// (-2014, -2015), one not signed with its secret (-1022), or one not to be used from where it was
// sent (-2015) -- is a verdict too, and a refusal. Anything else -- no answer, a limit, a clock out
// of step -- leaves the key unchecked, never refused.
const KEY_REFUSED = new Set([-2014, -2015, -1022]);
function keyCheck(r, { anyAddress = false } = {}) {
  if (r && r.ok) return { checked: true, ...keyVerdict(r, { anyAddress }) };
  if (r && KEY_REFUSED.has(r.code)) return { checked: true, ok: false, refused: true, refusals: [`the exchange refused the key: ${r.why}`], tied: null };
  return { checked: false, why: (r && r.why) || 'the exchange could not be asked' };
}

module.exports = { BinanceAccount, binanceWords, keyVerdict, keyCheck, KEY_REFUSED, MARGINS, marginOrNull, REST };
