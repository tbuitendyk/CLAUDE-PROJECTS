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

function simBracket(periods, calls, tradeMap, geo, { dPct, tHours, gate, feePerLeg }) {
  const NOTIONAL = 100;
  const trip = 2 * feePerLeg;
  let pnl = 0;
  let trades = 0;
  let wins = 0;
  let stops = 0;
  let ambiguous = 0;
  let unpriced = 0;
  const d = dPct / 100;
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
    for (let h = 0; h < tHours && out === null; h++) {
      const bar = tradeMap.get(entryTs + h * HOUR_MS);
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
          if (bar.high >= bRail) {
            ambiguous++;
            stops++;
            pnl += NOTIONAL * (1 - bRail / entry) - trip;
            trades++;
            out = bRail;
            break;
          }
        }
      } else if (dir === 1 && bar.low <= sRail) {
        stops++;
        const v = NOTIONAL * (sRail / entry - 1) - trip;
        pnl += v;
        trades++;
        if (v > 0) wins++;
        out = sRail;
      } else if (dir === -1 && bar.high >= bRail) {
        stops++;
        const v = NOTIONAL * (1 - bRail / entry) - trip;
        pnl += v;
        trades++;
        if (v > 0) wins++;
        out = bRail;
      }
    }
    if (dir !== 0 && out === null) {
      // time exit at the horizon candle's open (walk ≤3h forward over gaps)
      let exitBar = null;
      for (let h = 0; h <= 3 && !exitBar; h++) exitBar = tradeMap.get(entryTs + (tHours + h) * HOUR_MS);
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
  return { pnl, trades, wins, stops, ambiguous, unpriced, grossPerTrade: trades ? (pnl + trades * trip) / trades : null };
}

// ---- mechanical execution sweep ------------------------------------------------
//
// The DECLARED menus. Never a continuous scan: d is band-relative so one grid
// means the same thing across assets; t is absolute hours; gates as above.
const D_MULTS = [0.25, 0.5, 0.75, 1.0, 1.5];
const T_HOURS = [17, 41, 65];

// Sweep the whole execution menu over one call stream. Returns every cell
// (the null replays this same freedom) tagged with its config.
function execSweep(periods, calls, tradeMap, geo, bandPct, feePerLeg) {
  const rows = [];
  for (const gate of GATES) {
    for (const dMult of D_MULTS) {
      for (const tHours of T_HOURS) {
        const r = simBracket(periods, calls, tradeMap, geo, { dPct: dMult * bandPct, tHours, gate, feePerLeg });
        rows.push({ gate, dMult, tHours, ...r });
      }
    }
  }
  return rows;
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

module.exports = { comboViews, buildComboChunks, simBracket, execSweep, bestCell, trainMember, GATES, D_MULTS, T_HOURS, PER_ASSET };
