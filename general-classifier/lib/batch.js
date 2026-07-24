const fs = require('fs');
const path = require('path');
const { runAnalysis, extractMetrics } = require('./pipeline');

// Pair screen: run the full pipeline for every (trade pair x model) combo
// against one compare pair, sequentially, persisting after every run so a
// crash loses at most the run in flight. Results live in data/batches/
// (survives deploys — install.sh rsync excludes data/).

const BATCH_DIR = path.join(__dirname, '..', 'data', 'batches');

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
(() => {
  try {
    for (const f of fs.readdirSync(BATCH_DIR)) {
      if (!f.endsWith('.json')) continue;
      const file = path.join(BATCH_DIR, f);
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (doc.status !== 'running') continue;
      for (const r of doc.runs) if (r.status === 'running') r.status = 'error';
      doc.status = 'interrupted';
      doc.finishedAt = doc.finishedAt || new Date().toISOString();
      doc.progress = '';
      fs.writeFileSync(file, JSON.stringify(doc, null, 1));
    }
  } catch {
    /* no batch dir yet */
  }
})();

function batchFile(id) {
  return path.join(BATCH_DIR, `${id}.json`);
}

function saveBatch(doc) {
  fs.mkdirSync(BATCH_DIR, { recursive: true });
  fs.writeFileSync(batchFile(doc.id), JSON.stringify(doc, null, 1));
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
        const d = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, f), 'utf8'));
        return {
          id: d.id,
          status: d.status,
          startedAt: d.startedAt,
          finishedAt: d.finishedAt || null,
          runsDone: d.runs.filter((r) => r.status !== 'pending').length,
          runsTotal: d.runs.length,
          params: d.params,
        };
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
    return JSON.parse(fs.readFileSync(batchFile(id), 'utf8'));
  } catch {
    return null;
  }
}

function batchRunning() {
  return activeBatch && activeBatch.status === 'running' ? activeBatch.id : null;
}

// Owner's kill switch: flag the active batch so its loop stops at the next
// run boundary (the throttle-level abort kills the in-flight run itself).
function cancelActive() {
  if (!batchRunning()) return null;
  activeBatch.cancelRequested = true;
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

function startBatch(params) {
  if (batchRunning()) throw new Error(`batch ${activeBatch.id} is already running`);
  const {
    dormantPct = 5,
    startMonth = '2018-01',
    endMonth = '2026-06',
    featureSet = 'compressed',
    compareSymbol = 'BTCUSDT',
    pairs = DEFAULT_PAIRS,
    models = ['logreg', 'boost'],
    geometry = 'weekly-8d',
    allLoaded = false,
  } = params || {};

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
  const doc = {
    id: `screen-${stamp}`,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: '',
    params: { dormantPct, startMonth, endMonth, featureSet, compareSymbol, models, geometry, allLoaded },
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
  return {
    specs: specs.length,
    positive,
    fraction: specs.length ? positive / specs.length : 0,
    medianTrueEdge: median(edges),
    medianBalancedAcc: median(specs.map((r) => r.metrics.balancedAcc).filter((v) => v != null)),
  };
}

function summarizeConsensus(runs) {
  const done = runs.filter((r) => r.status === 'done');
  const failed = runs.filter((r) => r.status === 'error');
  const pairs = [...new Set(runs.map((r) => r.trade))];
  const perPair = pairs
    .map((trade) => {
      const real = consensusOf(done.filter((r) => r.trade === trade && !r.shift));
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
      return { trade, ...real, null: nullStats };
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
  if (batchRunning()) throw new Error(`batch ${activeBatch.id} is already running`);
  const {
    startMonth = '2018-01',
    endMonth = '2026-06',
    compareSymbol = 'BTCUSDT',
    pairs = DEFAULT_PAIRS,
    nullShifts = 0,
    geometry = 'weekly-8d',
    allLoaded = false,
  } = params || {};
  const nShifts = Math.min(1000, Math.max(0, Math.floor(Number(nullShifts) || 0)));

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
  const doc = {
    id: `consensus-${stamp}`,
    kind: 'consensus',
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: '',
    params: {
      dormantPct: 'auto',
      startMonth,
      endMonth,
      featureSet: 'compressed',
      compareSymbol,
      views: CONSENSUS_VIEWS,
      models: CONSENSUS_MODELS,
      nullShifts: nShifts,
      geometry,
      allLoaded,
    },
    runs: [],
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

  (async () => {
    for (const run of doc.runs) {
      if (doc.cancelRequested) break;
      run.status = 'running';
      const tag = `${run.trade}/${run.view}/${run.model}${run.shift ? `/shift${run.shift}` : ''}`;
      doc.progress = tag;
      try {
        const report = await runAnalysis(
          {
            dormantPct: 'auto',
            tradeSymbol: run.trade,
            compareSymbol: run.compare,
            startMonth,
            endMonth,
            featureSet: 'compressed',
            model: run.model,
            featureView: run.view,
            labelShiftFrac: run.shift > 0 ? run.shift / (nShifts + 1) : 0,
            geometry,
            allLoaded,
          },
          (p) => {
            doc.progress = `${tag}: ${p}`;
          }
        );
        run.metrics = extractMetrics(report);
        run.effectiveShift = report.params.labelShift || 0;
        run.status = 'done';
      } catch (err) {
        run.status = 'error';
        run.error = err.message || String(err);
      }
      doc.summary = summarizeConsensus(doc.runs);
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

module.exports = {
  startBatch,
  startConsensus,
  getBatch,
  listBatches,
  batchRunning,
  cancelActive,
  summarize,
  summarizeConsensus,
  DEFAULT_PAIRS,
  CONSENSUS_VIEWS,
  CONSENSUS_MODELS,
};
