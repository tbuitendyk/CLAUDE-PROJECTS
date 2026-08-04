// LAYOUT COMPARISON — chronological vs interlaced, same everything else.
//
// Owner's constraints (2026-07-30):
//   (c) a 'both' job carries the two arms itself; (d) two SEPARATE runs may
//   be linked ONLY when every stored run parameter is confirmed identical
//   between them — the layout itself, and nothing else, may differ; (e) both
//   paths feed one comparison.
//
// Pure module: docs in, comparison out. Nothing here fires compute.
//
// Reading rules, decided before any number exists:
//   * The two layouts' evaluation windows are DIFFERENT POPULATIONS — the
//     chronological arm's windows sit at the recent end, the interlaced
//     arm's are sprinkled across all history. Raw dollar totals between the
//     arms are therefore labeled cross-population; the comparison leads with
//     paired per-setup rows and per-trade rates.
//   * Realized trade counts differing between arms is a FINDING, not a
//     defect: potential trade days are forced identical by construction, but
//     a committee trades more in eras it has opinions about.

// Parameters allowed to differ between two linked runs. Everything else in
// params must match exactly or the link is refused with the differing keys
// named. engineVersion is allowed through but surfaced as a loud warning —
// identical settings on different code is a comparison the reader must be
// told about.
const ALLOW_DIFF = new Set(['windowLayout', 'description', 'label', 'engineVersion']);

// absent, null and undefined are the SAME recorded state — docs from
// before a key existed must not show phantom differences (review 2026-08-04).
const normVal = (v) => (v === undefined ? null : v);
function settingsDiff(pa, pb, skip = ALLOW_DIFF) {
  const keys = [...new Set([...Object.keys(pa || {}), ...Object.keys(pb || {})])];
  return keys.filter((k) => !skip.has(k)
    && JSON.stringify(normVal(pa ? pa[k] : undefined)) !== JSON.stringify(normVal(pb ? pb[k] : undefined)));
}

const keyOf = (r) => `${r.trade}|${r.ctx1 || ''}|${r.ctx2 || ''}|${r.geometry}|${r.decision}`;

function realRowsFor(doc, layout) {
  return (doc.edgeCensus || []).filter((r) => !r.shiftFrac
    && r.holdPnl != null
    && (layout ? r.windowLayout === layout : true));
}

function side(r) {
  return {
    holdPnl: r.holdPnl,
    holdTrades: r.holdTrades,
    holdPerTrade: r.holdTrades ? r.holdPnl / r.holdTrades : null,
    holdPeriods: r.holdPeriods ?? null,
    holdPerDay: r.layoutEvalDays ? r.holdPnl / r.layoutEvalDays : null,
    searchPnl: r.searchPnl ?? null,
    searchTrades: r.searchTrades ?? null,
    holdEdge: r.holdEdge ?? null,
    quorum: r.cellQuorum ?? null,
  };
}

// rowsA/rowsB: real census rows of the two arms. Returns the comparison body.
function compareRows(rowsA, rowsB, armA, armB) {
  const byB = new Map(rowsB.map((r) => [keyOf(r), r]));
  const paired = [];
  for (const a of rowsA) {
    const b = byB.get(keyOf(a));
    if (!b) continue;
    paired.push({ key: keyOf(a), a: side(a), b: side(b), dHoldPnl: b.holdPnl - a.holdPnl });
  }
  paired.sort((x, y) => Math.abs(y.dHoldPnl) - Math.abs(x.dHoldPnl));
  const topOf = (rows) => rows.slice().sort((x, y) => y.holdPnl - x.holdPnl).slice(0, 10).map(keyOf);
  const topA = topOf(rowsA);
  const topB = topOf(rowsB);
  const overlap = topA.filter((k) => topB.includes(k));
  const sum = (rows, f) => rows.reduce((s, r) => s + (f(r) || 0), 0);
  return {
    arms: { a: armA, b: armB },
    pairedCount: paired.length,
    onlyA: rowsA.length - paired.length,
    onlyB: rowsB.length - paired.length,
    paired,
    survivorOverlap: { topA, topB, shared: overlap, sharedCount: overlap.length },
    totals: {
      note: 'cross-population aggregates: the two arms\' holdout windows are different calendar periods. Compare per-setup rows and per-trade rates, not these sums.',
      a: { holdPnl: sum(rowsA, (r) => r.holdPnl), holdTrades: sum(rowsA, (r) => r.holdTrades), setups: rowsA.length },
      b: { holdPnl: sum(rowsB, (r) => r.holdPnl), holdTrades: sum(rowsB, (r) => r.holdTrades), setups: rowsB.length },
    },
  };
}

// One entry point for both paths: a 'both' doc alone, or two linked docs.
// THE GENERAL COMPARISON (owner ruling, 2026-08-03): any two stored runs.
// Every differing setting is LISTED FIRST; shared rows are paired; the money
// deltas are stamped ATTRIBUTABLE only when exactly ONE result-shaping
// setting differs — the one-variable rule as a tool. With more differences
// the comparison still shows but proves nothing, and says so. The old
// same-settings refusal (built for the retired layout face-off) is gone
// with the interlaced purge; historical 'both' runs still compare their own
// two arms.
const NEVER_ATTRIBUTABLE = new Set(['description', 'label', 'engineVersion',
  // Review 2026-08-04: pure labels and companion records never shape money.
  'campaign', 'plantedGate', 'plantedRules',
  // Derived twins of real settings — counting them makes every canonical
  // one-variable pair read as two differences: holdout follows windowLayout,
  // edgeScreen follows labelShiftReps, reserveWeeksPlanned exists only under
  // reserve61.
  'holdout', 'edgeScreen', 'reserveWeeksPlanned']);

function compareDocs(docA, docB) {
  const warnings = [];
  if (!docB || docB.id === docA.id) {
    if (!docA.params || docA.params.windowLayout !== 'both') {
      throw new Error(`${docA.id} is a single run — pick a second run to compare against`);
    }
    const rowsA = realRowsFor(docA, 'chronological');
    const rowsB = realRowsFor(docA, 'interlaced');
    if (!rowsA.length || !rowsB.length) throw new Error(`${docA.id} is missing an arm (${rowsA.length} chronological rows, ${rowsB.length} interlaced)`);
    return { mode: 'both-job', jobs: [docA.id], warnings, differences: [], attributable: true, attributableTo: 'windowLayout (historical both-run)', ...compareRows(rowsA, rowsB, 'chronological', 'interlaced') };
  }
  // Every difference is listed — including windowLayout, THE canonical
  // one-variable comparison (review finding 7: the old ALLOW_DIFF filter
  // made layout-only pairs read as twins).
  const diffs = settingsDiff(docA.params, docB.params, new Set());
  const shaping = diffs.filter((k) => !NEVER_ATTRIBUTABLE.has(k));
  const attributable = shaping.length === 1;
  if ((docA.params.engineVersion || '?') !== (docB.params.engineVersion || '?')) {
    warnings.push(`ENGINE VERSIONS DIFFER (${docA.params.engineVersion || '?'} vs ${docB.params.engineVersion || '?'}): identical settings ran on different code — read deltas with suspicion`);
  }
  if (!attributable) {
    warnings.push(shaping.length === 0
      ? 'NO result-shaping setting differs — the runs are twins; any delta is noise or engine drift'
      : `NOT ATTRIBUTABLE: ${shaping.length} result-shaping settings differ (${shaping.join(', ')}) — the paired deltas below can inform but cannot prove which setting caused what`);
  }
  const rowsA = realRowsFor(docA, docA.params.windowLayout === 'both' ? 'chronological' : null);
  const rowsB = realRowsFor(docB, docB.params.windowLayout === 'both' ? 'chronological' : null);
  if (!rowsA.length || !rowsB.length) throw new Error('one of the runs has no real money rows with a hold window — compare needs held-back results on both sides');
  return {
    mode: 'general',
    jobs: [docA.id, docB.id],
    warnings,
    differences: diffs.map((k) => ({
      key: k,
      a: docA.params ? docA.params[k] : undefined,
      b: docB.params ? docB.params[k] : undefined,
      shaping: !NEVER_ATTRIBUTABLE.has(k),
    })),
    attributable,
    attributableTo: attributable ? shaping[0] : null,
    ...compareRows(rowsA, rowsB, docA.id.slice(-20), docB.id.slice(-20)),
  };
}

module.exports = { compareDocs, compareRows, settingsDiff, ALLOW_DIFF, NEVER_ATTRIBUTABLE };
