const config = require('./config');
const db = require('./db');

// Single CoinGecko client for the whole app. Every request goes through here
// so rate limiting and quota accounting are enforced in one place.
//
// Free/demo tier realities (2026): with a demo key ~100 calls/min but a hard
// 10,000 calls/MONTH cap (the binding constraint); anonymous access is
// IP-based and traffic-dependent (~5-15/min). Errored calls (429s included)
// still count against quota, so the backoff pauses the bucket rather than
// hammering retries.

const KEYED_PER_MIN = 25; // conservative vs the 100/min demo limit
const KEYLESS_PER_MIN = 10;
const MONTH_CAP = 10_000;
const WARN_FRACTION = 0.8;

function headers() {
  const h = { accept: 'application/json' };
  if (config.coingeckoApiKey) h['x-cg-demo-api-key'] = config.coingeckoApiKey;
  return h;
}

function monthKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 7); // '2026-07'
}

// Persistent monthly call ledger. Counts every request we send, success or
// not, because CoinGecko bills them all against the monthly cap.
function recordCall() {
  const key = monthKey();
  db.prepare(
    'INSERT INTO cg_ledger (month, calls) VALUES (?, 1) ON CONFLICT(month) DO UPDATE SET calls = calls + 1'
  ).run(key);
  const { calls } = db.prepare('SELECT calls FROM cg_ledger WHERE month = ?').get(key);
  if (calls === Math.ceil(MONTH_CAP * WARN_FRACTION)) {
    console.warn(`CoinGecko ledger: ${calls} calls this month — ${WARN_FRACTION * 100}% of the ${MONTH_CAP}/month cap`);
  }
  return calls;
}

function monthlyCalls() {
  const row = db.prepare('SELECT calls FROM cg_ledger WHERE month = ?').get(monthKey());
  return row ? row.calls : 0;
}

// Token-bucket limiter + serialized queue. Requests are spaced so bursts
// (history backfills, scanner runs) can't draw 429s; a 429 anyway pauses the
// whole bucket with exponential backoff.
const minInterval = () => 60_000 / (config.coingeckoApiKey ? KEYED_PER_MIN : KEYLESS_PER_MIN);
let queue = Promise.resolve();
let nextSlot = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttledFetch(url) {
  const run = async () => {
    const wait = nextSlot - Date.now();
    if (wait > 0) await sleep(wait);
    nextSlot = Date.now() + minInterval();

    let backoff = 5_000;
    for (let attempt = 0; ; attempt++) {
      recordCall();
      const res = await fetch(url, { headers: headers() });
      if (res.status === 429 && attempt < 4) {
        // Pause the bucket too: nothing else should fire while we're limited.
        nextSlot = Date.now() + backoff;
        await sleep(backoff);
        backoff *= 2;
        continue;
      }
      return res;
    }
  };
  // Serialize through the queue so concurrent callers can't stampede.
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

async function getJson(pathAndQuery) {
  const url = `${config.coingeckoBase}${pathAndQuery}`;
  const res = await throttledFetch(url);
  if (!res.ok) {
    throw new Error(`CoinGecko ${res.status}: ${await res.text().catch(() => '')}`);
  }
  return res.json();
}

module.exports = { getJson, headers, monthlyCalls, monthKey, MONTH_CAP };
