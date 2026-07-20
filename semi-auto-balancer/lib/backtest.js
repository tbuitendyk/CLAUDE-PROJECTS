const crypto = require('crypto');
const db = require('./db');
const { effectiveThreshold, indexUsdFor, priceAsset } = require('./balancer');
const { getDailyHistory } = require('./history');
const hourly = require('./hourly');

// Phase 2: threshold sweep — an advisory backtest that replays the profile's
// CURRENT mix over cached daily history at many sensitivity settings X and
// reports where the plateau is. Advisory-with-apply: nothing changes until
// the user clicks Apply, and Apply refuses stale results.
//
// The simulator reuses the production engine's own exported functions
// (effectiveThreshold, indexUsdFor, priceAsset) so breach detection and trade
// sizing are the SAME code the emails run — the parity test asserts it.
//
// CRITICAL DESIGN POINT (from PLAN.md): net basket growth alone is a
// price-blind objective — any buy-below-snapshot raises it, including feeding
// a terminal downtrend. The sweep therefore reports basket AND value curves
// and recommends an X only where BOTH sit on a plateau; divergence renders a
// warning instead of a recommendation.

const HOUR_MS = 3_600_000;
const X_GRID = [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 12, 14, 17, 20, 25, 30];
const PLATEAU_PP = 0.5; // "within 0.5pp of best" defines a plateau
const MIN_TRADES = 10; // fewer trades in the winning region = thin evidence
const START_TOTAL = 1000; // index units; sim starts AT target weights

// Staleness stamp input: what the sweep's conclusions actually depend on.
// Quantities do NOT invalidate (the sim starts at target weights).
function computeTargetsHash(assets) {
  const rows = assets
    .filter((a) => a.target_pct > 0 || a.is_index)
    .map((a) => [a.coingecko_id, Number(a.target_pct) || 0, a.is_index ? 1 : 0])
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
}

// Intersect the per-asset daily series onto common UTC-day bars. Uniform
// granularity only — mixing hourly/daily would jump breach density 24× at
// the boundary.
function alignBars(assets, history) {
  let common = null;
  for (const a of assets) {
    const set = new Set((history.get(a.coingecko_id) || []).map((r) => r.ts));
    common = common == null ? set : new Set([...common].filter((t) => set.has(t)));
  }
  const priceMaps = new Map(
    assets.map((a) => [
      a.coingecko_id,
      new Map((history.get(a.coingecko_id) || []).map((r) => [r.ts, r.usd_price])),
    ])
  );
  return [...(common || [])]
    .sort((x, y) => x - y)
    .map((ts) => ({
      ts,
      usd: Object.fromEntries(assets.map((a) => [a.coingecko_id, priceMaps.get(a.coingecko_id).get(ts)])),
    }));
}

// One simulation run. X = price-move sensitivity % (null = pure hold, the
// baseline). Mechanics mirror production: all same-bar breaches are computed
// from ONE pre-trade snapshot (exactly the trade set an email would carry),
// executed at the first bar >= breach_ts + lagHours at THAT bar's prices
// (the user trades the emailed quantity, hours later, at market); the tether
// absorbs cost/proceeds and the (fee+spread)% per leg; no new signals while
// a trade set is outstanding (armed → notified, re-armed by the sync).
function simulate(simAssets, X, { feePct = 0.38, spreadPct = 0.1, lagHours = 6, bars }) {
  const tether = simAssets.find((a) => a.is_index);
  if (!tether) throw new Error('simulate needs a tethered index asset');
  const evalAssets = simAssets.filter((a) => !a.is_index && a.target_pct > 0);
  const feeRate = (feePct + spreadPct) / 100;

  const qty = new Map();
  const units0 = new Map();
  let started = false;
  let pending = null; // {ts, trades: [{a, side, tradeQty}]}
  let feesPaid = 0;
  let tradeCount = 0;
  const signals = []; // every emitted trade set (the "emails")
  let peak = 0;
  let maxDD = 0;
  let total = 0;

  for (const bar of bars) {
    const relOf = new Map();
    let complete = true;
    for (const a of simAssets) {
      const p = priceAsset(a, indexUsdFor(simAssets, bar.usd), bar.usd);
      if (!p || !(p.rel > 0)) complete = false;
      else relOf.set(a, p.rel);
    }
    if (!complete) continue; // aligned bars should always be complete

    if (!started) {
      for (const a of simAssets) {
        const q = ((a.target_pct || 0) / 100) * START_TOTAL / relOf.get(a);
        qty.set(a, q);
        units0.set(a, q);
      }
      started = true;
    }

    // Execute an outstanding trade set once the lag has passed. Sells first
    // (they fund the buys); buys cap at the tether actually available.
    if (pending && bar.ts >= pending.ts + lagHours * HOUR_MS && X != null) {
      const ordered = [...pending.trades].sort((a, b) => (a.side === 'SELL' ? -1 : 1) - (b.side === 'SELL' ? -1 : 1));
      for (const t of ordered) {
        const r = relOf.get(t.a);
        let q = t.tradeQty;
        if (t.side === 'BUY') {
          const avail = Math.max(0, qty.get(tether));
          const cost = q * r * (1 + feeRate);
          if (cost > avail) q *= avail / (cost || 1);
          if (!(q > 0)) continue;
          const gross = q * r;
          const fee = gross * feeRate;
          qty.set(t.a, qty.get(t.a) + q);
          qty.set(tether, qty.get(tether) - gross - fee);
          feesPaid += fee;
        } else {
          q = Math.min(q, qty.get(t.a));
          if (!(q > 0)) continue;
          const gross = q * r;
          const fee = gross * feeRate;
          qty.set(t.a, qty.get(t.a) - q);
          qty.set(tether, qty.get(tether) + gross - fee);
          feesPaid += fee;
        }
        tradeCount++;
      }
      pending = null;
    }

    total = 0;
    for (const a of simAssets) total += qty.get(a) * relOf.get(a);
    if (total > peak) peak = total;
    else if (peak > 0) maxDD = Math.max(maxDD, 1 - total / peak);

    // Detect breaches with the production functions and sizing formulas.
    if (X != null && !pending && total > 0) {
      const sens = X / 100;
      const list = [];
      for (const a of evalAssets) {
        const w = a.target_pct / 100;
        const T = effectiveThreshold(sens, w);
        if (T == null) continue;
        const valueRel = qty.get(a) * relOf.get(a);
        const actualPct = (valueRel / total) * 100;
        const drift = (actualPct - a.target_pct) / a.target_pct;
        if (Math.abs(drift) >= T) {
          const deltaRel = w * total - valueRel;
          list.push({
            a,
            side: deltaRel > 0 ? 'BUY' : 'SELL',
            tradeQty: Math.abs(deltaRel) / relOf.get(a),
          });
        }
      }
      if (list.length > 0) {
        pending = { ts: bar.ts, trades: list };
        signals.push({
          ts: bar.ts,
          trades: list.map((t) => ({ symbol: t.a.symbol, side: t.side, qty: t.tradeQty })),
        });
      }
    }
  }

  // Chained basket exactly as production: Σ target-weight × unit ratio.
  // No splices happen in-sim (no target changes, no flows).
  let basket = 0;
  for (const a of simAssets) {
    const w = (a.target_pct || 0) / 100;
    const u = units0.get(a);
    basket += w * (u > 0 ? qty.get(a) / u : 1);
  }

  return {
    x: X,
    netBasketGrowthPct: (basket - 1) * 100,
    valueGrowthPct: (total / START_TOTAL - 1) * 100,
    maxValueDrawdownPct: maxDD * 100,
    tradeCount,
    feesPct: (feesPaid / START_TOTAL) * 100,
    signals,
  };
}

// The plateau band is noise-scaled: 0.5pp absolute materiality (≈ one extra
// round trip's cost on a quarter of the pool over the window) OR the median
// absolute difference between ADJACENT grid results, whichever is larger.
// Single-path backtests are lumpy — one trade landing a bar earlier moves
// the basket by whole points — and differences smaller than the run-to-run
// wobble are seed noise, not signal.
function noiseBand(rows, metric) {
  const diffs = [];
  for (let i = 1; i < rows.length; i++) diffs.push(Math.abs(rows[i][metric] - rows[i - 1][metric]));
  diffs.sort((a, b) => a - b);
  const mad = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 0;
  return Math.max(PLATEAU_PP, mad);
}

// Xs within the band of the best value of `metric`. `floor` joins the
// contest as a pseudo-candidate: the value plateau passes the HOLD baseline
// in as its floor, because holding is the true loose end of the grid — in a
// downtrend every X "wins" against the other Xs while all of them lose to
// doing nothing, and without the floor the sweep would recommend the least
// bad way to bleed.
function plateauXs(rows, metric, floor = -Infinity, band = PLATEAU_PP) {
  const best = Math.max(...rows.map((r) => r[metric]), floor);
  return rows.filter((r) => r[metric] >= best - band).map((r) => r.x);
}

function range(xs) {
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
}

// One full sweep over the X grid, with the joint-plateau recommendation and
// sub-window stability check.
function sweep(simAssets, bars, { feePct = 0.38, spreadPct = 0.1, lagHours = 6, setProgress = () => {} } = {}) {
  const opts = { feePct, spreadPct, lagHours };
  const grid = [];
  for (let i = 0; i < X_GRID.length; i++) {
    setProgress(`simulating X=${X_GRID[i]}% (${i + 1}/${X_GRID.length})`);
    const r = simulate(simAssets, X_GRID[i], { ...opts, bars });
    delete r.signals; // bulky; parity tests use simulate() directly
    grid.push(r);
  }
  const hold = simulate(simAssets, null, { ...opts, bars });

  const basketBand = noiseBand(grid, 'netBasketGrowthPct');
  const valueBand = noiseBand(grid, 'valueGrowthPct');
  const basketXs = plateauXs(grid, 'netBasketGrowthPct', -Infinity, basketBand);
  const valueXs = plateauXs(grid, 'valueGrowthPct', hold.valueGrowthPct, valueBand);
  const jointXs = basketXs.filter((x) => valueXs.includes(x));
  // Looser end of the joint plateau: equal performance, fewer trades, lower
  // sensitivity to noise.
  const recoX = jointXs.length > 0 ? Math.max(...jointXs) : null;

  const warnings = [];
  if (recoX == null) {
    const bestGridValue = Math.max(...grid.map((r) => r.valueGrowthPct));
    warnings.push(
      bestGridValue < hold.valueGrowthPct - PLATEAU_PP
        ? 'Trading at EVERY sensitivity underperforms simply holding in this window (trend, not oscillation) — ' +
            'unit growth here is fed by falling prices. No recommendation.'
        : 'Basket and value optima DIVERGE in this window. No recommendation — tightening the threshold here ' +
            'would buy into weakness.'
    );
  }
  const recoRow = grid.find((r) => r.x === recoX);
  if (recoRow && recoRow.tradeCount < MIN_TRADES) {
    warnings.push(`Only ${recoRow.tradeCount} simulated trade(s) in the winning region — thin evidence, treat as weak.`);
  }
  if (bars.length < 240) warnings.push(`Short history window (${bars.length} daily bars) — results are tentative.`);

  // Stability: re-run the sweep over 2–4 sub-windows and check the
  // recommendation holds in each regime.
  const n = bars.length;
  const wcount = n >= 480 ? 4 : n >= 240 ? 2 : 1;
  const subWindows = [];
  if (wcount > 1) {
    const size = Math.floor(n / wcount);
    for (let w = 0; w < wcount; w++) {
      const slice = bars.slice(w * size, w === wcount - 1 ? n : (w + 1) * size);
      const g = X_GRID.map((x) => simulate(simAssets, x, { ...opts, bars: slice }));
      const holdW = simulate(simAssets, null, { ...opts, bars: slice });
      const joint = plateauXs(g, 'netBasketGrowthPct', -Infinity, noiseBand(g, 'netBasketGrowthPct')).filter((x) =>
        plateauXs(g, 'valueGrowthPct', holdW.valueGrowthPct, noiseBand(g, 'valueGrowthPct')).includes(x)
      );
      subWindows.push({ from: slice[0].ts, to: slice[slice.length - 1].ts, bars: slice.length, joint: range(joint) });
    }
    if (recoX != null) {
      const misses = subWindows.filter((sw) => !sw.joint || recoX < sw.joint[0] || recoX > sw.joint[1]);
      if (misses.length > 0) {
        warnings.push(
          `Recommendation is not stable across sub-windows (${misses.length}/${subWindows.length} disagree) — regimes differ inside this window.`
        );
      }
    }
  }

  return {
    grid,
    hold: { valueGrowthPct: hold.valueGrowthPct, maxValueDrawdownPct: hold.maxValueDrawdownPct },
    plateau: {
      basket: range(basketXs),
      value: range(valueXs),
      joint: range(jointXs),
      bandPp: { basket: basketBand, value: valueBand },
    },
    recommendation:
      recoX != null
        ? {
            x: recoX,
            reason:
              `looser end of the range where basket AND value both stay within the noise band of best ` +
              `(±${basketBand.toFixed(1)}pp / ±${valueBand.toFixed(1)}pp)`,
          }
        : null,
    warnings,
    subWindows,
  };
}

// Recent-window tabulation: the same X grid re-simulated over the most recent
// HALF and QUARTER of the bars, so a setup's performance can be eyeballed
// across "all history / lately / very lately" instead of one blended number.
function recentWindows(simAssets, bars, opts) {
  const out = {};
  for (const [key, frac] of [['half', 0.5], ['quarter', 0.25]]) {
    const slice = bars.slice(Math.floor(bars.length * (1 - frac)));
    if (slice.length < 30) continue;
    const grid = X_GRID.map((x) => {
      const r = simulate(simAssets, x, { ...opts, bars: slice });
      return {
        x,
        valueGrowthPct: r.valueGrowthPct,
        netBasketGrowthPct: r.netBasketGrowthPct,
        maxValueDrawdownPct: r.maxValueDrawdownPct,
        tradeCount: r.tradeCount,
      };
    });
    const hold = simulate(simAssets, null, { ...opts, bars: slice });
    out[key] = {
      from: slice[0].ts,
      to: slice[slice.length - 1].ts,
      bars: slice.length,
      hold: { valueGrowthPct: hold.valueGrowthPct, maxValueDrawdownPct: hold.maxValueDrawdownPct },
      grid,
    };
  }
  return out;
}

// IO wrapper the job runner calls: load the profile's active mix, pull daily
// history through the cache (exchange-first, CG fallback), align, sweep,
// stamp. Returns {result, params} as lib/jobs.js expects.
// opts.mix = [{id, symbol, targetPct, isIndex}] sweeps a HYPOTHETICAL mix
// (e.g. a composition-lab row) instead of the profile's applied targets —
// the result is stamped hypothetical and Apply is refused for it.
async function runTuneSweep(profileId, { days = 730, lagHours = 6, granularity = 'daily', mix = null } = {}, setProgress = () => {}) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
  if (!profile) throw new Error('profile not found');
  const hypothetical = Array.isArray(mix) && mix.length > 0;
  const active = hypothetical
    ? mix.map((m) => ({
        coingecko_id: m.id,
        symbol: String(m.symbol || m.id),
        target_pct: Number(m.targetPct) || 0,
        is_index: m.isIndex ? 1 : 0,
      }))
    : db
        .prepare('SELECT * FROM assets WHERE profile_id = ?')
        .all(profileId)
        .filter((a) => a.target_pct > 0 || a.is_index);
  if (!active.some((a) => a.is_index)) {
    throw new Error('the sweep needs a tethered index asset — checkmark one first');
  }
  const targetSum = active.reduce((s, a) => s + (a.target_pct || 0), 0);
  if (Math.abs(targetSum - 100) > 0.01)
    throw new Error(hypothetical ? 'mix targets must total 100%' : 'set targets first (they must total 100%)');

  let bars;
  if (granularity === 'hourly') {
    // Hourly bars: the cache auto-fills through the source ladder on demand
    // (Bitso years-in-one-call, Binance portal, Kraken trades rebuild, CG
    // stopgap) — no waiting on accrual. Uniform granularity only: an asset
    // without enough hourly coverage fails the run with names, not silence.
    setProgress('ensuring hourly coverage (auto-fills on first use)…');
    const series = new Map();
    const thin = [];
    for (const a of active) {
      const st = await hourly.ensureHourly(a.coingecko_id, a.symbol, { depthDays: days });
      const rows = hourly.getHourlySeries(a.coingecko_id, Math.round(days * 24));
      series.set(a.coingecko_id, rows);
      if (rows.length < 30 * 24) thin.push(`${a.symbol.toUpperCase()} (${st.status}, ${rows.length}h cached)`);
    }
    if (thin.length > 0) {
      throw new Error(
        `hourly coverage too thin for: ${thin.join(', ')} — deep backfills run in the background, retry in a few minutes`
      );
    }
    bars = alignBars(active, series);
    if (bars.length < 30 * 24) {
      throw new Error(`not enough overlapping hourly history across the mix (${bars.length} bars)`);
    }
  } else {
    setProgress('fetching daily price history…');
    const history = new Map();
    for (const a of active) {
      // Symbol hint lets the exchange layer serve DEEP history — essential for
      // hypothetical mixes carrying assets the profile doesn't hold.
      history.set(a.coingecko_id, await getDailyHistory(a.coingecko_id, days, a.symbol ? String(a.symbol).toLowerCase() : null));
    }
    bars = alignBars(active, history);
    if (bars.length < 90) {
      throw new Error(`not enough overlapping daily history across the mix (${bars.length} days)`);
    }
  }

  const costOpts = { feePct: profile.fee_pct, spreadPct: profile.spread_pct, lagHours };
  const result = sweep(active, bars, { ...costOpts, setProgress });
  // (a) all history is the main grid; (b)/(c) re-simulate the same X grid over
  // the most recent half and quarter so recent behaviour is visible untangled.
  setProgress('tabulating recent half / quarter windows…');
  result.recent = recentWindows(active, bars, costOpts);
  result.currentX = profile.threshold_pct;
  result.stamp = {
    targetsHash: computeTargetsHash(active),
    hypothetical,
    feePct: profile.fee_pct,
    spreadPct: profile.spread_pct,
    lagHours,
    granularity,
    dataFrom: bars[0].ts,
    dataTo: bars[bars.length - 1].ts,
    bars: bars.length,
    assets: active.map((a) => a.symbol),
    targets: active.map((a) => `${String(a.symbol).toUpperCase()}:${a.target_pct}`),
  };
  return { result, params: { days, lagHours, granularity, hypothetical } };
}

module.exports = { simulate, sweep, runTuneSweep, recentWindows, alignBars, computeTargetsHash, X_GRID, START_TOTAL };
