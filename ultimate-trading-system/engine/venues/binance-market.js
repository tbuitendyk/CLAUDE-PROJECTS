'use strict';
// engine/venues/binance-market.js -- WHAT THE MARKET IS DOING ON BINANCE, as it
// happens: every printed trade, the top of the order book ten times a second,
// and the hour's candle (whose opening price is a breakout plan's reference).
// Public data only: no key is read here, so Paper Books need none.
//
// One combined stream for every symbol the engine holds a plan on. Binance
// closes a stream after a day and whenever it likes, so a dropped stream is
// opened again at once, with a short pause that grows while it keeps failing;
// every change of state is told to the runner, which writes it down.
const { WebSocketClient } = require('../ws');
const { getJson } = require('../net');

const STREAM = 'wss://stream.binance.com:9443/stream';
const REST = 'https://api.binance.com';

function num(x) { const v = Number(x); return Number.isFinite(v) ? v : null; }

class BinanceMarket {
  constructor({ onTrade, onBook, onKline, onStatus, streamUrl = STREAM, restBase = REST } = {}) {
    this.onTrade = onTrade || (() => {});
    this.onBook = onBook || (() => {});
    this.onKline = onKline || (() => {});
    this.onStatus = onStatus || (() => {});
    this.streamUrl = streamUrl;
    this.restBase = restBase;
    this.symbols = new Set();
    this.ws = null;
    this.books = new Map();     // symbol -> { bids, asks, ts, updateId }
    this.lastTrade = new Map(); // symbol -> { price, qty, ts, id }
    this.hourOpen = new Map();  // `${symbol}|${openTime}` -> open
    this.filters = new Map();   // symbol -> { tickSize, stepSize, minQty, minNotional }
    this.failures = 0;
    this.stopped = false;
    this.connectedAt = null;
  }

  // the symbols to follow; a change reopens the stream with the new set
  follow(symbols) {
    const next = new Set([...symbols].map((s) => String(s).toUpperCase()));
    const same = next.size === this.symbols.size && [...next].every((s) => this.symbols.has(s));
    this.symbols = next;
    if (!same) this.reopen();
  }

  reopen() {
    if (this.ws) { const old = this.ws; this.ws = null; old.removeAllListeners(); old.on('error', () => {}); old.close(); }
    if (this.stopped || !this.symbols.size) return;
    const streams = [...this.symbols].flatMap((s) => { const l = s.toLowerCase(); return [`${l}@trade`, `${l}@depth20@100ms`, `${l}@kline_1h`]; });
    const ws = new WebSocketClient(`${this.streamUrl}?streams=${streams.join('/')}`);
    this.ws = ws;
    ws.on('open', () => { this.failures = 0; this.connectedAt = Date.now(); this.onStatus({ feed: 'binance', state: 'connected', symbols: [...this.symbols] }); });
    ws.on('message', (text) => this.handle(text));
    ws.on('error', (e) => this.onStatus({ feed: 'binance', state: 'error', why: e.message }));
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.connectedAt = null;
      this.failures += 1;
      const wait = Math.min(30000, 500 * 2 ** Math.min(this.failures, 6));
      this.onStatus({ feed: 'binance', state: 'disconnected', reopenInMs: wait });
      setTimeout(() => { if (this.ws === ws) this.reopen(); }, wait).unref();
    });
    ws.connect();
  }

  handle(text) {
    let msg;
    try { msg = JSON.parse(text); } catch (_) { return; }
    const d = msg && msg.data;
    if (!d) return;
    if (d.e === 'trade') {
      const t = { symbol: d.s, price: num(d.p), qty: num(d.q), ts: d.T, id: d.t };
      if (t.price == null) return;
      this.lastTrade.set(d.s, t);
      this.onTrade(t);
    } else if (d.e === 'kline') {
      const k = d.k;
      const kl = { symbol: d.s, openTime: k.t, open: num(k.o), high: num(k.h), low: num(k.l), close: num(k.c), closed: !!k.x };
      this.hourOpen.set(`${d.s}|${k.t}`, kl.open);
      this.onKline(kl);
    } else if (Array.isArray(d.bids) && Array.isArray(d.asks)) {
      // a depth snapshot names its symbol only in the stream's name
      const sym = String(msg.stream || '').split('@')[0].toUpperCase();
      const book = { symbol: sym, bids: d.bids.map(([p, q]) => [num(p), num(q)]), asks: d.asks.map(([p, q]) => [num(p), num(q)]), ts: Date.now(), updateId: d.lastUpdateId };
      this.books.set(sym, book);
      this.onBook(book);
    }
  }

  book(symbol) { return this.books.get(symbol) || null; }
  trade(symbol) { return this.lastTrade.get(symbol) || null; }

  // the opening price of the hour starting at openTime: from the stream when it
  // was seen, else asked of the exchange
  async hourOpenOf(symbol, openTime) {
    const seen = this.hourOpen.get(`${symbol}|${openTime}`);
    if (seen != null) return seen;
    const r = await getJson(`${this.restBase}/api/v3/klines?symbol=${symbol}&interval=1h&startTime=${openTime}&limit=1`);
    const row = Array.isArray(r.json) ? r.json.find((x) => x[0] === openTime) : null;
    return row ? num(row[1]) : null;
  }

  // the minute candles from one moment to another: what the price did while nobody was watching
  async minutes(symbol, fromTs, toTs) {
    const out = [];
    let from = fromTs;
    while (from < toTs) {
      // eslint-disable-next-line no-await-in-loop
      const r = await getJson(`${this.restBase}/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${from}&endTime=${toTs}&limit=1000`);
      if (!Array.isArray(r.json) || !r.json.length) break;
      for (const x of r.json) out.push({ ts: x[0], open: num(x[1]), high: num(x[2]), low: num(x[3]), close: num(x[4]) });
      from = r.json[r.json.length - 1][0] + 60000;
      if (r.json.length < 1000) break;
    }
    return out;
  }

  // the exchange's own steps and minimums for a symbol
  async filtersOf(symbol) {
    if (this.filters.has(symbol)) return this.filters.get(symbol);
    const r = await getJson(`${this.restBase}/api/v3/exchangeInfo?symbol=${symbol}`);
    const s = r.json && Array.isArray(r.json.symbols) ? r.json.symbols.find((x) => x.symbol === symbol) : null;
    if (!s) throw new Error(`the exchange does not list ${symbol}: ${r.status} ${r.text || ''}`);
    const f = Object.fromEntries(s.filters.map((x) => [x.filterType, x]));
    const out = {
      tickSize: num((f.PRICE_FILTER || {}).tickSize), stepSize: num((f.LOT_SIZE || {}).stepSize), minQty: num((f.LOT_SIZE || {}).minQty),
      minNotional: num((f.NOTIONAL || f.MIN_NOTIONAL || {}).minNotional), baseAsset: s.baseAsset, quoteAsset: s.quoteAsset,
    };
    this.filters.set(symbol, out);
    return out;
  }

  status() {
    const now = Date.now();
    const age = this.ws && this.ws.lastMessageAt ? now - this.ws.lastMessageAt : null;
    return { feed: 'binance', connected: !!(this.ws && this.ws.open), sinceMs: this.connectedAt ? now - this.connectedAt : null, lastMessageAgoMs: age, symbols: [...this.symbols] };
  }

  stop() { this.stopped = true; if (this.ws) this.ws.close(); }
}

module.exports = { BinanceMarket, STREAM, REST };
