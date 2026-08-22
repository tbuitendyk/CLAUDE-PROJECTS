// WHAT A RUN WILL COST, BEFORE IT IS LAUNCHED (owner order, 2026-08-22).
//
// "you need to have a status line near the Start sweep button that gives an
// accurate estimate of the resources that the run will require (memory and
// storage and CPU time) and that reports on available resources so that the
// effects can be adequately judged before hitting the sweep"
//
// Every hard stop this system has hit was a cost nobody could see until it
// arrived: a heap exhausted five minutes into a five-hour job, a document that
// could no longer be turned into text, thirty-one hours of first pass before a
// second pass that could never have finished. Each of those was arithmetic
// available before the button was pressed.
//
// TWO RULES THIS FILE IS HELD TO:
//
//   * The count comes from the REAL plan. batch.planFor builds exactly what the
//     launcher builds and starts nothing, so the estimate cannot drift from the
//     run. A second copy of that arithmetic here would be a second answer.
//   * A number with no measurement behind it says so. The time estimate is
//     worth having only because past runs recorded how fast they went; with no
//     history it reports that it has none rather than inventing a rate.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const RATE_FILE = path.join(DATA, 'run-rates.json');

// MEASURED BYTES PER STORED ROW. Measured by writing representative rows
// through the store itself, not reasoned about — tests/test-estimate.js does the
// same measurement and fails if these drift from it, because the first version
// of these numbers was written by eye and understated the replication row by
// more than two to one. An estimate that flatters the disk is worse than none:
// it is the same silence that let a run die at hour forty, wearing a number.
const BYTES_PER_ROW = { slim: 111, census: 244, replication: 324 };

// MEASURED BYTES PER UNIT HELD ON THE MAIN THREAD, the same way. The unit list
// and the payload list are both built for the whole pass, so they are what grows
// with the size of a run now that the settings no longer travel per unit.
const MEM_PER_UNIT = { unit: 60, payload: 71 };

// HOW FAST THIS BOX GOES, from what it actually did. Every finished run appends
// its own measured seconds-per-training; the median of the last few is the
// estimate. One run is enough to be useful and the count is reported so nobody
// mistakes one sample for a settled figure.
function readRates() {
  try {
    const j = JSON.parse(fs.readFileSync(RATE_FILE, 'utf8'));
    return Array.isArray(j.rates) ? j.rates.filter((r) => r && r.secPerTraining > 0) : [];
  } catch (_) { return []; }
}

function recordRate(doc) {
  const perf = (doc && doc.perf) || {};
  const s = Number(perf.secPerTraining);
  if (!Number.isFinite(s) || s <= 0) return;
  const rates = readRates();
  rates.push({
    id: doc.id,
    secPerTraining: s,
    workers: perf.workers || null,
    runsDone: perf.runsDone || null,
    at: doc.finishedAt || null,
  });
  // The last twenty. Older than that and the box, the data range and the code
  // have all moved on, so they describe a different machine doing different work.
  const keep = rates.slice(-20);
  try {
    fs.mkdirSync(DATA, { recursive: true });
    const tmp = `${RATE_FILE}.tmp${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ rates: keep }, null, 1));
    fs.renameSync(tmp, RATE_FILE);
  } catch (_) { /* the estimate degrades to "no measurement"; the run is unaffected */ }
}

function medianRate() {
  const rates = readRates();
  if (!rates.length) return { secPerTraining: null, samples: 0 };
  const v = rates.map((r) => r.secPerTraining).sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return {
    secPerTraining: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2,
    samples: v.length,
    slowest: v[v.length - 1],
    fastest: v[0],
  };
}

// WHAT THE BOX HAS, right now. Free memory moves, so this is a reading rather
// than a promise, and it is labelled as one on the screen.
function boxResources() {
  let diskFreeBytes = null;
  let diskTotalBytes = null;
  try {
    const st = fs.statfsSync(DATA);
    diskFreeBytes = st.bavail * st.bsize;
    diskTotalBytes = st.blocks * st.bsize;
  } catch (_) { /* older node, or a filesystem that will not say */ }
  // The heap ceiling this process actually runs under, asked of the process
  // rather than read off a unit file that may have been edited since.
  let heapCeilingMb = null;
  try {
    const arg = process.execArgv.concat(process.argv).find((a) => /^--max-old-space-size=/.test(a));
    if (arg) heapCeilingMb = Number(arg.split('=')[1]);
    else heapCeilingMb = Math.round(require('v8').getHeapStatistics().heap_size_limit / 1048576);
  } catch (_) { /* leave it unknown rather than guess */ }
  return {
    cpus: os.cpus().length,
    memTotalMb: Math.round(os.totalmem() / 1048576),
    memFreeMb: Math.round(os.freemem() / 1048576),
    heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576),
    heapCeilingMb,
    diskFreeBytes,
    diskTotalBytes,
  };
}

// The estimate itself.
function estimate(params, { poolSize } = {}) {
  const { planFor } = require('./batch');
  const plan = planFor(params);
  const { p, units, slimRuns } = plan;
  const declaredConfigs = (plan.declaredSet || []).length;

  // WHICH UNITS GET THE SECOND PASS. promotionSet promotes every unit when a
  // declared config is named or when null boards forced the edge screen on;
  // otherwise it is the top K of the board, and the board itself never holds
  // more than detailK rows.
  const everyUnitPromoted = !!(p.declared || p.edgeScreen);
  const promoteUnits = everyUnitPromoted ? units.length : Math.min(p.promoteK, units.length, p.detailK || 50);
  // Each promoted unit is scored twice over its own view set (real and edge),
  // which is what doc.plan.promoteRuns counts.
  const { slimViewsFor } = require('./bracketwork');
  const promoteRuns = everyUnitPromoted
    ? units.reduce((s, u) => s + slimViewsFor(u.c.size).length * 2, 0)
    : promoteUnits * 2 * 3;
  // A trailing menu multiplies the CELLS a promoted unit scores, not the number
  // of trainings, so it costs time inside each promoted unit rather than more
  // of them. Reported separately rather than folded in, because folding it in
  // would make the training count wrong.
  const trailingMultiplier = p.trailing ? 13 : 1;

  const rows = {
    slim: units.length,
    census: promoteUnits,
    replication: declaredConfigs ? promoteUnits * declaredConfigs : (p.declared ? promoteUnits : 0),
  };
  const bytes = rows.slim * BYTES_PER_ROW.slim
    + rows.census * BYTES_PER_ROW.census
    + rows.replication * BYTES_PER_ROW.replication;

  // WHAT THE RUN ADDS TO MEMORY, as opposed to what the box has. Only the part
  // that GROWS with the run is counted: the unit list, the payload list, and one
  // copy of the settings per worker plus the one on this thread. The decoded
  // prices the workers hold are much larger and are deliberately not folded in —
  // they grow with the number of ASSETS, not with the number of settings, so
  // adding them would hide the thing this figure exists to show.
  const settingsBytes = (() => {
    try { return JSON.stringify({ params: p }).length; } catch (_) { return 0; }
  })();
  const workers = Math.max(1, Number(poolSize) || 1);
  const memBytes = units.length * (MEM_PER_UNIT.unit + MEM_PER_UNIT.payload)
    + settingsBytes * (workers + 1);

  const rate = medianRate();
  const totalRuns = slimRuns + promoteRuns;
  // secPerTraining as recorded is already wall-clock per training ACROSS the
  // pool that ran it, so it is not divided again by the workers here — dividing
  // twice is how an estimate ends up four times too fast.
  const seconds = rate.secPerTraining == null ? null
    : Math.round(totalRuns * rate.secPerTraining * (p.trailing ? 1.6 : 1));

  const box = boxResources();
  const warnings = [];
  if (box.diskFreeBytes != null && bytes > box.diskFreeBytes) {
    warnings.push(`this run wants about ${gb(bytes)} of disk and the box has ${gb(box.diskFreeBytes)} free — it will stop when the disk fills`);
  } else if (box.diskFreeBytes != null && bytes > box.diskFreeBytes * 0.5) {
    warnings.push(`this run wants about ${gb(bytes)} of disk against ${gb(box.diskFreeBytes)} free — over half of what is left`);
  }
  if (rows.replication > 5e6) {
    warnings.push(`${rows.replication.toLocaleString()} rows for the declared configs — untick some of the permute boxes beside them if that is more than you meant`);
  }
  if (seconds != null && seconds > 86400) {
    warnings.push(`about ${Math.round(seconds / 3600)} hours of work — a deploy restarts the service and stops a run, so nothing can be deployed while it goes`);
  }
  if (box.heapCeilingMb != null && memBytes > box.heapCeilingMb * 1048576 * 0.5) {
    warnings.push(`the unit list alone wants about ${gb(memBytes)} of the ${box.heapCeilingMb} MB heap this service runs under`);
  }
  if (rate.secPerTraining == null) {
    warnings.push('no finished run has been measured on this box yet, so there is no time estimate — the first run that finishes provides one');
  }

  return {
    plan: {
      combos: plan.combos.length,
      branches: plan.branches.length,
      units: units.length,
      slimRuns,
      promoteUnits,
      promoteRuns,
      everyUnitPromoted,
      whyEveryUnit: everyUnitPromoted
        ? (p.edgeScreen && p.labelShiftReps > 0 ? 'null boards above zero' : 'a declared config is named')
        : null,
      declaredConfigs,
      trailingMultiplier,
      nullBoards: p.labelShiftReps,
    },
    rows,
    bytes,
    memory: { bytes: memBytes, settingsBytes, workers },
    time: { seconds, secPerTraining: rate.secPerTraining, samples: rate.samples },
    box,
    warnings,
  };
}

const gb = (n) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1048576))} MB`);

module.exports = { estimate, recordRate, medianRate, boxResources, BYTES_PER_ROW, gb };
