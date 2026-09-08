// FABRICATED COINS WITH A KNOWN ANSWER. The stage-engine check (lib/stagegate.js)
// builds two of these into the ordinary price cache and runs the real three
// stages on them: one carries the planted rule ("the day after an up day
// follows it 70% of the time", zero drift, so holding earns nothing but fees),
// the other never does. Endpoint-pinned random walks, deterministic in
// (span, seed): two checks on the same release see the same market.
//
// This is the generator half of the retired planted check's module, kept
// because the stage-engine check and its tests build their coins with it;
// the gate half went with the older sweep path (3.97.0).
const fs = require('fs');
const path = require('path');
const { mulberry32 } = require('./rng');
const { HOUR_MS } = require('./binance');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'cache');
let tmpSeq = 0;

function bridge(fromP, toP, steps, sigma, rng) {
  const raw = [Math.log(fromP)];
  for (let i = 1; i <= steps; i++) raw.push(raw[i - 1] + (rng() + rng() + rng() - 1.5) * sigma);
  const err = Math.log(toP) - raw[steps];
  return Array.from({ length: steps + 1 }, (_, i) => Math.exp(raw[i] + (err * i) / steps));
}

function dayCandles(pOpen, trendPct, outcomePct, rng) {
  const p18 = pOpen * (1 + outcomePct / 100);
  const p24 = pOpen * (1 + trendPct / 100);
  const SIG = 0.011;
  const seg1 = bridge(pOpen, p18, 17, SIG, rng);
  const seg2 = bridge(p18, p24, 6, SIG, rng);
  const closes = [pOpen, ...seg1.slice(1), ...seg2.slice(1)];
  const rows = [];
  let prev = pOpen;
  for (let h = 0; h < 24; h++) {
    const open = prev;
    const close = closes[h + 1] ?? p24;
    rows.push({
      open, close,
      high: Math.max(open, close) * (1 + 0.001 + rng() * 0.004),
      low: Math.min(open, close) * (1 - 0.001 - rng() * 0.004),
      vol: 1e6 * (1 + 0.1 * (rng() - 0.5)),
    });
    prev = close;
  }
  return rows;
}

// Regenerate a fabricated pair over a span: delete every existing file for
// that symbol, then write monthly files (the last one partial when the span
// ends mid-month). Deterministic for a given span: fixed seed, zero drift.
// ruleOnFrac = the fraction of days BEFORE which the planted rule is silent
// (0 = the stationary pair, byte-identical to the pre-refactor generator:
// the rule-off branch draws nothing extra from the rng when never taken).
function generateFabricated(span, symbol, seed, ruleOnFrac) {
  if (!span || !span.fromMonth || !span.toDate) {
    throw new Error('a fabricated coin needs a span to build over (fromMonth and toDate)');
  }
  const [fy, fm] = span.fromMonth.split('-').map(Number);
  const t0 = Date.UTC(fy, fm - 1, 1);
  const [ty, tm, td] = span.toDate.split('-').map(Number);
  const endDay = Date.UTC(ty, tm - 1, td);
  const days = Math.floor((endDay - t0) / (24 * HOUR_MS)) + 1;
  if (!(days >= 1)) throw new Error(`fabricated span is empty (${span.fromMonth} .. ${span.toDate})`);
  const ruleOnDay = Math.floor(days * ruleOnFrac);

  const rng = mulberry32(seed);
  // Trend days come in shuffled 20-day blocks of ten ups and ten downs, so
  // the up/down mix is balanced in every era (zero drift by construction).
  const trends = [];
  for (let b = 0; b < Math.ceil(days / 20); b++) {
    const block = Array.from({ length: 20 }, (_, i) => (i < 10 ? 1 : -1));
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [block[i], block[j]] = [block[j], block[i]];
    }
    trends.push(...block);
  }
  const magOf = () => 0.8 + rng() * 3.4;
  let price = 100;
  const byMonth = new Map();
  for (let d = 0; d < days; d++) {
    const prevTrend = d === 0 ? 1 : trends[d - 1];
    const follow = rng() < 0.7 ? 1 : -1; // THE PLANT: next day follows today, 70%
    // Before the rule switches on, the outcome direction is a fresh coin —
    // no relation to yesterday. The extra rng() lives INSIDE the branch so a
    // ruleOnFrac of 0 (the stationary pair) draws exactly the pre-refactor
    // stream and reproduces its bytes.
    const dir = d >= ruleOnDay ? prevTrend * follow : (rng() < 0.5 ? 1 : -1);
    const outcomePct = dir * magOf();
    const trendPct = trends[d] > 0 ? 1.5 : (1 / 1.015 - 1) * 100;
    const rows = dayCandles(price, trendPct, outcomePct, rng);
    for (let h = 0; h < 24; h++) {
      const ts = t0 + (d * 24 + h) * HOUR_MS;
      const dt = new Date(ts);
      const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push({ ts, open: rows[h].open, high: rows[h].high, low: rows[h].low, close: rows[h].close, quoteVolume: rows[h].vol });
    }
    price = rows[23].close;
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // Old planted files first: a span that SHRANK (real data trimmed) must not
  // leave stale months behind, or the fabricated pair outlives the real data
  // it is supposed to mirror.
  for (const f of fs.readdirSync(CACHE_DIR)) {
    if (f.startsWith(`${symbol}-1h-`)) {
      try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch { /* recount below */ }
    }
  }
  let written = 0;
  for (const [month, rows] of byMonth) {
    const file = path.join(CACHE_DIR, `${symbol}-1h-${month}.json`);
    // pid alone is NOT unique here: two regenerations in one process (a data
    // job's tail and a gate press) would share temp names and rename() could
    // throw mid-write. A per-call counter keeps every writer distinct.
    const tmp = `${file}.tmp${process.pid}-${++tmpSeq}`;
    fs.writeFileSync(tmp, JSON.stringify(rows));
    fs.renameSync(tmp, file);
    written++;
  }
  return { symbol, fromMonth: span.fromMonth, toDate: span.toDate, days, months: written, seed, ruleOnDay: ruleOnFrac > 0 ? ruleOnDay : null };
}

module.exports = { generateFabricated };
