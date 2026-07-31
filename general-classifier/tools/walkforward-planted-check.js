// WALK-FORWARD PLANTED CHECK (QC 56) — the new instrument measures known
// weights before it is allowed to measure the market.
//
// Three fabricated coins through the REAL fold harness (wfUnitTask):
//   WFSIGUSDT  stationary planted rule (next day follows today, 70%),
//              zero drift — the harness must harvest it in MOST folds.
//   WFDIEUSDT  the same rule until day 720, pure noise after — the harness
//              must SEE the death: early folds earn, late folds do not.
//              This is the capability no single-holdout design has.
//   WFNOIUSDT  pure noise — the harness must invent nothing.
//
// Candle construction is the third-generation generator from
// planted-signal-check.js (endpoint-pinned random walks — its first two
// versions' lessons are baked in).
//
// CRITERIA, DECLARED BEFORE RUNNING (labeled):
//   A1 WFSIG stitched holdout total > 0 AND >=60% of folds positive
//      [derived: a 70% rule pays every era]
//   A2 WFSIG total beats the summed always-long control [derived: driftless]
//   B1 WFDIE folds whose hold slice ends before day 720: total > 0
//      [derived: the rule is alive there]
//   B2 WFDIE folds whose hold slice starts after day 780: total < B1/3
//      [guessed margin: dead-zone folds are fee-bleed around zero]
//   C1 WFNOI total < WFSIG total / 3 [guessed, mirrors the layout check]
//   D1 determinism: running WFSIG twice yields byte-identical fold records
//      [derived: everything is seeded]
const fs = require('fs');
const path = require('path');
const { wfUnitTask } = require('../lib/walkforward');
const { mulberry32 } = require('../lib/interlace');

const CACHE = path.join(__dirname, '..', 'data', 'cache');
const HOUR = 3_600_000;
const DAYS = 1200;
const T0 = Date.UTC(2021, 0, 4);

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

// signalUntilDay: rule active before this day index, coin-flip after.
function generate(symbol, signalUntilDay, seed) {
  const rng = mulberry32(seed);
  const trends = [];
  for (let b = 0; b < Math.ceil(DAYS / 20); b++) {
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
  for (let d = 0; d < DAYS; d++) {
    const prevTrend = d === 0 ? 1 : trends[d - 1];
    const alive = d < signalUntilDay;
    const follow = alive ? (rng() < 0.7 ? 1 : -1) : (rng() < 0.5 ? 1 : -1);
    const outcomePct = prevTrend * follow * magOf();
    const trendPct = trends[d] > 0 ? 1.5 : (1 / 1.015 - 1) * 100;
    const rows = dayCandles(price, trendPct, outcomePct, rng);
    for (let h = 0; h < 24; h++) {
      const ts = T0 + (d * 24 + h) * HOUR;
      const dt = new Date(ts);
      const key = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key).push({ ts, open: rows[h].open, high: rows[h].high, low: rows[h].low, close: rows[h].close, quoteVolume: rows[h].vol });
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
  return written;
}

async function runUnit(symbol) {
  return wfUnitTask({
    combo: { trade: symbol, ctx1: null, ctx2: null, size: 1 },
    branch: { geometry: 'daily-1d', decision: 'argmax', band: 'auto', weekdaysOnly: false },
    params: { allLoaded: true, minTradesSlice: 5, feePerLeg: 0.125 },
  });
}

(async () => {
  const cleanup = [];
  try {
    cleanup.push(...generate('WFSIGUSDT', DAYS, 41));
    cleanup.push(...generate('WFDIEUSDT', 720, 42));
    cleanup.push(...generate('WFNOIUSDT', 0, 43));
    const sig = await runUnit('WFSIGUSDT');
    const die = await runUnit('WFDIEUSDT');
    const noi = await runUnit('WFNOIUSDT');
    const sig2 = await runUnit('WFSIGUSDT'); // determinism twin

    const $ = (v) => (v < 0 ? '-' : '+') + '$' + Math.abs(v).toFixed(2);
    const sum = (fs2, f) => fs2.filter((x) => !x.skipped && f(x)).reduce((s, x) => s + x.holdPnl, 0);
    const deathTs = T0 + 720 * 24 * HOUR;
    const lateTs = T0 + 780 * 24 * HOUR;
    const dieEarly = sum(die.folds, (f) => f.testStart + (8 + 8) * 7 * 24 * HOUR <= deathTs);
    const dieLate = sum(die.folds, (f) => f.testStart + 8 * 7 * 24 * HOUR >= lateTs);

    console.log(`WFSIG: total ${$(sig.agg.holdTotal)} over ${sig.agg.foldsScored} folds, ${sig.agg.foldsPositive} positive, vs-long ${$(sig.agg.holdTotal - sig.agg.alwaysLongTotal)}`);
    console.log(`WFDIE: early(alive) ${$(dieEarly)}  late(dead) ${$(dieLate)}  [death planted at day 720]`);
    console.log(`WFNOI: total ${$(noi.agg.holdTotal)} over ${noi.agg.foldsScored} folds, ${noi.agg.foldsPositive} positive`);

    const checks = [];
    const chk = (id, ok, msg) => { checks.push(ok); console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${id}: ${msg}`); };
    console.log('\nDECLARED CRITERIA');
    chk('A1', sig.agg.holdTotal > 0 && sig.agg.foldsPositive >= 0.6 * sig.agg.foldsScored,
      `signal harvested: ${$(sig.agg.holdTotal)}, ${sig.agg.foldsPositive}/${sig.agg.foldsScored} folds positive`);
    chk('A2', sig.agg.holdTotal - sig.agg.alwaysLongTotal > 0,
      `signal beats always-long by ${$(sig.agg.holdTotal - sig.agg.alwaysLongTotal)}`);
    chk('B1', dieEarly > 0, `dying signal earns while alive: ${$(dieEarly)}`);
    chk('B2', dieLate < dieEarly / 3, `and stops after death: late ${$(dieLate)} vs early ${$(dieEarly)}`);
    chk('C1', noi.agg.holdTotal < sig.agg.holdTotal / 3, `noise invents nothing: ${$(noi.agg.holdTotal)} vs signal ${$(sig.agg.holdTotal)}`);
    chk('D1', JSON.stringify(sig.folds) === JSON.stringify(sig2.folds), 'byte-identical rerun');
    console.log(checks.every(Boolean) ? '\nWALK-FORWARD PLANTED CHECK PASS' : '\nWALK-FORWARD PLANTED CHECK FAIL');
    process.exitCode = checks.every(Boolean) ? 0 : 1;
  } finally {
    for (const f of cleanup) { try { fs.unlinkSync(f); } catch { /* gone */ } }
    console.log(`cleaned up ${cleanup.length} fabricated cache files`);
  }
})();
