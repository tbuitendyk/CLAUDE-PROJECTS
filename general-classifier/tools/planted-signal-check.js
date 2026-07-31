// PLANTED-SIGNAL CHECK (owner-approved design, 2026-07-31) — instrument
// calibration with a known weight on the scale.
//
// Two fabricated coins go through the REAL engine (unitTask — the exact
// function workers run), under both window layouts:
//
//   SIGUSDT    carries one planted rule: the outcome window's direction
//              follows the previous day's direction 7 times in 10. Built
//              with ~zero overall drift, so buy-and-hold earns ~nothing and
//              any reported profit must come from reading the rule.
//   NOISEUSDT  same construction, outcome direction is an independent coin
//              flip. There is nothing to find.
//
// PASS CRITERIA, DECLARED BEFORE RUNNING (each labeled derived/guessed):
//   S1 signal coin: held-back money > 0 under BOTH layouts        [derived:
//      the plant pays ~2.5% moves at 70% hit rate, far over fees]
//   S2 signal coin: held-back accuracy edge > +5 points, both     [derived:
//      70% ceiling vs ~50% base rate leaves a wide margin]
//   S3 signal coin: beats always-long on held-back data, both     [derived:
//      the series is built driftless]
//   N1 noise coin: held-back accuracy edge inside ±3 points, both [guessed
//      width for sampling noise at ~170 held-back periods]
//   N2 noise coin: held-back money < signal coin's / 3, both      [guessed]
//   A1 the two layouts' signal-coin money per trade agree within
//      a factor of 1/3..3                                          [guessed]
//   C1 held-back and test period counts identical across layouts  [derived:
//      the count invariant]
//
// The fabricated months are written into the LOCAL cache only and deleted
// afterwards; nothing here touches the VPS or real data.
const fs = require('fs');
const path = require('path');
const { unitTask } = require('../lib/bracketwork');
const { mulberry32 } = require('../lib/interlace');

const CACHE = path.join(__dirname, '..', 'data', 'cache');
const HOUR = 3_600_000;
const DAYS = 1200; // ~3 full layout groups plus remainder
const T0 = Date.UTC(2021, 0, 4); // a Monday, 00:00 UTC

// One day's candles. The day plays two roles at once:
//   * its full open->close return shows THIS day's trend (the next chunk's
//     feature signal)
//   * its 01:00->18:00 sub-move is the PREVIOUS chunk's outcome: o
//
// FIRST VERSION'S LESSON (2026-07-31, caught by the declared criteria): the
// path must NOT be a one-way street. A smooth walk from open to outcome
// pays a breakout strategy in either direction with no prediction at all —
// the noise coin earned identically to the signal coin. So the path now
// opens with a FALSE MOVE (a dip against the outcome direction about half
// the time), wanders with real two-way noise between the pinned anchor
// hours, and carries wide highs/lows so entry rails get touched both ways.
// THIRD VERSION (2026-07-31). The second still let momentum-riders profit
// on noise: its path drifted smoothly to the day's destination, so boarding
// mid-move paid on any coin. Now each segment is a genuinely volatile
// random walk (hourly swings ~1.5%, comparable to the whole day's planted
// move) BRIDGED to its pinned endpoint: the walk wanders freely both ways
// and is only nudged home at the end. Crossing any level mid-day now says
// ~nothing about where the day closes — which is what makes noise NOISE.
function bridge(fromP, toP, steps, sigma, rng) {
  // log-space random walk, then a linear correction pinning the endpoint
  const raw = [Math.log(fromP)];
  for (let i = 1; i <= steps; i++) {
    raw.push(raw[i - 1] + (rng() + rng() + rng() - 1.5) * sigma);
  }
  const err = Math.log(toP) - raw[steps];
  return Array.from({ length: steps + 1 }, (_, i) => Math.exp(raw[i] + (err * i) / steps));
}

function dayCandles(pOpen, trendPct, outcomePct, rng) {
  const p18 = pOpen * (1 + outcomePct / 100);
  const p24 = pOpen * (1 + trendPct / 100);
  const SIG = 0.011; // ~1.1% hourly swing: the walk dwarfs any single hour's share of the move
  // hour closes: 0 pinned flat (hour-1 open = entry), 1..17 bridge to the
  // outcome (hour-18 open = exit), 18..23 bridge to the day's net return
  const seg1 = bridge(pOpen, p18, 17, SIG, rng);
  const seg2 = bridge(p18, p24, 6, SIG, rng);
  const closes = [pOpen, ...seg1.slice(1), ...seg2.slice(1)];
  const rows = [];
  let prev = pOpen;
  for (let h = 0; h < 24; h++) {
    const open = prev;
    const close = closes[h + 1] ?? p24;
    const hi = Math.max(open, close) * (1 + 0.001 + rng() * 0.004);
    const lo = Math.min(open, close) * (1 - 0.001 - rng() * 0.004);
    rows.push({ open, close, high: hi, low: lo, vol: 1e6 * (1 + 0.1 * (rng() - 0.5)) });
    prev = close;
  }
  return rows;
}

function generate(symbol, planted, seed) {
  const rng = mulberry32(seed);
  // Balanced trends in shuffled 20-day blocks -> overall drift ~ 0.
  const trends = [];
  for (let b = 0; b < Math.ceil(DAYS / 20); b++) {
    const block = Array.from({ length: 20 }, (_, i) => (i < 10 ? 1 : -1));
    for (let i = block.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [block[i], block[j]] = [block[j], block[i]];
    }
    trends.push(...block);
  }
  // Outcome sizes are RANDOM per day (first version cycled 1-2-3-4, which
  // made tomorrow's size perfectly predictable from today's — free accuracy
  // with no direction skill; the noise coin scored +20pt off it).
  const magOf = () => 0.8 + rng() * 3.4;
  let price = 100;
  const byMonth = new Map();
  for (let d = 0; d < DAYS; d++) {
    // outcome carried by day d belongs to chunk d-1 (its feature day)
    const prevTrend = d === 0 ? 1 : trends[d - 1];
    const follow = planted ? (rng() < 0.7 ? 1 : -1) : (rng() < 0.5 ? 1 : -1);
    const outcomePct = prevTrend * follow * magOf();
    // multiplicatively symmetric day returns so 600 up + 600 down days land
    // at exactly the starting price (the first version's +/-1.5% arithmetic
    // pair compounded to -12.6% over 1200 days)
    const trendPct = trends[d] > 0 ? 1.5 : (1 / 1.015 - 1) * 100;
    const rows = dayCandles(price, trendPct, outcomePct, rng);
    for (let h = 0; h < 24; h++) {
      const ts = T0 + (d * 24 + h) * HOUR;
      const dt = new Date(ts);
      const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push({
        ts, open: rows[h].open, high: rows[h].high, low: rows[h].low,
        close: rows[h].close, quoteVolume: rows[h].vol,
      });
    }
    price = rows[23].close;
  }
  fs.mkdirSync(CACHE, { recursive: true });
  const written = [];
  for (const [month, rows] of byMonth) {
    const f = path.join(CACHE, `${symbol}-1h-${month}.json`);
    fs.writeFileSync(f, JSON.stringify(rows));
    written.push(f);
  }
  const drift = (price / 100 - 1) * 100;
  return { written, driftPct: drift };
}

async function runOne(symbol, layout) {
  const res = await unitTask({
    combo: { trade: symbol, ctx1: null, ctx2: null, size: 1 },
    branch: { geometry: 'daily-1d', decision: 'argmax', band: 'auto', weekdaysOnly: false },
    stage: 'promoted',
    params: {
      allLoaded: true, holdout: true, windowLayout: layout, interlaceSeed: 1,
      sharedBand: true, minTrades: 10, feePerLeg: 0.125, labelShiftScope: 'window',
    },
  });
  const b = res.best || {};
  const h = b.holdout || {};
  return {
    layout,
    testPeriods: res.testPeriods,
    holdPeriods: h.periods ?? null,
    holdPnl: h.pnl ?? null,
    holdTrades: h.trades ?? null,
    perTrade: h.trades ? h.pnl / h.trades : null,
    vsAlwaysLong: h.vsAlwaysLong ?? null,
    holdEdge: res.bestEdge && res.bestEdge.holdoutMetrics ? res.bestEdge.holdoutMetrics.edge : null,
    holdAcc: res.bestEdge && res.bestEdge.holdoutMetrics ? res.bestEdge.holdoutMetrics.testAcc : null,
    cell: b.entry ? `${b.entry}/${b.gate ?? '-'}/d${b.dMult ?? '-'}/t${b.tHours}h q${b.quorum}` : null,
  };
}

(async () => {
  const cleanup = [];
  try {
    const sig = generate('SIGUSDT', true, 1234);
    const noi = generate('NOISEUSDT', false, 5678);
    cleanup.push(...sig.written, ...noi.written);
    console.log(`fabricated ${DAYS} days per coin; end-to-end drift: signal ${sig.driftPct.toFixed(2)}%, noise ${noi.driftPct.toFixed(2)}%`);

    const out = {};
    for (const sym of ['SIGUSDT', 'NOISEUSDT']) {
      out[sym] = {};
      for (const layout of ['chronological', 'interlaced']) {
        process.stdout.write(`running ${sym} / ${layout} through the real engine...\n`);
        out[sym][layout] = await runOne(sym, layout);
      }
    }

    const S = out.SIGUSDT; const N = out.NOISEUSDT;
    const pct = (v) => (v == null ? '—' : (100 * v).toFixed(1) + 'pt');
    const $ = (v) => (v == null ? '—' : (v < 0 ? '-' : '+') + '$' + Math.abs(v).toFixed(2));
    console.log('\nRESULTS (held-back window; money is $ per $100 book)');
    for (const [name, o] of [['signal', S], ['noise', N]]) {
      for (const l of ['chronological', 'interlaced']) {
        const r = o[l];
        console.log(`  ${name.padEnd(6)} ${l.padEnd(13)} money ${$(r.holdPnl).padStart(9)} (${r.holdTrades}t, ${$(r.perTrade)}/t)  acc-edge ${pct(r.holdEdge).padStart(7)}  vs always-long ${$(r.vsAlwaysLong).padStart(9)}  periods ${r.testPeriods}/${r.holdPeriods}  cell ${r.cell}`);
      }
    }

    const checks = [];
    const chk = (id, ok, msg) => { checks.push(ok); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${id}: ${msg}`); };
    console.log('\nDECLARED CRITERIA');
    chk('S1', S.chronological.holdPnl > 0 && S.interlaced.holdPnl > 0,
      `signal money positive both layouts (${$(S.chronological.holdPnl)} / ${$(S.interlaced.holdPnl)})`);
    chk('S2', S.chronological.holdEdge > 0.05 && S.interlaced.holdEdge > 0.05,
      `signal accuracy edge > +5pt both (${pct(S.chronological.holdEdge)} / ${pct(S.interlaced.holdEdge)})`);
    chk('S3', S.chronological.vsAlwaysLong > 0 && S.interlaced.vsAlwaysLong > 0,
      `signal beats always-long both (${$(S.chronological.vsAlwaysLong)} / ${$(S.interlaced.vsAlwaysLong)})`);
    chk('N1', Math.abs(N.chronological.holdEdge) < 0.03 && Math.abs(N.interlaced.holdEdge) < 0.03,
      `noise accuracy edge inside ±3pt both (${pct(N.chronological.holdEdge)} / ${pct(N.interlaced.holdEdge)})`);
    chk('N2', N.chronological.holdPnl < S.chronological.holdPnl / 3 && N.interlaced.holdPnl < S.interlaced.holdPnl / 3,
      `noise money < signal/3 both (${$(N.chronological.holdPnl)} vs ${$(S.chronological.holdPnl)}; ${$(N.interlaced.holdPnl)} vs ${$(S.interlaced.holdPnl)})`);
    const ratio = S.chronological.perTrade && S.interlaced.perTrade ? S.interlaced.perTrade / S.chronological.perTrade : null;
    chk('A1', ratio != null && ratio > 1 / 3 && ratio < 3,
      `layouts agree on signal money per trade within 3x (ratio ${ratio == null ? '—' : ratio.toFixed(2)})`);
    chk('C1', S.chronological.testPeriods === S.interlaced.testPeriods
      && S.chronological.holdPeriods === S.interlaced.holdPeriods
      && N.chronological.testPeriods === N.interlaced.testPeriods
      && N.chronological.holdPeriods === N.interlaced.holdPeriods,
      'period counts identical across layouts, both coins');

    console.log(checks.every(Boolean) ? '\nPLANTED-SIGNAL CHECK PASS' : '\nPLANTED-SIGNAL CHECK FAIL');
    process.exitCode = checks.every(Boolean) ? 0 : 1;
  } finally {
    for (const f of cleanup) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
    console.log(`cleaned up ${cleanup.length} fabricated cache files`);
  }
})();
