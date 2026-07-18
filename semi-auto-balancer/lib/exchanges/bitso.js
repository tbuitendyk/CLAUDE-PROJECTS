const crypto = require('crypto');

// Read-only Bitso client (Phase 1.5). Verified capabilities in EXCHANGES.md:
// balance/user_trades/fundings/withdrawals with marker pagination; public
// ticker per book; multi-year daily OHLC on the UNDOCUMENTED bitso.com host
// (api.bitso.com/v3/ohlc 404s) — best-effort with CoinGecko fallback.

const API = 'https://api.bitso.com';
const WEB = 'https://bitso.com'; // OHLC lives here, not on api.bitso.com

// Fiat crosses Bitso trades directly against USD (usd_mxn etc.) — these give
// live + historical fiat rates without CoinGecko's bitcoin cross-rate calls.
const USD_FIAT_BOOKS = new Set(['mxn', 'ars', 'brl', 'cop']);

// One user_trades entry -> normalized trade. major/minor arrive signed from
// Bitso (buy: +major/-minor). The fee is applied as its own delta on
// fees_currency; if the venue turns out to net it into major/minor already,
// the per-trade error is small and the balance ground-truth snap in the sync
// engine absorbs it (surfaced in the sync note, not silently wrong).
function normalizeTrade(t) {
  const [base, quote] = String(t.book).split('_');
  const major = Number(t.major);
  const minor = Number(t.minor);
  const fee = Number(t.fees_amount || 0);
  const feeCur = (t.fees_currency || '').toLowerCase();
  const deltas = [
    { code: base, delta: major },
    { code: quote, delta: minor },
  ];
  if (fee) deltas.push({ code: feeCur, delta: -fee });
  // Realized fee as % of the trade value measured in the fee's own currency.
  const majorAbs = Math.abs(major);
  const minorAbs = Math.abs(minor);
  let feePct = null;
  if (fee > 0) {
    if (feeCur === base && majorAbs > 0) feePct = (fee / majorAbs) * 100;
    else if (minorAbs > 0) feePct = (fee / minorAbs) * 100;
  } else if (fee === 0) feePct = 0;
  return {
    id: String(t.tid),
    ts: Date.parse(t.created_at),
    pair: `${base.toUpperCase()}/${quote.toUpperCase()}`,
    side: t.side,
    price: Number(t.price),
    cost: minorAbs,
    fee,
    feeCurrency: feeCur,
    feePct,
    deltas,
    raw: t,
  };
}

// One fundings/withdrawals entry -> normalized flow (only 'complete' items
// are real balance changes; pending/failed ones are skipped by the caller).
function normalizeFlow(kind, f) {
  const amount = Number(f.amount);
  return {
    id: String(kind === 'deposit' ? f.fid : f.wid),
    ts: Date.parse(f.created_at),
    kind,
    code: String(f.currency).toLowerCase(),
    amount: kind === 'deposit' ? amount : -amount,
    raw: f,
  };
}

function makeClient({ apiKey, apiSecret }) {
  let lastNonce = 0;

  async function call(requestPath) {
    let nonce = Date.now();
    if (nonce <= lastNonce) nonce = lastNonce + 1;
    lastNonce = nonce;
    // The signed request path includes the query string.
    const sig = crypto
      .createHmac('sha256', apiSecret)
      .update(`${nonce}GET${requestPath}`)
      .digest('hex');
    const res = await fetch(`${API}${requestPath}`, {
      headers: { Authorization: `Bitso ${apiKey}:${nonce}:${sig}` },
    });
    // Errors name the endpoint: Bitso's permission refusals are identical
    // strings, so without the path there is no telling which scope is missing.
    const endpoint = requestPath.split('?')[0];
    const body = await res.json().catch(() => {
      throw new Error(`Bitso ${endpoint}: HTTP ${res.status}, non-JSON response`);
    });
    if (!body.success) {
      throw new Error(`Bitso ${endpoint}: ${(body.error && body.error.message) || `HTTP ${res.status}`}`);
    }
    return body.payload;
  }

  // Newest-first cursor pagination, walking back until items reach sinceMs.
  // mapFn returns null to skip an item (e.g. non-complete fundings).
  async function pageBack(pathBase, markerOf, sinceMs, mapFn) {
    const out = [];
    let marker = null;
    for (let page = 0; page < 50; page++) {
      const qs = `?limit=100&sort=desc${marker ? `&marker=${encodeURIComponent(marker)}` : ''}`;
      const items = await call(`${pathBase}${qs}`);
      if (!Array.isArray(items) || items.length === 0) break;
      let reachedWatermark = false;
      for (const it of items) {
        const ts = Date.parse(it.created_at);
        if (!(ts > sinceMs)) {
          reachedWatermark = true;
          break;
        }
        const m = mapFn(it);
        if (m) out.push(m);
      }
      if (reachedWatermark || items.length < 100) break;
      marker = markerOf(items[items.length - 1]);
    }
    out.sort((a, b) => a.ts - b.ts);
    return out;
  }

  return {
    venue: 'bitso',

    async fetchBalances() {
      const p = await call('/v3/balance/');
      return (p.balances || [])
        .map((b) => ({ code: String(b.currency).toLowerCase(), amount: Number(b.total) }))
        .filter((b) => Number.isFinite(b.amount));
    },

    async fetchTradesSince(sinceMs) {
      return pageBack('/v3/user_trades/', (t) => t.tid, sinceMs, (t) => normalizeTrade(t));
    },

    async fetchFlowsSince(sinceMs) {
      const deposits = await pageBack('/v3/fundings/', (f) => f.fid, sinceMs, (f) =>
        f.status === 'complete' ? normalizeFlow('deposit', f) : null
      );
      const withdrawals = await pageBack('/v3/withdrawals/', (w) => w.wid, sinceMs, (w) =>
        w.status === 'complete' ? normalizeFlow('withdrawal', w) : null
      );
      return [...deposits, ...withdrawals].sort((a, b) => a.ts - b.ts);
    },
  };
}

// ---- public market data (no key) --------------------------------------------

async function publicJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Bitso ${res.status}`);
  const body = await res.json();
  if (body.success === false) throw new Error(`Bitso: ${(body.error && body.error.message) || 'error'}`);
  return body.payload !== undefined ? body.payload : body;
}

// Last-trade price for one book (e.g. 'usd_mxn' -> MXN per USD).
async function tickerLast(book) {
  const p = await publicJson(`${API}/v3/ticker/?book=${encodeURIComponent(book)}`);
  const last = Number(p.last);
  return last > 0 ? last : null;
}

// USD price of one unit of a fiat currency via the usd_<code> book.
async function usdFiatRate(code) {
  if (!USD_FIAT_BOOKS.has(code)) return null;
  const last = await tickerLast(`usd_${code}`);
  return last ? 1 / last : null;
}

// Closes for a book at a bucket size since a ms timestamp, via the
// undocumented OHLC endpoint — multi-year depth verified for daily AND
// hourly (17.5k hourly rows in one call). Buckets normalized to the UTC
// bucket boundary (daily buckets start at Mexico City midnight, an accepted
// ~6h skew). invert=true returns 1/close (usd_mxn -> USD-per-MXN).
async function ohlcCloses(book, bucketSeconds, sinceMs, { invert = false } = {}) {
  const bucketMs = bucketSeconds * 1000;
  const start = Math.max(0, sinceMs || 0);
  const url =
    `${WEB}/api/v3/ohlc?book=${encodeURIComponent(book)}` +
    `&time_bucket=${bucketSeconds}&start=${start}&end=${Date.now()}`;
  const rows = await publicJson(url);
  const byBucket = new Map();
  for (const r of rows || []) {
    const close = Number(r.last_rate);
    if (!(close > 0)) continue;
    const t = Math.floor(Number(r.bucket_start_time) / bucketMs) * bucketMs;
    byBucket.set(t, invert ? 1 / close : close);
  }
  return byBucket;
}

const dailyCloses = (book, sinceMs, opts = {}) => ohlcCloses(book, 86_400, sinceMs, opts);
const hourlyCloses = (book, sinceMs, opts = {}) => ohlcCloses(book, 3_600, sinceMs, opts);

// Tradable books, cached daily — the hourly collector discovers which
// assets Bitso can serve deep history for (SYM_usd / usd_<fiat> books).
let booksCache = null;
async function availableBooks() {
  if (booksCache && Date.now() - booksCache.at < 24 * 3600e3) return booksCache.books;
  const p = await publicJson(`${API}/v3/available_books/`);
  booksCache = { at: Date.now(), books: (p || []).map((b) => b.book) };
  return booksCache.books;
}

module.exports = {
  makeClient,
  tickerLast,
  usdFiatRate,
  ohlcCloses,
  dailyCloses,
  hourlyCloses,
  availableBooks,
  normalizeTrade,
  normalizeFlow,
  USD_FIAT_BOOKS,
};
