const fs = require('fs');
const path = require('path');
const { pnlAt, FEE_PER_LEG, feeRate, feeFracOf, voteOf, superOf } = require('./paper');
const { stampManifest } = require('./manifest');

// THE RUN LAUNCHERS, and the record every run leaves behind.
//
// Everything the Construct screen starts comes through here: the board sweep
// and its promoted stage, the null runs that price it, History Tuning and its
// paired-fold exam, and the reserve grade. Each writes its progress to disk as
// it goes, so a crash loses at most the unit in flight, and each leaves a
// stored document the screen reads back.
//
// Results live in data/batches/, which survives deploys — the installer's sync
// excludes data/.
//
// This header used to describe a single-pair screen. That screen was retired
// (THIS-RELEASE point 14) and its launcher went with it, along with most of
// lib/pipeline.js, which nothing else reached.

const BATCH_DIR = path.join(__dirname, '..', 'data', 'batches');
// Stamped into every bracket job's stored settings: identical parameters do
// not guarantee identical machinery when the code changed between two runs.
const ENGINE_VERSION = require('../package.json').version;

// High-market-cap USDT pairs with long Binance spot history (all listed
// 2017–2020, still major in mid-2026). Pairs that turn out to have no data
// in the requested range fail their own run and the batch moves on.
const DEFAULT_PAIRS = [
  'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'SOLUSDT', 'DOGEUSDT',
  'LTCUSDT', 'LINKUSDT', 'DOTUSDT', 'AVAXUSDT', 'TRXUSDT', 'XLMUSDT',
  'ETCUSDT', 'ATOMUSDT', 'BCHUSDT', 'UNIUSDT', 'ZECUSDT',
];

let activeBatch = null; // one at a time; the UI polls this
// THE ROWS OF THE RUNNING JOB, held open on disk rather than in the document
// (owner order, 2026-08-22). One writer per collection, created when the run
// starts and closed when it ends. They are NOT on the doc: the doc is turned
// into text on every save, and these are the three things that made that
// impossible.
let activeRows = null;
function openRowStores(runId) {
  closeRowStores();
  activeRows = {
    id: runId,
    slim: rowstore.writer(runId, 'slim'),
    census: rowstore.writer(runId, 'census'),
    replication: rowstore.writer(runId, 'replication'),
  };
  return activeRows;
}
function closeRowStores() {
  if (!activeRows) return;
  for (const k of ['slim', 'census', 'replication']) {
    try { activeRows[k].close(); } catch (_) { /* already shut */ }
  }
  activeRows = null;
}
// Which units a run has already recorded, without holding the rows. The whole
// point of a resume is that it costs less than starting over, and reading ten
// million rows into memory to work out what to skip would have made picking a
// run up as expensive as the thing it avoids.
function keysAlreadyDone(doc, name) {
  const out = new Set();
  if (rowstore.exists(doc.id, name)) {
    rowstore.each(doc.id, name, (r) => { if (r.key) out.add(r.key); });
    return out;
  }
  // A run recorded before the rows moved to disk keeps them in the document.
  const inDoc = name === 'slim' ? doc.slimResults : doc.edgeCensus;
  for (const r of (inDoc || [])) if (r && r.key) out.add(r.key);
  return out;
}

// Promoted rows recorded before the census carried a key. They cannot be
// matched to a unit, so those units are scored again rather than skipped — and
// the screen says how many, rather than letting the work happen invisibly.
function countUnnamed(doc) {
  if (rowstore.exists(doc.id, 'census')) {
    let n = 0;
    rowstore.each(doc.id, 'census', (r) => { if (!r.key) n++; });
    return n;
  }
  return (doc.edgeCensus || []).filter((r) => !r.key).length;
}

// How many of each, for the doc. Cheap: it is the writers' own counters while a
// run is going, and a forty-byte sidecar afterwards.
function rowCountsFor(doc) {
  if (activeRows && activeRows.id === doc.id) {
    return { slim: activeRows.slim.count, census: activeRows.census.count, replication: activeRows.replication.count };
  }
  return {
    slim: rowstore.count(doc.id, 'slim'),
    census: rowstore.count(doc.id, 'census'),
    replication: rowstore.count(doc.id, 'replication'),
  };
}

// Startup sweep: a batch doc still marked 'running' on disk means the
// service died or was restarted mid-screen (deploys included). Mark it
// honestly so the picker never shows a zombie as alive. Completed runs and
// the summary-so-far are already persisted and stay usable.
//
// markInterrupted is pure and exported for the tests: walkforward docs have
// no runs array, and the old sweep crashed on the first one — aborting the
// sweep for every doc after it, so a zombie could show as alive (QC 58).
function markInterrupted(doc) {
  if (Array.isArray(doc.runs)) {
    for (const r of doc.runs) if (r.status === 'running') r.status = 'error';
  }
  doc.status = 'interrupted';
  if (doc.nullTest && doc.nullTest.status === 'running') doc.nullTest.status = 'interrupted';
  doc.finishedAt = doc.finishedAt || new Date().toISOString();
  // SAY WHERE IT GOT TO, AND SAY IT ON THE RECORD (owner, 2026-08-22). This
  // used to blank doc.progress and set the status, and that was the whole
  // report: the owner's five-hour sweep stopped after five minutes and the
  // only thing anywhere that said so was one word in a dropdown. A run that
  // ends has to leave behind what it was doing when it ended, because by the
  // time anyone looks, the thing that ended it is gone from the screen.
  const perf = doc.perf || {};
  const where = perf.unitsTotal
    ? `${perf.phase || 'running'} ${perf.unitsDone ?? 0}/${perf.unitsTotal}`
    : (doc.progress || 'in progress');
  doc.interruptedAt = doc.interruptedAt || doc.finishedAt;
  doc.interruptedWhere = doc.interruptedWhere || where;
  doc.error = doc.error
    || `the service stopped while this run was going — it was at ${where}. `
    + 'Nothing it had already finished is lost, but the run did not complete and cannot be resumed: '
    + 'start it again from the Sweep section.';
  doc.progress = '';
  return doc;
}

(() => {
  let files = [];
  try {
    files = fs.readdirSync(BATCH_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return; /* no batch dir yet */
  }
  for (const f of files) {
    const file = path.join(BATCH_DIR, f);
    try {
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (doc.status !== 'running') continue;
      {
        const tmp = `${file}.tmp${process.pid}-boot`;
        fs.writeFileSync(tmp, JSON.stringify(markInterrupted(doc), null, 1));
        fs.renameSync(tmp, file);
      }
    } catch {
      /* one unreadable doc must not abort the sweep for the rest */
    }
  }
})();

let saveSeq = 0;
// Atomic file write for every on-disk record (QC 75): dumps, fold files,
// docs. A torn record is a record deleted.
function atomicWrite(file, data) {
  const tmp = `${file}.tmp${process.pid}-${++saveSeq}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// The failure list caps at 200 to keep docs light, but a SILENT cap hides
// the breadth of a breakage: past the cap the counter still ticks, so the
// reader always knows how many more failed than the list shows.
function recordFailure(doc, key, error) {
  if (doc.failures.length < 200) doc.failures.push({ key, error });
  else doc.failuresDropped = (doc.failuresDropped || 0) + 1;
  // A failure is not progress. Progress can be a couple of seconds stale and
  // nothing is lost; a failure that never reached disk is a failure nobody
  // will ever know happened, so the next tick writes whatever the clock says.
  lastSaveAt = 0;
}

// QC 74 (owner law, 2026-08-04): computed records are NEVER deleted. When a
// tool is re-fired over an existing result — a new null test, a fresh
// selection, another confirm — the old result moves to doc.priorResults
// with a timestamp instead of being overwritten. Nothing archives when
// there is nothing to archive (first fire).
function archivePrior(doc, kind, value) {
  if (value == null) return;
  doc.priorResults = doc.priorResults || [];
  doc.priorResults.push({ kind, archivedAt: new Date().toISOString(), value });
}

function batchFile(id) {
  return path.join(BATCH_DIR, `${id}.json`);
}

// PROGRESS SAVES ARE THROTTLED. RECORD SAVES ARE NOT.
//
// saveBatch rewrites the WHOLE run document, pretty-printed, and the per-unit
// callbacks called it once per unit. That is right when a run is a few hundred
// units and its document is a few kilobytes. The owner's wide sweep on
// 2026-08-22 was 123,624 units and its document was 2 MB — its declared set
// alone is 1.4 MB of JSON — so finishing it would have meant allocating a 2 MB
// string a hundred and twenty-three thousand times, and building those strings
// faster than the collector could reclaim them is half of why the service died
// with a full heap five minutes in.
//
// What is traded away: on a hard stop, up to PROGRESS_SAVE_MS of finished units
// are missing from the file. That is a real loss and it is the right one — the
// run is marked interrupted either way, and the alternative was a run that
// could not finish at all. Everything that ENDS something still writes
// immediately: phase changes, completion, cancellation, failure.
//
// ONE CLOCK, and saveBatch itself winds it. Every full save — a phase change,
// a completion, a failure — counts as the last write, so there is no second
// notion of "when did this doc last reach disk" to fall out of step with the
// first, and no start-of-job wiring for a caller to forget.
const PROGRESS_SAVE_MS = 2000;
let lastSaveAt = 0;

function saveProgress(doc) {
  if (Date.now() - lastSaveAt < PROGRESS_SAVE_MS) return false;
  // The rows and the document that counts them must agree. Flushing here means
  // a hard stop loses the same couple of seconds from both, rather than leaving
  // a document claiming rows that never reached the file.
  if (activeRows && activeRows.id === doc.id) {
    for (const k of ['slim', 'census', 'replication']) {
      try { activeRows[k].flush(); } catch (_) { /* the next flush will carry them */ }
    }
  }
  saveBatch(doc);
  return true;
}

function saveBatch(doc) {
  // ATOMIC (QC 75, 2026-08-04): this file IS the run's record and gets
  // rewritten after every unit — a crash mid-write used to leave truncated
  // JSON that every reader silently skipped, so a finished run could vanish
  // from the picker with no trace. tmp+rename, like the candle cache.
  fs.mkdirSync(BATCH_DIR, { recursive: true });
  const file = batchFile(doc.id);
  const tmp = `${file}.tmp${process.pid}-${++saveSeq}`;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 1));
  fs.renameSync(tmp, file);
  lastSaveAt = Date.now();
  keepGateVerdict(doc);
}

// THE PLANTED CHECK'S VERDICT IS NOT THE RUN (owner, 2026-08-22): "if i delete
// a planted check saved run on Boards then the planted check status goes away.
// the status should be persisted even if i choose to delete the run from the
// list."
//
// The status used to be worked out fresh, every time it was asked for, by
// re-reading the gate run's file out of data/batches — the same file the
// delete button removes. So clearing a finished calibration out of the picker
// also retracted the calibration.
//
// Now the reading is written to its own small file as soon as the run stops.
// Nothing on the Boards section can reach it, and it is the id, the engine
// version it judged, the pass or fail and the sentences saying why — a few
// hundred bytes, not the rows.
//
// It sits in saveBatch rather than at the end of the run because a run can
// also stop by being interrupted or erroring, and each of those paths saves.
// planted.recordGate does nothing for runs that are not the planted check, and
// nothing again for a run whose record already matches, so the ordinary save
// after every unit costs one string comparison.
function keepGateVerdict(doc) {
  if (!doc || !(doc.params && doc.params.plantedGate)) return;
  try { require('./planted').recordGate(doc); } catch (_) {
    // A verdict that cannot be written must never take the run down with it:
    // the run's own file is already safely on disk by this point.
  }
}

// One picker row from a doc on disk. Pure and exported for the tests:
// walkforward docs carry unit progress in perf instead of a runs array, and
// the old inline version threw on them — the doc silently vanished from the
// picker (QC 58).

// Inclusive month count between 'YYYY-MM' strings; null on unparseable input
// (the floor check then defers to the data-driven checks downstream).
function monthSpan(a, b) {
  const m = (x) => {
    const mm = /^(\d{4})-(\d{2})$/.exec(String(x || ''));
    return mm ? Number(mm[1]) * 12 + Number(mm[2]) : null;
  };
  const A = m(a);
  const B = m(b);
  return A != null && B != null && B >= A ? B - A + 1 : null;
}

function listRow(d) {
  const runs = Array.isArray(d.runs) ? d.runs : null;
  return {
    id: d.id,
    kind: d.kind || 'screen',
    status: d.status,
    startedAt: d.startedAt,
    finishedAt: d.finishedAt || null,
    runsDone: runs ? runs.filter((r) => r.status !== 'pending').length : (d.perf?.unitsDone ?? 0),
    runsTotal: runs ? runs.length : (d.perf?.unitsTotal ?? 0),
    // HOW IT ENDED TRAVELS WITH THE ROW (owner, 2026-08-22). Without this the
    // picker could say a run was interrupted and nothing anywhere could say
    // why — and the only screen that would have shown a reason is the one the
    // owner has to already know to go and open.
    error: d.error || null,
    interruptedWhere: d.interruptedWhere || null,
    params: d.params,
  };
}

function listBatches() {
  let files = [];
  try {
    files = fs.readdirSync(BATCH_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files
    .map((f) => {
      try {
        return listRow(JSON.parse(fs.readFileSync(path.join(BATCH_DIR, f), 'utf8')));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
}

// DELETING A RUN (owner order, 2026-08-22). The Boards section had no way to
// remove one, so the picker grew for ever and a wide sweep that died in its
// first minutes sat at the top of it looking like a result.
//
// Two things it will not do, and both matter:
//   * the RUNNING one. The owner asked for this by name — they want to restart
//     that sweep themselves, and deleting the file out from under a job that
//     is writing it is how a run half-exists.
//   * a run something is standing on. A greenlight names the run its evidence
//     came from, and a setup on the Trade tab names the greenlight. Deleting
//     the run would leave a thing that is trading pointing at evidence that no
//     longer exists — the same fault the campaign lock was written to stop, so
//     it is the same rule here.
function runContents(id) {
  const doc = getBatch(id);
  if (!doc) throw new Error(`no run called "${id}"`);

  const greenlights = [];
  try {
    for (const g of require('./live/greenlight').listGreenlights()) {
      if (((g.sourceRun || {}).id || null) !== doc.id) continue;
      greenlights.push({ id: g.id, revoked: !!g.revoked });
    }
  } catch (_) { /* live modules absent in some test contexts */ }

  const glIds = new Set(greenlights.map((g) => g.id));
  const setups = [];
  try {
    for (const st of require('./live/setups').listSetups()) {
      if (!glIds.has(st.provenanceRef)) continue;
      setups.push({ id: st.id, name: st.name, state: st.state, channel: st.channel || null });
    }
  } catch (_) { /* live modules absent in some test contexts */ }

  const dirCount = (sub) => {
    try { return fs.readdirSync(path.join(__dirname, '..', 'data', sub, doc.id)).length; } catch (_) { return 0; }
  };
  const isRunning = doc.status === 'running' || (activeBatch && activeBatch.id === doc.id);
  return {
    id: doc.id,
    status: doc.status,
    campaign: (doc.params || {}).campaign || null,
    description: doc.description || (doc.params || {}).description || '',
    running: !!isRunning,
    greenlights,
    setups,
    counts: {
      leaderRows: (doc.leaders || []).length,
      slimRows: (doc.rowCounts && doc.rowCounts.slim) || rowstore.count(doc.id, 'slim') || (doc.slimResults || []).length,
      replicationRows: (doc.rowCounts && doc.rowCounts.replication) || rowstore.count(doc.id, 'replication') || (doc.replication || []).length,
      rowBytes: rowstore.bytes(doc.id),
      greenlights: greenlights.length,
      setups: setups.length,
      modelFiles: dirCount('models'),
      tuningFiles: dirCount('ht'),
    },
    // The owner is told what survives as well as what goes. Deleting the
    // planted check's rows does not retract its verdict any more, and a
    // deletion box that only lists losses would not say so.
    plantedGate: !!(doc.params || {}).plantedGate,
    locked: !!isRunning || greenlights.length > 0,
    lockedWhy: isRunning
      ? 'this run is going right now — stop it first with Stop jobs, then delete it'
      : (greenlights.length
        ? `${greenlights.length} greenlight(s) name this run as their evidence`
        : null),
  };
}

function deleteBatch(id) {
  const found = runContents(id);
  if (found.locked) {
    const err = new Error(`"${found.id}" cannot be deleted: ${found.lockedWhy}. Nothing has been deleted.`);
    err.code = 'RUN_LOCKED';
    err.locked = found;
    throw err;
  }
  // FIRST, WHILE THE ROWS ARE STILL THERE. A gate run that finished before
  // verdicts were kept has no record yet, and building one means reading its
  // board — so this is the last moment it can be done. The record is then
  // marked, so the strip says the run itself is gone rather than naming one
  // the owner can no longer open. Doing this after rowstore.remove would have
  // produced an unreadable verdict and kept THAT, which is the fault this is
  // written to avoid, not a smaller version of it.
  if (found.plantedGate) {
    try { require('./planted').markGateRunDeleted(getBatch(found.id)); } catch (_) { /* nothing to keep */ }
  }
  const dataDir = path.join(__dirname, '..', 'data');
  const rmDir = (d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* nothing there */ } };
  const removed = { modelFiles: found.counts.modelFiles, tuningFiles: found.counts.tuningFiles };
  rmDir(path.join(dataDir, 'models', found.id));
  rmDir(path.join(dataDir, 'ht', found.id));
  rowstore.remove(found.id);
  try { fs.rmSync(batchFile(found.id), { force: true }); } catch (_) { /* already gone */ }
  removed.run = 1;
  removed.plantedCheckVerdictKept = !!found.plantedGate;
  return { id: found.id, removed };
}

// THE COMPATIBILITY LAYER, and the reason this change did not have to touch
// every reader in the codebase.
//
// Four modules and the Construct page say `doc.edgeCensus` and expect an array.
// They still can. The rows live on disk now, so these properties are getters
// that read them on demand — and they are NON-ENUMERABLE, which is the part
// that matters: JSON.stringify walks enumerable properties, so saveBatch does
// not see them, and the run document stays the same size whether the run
// produced fifty rows or fifty million.
//
// Materialising is still materialising. A caller that reads doc.replication on
// a run with ten million rows will hold ten million objects, which is why
// nothing on the serving path does that any more — the aggregate is built by
// streaming instead. These getters exist so that ANALYSIS code, which runs once
// on a finished run and has already decided it can afford the rows, does not
// have to change at all.
const ROW_PROPS = { slimResults: 'slim', edgeCensus: 'census', replication: 'replication' };
function hydrate(doc) {
  if (!doc || doc.__hydrated) return doc;
  Object.defineProperty(doc, '__hydrated', { value: true, enumerable: false });
  for (const [prop, name] of Object.entries(ROW_PROPS)) {
    // A document written before the rows moved carries its own array. Leave it:
    // it is the only copy there is.
    if (Array.isArray(doc[prop]) && doc[prop].length) continue;
    if (!rowstore.exists(doc.id, name)) continue;
    let cached = null;
    Object.defineProperty(doc, prop, {
      enumerable: false,
      configurable: true,
      get() { if (!cached) cached = rowstore.readAll(doc.id, name); return cached; },
    });
  }
  return doc;
}

function getBatch(id) {
  // R11: batch ids are internal slugs (a letter/digit then letters/digits/._-).
  // Reject any traversal-shaped id BEFORE it path-joins into a read, so an
  // unvalidated runId (e.g. from the greenlight endpoint, where setup/greenlight
  // ids are validated but this one was not) can never escape BATCH_DIR into an
  // arbitrary .json read. Guards every caller, not just that one route.
  const s = String(id);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(s) || s.includes('..')) return null;
  if (activeBatch && activeBatch.id === s) return hydrate(activeBatch);
  try {
    const doc = JSON.parse(fs.readFileSync(batchFile(id), 'utf8'));
    // The runs are the record; the summary is derived. Rebuild it on read so
    // docs saved by older versions pick up new summary fields (e.g. median
    // paper P&L) without re-running anything.
    if (doc.summary && Array.isArray(doc.runs)) {
      doc.summary = summarize(doc.runs);
    }
    return hydrate(doc);
  } catch {
    return null;
  }
}

// D2 (review 2026-08-04): the cache-write guard was one-directional — jobs
// refused while a batch ran, but a batch could start over a running job's
// writes. Both directions now refuse.
function launchRefusal() {
  if (activeBatch && activeBatch.status === 'running') return `batch ${activeBatch.id} is already running`;
  const j = require('./jobs').anyJobRunning();
  if (j) return `data/analysis job ${j} is running — a sweep launched over its cache writes would read two datasets`;
  return null;
}

function batchRunning() {
  return activeBatch && activeBatch.status === 'running' ? activeBatch.id : null;
}

// Owner's kill switch: flag the active batch so its loop stops at the next
// run boundary (the throttle-level abort kills the in-flight run itself).
function cancelActive() {
  if (!batchRunning()) return null;
  activeBatch.cancelRequested = true;
  // Terminating workers is harder and faster than a cooperative flag, and
  // matches what "Stop jobs" has always promised: in-flight training dies
  // within seconds, completed results are kept.
  if (activePool) {
    try {
      activePool.abort();
    } catch {
      /* already gone */
    }
    activePool = null;
  }
  return activeBatch.id;
}

// Rank runs for the summary: by edge over the BEST CONSTANT hindsight guess
// (immune to train/test distribution shift), then by balanced-accuracy
// edge. Failed runs sink to the bottom with their errors.
function summarize(runs) {
  const done = runs.filter((r) => r.status === 'done');
  const failed = runs.filter((r) => r.status === 'error');
  const rankKey = (m) => m.hindsightEdge ?? m.edge ?? -1;
  const ranked = [...done].sort((a, b) => {
    const e = rankKey(b.metrics) - rankKey(a.metrics);
    if (e !== 0) return e;
    return (b.metrics.balancedEdge ?? -1) - (a.metrics.balancedEdge ?? -1);
  });
  return {
    ranked: ranked.map((r) => ({ trade: r.trade, compare: r.compare, model: r.model, view: r.view || null, ...r.metrics })),
    failed: failed.map((r) => ({ trade: r.trade, compare: r.compare, model: r.model, error: r.error })),
    positiveEdge: ranked.filter((r) => rankKey(r.metrics) > 0).length,
    done: done.length,
    total: runs.length,
  };
}

// The fabricated planted-check pair never enters ANY real launcher — not
// just the Bracket lab. The review (2026-08-03) found the refusal lived in
// one launcher while six others would ingest the pair; every start* now
// runs its pair list through this.
function refusePlantedPairs(symbols, what) {
  const { PLANTED_SYMBOLS } = require('./planted');
  const hit = (symbols || []).filter(Boolean).find((x) => PLANTED_SYMBOLS.includes(x));
  if (hit) {
    throw new Error(`${hit} is a reserved fabricated pair (planted check / instrument exams) — it never enters ${what}`);
  }
}

// ---- bracket lab (owner's execution-permutation system) ----------------------
//
// Slim-then-promote sweep over asset COMBOS (singles/doubles/triples from a
// chosen universe) × permutable option branches (geometry / decision / band /
// 24-5), each scored through the full OCO-bracket execution menu
// (gate × d × t, plus quorum rungs at the promoted stage) with the DECLARED
// mechanical selection rule. No nulls in the sweep by design; the null stage
// replays everything downstream of the surviving combo. Big searches are the
// point — the stamp carries every menu and the full denominator, and the
// ledger's rules apply to whatever crawls out.

const { median } = require('./stats');
const { slimViewsFor } = require('./bracketwork');
const bracketLib = require('./bracket');
const rowstore = require('./rowstore');
const { createPool } = require('./pool');

// The pool serving whichever heavy job is in flight, so the kill switch can
// terminate its workers immediately (see cancelActive).
let activePool = null;
// Candle→chunk→label plumbing now lives in bracketwork.js (the workers run
// it); this thread only needs geometry metadata and the cache pre-warm.
const { GEOMETRIES: GEOS } = require('./dataset');
const { loadSymbol, loadSymbolAll, monthList } = require('./pipeline');

const BRACKET_BAND_MENU = ['auto', 3, 5, 8];
const BRACKET_GEOMETRIES = Object.keys(GEOS);

function expandBracketPlan(p) {
  const geometries = p.permute.geometry ? BRACKET_GEOMETRIES : [p.set.geometry];
  const decisions = p.permute.decision ? ['argmax', 'directional'] : [p.set.decision];
  const bands = p.permute.band ? BRACKET_BAND_MENU : [p.set.band];
  const weekdays = p.permute.weekdays ? [false, true] : [!!p.set.weekdaysOnly];
  const branches = [];
  for (const geometry of geometries) {
    for (const decision of decisions) {
      for (const band of bands) {
        for (const wd of weekdays) {
          // weekly chunks always span weekends — the 24/5 branch would be an
          // exact duplicate, so permutation skips it (an explicit setting
          // passes through untouched; buildChunks ignores it there anyway)
          if (p.permute.weekdays && wd && geometry === 'weekly-8d') continue;
          branches.push({ geometry, decision, band, weekdaysOnly: wd });
        }
      }
    }
  }
  const u = p.universe;
  const combos = [];
  if (p.sizes.singles) for (const a of u) combos.push({ trade: a, ctx1: null, ctx2: null, size: 1 });
  if (p.sizes.doubles) for (const a of u) for (const b of u) if (b !== a) combos.push({ trade: a, ctx1: b, ctx2: null, size: 2 });
  if (p.sizes.triples) {
    for (const a of u) {
      const rest = u.filter((x) => x !== a);
      for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) combos.push({ trade: a, ctx1: rest[i], ctx2: rest[j], size: 3 });
    }
  }
  return { branches, combos };
}


// REPLICATION MODE. A declared config is a hypothesis fixed BEFORE the run:
// the same execution cell scored on every asset, so each asset costs one
// look instead of the ~1,260 a menu sweep spends. The quorum travels as a
// RATIO of the member set (row 9's 4-of-12 = 1/3), so it means the same
// thing whether a combo yields 6 members (singles) or 8 (with contexts).
// Only the PROMOTED stage carries every rung, so declared cells are read
// there; the slim stage only ever has the majority-vote stream.
const { declaredQuorumFor } = require('./bracketwork');

function validateDeclared(raw, menus) {
  if (!raw) return null;
  // Validate against the RUN's grid, not only the library's (review
  // 2026-08-04): a custom-grid run computes only its own cells, and the
  // declared cell is FOUND among them — a declared value outside the run's
  // menus would run for hours and then hand back an empty replication
  // table. Callers without menus (tests, old paths) get the library grid.
  const m = {
    entries: (menus && menus.entries) || bracketLib.ENTRIES,
    gates: (menus && menus.gates) || bracketLib.GATES,
    dMults: (menus && menus.dMults) || bracketLib.D_MULTS,
    tHours: (menus && menus.tHours) || bracketLib.T_HOURS,
    trailMults: (menus && menus.trailMults) || bracketLib.TRAIL_MULTS,
    armMults: (menus && menus.armMults) || bracketLib.ARM_MULTS,
  };
  const entry = raw.entry === undefined ? 'breakout' : String(raw.entry);
  if (!m.entries.includes(entry)) throw new Error(`declared.entry must be one of ${m.entries.join('/')} (this run's grid)`);
  const tHours = Number(raw.tHours);
  if (!m.tHours.includes(tHours)) throw new Error(`declared.tHours must be one of ${m.tHours.join('/')} (this run's grid)`);

  // MARKET entry is the classifier's own trade: enter at the open in the
  // called direction, no rails. There is no distance to declare and the gate
  // is directional by definition, so demanding either would be asking for a
  // number that does not exist. Reject them outright rather than accepting
  // and ignoring — a silently ignored parameter is how a declared config
  // stops meaning what its author thought it meant.
  let out;
  if (entry === 'market') {
    if (raw.dMult !== undefined) throw new Error('declared.dMult is meaningless for market entry (no rails) — omit it');
    if (raw.gate !== undefined && raw.gate !== 'directional') {
      throw new Error("declared.gate must be omitted or 'directional' for market entry");
    }
    out = { entry, gate: 'directional', dMult: null, tHours };
  } else {
    const gate = String(raw.gate || '');
    if (!m.gates.includes(gate)) throw new Error(`declared.gate must be one of ${m.gates.join('/')} (this run's grid)`);
    const dMult = Number(raw.dMult);
    if (!m.dMults.includes(dMult)) throw new Error(`declared.dMult must be one of ${m.dMults.join('/')} (this run's grid)`);
    out = { entry, gate, dMult, tHours, trailMult: null, armMult: null };
    if (raw.trailMult !== undefined && raw.trailMult !== null) {
      const t = Number(raw.trailMult);
      if (!m.trailMults.includes(t)) throw new Error(`declared.trailMult must be null or one of ${m.trailMults.join('/')}`);
      const a = raw.armMult === undefined ? 0 : Number(raw.armMult);
      if (!m.armMults.includes(a)) throw new Error(`declared.armMult must be one of ${m.armMults.join('/')}`);
      out.trailMult = t;
      out.armMult = a;
    } else if (raw.armMult !== undefined) {
      throw new Error('declared.armMult is meaningless without declared.trailMult — omit it');
    }
  }
  // PER-SIZE COUNTS (owner, 2026-07-31). Committees are 6 members for a
  // single coin and 8 with context coins, so a declaration may name a count
  // for each. Either alone is valid — a run that ticks only one combo size
  // only needs one.
  if (raw.quorumSingles !== undefined || raw.quorumContexts !== undefined) {
    const each = (v, cap, name) => {
      if (v === undefined) return undefined;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > cap) throw new Error(`declared.${name} must be a whole number from 1 to ${cap}`);
      return n;
    };
    const qs = each(raw.quorumSingles, 6, 'quorumSingles');
    const qc = each(raw.quorumContexts, 8, 'quorumContexts');
    if (qs !== undefined) out.quorumSingles = qs;
    if (qc !== undefined) out.quorumContexts = qc;
  } else if (raw.quorumRatio !== undefined) {
    const r = Number(raw.quorumRatio);
    if (!Number.isFinite(r) || r <= 0 || r > 1) throw new Error('declared.quorumRatio must be in (0,1]');
    out.quorumRatio = r;
  } else {
    const q = Number(raw.quorum);
    if (!Number.isInteger(q) || q < 1) throw new Error('declared.quorum must be a positive integer');
    out.quorum = q;
  }
  const q = out.quorumSingles != null || out.quorumContexts != null
    ? [out.quorumSingles != null ? `${out.quorumSingles}/6` : null,
       out.quorumContexts != null ? `${out.quorumContexts}/8` : null].filter(Boolean).join('+')
    : out.quorumRatio ? `${Math.round(out.quorumRatio * 100)}%` : out.quorum;
  const trailBit = out.trailMult == null ? '' : ` trail${out.trailMult}x/arm${out.armMult}x`;
  out.label = out.entry === 'market'
    ? `q${q} market t${out.tHours}h`
    : `q${q} ${out.gate} d${out.dMult}x t${out.tHours}h${trailBit}`;
  return out;
}
// PERMUTING THE DECLARED CONFIG (owner, 2026-08-17). The single declared config
// is unchanged and stays the default: declare one cell, score it on every asset,
// no shopping. This adds the option to declare a SET instead — permute any of the
// replication boxes and every combination is scored on every asset, so the
// replication table can be read for a wide region rather than a single point.
//
// The set is built from the RUN's own grid (the same menus validateDeclared
// checks against), and every member goes through validateDeclared itself. That is
// deliberate: one rule decides what a legal declared config is, so a permuted set
// can never contain something the single path would have refused — a market cell
// with a gate, an arm with no trail.
//
// A permuted declared config is NOT declared in the strict sense any more: you
// searched for it. The honest end of that search is the sealed slice — window
// layout 61/13/13/13 and the History section's one-touch exam.
// NO CAP, BY OWNER RULE (2026-08-17): "software reports the number, human makes
// the decision, always". The form shows how many configs the ticks declare before
// Start sweep is pressed; nothing here refuses a count. A guessed ceiling would be
// the software overruling the owner on a number it invented.

function expandDeclared(raw, permute, menus) {
  if (!raw) return [];
  const on = permute || {};
  const any = ['entry', 'gate', 'dMult', 'tHours', 'trail', 'arm', 'agree'].some((k) => on[k]);
  // NO permute ticked: byte-identical to the single path, one config, same object.
  if (!any) return [validateDeclared(raw, menus)];

  const m = {
    entries: (menus && menus.entries) || bracketLib.ENTRIES,
    gates: (menus && menus.gates) || bracketLib.GATES,
    dMults: (menus && menus.dMults) || bracketLib.D_MULTS,
    tHours: (menus && menus.tHours) || bracketLib.T_HOURS,
    trailMults: (menus && menus.trailMults) || bracketLib.TRAIL_MULTS,
    armMults: (menus && menus.armMults) || bracketLib.ARM_MULTS,
  };
  // ARM RIDES A MOVING STOP, and permuting trail puts moving stops in the run
  // off a base that declares none — so an armMult with no trailMult is legal
  // HERE and only here. Without this the screen had nowhere to send the arm
  // setting for a permuted trail, so every trailing member was scored at the
  // code's own 0x: a value the operator never saw and never chose (owner,
  // 2026-08-22). An arm no member could use is still refused, never ignored.
  if (raw.armMult !== undefined && (raw.trailMult === undefined || raw.trailMult === null) && !on.trail) {
    throw new Error('declared.armMult is meaningless without declared.trailMult — omit it');
  }
  const pick = (flag, list, fixed) => (flag ? list.slice() : [fixed]);
  const out = [];
  const entries = on.entry ? m.entries.slice() : [raw.entry === undefined ? 'breakout' : String(raw.entry)];
  for (const entry of entries) {
    // MARKET has no rails: no gate, no distance, no trail, no arm. Expanding
    // those for a market cell would build configs validateDeclared refuses, so
    // the market branch carries only the horizon and the agreement counts.
    const tList = pick(on.tHours, m.tHours, Number(raw.tHours));
    if (entry === 'market') {
      for (const tHours of tList) out.push({ entry, tHours });
      continue;
    }
    const gList = pick(on.gate, m.gates, String(raw.gate || ''));
    const dList = pick(on.dMult, m.dMults, Number(raw.dMult));
    // trail null (the static, opposite-rail stop) is a real choice and stays in
    // the list when trail is permuted — otherwise permuting would silently drop
    // the setting the single path defaults to.
    const trList = on.trail ? [null, ...m.trailMults] : [raw.trailMult === undefined ? null : raw.trailMult];
    for (const gate of gList) {
      for (const dMult of dList) {
        for (const tHours of tList) {
          for (const trailMult of trList) {
            if (trailMult == null) { out.push({ entry, gate, dMult, tHours }); continue; }
            const aList = on.arm ? m.armMults.slice() : [raw.armMult === undefined ? 0 : Number(raw.armMult)];
            for (const armMult of aList) out.push({ entry, gate, dMult, tHours, trailMult, armMult });
          }
        }
      }
    }
  }
  // AGREEMENT is a count per committee size, so it multiplies whatever is above.
  // Only the sizes the declaration already names are permuted — a run with no
  // context combos never declared quorumContexts and must not gain one here.
  const withAgree = [];
  const qsList = on.agree && raw.quorumSingles !== undefined
    ? [1, 2, 3, 4, 5, 6] : [raw.quorumSingles];
  const qcList = on.agree && raw.quorumContexts !== undefined
    ? [1, 2, 3, 4, 5, 6, 7, 8] : [raw.quorumContexts];
  for (const base of out) {
    for (const qs of qsList) {
      for (const qc of qcList) {
        const cfg = { ...base };
        if (qs !== undefined) cfg.quorumSingles = qs;
        if (qc !== undefined) cfg.quorumContexts = qc;
        // a declaration that named neither keeps whatever single form it used
        if (qs === undefined && qc === undefined) {
          if (raw.quorumRatio !== undefined) cfg.quorumRatio = raw.quorumRatio;
          else cfg.quorum = raw.quorum;
        }
        withAgree.push(cfg);
      }
    }
  }

  // One rule decides what is legal: every member is validated exactly as a single
  // declaration would be. De-duplicated on the label so an expansion that lands
  // on the same cell twice is scored once.
  const seen = new Set();
  const validated = [];
  for (const cfg of withAgree) {
    const v = validateDeclared(cfg, menus);
    if (seen.has(v.label)) continue;
    seen.add(v.label);
    validated.push(v);
  }
  return validated;
}

// A unit's ROTATION STANCE rides on key PRESENCE, exactly like the unitTask
// fallback it feeds (QC 38): a unit that never mentions shiftFrac defers to
// the run-wide labelShiftFrac; an explicit null means THIS unit must not
// rotate. The old payload builders collapsed both cases to an explicit null,
// so labelShiftFrac-only jobs never rotated at all and discovery-mode
// promotion reran scrambled slim rows unrotated (audit 2026-07-30).
const shiftStance = (o) => (Object.prototype.hasOwnProperty.call(o, 'shiftFrac') ? { labelShiftFrac: o.shiftFrac ?? null } : {});

const unitKey = (c, b) => `${c.trade}|${c.ctx1 || ''}|${c.ctx2 || ''}|${b.geometry}|${b.decision}|${b.band}|${b.weekdaysOnly ? '24-5' : '24-7'}`;

// A UNIT'S FULL NAME, INCLUDING WHICH COPY OF IT THIS IS. Written once because
// three places compute it and a resume compares them: the slim record, the
// promotion list, and the filter that decides what a picked-up run still has
// to do. Three copies of one expression is three chances for a resume to
// silently re-score work it had already finished, or worse, to skip work it
// had not (owner, 2026-08-22).
const unitFullKey = (c, b, u) => unitKey(c, b)
  + (u && u.shiftFrac != null ? `|s${u.shiftFrac.toFixed(3)}` : '')
  + (u && u.nullDealSeed != null ? `|n${u.nullDealSeed}` : '');

function bracketPerfTick(doc) {
  const perf = doc.perf;
  const elapsed = Date.now() - new Date(doc.startedAt).getTime();
  perf.elapsedMs = elapsed;
  perf.ratePerMin = perf.runsDone ? (perf.runsDone / elapsed) * 60_000 : null;
  perf.secPerTraining = perf.runsDone ? elapsed / perf.runsDone / 1000 : null;
  perf.etaMs = perf.runsDone ? (elapsed / perf.runsDone) * (perf.runsTotal - perf.runsDone) : null;
}

// TOTAL order, not merely "by pnl": with tasks completing in worker-race
// order, an unresolved tie would make the retained top-K depend on arrival
// order. Tiebreaking on key+stage makes the final board a pure function of
// the SET of results, so parallel output is byte-identical to serial.
// STAGE-AWARE SORT (owner, 2026-07-30: "sort this board by good hold-out
// data, not good test data").
//
// Slim rows keep SEARCH-window order because promotionSet slices them in this
// order — promotion is the search window's job, and sorting slim rows by
// holdout would smuggle the holdout into SELECTION, poisoning the one window
// whose meaning depends on never being chosen with.
//
// Promoted rows sort by HELD-BACK money — display and retention only; their
// holdout is already committed and scored, so ranking them on it selects
// nothing. Rows failing the minTrades floor (or with no holdout at all) sink,
// so a two-trade fluke cannot top the board.
function leaderCmp(a, b, minTrades = 1) {
  if (a.stage !== b.stage) return a.stage === 'promoted' ? -1 : 1;
  const tie = () => {
    const ka = `${a.key}|${a.stage}`;
    const kb = `${b.key}|${b.stage}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
  if (a.stage === 'promoted') {
    const qa = a.holdout && (a.holdout.trades || 0) >= minTrades ? 1 : 0;
    const qb = b.holdout && (b.holdout.trades || 0) >= minTrades ? 1 : 0;
    if (qa !== qb) return qb - qa;
    // Rows that HAVE a held-back number rank on it. Rows that do not — a run
    // fired without a holdout, where none exists at all — fall back to the
    // settings-window money (owner, 2026-07-31). Previously they all tied at
    // -Infinity and the board came out in alphabetical order, ranked by
    // nothing, with no sign that the order was meaningless. Rows WITH a
    // held-back number still outrank rows without (the qualifier above), so
    // this fallback can never pull an unjudged row above a judged one.
    if (!a.holdout && !b.holdout) {
      if (b.pnl !== a.pnl) return b.pnl - a.pnl;
      return tie();
    }
    const ha = a.holdout ? a.holdout.pnl : -Infinity;
    const hb = b.holdout ? b.holdout.pnl : -Infinity;
    if (hb !== ha) return hb - ha;
    return tie();
  }
  if (b.pnl !== a.pnl) return b.pnl - a.pnl;
  return tie();
}

function pushLeader(doc, row) {
  // Null copies never sit on the board (owner order, 2026-08-04): they are
  // comparison material, never trade candidates, and they were eating the
  // 50 capped slots. They live in full in the census.
  if (row.nullDealSeed != null) return;
  doc.leaders.push(row);
  doc.leaders.sort((a, b) => leaderCmp(a, b, doc.params.minTrades || 1));
  if (doc.leaders.length > (doc.params.detailK || 50)) doc.leaders.length = doc.params.detailK || 50;
}

// Which units get the full 16-member grid.
//
// REPLICATION and EDGE-SCREEN modes promote EVERY unit; discovery keeps top-K.
//
// Replication: the declared cell is only ever read at the promoted stage, so
// a P&L-ranked top-K would condition the whole table on slim performance.
//
// Edge screen: the question is "does the committee predict, anywhere", and a
// board ranked by MONEY answers a different one. Units win on P&L partly
// because their calls were good, so measuring edge on the P&L winners selects
// on edge and biases the answer upward. Measured: a first attempt showed
// 20/29 holdout-positive at p=0.03 from 29 money-selected rows out of 170
// units — a finding-shaped number with no census behind it.
//
// (The leaderboard is capped at detailK besides, so top-K could never have
// covered a large universe.) In discovery mode, promotion IS the selection
// step and top-K is correct.
function promotionSet(p, doc, units) {
  if (p.declared || p.edgeScreen) {
    return units.map((u) => { const { c, b } = u; return ({
      // The key carries EVERY arm marker. Dropping one here silently merges
      // arms downstream: the null-deal seed was missing (caught by the
      // 2026-08-03 adversarial review, BLOCKER) — every census sweep's null
      // boards ran un-dealt at the promote stage, bit-identical to the real
      // arm, their census rows tagged real, and the five gate arms shared
      // one key so their model dumps overwrote each other.
      key: unitFullKey(c, b, u),
      trade: c.trade, ctx1: c.ctx1, ctx2: c.ctx2, size: c.size,
      geometry: b.geometry, decision: b.decision, bandMode: b.band, weekdaysOnly: b.weekdaysOnly,
      ...(Object.prototype.hasOwnProperty.call(u, 'shiftFrac') ? { shiftFrac: u.shiftFrac ?? null } : {}),
      ...(u.nullDealSeed != null ? { nullDealSeed: u.nullDealSeed } : {}),
    }); });
  }
  return doc.leaders.filter((l) => l.stage === 'slim').slice(0, p.promoteK);
}

// ---- WALK-FORWARD orchestration (DESIGN-WALKFORWARD.md, 2026-07-31) --------
// The stacked instrument: per unit, wfUnitTask runs every fold serially;
// units parallelize across the pool. Per-fold detail goes to DISK
// (data/wf/<jobId>/<key>.json — the calibration ledgers read it); the doc
// carries per-unit aggregates only, so the polled record stays light.
const { wfUnitTask } = require('./walkforward');

// ---- HISTORY TUNING (design ledger, all rulings closed 2026-08-03) ---------
// One selected survivor; 35 dial passes x 3 splits; reference pass first;
// reading rules stamped BEFORE anything computes; full decision trail per
// pass on disk for the trail-replay null. Loud validation throughout (QC 60).
function htParams(params) {
  const HT = require('./historytuning');
  const need = (k) => {
    if (params[k] == null) throw new Error(`History Tuning launch is missing '${k}' — nothing is defaulted silently`);
    return params[k];
  };
  const sourceBatchId = String(need('sourceBatchId'));
  const src = getBatch(sourceBatchId);
  if (!src) throw new Error(`unknown source run '${sourceBatchId}'`);
  if (src.kind !== 'bracketlab') throw new Error('History Tuning tunes sweep survivors only');
  if (src.params && src.params.plantedGate) {
    throw new Error('activation refused: that run is the planted check — a calibration of the instrument on a fabricated pair. Its rows judge the pipeline, never candidates.');
  }
  // ACTIVATION RULE (owner): 70/15/15-structure runs only (split70 or
  // reserve61 — legacy80 has no hold window and old quota layouts are
  // retired), AND the gate must use the votes.
  const srcLayout = src.params.windowLayout;
  const okLayout = srcLayout === 'split70' || srcLayout === 'reserve61'
    || (srcLayout === undefined && src.params.holdout) // pre-rename split70 docs
    || (srcLayout === 'legacy' && src.params.holdout);
  if (!okLayout) {
    throw new Error(`activation refused: the source run's layout (${srcLayout || 'legacy 80/20'}) is not `
      + 'a 70/15/15 structure. History Tuning needs a test AND hold window in the source.');
  }
  const cell = need('declaredCell');
  for (const k of ['quorum', 'gate', 'entry', 'tHours', 'bandPct']) {
    if (cell[k] == null) throw new Error(`declaredCell.${k} is missing — the survivor row carries it`);
  }
  if (cell.entry !== 'market' && cell.dMult == null) throw new Error('declaredCell.dMult is missing for a breakout cell');
  if (cell.gate === 'always') {
    throw new Error('activation refused: this row uses the always gate — it enters regardless of votes, '
      + 'so both tuning dials would act on nothing (owner ruling, 2026-08-02)');
  }
  const combo = need('combo'); // { trade, ctx1, ctx2, size }
  const branch = need('branch'); // { geometry, decision, weekdaysOnly, band }
  if (branch.geometry === 'weekly-8d') {
    throw new Error('activation refused: weekly-8d chunks step 7 days, so the effective-training-days '
      + 'arithmetic (built for day-stepping chunks) would judge the floor in units 7x too small. '
      + 'History Tuning covers the daily shapes; weekly-8d is structurally out.');
  }
  const p = {
    sourceBatchId,
    combo,
    branch,
    declaredCell: { ...cell },
    windowStamps: params.windowStamps || null,
    // data window carried from the source run, unchanged (CLOSED 1)
    allLoaded: src.params.allLoaded, startMonth: src.params.startMonth, endMonth: src.params.endMonth,
    dormantPct: src.params.dormantPct, compareSymbol: src.params.compareSymbol,
    // the menu the retunes shop from — the source run's, unchanged
    dMults: src.params.dMults, tHours: src.params.tHours,
    gates: (src.params.gates || []).filter((g) => g !== 'always'),
    entries: src.params.entries,
    // The source run's own fee, normalised to a fraction — a run recorded
    // before 2026-08-23 stored dollars, and tuning it under a different cost
    // than it was found under is not tuning the same thing.
    feePerLeg: src.params.feePerLeg != null ? feeFracOf(src.params) : feeFracOf(params),
    feeUnits: 'fraction',
    minTradesPerLookbackWeek: (() => {
      const v = Number(params.minTradesPerLookbackWeek ?? 0.75); // GUESSED, printed
      if (!Number.isFinite(v) || v <= 0) throw new Error(`minTradesPerLookbackWeek must be a positive number (got ${params.minTradesPerLookbackWeek})`);
      return v;
    })(),
    label: params.label || '', description: params.description || '',
    campaign: require('./campaign').getCampaign() || null,
    engineVersion: ENGINE_VERSION,
    readingRules: HT.READING_RULES, // stamped BEFORE anything computes
    trainingFloorDays: require('./history').TRAINING_FLOOR_DAYS,
  };
  if (p.feePerLeg == null) throw new Error('feePerLeg is missing from the source run and the launch');
  return p;
}

function startHistoryTuning(params) {
  { const stop = launchRefusal(); if (stop) throw new Error(stop); }
  const HT = require('./historytuning');
  // ALL synchronous validation happens BEFORE the slot is claimed — a
  // refusal must never leave a phantom claim wedging batchRunning() (caught
  // by test-htlaunch.js, watched failing). The claim then closes the async
  // window between here and the doc existing (review finding 8).
  let p;
  if (params.replayOf) {
    // NULL DRAW (trail-replay): inherits the REAL run's stamped params
    // verbatim — same splits, same usable span, same menu — plus a seed.
    // The null inherits DATES AND LOOKBACKS ONLY; every retune and the grid
    // pick happen on its own dealt votes (review fix 5).
    const real = getBatch(String(params.replayOf));
    if (!real || real.kind !== 'historytuning') throw new Error(`replayOf: unknown History Tuning run '${params.replayOf}'`);
    if (real.status !== 'done') throw new Error(`replayOf: ${real.id} is ${real.status} — null draws replay finished runs only`);
    if (real.params.arm === 'null') throw new Error('replayOf must point at the REAL run, not another null draw');
    const seed = Number(params.nullShiftSeed);
    if (!Number.isInteger(seed) || seed < 1 || seed > 1e9) {
      throw new Error(`nullShiftSeed must be an integer 1..1e9 (got ${params.nullShiftSeed}) — a null draw without a valid seed would run as a REAL pass under a null label`);
    }
    // The deal is deterministic per seed: a repeated seed is the SAME draw
    // counted twice — 19 copies of one draw would dress resolution 1-in-2 as
    // 1-in-20 (review finding). Refuse.
    for (const b of listBatches()) {
      if (b.kind === 'historytuning' && b.params && b.params.replayOf === real.id
          && Number(b.params.nullShiftSeed) === seed) {
        throw new Error(`seed ${seed} was already drawn for ${real.id} (${b.id}) — a repeated seed is the same draw twice, not a second draw`);
      }
    }
    // No trail, no null, no claim (owner rule): the draw replays the real
    // run's schedule, and a run that failed to record its trail cannot be
    // replayed honestly.
    if ((real.htRows || []).some((r) => !r.refused && !r.skipped && !r.trailFile)) {
      throw new Error(`${real.id} has passes with missing trail files — no trail, no null, no claim. Investigate the trail-dump failures before drawing.`);
    }
    p = { ...replayParams(real.params), nullShiftSeed: seed, arm: 'null', replayOf: real.id,
      label: params.label || `htnull-s${seed}`, description: params.description || `null draw seed ${seed} of ${real.id} — no verdict alone; selects nothing` };
  } else {
    p = htParams(params);
    p.arm = 'real';
  }
  const claim = { id: 'historytuning-pending', kind: 'historytuning', status: 'running', params: {}, perf: {} };
  activeBatch = claim;
  const release = (err) => { if (activeBatch === claim) { activeBatch = null; } throw err; };
  return htLaunch(p, HT, claim).catch(release);
}

function htLaunch(p, HT, claim) {
  return (async () => {
    // The usable span (ruling B): reserve runs stop at the seal; others stop
    // where the source run's test window began. Computed from the same
    // chunk-building the passes use — no second arithmetic to disagree.
    const { buildCombo, splitBounds } = require('./bracketwork');
    const { chunks } = await buildCombo(p.combo, p.branch, p);
    if (chunks.length < 50) throw new Error(`only ${chunks.length} chunks buildable — not enough history`);
    const src = getBatch(p.sourceBatchId);
    // RULING B needs the SOURCE RUN'S boundaries, not today's: with allLoaded
    // data the cache grows weekly and a recomputed boundary slides into
    // months the source's selection already searched (review finding 9).
    // New boards stamp window boundaries per row; the launch payload carries
    // them and they are authoritative. Fixed-month sources are deterministic
    // and may recompute; allLoaded sources without stamps refuse loudly.
    let usableEndTs;
    if (p.windowStamps && p.windowStamps.testStartTs) {
      usableEndTs = p.windowStamps.testStartTs;
      if (src.params.windowLayout === 'reserve61') {
        if (!p.windowStamps.reserveFromTs) throw new Error('the selected row carries no reserve stamps — re-run the board on the current engine');
        p.reserveFromTs = p.windowStamps.reserveFromTs;
        p.reserveToTs = p.windowStamps.reserveToTs;
      }
    } else if (src.params.allLoaded && !p.splits) {
      throw new Error('this board ran on all-loaded data and its rows carry no window stamps — '
        + 'the selection boundary cannot be recomputed honestly once the cache has grown. '
        + 'Re-run the board on the current engine (rows now stamp their windows) and tune from that.');
    } else if (src.params.windowLayout === 'reserve61') {
      const nReserve = Math.max(2, Math.round(chunks.length * 0.13));
      const preReserve = chunks.length - nReserve;
      const { nTest, nHold } = splitBounds(preReserve, true);
      usableEndTs = chunks[preReserve - nTest - nHold].startTs; // pre-reserve test start
      p.reserveFromTs = chunks[preReserve].startTs;
      p.reserveToTs = chunks[chunks.length - 1].endTs; // one seal meaning: [fromTs, last chunk's endTs]
    } else {
      const { nTest, nHold } = splitBounds(chunks.length, true);
      usableEndTs = chunks[chunks.length - nTest - nHold].startTs;
    }
    if (!p.splits) {
      p.usableStartTs = chunks[0].startTs;
      p.usableEndTs = usableEndTs;
      const geom = HT.splitGeometry(p.usableStartTs, p.usableEndTs);
      if (geom.refusal) throw new Error(geom.refusal);
      p.splits = geom.splits;
      p.windowDays = geom.windowDays;
    }

    const grid = HT.dialGrid();
    // FLOOR AT LAUNCH (ruling D / adopted fix 6): clearance computed from
    // calendar arithmetic BEFORE anything runs; an age arm below the floor on
    // ANY split is excluded from ALL splits and never spends compute.
    const Hlib = require('./history');
    const geoOf = require('./dataset').GEOMETRIES ? null : null; // geo comes from the built chunks below
    const floorPlan = [];
    const starvedAges = new Set();
    for (const age of HT.AGE_SETTINGS) {
      for (const split of p.splits) {
        const trainable = chunks.filter((c) => c.startTs < split.testStartTs); // calendar approximation; the pass applies the full reach purge
        const { effectiveDays } = Hlib.ageWeights(trainable.map((c) => ({ endTs: c.startTs })), split.testStartTs, age.halfLifeDays);
        const refusal = Hlib.floorRefusal(effectiveDays, `${split.name} split, ${age.label}`);
        floorPlan.push({ age: age.key, split: split.name, effectiveDays: Math.round(effectiveDays), refused: !!refusal });
        if (refusal) starvedAges.add(age.key);
      }
    }
    p.floorPlan = floorPlan;
    const liveGrid = grid.filter((g) => !starvedAges.has(g.age.key));
    if (!liveGrid.length) throw new Error(`every age setting fails the training floor at launch — ${JSON.stringify(floorPlan.filter((f) => f.refused))}`);
    const units = [];
    for (const dial of liveGrid) for (const split of p.splits) units.push({ dial, split });

    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
    const slug = (p.label || 'historytuning').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
    const doc = {
      id: `historytuning-${stamp}-${slug}`,
      kind: 'historytuning',
      description: p.description || '',
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      progress: '',
      params: p,
      perf: { unitsDone: 0, unitsTotal: units.length, elapsedMs: 0, etaMs: null, workers: null },
      htRows: [],
      failures: [],
    };
    activeBatch = doc; // takes over the synchronous claim
    if (claim.cancelRequested) { doc.status = 'cancelled'; doc.finishedAt = new Date().toISOString(); activeBatch = null; saveBatch(doc); throw new Error('cancelled by owner during launch'); }
    saveBatch(doc);
    const pool = createPool();
    activePool = pool;
    doc.perf.workers = pool.parallel ? pool.workers.length : 1;
    saveBatch(doc);
    const t0 = Date.now();
    (async () => {
      const payloads = units.map((u) => ({ combo: p.combo, branch: p.branch, dial: u.dial, split: u.split, params: p }));
      await pool.forEach('htPass', payloads, (settled, i) => {
        const u = units[i];
        const key = `${u.dial.age.key}|${u.dial.retune.key}|${u.split.name}`;
        if (settled.ok && settled.value) {
          const res = settled.value;
          let trailFile = null;
          if (res.trail) {
            try {
              const dir = path.join(BATCH_DIR, '..', 'ht', doc.id);
              fs.mkdirSync(dir, { recursive: true });
              const fname = `${key.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`;
              atomicWrite(path.join(dir, fname), JSON.stringify({
                job: doc.id, dial: u.dial, split: { ...u.split }, arm: p.arm || 'real', nullShiftSeed: p.nullShiftSeed || null,
                readingRules: p.readingRules, trail: res.trail,
              }));
              trailFile = fname;
            } catch (err) {
              recordFailure(doc, key, `trail dump: ${err.message}`);
            }
          }
          doc.htRows.push({
            ageKey: u.dial.age.key, retuneKey: u.dial.retune.key, split: u.split.name,
            reference: !!u.dial.reference, refused: res.refused || null, skipped: res.skipped || null,
            testPnl: res.testPnl ?? null, holdPnl: res.holdPnl ?? null, trades: res.trades ?? 0,
            effectiveDays: res.effectiveDays ?? null, retrains: res.retrains ?? 0, retunes: res.retunes ?? 0,
            trailFile,
          });
        } else if (!settled.ok && !doc.cancelRequested) {
          recordFailure(doc, key, settled.error);
        }
        doc.perf.unitsDone++;
        doc.perf.elapsedMs = Date.now() - t0;
        doc.perf.etaMs = doc.perf.unitsDone ? Math.round((doc.perf.elapsedMs / doc.perf.unitsDone) * (units.length - doc.perf.unitsDone)) : null;
        const lastRow = doc.htRows[doc.htRows.length - 1];
        doc.progress = `history tuning ${doc.perf.unitsDone}/${units.length}: ${key}`
          + (lastRow && lastRow.effectiveDays != null ? ` (last: ${Math.round(lastRow.effectiveDays)} eff. days, ${lastRow.retrains} retrains, ${lastRow.retunes} retunes)` : '');
        saveBatch(doc);
      });
      // An arm that failed its floor on ANY split is dropped from ALL splits
      // in the read (adopted review fix 6) — recorded on the doc so the
      // renderer and the audit apply the same exclusion.
      const refusedArms = new Set(doc.htRows.filter((r) => r.refused).map((r) => `${r.ageKey}|${r.retuneKey}`));
      for (const age of [...starvedAges]) for (const g of grid) if (g.age.key === age) refusedArms.add(`${g.age.key}|${g.retune.key}`);
      doc.excludedArms = [...refusedArms];
      doc.status = doc.cancelRequested ? 'cancelled' : 'done';
      doc.finishedAt = new Date().toISOString();
      doc.perf.elapsedMs = Date.now() - t0;
      saveBatch(doc);
      if (activeBatch && activeBatch.id === doc.id) { activeBatch = null; activePool = null; }
      pool.abort();
    })().catch((err) => {
      doc.status = 'error';
      doc.failures.push({ key: 'run', error: err.message });
      saveBatch(doc);
      if (activeBatch && activeBatch.id === doc.id) { activeBatch = null; activePool = null; }
      pool.abort();
    });
    return { batchId: doc.id, units: units.length, splits: p.splits, windowDays: p.windowDays };
  })();
}


// THE RESERVE GRADE — one touch, final (owner design + ruling B). Fires the
// winner's walk, the reference pass's walk, and the declared null draws over
// the sealed reserve as ONE verification event. Refuses if the reserve was
// ever graded before; nothing is ever re-picked from reserve results.
const NULL_DRAWS_RESERVE = 19; // GUESSED (owner-approved); floor 1/20 printed

// EVERY LOOK THIS RUN'S SEALED SLICE HAS HAD, oldest first, with what each one
// said. The launcher counts with it and the History section reads it, so the
// number of looks and their answers come from one place rather than two.
//
// The verdict is not on the picker row, so each prior grade is opened. There
// are never many — and a list nobody can see is how "one, ever" became a rule
// the owner could not weigh.
function reserveGradesFor(sourceId) {
  const out = [];
  for (const b of listBatches()) {
    const bp = b.params || {};
    if (b.kind !== 'historytuning' || bp.mode !== 'reserve-grade' || bp.replayOf !== sourceId) continue;
    const full = getBatch(b.id);
    const v = (full && full.verdict) || null;
    out.push({
      id: b.id,
      look: bp.reserveLook || null,
      status: b.status,
      startedAt: b.startedAt || null,
      passed: v ? !!v.passed : null,
      sentence: v ? (v.sentence || null) : null,
    });
  }
  out.sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
  return out;
}

function startReserveGrade(params) {
  { const stop = launchRefusal(); if (stop) throw new Error(stop); }
  const HT = require('./historytuning');
  const real = getBatch(String(params.sourceHtRunId || ''));
  if (!real || real.kind !== 'historytuning') throw new Error(`unknown History Tuning run '${params.sourceHtRunId}'`);
  if (real.status !== 'done') throw new Error(`${real.id} is ${real.status} — grade finished runs only`);
  if (real.params.arm === 'null') throw new Error('grade the REAL run, not a null draw');
  if (!real.params.reserveFromTs) {
    throw new Error('no reserve exists for this setup: its board run was not a reserve61 layout — '
      + 'the binding grade is the forward paper book (WORKFLOW.md step 7)');
  }
  // HOW MANY TIMES THE SEALED SLICE IS READ IS THE OWNER'S CALL (owner order,
  // 2026-08-23): "this is my system. it doesn't refuse what i want."
  //
  // This used to throw on any second grade of the same run. The reasoning
  // behind it has not changed and is not in dispute: the first grade reads a
  // slice nothing has looked at, and every grade after it reads a slice that
  // HAS now been looked at, so look 2 does not mean what look 1 meant. But
  // that is a fact about what the number says, not a decision the code gets to
  // take. Refusing removed the choice from the owner invisibly, which is the
  // exact fault RULE ZERO and RULE FIVE exist to stop.
  //
  // So it counts instead of refusing. Every grade is stamped with which look it
  // is, every earlier look's verdict travels with it, the reading rule stamped
  // before anything computes says which look this is, and the finished verdict
  // says so too. Nothing is prevented, and no later look can be read back as if
  // it were the first.
  const priorLooks = reserveGradesFor(real.id);
  const look = priorLooks.length + 1;
  // The winner by the STAMPED reading rules: combined test dollars across
  // the three splits, excluded arms out (they refused a floor somewhere).
  const excluded = new Set(real.excludedArms || []);
  const armAgg = new Map();
  for (const r of real.htRows) {
    if (r.refused || r.skipped) continue;
    const k = `${r.ageKey}|${r.retuneKey}`;
    if (excluded.has(k)) continue;
    const cur = armAgg.get(k) || { test: 0, splits: 0 };
    cur.test += r.testPnl || 0;
    cur.splits++;
    armAgg.set(k, cur);
  }
  // The stamped combining rule says SUM ACROSS THE THREE test windows — an
  // arm with a skipped or failed split competes on fewer windows and gets a
  // free pass on its worst one, so it is out (review finding 5).
  const byArm = new Map([...armAgg.entries()].filter(([, v]) => v.splits === 3).map(([k, v]) => [k, v.test]));
  if (!byArm.size) throw new Error('no arm has all three splits scored above the floors — nothing to grade');
  const winnerKey = [...byArm.entries()].sort((a, b2) => b2[1] - a[1])[0][0];
  const [ageKey, retuneKey] = winnerKey.split('|');
  const grid = HT.dialGrid();
  const winnerDial = grid.find((g) => g.age.key === ageKey && g.retune.key === retuneKey);
  const referenceDial = grid.find((g) => g.reference);
  const reserveSplit = {
    name: 'reserve',
    trainStartTs: real.params.usableStartTs,
    testStartTs: real.params.reserveFromTs,
    testEndTs: real.params.reserveFromTs, // empty test window: every dollar is hold
    holdStartTs: real.params.reserveFromTs,
    holdEndTs: real.params.reserveToTs,
  };
  const p = {
    ...replayParams(real.params),
    readingRules: {
      ...real.params.readingRules,
      nullRule: {
        label: 'GUESSED (count) / DERIVED (construction)',
        text: 'RESERVE-GRADE CONSTRUCTION: the 19 null draws replay the WINNER\'S schedule only (not best-of-grid) '
          + 'over the sealed reserve — the grid pick already happened on pre-reserve data the reserve never touched, '
          + 'so the reserve verdict prices the winner\'s own walk, not the grid shopping. The winner must exceed '
          + 'every draw; resolution floor 1 in 20, printed.'
          + (look > 1 ? ` LOOK ${look} OF THIS SLICE: the first grade read data nothing had seen. This one does not — `
            + `it has been read ${priorLooks.length} time(s) already, so the floor above is the best case and the real `
            + 'strength of this reading is weaker by an amount nothing here can measure.' : ''),
      },
    },
    mode: 'reserve-grade', replayOf: real.id, arm: 'real',
    // WHICH LOOK THIS IS, and what the earlier ones said. Stamped into the
    // run's own parameters so the answer can never be separated from how many
    // times the slice had already been read when it was taken.
    reserveLook: look,
    priorReserveLooks: priorLooks,
    usableEndTs: real.params.reserveToTs, // the walk needs the reserve candles
    splits: [reserveSplit],
    winnerKey,
    label: params.label || (look === 1 ? 'reserve-grade' : `reserve-grade-look${look}`),
    description: `reserve grade of ${real.id}, look ${look}: winner ${winnerKey} vs reference vs ${NULL_DRAWS_RESERVE} null draws; `
      + `resolution floor 1 in ${NULL_DRAWS_RESERVE + 1}`
      + (look > 1 ? `. LOOK ${look}: this slice had already been read ${priorLooks.length} time(s) before this grade `
        + `(${priorLooks.map((g) => `${g.id} ${g.passed === null ? g.status : g.passed ? 'PASSED' : 'FAILED'}`).join(', ')}), `
        + 'so it is no longer data nothing has seen.' : ''),
  };
  return htGradeLaunch(p, winnerDial, referenceDial, reserveSplit);
}

function htGradeLaunch(p, winnerDial, referenceDial, split) {
  const units = [
    { dial: winnerDial, split, seed: null, tag: 'winner' },
    { dial: referenceDial, split, seed: null, tag: 'reference' },
  ];
  for (let seed = 1; seed <= NULL_DRAWS_RESERVE; seed++) units.push({ dial: winnerDial, split, seed, tag: `null-s${seed}` });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  const doc = {
    id: `historytuning-${stamp}-${(p.label || 'reserve-grade').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}`,
    kind: 'historytuning',
    description: p.description, status: 'running',
    startedAt: new Date().toISOString(), finishedAt: null, progress: '', params: p,
    perf: { unitsDone: 0, unitsTotal: units.length, elapsedMs: 0, etaMs: null, workers: null },
    htRows: [], failures: [],
  };
  activeBatch = doc;
  saveBatch(doc);
  const pool = createPool();
  activePool = pool;
  doc.perf.workers = pool.parallel ? pool.workers.length : 1;
  saveBatch(doc);
  const t0 = Date.now();
  (async () => {
    const payloads = units.map((u) => ({
      combo: p.combo, branch: p.branch, dial: u.dial, split: u.split,
      params: { ...p, nullShiftSeed: u.seed },
    }));
    await pool.forEach('htPass', payloads, (settled, i) => {
      const u = units[i];
      if (settled.ok && settled.value) {
        const res = settled.value;
        doc.htRows.push({
          ageKey: u.dial.age.key, retuneKey: u.dial.retune.key, split: u.split.name, tag: u.tag,
          nullSeed: u.seed, refused: res.refused || null, skipped: res.skipped || null,
          testPnl: res.testPnl ?? null, holdPnl: res.holdPnl ?? null, trades: res.trades ?? 0,
          effectiveDays: res.effectiveDays ?? null, retrains: res.retrains ?? 0, retunes: res.retunes ?? 0,
        });
      } else if (!settled.ok && !doc.cancelRequested) {
        recordFailure(doc, u.tag, settled.error);
      }
      doc.perf.unitsDone++;
      doc.perf.elapsedMs = Date.now() - t0;
      doc.perf.etaMs = doc.perf.unitsDone ? Math.round((doc.perf.elapsedMs / doc.perf.unitsDone) * (units.length - doc.perf.unitsDone)) : null;
      doc.progress = `reserve grade ${doc.perf.unitsDone}/${units.length}: ${u.tag}`;
      saveBatch(doc);
    });
    // The stamped verdict, computed by the machine through the rules —
    // never re-decided by a reader (owner-approved reading rules).
    const row = (t) => doc.htRows.find((r) => r.tag === t && !r.refused && !r.skipped);
    const w = row('winner');
    const ref = row('reference');
    const nulls = doc.htRows.filter((r) => r.tag && r.tag.startsWith('null-') && !r.refused && !r.skipped);
    if (!w || !ref) {
      doc.verdict = {
        passed: false,
        sentence: `GRADE UNUSABLE: the ${!w ? 'winner' : 'reference'} pass ${!w && !ref ? 'and reference pass ' : ''}refused or failed on the reserve — the one-touch event is spent with nothing provable. Recorded as a dead end.`,
      };
    }
    if (w && ref) {
      const beatsRef = w.holdPnl > ref.holdPnl;
      const nullsAbove = nulls.filter((n) => n.holdPnl >= w.holdPnl).length;
      // WHICH LOOK PRODUCED THIS, in the sentence itself. A stored verdict gets
      // read back months later by somebody who does not have the run's
      // parameters in front of them, and a second look that reads like a first
      // one is a stronger claim than was earned.
      const look = doc.params.reserveLook || 1;
      const lookNote = look > 1
        ? ` LOOK ${look}: this slice had been read ${look - 1} time(s) before this grade, so it was not data nothing had seen and the floor is the best case, not the strength.`
        : '';
      doc.verdict = {
        winnerHoldPnl: w.holdPnl, referenceHoldPnl: ref.holdPnl,
        nullDraws: nulls.length, nullsAtOrAbove: nullsAbove,
        resolutionFloor: `1 in ${nulls.length + 1}`,
        reserveLook: look,
        passed: beatsRef && nullsAbove === 0,
        sentence: (beatsRef && nullsAbove === 0
          ? `PASSED: the winner beat the reference pass on reserve dollars and no null draw matched it (floor 1 in ${nulls.length + 1}).`
          : `FAILED: ${!beatsRef ? 'the winner did not beat the reference pass on the reserve' : `${nullsAbove} of ${nulls.length} null draws matched or beat the winner`} — tuning did not strengthen this survivor. A failed reserve is a dead end, never a hint.`) + lookNote,
      };
    }
    doc.status = doc.cancelRequested ? 'cancelled' : 'done';
    doc.finishedAt = new Date().toISOString();
    doc.perf.elapsedMs = Date.now() - t0;
    saveBatch(doc);
    activeBatch = null;
    activePool = null;
    pool.abort();
  })().catch((err) => {
    doc.status = 'error';
    doc.failures.push({ key: 'run', error: err.message });
    saveBatch(doc);
    activeBatch = null;
    activePool = null;
    pool.abort();
  });
  return doc.id;
}

// A bracket unit end-to-end (build combo, train members, vote, sweep the
// execution menu, take the best cell) lives in bracketwork.unitTask. It is
// NOT duplicated here: the main thread and the workers must run the same
// code or the determinism guarantee is worth nothing.

// A short, human-readable tag derived from what the run actually IS, appended
// to the timestamp so a job list can be read at a glance. Kept to a handful of
// characters and a fixed alphabet: this ends up in a job id that is used as a
// filename (reports/audit-<id>.md) and pasted into shell scripts.
//
// An explicit `label` wins; otherwise it is inferred from the settings, which
// matters because the inferred one cannot drift out of step with the run.
function idSlug(p) {
  const raw = (p.label || '').trim();
  if (raw) {
    const clean = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
    if (clean) return `-${clean}`;
  }
  const bits = [];
  if (p.labelShiftReps > 0) bits.push(`null${p.labelShiftReps}`);
  else if (p.labelShiftFrac) bits.push('null1');
  else bits.push('real');
  if (p.labelShiftScope === 'window') bits.push('win');
  if (p.edgeScreen) bits.push('census');
  if (p.declared) bits.push('declared');
  if (p.trailing) bits.push('trail');
  if (!p.holdout) bits.push('noholdout');
  return `-${bits.join('-')}`;
}

// Menu validators for the settable execution grid. A bad value is an error,
// not a silent fallback — a silently-dropped setting is how "trailing" ran
// off for a week while looking on.
function numMenu(given, dflt, ok) {
  if (given == null) return dflt;
  if (!Array.isArray(given) || !given.length) throw new Error('grid list must be a non-empty array');
  const out = given.map(Number);
  if (out.some((v) => !Number.isFinite(v) || !ok(v))) throw new Error(`bad grid value in [${given}]`);
  return [...new Set(out)].sort((a, b) => a - b);
}
function pickMenu(given, allowed) {
  if (given == null) return allowed;
  if (!Array.isArray(given) || !given.length) throw new Error('menu list must be a non-empty array');
  for (const g of given) if (!allowed.includes(g)) throw new Error(`"${g}" is not one of ${allowed.join('/')}`);
  return [...new Set(given)];
}

// POST-RUN NOTES (owner order, 2026-08-04): a freely editable note stored on
// the run itself — rationale, what was learned, whether to reconsult. Edits
// refuse while the run computes: the orchestrator saves the doc continuously
// and a concurrent note write would be silently overwritten.
function setBatchNotes(id, text) {
  const doc = getBatch(String(id || ''));
  if (!doc) throw new Error('unknown run');
  if (!['bracketlab', 'historytuning', 'walkforward'].includes(doc.kind)) {
    throw new Error('notes live on bracket-lab, History Tuning and walk-forward runs');
  }
  if (doc.status === 'running') throw new Error('the run is still computing — notes save after it finishes');
  doc.notes = String(text ?? '').slice(0, 20000);
  doc.notesEditedAt = new Date().toISOString();
  saveBatch(doc);
  return { id: doc.id, notes: doc.notes, notesEditedAt: doc.notesEditedAt };
}

// RESUMING A SWEEP (owner order, 2026-08-22).
//
// A sweep of any size is a stream of PURE tasks keyed by unit identity, so
// picking one up where it stopped is possible in principle and always has
// been. What makes it worth doing is the length of the runs the owner is now
// launching: a job measured in days that has to start over because the box
// hiccuped in hour forty is not a job anybody will run twice.
//
// What makes it DANGEROUS is the same thing that makes it possible. Half a
// board scored under one set of price files and half under another, or half
// under one version of the arithmetic, is not one board — it is two, added
// together and presented as one. Nothing on the screen would say so. So the
// resume refuses more than it accepts, and every refusal names itself:
//
//   * the engine must be the same version the run started under;
//   * the price files must fingerprint identically to the ones it read;
//   * it must be a sweep, and it must be one that stopped rather than one
//     that finished, was cancelled, or is going now.
//
// A unit that FAILED is not "already done" and gets another go — a failure is
// the one thing worth retrying, and the run kept its record of it either way.
function resumeContents(id) {
  const doc = getBatch(String(id || ''));
  if (!doc) throw new Error(`no run called "${id}"`);
  const why = [];
  if (doc.kind !== 'bracketlab') why.push(`this is a ${doc.kind} run, and only a sweep can be resumed`);
  if (doc.status === 'running') why.push('this run is going right now');
  else if (doc.status === 'done') why.push('this run finished — there is nothing left of it to do');
  else if (doc.status !== 'interrupted' && doc.status !== 'cancelled') {
    why.push(`this run ended as "${doc.status}", and only one that was interrupted or cancelled can be picked up`);
  }
  const stored = (doc.params || {}).engineVersion || null;
  if (doc.kind === 'bracketlab' && stored && stored !== ENGINE_VERSION) {
    why.push(`it ran on engine ${stored} and this box is on ${ENGINE_VERSION} — `
      + 'half a board scored by one version of the arithmetic and half by another is not one board');
  }
  // The price files are checked at the moment of resuming, not here: a
  // fingerprint taken now could be stale by the time anybody presses anything.
  // This only reports whether there is one to check against.
  const haveManifest = !!(doc.dataManifest && doc.dataManifest.overallDigest);
  if (doc.kind === 'bracketlab' && !haveManifest && why.length === 0) {
    why.push('this run never recorded which price files it read, so there is no way to '
      + 'know whether the rest of it would be scored against the same history');
  }
  const doneSlim = keysAlreadyDone(doc, 'slim');
  const donePromote = keysAlreadyDone(doc, 'census');
  const planned = (doc.plan || {}).units || null;
  return {
    id: doc.id,
    status: doc.status,
    phase: (doc.perf || {}).phase || null,
    engineVersion: stored,
    engineNow: ENGINE_VERSION,
    dataFingerprint: haveManifest ? doc.dataManifest.overallDigest.slice(0, 12) : null,
    unitsPlanned: planned,
    unitsScored: doneSlim.size,
    unitsLeft: planned == null ? null : Math.max(0, planned - doneSlim.size),
    promotedScored: donePromote.size,
    // Rows the promote stage recorded before this field existed cannot be
    // matched, so say so rather than quietly scoring them twice.
    // Counted by streaming: on a run with millions of promoted rows, pulling
    // them all in just to count the ones missing a name would cost more than
    // the resume saves.
    promotedUnnamed: countUnnamed(doc),
    failures: (doc.failures || []).length,
    resumes: (doc.resumes || []).length,
    resumable: why.length === 0,
    why,
  };
}

// REPLAYING A STORED RUN'S PARAMETERS (owner order, 2026-08-23).
//
// Three paths hand a finished run's own parameters back to a launcher: picking
// up an interrupted sweep, firing a null draw against a History Tuning run, and
// grading its reserve. Every one of them must price at the cost the original
// paid — a null draw priced differently from the run it is the null OF is not a
// null of anything.
//
// A run recorded before 2026-08-23 stored its fee in DOLLARS on the $100 clip
// and carries no units marker. Handing those params straight back would have
// been the worst kind of failure this change could produce: the launcher's
// safety rail would have CLAMPED $0.125 down to the 5%-a-leg ceiling, so a
// picked-up sweep would finish priced at forty times the fee its first half
// paid, and nothing on any screen would have said so. Normalise before the
// mapping, never after.
function replayParams(params) {
  return { ...params, feePerLeg: feeFracOf(params), feeUnits: 'fraction' };
}

function resumeBracketLab(id) {
  const found = resumeContents(id);
  if (!found.resumable) {
    const err = new Error(`"${found.id}" cannot be picked up: ${found.why.join('; ')}.`);
    err.code = 'NOT_RESUMABLE';
    err.contents = found;
    throw err;
  }
  const doc = getBatch(found.id);
  return startBracketLab(replayParams(doc.params), { resume: doc });
}

// THE PLAN, WITHOUT STARTING ANYTHING (owner order, 2026-08-22).
//
// The owner asked for an honest estimate of what a run will cost BEFORE it is
// launched — memory, disk and time — and the only trustworthy way to count
// what a run will do is to build the same plan the run builds. A second copy
// of this arithmetic living in an estimator would be a second answer to the
// question, and the one that drifted would be the one nobody checked.
//
// So the launcher and the estimate share this. It resolves the grid, validates
// the declared cell against it, expands the declared set, builds the unit list
// including the null copies, and counts. It touches no disk, claims no job slot
// and starts nothing.
function planFor(params, resumeDoc) {
  const resume = resumeDoc || null;
  const grid = {
    dMults: numMenu(params.dMults, bracketLib.D_MULTS, (v) => v > 0 && v <= 10),
    tHours: numMenu(params.tHours, bracketLib.T_HOURS, (v) => Number.isInteger(v) && v > 0 && v <= 500),
    gates: pickMenu(params.gates, bracketLib.GATES),
    entries: pickMenu(params.entries, bracketLib.ENTRIES),
    trailMults: bracketLib.TRAIL_MULTS,
    armMults: bracketLib.ARM_MULTS,
  };
  const declaredSet = params.declared ? expandDeclared(params.declared, params.declaredPermute, grid) : null;
  const p = {
    universe: params.universe && params.universe.length ? params.universe : DEFAULT_PAIRS,
    sizes: { singles: !!params.sizes?.singles, doubles: !!params.sizes?.doubles, triples: !!params.sizes?.triples },
    startMonth: params.startMonth || '2018-01',
    endMonth: params.endMonth || '2026-06',
    allLoaded: !!params.allLoaded,
    permute: { geometry: !!params.permute?.geometry, decision: !!params.permute?.decision, band: !!params.permute?.band, weekdays: !!params.permute?.weekdays },
    set: {
      geometry: GEOS[params.set?.geometry] ? params.set.geometry : 'daily-3d',
      decision: params.set?.decision === 'directional' ? 'directional' : 'argmax',
      band: params.set?.band === 'auto' || params.set?.band === undefined ? 'auto' : Number(params.set.band),
      weekdaysOnly: !!params.set?.weekdaysOnly,
    },
    // The declared SET. With no permute tick this is exactly [declared], so the
    // single path is unchanged; with ticks it is every combination, each one
    // validated by the same rule a single declaration passes through.
    declaredSet,
    // ...and the declared cell IS the first member of that set. With nothing
    // ticked expandDeclared returns exactly [validateDeclared(raw, grid)], so
    // this is byte-identical to validating the base on its own. With ticks on,
    // the base legitimately carries settings that belong to SOME members and
    // not others — rails for the breakout members of a permuted entry, an arm
    // for the moving-stop members of a permuted trail — and validating it as
    // though it were one cell refused launches that were perfectly well formed
    // (owner, 2026-08-22). Every member is still validated, inside expandDeclared.
    declared: declaredSet && declaredSet.length ? declaredSet[0] : null,
    declaredPermute: params.declaredPermute || null,
    // Capped at detailK: the leaderboard only ever holds that many slim rows,
    // so a larger promoteK was a plan number that could not be honoured.
    // Replication mode ignores this entirely and promotes every unit (below).
    promoteK: Math.min(50, Math.max(1, Number(params.promoteK) || 25)),
    minTrades: Math.max(1, Number(params.minTrades) || 10),
    // Per-period call export. Off by default: it is O(periods) per unit, and
    // a 272-combo sweep would bloat the doc for data nobody asked for. On, it
    // is what lets a bracket result seed a paper book or be re-scored later.
    // Trailing stops: a 12x menu widening, so opt-in and promote-stage only.
    trailing: !!params.trailing,
    // Three-way split (70/15/15) with a slice no search ever touches.
    holdout: !!params.holdout,
    // Edge screen: promote every unit and record its edge-selected rung, so
    // the read is a census rather than the money winners.
    edgeScreen: !!params.edgeScreen,
    // Rotate outcomes against features to measure the edge statistic's own
    // null instead of assuming it is a coin flip.
    labelShiftFrac: Number(params.labelShiftFrac) > 0 && Number(params.labelShiftFrac) < 1
      ? Number(params.labelShiftFrac) : null,
    // How many DISTINCT rotations to run in one job. One rotation is a single
    // draw of the null; a null you cannot put an error bar on is barely
    // better than an assumed one.
    // NO CAP (owner, 2026-08-22). The number of draws sets a FLOOR on the
    // strongest claim available: if the real result beats all N draws, the
    // rank-based p is 1/(N+1). Twelve floored that at 0.077 and could not
    // reach the conventional 0.05 at all, so it was raised to 24 — but 24 was
    // still a number this software picked for the owner, and a ceiling on how
    // strong a claim they are allowed to attempt is not the software's to set.
    // The owner's rule: report the cost, and the human decides. The Sweep
    // section now prints what the number costs before Start sweep is pressed
    // — N boards is N+1 passes of the whole run, and any N > 0 also makes
    // promote top K stop applying — which is the honest version of a cap.
    labelShiftReps: Math.max(0, Math.floor(Number(params.labelShiftReps) || 0)),
    // 'window' rotates inside train/search/holdout separately, which holds
    // every window's class balance — and therefore the majority baseline that
    // `edge` is scored against — identical across draws and identical to the
    // unrotated run. 'series' (default) rotates the whole series and does not,
    // so its draws are not comparable to each other or to the real result.
    // Default stays 'series' so previously recorded boards keep their meaning.
    labelShiftScope: params.labelShiftScope === 'window' ? 'window' : 'series',
    // What this run is FOR, in a sentence, and a short tag for its id. Both
    // are stored with the run so intent and identity travel with the numbers.
    description: typeof params.description === 'string' ? params.description.slice(0, 600) : '',
    label: typeof params.label === 'string' ? params.label.slice(0, 40) : '',
    detailK: 50,
    // FEE, SETTABLE. This was hard-coded and therefore unreachable from any
    // launcher — the same class of fault as `trailing` and `holdout` being
    // dropped by the API, and it matters more. Cycle 9's entire result rests
    // on fees: 86% of the gross edge is consumed by them and break-even sits
    // only 16% above the assumed cost. The one dimension the answer depends on
    // could not be varied.
    //
    // A PERCENTAGE OF WHAT IS TRADED, NOT A NUMBER OF DOLLARS (owner order,
    // 2026-08-23). 0.00125 is the 0.125% a leg this system trades at. The old
    // ceiling was 2 — two DOLLARS a leg, which as a rate would be 200% — so the
    // rail moves with the units: nothing at or above 5% a leg is a fee anybody
    // meant, and refusing there is what stops a dollar figure from ever being
    // charged as a rate again.
    //
    // Bounds are a safety rail, not a preference: a zero fee would flatter
    // every result and a silly-large one would make everything look dead.
    feePerLeg: (() => {
      const v = Number(params.feePerLeg);
      // REFUSED, NOT CLAMPED. This used to clamp, and a clamp is how a launch
      // that meant $0.125 would have quietly become 5% a leg — a number with
      // the right shape and forty times the right size. Absent or unreadable
      // still falls back to the lab rate; a real number that is not a real fee
      // is told so by name.
      return Number.isFinite(v) && v >= 0 ? feeRate(v, 'sweep launch: feePerLeg') : FEE_PER_LEG;
    })(),
    // WHICH UNITS THE NUMBER BESIDE THIS IS IN. Runs recorded before
    // 2026-08-23 carry dollars on the $100 paper clip and no marker at all, so
    // the absence of this field is what identifies them. Nothing reads
    // params.feePerLeg straight any more — every reader goes through
    // feeFracOf, which converts an unmarked run rather than rereading $0.125
    // as 12.5% a leg and destroying what its numbers meant.
    feeUnits: 'fraction',
    // The execution grid is SETTABLE (owner audit 2026-07-30). These were
    // constants, unreachable from any launcher — the fault class that hid the
    // fee. Defaults are the identical constants; a run that does not ask for
    // a custom grid is bit-comparable with every board recorded so far.
    dMults: grid.dMults,
    tHours: grid.tHours,
    gates: grid.gates,
    entries: grid.entries,
    trailMults: grid.trailMults,
    armMults: grid.armMults,
    // WINDOW LAYOUT (owner's ruling, 2026-08-03): exactly three explicit
    // options, each naming its splits. 'legacy80' = 80/20 train/test, no
    // hold window. 'split70' = 70/15/15 train/test/hold. 'reserve61' =
    // 61/13/13/13 — the final 13% of history SEALED (never touched by this
    // run) for a later History Tuning winner's binding grade; the remaining
    // 87% gets the 70/15/15 treatment. The old quota layouts
    // (chronological/interlaced/both) are PURGED — the interlaced
    // construction broke the signal it was meant to test (owner order;
    // old docs still display). Unknown values REFUSE loudly: a layout
    // decides what every downstream number means (QC 60).
    windowLayout: (() => {
      if (params.holdout !== undefined && params.windowLayout === undefined) {
        throw new Error("'holdout' is retired (2026-08-03) — the layout decides the hold window. Say windowLayout: 'split70' (70/15/15), 'legacy80' (80/20) or 'reserve61'.");
      }
      if (params.windowLayout === undefined) {
        throw new Error("windowLayout is required: 'legacy80' | 'split70' | 'reserve61' — a layout decides what every downstream number means, so it is never defaulted silently");
      }
      const v = params.windowLayout;
      if (!['legacy80', 'split70', 'reserve61'].includes(v)) {
        throw new Error(`unknown window layout '${v}' — the options are legacy80, split70, reserve61`
          + (['chronological', 'interlaced', 'both', 'legacy'].includes(v)
            ? ` ('${v}' was retired 2026-08-03; old runs remain viewable)` : ''));
      }
      return v;
    })(),
    // Identical stored parameters do not guarantee identical machinery if
    // the code changed between two runs — the comparison surface checks this
    // and warns loudly on mismatch.
    engineVersion: ENGINE_VERSION,
    // The owner's current campaign name rides on every launch (owner order,
    // 2026-08-04) so the saved-runs list groups a cycle's runs at a glance.
    campaign: require('./campaign').getCampaign() || null,
  };
  // A RESUMED RUN IS THE SAME RUN. Two fields are recomputed by the launch
  // path from the world as it is NOW, and both would be wrong here: the
  // campaign in use may have been switched since, and the description is the
  // reason this run exists and does not change because it was picked up.
  if (resume) {
    const was = resume.params || {};
    p.campaign = was.campaign ?? null;
    p.description = was.description || '';
  }
  if (!p.sizes.singles && !p.sizes.doubles && !p.sizes.triples) throw new Error('tick at least one combo size');
  // A declared trail cell only exists when the run computes trail cells:
  // without this, the run finishes and the replication table is empty.
  //
  // ANY MEMBER, not just the first. Permuting trail builds moving-stop members
  // off a base that declares none, so a check that read only the base waved
  // those through to a run that could never find them — hours spent for empty
  // rows. Reading the whole set also keeps this firing now that the declared
  // cell is the set's first member rather than the separately-validated base.
  const declaredTrailCells = (p.declaredSet || (p.declared ? [p.declared] : []))
    .filter((c) => c && c.trailMult != null);
  if (declaredTrailCells.length && !p.trailing) {
    throw new Error('declared.trailMult needs trailing stops ticked on — a run without trail cells can never find the declared cell');
  }
  // PLANTED CHECK plumbing (owner order, 2026-08-03). The fabricated pair is
  // RESERVED: it never meets a real run (its candles carry a known planted
  // rule — any board it sat on would be judging fiction), and a gate run
  // sweeps exactly that one pair through this same front door. The gate's
  // reading rules ride in the params so they are stamped before compute.
  {
    const { PLANTED_SYMBOL, PLANTED_SYMBOLS } = require('./planted');
    p.plantedGate = !!params.plantedGate;
    p.plantedRules = p.plantedGate ? (params.plantedRules || null) : null;
    if (!p.plantedGate && p.universe.some((x) => PLANTED_SYMBOLS.includes(x))) {
      throw new Error(`${p.universe.find((x) => PLANTED_SYMBOLS.includes(x))} is a reserved fabricated pair — it never enters a real run (the planted-check button and the instrument exams are how they are used)`);
    }
    if (p.plantedGate && (p.universe.length !== 1 || p.universe[0] !== PLANTED_SYMBOL)) {
      throw new Error(`a planted-check run sweeps exactly [${PLANTED_SYMBOL}] and nothing else`);
    }
  }
  // SYSTEM-WIDE TRAINING FLOOR (owner ruling): every launch checks it. For
  // undiscounted runs effective days = calendar days, so this is one cheap
  // arithmetic check on the month range. reserve61 trains on 61%, split70 on
  // 70%, legacy80 on 80% of the range.
  {
    const H2 = require('./history');
    const months = p.allLoaded ? null : monthSpan(p.startMonth, p.endMonth);
    // null months (allLoaded or unparseable) => the per-unit chunk checks govern
    if (months != null) {
      const share = p.windowLayout === 'reserve61' ? 0.609 : p.windowLayout === 'split70' ? 0.7 : 0.8;
      const trainDays = months * 30.44 * share;
      const refusal = H2.floorRefusal(trainDays, `${p.windowLayout}: ~${months} loaded months x ${Math.round(share * 100)}% training share`);
      if (refusal) throw new Error(refusal);
    }
  }
  // RULING B: a reserve exists to hold a real exam — print its length, refuse
  // a token one (GUESSED minimum, 8 weeks).
  if (p.windowLayout === 'reserve61' && !p.allLoaded && monthSpan(p.startMonth, p.endMonth) != null) {
    const weeks = Math.round((monthSpan(p.startMonth, p.endMonth) * 30.44 * 0.13) / 7);
    if (weeks < 8) throw new Error(`refused: the sealed reserve would be ~${weeks} weeks — below the 8-week minimum (GUESSED). Load more history.`);
    p.reserveWeeksPlanned = weeks;
  }
  // The layout DECIDES the hold window — no separate checkbox exists any
  // more (owner order: the checkbox-plus-option pairing encoded two splits
  // ambiguously). legacy80 has no hold; split70 and reserve61 do.
  p.holdout = p.windowLayout !== 'legacy80';
  // NULL BOARDS EXIST TO BE READ, and the board-against-null-board reading
  // pairs CENSUS rows — without the census the whole null expansion would
  // compute and then be unreadable (owner caught this from the heading,
  // 2026-08-03: 'Census off' next to '9 null boards'). Same rule the old
  // both-layout jobs had, same reason.
  if (p.labelShiftReps > 0) p.edgeScreen = true;
  const { branches, combos } = expandBracketPlan(p);
  const units = [];
  for (const b of branches) for (const c of combos) units.push({ c, b });
  // Multi-rotation null: the same plan repeated at evenly spaced shifts, each
  // tagged so the census can be grouped by draw. Expanding the unit list is
  // all it takes — the existing pool, ordering and determinism rules apply
  // unchanged.
  if (p.labelShiftReps > 0) {
    const base = units.slice();
    units.length = 0;
    // THE REAL ARM SHIPS WITH ITS OWN NULL. r = 0 is the unscrambled run.
    //
    // This loop used to start at 1, so a multi-scramble job produced nulls and
    // nothing to compare them against. Cycle 8 spent five hours measuring 19
    // scrambles whose real arm had been recorded on an earlier build, by a
    // separate job, before a census change — so there was no comparison at all
    // and the run had to be redone (QC 34).
    //
    // Carrying both arms in ONE job makes that structurally impossible: same
    // build, same data range, same code path, same moment. It is one extra
    // 170-unit slice, which is nothing against a 19-scramble run.
    // REBUILT NULL (register 66, 2026-08-03): the companion boards are no
    // longer label-rotated — members train on real data and each member's
    // calls are dealt onto random days per draw (real vote mix, zero date
    // knowledge). r = 0 stays the real arm.
    for (let r = 0; r <= p.labelShiftReps; r++) {
      for (const u of base) units.push({ ...u, nullDealSeed: r === 0 ? null : r });
    }
  }
  const slimRuns = units.reduce((s, u) => s + slimViewsFor(u.c.size).length, 0);
  return { p, grid, units, slimRuns, branches, combos, declaredSet };
}

function startBracketLab(params, opts) {
  const resume = (opts && opts.resume) || null;
  { const stop = launchRefusal(); if (stop) throw new Error(stop); }
  // The execution grid resolves FIRST so the declared cell can be validated
  // against the grid this run will actually compute (see validateDeclared).
  const { p, units, slimRuns, branches, combos } = planFor(params, resume);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  // HUMAN-MEANINGFUL JOB IDS (owner, 2026-07-29). A wall of timestamps means
  // the only way to tell -2303 from -0041 is to look each one up, which is
  // exactly how their results got attributed to the wrong runs in a report.
  // The slug is APPENDED so every existing consumer still works: scripts
  // filter on the `bracketlab-` prefix and match ids exactly, and the
  // timestamp keeps its position and sort order.
  const fresh = {
    id: `bracketlab-${stamp}${idSlug(p)}`,
    kind: 'bracketlab',
    // A sentence, written when the job is fired, saying what this run is FOR.
    // Stored with the run so the intent survives next to the numbers instead
    // of only in an email thread.
    description: p.description || '',
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: '',
    params: p,
    plan: { branches: branches.length, combos: combos.length, units: units.length, slimRuns, promoteRuns: null },
    perf: { phase: 'slim', unitsDone: 0, unitsTotal: units.length, runsDone: 0, runsTotal: slimRuns, ratePerMin: null, secPerTraining: null, elapsedMs: 0, etaMs: null },
    leaders: [],
    // THE THREE BIG COLLECTIONS LIVE ON DISK (see lib/rowstore.js). What the
    // doc keeps is how many there are; the rows themselves are appended a line
    // at a time and read back by streaming. getBatch hangs non-enumerable
    // getters for `replication`, `edgeCensus` and `slimResults` off the doc, so
    // every existing reader still says doc.edgeCensus and gets an array — and
    // JSON.stringify, which is what made this fatal, does not see them at all.
    rowCounts: { slim: 0, census: 0, replication: 0 },
    failures: [],
    selection: null,
    nullTest: null,
    runs: [], // kept empty by design: at permutation scale, counters + leaders ARE the record
  };
  let doc = fresh;
  // PICKING ONE UP KEEPS EVERYTHING IT ALREADY HAD. Same id, same start time,
  // same board so far, same failures, same description — only the fields that
  // describe "is it going and how far has it got" are reset. Building a fresh
  // doc and copying pieces across would be the same code written twice, and
  // the piece somebody forgot to copy would be the one that mattered.
  if (resume) {
    doc = resume;
    doc.status = 'running';
    doc.finishedAt = null;
    doc.error = null;
    doc.progress = '';
    doc.params = p;
    doc.plan = fresh.plan;
    doc.leaders = doc.leaders || [];
    doc.failures = doc.failures || [];
    // The rows themselves are on disk and are reopened below; a document
    // written before they moved there still carries its own arrays, and the
    // getters in getBatch keep those readable.
    doc.rowCounts = doc.rowCounts || { slim: 0, census: 0, replication: 0 };
    // The counters are recomputed from what is actually RECORDED, never
    // carried over: the stale ones counted failures as done, and a failure is
    // exactly what gets another go.
    doc.perf = {
      ...(doc.perf || {}), phase: 'slim',
      unitsTotal: units.length, runsTotal: slimRuns,
      ratePerMin: null, secPerTraining: null, elapsedMs: 0, etaMs: null,
    };
  }
  activeBatch = doc;
  // The row files, held open for the life of the run. A resumed run reopens
  // the same files and appends: the writers adopt the existing columns and
  // count, so picking a run up carries on one record rather than starting a
  // second, shorter one beside it.
  const rows = openRowStores(doc.id);
  doc.rowCounts = rowCountsFor(doc);
  saveBatch(doc);

  // Symbol maps are built inside the workers (bracketwork.js owns that LRU).
  // This thread only pre-warms the on-disk candle cache below, so it never
  // holds a second copy of the same ~200MB of candles.

  // PARALLEL SWEEP. Each unit is a pure task (bracketwork.unitTask), so the
  // pool runs poolSize at once while ALL doc mutation stays here on the main
  // thread. pool.map preserves input order, and leaderCmp is a total order,
  // so the finished board does not depend on which worker finished first.
  const pool = createPool();
  activePool = pool;
  doc.perf.workers = pool.parallel ? pool.workers.length : 1;
  saveBatch(doc);

  (async () => {
    // PRE-WARM: fetch every symbol this job will touch, serially, on THIS
    // thread. Workers then only ever hit a warm cache — no concurrent
    // fetches, no racing the refresh timers, no silently-dropped month.
    const symbols = [...new Set(p.universe)];
    doc.perf.phase = 'prewarm';
    for (let i = 0; i < symbols.length; i++) {
      if (doc.cancelRequested) break;
      doc.progress = `pre-warming cache ${i + 1}/${symbols.length}: ${symbols[i]}`;
      saveBatch(doc);
      try {
        if (p.allLoaded) await loadSymbolAll(symbols[i], () => {});
        else await loadSymbol(symbols[i], monthList(p.startMonth, p.endMonth), () => {});
      } catch (err) {
        recordFailure(doc, `prewarm:${symbols[i]}`, err.message || String(err));
      }
    }
    // DATA MANIFEST (QC 77): stamp exactly which candle files this run reads,
    // AFTER the prewarm settles the cache and while the cache-write guards
    // hold it frozen for the run's duration. Two runs are data-comparable
    // if and only if their overall digests match.
    const stamped = stampManifest(doc.id, symbols);
    // THE PRICE FILES MUST BE THE ONES IT READ. Checked here and nowhere
    // earlier: the fingerprint is taken after the pre-warm settles the cache,
    // which is the only moment it means anything. A top-up between the two
    // halves of a run would leave the second half reading a longer history
    // than the first, and no number on the finished board would say so.
    if (resume) {
      const was = (resume.dataManifest || {}).overallDigest || null;
      const now = (stamped || {}).overallDigest || null;
      if (!was || !now || was !== now) {
        doc.status = 'interrupted';
        doc.finishedAt = new Date().toISOString();
        doc.error = 'Not picked up: the price files are not the ones this run read. '
          + `It read ${was ? was.slice(0, 12) : '(nothing recorded)'} and the box now holds `
          + `${now ? now.slice(0, 12) : '(unreadable)'}. Scoring the rest against a different history `
          + 'would make half this board answer a different question from the other half. '
          + 'Start it again from the Sweep section instead.';
        doc.progress = '';
        saveBatch(doc);
        if (activeBatch && activeBatch.id === doc.id) { activeBatch = null; activePool = null; }
        pool.abort();
        return;
      }
    }
    doc.dataManifest = stamped;
    doc.perf.phase = 'slim';

    // WHAT IS ALREADY DONE. A unit that produced a record is done; a unit that
    // FAILED produced none and gets another go, which is the one retry worth
    // having. With no resume this set is empty and the two arrays below are
    // the whole unit list, so the ordinary path is unchanged.
    // STREAMED, not materialised. Ten million keys as a Set is fine; ten
    // million row OBJECTS to get at them is the thing this whole change exists
    // to stop. An older run whose rows are still inside the document falls back
    // to reading them from there, because they are all it has.
    const doneSlim = resume ? keysAlreadyDone(doc, 'slim') : new Set();
    const keyOf = (u) => unitFullKey(u.c, u.b, u);
    const slimPending = doneSlim.size ? units.filter((u) => !doneSlim.has(keyOf(u))) : units;
    if (resume) {
      const skipped = units.length - slimPending.length;
      doc.perf.unitsDone = skipped;
      doc.perf.runsDone = units.reduce((n, u) => n + (doneSlim.has(keyOf(u)) ? slimViewsFor(u.c.size).length : 0), 0);
      // ON THE RECORD. A board built over two sittings must say so, or it
      // reads as one uninterrupted run and nobody can tell which it was.
      doc.resumes = doc.resumes || [];
      doc.resumes.push({
        at: new Date().toISOString(),
        skippedUnits: skipped,
        remainingUnits: slimPending.length,
        engineVersion: ENGINE_VERSION,
        dataDigest: (stamped || {}).overallDigest || null,
        retryingFailures: (doc.failures || []).length,
      });
      doc.progress = `picked up where it stopped: ${skipped} unit(s) already scored, ${slimPending.length} to go`;
    }
    saveBatch(doc);

    // THE PARAMETERS GO TO EACH WORKER ONCE, not once per unit. On a run with
    // the replication boxes permuted they hold 1.4 MB of declared configs, and
    // postMessage copies its payload — so carrying them per unit was about
    // 70 GB of copying on the main thread that did no work (owner order,
    // 2026-08-22). The per-unit payload now names them instead.
    pool.setShared('sweepParams', { params: p });
    const slimPayloads = slimPending.map((u) => ({ combo: u.c, branch: u.b, stage: 'slim', sharedKey: 'sweepParams', nullDealSeed: u.nullDealSeed ?? null, ...shiftStance(u) }));
    await pool.forEach('unit', slimPayloads, (settled, i) => {
      // Cancel keeps every COMPLETED result (QC 74): workers are being
      // terminated, but a unit that already finished is computed record and
      // is pushed like any other — only termination errors are skipped.
      const { c, b } = slimPending[i];
      const u = slimPending[i];
      const key = unitFullKey(c, b, u);
      if (settled.ok && settled.value && settled.value.best) {
        const res = settled.value;
        // UNCAPPED slim record (QC 74): the leader list caps at 50 for
        // display, and slim rows beyond it used to vanish. Compact on
        // purpose — the full result lives in the promoted stage.
        rows.slim.push({
          key, trade: c.trade, ctx1: c.ctx1, ctx2: c.ctx2,
          geometry: b.geometry, decision: b.decision, bandPct: res.bandPct,
          nullDealSeed: u.nullDealSeed ?? null,
          pnl: res.best.pnl ?? null, trades: res.best.trades ?? null,
          holdPnl: res.best.holdout ? res.best.holdout.pnl : null,
        });
        pushLeader(doc, {
          key, stage: 'slim',
          trade: c.trade, ctx1: c.ctx1, ctx2: c.ctx2, size: c.size,
          geometry: b.geometry, decision: b.decision, bandMode: b.band,
          bandPct: res.bandPct, weekdaysOnly: b.weekdaysOnly,
          testPeriods: res.testPeriods,
          ...(Object.prototype.hasOwnProperty.call(u, 'shiftFrac') ? { shiftFrac: u.shiftFrac ?? null } : {}),
          ...(u.nullDealSeed != null ? { nullDealSeed: u.nullDealSeed } : {}),
          ...res.best,
        });
      } else if (settled.ok && settled.value && !settled.value.best) {
        rows.slim.push({
          key, trade: c.trade, ctx1: c.ctx1, ctx2: c.ctx2,
          geometry: b.geometry, decision: b.decision,
          nullDealSeed: u.nullDealSeed ?? null,
          pnl: null, trades: null, holdPnl: null,
          noCell: `trained, but no cell reached ${p.minTrades} test trades (QC 74: recorded, not dropped)`,
        });
      } else if (!settled.ok && !doc.cancelRequested) {
        // cancel terminates workers — their termination errors are noise
        recordFailure(doc, key, settled.error);
      }
      doc.perf.unitsDone++;
      doc.perf.runsDone += slimViewsFor(c.size).length;
      doc.progress = `slim ${doc.perf.unitsDone}/${units.length}: ${c.trade}${c.ctx1 ? '+' + c.ctx1 : ''}${c.ctx2 ? '+' + c.ctx2 : ''}`;
      bracketPerfTick(doc);
      doc.rowCounts = rowCountsFor(doc);
      saveProgress(doc);
    });

    // ---- promotion: top-K slim survivors on the full member grid ----
    if (!doc.cancelRequested) {
      const promote = promotionSet(p, doc, units);
      doc.plan.promoteRuns = promote.reduce((s2, l) => s2 + slimViewsFor(l.size).length * 2, 0);
      doc.perf.runsTotal += doc.plan.promoteRuns;
      doc.perf.phase = 'promote';
      // The second pass is picked up the same way as the first, off the census
      // — one row per promoted unit, and now carrying its own key. A run that
      // stopped during promotion had its slim pass filtered to nothing above
      // and arrives here with only the promoted units left to do.
      //
      // Rows written before the census carried a key cannot be matched. Those
      // units are scored again rather than skipped: doing the work twice
      // wastes time, and skipping the wrong one loses a result.
      const donePromote = resume ? keysAlreadyDone(doc, 'census') : new Set();
      const promPending = donePromote.size ? promote.filter((l) => !donePromote.has(l.key)) : promote;
      if (resume && promPending.length !== promote.length) {
        const last = doc.resumes[doc.resumes.length - 1];
        if (last) { last.skippedPromoted = promote.length - promPending.length; }
        doc.progress = `picked up: ${promote.length - promPending.length} already scored in full, ${promPending.length} to go`;
      }
      saveBatch(doc);
      const promPayloads = promPending.map((l) => ({
        combo: { trade: l.trade, ctx1: l.ctx1, ctx2: l.ctx2, size: l.size },
        branch: { geometry: l.geometry, decision: l.decision, band: l.bandMode, weekdaysOnly: l.weekdaysOnly },
        stage: 'promoted', sharedKey: 'sweepParams',
        nullDealSeed: l.nullDealSeed ?? null,
        ...shiftStance(l),
      }));
      await pool.forEach('unit', promPayloads, (settled, i) => {
        // Same rule as the slim stage: cancel never drops a finished result.
        const l = promPending[i];
        if (settled.ok && settled.value) {
          const res = settled.value;
          if (res.best) {
            pushLeader(doc, {
              ...l, stage: 'promoted',
              bandPct: res.bandPct, testPeriods: res.testPeriods,
              windowStamps: res.windowStamps || null,
              ...res.best, declaredCell: res.declared || null,
              // the widest run of neighbouring settings that all made money —
              // a second ranking alongside the best cell, never replacing it
              region: res.region || null,
              // Prediction quality at the EDGE-selected rung, kept apart from
              // the money-selected one above.
              bestEdge: res.bestEdge || null,
            });
          }
          // MEMBER DUMP TO DISK — models (real arm), raw votes, per-member
          // scores. Written for EVERY promoted unit regardless of edgeScreen:
          // "time is more valuable than storage" (owner, 2026-07-30). Never
          // into the doc — the doc is served over HTTP and stays light.
          let modelFile = null;
          if (res.memberDump) {
            try {
              const dir = path.join(BATCH_DIR, '..', 'models', doc.id);
              fs.mkdirSync(dir, { recursive: true });
              const tag = l.nullDealSeed != null ? `n${l.nullDealSeed}` : (l.shiftFrac == null ? 'real' : `s${l.shiftFrac.toFixed(3)}`);
              const fname = `${l.key.replace(/[^A-Za-z0-9._-]+/g, '_')}-${tag}.json`;
              atomicWrite(path.join(dir, fname), JSON.stringify({
                job: doc.id, key: l.key,
                trade: l.trade, ctx1: l.ctx1, ctx2: l.ctx2,
                geometry: l.geometry, decision: l.decision,
                weekdaysOnly: l.weekdaysOnly ?? null,
                // The fee is written into the dump as a FRACTION and says so,
                // so a dump can never be re-read under the wrong units.
                params: { holdout: p.holdout, feePerLeg: feeFracOf(p), feeUnits: 'fraction', labelShiftScope: p.labelShiftScope },
                best: res.best ? {
                  entry: res.best.entry || 'breakout', gate: res.best.gate ?? null,
                  dMult: res.best.dMult ?? null, tHours: res.best.tHours ?? null,
                  trailMult: res.best.trailMult ?? null, armMult: res.best.armMult ?? null,
                  quorum: res.best.quorum ?? null,
                } : null,
                ...res.memberDump,
              }));
              modelFile = `models/${doc.id}/${fname}`;
              doc.modelFiles = (doc.modelFiles || 0) + 1;
            } catch (err) {
              // A failed save must be VISIBLE, not silent — a dump everyone
              // believes exists is worse than none.
              recordFailure(doc, l.key, `model dump: ${err.message}`);
            }
            delete res.memberDump;
          }
          if (res.best || res.bestEdge) {
            // Census row for EVERY promoted unit, kept OFF the leaderboard so
            // nothing about it is conditioned on P&L. QC 74 (owner law,
            // 2026-08-04): computed records are NEVER deleted — the capped
            // leader list is display only, this is the record. Previously
            // only edge-screen runs wrote census rows, so a discovery run's
            // promoted results beyond the display cap simply vanished.
            rows.census.push({
              trade: l.trade, ctx1: l.ctx1, ctx2: l.ctx2,
              geometry: l.geometry, decision: l.decision, bandPct: res.bandPct,
              // WINDOW STAMPS on the UNCAPPED record (QC 73, 2026-08-04):
              // they lived only on the capped leader list, so any row pushed
              // past the cap lost the one field History Tuning must trust.
              // A capped list is a lossy record; nothing authoritative may
              // live only there.
              windowStamps: res.windowStamps || null,
              // WHICH branch produced this row, for the permuted dimensions
              // that are not already stored per-row: census-backed selection
              // needs them (rows without these refuse selection when the
              // dimension was permuted).
              bandMode: l.bandMode ?? null, weekdaysOnly: l.weekdaysOnly ?? null,
              shiftFrac: l.shiftFrac ?? null,
              nullDealSeed: l.nullDealSeed ?? null,
              // THE ROW'S OWN NAME (owner, 2026-08-22). Every other record of
              // a unit carries its key and this one did not, so a resumed run
              // had no way to tell which promoted units were already done and
              // would have scored them all again. A record that cannot say
              // which unit it is, is a record only its neighbours can place.
              key: l.key,
              shiftScope: p.labelShiftScope || 'series',
              // WINDOW LAYOUT this row was measured under — a comparison row
              // that cannot say which geometry produced it is not comparable to
              // anything. The stored parameters are the truth: the alternative
              // source was the retired quota layouts, which stopped producing
              // anything long before their code was removed.
              windowLayout: p.windowLayout || 'legacy',
              holdPeriods: res.best && res.best.holdout ? res.best.holdout.periods : null,
              searchPeriods: res.testPeriods ?? null,
              // THE YARDSTICK, recorded alongside the score. edge = accuracy -
              // majorityBaseline, so a draw measured against a softer baseline
              // posts positive edge more easily with no change in skill. Under
              // series-scope rotation that baseline moved 15 points across
              // draws, which made the pooled null a mixture rather than a null.
              // Storing it means any future census can be read conditionally
              // instead of taken on trust.
              holdBaseline: res.bestEdge && res.bestEdge.holdoutMetrics ? res.bestEdge.holdoutMetrics.majorityBaseline : null,
              holdBestConst: res.bestEdge && res.bestEdge.holdoutMetrics ? res.bestEdge.holdoutMetrics.bestConstant : null,
              searchBaseline: res.bestEdge && res.bestEdge.metrics ? res.bestEdge.metrics.majorityBaseline : null,
              quorum: res.bestEdge ? res.bestEdge.quorum : (res.best ? res.best.quorum : null),
              members: res.bestEdge ? res.bestEdge.members : (res.members ?? null),
              searchEdge: res.bestEdge && res.bestEdge.metrics ? res.bestEdge.metrics.edge : null,
              searchAcc: res.bestEdge && res.bestEdge.metrics ? res.bestEdge.metrics.testAcc : null,
              holdEdge: res.bestEdge && res.bestEdge.holdoutMetrics ? res.bestEdge.holdoutMetrics.edge : null,
              holdAcc: res.bestEdge && res.bestEdge.holdoutMetrics ? res.bestEdge.holdoutMetrics.testAcc : null,
              holdDirHits: res.bestEdge && res.bestEdge.holdoutMetrics ? res.bestEdge.holdoutMetrics.directionalHits : null,
              holdDirCalls: res.bestEdge && res.bestEdge.holdoutMetrics ? res.bestEdge.holdoutMetrics.directionalCalls : null,
              // THE MONEY ARM. Accuracy counts a wrong call identically
              // whether the market went nowhere or hard the other way; P&L
              // does not. A system can be right more often than noise and
              // still lose, if its mistakes are larger than its wins — so
              // money needs its own census and cannot be inferred from the
              // accuracy one.
              //
              // These come from the cell chosen on the SEARCH window and
              // scored once on the holdout, so they are out-of-sample. They
              // are recorded for EVERY unit and never money-ranked: reading
              // money off the leaderboard is the selection fault that
              // invalidated the first edge screen (job -2158).
              holdPnl: res.best && res.best.holdout ? res.best.holdout.pnl : null,
              holdTrades: res.best && res.best.holdout ? res.best.holdout.trades : null,
              holdWins: res.best && res.best.holdout ? res.best.holdout.wins : null,
              holdGrossPerTrade: res.best && res.best.holdout ? res.best.holdout.grossPerTrade : null,
              // Doing nothing clever, on the same slice, so "did it beat just
              // holding" is answerable rather than assumed.
              holdAlwaysLong: res.best && res.best.holdout && res.best.holdout.holds
                ? res.best.holdout.holds.alwaysLong : null,
              holdBuyHold: res.best && res.best.holdout && res.best.holdout.holds
                ? res.best.holdout.holds.buyHold : null,
              // THE SETTINGS THAT EARNED THE MONEY, recorded every time.
              //
              // The census stored what each setup made but not WHICH execution
              // settings made it, so a suspicious figure could not be traced to
              // the trade that caused it. The winning settings appeared only on
              // the profit-ranked leaderboard, which is capped and therefore
              // excludes exactly the setups worth investigating.
              //
              // Cost of that gap: cycle 11's four worst setups averaged losses
              // per trade up to 4x the widest stop on the menu. Whether that is
              // unprotected market entry (legitimate — market cells carry no
              // stop rails) or a pricing fault could not be determined from the
              // record at all, only by re-running.
              cellEntry: res.best ? (res.best.entry || 'breakout') : null,
              cellGate: res.best ? (res.best.gate ?? null) : null,
              cellDMult: res.best ? (res.best.dMult ?? null) : null,
              cellTHours: res.best ? (res.best.tHours ?? null) : null,
              cellTrailMult: res.best ? (res.best.trailMult ?? null) : null,
              cellArmMult: res.best ? (res.best.armMult ?? null) : null,
              cellQuorum: res.best ? (res.best.quorum ?? null) : null,
              // BOTH WINDOWS, EVERY SETUP, UNCAPPED (owner, 2026-07-30).
              // These lived only on the profit-ranked, capped leaderboard, so
              // the worst setups — the ones worth investigating — lost theirs.
              // Display may stay capped; storage must not be.
              searchPnl: res.best ? (res.best.pnl ?? null) : null,
              searchTrades: res.best ? (res.best.trades ?? null) : null,
              searchWins: res.best ? (res.best.wins ?? null) : null,
              searchGrossPerTrade: res.best ? (res.best.grossPerTrade ?? null) : null,
              searchStops: res.best ? (res.best.stops ?? null) : null,
              vsControl: res.best && res.best.controlPnl != null ? res.best.pnl - res.best.controlPnl : null,
              holdStops: res.best && res.best.holdout ? (res.best.holdout.stops ?? null) : null,
              modelFile: modelFile,
              // How much of the result rests on an unknowable within-bar
              // ordering. Meaningless to report money without it.
              cellAmbiguous: res.best && res.best.holdout
                ? (res.best.holdout.ambiguous ?? null) : null,
            });
          } else {
            // No qualifying cell at all: still a record (QC 74).
            
            rows.census.push({
              trade: l.trade, ctx1: l.ctx1, ctx2: l.ctx2,
              geometry: l.geometry, decision: l.decision, bandPct: res.bandPct ?? null,
              bandMode: l.bandMode ?? null, weekdaysOnly: l.weekdaysOnly ?? null,
              shiftFrac: l.shiftFrac ?? null, nullDealSeed: l.nullDealSeed ?? null,
              windowLayout: p.windowLayout || 'legacy',
              windowStamps: res.windowStamps || null,
              noCell: `no execution cell reached ${p.minTrades} test trades — recorded so the denominator stays honest (QC 74)`,
              holdPnl: null, searchPnl: null,
            });
          }
          if (res.declared) {
            // One row per (asset, declared config). With no permute tick there is
            // exactly one config and this is the single row it always was; the
            // label rides along so the table can group when there are many.
            const repRows = (res.declaredSet && res.declaredSet.length)
              ? res.declaredSet.filter((x) => x.cell).map((x) => ({ d: x.cell, label: x.label }))
              : [{ d: res.declared, label: (p.declared && p.declared.label) || null }];
            for (const { d, label: declaredLabel } of repRows) {
            rows.replication.push({
              declaredLabel,
              // WHICH COPY scored this row. Without the tag, real and
              // null-copy declared scores were indistinguishable and the
              // cross-coin count mixed them 1:9 (owner's run exposed it,
              // 2026-08-04 — QC 72).
              nullDealSeed: l.nullDealSeed ?? null,
              trade: l.trade, ctx1: l.ctx1, ctx2: l.ctx2, geometry: l.geometry, bandPct: res.bandPct,
              // The stored parameters are the truth. The alternative source
              // was the retired quota layouts, whose fallback stamped 'legacy'
              // on split70 and reserve61 rows (review 2026-08-03).
              windowLayout: p.windowLayout || 'legacy',
              entry: d.entry || 'breakout',
              quorum: d.quorum, members: d.members, pnl: d.pnl, trades: d.trades, wins: d.wins,
              grossPerTrade: d.grossPerTrade, stops: d.stops, ambiguous: d.ambiguous,
              controlPnl: d.controlPnl, vsControl: d.controlPnl == null ? null : d.pnl - d.controlPnl,
              metrics: d.metrics || null,
              holds: d.holds || null,
              trailMult: d.trailMult ?? null, armMult: d.armMult ?? null,
              trailAmbiguous: d.trailAmbiguous ?? 0,
              holdout: d.holdout || null,
              vsAlwaysLong: d.holds ? d.pnl - d.holds.alwaysLong : null,
              vsBuyHold: d.holds && d.holds.buyHold != null ? d.pnl - d.holds.buyHold : null,
            });
            }
            // NO SORT HERE ANY MORE. This re-sorted the whole collection after
            // every unit — at the owner's scale, sorting ten million rows fifty
            // thousand times. Ordering is a question the reader asks once, and
            // the reader now asks it of the aggregate, not of every row.
          }
        } else if (!settled.ok && !doc.cancelRequested) {
          // REMOVED 2026-08-22: a branch sat here for a promoted unit that
          // trained and reached no cell. It could never run — its condition was
          // a subset of the one above it, which had already taken every case it
          // could apply to — and if it ever had run it would have thrown, since
          // it named variables belonging to the first pass, and written into the
          // first pass's collection.
          //
          // The case it was meant to cover is covered, a few lines up: when a
          // promoted unit comes back with neither a money cell nor an edge one,
          // a census row is written saying no cell reached the trade floor, so
          // the denominator stays honest (QC 74). Nothing was being lost. What
          // was here was a duplicate of that, written wrong, in a place it could
          // not reach — and leaving it would have gone on looking like a gap.
          recordFailure(doc, l.key + '|promote', settled.error);
        }
        doc.perf.runsDone += slimViewsFor(l.size).length * 2;
        doc.progress = `promote ${i + 1}/${promote.length}: ${l.trade}${l.ctx1 ? '+' + l.ctx1 : ''}`;
        bracketPerfTick(doc);
        saveProgress(doc);
      });
    }
    pool.abort();
    if (activePool === pool) activePool = null;
    // THE LAST ROWS REACH DISK BEFORE THE RUN IS CALLED DONE. Writes are
    // batched, so up to a few hundred rows are still in hand at this point;
    // closing flushes them and stamps the sidecar with the final count.
    closeRowStores();
    doc.rowCounts = rowCountsFor(doc);
    doc.rowBytes = rowstore.bytes(doc.id);
    // HOW FAST THIS BOX ACTUALLY WENT. The pre-launch estimate is only worth
    // reading because finished runs leave this behind; without it there is no
    // honest time figure and the screen says so rather than inventing one.
    try { require('./estimate').recordRate(doc); } catch (_) { /* the estimate degrades, the run does not */ }
    doc.status = doc.cancelRequested ? 'cancelled' : 'done';
    doc.perf.phase = 'done';
    doc.finishedAt = new Date().toISOString();
    doc.progress = '';
    saveBatch(doc);
  })().catch((err) => {
    try { pool.abort(); } catch { /* gone */ }
    if (activePool === pool) activePool = null;
    // A run that failed keeps everything it managed to record (QC 74), so the
    // rows are flushed on this path too — not only on the happy one.
    closeRowStores();
    doc.rowCounts = rowCountsFor(doc);
    doc.status = 'error';
    doc.error = err.message || String(err);
    doc.finishedAt = new Date().toISOString();
    saveBatch(doc);
  });
  return doc.id;
}

// Stage-2 selection: pin one leader row (by its key + stage) for the null.
function bracketSelect(id, patch) {
  const doc = getBatch(id);
  if (!doc || doc.kind !== 'bracketlab') throw new Error('unknown bracket-lab run');
  if (doc.status === 'running') throw new Error('sweep is still running');
  // CLEARING A SELECTION (owner, 2026-08-18). A row could be selected and never
  // unselected: nothing anywhere in the tab took a selection off a run. That is
  // not a cosmetic gap — a stored selection changes what other screens offer and
  // aim at, so a state the owner cannot leave is a state that quietly steers
  // later decisions. Clearing archives the null test the same way selecting a
  // different row does, because that test belonged to the selection being left.
  if (patch && patch.clear) {
    archivePrior(doc, 'nullTest', doc.nullTest);
    doc.selection = null;
    doc.nullTest = null;
    saveBatch(doc);
    return doc;
  }
  const row = doc.leaders.find((l) => l.key === patch.key && l.stage === (patch.stage || 'promoted'));
  if (row) {
    archivePrior(doc, 'nullTest', doc.nullTest);
    doc.selection = row;
    doc.nullTest = null;
    saveBatch(doc);
    return doc;
  }
  // CENSUS-BACKED SELECTION (owner order, 2026-08-04). Null copies used to
  // eat the 50 capped leader slots, crowding real setups off the stored
  // board; the display now rebuilds the board from the census, so a row can
  // be on screen without a leader entry behind it. The census row carries
  // everything the null replay and History Tuning need — except, on rows
  // recorded before 1.34.0, which BAND / 24-5 branch produced it, so those
  // fall back to the run's fixed setting and REFUSE when that dimension was
  // permuted (guessing the branch would test a different setup).
  if (String(patch.key || '').startsWith('census|')) {
    const [, trade, ctx1, ctx2, geometry, decision] = String(patch.key).split('|');
    const r = (doc.edgeCensus || []).find((x) => x.nullDealSeed == null && !x.shiftFrac
      && x.trade === trade && (x.ctx1 || '') === ctx1 && (x.ctx2 || '') === ctx2
      && x.geometry === geometry && x.decision === decision);
    if (!r) throw new Error('setup not found in this run\'s census');
    const p = doc.params || {};
    const bandMode = r.bandMode ?? (p.permute && p.permute.band ? null : ((p.set && p.set.band) ?? 'auto'));
    if (bandMode == null) {
      throw new Error('this run permuted the band and its rows (recorded before 1.34.0) do not say which band branch each row used — re-run the sweep to select this row');
    }
    const weekdaysOnly = r.weekdaysOnly ?? (p.permute && p.permute.weekdays ? null : !!(p.set && p.set.weekdaysOnly));
    if (weekdaysOnly == null) {
      throw new Error('this run permuted 24/5 and its rows (recorded before 1.34.0) do not say which branch each row used — re-run the sweep to select this row');
    }
    doc.selection = {
      key: patch.key, stage: 'promoted', fromCensus: true,
      trade, ctx1: ctx1 || null, ctx2: ctx2 || null, size: 1 + (ctx1 ? 1 : 0) + (ctx2 ? 1 : 0),
      geometry, decision, bandMode, weekdaysOnly, bandPct: r.bandPct ?? null,
      quorum: r.cellQuorum, members: r.members ?? null,
      gate: r.cellGate, entry: r.cellEntry, dMult: r.cellDMult, tHours: r.cellTHours,
      trailMult: r.cellTrailMult ?? null, armMult: r.cellArmMult ?? null,
      pnl: r.searchPnl ?? null, trades: r.searchTrades ?? null,
      holdout: r.holdPnl != null ? { pnl: r.holdPnl, trades: r.holdTrades ?? null } : null,
      windowStamps: r.windowStamps ?? null,
    };
    archivePrior(doc, 'nullTest', doc.nullTest); // QC 74: same rule as the leader branch above
    doc.nullTest = null;
    saveBatch(doc);
    return doc;
  }
  throw new Error('unknown leader row (promoted rows are the null candidates)');
}

// Null replay for the selected survivor: per rotation, retrain the unit's
// full member grid on rotated labels and give the null EVERY freedom the
// real machine had downstream of the combo — the whole execution menu and
// all quorum rungs, best cell taken by the same declared rule. Also scores
// the selected config's own cell for the conditional reading. Live tables.
function startBracketNull(id, shifts) {
  { const stop = launchRefusal(); if (stop) throw new Error(stop); }
  const doc = getBatch(id);
  if (!doc || doc.kind !== 'bracketlab') throw new Error('unknown bracket-lab run');
  const sel = doc.selection;
  if (!sel) throw new Error('select a promoted leader row first');
  const nShifts = Math.min(1000, Math.max(1, Math.floor(Number(shifts) || 0)));
  const p = doc.params;
  archivePrior(doc, 'nullTest', doc.nullTest); // QC 74: re-fire archives, never destroys
  doc.status = 'running';
  doc.cancelRequested = false;
  doc.perf.phase = 'null';
  doc.perf.runsTotal += nShifts * slimViewsFor(sel.size).length * 2;
  doc.nullTest = { status: 'running', requestedShifts: nShifts, startedAt: new Date().toISOString(), real: { pnl: sel.pnl, trades: sel.trades }, samples: {}, shifts: 0, exceedSearch: null, exceedSame: null, medianBestPnl: null, medianSamePnl: null };
  activeBatch = doc;
  saveBatch(doc);

  // No map cache here any more: every rotation builds its own maps inside the
  // worker (bracketwork.js owns that LRU now), so a copy on this thread would
  // be a second ~200MB of the same candles doing nothing.
  const c = { trade: sel.trade, ctx1: sel.ctx1, ctx2: sel.ctx2, size: sel.size };
  const b = { geometry: sel.geometry, decision: sel.decision, band: sel.bandMode, weekdaysOnly: sel.weekdaysOnly };

  // PARALLEL NULL REPLAY — the biggest win available. Rotations share
  // nothing: each retrains the full member grid on its own rotated world and
  // returns one sample. Samples stay keyed by EFFECTIVE rotation so duplicates
  // still collapse, and the exceed arithmetic is pure counting, hence
  // order-independent. The live table keeps filling in as rotations land.
  const pool = createPool();
  activePool = pool;
  doc.perf.workers = pool.parallel ? pool.workers.length : 1;
  saveBatch(doc);

  (async () => {
    // PRE-WARM (see the sweep path): workers must only read the candle cache.
    doc.perf.phase = 'prewarm';
    for (const sym of [c.trade, c.ctx1, c.ctx2].filter(Boolean)) {
      if (doc.cancelRequested) break;
      doc.progress = `pre-warming cache: ${sym}`;
      saveBatch(doc);
      try {
        if (p.allLoaded) await loadSymbolAll(sym, () => {});
        else await loadSymbol(sym, monthList(p.startMonth, p.endMonth), () => {});
      } catch (err) {
        recordFailure(doc, `prewarm:${sym}`, err.message || String(err));
      }
    }
    // The null replay reads the cache at ITS OWN fire time, which may be
    // days after the original board — so it gets its own stamp (QC 77).
    doc.nullTest.dataManifest = stampManifest(`${doc.id}-null-${Date.now().toString(36)}`, [c.trade, c.ctx1, c.ctx2].filter(Boolean));
    doc.perf.phase = 'null';
    saveBatch(doc);

    const payloads = [];
    for (let s2 = 1; s2 <= nShifts; s2++) {
      payloads.push({ combo: c, branch: b, params: p, shiftIndex: s2, nShifts, selection: sel });
    }
    let doneCount = 0;
    await pool.forEach('nullRotation', payloads, (settled, i) => {
      // Same rule as the sweep stages: cancel never drops a finished
      // rotation — each one banked is a null draw paid for (QC 74).
      doneCount++;
      if (settled.ok && settled.value) {
        const r = settled.value;
        doc.nullTest.samples[r.shiftIndex] = { best: r.best, same: r.same, sameTrades: r.sameTrades };
        const vals = Object.values(doc.nullTest.samples);
        doc.nullTest.shifts = vals.length;
        doc.nullTest.exceedSearch = vals.filter((x) => x.best >= sel.pnl).length / vals.length;
        const sames = vals.filter((x) => x.same != null);
        doc.nullTest.exceedSame = sames.length ? sames.filter((x) => x.same >= sel.pnl).length / sames.length : null;
        doc.nullTest.medianBestPnl = median(vals.map((x) => (x.best === -Infinity ? 0 : x.best)));
        doc.nullTest.medianSamePnl = sames.length ? median(sames.map((x) => x.same)) : null;
      } else if (!settled.ok && !doc.cancelRequested) {
        // cancel terminates workers — their termination errors are noise
        recordFailure(doc, `null-shift-${i + 1}`, settled.error);
      }
      doc.perf.runsDone += slimViewsFor(c.size).length * 2;
      doc.progress = `null ${doneCount}/${nShifts} (${doc.nullTest.shifts} distinct banked)`;
      bracketPerfTick(doc);
      doc.rowCounts = rowCountsFor(doc);
      saveProgress(doc);
    });
    pool.abort();
    if (activePool === pool) activePool = null;
    if (doc.cancelRequested) {
      // A cancelled SERIAL null banked rotations 1..k — a prefix. A cancelled
      // PARALLEL null banks whatever the lanes had finished, which is a
      // scattered subset of 1..requested. The exceed rate is still an honest
      // estimate over the rotations it holds, but the record must not let a
      // later reader assume a prefix.
      doc.nullTest.partial = {
        banked: doc.nullTest.shifts,
        dispatched: doneCount,
        requested: nShifts,
        contiguous: false,
        note: 'cancelled mid-run; banked rotations are a scattered subset of 1..requested, not a prefix',
      };
    }
    doc.nullTest.status = doc.cancelRequested ? 'cancelled' : 'done';
    doc.nullTest.finishedAt = new Date().toISOString();
    doc.status = doc.cancelRequested ? 'cancelled' : 'done';
    doc.perf.phase = 'done';
    doc.progress = '';
    saveBatch(doc);
  })().catch((err) => {
    try { pool.abort(); } catch { /* gone */ }
    if (activePool === pool) activePool = null;
    doc.nullTest = { ...(doc.nullTest || {}), status: 'error', error: err.message || String(err) };
    doc.status = 'error';
    doc.error = err.message || String(err);
    saveBatch(doc);
  });
  return { started: true, shifts: nShifts };
}


// ---- HISTORY TUNING v2: the paired age-dial instrument (DESIGN-HT2.md) -----
// One pre-declared half-life vs the reference, ~20 paired folds, frozen
// cell, sign-flip null on every verdict. Entrance exams on the two
// fabricated pairs gate real use (R4).
function startHtTwo(params) {
  { const stop = launchRefusal(); if (stop) throw new Error(stop); }
  const T2 = require('./httwo');
  const planted = require('./planted');
  const halfLifeKey = String(params.halfLifeKey || '12mo');
  if (!T2.HALF_LIVES[halfLifeKey]) throw new Error(`halfLifeKey must be one of ${Object.keys(T2.HALF_LIVES).join('/')}`);
  let p;
  if (params.examPair) {
    const pair = String(params.examPair).toUpperCase();
    if (!planted.PLANTED_SYMBOLS.includes(pair)) throw new Error('examPair must be one of the reserved fabricated pairs');
    if (!planted.plantedExists(pair)) {
      if (pair === planted.PLANTED_LATE_SYMBOL) planted.generatePlantedLate(planted.plantedSpan());
      else planted.generatePlanted(planted.plantedSpan());
    }
    p = {
      exam: true,
      combo: { trade: pair, ctx1: null, ctx2: null, size: 1 },
      branch: { geometry: 'daily-1d', decision: 'argmax', band: 'auto', weekdaysOnly: false },
      // The exam cell mirrors the planted gate's own winning shape — a fixed
      // recipe, never shopped: 3-of-6 agreement, direction gate, market
      // entry, 17h hold. bandPct is calibrated on the pre-fold era at launch.
      declaredCell: { quorum: 3, gate: 'directional', entry: 'market', dMult: null, tHours: 17, trailMult: null, armMult: null, bandPct: null },
      allLoaded: true, startMonth: null, endMonth: null,
      feePerLeg: FEE_PER_LEG, feeUnits: 'fraction',
      label: params.label || (pair === planted.PLANTED_LATE_SYMBOL ? 'ht2-exam-a-late' : 'ht2-exam-b-flat'),
      description: `HT v2 entrance exam on ${pair} — known answer: age-weighting must ${pair === planted.PLANTED_LATE_SYMBOL ? 'WIN (the rule lives only in the final third)' : 'FIND NOTHING (the rule is uniform over all history)'}`,
    };
  } else {
    const src = getBatch(String(params.sourceBatchId || ''));
    if (!src || src.kind !== 'bracketlab') throw new Error('sourceBatchId must name a finished bracket-lab run');
    if (src.status !== 'done') throw new Error(`${src.id} is ${src.status} — tune finished boards only`);
    const sel = src.selection;
    if (!sel) throw new Error('select a promoted row on the source run first');
    const status = T2.examStatus(ENGINE_VERSION, listBatches().map((b) => getBatch(b.id)).filter(Boolean));
    if (!status.ready) throw new Error(`refused (R4): ${status.detail}`);
    if (sel.gate === 'always') throw new Error('this row uses the always gate — the age dial would act on nothing');
    if (sel.geometry === 'weekly-8d') throw new Error('weekly-8d is structurally out — the effective-days arithmetic is day-stepped');
    if (!sel.windowStamps || !sel.windowStamps.testStartTs) throw new Error('the selected row carries no window stamps — re-run the board on the current engine');
    p = {
      exam: false,
      sourceBatchId: src.id,
      combo: { trade: sel.trade, ctx1: sel.ctx1 || null, ctx2: sel.ctx2 || null, size: sel.size },
      branch: { geometry: sel.geometry, decision: sel.decision, band: sel.bandMode, weekdaysOnly: sel.weekdaysOnly },
      declaredCell: { quorum: sel.quorum, gate: sel.gate, entry: sel.entry, dMult: sel.dMult ?? null, tHours: sel.tHours, trailMult: sel.trailMult ?? null, armMult: sel.armMult ?? null, bandPct: sel.bandPct },
      windowStamps: sel.windowStamps,
      allLoaded: src.params.allLoaded, startMonth: src.params.startMonth, endMonth: src.params.endMonth,
      // The source run's fee, normalised to a fraction — a run recorded before
      // 2026-08-23 stored dollars on the $100 clip, and the paired arms have to
      // be priced at the cost the board was found under.
      feePerLeg: feeFracOf(src.params), feeUnits: 'fraction',
      label: params.label || `ht2-${halfLifeKey}-${sel.trade.toLowerCase()}`,
      description: params.description || `HT v2 paired: ${halfLifeKey} half-life vs reference on ${sel.trade} ${sel.geometry} ${sel.decision} q${sel.quorum}. Hypothesis origin: the v1 design read (curtain opened 2026-08-04) — contaminated for selection, cited as origin only.`,
    };
  }
  p.halfLifeKey = halfLifeKey;
  p.halfLifeDays = T2.HALF_LIVES[halfLifeKey];
  p.campaign = require('./campaign').getCampaign() || null;
  p.engineVersion = ENGINE_VERSION;
  p.readingRules = T2.READING_RULES_V2; // stamped BEFORE anything computes
  p.trainingFloorDays = require('./history').TRAINING_FLOOR_DAYS;
  if (p.feePerLeg == null) throw new Error('feePerLeg is missing from the source run and the launch');

  const claim = { id: 'httwo-pending', kind: 'httwo', status: 'running', params: {}, perf: {} };
  activeBatch = claim;
  const release = (err) => { if (activeBatch === claim) { activeBatch = null; } throw err; };
  return ht2Launch(p, T2, claim).catch(release);
}

function ht2Launch(p, T2, claim) {
  return (async () => {
    const { buildCombo } = require('./bracketwork');
    const { chunks } = await buildCombo(p.combo, p.branch, p);
    if (chunks.length < 50) throw new Error(`only ${chunks.length} chunks buildable — not enough history`);
    p.usableStartTs = chunks[0].startTs;
    p.usableEndTs = p.exam ? chunks[chunks.length - 1].startTs + 1 : p.windowStamps.testStartTs;
    const geom = T2.foldGeometry(p.usableStartTs, p.usableEndTs);
    if (geom.refusal) throw new Error(geom.refusal);
    p.foldCount = geom.k;
    p.windowDays = geom.windowDays;
    if (p.exam) {
      // Exam band: calibrated once on the pre-fold era, deterministic for a
      // given fabricated span — stamped so the record carries it.
      const { balancedBandPct } = require('./dataset');
      const preFold = chunks.filter((c) => c.startTs < geom.folds[0].foldStartTs);
      if (preFold.length < 100) throw new Error(`only ${preFold.length} pre-fold chunks on the exam pair — regenerate it over a longer span`);
      p.declaredCell.bandPct = balancedBandPct(preFold.map((c) => c.diffPct));
    }
    if (p.declaredCell.bandPct == null) throw new Error('the declared cell carries no band — cannot label chunks');

    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
    const doc = {
      id: `httwo-${stamp}${idSlug(p)}`,
      kind: 'httwo',
      status: 'running',
      startedAt: new Date().toISOString(),
      params: p,
      progress: 'building folds',
      foldRows: [],
      failures: [],
      perf: { unitsDone: 0, unitsTotal: geom.k, phase: 'folds' },
    };
    activeBatch = doc; // takes over the synchronous claim
    if (claim.cancelRequested) { doc.status = 'cancelled'; doc.finishedAt = new Date().toISOString(); activeBatch = null; saveBatch(doc); throw new Error('cancelled by owner during launch'); }
    doc.dataManifest = stampManifest(doc.id, [p.combo.trade, p.combo.ctx1, p.combo.ctx2].filter(Boolean));
    saveBatch(doc);
    const pool = createPool();
    activePool = pool;
    const t0 = Date.now();

    (async () => {
      const payloads = geom.folds.map((fold) => ({ combo: p.combo, branch: p.branch, fold, params: p }));
      await pool.forEach('htTwoFold', payloads, (settled, i) => {
        // Cancel keeps every COMPLETED fold (QC 74); termination errors are noise.
        if (settled.ok && settled.value) {
          doc.foldRows.push(settled.value);
        } else if (!settled.ok && !doc.cancelRequested) {
          recordFailure(doc, `fold-${i}`, settled.error);
        }
        doc.perf.unitsDone++;
        doc.perf.elapsedMs = Date.now() - t0;
        doc.progress = `paired folds ${doc.perf.unitsDone}/${geom.k} (${p.halfLifeKey} vs reference)`;
        saveBatch(doc);
      });
      pool.abort();
      if (activePool === pool) activePool = null;
      doc.foldRows.sort((a, b) => (a.fold ?? 0) - (b.fold ?? 0));
      doc.status = doc.cancelRequested ? 'cancelled' : 'done';
      doc.finishedAt = new Date().toISOString();
      doc.progress = '';
      saveBatch(doc);
      if (activeBatch && activeBatch.id === doc.id) activeBatch = null;
    })().catch((err) => {
      pool.abort();
      if (activePool === pool) activePool = null;
      doc.status = 'error';
      doc.error = err.message || String(err);
      doc.finishedAt = new Date().toISOString();
      doc.progress = '';
      saveBatch(doc);
      if (activeBatch && activeBatch.id === doc.id) activeBatch = null;
    });
    return { started: true, id: doc.id, folds: geom.k, windowDays: geom.windowDays };
  })();
}

module.exports = {
  expandDeclared,
  shiftStance,
  listRow,
  markInterrupted,
  startBracketLab,
  startHistoryTuning,
  startHtTwo,
  startReserveGrade,
  idSlug,
  leaderCmp,
  bracketSelect,
  startBracketNull,
  expandBracketPlan,
  promotionSet,
  setBatchNotes,
  validateDeclared,
  archivePrior,
  recordFailure,
  declaredQuorumFor,
  unitFullKey,
  getBatch,
  planFor,
  runContents,
  deleteBatch,
  reserveGradesFor,
  replayParams,
  resumeContents,
  resumeBracketLab,
  listBatches,
  batchRunning,
  cancelActive,
  summarize,
  DEFAULT_PAIRS,
};
