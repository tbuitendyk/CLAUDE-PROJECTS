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
const { mulberry32 } = require('../lib/rng');

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

async function runUnit(symbol, extra = {}) {
  return wfUnitTask({
    combo: { trade: symbol, ctx1: null, ctx2: null, size: 1 },
    branch: { geometry: 'daily-1d', decision: 'argmax', band: 'auto', weekdaysOnly: false },
    params: { allLoaded: true, minTradesSlice: 5, feePerLeg: 0.125, ...extra },
  });
}

(async () => {
  const cleanup = [];
  // Progress lines with times: the first run of this tool sat for hours with
  // an EMPTY log because nothing printed until every unit finished — a wedge
  // and normal progress looked identical from outside. Each unit is minutes;
  // a unit line older than ~30 min means stuck, and the log says where.
  const t = () => new Date().toISOString().slice(11, 19);
  const step = async (label, fn) => {
    console.log(`[${t()} UTC] ${label}...`);
    const r = await fn();
    console.log(`[${t()} UTC] ${label} done`);
    return r;
  };
  try {
    console.log(`walk-forward planted check — engine ${require('../package.json').version}`);
    cleanup.push(...generate('WFSIGUSDT', DAYS, 41));
    cleanup.push(...generate('WFDIEUSDT', 720, 42));
    cleanup.push(...generate('WFNOIUSDT', 0, 43));
    // THE SEED CONTROL (diagnosis of B1's first failure): stationary signal
    // on the DYING coin's seed. If this one also fails, the fault is
    // per-fold selection noise, not the death; if it passes, the death
    // somehow contaminates alive folds and the harness is suspect.
    cleanup.push(...generate('WFS42USDT', DAYS, 42));
    const sig = await step('WFSIG (stationary signal)', () => runUnit('WFSIGUSDT'));
    const die = await step('WFDIE (signal dies day 720)', () => runUnit('WFDIEUSDT'));
    const noi = await step('WFNOI (pure noise)', () => runUnit('WFNOIUSDT'));
    const s42 = await step('WFS42 (seed control)', () => runUnit('WFS42USDT'));
    const sig2 = await step('WFSIG determinism twin', () => runUnit('WFSIGUSDT'));
    // THE NULL RUN against the planted signal (QC 66 construction: each
    // member's vote mix dealt onto random days). If the deal machinery is
    // honest, the planted edge dies; if the "null" still earns on a signal
    // we planted, the null is broken and no market null count matters.
    const sigN = await step('WFSIG null arm (seed 7)', () => runUnit('WFSIGUSDT', { nullShiftSeed: 7 }));
    const sigN2 = await step('WFSIG null determinism twin', () => runUnit('WFSIGUSDT', { nullShiftSeed: 7 }));

    const $ = (v) => (v < 0 ? '-' : '+') + '$' + Math.abs(v).toFixed(2);
    // Per-fold detail for diagnosis: B1's first failure showed three
    // near-identical sums (early/late/noise all ~ -$74), which is a pattern
    // to explain, not a number to accept.
    for (const [nm, u] of [['WFSIG', sig], ['WFDIE', die], ['WFNOI', noi], ['WFS42', s42]]) {
      console.log(`\n${nm} folds:`);
      for (const f of u.folds) {
        const d = new Date(f.testStart).toISOString().slice(0, 10);
        if (f.skipped) { console.log(`  ${d}  skipped: ${f.skipped}`); continue; }
        console.log(`  ${d}  hold ${$(f.holdPnl)} (${f.holdTrades}t)  test ${$(f.testPnl)}  q${f.cell.quorum} ${f.cell.entry}/${f.cell.gate ?? '-'}/t${f.cell.tHours}h  band ±${f.bandPct.toFixed(2)}%`);
      }
    }
    const sum = (fs2, f) => fs2.filter((x) => !x.skipped && f(x)).reduce((s, x) => s + x.holdPnl, 0);
    const deathTs = T0 + 720 * 24 * HOUR;
    const lateTs = T0 + 780 * 24 * HOUR;
    const dieEarly = sum(die.folds, (f) => f.testStart + (8 + 8) * 7 * 24 * HOUR <= deathTs);
    const dieLate = sum(die.folds, (f) => f.testStart + 8 * 7 * 24 * HOUR >= lateTs);

    console.log(`WFSIG: total ${$(sig.agg.holdTotal)} over ${sig.agg.foldsScored} folds, ${sig.agg.foldsPositive} positive, vs-long ${$(sig.agg.holdTotal - sig.agg.alwaysLongTotal)}`);
    console.log(`WFDIE: early(alive) ${$(dieEarly)}  late(dead) ${$(dieLate)}  [death planted at day 720]`);
    console.log(`WFNOI: total ${$(noi.agg.holdTotal)} over ${noi.agg.foldsScored} folds, ${noi.agg.foldsPositive} positive`);
    console.log(`WFS42: total ${$(s42.agg.holdTotal)} over ${s42.agg.foldsScored} folds, ${s42.agg.foldsPositive} positive, vs-long ${$(s42.agg.holdTotal - s42.agg.alwaysLongTotal)}  [seed control for B1]`);
    const s42early = sum(s42.folds, (f) => f.testStart + (8 + 8) * 7 * 24 * HOUR <= deathTs);
    console.log(`DIAGNOSIS: same-era folds — WFDIE(alive) ${$(dieEarly)} vs WFS42(same seed, no death) ${$(s42early)}`);

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
    const sigVsL = sig.agg.holdTotal - sig.agg.alwaysLongTotal;
    const sigNVsL = sigN.agg.holdTotal - sigN.agg.alwaysLongTotal;
    console.log(`WFSIG-null: total ${$(sigN.agg.holdTotal)} vs real ${$(sig.agg.holdTotal)}; vs-long ${$(sigNVsL)} vs real ${$(sigVsL)}`);
    // N-margins: direction DERIVED (rotated votes cannot carry the planted
    // 70%-follow edge), the 1/4 factor GUESSED like C1's 1/3.
    chk('N1', sigN.agg.holdTotal < sig.agg.holdTotal / 4,
      `the null arm destroys the planted money: ${$(sigN.agg.holdTotal)} vs real ${$(sig.agg.holdTotal)}`);
    // N2 is anchored at the NOISE coin's level, not at zero: always-long on
    // these zero-drift coins bleeds fees, so a zero-anchored quarter-margin
    // would demand the null LOSE an amount set by fee drag rather than by
    // information destruction — an honest null could false-FAIL (review
    // 2026-08-01). Anchor = machinery-on-pure-noise; the null must close
    // at least 3/4 of the signal-to-noise gap [factor GUESSED, like C1].
    const noiVsL = noi.agg.holdTotal - noi.agg.alwaysLongTotal;
    chk('N2', sigNVsL < noiVsL + (sigVsL - noiVsL) / 4,
      `and closes 3/4 of the signal-to-noise skill gap: null ${$(sigNVsL)} vs noise anchor ${$(noiVsL)}, real ${$(sigVsL)}`);
    chk('N3', JSON.stringify(sigN.folds) === JSON.stringify(sigN2.folds), 'null arm byte-identical on the same seed');
    chk('N4', JSON.stringify(sigN.folds) !== JSON.stringify(sig.folds), 'and actually different from the real arm');
    console.log(checks.every(Boolean) ? '\nWALK-FORWARD PLANTED CHECK PASS' : '\nWALK-FORWARD PLANTED CHECK FAIL');
    process.exitCode = checks.every(Boolean) ? 0 : 1;
  } finally {
    for (const f of cleanup) { try { fs.unlinkSync(f); } catch { /* gone */ } }
    console.log(`cleaned up ${cleanup.length} fabricated cache files`);
  }
})();
