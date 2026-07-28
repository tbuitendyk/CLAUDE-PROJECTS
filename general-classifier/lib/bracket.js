// Bracket lab core: multi-asset combo datasets + the OCO bracket execution
// simulator + the mechanical execution sweep. Pure functions over data the
// orchestrator (batch.js) supplies — no I/O here, so every piece is testable
// and the frozen books' modules are never touched.
//
// COMBOS reuse the existing, tested 2-asset chunk/feature builder verbatim:
//   single  [trade P]                      — slice of a degenerate 2-asset build
//   double  [trade P][ctx P][cross 4]      — buildChunks(trade, ctx) as-is
//   triple  [trade P][b P][crossAB 4][c P][crossAC 4]
//           — buildChunks(trade,b) ⧺ context half of buildChunks(trade,c),
//             intersected on startTs, so no new feature math exists anywhere.
// P = nDays + 12 (the per-asset block); labels always come from the TRADE
// asset, so every layout of one combo shares band, labels and test periods.

const { HOUR_MS } = require('./binance');
// pnlAt is the paper books' own P&L arithmetic. simMarket uses it directly so
// a market cell and a live book can never drift apart. (paper is required
// again further down for directionalCall; require caches, and pulling this
// one up keeps it above its first use rather than relying on load order.)
const { pnlAt } = require('./paper');
const { buildChunks, GEOMETRIES } = require('./dataset');
const { viewIndices } = require('./features');

const PER_ASSET = (nDays) => nDays + 12;
const CROSS = 4;

// View index arrays for each combo size over the composite layouts above.
// Singles have no cross view (nothing to cross) — callers get null there.
function comboViews(size, nDays) {
  const P = PER_ASSET(nDays);
  const two = (view) => viewIndices(view, nDays); // over [P][P][4]
  const tripleMap = (idx) => idx.map((i) => (i < 2 * P + CROSS ? i : null)).filter((i) => i !== null);
  if (size === 1) {
    const only = (view) => two(view).filter((i) => i < P);
    return { featureCount: P, views: { full: only('full'), prices: only('prices'), volume: only('volume'), cross: null } };
  }
  if (size === 2) {
    return { featureCount: 2 * P + CROSS, views: { full: two('full'), prices: two('prices'), volume: two('volume'), cross: two('cross') } };
  }
  // triple: AB layout indices as-is, plus the AC context half re-based to
  // sit after the AB vector (AC context block starts at P in its own build).
  const base = 2 * P + CROSS;
  const acPart = (view) => two(view).filter((i) => i >= P).map((i) => base + (i - P));
  const both = (view) => [...two(view), ...acPart(view)];
  return { featureCount: base + P + CROSS, views: { full: both('full'), prices: both('prices'), volume: both('volume'), cross: both('cross') } };
}

// Assemble one combo's chunks. maps = { trade, ctx1?, ctx2? } (forward-filled
// hourly maps). Returns { chunks, featureCount } with diffPct/label fields
// from the trade asset (labels assigned by the caller once the band is set).
function buildComboChunks(maps, geometry, weekdaysOnly) {
  const opts = { geometry, weekdaysOnly };
  const nDays = GEOMETRIES[geometry].featureHours / 24;
  const P = PER_ASSET(nDays);
  if (!maps.ctx1) {
    const { chunks } = buildChunks(maps.trade, maps.trade, 0, 'compressed', opts);
    for (const c of chunks) c.x = c.x.slice(0, P);
    return { chunks, featureCount: P };
  }
  if (!maps.ctx2) {
    const { chunks } = buildChunks(maps.trade, maps.ctx1, 0, 'compressed', opts);
    return { chunks, featureCount: 2 * P + CROSS };
  }
  const a = buildChunks(maps.trade, maps.ctx1, 0, 'compressed', opts).chunks;
  const b = buildChunks(maps.trade, maps.ctx2, 0, 'compressed', opts).chunks;
  const byTs = new Map(b.map((c) => [c.startTs, c]));
  const chunks = [];
  for (const c of a) {
    const mate = byTs.get(c.startTs);
    if (!mate) continue; // context-2 data gap — combo keeps only shared periods
    chunks.push({ ...c, x: [...c.x, ...mate.x.slice(P)] });
  }
  return { chunks, featureCount: 3 * P + 2 * CROSS };
}

// ---- OCO bracket simulator ---------------------------------------------------
//
// At the geometry's entry hour: reference price p = that candle's open.
// Stop-entries at b = p(1+d) and s = p(1−d); the first rail touched opens the
// position and the other rail becomes its stop; time exit after tHours if no
// stop hits. Hourly bars cannot order intra-bar touches, so every ambiguous
// bar resolves AGAINST the book (enter, then stopped in the same bar) and is
// counted — the results are honest-but-conservative by construction.
//
// gate: 'always' places both rails every period; 'active' places both rails
// only when call ≠ 0; 'directional' places ONLY the rail matching the call
// (+1 → buy-stop, −1 → sell-stop), the other rail existing purely as a stop.
const GATES = ['always', 'active', 'directional'];

// ENTRY MODES.
//
// 'breakout' is everything above: the position is opened by price REACHING a
// rail at p(1±d). Every cell this lab could express before was one of these.
//
// 'market' is the general classifier's own trade, and it could not previously
// be expressed at all: enter at the entry candle's OPEN in the called
// direction, no rails, hold to t, exit at that candle's open. That is exactly
// what the live paper books do, and it is why 0 could not simply be added to
// D_MULTS — with both rails at p, the first bar spans both and the
// ambiguous-bar rule stops the position out instantly, every period.
//
// Market entry is DIRECTIONAL only, and that is not a limitation but a
// definition: with no rails there is nothing for 'always' to place and no
// direction to take without a call, and 'active' (both rails when the
// committee speaks) collapses into 'directional'. Emitting the degenerate
// combinations would only pad the menu with duplicates.
const ENTRIES = ['breakout', 'market'];

// The classifier's trade, priced with the books' own helper so a market cell
// and a paper book cannot drift apart: same NOTIONAL, same round-trip fee,
// same open-to-open arithmetic.
function simMarket(periods, calls, tradeMap, geo, { tHours, feePerLeg, stepMs = HOUR_MS }) {
  const trip = 2 * feePerLeg;
  let pnl = 0;
  let trades = 0;
  let wins = 0;
  let unpriced = 0;
  periods.forEach((per, i) => {
    const dir = calls ? calls[i] : 0;
    if (dir === 0) return; // stood aside — the books' rule, not a skipped bar
    const entryTs = per.startTs + geo.entryOffsetH * HOUR_MS;
    const ref = tradeMap.get(entryTs);
    if (!ref) {
      unpriced++;
      return;
    }
    // Walk ≤3h forward over gaps for the exit, exactly as the breakout path's
    // time exit does, so the two modes treat missing candles identically.
    let exitBar = null;
    const gapSteps = Math.round((3 * HOUR_MS) / stepMs);
    for (let h = 0; h <= gapSteps && !exitBar; h++) exitBar = tradeMap.get(entryTs + tHours * HOUR_MS + h * stepMs);
    if (!exitBar) {
      unpriced++;
      return;
    }
    const v = pnlAt(dir, ref.open, exitBar.open, feePerLeg);
    pnl += v;
    trades++;
    if (v > 0) wins++;
  });
  // stops and ambiguous are structurally zero here: there are no rails to be
  // stopped at and no bar that can span two of them.
  return { pnl, trades, wins, stops: 0, ambiguous: 0, unpriced, grossPerTrade: trades ? (pnl + trades * trip) / trades : null };
}

// TRAILING STOPS (trailPct != null). The stop starts at the opposite rail and
// ratchets to `extreme x (1 -/+ trail)` once price has moved `arm` in favour.
// Both distances are band-relative, like d, so one grid means the same thing
// across assets.
//
// WITHIN-BAR ORDER IS THE WHOLE PROBLEM, and it is why a trailing result on
// hourly candles is not evidence. If a bar makes a new extreme and also
// touches the stop, OHLC cannot say which came first, and the two orderings
// give materially different money. This code takes the pessimistic one: the
// adverse extreme is tested against the stop AS IT STOOD BEFORE this bar
// could ratchet it. Same doctrine as the entry ambiguity — resolve against
// the book — but far more frequent, because it fires on any bar that extends
// and retraces rather than only on a bar spanning both entry rails. Every
// occurrence is counted in trailAmbiguous, which is the number that says how
// much of a given result rests on the assumption. Minute confirmation exists
// to replace that assumption with the actual path.
// stepMs generalises the bar size. At the default it walks hourly candles and
// is byte-identical to what it has always done; at 60_000 it walks the same
// trade minute by minute, which is the ONLY way to settle a within-bar
// ordering question rather than assume it. The rules are otherwise unchanged
// on purpose — a minute run that also changed the fill logic would not be a
// confirmation of anything.
function simBracket(periods, calls, tradeMap, geo, { dPct, tHours, gate, feePerLeg, trailPct = null, armPct = 0, stepMs = HOUR_MS }) {
  const NOTIONAL = 100;
  const trip = 2 * feePerLeg;
  let pnl = 0;
  let trades = 0;
  let wins = 0;
  let stops = 0;
  let ambiguous = 0;
  let trailAmbiguous = 0;
  let unpriced = 0;
  const d = dPct / 100;
  const trail = trailPct == null ? null : trailPct / 100;
  const arm = armPct / 100;
  periods.forEach((per, i) => {
    const call = calls ? calls[i] : 0;
    let sides; // which rails may OPEN a position
    if (gate === 'always') sides = [1, -1];
    else if (gate === 'active') sides = call !== 0 ? [1, -1] : [];
    else sides = call === 1 ? [1] : call === -1 ? [-1] : [];
    if (!sides.length) return;
    const entryTs = per.startTs + geo.entryOffsetH * HOUR_MS;
    const ref = tradeMap.get(entryTs);
    if (!ref) {
      unpriced++;
      return;
    }
    const p = ref.open;
    const bRail = p * (1 + d);
    const sRail = p * (1 - d);
    let dir = 0;
    let entry = null;
    let out = null; // exit price when closed by stop
    let stopLvl = null; // the LIVE stop; static at the opposite rail unless trailing
    let ext = null;     // best price seen since entry
    let armed = false;
    const steps = Math.round((tHours * HOUR_MS) / stepMs);
    for (let h = 0; h < steps && out === null; h++) {
      const bar = tradeMap.get(entryTs + h * stepMs);
      if (!bar) continue;
      if (dir === 0) {
        const hitB = sides.includes(1) && bar.high >= bRail;
        const hitS = sides.includes(-1) && bar.low <= sRail;
        if (hitB && hitS) {
          // both entry rails in one bar: order unknowable — worst case is
          // enter long at b, stopped at s within the bar
          ambiguous++;
          stops++;
          pnl += NOTIONAL * (sRail / bRail - 1) - trip;
          trades++;
          dir = 0;
          out = sRail; // closed; loop ends via out
          break;
        }
        if (hitB) {
          dir = 1;
          entry = bRail;
          stopLvl = sRail;
          ext = bRail;
          // the sell rail is now this long's stop — same bar may also stop it
          if (bar.low <= sRail) {
            ambiguous++;
            stops++;
            pnl += NOTIONAL * (sRail / entry - 1) - trip;
            trades++;
            out = sRail;
            break;
          }
        } else if (hitS) {
          dir = -1;
          entry = sRail;
          stopLvl = bRail;
          ext = sRail;
          if (bar.high >= bRail) {
            ambiguous++;
            stops++;
            pnl += NOTIONAL * (1 - bRail / entry) - trip;
            trades++;
            out = bRail;
            break;
          }
        }
      } else if (dir === 1) {
        const hit = bar.low <= stopLvl;
        const extended = trail != null && bar.high > ext;
        if (hit && extended) trailAmbiguous++;
        if (hit) {
          stops++;
          const v = NOTIONAL * (stopLvl / entry - 1) - trip;
          pnl += v;
          trades++;
          if (v > 0) wins++;
          out = stopLvl;
        } else if (trail != null) {
          if (bar.high > ext) ext = bar.high;
          if (armed || ext >= entry * (1 + arm)) {
            armed = true;
            stopLvl = Math.max(stopLvl, ext * (1 - trail)); // ratchets only up
          }
        }
      } else if (dir === -1) {
        const hit = bar.high >= stopLvl;
        const extended = trail != null && bar.low < ext;
        if (hit && extended) trailAmbiguous++;
        if (hit) {
          stops++;
          const v = NOTIONAL * (1 - stopLvl / entry) - trip;
          pnl += v;
          trades++;
          if (v > 0) wins++;
          out = stopLvl;
        } else if (trail != null) {
          if (bar.low < ext) ext = bar.low;
          if (armed || ext <= entry * (1 - arm)) {
            armed = true;
            stopLvl = Math.min(stopLvl, ext * (1 + trail)); // ratchets only down
          }
        }
      }
    }
    if (dir !== 0 && out === null) {
      // time exit at the horizon candle's open (walk ≤3h forward over gaps)
      // Gap tolerance is 3 HOURS either way; on minute bars that is 180 steps
      // rather than 3, so the two resolutions forgive the same real absence.
      let exitBar = null;
      const gapSteps = Math.round((3 * HOUR_MS) / stepMs);
      for (let h = 0; h <= gapSteps && !exitBar; h++) exitBar = tradeMap.get(entryTs + tHours * HOUR_MS + h * stepMs);
      if (!exitBar) {
        unpriced++;
        return;
      }
      const v = dir === 1 ? NOTIONAL * (exitBar.open / entry - 1) - trip : NOTIONAL * (1 - exitBar.open / entry) - trip;
      pnl += v;
      trades++;
      if (v > 0) wins++;
    }
  });
  return { pnl, trades, wins, stops, ambiguous, trailAmbiguous, unpriced, grossPerTrade: trades ? (pnl + trades * trip) / trades : null };
}

// ---- drift controls ------------------------------------------------------------
//
// The objection every result on this board has to answer: "you did not find a
// strategy, you found an asset that went up." Owner's proposed answer, and it
// is the right one — put long-and-hold and short-and-hold on the same window
// and make the strategy beat them.
//
// TWO controls, because they answer different objections:
//
//   alwaysLong / alwaysShort  — the SAME execution, direction forced. Same
//     period count, same horizon, same round-trip fee on every period. This
//     is the honest like-for-like: it isolates the CALLS by holding
//     everything else fixed. A straddle that cannot beat "be long every
//     period" has not earned its complexity.
//
//   buyHold / shortHold — one position, first entry to last exit, one round
//     trip. The classic benchmark, and the one that answers "why not just buy
//     it and go away?" It carries almost no fee load, so it is the harder bar
//     over a trending window and the easier one over a chopping window.
//
// Both are computed on the SAME test chunks as the cell they accompany, at
// the cell's own horizon, so nothing about the comparison is rescaled.
function holdControls(periods, tradeMap, geo, tHours, feePerLeg) {
  const ones = periods.map(() => 1);
  const negs = periods.map(() => -1);
  const alwaysLong = simMarket(periods, ones, tradeMap, geo, { tHours, feePerLeg });
  const alwaysShort = simMarket(periods, negs, tradeMap, geo, { tHours, feePerLeg });

  // Single position across the whole window: enter at the first period's
  // entry open, exit at the last period's exit open.
  let buyHold = null;
  let shortHold = null;
  if (periods.length) {
    const firstTs = periods[0].startTs + geo.entryOffsetH * HOUR_MS;
    const lastTs = periods[periods.length - 1].startTs + geo.entryOffsetH * HOUR_MS;
    const inBar = tradeMap.get(firstTs);
    let outBar = null;
    for (let h = 0; h <= 3 && !outBar; h++) outBar = tradeMap.get(lastTs + (tHours + h) * HOUR_MS);
    if (inBar && outBar) {
      // Both sides priced through the same helper. shortHold is NOT -buyHold:
      // the fee is paid on both, so the two sum to -4 x feePerLeg, not zero.
      buyHold = pnlAt(1, inBar.open, outBar.open, feePerLeg);
      shortHold = pnlAt(-1, inBar.open, outBar.open, feePerLeg);
    }
  }
  return {
    alwaysLong: alwaysLong.pnl,
    alwaysShort: alwaysShort.pnl,
    alwaysLongTrades: alwaysLong.trades,
    buyHold,
    shortHold,
  };
}

// ---- mechanical execution sweep ------------------------------------------------
//
// The DECLARED menus. Never a continuous scan: d is band-relative so one grid
// means the same thing across assets; t is absolute hours; gates as above.
const D_MULTS = [0.25, 0.5, 0.75, 1.0, 1.5];
// Extended 2026-07-28 (owner): the first DOT sweep pinned every winner to
// the old 65h ceiling — a clipped optimum. Same 17h+24k grid, so every
// horizon exits at the same clock hour. Longer holds carry more drift and
// more overlap (t/24 concurrent positions): judge them by vs-control and
// per-dollar-deployed, never raw net.
const T_HOURS = [17, 41, 65, 89, 113, 137, 161];

// TRAILING GRID, band-relative like d. null = the static opposite-rail stop
// this lab has always used. ARM delays the trail until price has moved that
// far in favour, so arm=0 trails from the first bar and arm=1 is close to a
// move-to-breakeven-then-trail rule.
//
// Swept ONLY at the promote stage and only when the owner opts in: 12 trailing
// combinations multiply the 105-cell breakout plane by 13. On a 272-combo
// doubles sweep, doing that in the cheap slim pass too would turn ~35 minutes
// into roughly seven hours, and slim's job is ranking combos, not refining
// execution.
const TRAIL_MULTS = [0.5, 1.0, 1.5, 2.0];
const ARM_MULTS = [0, 0.5, 1.0];

// Sweep the whole execution menu over one call stream. Returns every cell
// (the null replays this same freedom) tagged with its config.
function execSweep(periods, calls, tradeMap, geo, bandPct, feePerLeg, opts = {}) {
  const rows = [];
  // trailMult null = the static stop; the base menu is EXACTLY what it was
  // before trailing existed, so a run with trailing off is bit-comparable
  // with every board recorded so far.
  const trails = opts.trailing ? [null, ...TRAIL_MULTS] : [null];
  for (const gate of GATES) {
    for (const dMult of D_MULTS) {
      for (const tHours of T_HOURS) {
        for (const trailMult of trails) {
          const arms = trailMult == null ? [null] : ARM_MULTS;
          for (const armMult of arms) {
            const r = simBracket(periods, calls, tradeMap, geo, {
              dPct: dMult * bandPct, tHours, gate, feePerLeg,
              trailPct: trailMult == null ? null : trailMult * bandPct,
              armPct: armMult == null ? 0 : armMult * bandPct,
            });
            rows.push({ entry: 'breakout', gate, dMult, tHours, trailMult, armMult, ...r });
          }
        }
      }
    }
  }
  // Market cells: one per horizon, directional only (see ENTRIES). Adding 7
  // cells to 105 is a 6.7% widening of the menu — small, but it IS a widening,
  // so boards from before 2026-07-28 are not comparable cell-for-cell.
  //
  // Note for anything reading the always-gate control: market cells are
  // directional and can never enter it, so controlPnl is unchanged by this
  // addition and prior replication readings stay valid.
  for (const tHours of T_HOURS) {
    const r = simMarket(periods, calls, tradeMap, geo, { tHours, feePerLeg });
    rows.push({ entry: 'market', gate: 'directional', dMult: null, trailMult: null, armMult: null, tHours, ...r });
  }
  return rows;
}

// Re-run ONE cell, exactly as the sweep produced it, on any set of periods.
// Used to score a chosen cell on the untouched holdout window, and it is the
// same entry point minute confirmation will use — so the holdout and the
// minute check can never be a different trade from the one that was selected.
function simCell(cell, periods, calls, tradeMap, geo, bandPct, feePerLeg, stepMs = HOUR_MS) {
  if ((cell.entry || 'breakout') === 'market') {
    return simMarket(periods, calls, tradeMap, geo, { tHours: cell.tHours, feePerLeg, stepMs });
  }
  return simBracket(periods, calls, tradeMap, geo, {
    dPct: cell.dMult * bandPct,
    tHours: cell.tHours,
    gate: cell.gate,
    feePerLeg,
    stepMs,
    trailPct: cell.trailMult == null ? null : cell.trailMult * bandPct,
    armPct: cell.armMult == null ? 0 : cell.armMult * bandPct,
  });
}

// The declared selection rule: best net dollars among cells clearing the
// minimum-trade floor; ties to fewer trades (less fee surface). Returns null
// when nothing qualifies — an honest "no setup here".
function bestCell(rows, minTrades) {
  let best = null;
  for (const r of rows) {
    if (r.trades < minTrades) continue;
    if (!best || r.pnl > best.pnl || (r.pnl === best.pnl && r.trades < best.trades)) best = r;
  }
  return best;
}

// ---- member training -----------------------------------------------------------
//
// One member = a model over a view of the combo's features, trained on the
// (regime-filtered) training chunks, emitting CALLS on the test chunks.
// Decision semantics mirror the pipeline exactly: argmax label, or the
// directional hunter (balanced class weights, τ from validation dollars).
const { standardizeFit, standardizeApply, tuneAndTrain, trainSoftmax, predict: predictLogreg, CLASSES } = require('./logreg');
const { trainBoost, predictBoost } = require('./boost');
const { tuneTau } = require('./pipeline');
const { directionalCall } = require('./paper');

async function trainMember({ model, viewIdx, trainChunks, testChunks, decision, tradeMap, geo }) {
  const Xtr = trainChunks.map((c) => viewIdx.map((i) => c.x[i]));
  const ytr = trainChunks.map((c) => c.label);
  const Xte = testChunks.map((c) => viewIdx.map((i) => c.x[i]));
  let classWeights = null;
  if (decision === 'directional') {
    const counts = {};
    for (const cl of CLASSES) counts[cl] = ytr.filter((l) => l === cl).length;
    const present = CLASSES.filter((cl) => counts[cl] > 0);
    classWeights = {};
    for (const cl of CLASSES) classWeights[cl] = counts[cl] > 0 ? Math.min(20, ytr.length / (present.length * counts[cl])) : 1;
  }
  const wFor = (labels) => (classWeights ? labels.map((l) => classWeights[l]) : null);
  const nVal = Math.max(3, Math.round(Xtr.length * 0.25));
  const nSub = Xtr.length - nVal;
  let tau = null;
  let picked;
  let callOf;
  if (model === 'logreg') {
    const scaler = standardizeFit(Xtr);
    const Ztr = standardizeApply(Xtr, scaler);
    const Zte = standardizeApply(Xte, scaler);
    const { model: m, chosenLambda } = await tuneAndTrain(Ztr, ytr, { onProgress: () => {}, classWeights });
    if (decision === 'directional') {
      const probe = await trainSoftmax(Ztr.slice(0, nSub), ytr.slice(0, nSub), chosenLambda, { weights: wFor(ytr.slice(0, nSub)) });
      const valProbs = [];
      for (let i = nSub; i < Ztr.length; i++) valProbs.push(predictLogreg(probe, Ztr[i]).probs);
      ({ tau } = tuneTau(trainChunks.slice(nSub), valProbs, tradeMap, geo));
    }
    picked = `lambda=${chosenLambda}${tau != null ? `, tau=${tau}` : ''}`;
    callOf = (i) => {
      const out = predictLogreg(m, Zte[i]);
      return decision === 'directional' ? directionalCall(out.probs, tau) : out.label;
    };
  } else {
    const probe = await trainBoost(Xtr.slice(0, nSub), ytr.slice(0, nSub), { Xval: Xtr.slice(nSub), yval: ytr.slice(nSub), weights: wFor(ytr.slice(0, nSub)), valWeights: wFor(ytr.slice(nSub)) });
    if (decision === 'directional') {
      const valProbs = [];
      for (let i = nSub; i < Xtr.length; i++) valProbs.push(predictBoost(probe, Xtr[i]).probs);
      ({ tau } = tuneTau(trainChunks.slice(nSub), valProbs, tradeMap, geo));
    }
    const m = await trainBoost(Xtr, ytr, { rounds: probe.bestRound, weights: wFor(ytr) });
    picked = `rounds=${m.bestRound}${tau != null ? `, tau=${tau}` : ''}`;
    callOf = (i) => {
      const out = predictBoost(m, Xte[i]);
      return decision === 'directional' ? directionalCall(out.probs, tau) : out.label;
    };
  }
  return { calls: testChunks.map((_, i) => callOf(i)), picked };
}

module.exports = { comboViews, buildComboChunks, simBracket, simMarket, holdControls, simCell, execSweep, bestCell, trainMember, GATES, ENTRIES, D_MULTS, T_HOURS, TRAIL_MULTS, ARM_MULTS, PER_ASSET };
