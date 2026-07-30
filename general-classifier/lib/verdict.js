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
// freezing is the real judge. This gate exists to stop obvious luck being
// frozen, nothing more.
function realRows(doc) {
  return (doc.edgeCensus || []).filter((r) => !r.shiftFrac && r.holdPnl != null);
}

function drawsOf(doc) {
  return [...new Set((doc.edgeCensus || [])
    .filter((r) => r.shiftFrac && r.holdPnl != null)
    .map((r) => r.shiftFrac))].sort((a, b) => a - b);
}

// The pairing key includes the window-layout ARM when a doc carries mixed
// arms (a windowLayout='both' run). Without it, find() grabbed whichever
// arm was pushed first — a nondeterministic cross-match between two
// different measurement geometries (audit 2026-07-30, confirmed major).
const keyOf = (r) => `${r.trade}|${r.geometry}|${r.decision}${r.windowLayout && r.windowLayout !== 'legacy' ? `|${r.windowLayout}` : ''}`;
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
  if (!shifts.length) throw new Error(`${nullDoc.id} has no scrambled money rows`);
  const nullCensus = (nullDoc.edgeCensus || []).filter((r) => r.shiftFrac && r.holdPnl != null);

  const out = {
    realJob: realDoc.id,
    nullJob: nullDoc.id,
    drawCount: shifts.length,
    perSetup: null,
    selection: null,
    sanity: null,
  };

  if (sel && sel.trade) {
    if (isMixed(real) && !sel.windowLayout) {
      throw new Error('this run holds BOTH layout arms — pick the setup with its arm (chronological/interlaced)');
    }
    const k = `${sel.trade}|${sel.geometry}|${sel.decision}${sel.windowLayout && sel.windowLayout !== 'legacy' ? `|${sel.windowLayout}` : ''}`;
    const mine = real.find((r) => keyOf(r) === k);
    if (!mine) throw new Error(`setup ${k} not in ${realDoc.id}'s real rows`);
    const draws = shifts.map((s) => {
      const row = nullCensus.find((r) => r.shiftFrac === s && keyOf(r) === k);
      return { shift: s, value: row ? row.holdPnl : null };
    }).filter((d) => d.value != null);
    out.perSetup = { setup: k, ...rank(mine.holdPnl, draws) };
  }

  // Selection-aware: best-of-board in the real world vs best-of-board in each
  // scrambled world. The maximum is taken over the SAME population both sides.
  const bestReal = real.reduce((a, r) => (r.holdPnl > a.holdPnl ? r : a));
  const selDraws = shifts.map((s) => {
    const g = nullCensus.filter((r) => r.shiftFrac === s);
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
