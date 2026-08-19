// REAL-vs-NULL comparison as a library — the derived-threshold read the
// owner previously could only get from scripts and email (owner-ordered
// onto the page, 2026-08-01). Pure arithmetic here; the server wires it
// to the fold detail files on disk.
//
// The paired formula (unchanged from the declared read):
//   per setup, per fold scored by ALL runs being compared:
//     d = real fold holdout money − mean(null runs' fold holdout money)
//   a setup is paired-supported when median(d) > 0 AND more than half of
//   its paired folds have d > 0 (both no-skill points, DERIVED).
// The luck reference: each null run scored against the mean of the OTHER
// null runs by the same formula; the verdict line (declared before any
// number existed): the real count must exceed
//   max(luck counts) + (max(luck counts) − min(luck counts)).
// Reference-arm counts differ by one between real (vs N nulls) and luck
// (vs N−1) — the residual asymmetry FAVOURS the real arm, so a null
// verdict is conservative (QC 65).
const fs = require('fs');
const path = require('path');

function med(xs) {
  const a = [...xs].sort((x, y) => x - y);
  if (!a.length) return null;
  const p = 0.5 * (a.length - 1);
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  return a[lo] + (a[hi] - a[lo]) * (p - lo);
}

// foldsByUnit: { unitKey: { testStart: holdPnl } } — built by loadRun below
// or handed in directly by tests.
function pairedRows(A, refs) {
  const rows = [];
  for (const key of Object.keys(A).sort()) {
    let common = Object.keys(A[key]);
    for (const R of refs) {
      const rk = R[key] || {};
      common = common.filter((t) => t in rk);
    }
    const ds = common.sort().map((t) => A[key][t] - refs.reduce((s, R) => s + R[key][t], 0) / refs.length);
    if (ds.length) rows.push({ key, n: ds.length, med: med(ds), pos: ds.filter((v) => v > 0).length });
  }
  return rows;
}

function supportedCount(rows) {
  return rows.filter((r) => r.med > 0 && r.pos * 2 > r.n).length;
}

// The whole read: real run + >=2 null runs -> counts, line, verdict, detail.
function compareRuns(real, nulls) {
  if (nulls.length < 2) throw new Error(`need at least 2 null runs for a luck reference — got ${nulls.length}`);
  const realRows = pairedRows(real, nulls);
  const luckCounts = nulls.map((n, i) => supportedCount(pairedRows(n, nulls.filter((_, j) => j !== i))));
  const realCount = supportedCount(realRows);
  const mx = Math.max(...luckCounts);
  const mn = Math.min(...luckCounts);
  const line = mx + (mx - mn);
  return {
    realCount,
    luckCounts,
    line,
    distinguishable: realCount > line,
    top: realRows.slice().sort((a, b) => (b.med ?? -Infinity) - (a.med ?? -Infinity)).slice(0, 15),
    perCoin: realRows.reduce((acc, r) => {
      const coin = r.key.split(' ')[0];
      acc[coin] = acc[coin] || { setups: 0, supported: 0 };
      acc[coin].setups++;
      if (r.med > 0 && r.pos * 2 > r.n) acc[coin].supported++;
      return acc;
    }, {}),
    setups: realRows.length,
  };
}

// Disk loader: one run's fold detail directory -> foldsByUnit.
function loadRun(wfDir, jobId) {
  const dir = path.join(wfDir, jobId);
  const out = {};
  const unreadable = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    let d;
    try {
      d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      // One torn fold file must not 500 the whole comparison forever —
      // report it BY NAME instead (review 2026-08-04, D9).
      unreadable.push(f);
      continue;
    }
    const key = `${d.trade} ${d.geometry} ${d.decision}`;
    out[key] = {};
    for (const fold of d.folds) if (!fold.skipped) out[key][fold.testStart] = fold.holdPnl;
  }
  if (unreadable.length) out.__unreadable = unreadable;
  return out;
}

module.exports = { med, pairedRows, supportedCount, compareRuns, loadRun };
