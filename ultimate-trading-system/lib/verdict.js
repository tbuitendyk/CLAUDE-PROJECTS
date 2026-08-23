// NULL VERDICTS over stored runs — no compute fired, pure arithmetic on data
// already on disk.
//
// The problem this answers (owner consult, 2026-07-30): a row picked off the
// board is the best of 170 tries, and under pure noise the best of 170 still
// looks good — that is what maximums do. So a board pick owes two comparisons
// before anyone freezes it:
//
//   PER-SETUP     is this setup better than ITS OWN noise? Its real held-back
//                 money against the same setup's money in each scrambled world.
//   SELECTION     is topping this board better than topping a NOISE board?
//                 The real board's best against each scrambled world's
//                 best-of-board. This is the one that prices in the fact that
//                 we chose the winner after looking.
//
// Both use the rank test: beats all N draws -> p = 1/(N+1), and with N draws
// that floor is the strongest claim available — never read it as a large
// effect. Passing clears THIS window only; the forward paper test after
// freezing is the real judge. This gate exists to stop obvious chance results being
// frozen, nothing more.
// TWO NULL CONSTRUCTIONS EXIST ON DISK. Docs from 2026-08-03 onward carry
// deal-built draws (nullDealSeed, register 66 — each member's real vote mix
// dealt onto random days); older docs carry rotation-built draws
// (shiftFrac), a construction register 66 discredited. This reader speaks
// both so history stays readable, but it TAGS every verdict with the
// construction it was measured against — a rotation verdict is a historical
// reading, never current evidence.
const { feeFracOf } = require('./paper');

function drawTag(r) {
  if (r.nullDealSeed != null) return `deal-s${r.nullDealSeed}`;
  if (r.shiftFrac) return `rot-${r.shiftFrac}`;
  return null;
}

function realRows(doc) {
  return (doc.edgeCensus || []).filter((r) => !drawTag(r) && r.holdPnl != null);
}

function drawsOf(doc) {
  return [...new Set((doc.edgeCensus || [])
    .filter((r) => drawTag(r) && r.holdPnl != null)
    .map((r) => drawTag(r)))].sort();
}

// The pairing key includes the window-layout ARM when a doc carries mixed
// arms (a windowLayout='both' run). Without it, find() grabbed whichever
// arm was pushed first — a nondeterministic cross-match between two
// different measurement geometries (audit 2026-07-30, confirmed major).
// Pairing key carries the FULL setup identity: contexts included (review
// 2026-08-04 HIGH: without ctx, a singles+doubles run scored whichever
// DOT-family row was pushed first under the picked row's name).
const keyOf = (r) => `${r.trade}|${r.ctx1 || ''}|${r.ctx2 || ''}|${r.geometry}|${r.decision}${r.windowLayout && r.windowLayout !== 'legacy' ? `|${r.windowLayout}` : ''}`;
const isMixed = (rows) => new Set(rows.map((r) => r.windowLayout || 'legacy')).size > 1;

function rank(real, draws) {
  const beats = draws.filter((d) => real > d.value).length;
  return {
    real,
    draws,
    beats,
    n: draws.length,
    pFloor: draws.length ? 1 / (draws.length + 1) : null,
    passes: draws.length > 0 && beats === draws.length,
  };
}

// sel: {trade, geometry, decision} or null for board-best only.
function nullVerdict(realDoc, nullDoc, sel) {
  const real = realRows(realDoc);
  if (!real.length) throw new Error(`${realDoc.id} has no real (unscrambled) money rows`);
  const shifts = drawsOf(nullDoc);
  if (!shifts.length) throw new Error(`${nullDoc.id} has no null-board money rows (neither deal-built nor rotation-built)`);
  const nullCensus = (nullDoc.edgeCensus || []).filter((r) => drawTag(r) && r.holdPnl != null);
  const construction = nullCensus.some((r) => r.nullDealSeed != null) ? 'deal (register 66)' : 'rotation (RETIRED construction — historical reading only, never current evidence)';

  const out = {
    realJob: realDoc.id,
    nullJob: nullDoc.id,
    construction,
    drawCount: shifts.length,
    perSetup: null,
    selection: null,
    sanity: null,
    paramMismatch: null,
  };

  // Cross-doc guard (review 2026-08-04): the two jobs may have been launched
  // with different measurement settings. The reading still runs — history
  // must stay readable — but a mismatch is NAMED in the output, because two
  // moneys measured under different fees or window layouts are not the same
  // quantity and the comparison quietly stops meaning what it looks like.
  {
    const WATCH = ['windowLayout', 'startMonth', 'endMonth', 'minTrades', 'labelShiftScope', 'allLoaded'];
    const rp = realDoc.params || {};
    const np = nullDoc.params || {};
    const fields = WATCH.filter((k) => JSON.stringify(rp[k] ?? null) !== JSON.stringify(np[k] ?? null));
    // THE FEE IS COMPARED AS A RATE, not as whatever number the run happened to
    // store (owner order, 2026-08-23). Runs recorded before that date hold
    // dollars on the $100 paper clip and runs since hold a fraction, so 0.125
    // and 0.00125 are the SAME cost written two ways. Comparing the stored
    // numbers would report a mismatch between two runs that were priced
    // identically — and a warning nobody can act on is worse than no warning.
    if (feeFracOf(rp) !== feeFracOf(np)) fields.push('feePerLeg');
    // Data manifest (QC 77): identical settings mean nothing if the two jobs
    // read different candle files — the digests answer that in one glance.
    if (realDoc.id !== nullDoc.id) {
      const { manifestDiff } = require('./manifest');
      const md = manifestDiff(realDoc.dataManifest, nullDoc.dataManifest);
      if (md && !md.same) fields.push(`candle data (${[...md.changed, ...md.onlyA, ...md.onlyB].join(', ') || 'digest'})`);
    }
    if (fields.length && realDoc.id !== nullDoc.id) {
      out.paramMismatch = {
        fields,
        note: 'these settings differ between the real job and the null job — their dollar figures are not measured the same way; read with care',
      };
    }
  }

  if (sel && sel.trade) {
    if (isMixed(real) && !sel.windowLayout) {
      throw new Error('this run holds BOTH layout arms — pick the setup with its arm (chronological/interlaced)');
    }
    // Single-layout docs: the caller need not name the layout — there is
    // only one, so it is filled in from the rows themselves. Without this,
    // rows stamped split70 could never be found by a plain
    // trade/geometry/decision request (owner hit it on row 30, 2026-08-04).
    const layout = sel.windowLayout || (real[0] && real[0].windowLayout) || 'legacy';
    const k = `${sel.trade}|${sel.ctx1 || ''}|${sel.ctx2 || ''}|${sel.geometry}|${sel.decision}${layout && layout !== 'legacy' ? `|${layout}` : ''}`;
    const mine = real.find((r) => keyOf(r) === k);
    if (!mine) throw new Error(`setup ${k} not in ${realDoc.id}'s real rows`);
    const draws = shifts.map((s) => {
      const row = nullCensus.find((r) => drawTag(r) === s && keyOf(r) === k);
      return { shift: s, value: row ? row.holdPnl : null };
    }).filter((d) => d.value != null);
    out.perSetup = { setup: k, ...rank(mine.holdPnl, draws) };
  }

  // Selection-aware: best-of-board in the real world vs best-of-board in each
  // scrambled world. The maximum is taken over the SAME population both sides.
  const bestReal = real.reduce((a, r) => (r.holdPnl > a.holdPnl ? r : a));
  const selDraws = shifts.map((s) => {
    const g = nullCensus.filter((r) => drawTag(r) === s);
    if (!g.length) return null;
    const m = g.reduce((a, r) => (r.holdPnl > a.holdPnl ? r : a));
    return { shift: s, value: m.holdPnl, setup: keyOf(m) };
  }).filter(Boolean);
  out.selection = {
    realBestSetup: keyOf(bestReal),
    ...rank(bestReal.holdPnl, selDraws),
  };

  // Sanity: the AVERAGE scrambled setup must lose money (fees). The best-of-
  // board draw is legitimately positive — that is the whole point of the
  // selection test — so sanity is checked on the population, not the maxima.
  const allNull = nullCensus.map((r) => r.holdPnl);
  const negShare = allNull.length ? allNull.filter((v) => v < 0).length / allNull.length : null;
  out.sanity = {
    scrambleRows: allNull.length,
    negativeShare: negShare,
    ok: negShare != null && negShare > 0.5,
    note: 'scrambled setups must mostly LOSE (fees); if noise profits, the simulation is broken',
  };
  return out;
}

module.exports = { nullVerdict, realRows, drawsOf };
