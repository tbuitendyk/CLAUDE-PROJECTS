const fs = require('fs');
const path = require('path');
const { runAnalysis, extractMetrics } = require('./pipeline');
const { runMetaLens, extractMetaMetrics } = require('./metalens');
const { pnlAt, REAL_FEE_PER_LEG, voteOf, superOf } = require('./paper');
const { stampManifest } = require('./manifest');

// Pair screen: run the full pipeline for every (trade pair x model) combo
// against one compare pair, sequentially, persisting after every run so a
// crash loses at most the run in flight. Results live in data/batches/
// (survives deploys — install.sh rsync excludes data/).

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
  if (doc.confirm && doc.confirm.status === 'running') doc.confirm.status = 'interrupted';
  doc.finishedAt = doc.finishedAt || new Date().toISOString();
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

function getBatch(id) {
  if (activeBatch && activeBatch.id === id) return activeBatch;
  try {
    const doc = JSON.parse(fs.readFileSync(batchFile(id), 'utf8'));
    // The runs are the record; the summary is derived. Rebuild it on read so
    // docs saved by older versions pick up new summary fields (e.g. median
    // paper P&L) without re-running anything.
    if (doc.summary && Array.isArray(doc.runs)) {
      doc.summary = doc.kind === 'consensus'
        ? summarizeConsensus(doc.runs, doc.votes || null)
        : doc.kind === 'metalens'
          ? summarizeMetalens(doc.runs, doc.meta || null)
          : doc.kind === 'permscreen'
            ? summarizePermScreen(doc)
            : summarize(doc.runs);
    }
    return doc;
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

function startBatch(params) {
  { const stop = launchRefusal(); if (stop) throw new Error(stop); }
  const {
    dormantPct = 5,
    startMonth = '2018-01',
    endMonth = '2026-06',
    featureSet = 'compressed',
    compareSymbol = 'BTCUSDT',
    pairs = DEFAULT_PAIRS,
    models = ['logreg', 'boost'],
    geometry = 'weekly-8d',
    decision = 'argmax',
    weekdaysOnly = false,
    allLoaded = false,
  } = params || {};
  refusePlantedPairs([...pairs, compareSymbol], 'a pair screen');

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  const doc = {
    id: `screen-${stamp}`,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: '',
    params: { dormantPct, startMonth, endMonth, featureSet, compareSymbol, models, geometry, decision, weekdaysOnly, allLoaded, feePerLeg: REAL_FEE_PER_LEG },
    runs: [],
    summary: null,
  };
  for (const trade of pairs) {
    if (trade === compareSymbol) continue;
    for (const model of models) {
      doc.runs.push({ trade, compare: compareSymbol, model, status: 'pending', error: null, metrics: null });
    }
  }
  activeBatch = doc;
  saveBatch(doc);

  (async () => {
    for (const run of doc.runs) {
      if (doc.cancelRequested) break;
      run.status = 'running';
      doc.progress = `${run.trade} / ${run.model}`;
      try {
        const report = await runAnalysis(
          {
            dormantPct,
            tradeSymbol: run.trade,
            compareSymbol: run.compare,
            startMonth,
            endMonth,
            featureSet,
            model: run.model,
            geometry,
            decision,
            weekdaysOnly,
            allLoaded,
          },
          (p) => {
            doc.progress = `${run.trade} / ${run.model}: ${p}`;
          }
        );
        run.metrics = extractMetrics(report);
        run.status = 'done';
      } catch (err) {
        run.status = 'error';
        run.error = err.message || String(err);
      }
      doc.summary = summarize(doc.runs);
      saveBatch(doc);
    }
    for (const r of doc.runs) if (r.status === 'running') r.status = 'error';
    doc.status = doc.cancelRequested ? 'cancelled' : 'done';
    doc.finishedAt = new Date().toISOString();
    doc.progress = '';
    saveBatch(doc);
  })().catch((err) => {
    doc.status = 'error';
    doc.error = err.message || String(err);
    doc.finishedAt = new Date().toISOString();
    saveBatch(doc);
  });

  return doc.id;
}

// ---- consensus screen --------------------------------------------------------
//
// Pre-registered spec grid per pair: 4 feature views x 2 models, adaptive
// band, compressed features. Pairs are scored by CONSENSUS across their
// specs (fraction positive true edge + median), never by their best cell.
// Optional null calibration reruns the grid under circular label shifts to
// measure what consensus pure noise produces in this exact pipeline.

const CONSENSUS_VIEWS = ['full', 'prices', 'volume', 'cross'];
const CONSENSUS_MODELS = ['logreg', 'boost'];
const SPECS_PER_GRID = CONSENSUS_VIEWS.length * CONSENSUS_MODELS.length; // 8
const VOTE_QUORUM = 5; // a "vote of the 8" needs most of them present to mean anything
const SUPER_QUORUM = 6; // pre-registered supermajority gate: 6 of 8 same-direction
// Agreement GRADIENT, not a menu. The pre-registered decision rule is and
// stays SUPER_QUORUM; the other rungs exist to test whether edge rises
// monotonically with agreement (the conviction hypothesis), which is a far
// stronger and harder-to-fake claim than any single rung's dollars. Picking
// the best rung after the fact is a 4-way search and costs a 4x correction.
const GATE_QUORUMS = [5, 6, 7, 8];

// ---- simulated consensus (vote) book -------------------------------------------
//
// The tradable number. All 8 specs of a pair share identical test chunks,
// labels, and entry/exit candles — only their predictions differ — so for
// every test period the specs VOTE (the tracker's exact rule via paper.js
// voteOf: majority wins, any tie stands aside) and the vote trades one $100
// order at the geometry's own entry/exit, $1 round trip. Computed for the
// real grid AND for every null-shift rerun, so the vote book gets its own
// noise floor alongside the consensus-fraction one.
//
// group: { rows: [{week, actual, entry, exit}], preds: [ [-1|0|1 per row] ],
//          bestConstant } — assembled in startConsensus as spec runs finish.
// Two books from the same predictions: `vote` (tracker rule — majority, any
// tie stands aside) and `super` (SUPER_QUORUM same-direction specs or stand
// aside — the fee-fighting conviction gate).
function voteBook(group) {
  const callsAt = group.rows.map((r, i) => group.preds.map((p) => p[i]));
  const rows = group.rows.map((r, i) => {
    const vote = voteOf(callsAt[i]);
    const sup = superOf(callsAt[i], SUPER_QUORUM);
    const priced = r.entry != null && r.exit != null;
    return {
      week: r.week,
      vote,
      sup,
      actual: r.actual,
      entry: r.entry,
      exit: r.exit,
      pnl: priced ? pnlAt(vote, r.entry, r.exit) : null,
      supPnl: priced ? pnlAt(sup, r.entry, r.exit) : null,
    };
  });
  // One book from any per-period decision rule, on identical prices.
  const bookStats = (callOf) => {
    let pnl = 0;
    let trades = 0;
    let wins = 0;
    let priced = 0;
    let correct = 0;
    group.rows.forEach((r, i) => {
      const call = callOf(i);
      if (call === r.actual) correct++;
      if (r.entry == null || r.exit == null) return;
      priced++;
      if (call === 0) return;
      const p = pnlAt(call, r.entry, r.exit);
      pnl += p;
      trades++;
      if (p > 0) wins++;
    });
    const n = group.rows.length;
    const acc = n ? correct / n : null;
    return {
      pnl,
      trades,
      wins,
      unpriced: n - priced,
      scored: n,
      acc,
      trueEdge: acc != null && group.bestConstant != null ? acc - group.bestConstant : null,
      specsInVote: group.preds.length,
    };
  };
  // The gate's quorum is ABSOLUTE, so a short grid silently runs a different
  // rule — unreachable at 5 specs, unanimity at 6, 6-of-7 at 7 — and a forced
  // all-stand-aside book is a structural constant, not a measurement. Emit no
  // gate books at all rather than misleading ones.
  const complete = group.preds.length >= SPECS_PER_GRID;
  let gates = null;
  if (complete) {
    gates = {};
    for (const q of GATE_QUORUMS) gates[q] = bookStats((i) => superOf(callsAt[i], q));
  }
  return {
    stats: bookStats((i) => rows[i].vote),
    superStats: gates ? gates[SUPER_QUORUM] : null,
    gates,
    rows,
  };
}

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Consensus score for one pair's completed specs at one shift.
function consensusOf(specs) {
  const edges = specs.map((r) => r.metrics.hindsightEdge ?? r.metrics.edge ?? 0);
  const positive = edges.filter((e) => e > 0).length;
  const pnls = specs.map((r) => r.metrics.paperPnl).filter((v) => v != null);
  return {
    specs: specs.length,
    positive,
    fraction: specs.length ? positive / specs.length : 0,
    medianTrueEdge: median(edges),
    medianBalancedAcc: median(specs.map((r) => r.metrics.balancedAcc).filter((v) => v != null)),
    // Same never-best-cell logic as the edges: the TYPICAL spec's one-shot
    // $100 paper book over the test window, not the best single cell's.
    medianPaperPnl: pnls.length ? median(pnls) : null,
    positivePaper: pnls.filter((v) => v > 0).length,
  };
}

// Rebuild the agreement gradient from a stored real grid. v1.16 screens saved
// the per-spec predictions and the priced rows but only the 6-of-8 book, so
// every earlier screen can produce its full ladder with no retraining —
// bestConstant is recovered from the stored accuracy and true edge.
function gatesFromStored(real) {
  if (!real || !Array.isArray(real.rows) || !real.specPreds) return null;
  const preds = Object.values(real.specPreds);
  if (preds.length < SPECS_PER_GRID) return null;
  const bestConstant = real.acc != null && real.trueEdge != null ? real.acc - real.trueEdge : null;
  return voteBook({ rows: real.rows, preds, bestConstant }).gates;
}

function summarizeConsensus(runs, votes = null) {
  const done = runs.filter((r) => r.status === 'done');
  const failed = runs.filter((r) => r.status === 'error');
  const pairs = [...new Set(runs.map((r) => r.trade))];
  const perPair = pairs
    .map((trade) => {
      const real = consensusOf(done.filter((r) => r.trade === trade && !r.shift));
      // Simulated vote books (doc.votes): majority + supermajority stats for
      // the real grid, plus dollars/edge exceed rates against the null-shift
      // books. Older docs stored no `super`/`specPreds` — everything guards.
      const vt = votes ? votes[trade] : null;
      const voteStats = vt && vt.real ? (({ rows, specPreds, super: sup, gates, ...stats }) => stats)(vt.real) : null;
      const superStats = vt && vt.real ? vt.real.super || null : null;
      // Agreement gradient (5..8 of 8). Recomputed from stored predictions
      // when a pre-ladder screen is re-read, so no screen needs re-running.
      const gateLadder = vt && vt.real ? vt.real.gates || gatesFromStored(vt.real) : null;
      let nullVote = null;
      if (voteStats && vt.nulls) {
        // Pool ONLY null grids whose spec count matches the real grid. A
        // degraded null ran a structurally different decision rule (a
        // 7-spec vote cannot tie 4-4, so it takes round trips the real rule
        // never would), which makes it a sample from a different machine —
        // pooling it silently biases the p-value. Pre-v1.16 docs recorded
        // no specsInVote; treat those as comparable rather than dropping them.
        const nv = Object.values(vt.nulls).filter(
          (s) => s.specsInVote == null || s.specsInVote === voteStats.specsInVote
        );
        if (nv.length) {
          // medianTrades matters as much as the exceed rate: an exceed rate of
          // 0% means something quite different when null books traded as often
          // as the real one (the real book's TRADES were better) than when
          // noise rarely fired at all (reaching agreement is itself the rare
          // event). Same for the gate, where 6-of-8 under noise may be rare.
          nullVote = {
            shifts: nv.length,
            exceedPnl: nv.filter((s) => s.pnl >= vt.real.pnl).length / nv.length,
            exceedEdge: nv.filter((s) => (s.trueEdge ?? -Infinity) >= (vt.real.trueEdge ?? -Infinity)).length / nv.length,
            medianPnl: median(nv.map((s) => s.pnl)),
            medianTrades: median(nv.map((s) => s.trades).filter((v) => v != null)),
          };
          const nvS = nv.filter((s) => s.super);
          if (superStats && nvS.length) {
            nullVote.superShifts = nvS.length;
            nullVote.superExceedPnl = nvS.filter((s) => s.super.pnl >= superStats.pnl).length / nvS.length;
            nullVote.superExceedEdge = nvS.filter((s) => (s.super.trueEdge ?? -Infinity) >= (superStats.trueEdge ?? -Infinity)).length / nvS.length;
            nullVote.superMedianPnl = median(nvS.map((s) => s.super.pnl));
            nullVote.superMedianTrades = median(nvS.map((s) => s.super.trades).filter((v) => v != null));
          }
          // Per-rung null calibration, so the gradient is judged against the
          // noise floor of EACH rung rather than only the pre-registered one.
          const nvG = nv.filter((s) => s.gates);
          if (gateLadder && nvG.length) {
            nullVote.gateShifts = nvG.length;
            nullVote.gateExceed = {};
            nullVote.gateMedianPnl = {};
            nullVote.gateMedianTrades = {};
            for (const q of GATE_QUORUMS) {
              const real = gateLadder[q];
              const nulls = nvG.map((s) => s.gates[q]).filter(Boolean);
              if (!real || !nulls.length) continue;
              nullVote.gateExceed[q] = nulls.filter((g) => g.pnl >= real.pnl).length / nulls.length;
              nullVote.gateMedianPnl[q] = median(nulls.map((g) => g.pnl));
              nullVote.gateMedianTrades[q] = median(nulls.map((g) => g.trades));
            }
          }
        }
      }
      // Group null runs by the EFFECTIVE rotation (derived per pair from the
      // fractional request): duplicate rotations collapse into one sample
      // instead of double-counting identical reruns in the distribution.
      const nullKey = (r) => r.effectiveShift ?? r.shift;
      const shiftIds = [...new Set(done.filter((r) => r.trade === trade && r.shift).map(nullKey))];
      let nullStats = null;
      if (shiftIds.length) {
        const nullCons = shiftIds.map((s) => consensusOf(done.filter((r) => r.trade === trade && r.shift && nullKey(r) === s)));
        const score = (c) => c.fraction + 0.001 * (c.medianTrueEdge ?? 0);
        const beatOrTie = nullCons.filter((c) => score(c) >= score(real)).length;
        nullStats = {
          shifts: shiftIds.length,
          medianNullFraction: median(nullCons.map((c) => c.fraction)),
          exceedRate: beatOrTie / shiftIds.length, // ~p-value: share of null shifts scoring >= the real run
        };
      }
      return { trade, ...real, vote: voteStats, superVote: superStats, gateLadder, nullVote, null: nullStats };
    })
    .sort((a, b) => b.fraction - a.fraction || (b.medianTrueEdge ?? -1) - (a.medianTrueEdge ?? -1));
  return {
    kind: 'consensus',
    pairs: perPair,
    // per-spec detail for the real (unshifted) runs, best-first
    ranked: summarize(runs.filter((r) => !r.shift)).ranked,
    failed: failed.map((r) => ({ trade: r.trade, model: r.model, view: r.view, shift: r.shift || 0, error: r.error })),
    done: done.length,
    total: runs.length,
  };
}

function startConsensus(params) {
  { const stop = launchRefusal(); if (stop) throw new Error(stop); }
  const {
    startMonth = '2018-01',
    endMonth = '2026-06',
    compareSymbol = 'BTCUSDT',
    pairs = DEFAULT_PAIRS,
    nullShifts = 0,
    geometry = 'weekly-8d',
    decision = 'argmax',
    dormantPct = 'auto', // manual wide bands (big-move hunter) allowed; 'auto' = classic
    weekdaysOnly = false,
    allLoaded = false,
  } = params || {};
  refusePlantedPairs([...pairs, compareSymbol], 'a consensus screen');
  const nShifts = Math.min(1000, Math.max(0, Math.floor(Number(nullShifts) || 0)));

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  const doc = {
    id: `consensus-${stamp}`,
    kind: 'consensus',
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: '',
    params: {
      dormantPct,
      startMonth,
      endMonth,
      featureSet: 'compressed',
      compareSymbol,
      views: CONSENSUS_VIEWS,
      models: CONSENSUS_MODELS,
      nullShifts: nShifts,
      geometry,
      decision,
      weekdaysOnly,
      allLoaded,
      feePerLeg: REAL_FEE_PER_LEG,
    },
    runs: [],
    votes: {}, // per pair: { real: {stats + rows}, nulls: { [effectiveShift]: stats } }
    summary: null,
  };
  // Shifts are requested as evenly spread FRACTIONS of each pair's own week
  // cycle (the pipeline derives the integer rotation per pair, buffered away
  // from the ends). shift here is the sample INDEX (1..N), not the rotation.
  for (const trade of pairs) {
    if (trade === compareSymbol) continue;
    for (let shift = 0; shift <= nShifts; shift++) {
      for (const view of CONSENSUS_VIEWS) {
        for (const model of CONSENSUS_MODELS) {
          doc.runs.push({ trade, compare: compareSymbol, model, view, shift, status: 'pending', error: null, metrics: null });
        }
      }
    }
  }
  activeBatch = doc;
  saveBatch(doc);

  // Vote-book accumulator: one group per (pair, shift sample). Groups live
  // only in memory while their 8 specs run (the loop keeps them contiguous);
  // the computed book lands in doc.votes and the raw predictions are dropped.
  // A crash mid-group loses only that group's vote, never its spec runs.
  const voteGroups = new Map();

  (async () => {
    for (const run of doc.runs) {
      if (doc.cancelRequested) break;
      run.status = 'running';
      const tag = `${run.trade}/${run.view}/${run.model}${run.shift ? `/shift${run.shift}` : ''}`;
      doc.progress = tag;
      const groupKey = `${run.trade}|${run.shift}`;
      let group = voteGroups.get(groupKey);
      if (!group) {
        group = { rows: null, preds: [], specKeys: [], bestConstant: null, effectiveShift: 0, completed: 0 };
        voteGroups.set(groupKey, group);
      }
      try {
        const report = await runAnalysis(
          {
            dormantPct,
            tradeSymbol: run.trade,
            compareSymbol: run.compare,
            startMonth,
            endMonth,
            featureSet: 'compressed',
            model: run.model,
            featureView: run.view,
            labelShiftFrac: run.shift > 0 ? run.shift / (nShifts + 1) : 0,
            geometry,
            decision,
            weekdaysOnly,
            allLoaded,
          },
          (p) => {
            doc.progress = `${tag}: ${p}`;
          }
        );
        run.metrics = extractMetrics(report);
        run.effectiveShift = report.params.labelShift || 0;
        run.status = 'done';
        if (!group.rows) {
          group.rows = report.test.rows.map((r) => ({ week: r.weekStart, actual: r.actual, entry: r.entry, exit: r.exit }));
        }
        if (report.test.rows.length === group.rows.length) {
          group.preds.push(report.test.rows.map((r) => r.predicted));
          group.specKeys.push(`${run.view}/${run.model}`);
          group.bestConstant = run.metrics.bestConstant;
          group.effectiveShift = run.effectiveShift;
        }
      } catch (err) {
        run.status = 'error';
        run.error = err.message || String(err);
      }
      group.completed++;
      if (group.completed === SPECS_PER_GRID) {
        voteGroups.delete(groupKey);
        if (group.preds.length >= VOTE_QUORUM) {
          const book = voteBook(group);
          const v = doc.votes[run.trade] || (doc.votes[run.trade] = { real: null, nulls: {} });
          // Real grid keeps its trade-by-trade rows AND the raw per-spec
          // predictions (future gate ideas re-analyze without rerunning);
          // null books keep stats only, keyed by effective rotation so
          // duplicate rotations collapse exactly like the fraction nulls.
          if (run.shift === 0) {
            v.real = {
              ...book.stats,
              super: book.superStats,
              gates: book.gates,
              rows: book.rows,
              specPreds: Object.fromEntries(group.specKeys.map((k, i) => [k, group.preds[i]])),
            };
          } else {
            v.nulls[group.effectiveShift] = { ...book.stats, super: book.superStats, gates: book.gates };
          }
        }
      }
      doc.summary = summarizeConsensus(doc.runs, doc.votes);
      saveBatch(doc);
    }
    for (const r of doc.runs) if (r.status === 'running') r.status = 'error';
    doc.status = doc.cancelRequested ? 'cancelled' : 'done';
    doc.finishedAt = new Date().toISOString();
    doc.progress = '';
    saveBatch(doc);
  })().catch((err) => {
    doc.status = 'error';
    doc.error = err.message || String(err);
    doc.finishedAt = new Date().toISOString();
    saveBatch(doc);
  });

  return doc.id;
}

// ---- meta-lens screen ----------------------------------------------------------
//
// One RUN here is one complete two-stage recipe (selection on half A,
// threshold on half B, verdict on test) — the null replays all of it per
// rotation, which is the protocol's whole point. Runs per pair = shifts + 1.

function summarizeMetalens(runs, meta) {
  const done = runs.filter((r) => r.status === 'done');
  const failed = runs.filter((r) => r.status === 'error');
  const pairs = [...new Set(runs.map((r) => r.trade))];
  const perPair = pairs.map((trade) => {
    const real = done.find((r) => r.trade === trade && !r.shift);
    const nullKey = (r) => r.effectiveShift ?? r.shift;
    const byShift = new Map();
    for (const r of done) {
      if (r.trade !== trade || !r.shift) continue;
      byShift.set(nullKey(r), r.metrics); // duplicate rotations collapse
    }
    const nulls = [...byShift.values()];
    let nullStats = null;
    if (real && nulls.length) {
      nullStats = {
        shifts: nulls.length,
        exceedPnl: nulls.filter((n) => n.pnl >= real.metrics.pnl).length / nulls.length,
        exceedEdge: nulls.filter((n) => (n.edge ?? -Infinity) >= (real.metrics.edge ?? -Infinity)).length / nulls.length,
        medianPnl: median(nulls.map((n) => n.pnl)),
        medianTrades: median(nulls.map((n) => n.trades)),
        medianLensesPassed: median(nulls.map((n) => n.lensesPassed)),
      };
    }
    return {
      trade,
      metrics: real ? real.metrics : null,
      detail: meta && meta[trade] ? meta[trade] : null,
      null: nullStats,
    };
  }).sort((a, b) => ((b.metrics && b.metrics.pnl) ?? -Infinity) - ((a.metrics && a.metrics.pnl) ?? -Infinity));
  return {
    kind: 'metalens',
    pairs: perPair,
    failed: failed.map((r) => ({ trade: r.trade, shift: r.shift || 0, error: r.error })),
    done: done.length,
    total: runs.length,
  };
}

function startMetalens(params) {
  { const stop = launchRefusal(); if (stop) throw new Error(stop); }
  const {
    startMonth = '2018-01',
    endMonth = '2026-06',
    compareSymbol = 'BTCUSDT',
    pairs = DEFAULT_PAIRS,
    nullShifts = 0,
    geometry = 'daily-3d',
    dormantPct = 'auto',
    weekdaysOnly = false,
    forceAllOnZeroPass = false,
    splitMode = 'chronological',
    allLoaded = false,
  } = params || {};
  refusePlantedPairs([...pairs, compareSymbol], 'a metalens screen');
  const nShifts = Math.min(1000, Math.max(0, Math.floor(Number(nullShifts) || 0)));

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  const doc = {
    id: `metalens-${stamp}`,
    kind: 'metalens',
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: '',
    params: { protocol: 'metalens', dormantPct, startMonth, endMonth, compareSymbol, nullShifts: nShifts, geometry, weekdaysOnly, forceAllOnZeroPass, splitMode, allLoaded, feePerLeg: REAL_FEE_PER_LEG },
    runs: [],
    meta: {}, // per pair: full stage1/stage2/test detail for the REAL run
    summary: null,
  };
  for (const trade of pairs) {
    if (trade === compareSymbol) continue;
    for (let shift = 0; shift <= nShifts; shift++) {
      doc.runs.push({ trade, compare: compareSymbol, shift, status: 'pending', error: null, metrics: null });
    }
  }
  activeBatch = doc;
  saveBatch(doc);

  (async () => {
    for (const run of doc.runs) {
      if (doc.cancelRequested) break;
      run.status = 'running';
      const tag = `${run.trade}/meta${run.shift ? `/shift${run.shift}` : ''}`;
      doc.progress = tag;
      try {
        const report = await runMetaLens(
          {
            tradeSymbol: run.trade,
            compareSymbol: run.compare,
            startMonth,
            endMonth,
            geometry,
            dormantPct,
            weekdaysOnly,
            forceAllOnZeroPass,
            splitMode,
            labelShiftFrac: run.shift > 0 ? run.shift / (nShifts + 1) : 0,
            allLoaded,
          },
          (p) => {
            doc.progress = `${tag}: ${p}`;
          }
        );
        run.metrics = extractMetaMetrics(report);
        run.effectiveShift = report.params.labelShift || 0;
        run.status = 'done';
        if (run.shift === 0) {
          doc.meta[run.trade] = { stage1: report.stage1, stage2: report.stage2, test: report.test, data: report.data };
        }
      } catch (err) {
        run.status = 'error';
        run.error = err.message || String(err);
      }
      doc.summary = summarizeMetalens(doc.runs, doc.meta);
      saveBatch(doc);
    }
    for (const r of doc.runs) if (r.status === 'running') r.status = 'error';
    doc.status = doc.cancelRequested ? 'cancelled' : 'done';
    doc.finishedAt = new Date().toISOString();
    doc.progress = '';
    saveBatch(doc);
  })().catch((err) => {
    doc.status = 'error';
    doc.error = err.message || String(err);
    doc.finishedAt = new Date().toISOString();
    saveBatch(doc);
  });

  return doc.id;
}

// ---- permutation screen (owner's staged pick workflow) -----------------------
//
// Stage 1: every pair × every spec × both TRAINING REGIMES, 0 nulls. The five
// protocol permutations (classic, meta-lens 0-0/0-1/1-0/1-1) collapse per-spec
// to two distinct training regimes — force-all only changes committee
// behaviour, and the chronological meta-lens retrain (A+B) IS the classic
// training window — so each pair yields 16 distinct members, each labeled
// with the protocols it represents. Band and test window are shared across
// regimes (see pipeline trainRegime), so every member's calls are
// period-aligned and quorum books over any hand-picked subset are exact.
//
// Stages 2-5 are SELECTIONS persisted on the doc (pair -> members -> rungs),
// with the quorum menu computed server-side from stored calls. Stage 6 fires
// the null job over the frozen selection. The workflow is selection-heavy by
// design: the null reads as a conditional calibration of the chosen book,
// never as a clean p-value (the hand-picks cannot be replayed inside the
// null). VERDICTS.md ledger rules apply to every look it produces.

// Plain language, because at the spec level there are exactly TWO realities:
// the five protocol permutations (classic, meta-lens 0-0/0-1/1-0/1-1)
// collapse to which window the model trains on — nothing else survives.
const PERM_REGIMES = [
  { key: 'full', trainRegime: 'full', label: 'full training window' },
  { key: 'interlaced', trainRegime: 'interlaced', label: 'interlaced-purged window' },
];

// Net-direction quorum call (owner's rule): the majority side wins; the book
// trades at rung k when the winning side's ABSOLUTE count reaches k; a tied
// up/down count stands aside at every rung.
function permQuorumCall(callArrays, i, k) {
  let up = 0;
  let down = 0;
  for (const calls of callArrays) {
    const c = calls[i];
    if (c === 1) up++;
    else if (c === -1) down++;
  }
  if (up === down) return 0;
  const winner = up > down ? 1 : -1;
  return Math.max(up, down) >= k ? winner : 0;
}

function permQuorumBook(periods, callArrays, k, feePerLeg) {
  let pnl = 0;
  let trades = 0;
  let wins = 0;
  let correct = 0;
  let scored = 0;
  let tradeCorrect = 0;
  periods.forEach((p, i) => {
    const call = permQuorumCall(callArrays, i, k);
    if (p.actual != null) {
      scored++;
      if (call === p.actual) correct++;
    }
    if (call === 0 || p.entry == null || p.exit == null) return;
    const v = pnlAt(call, p.entry, p.exit, feePerLeg);
    pnl += v;
    trades++;
    if (v > 0) wins++;
    if (call === p.actual) tradeCorrect++;
  });
  return {
    k,
    pnl,
    trades,
    wins,
    grossPerTrade: trades ? (pnl + trades * 2 * feePerLeg) / trades : null,
    acc: scored ? correct / scored : null,
    tradeHit: trades ? tradeCorrect / trades : null,
  };
}

function summarizePermScreen(doc) {
  const done = doc.runs.filter((r) => r.status === 'done').length;
  const failed = doc.runs
    .filter((r) => r.status === 'error')
    .map((r) => ({ trade: r.trade, key: `${r.regime}/${r.view}/${r.model}`, error: r.error }));
  const top = [];
  const pairs = [];
  for (const [trade, p] of Object.entries(doc.perms || {})) {
    const members = Object.entries(p.members || {}).map(([key, m]) => ({ trade, key, ...m }));
    members.sort((a, b) => (b.metrics.paperPnl ?? -Infinity) - (a.metrics.paperPnl ?? -Infinity));
    pairs.push({ trade, band: p.band, members: members.length, best: members[0] ? { key: members[0].key, pnl: members[0].metrics.paperPnl } : null });
    for (const m of members) top.push(m);
  }
  top.sort((a, b) => (b.metrics.paperPnl ?? -Infinity) - (a.metrics.paperPnl ?? -Infinity));
  pairs.sort((a, b) => (b.best ? b.best.pnl : -Infinity) - (a.best ? a.best.pnl : -Infinity));
  return { kind: 'permscreen', done, total: doc.runs.length, failed, pairs, top: top.slice(0, 20).map((m) => ({ trade: m.trade, key: m.key, regime: m.regime, pnl: m.metrics.paperPnl, trades: m.metrics.paperTrades, wins: m.metrics.paperWins, hindsightEdge: m.metrics.hindsightEdge, testAcc: m.metrics.testAcc, chosen: m.metrics.chosen })) };
}

function startPermScreen(params) {
  { const stop = launchRefusal(); if (stop) throw new Error(stop); }
  const {
    startMonth = '2018-01',
    endMonth = '2026-06',
    compareSymbol = 'BTCUSDT',
    pairs = DEFAULT_PAIRS,
    geometry = 'weekly-8d',
    decision = 'argmax',
    dormantPct = 'auto',
    weekdaysOnly = false,
    allLoaded = false,
  } = params || {};
  refusePlantedPairs([...pairs, compareSymbol], 'a permutation screen');

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  const doc = {
    id: `permscreen-${stamp}`,
    kind: 'permscreen',
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: '',
    params: { dormantPct, startMonth, endMonth, featureSet: 'compressed', compareSymbol, views: CONSENSUS_VIEWS, models: CONSENSUS_MODELS, regimes: PERM_REGIMES.map((r) => r.key), geometry, decision, weekdaysOnly, allLoaded, feePerLeg: REAL_FEE_PER_LEG },
    runs: [],
    perms: {}, // per pair: { band, periods:[{week,actual,entry,exit}], members:{ key: {regime,view,model,protocols,calls,metrics} } }
    selection: { pair: null, members: [], rungs: [] },
    quorums: null,
    nullTest: null,
    summary: null,
  };
  for (const trade of pairs) {
    if (trade === compareSymbol) continue;
    for (const regime of PERM_REGIMES) {
      for (const view of CONSENSUS_VIEWS) {
        for (const model of CONSENSUS_MODELS) {
          doc.runs.push({ trade, compare: compareSymbol, regime: regime.key, view, model, shift: 0, status: 'pending', error: null, metrics: null });
        }
      }
    }
  }
  activeBatch = doc;
  saveBatch(doc);
  runPermRuns(doc, doc.runs, null).then(() => {
    doc.status = doc.cancelRequested ? 'cancelled' : 'done';
    doc.finishedAt = new Date().toISOString();
    doc.progress = '';
    doc.summary = summarizePermScreen(doc);
    saveBatch(doc);
  }).catch((err) => {
    doc.status = 'error';
    doc.error = err.message || String(err);
    doc.finishedAt = new Date().toISOString();
    saveBatch(doc);
  });
  return doc.id;
}

// Shared run loop for stage 1 (shift 0, every member) and stage 6 (selected
// members, shifts 1..N). nullCtx = { shifts, groups: Map(shift -> group) }.
async function runPermRuns(doc, runs, nullCtx) {
  const p = doc.params;
  for (const run of runs) {
    if (doc.cancelRequested) break;
    run.status = 'running';
    const tag = `${run.trade}/${run.regime}/${run.view}/${run.model}${run.shift ? `/shift${run.shift}` : ''}`;
    doc.progress = (nullCtx ? 'null: ' : '') + tag;
    try {
      const report = await runAnalysis(
        {
          dormantPct: p.dormantPct,
          tradeSymbol: run.trade,
          compareSymbol: run.compare,
          startMonth: p.startMonth,
          endMonth: p.endMonth,
          featureSet: 'compressed',
          model: run.model,
          featureView: run.view,
          trainRegime: run.regime === 'interlaced' ? 'interlaced' : 'full',
          labelShiftFrac: run.shift > 0 ? run.shift / (nullCtx.shifts + 1) : 0,
          geometry: p.geometry,
          decision: p.decision,
          weekdaysOnly: p.weekdaysOnly,
          allLoaded: p.allLoaded,
        },
        (prog) => {
          doc.progress = `${nullCtx ? 'null: ' : ''}${tag}: ${prog}`;
        }
      );
      run.metrics = extractMetrics(report);
      run.effectiveShift = report.params.labelShift || 0;
      run.status = 'done';
      const rows = report.test.rows;
      if (run.shift === 0) {
        const pp = doc.perms[run.trade] || (doc.perms[run.trade] = { band: null, periods: null, members: {} });
        pp.band = report.data.dormantBandPct;
        if (!pp.periods) pp.periods = rows.map((r) => ({ week: r.weekStart, actual: r.actual, entry: r.entry, exit: r.exit }));
        if (rows.length === pp.periods.length) {
          const regime = PERM_REGIMES.find((r) => r.key === run.regime);
          pp.members[`${run.regime}/${run.view}/${run.model}`] = {
            regime: run.regime,
            view: run.view,
            model: run.model,
            label: regime.label,
            calls: rows.map((r) => r.predicted),
            metrics: run.metrics,
          };
        } else {
          run.status = 'error';
          run.error = `test window misaligned (${rows.length} vs ${pp.periods.length} periods)`;
        }
      } else {
        let g = nullCtx.groups.get(run.shift);
        if (!g) {
          g = { periods: null, calls: [], expected: doc.selection.members.length, effectiveShift: run.effectiveShift };
          nullCtx.groups.set(run.shift, g);
        }
        if (!g.periods) g.periods = rows.map((r) => ({ actual: r.actual, entry: r.entry, exit: r.exit }));
        if (rows.length === g.periods.length) g.calls.push(rows.map((r) => r.predicted));
        // LIVE null reading (same behaviour as the consensus screen): the
        // moment a rotation's committee is complete, score the kept rungs,
        // bank the sample (keyed by effective rotation, so duplicates
        // collapse), and refresh the running exceed table. Partial
        // committees are never banked — they'd be a different machine.
        if (doc.nullTest && g.calls.length === g.expected && g.periods) {
          const fee = doc.params.feePerLeg ?? REAL_FEE_PER_LEG;
          const books = {};
          for (const k of Object.keys(doc.nullTest.real || {})) {
            books[k] = permQuorumBook(g.periods, g.calls, Number(k), fee);
          }
          doc.nullTest.samples[g.effectiveShift] = books;
          permNullAggregate(doc);
        }
      }
    } catch (err) {
      run.status = 'error';
      run.error = err.message || String(err);
    }
    doc.summary = summarizePermScreen(doc);
    saveBatch(doc);
  }
  for (const r of runs) if (r.status === 'running') r.status = 'error';
}

// Stage 2/3/5 selections, persisted server-side so the workflow survives
// reloads. Changing an earlier stage clears everything downstream of it.
function permSelect(id, patch) {
  const doc = getBatch(id);
  if (!doc || doc.kind !== 'permscreen') throw new Error('unknown permutation screen');
  if (doc.status === 'running') throw new Error('screen is still running');
  if (patch.pair !== undefined) {
    if (patch.pair !== null && !doc.perms[patch.pair]) throw new Error(`no results for pair "${patch.pair}"`);
    archivePrior(doc, 'permSelection', { quorums: doc.quorums ?? null, nullTest: doc.nullTest ?? null });
    doc.selection = { pair: patch.pair, members: [], rungs: [] };
    doc.quorums = null;
    doc.nullTest = null;
  }
  if (patch.members !== undefined) {
    const pair = doc.selection.pair;
    if (!pair) throw new Error('select an asset first');
    const valid = doc.perms[pair].members;
    const members = [...new Set(patch.members.map(String))];
    if (!members.length) throw new Error('pick at least one member');
    for (const m of members) if (!valid[m]) throw new Error(`unknown member "${m}"`);
    archivePrior(doc, 'nullTest', doc.nullTest);
    doc.selection.members = members;
    doc.selection.rungs = [];
    doc.nullTest = null;
    const periods = doc.perms[pair].periods;
    const callArrays = members.map((m) => valid[m].calls);
    const fee = doc.params.feePerLeg ?? REAL_FEE_PER_LEG;
    const rows = [];
    for (let k = 1; k <= members.length; k++) rows.push(permQuorumBook(periods, callArrays, k, fee));
    rows.sort((a, b) => b.pnl - a.pnl);
    archivePrior(doc, 'quorums', doc.quorums);
    doc.quorums = { pair, members, rows, computedAt: new Date().toISOString() };
  }
  if (patch.rungs !== undefined) {
    if (!doc.quorums) throw new Error('compute the quorum table first (pick members)');
    const n = doc.selection.members.length;
    const rungs = [...new Set(patch.rungs.map(Number))].filter((k) => Number.isInteger(k) && k >= 1 && k <= n);
    if (!rungs.length) throw new Error('pick at least one quorum rung');
    archivePrior(doc, 'nullTest', doc.nullTest);
    doc.selection.rungs = rungs.sort((a, b) => a - b);
    doc.nullTest = null;
  }
  saveBatch(doc);
  return doc;
}

// Stage 6: null-calibrate the FROZEN selection. Retrains only the selected
// members per label rotation and scores only the selected rungs.
function startPermNull(id, shifts) {
  { const stop = launchRefusal(); if (stop) throw new Error(stop); }
  const doc = getBatch(id);
  if (!doc || doc.kind !== 'permscreen') throw new Error('unknown permutation screen');
  const sel = doc.selection;
  if (!sel.pair || !sel.members.length || !sel.rungs.length) throw new Error('selection incomplete: need asset, members and rungs');
  const nShifts = Math.min(1000, Math.max(1, Math.floor(Number(shifts) || 0)));
  const fee = doc.params.feePerLeg ?? REAL_FEE_PER_LEG;
  const memberSpecs = sel.members.map((key) => {
    const [regime, view, model] = key.split('/');
    return { trade: sel.pair, compare: doc.params.compareSymbol, regime, view, model };
  });
  const nullRuns = [];
  for (let s = 1; s <= nShifts; s++) {
    for (const m of memberSpecs) nullRuns.push({ ...m, shift: s, status: 'pending', error: null, metrics: null });
  }
  // QC 74: a re-fire ARCHIVES the older null job before replacing it.
  {
    const oldNullRuns = doc.runs.filter((r) => r.shift);
    if (oldNullRuns.length || doc.nullTest) {
      archivePrior(doc, 'permNull', { nullTest: doc.nullTest ?? null, runs: oldNullRuns });
    }
  }
  doc.runs = doc.runs.filter((r) => !r.shift);
  doc.status = 'running';
  doc.cancelRequested = false;
  // Real rung books are fixed by the frozen selection — compute them up
  // front so the exceed table can fill in LIVE as rotations complete.
  const periods = doc.perms[sel.pair].periods;
  const callArrays = sel.members.map((m) => doc.perms[sel.pair].members[m].calls);
  const real = {};
  for (const k of sel.rungs) real[k] = permQuorumBook(periods, callArrays, k, fee);
  doc.nullTest = { status: 'running', requestedShifts: nShifts, startedAt: new Date().toISOString(), real, samples: {}, perRung: null, shifts: 0 };
  doc.runs.push(...nullRuns);
  activeBatch = doc;
  saveBatch(doc);

  const nullCtx = { shifts: nShifts, groups: new Map() };
  runPermRuns(doc, nullRuns, nullCtx).then(() => {
    permNullAggregate(doc);
    doc.nullTest.status = doc.cancelRequested ? 'cancelled' : 'done';
    doc.nullTest.finishedAt = new Date().toISOString();
    doc.status = doc.cancelRequested ? 'cancelled' : 'done';
    doc.finishedAt = new Date().toISOString();
    doc.progress = '';
    saveBatch(doc);
  }).catch((err) => {
    doc.nullTest = { ...doc.nullTest, status: 'error', error: err.message || String(err) };
    doc.status = 'error';
    doc.error = err.message || String(err);
    saveBatch(doc);
  });
  return { started: true, shifts: nShifts };
}

// Recompute the running exceed table from the banked rotation samples.
// Called after every completed rotation (live view) and at the end.
function permNullAggregate(doc) {
  const nt = doc.nullTest;
  if (!nt || !nt.real) return;
  const rotations = Object.values(nt.samples || {});
  nt.shifts = rotations.length;
  const perRung = {};
  for (const [k, real] of Object.entries(nt.real)) {
    const nulls = rotations.map((s) => s[k]).filter(Boolean);
    perRung[k] = {
      real,
      shifts: nulls.length,
      exceedPnl: nulls.length ? nulls.filter((b) => b.pnl >= real.pnl).length / nulls.length : null,
      exceedAcc: nulls.length && real.acc != null ? nulls.filter((b) => (b.acc ?? -1) >= real.acc).length / nulls.length : null,
      medianPnl: median(nulls.map((b) => b.pnl)),
      medianTrades: median(nulls.map((b) => b.trades)),
    };
  }
  nt.perRung = perRung;
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

const bracketLib = require('./bracket');
const { createPool } = require('./pool');
const { confirmCell } = require('./confirm');

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

const slimViewsFor = (size) => (size === 1 ? ['full', 'prices', 'volume'] : ['full', 'prices', 'volume', 'cross']);

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
// A unit's ROTATION STANCE rides on key PRESENCE, exactly like the unitTask
// fallback it feeds (QC 38): a unit that never mentions shiftFrac defers to
// the run-wide labelShiftFrac; an explicit null means THIS unit must not
// rotate. The old payload builders collapsed both cases to an explicit null,
// so labelShiftFrac-only jobs never rotated at all and discovery-mode
// promotion reran scrambled slim rows unrotated (audit 2026-07-30).
const shiftStance = (o) => (Object.prototype.hasOwnProperty.call(o, 'shiftFrac') ? { labelShiftFrac: o.shiftFrac ?? null } : {});

const unitKey = (c, b) => `${c.trade}|${c.ctx1 || ''}|${c.ctx2 || ''}|${b.geometry}|${b.decision}|${b.band}|${b.weekdaysOnly ? '24-5' : '24-7'}`;

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
      key: unitKey(c, b) + (u.layoutArm ? `|${u.layoutArm}` : '')
        + (u.shiftFrac != null ? `|s${u.shiftFrac.toFixed(3)}` : '')
        + (u.nullDealSeed != null ? `|n${u.nullDealSeed}` : ''),
      trade: c.trade, ctx1: c.ctx1, ctx2: c.ctx2, size: c.size,
      geometry: b.geometry, decision: b.decision, bandMode: b.band, weekdaysOnly: b.weekdaysOnly,
      layoutArm: u.layoutArm ?? null,
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

// Normalizes and validates a walk-forward request. Pure and exported for the
// tests. Numbers are rejected LOUDLY: the old version fell back to defaults
// on a malformed feePerLeg or minTradesSlice, which is exactly how a
// mis-typed launcher runs five hours at the wrong fee (QC 58).
function wfParams(params) {
  const blank = (v) => v === undefined || v === null || v === '';
  const minTradesSlice = blank(params.minTradesSlice) ? 5 : Number(params.minTradesSlice);
  if (!Number.isFinite(minTradesSlice) || minTradesSlice < 1 || minTradesSlice > 50) {
    throw new Error(`minTradesSlice must be a number from 1 to 50 — got ${JSON.stringify(params.minTradesSlice)}`);
  }
  const feePerLeg = blank(params.feePerLeg) ? REAL_FEE_PER_LEG : Number(params.feePerLeg);
  if (!Number.isFinite(feePerLeg) || feePerLeg < 0 || feePerLeg > 2) {
    throw new Error(`feePerLeg must be dollars from 0 to 2 — got ${JSON.stringify(params.feePerLeg)}`);
  }
  // The null arm's seed (audit 9a). Blank = the real arm. Malformed is a
  // loud refusal like every other number here: a null run silently landing
  // on the real arm would be the worst possible version of QC 60.
  const nullShiftSeed = blank(params.nullShiftSeed) ? null : Number(params.nullShiftSeed);
  if (nullShiftSeed !== null && (!Number.isInteger(nullShiftSeed) || nullShiftSeed < 1 || nullShiftSeed > 1e9)) {
    throw new Error(`nullShiftSeed must be a whole number from 1 to 1e9 — got ${JSON.stringify(params.nullShiftSeed)}`);
  }
  if (!blank(params.set?.geometry) && !GEOS[params.set.geometry]) {
    throw new Error(`unknown geometry ${JSON.stringify(params.set.geometry)} — one of: ${Object.keys(GEOS).join(', ')}`);
  }
  if (!blank(params.set?.decision) && !['argmax', 'directional'].includes(params.set.decision)) {
    throw new Error(`unknown decision ${JSON.stringify(params.set.decision)} — argmax or directional`);
  }
  const p = {
    universe: params.universe && params.universe.length ? params.universe : DEFAULT_PAIRS,
    permute: { geometry: params.permute?.geometry !== false, decision: params.permute?.decision !== false },
    set: {
      geometry: params.set?.geometry || 'daily-3d',
      decision: params.set?.decision || 'argmax',
    },
    // walk-forward always uses the whole cached history: folds ARE the range
    allLoaded: true,
    band: 'auto',
    minTradesSlice,
    feePerLeg,
    nullShiftSeed: nullShiftSeed || undefined,
    arm: nullShiftSeed ? 'null' : 'real',
    dMults: numMenu(params.dMults, bracketLib.D_MULTS, (v) => v > 0 && v <= 10),
    tHours: numMenu(params.tHours, bracketLib.T_HOURS, (v) => Number.isInteger(v) && v > 0 && v <= 500),
    gates: pickMenu(params.gates, bracketLib.GATES),
    entries: pickMenu(params.entries, bracketLib.ENTRIES),
    description: typeof params.description === 'string' ? params.description.slice(0, 600) : '',
    label: typeof params.label === 'string' ? params.label.slice(0, 40) : '',
    engineVersion: ENGINE_VERSION,
  };
  // weekly-8d steps a whole week per chunk, so an 8-week slice holds at most
  // 8 chunks and the execution-reach purge always eats the tail — no fold
  // can ever clear the 8-chunk floor. Excluded honestly here rather than
  // reported per-fold as a data gap that isn't one.
  const geoms = (p.permute.geometry ? Object.keys(GEOS) : [p.set.geometry]).filter((g) => g !== 'weekly-8d');
  if (!geoms.length) {
    throw new Error('weekly-8d cannot form a walk-forward fold (week-long chunks never fill an 8-week slice once the execution purge trims it) — pick a daily shape');
  }
  const decs = p.permute.decision ? ['argmax', 'directional'] : [p.set.decision];
  return { p, geoms, decs };
}


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
  if (src.kind !== 'bracketlab') throw new Error('History Tuning tunes Bracket lab survivors only');
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
    feePerLeg: src.params.feePerLeg ?? params.feePerLeg,
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
    p = { ...real.params, nullShiftSeed: seed, arm: 'null', replayOf: real.id,
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
      await pool.map('htPass', payloads, (settled, i) => {
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
  // ONE VERIFICATION EVENT: any prior grade of this run, finished or not,
  // makes another refuse.
  for (const b of listBatches()) {
    if (b.kind === 'historytuning' && b.params && b.params.mode === 'reserve-grade'
        && b.params.replayOf === real.id) {
      throw new Error(`the reserve was already touched for ${real.id} (${b.id}) — one verification event, ever`);
    }
  }
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
    ...real.params,
    readingRules: {
      ...real.params.readingRules,
      nullRule: {
        label: 'GUESSED (count) / DERIVED (construction)',
        text: 'RESERVE-GRADE CONSTRUCTION: the 19 null draws replay the WINNER\'S schedule only (not best-of-grid) '
          + 'over the sealed reserve — the grid pick already happened on pre-reserve data the reserve never touched, '
          + 'so the reserve verdict prices the winner\'s own walk, not the grid shopping. The winner must exceed '
          + 'every draw; resolution floor 1 in 20, printed.',
      },
    },
    mode: 'reserve-grade', replayOf: real.id, arm: 'real',
    usableEndTs: real.params.reserveToTs, // the walk needs the reserve candles
    splits: [reserveSplit],
    winnerKey,
    label: params.label || 'reserve-grade',
    description: `one-touch reserve grade of ${real.id}: winner ${winnerKey} vs reference vs ${NULL_DRAWS_RESERVE} null draws; `
      + `resolution floor 1 in ${NULL_DRAWS_RESERVE + 1}`,
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
    await pool.map('htPass', payloads, (settled, i) => {
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
      doc.verdict = {
        winnerHoldPnl: w.holdPnl, referenceHoldPnl: ref.holdPnl,
        nullDraws: nulls.length, nullsAtOrAbove: nullsAbove,
        resolutionFloor: `1 in ${nulls.length + 1}`,
        passed: beatsRef && nullsAbove === 0,
        sentence: beatsRef && nullsAbove === 0
          ? `PASSED: the winner beat the reference pass on reserve dollars and no null draw matched it (floor 1 in ${nulls.length + 1}).`
          : `FAILED: ${!beatsRef ? 'the winner did not beat the reference pass on the reserve' : `${nullsAbove} of ${nulls.length} null draws matched or beat the winner`} — tuning did not strengthen this survivor. A failed reserve is a dead end, never a hint.`,
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

function startWalkforward(params) {
  { const stop = launchRefusal(); if (stop) throw new Error(stop); }
  const { p, geoms, decs } = wfParams(params);
  refusePlantedPairs(p.universe, 'a walk-forward run');
  const units = [];
  for (const trade of p.universe) {
    for (const geometry of geoms) {
      for (const decision of decs) {
        units.push({
          c: { trade, ctx1: null, ctx2: null, size: 1 },
          b: { geometry, decision, band: 'auto', weekdaysOnly: false },
        });
      }
    }
  }
  // Seconds resolution: two launches inside one minute must not share an id.
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  const slug = (p.label || 'walkforward').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  const doc = {
    id: `walkforward-${stamp}-${slug}`,
    kind: 'walkforward',
    description: p.description || '',
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: '',
    params: p,
    perf: { unitsDone: 0, unitsTotal: units.length, elapsedMs: 0, etaMs: null, workers: null },
    wfRows: [], // one aggregate row per unit; fold detail lives on disk
    failures: [],
  };
  activeBatch = doc;
  saveBatch(doc);
  const pool = createPool();
  activePool = pool;
  doc.perf.workers = pool.parallel ? pool.workers.length : 1;
  saveBatch(doc);
  const t0 = Date.now();
  (async () => {
    const payloads = units.map((u) => ({ combo: u.c, branch: u.b, params: p }));
    await pool.map('wfUnit', payloads, (settled, i) => {
      const { c, b } = units[i];
      const key = `${c.trade}|${b.geometry}|${b.decision}`;
      // A unit that finished before the owner hit cancel is real work and is
      // kept; only the abort-errors of in-flight units are dropped as noise.
      if (settled.ok && settled.value) {
        const res = settled.value;
        let detailFile = null;
        try {
          const dir = path.join(BATCH_DIR, '..', 'wf', doc.id);
          fs.mkdirSync(dir, { recursive: true });
          const fname = `${key.replace(/[^A-Za-z0-9._-]+/g, '_')}.json`;
          atomicWrite(path.join(dir, fname), JSON.stringify({
            job: doc.id, trade: c.trade, geometry: b.geometry, decision: b.decision,
            // arm + seed IN the detail file: a null run's fold numbers must
            // never be readable as real ones by a consumer that only has
            // the file (review 2026-08-01 — the calibration ledgers will
            // read these without the doc)
            params: { minTradesSlice: p.minTradesSlice, feePerLeg: p.feePerLeg, arm: p.arm || 'real', nullShiftSeed: p.nullShiftSeed || null }, folds: res.folds,
          }));
          detailFile = fname;
        } catch (err) {
          recordFailure(doc, key, `fold dump: ${err.message}`);
        }
        doc.wfRows.push({ trade: c.trade, geometry: b.geometry, decision: b.decision, detailFile, ...res.agg });
      } else if (!settled.ok && !doc.cancelRequested) {
        recordFailure(doc, key, settled.error);
      }
      doc.perf.unitsDone++;
      doc.perf.elapsedMs = Date.now() - t0;
      doc.perf.etaMs = doc.perf.unitsDone ? Math.round((doc.perf.elapsedMs / doc.perf.unitsDone) * (units.length - doc.perf.unitsDone)) : null;
      doc.progress = `walk-forward ${doc.perf.unitsDone}/${units.length}: ${c.trade} ${b.geometry}/${b.decision}`;
      saveBatch(doc);
    });
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

function startBracketLab(params) {
  { const stop = launchRefusal(); if (stop) throw new Error(stop); }
  // The execution grid resolves FIRST so the declared cell can be validated
  // against the grid this run will actually compute (see validateDeclared).
  const grid = {
    dMults: numMenu(params.dMults, bracketLib.D_MULTS, (v) => v > 0 && v <= 10),
    tHours: numMenu(params.tHours, bracketLib.T_HOURS, (v) => Number.isInteger(v) && v > 0 && v <= 500),
    gates: pickMenu(params.gates, bracketLib.GATES),
    entries: pickMenu(params.entries, bracketLib.ENTRIES),
    trailMults: bracketLib.TRAIL_MULTS,
    armMults: bracketLib.ARM_MULTS,
  };
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
    declared: validateDeclared(params.declared, grid),
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
    // Cap raised 12 -> 24. The number of draws sets a FLOOR on the strongest
    // claim available: if the real result beats all N draws, the rank-based
    // p is 1/(N+1). Twelve draws floor that at 0.077, so a perfect outcome
    // still could not reach the conventional 0.05 — the cap, not the data,
    // would be deciding the answer. Nineteen draws puts the floor at exactly
    // 0.05. 24 leaves headroom without inviting all-night runs by accident
    // (each draw is 170 units, roughly 15 minutes on 4 workers).
    labelShiftReps: Math.min(24, Math.max(0, Math.floor(Number(params.labelShiftReps) || 0))),
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
    // FEE, SETTABLE. This was hard-coded to REAL_FEE_PER_LEG and therefore
    // unreachable from any launcher — the same class of fault as `trailing`
    // and `holdout` being dropped by the API, and it matters more. Cycle 9's
    // entire result rests on fees: 86% of the gross edge is consumed by them
    // and break-even sits only 16% above the assumed cost. The one dimension
    // the answer depends on could not be varied.
    //
    // Bounds are a safety rail, not a preference: a zero fee would flatter
    // every result and a silly-large one would make everything look dead.
    feePerLeg: Math.min(2, Math.max(0, Number(params.feePerLeg) >= 0
      ? Number(params.feePerLeg) : REAL_FEE_PER_LEG)),
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
  if (!p.sizes.singles && !p.sizes.doubles && !p.sizes.triples) throw new Error('tick at least one combo size');
  // A declared trail cell only exists when the run computes trail cells:
  // without this, the run finishes and the replication table is empty.
  if (p.declared && p.declared.trailMult != null && !p.trailing) {
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
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
  // HUMAN-MEANINGFUL JOB IDS (owner, 2026-07-29). A wall of timestamps means
  // the only way to tell -2303 from -0041 is to look each one up, which is
  // exactly how their results got attributed to the wrong runs in a report.
  // The slug is APPENDED so every existing consumer still works: scripts
  // filter on the `bracketlab-` prefix and match ids exactly, and the
  // timestamp keeps its position and sort order.
  const doc = {
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
    replication: [], // declared-cell result per asset (replication mode)
    // Edge-screen census: one row per unit, never money-filtered.
    edgeCensus: [],
    failures: [],
    selection: null,
    nullTest: null,
    runs: [], // kept empty by design: at permutation scale, counters + leaders ARE the record
  };
  activeBatch = doc;
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
    doc.dataManifest = stampManifest(doc.id, symbols);
    doc.perf.phase = 'slim';
    saveBatch(doc);

    const slimPayloads = units.map((u) => ({ combo: u.c, branch: u.b, stage: 'slim', params: p, layoutArm: u.layoutArm ?? null, nullDealSeed: u.nullDealSeed ?? null, ...shiftStance(u) }));
    await pool.map('unit', slimPayloads, (settled, i) => {
      // Cancel keeps every COMPLETED result (QC 74): workers are being
      // terminated, but a unit that already finished is computed record and
      // is pushed like any other — only termination errors are skipped.
      const { c, b, layoutArm } = units[i];
      const u = units[i];
      const key = unitKey(c, b) + (layoutArm ? `|${layoutArm}` : '')
        + (u.shiftFrac != null ? `|s${u.shiftFrac.toFixed(3)}` : '')
        + (u.nullDealSeed != null ? `|n${u.nullDealSeed}` : '');
      if (settled.ok && settled.value && settled.value.best) {
        const res = settled.value;
        // UNCAPPED slim record (QC 74): the leader list caps at 50 for
        // display, and slim rows beyond it used to vanish. Compact on
        // purpose — the full result lives in the promoted stage.
        doc.slimResults = doc.slimResults || [];
        doc.slimResults.push({
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
          layoutArm: layoutArm ?? null,
          ...(Object.prototype.hasOwnProperty.call(u, 'shiftFrac') ? { shiftFrac: u.shiftFrac ?? null } : {}),
          ...(u.nullDealSeed != null ? { nullDealSeed: u.nullDealSeed } : {}),
          ...res.best,
        });
      } else if (settled.ok && settled.value && !settled.value.best) {
        doc.slimResults = doc.slimResults || [];
        doc.slimResults.push({
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
      saveBatch(doc);
    });

    // ---- promotion: top-K slim survivors on the full member grid ----
    if (!doc.cancelRequested) {
      const promote = promotionSet(p, doc, units);
      doc.plan.promoteRuns = promote.reduce((s2, l) => s2 + slimViewsFor(l.size).length * 2, 0);
      doc.perf.runsTotal += doc.plan.promoteRuns;
      doc.perf.phase = 'promote';
      saveBatch(doc);
      const promPayloads = promote.map((l) => ({
        combo: { trade: l.trade, ctx1: l.ctx1, ctx2: l.ctx2, size: l.size },
        branch: { geometry: l.geometry, decision: l.decision, band: l.bandMode, weekdaysOnly: l.weekdaysOnly },
        stage: 'promoted', params: p, layoutArm: l.layoutArm ?? null,
        nullDealSeed: l.nullDealSeed ?? null,
        ...shiftStance(l),
      }));
      await pool.map('unit', promPayloads, (settled, i) => {
        // Same rule as the slim stage: cancel never drops a finished result.
        const l = promote[i];
        if (settled.ok && settled.value) {
          const res = settled.value;
          if (res.best) {
            pushLeader(doc, {
              ...l, stage: 'promoted',
              bandPct: res.bandPct, testPeriods: res.testPeriods,
              windowStamps: res.windowStamps || null,
              ...res.best, declaredCell: res.declared || null,
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
                params: { holdout: p.holdout, feePerLeg: p.feePerLeg, labelShiftScope: p.labelShiftScope },
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
            doc.edgeCensus.push({
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
              shiftScope: p.labelShiftScope || 'series',
              // WINDOW LAYOUT this row was measured under, with the seed and
              // the layout's own bookkeeping — a comparison row that cannot
              // say which geometry produced it is not comparable to anything.
              // layoutMeta only ever came from the retired quota layouts, so
              // this fallback stamped 'legacy' on split70/reserve61 rows —
              // the stored parameters are the truth (review 2026-08-03).
              windowLayout: res.layoutMeta ? res.layoutMeta.layout : (p.windowLayout || 'legacy'),
              interlaceSeed: res.layoutMeta ? res.layoutMeta.seed : null,
              layoutGroups: res.layoutMeta ? res.layoutMeta.groups : null,
              layoutEvalDays: res.layoutMeta ? res.layoutMeta.evalDays : null,
              layoutPurged: res.layoutMeta ? res.layoutMeta.purgedTrainChunks : null,
              // 'common-train' or the degrade note — a sharedBand run whose
              // common set was too small must say so where the numbers live.
              layoutBandFrom: res.layoutMeta ? (res.layoutMeta.bandFrom ?? null) : null,
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
            
            doc.edgeCensus.push({
              trade: l.trade, ctx1: l.ctx1, ctx2: l.ctx2,
              geometry: l.geometry, decision: l.decision, bandPct: res.bandPct ?? null,
              bandMode: l.bandMode ?? null, weekdaysOnly: l.weekdaysOnly ?? null,
              shiftFrac: l.shiftFrac ?? null, nullDealSeed: l.nullDealSeed ?? null,
              windowLayout: res.layoutMeta ? res.layoutMeta.layout : (p.windowLayout || 'legacy'),
              windowStamps: res.windowStamps || null,
              noCell: `no execution cell reached ${p.minTrades} test trades — recorded so the denominator stays honest (QC 74)`,
              holdPnl: null, searchPnl: null,
            });
          }
          if (res.declared) {
            const d = res.declared;
            doc.replication.push({
              // WHICH COPY scored this row. Without the tag, real and
              // null-copy declared scores were indistinguishable and the
              // cross-coin count mixed them 1:9 (owner's run exposed it,
              // 2026-08-04 — QC 72).
              nullDealSeed: l.nullDealSeed ?? null,
              trade: l.trade, ctx1: l.ctx1, ctx2: l.ctx2, geometry: l.geometry, bandPct: res.bandPct,
              // layoutMeta only ever came from the retired quota layouts, so
              // this fallback stamped 'legacy' on split70/reserve61 rows —
              // the stored parameters are the truth (review 2026-08-03).
              windowLayout: res.layoutMeta ? res.layoutMeta.layout : (p.windowLayout || 'legacy'),
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
            const repKey = (r) => `${r.trade}|${r.ctx1 || ''}|${r.ctx2 || ''}|${r.geometry}`;
            doc.replication.sort((x, y) => (y.pnl - x.pnl) || (repKey(x) < repKey(y) ? -1 : repKey(x) > repKey(y) ? 1 : 0));
          }
        } else if (settled.ok && settled.value && !settled.value.best) {
        doc.slimResults = doc.slimResults || [];
        doc.slimResults.push({
          key, trade: c.trade, ctx1: c.ctx1, ctx2: c.ctx2,
          geometry: b.geometry, decision: b.decision,
          nullDealSeed: u.nullDealSeed ?? null,
          pnl: null, trades: null, holdPnl: null,
          noCell: `trained, but no cell reached ${p.minTrades} test trades (QC 74: recorded, not dropped)`,
        });
      } else if (!settled.ok && !doc.cancelRequested) {
          recordFailure(doc, l.key + '|promote', settled.error);
        }
        doc.perf.runsDone += slimViewsFor(l.size).length * 2;
        doc.progress = `promote ${i + 1}/${promote.length}: ${l.trade}${l.ctx1 ? '+' + l.ctx1 : ''}`;
        bracketPerfTick(doc);
        saveBatch(doc);
      });
    }
    pool.abort();
    if (activePool === pool) activePool = null;
    doc.status = doc.cancelRequested ? 'cancelled' : 'done';
    doc.perf.phase = 'done';
    doc.finishedAt = new Date().toISOString();
    doc.progress = '';
    saveBatch(doc);
  })().catch((err) => {
    try { pool.abort(); } catch { /* gone */ }
    if (activePool === pool) activePool = null;
    doc.status = 'error';
    doc.error = err.message || String(err);
    doc.finishedAt = new Date().toISOString();
    saveBatch(doc);
  });
  return doc.id;
}

// MINUTE CONFIRMATION for the selected row. Runs on the MAIN THREAD, one
// asset, on purpose: a minute window is ~700k candles, which is fine held once
// and released and decidedly not fine held by four workers beside their hourly
// maps. The existing batchRunning() mutex keeps it from overlapping a sweep.
function startBracketConfirm(id, target = 'best') {
  { const stop = launchRefusal(); if (stop) throw new Error(stop); }
  const doc = getBatch(id);
  if (!doc || doc.kind !== 'bracketlab') throw new Error('unknown bracket-lab run');
  const row = doc.selection;
  if (!row) throw new Error('select a promoted leader row first');

  // TWO things are worth confirming, and they are different cells.
  //   'best'     — the row that won the search on this combo.
  //   'declared' — the cell fixed before the run, recorded alongside it.
  // The declared one is usually the one that matters: it is the hypothesis
  // under test, and a search winner is rarely the config anybody intends to
  // trade. Only cells the run actually produced can be named — confirming an
  // arbitrary cell would defeat the point of confirming what was chosen.
  let sel = row;
  if (target === 'declared') {
    if (!row.declaredCell) throw new Error('this row carries no declared cell — was the run started with a declared config?');
    sel = { ...row, ...row.declaredCell };
  } else if (target !== 'best') {
    throw new Error("confirm target must be 'best' or 'declared'");
  }
  archivePrior(doc, 'confirm', doc.confirm); // QC 74: re-fire archives, never destroys
  doc.status = 'running';
  doc.cancelRequested = false;
  doc.perf.phase = 'confirm';
  doc.confirm = { status: 'running', startedAt: new Date().toISOString(), cell: sel, target };
  // Confirm reads the cache at ITS fire time — own stamp (QC 77).
  doc.confirm.dataManifest = stampManifest(`${doc.id}-confirm-${Date.now().toString(36)}`, [sel.trade, sel.ctx1, sel.ctx2].filter(Boolean));
  activeBatch = doc;
  saveBatch(doc);

  (async () => {
    const out = await confirmCell({
      combo: { trade: sel.trade, ctx1: sel.ctx1, ctx2: sel.ctx2, size: sel.size },
      branch: { geometry: sel.geometry, decision: sel.decision, band: sel.bandMode, weekdaysOnly: sel.weekdaysOnly },
      cell: sel,
      quorum: sel.quorum,
      params: doc.params,
      layoutArm: sel.layoutArm ?? null,
      onProgress: (msg) => {
        doc.progress = `confirm: ${msg}`;
        saveBatch(doc);
      },
    });
    // The self-check: the hourly re-score must reproduce what the board says,
    // or the minute number is being compared with a different trade.
    const recorded = sel.pnl;
    const drift = Math.abs(out.hourly.pnl - recorded);
    doc.confirm = {
      ...doc.confirm,
      status: 'done',
      finishedAt: new Date().toISOString(),
      ...out,
      recordedPnl: recorded,
      selfCheck: drift < 0.005
        ? 'PASS — hourly re-score reproduces the board row'
        : `FAIL — hourly re-score is ${out.hourly.pnl.toFixed(2)} against a recorded ${recorded.toFixed(2)}; the minute figure below is NOT comparable`,
      selfCheckOk: drift < 0.005,
    };
    doc.status = 'done';
    doc.perf.phase = 'done';
    doc.progress = '';
    saveBatch(doc);
  })().catch((err) => {
    doc.confirm = { ...(doc.confirm || {}), status: 'error', error: err.message || String(err) };
    doc.status = 'error';
    doc.error = err.message || String(err);
    doc.progress = '';
    saveBatch(doc);
  });
  return { started: true, symbol: sel.trade };
}

// Stage-2 selection: pin one leader row (by its key + stage) for the null.
function bracketSelect(id, patch) {
  const doc = getBatch(id);
  if (!doc || doc.kind !== 'bracketlab') throw new Error('unknown bracket-lab run');
  if (doc.status === 'running') throw new Error('sweep is still running');
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
    await pool.map('nullRotation', payloads, (settled, i) => {
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
      saveBatch(doc);
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

module.exports = {
  shiftStance,
  startWalkforward,
  wfParams,
  listRow,
  markInterrupted,
  startBatch,
  startConsensus,
  startMetalens,
  startPermScreen,
  startBracketLab,
  startHistoryTuning,
  startReserveGrade,
  idSlug,
  leaderCmp,
  bracketSelect,
  startBracketNull,
  startBracketConfirm,
  expandBracketPlan,
  promotionSet,
  setBatchNotes,
  validateDeclared,
  archivePrior,
  recordFailure,
  declaredQuorumFor,
  permSelect,
  startPermNull,
  permQuorumBook,
  permQuorumCall,
  permNullAggregate,
  summarizePermScreen,
  PERM_REGIMES,
  summarizeMetalens,
  getBatch,
  listBatches,
  batchRunning,
  cancelActive,
  summarize,
  summarizeConsensus,
  voteBook,
  gatesFromStored,
  SUPER_QUORUM,
  GATE_QUORUMS,
  DEFAULT_PAIRS,
  CONSENSUS_VIEWS,
  CONSENSUS_MODELS,
};
