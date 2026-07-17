const crypto = require('crypto');

// Read-only Kraken client (Phase 1.5). Verified capabilities in EXCHANGES.md:
// public OHLC = 721 candles/interval (~2y daily), Ticker batches pairs,
// Assets provides the altname map for balance-code normalization; private
// Balance/TradesHistory/Ledgers page 50 at a time via ofs. Keys must be
// created with query-only permissions and IP-pinned to the VPS.

const BASE = 'https://api.kraken.com';

// Kraken speaks XBT/XDG where the rest of the app speaks btc/doge.
const ALIAS = { xbt: 'btc', xdg: 'doge', eth2: 'eth' };
const REVERSE_ALIAS = { btc: 'XBT', doge: 'XDG' };

// Public metadata cache: asset altnames (XXBT -> XBT) and tradable pairs
// (pairKey -> {base, quote, wsname}). Refreshed daily; injectable for tests.
let meta = null; // { altnames: {code: altname}, pairs: {key: {...}}, byWsname: {wsname: key}, at }
const META_TTL_MS = 24 * 3600e3;

async function publicJson(pathAndQuery) {
  const res = await fetch(`${BASE}/0/public/${pathAndQuery}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Kraken ${res.status}`);
  const body = await res.json();
  if (body.error && body.error.length) throw new Error(`Kraken: ${body.error.join('; ')}`);
  return body.result;
}

async function loadMeta() {
  if (meta && Date.now() - meta.at < META_TTL_MS) return meta;
  const [assets, pairs] = [await publicJson('Assets'), await publicJson('AssetPairs')];
  const altnames = {};
  for (const [code, a] of Object.entries(assets)) altnames[code] = a.altname || code;
  const byWsname = {};
  for (const [key, p] of Object.entries(pairs)) if (p.wsname) byWsname[p.wsname] = key;
  meta = { altnames, pairs, byWsname, at: Date.now() };
  return meta;
}

// For tests: inject metadata so normalization is exercised offline.
function _setMetaForTest(altnames, pairs) {
  const byWsname = {};
  for (const [key, p] of Object.entries(pairs || {})) if (p.wsname) byWsname[p.wsname] = key;
  meta = { altnames: altnames || {}, pairs: pairs || {}, byWsname, at: Date.now() };
}

// XXBT -> btc, ZUSD -> usd, XBT.F (earn) -> btc, ETH2.S -> eth.
function normalizeCode(code) {
  let c = String(code).split('.')[0];
  if (meta && meta.altnames[c]) c = meta.altnames[c];
  c = c.toLowerCase();
  return ALIAS[c] || c;
}

// Resolve a trade's pair key ('XXBTZUSD' or altname 'XBTUSD') to base/quote.
function pairInfo(pair) {
  if (!meta) return null;
  const p = meta.pairs[pair] || Object.values(meta.pairs).find((x) => x.altname === pair);
  return p || null;
}

// One TradesHistory entry -> the app's normalized trade shape. Kraken charges
// the fee in the quote currency, so the quote delta nets it out directly.
function normalizeTrade(txid, t) {
  const p = pairInfo(t.pair);
  const base = p ? normalizeCode(p.base) : null;
  const quote = p ? normalizeCode(p.quote) : null;
  const vol = Number(t.vol);
  const cost = Number(t.cost);
  const fee = Number(t.fee || 0);
  const buy = t.type === 'buy';
  const deltas = [];
  if (base) deltas.push({ code: base, delta: buy ? vol : -vol });
  if (quote) deltas.push({ code: quote, delta: (buy ? -cost : cost) - fee });
  return {
    id: txid,
    ts: Math.round(Number(t.time) * 1000),
    pair: p && p.wsname ? p.wsname : String(t.pair),
    side: t.type,
    price: Number(t.price),
    cost,
    fee,
    feeCurrency: quote,
    feePct: cost > 0 ? (fee / cost) * 100 : null,
    deltas,
    raw: t,
  };
}

// One Ledgers deposit/withdrawal entry -> normalized flow. amount is signed
// by Kraken (withdrawals negative); the venue fee comes out of the balance
// too, so the net delta is amount - fee either way.
function normalizeLedgerFlow(lid, e) {
  return {
    id: lid,
    ts: Math.round(Number(e.time) * 1000),
    kind: e.type, // 'deposit' | 'withdrawal'
    code: normalizeCode(e.asset),
    amount: Number(e.amount) - Number(e.fee || 0),
    raw: e,
  };
}

function makeClient({ apiKey, apiSecret }) {
  let lastNonce = 0;

  async function privateCall(method, params = {}) {
    const path = `/0/private/${method}`;
    let nonce = Date.now() * 1000;
    if (nonce <= lastNonce) nonce = lastNonce + 1;
    lastNonce = nonce;
    const post = new URLSearchParams({ nonce: String(nonce) });
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) post.set(k, String(v));
    }
    const postdata = post.toString();
    const sha = crypto.createHash('sha256').update(String(nonce) + postdata).digest();
    const sig = crypto
      .createHmac('sha512', Buffer.from(apiSecret, 'base64'))
      .update(Buffer.concat([Buffer.from(path, 'utf8'), sha]))
      .digest('base64');
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'API-Key': apiKey,
        'API-Sign': sig,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: postdata,
    });
    const body = await res.json().catch(() => {
      throw new Error(`Kraken ${method}: HTTP ${res.status}, non-JSON response`);
    });
    if (body.error && body.error.length) throw new Error(`Kraken ${method}: ${body.error.join('; ')}`);
    return body.result || {};
  }

  // Paged private fetch: Kraken returns 50 rows per page with a total count.
  async function pagedEntries(method, params, resultKey) {
    const all = [];
    let ofs = 0;
    for (;;) {
      const r = await privateCall(method, { ...params, ofs });
      const entries = Object.entries(r[resultKey] || {});
      all.push(...entries);
      ofs += entries.length;
      if (entries.length === 0 || ofs >= Number(r.count || 0) || ofs > 5000) break;
    }
    return all;
  }

  return {
    venue: 'kraken',

    async fetchBalances() {
      await loadMeta();
      const raw = await privateCall('Balance');
      // Earn/staking sub-balances (XBT.F) normalize to the same code as the
      // spot balance, so amounts are summed per normalized code.
      const byCode = new Map();
      for (const [code, amt] of Object.entries(raw)) {
        const n = Number(amt);
        if (!Number.isFinite(n)) continue;
        const c = normalizeCode(code);
        byCode.set(c, (byCode.get(c) || 0) + n);
      }
      return [...byCode.entries()].map(([code, amount]) => ({ code, amount }));
    },

    async fetchTradesSince(sinceMs) {
      await loadMeta();
      const entries = await pagedEntries('TradesHistory', { start: sinceMs / 1000 }, 'trades');
      const out = [];
      for (const [txid, t] of entries) {
        const trade = normalizeTrade(txid, t);
        if (trade.ts > sinceMs) out.push(trade);
      }
      out.sort((a, b) => a.ts - b.ts);
      return out;
    },

    async fetchFlowsSince(sinceMs) {
      const flows = [];
      for (const type of ['deposit', 'withdrawal']) {
        const entries = await pagedEntries('Ledgers', { type, start: sinceMs / 1000 }, 'ledger');
        for (const [lid, e] of entries) {
          const f = normalizeLedgerFlow(lid, e);
          if (f.ts > sinceMs) flows.push(f);
        }
      }
      flows.sort((a, b) => a.ts - b.ts);
      return flows;
    },
  };
}

// ---- public market data (no key) --------------------------------------------

// Kraken pair key for SYMBOL/USD, or null when Kraken doesn't list it (or the
// match would be ambiguous — a wrong-coin price is worse than a CG call).
async function pairForSymbol(symbol) {
  await loadMeta();
  const sym = String(symbol).toLowerCase();
  const candidates = [`${(REVERSE_ALIAS[sym] || sym.toUpperCase())}/USD`];
  for (const ws of candidates) {
    if (meta.byWsname[ws]) return meta.byWsname[ws];
  }
  return null;
}

// Last-trade USD price for a set of pair keys, one Ticker call.
async function tickerUsd(pairKeys) {
  if (pairKeys.length === 0) return {};
  const r = await publicJson(`Ticker?pair=${encodeURIComponent(pairKeys.join(','))}`);
  const out = {};
  for (const [key, t] of Object.entries(r)) {
    const last = Number(t.c && t.c[0]);
    if (last > 0) out[key] = last;
  }
  return out;
}

// Daily closes for a pair since a ms timestamp (0 = as deep as Kraken serves,
// ~720 days). Candle time is the 00:00 UTC bucket start; the trailing candle
// is the in-progress day and self-corrects on the next fetch (INSERT OR
// REPLACE in the cache).
async function dailyCloses(pairKey, sinceMs = 0) {
  const since = Math.max(0, Math.floor(sinceMs / 1000));
  const r = await publicJson(`OHLC?pair=${encodeURIComponent(pairKey)}&interval=1440&since=${since}`);
  const key = Object.keys(r).find((k) => k !== 'last');
  const byDay = new Map();
  for (const row of r[key] || []) {
    const close = Number(row[4]);
    if (close > 0) byDay.set(Number(row[0]) * 1000, close);
  }
  return byDay;
}

module.exports = {
  makeClient,
  pairForSymbol,
  tickerUsd,
  dailyCloses,
  normalizeCode,
  normalizeTrade,
  normalizeLedgerFlow,
  _setMetaForTest,
};
