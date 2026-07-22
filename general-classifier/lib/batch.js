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

// Rank runs for the summary: by edge over the majority baseline, then by
// balanced-accuracy edge. Failed runs sink to the bottom with their errors.
function summarize(runs) {
  const done = runs.filter((r) => r.status === 'done');
  const failed = runs.filter((r) => r.status === 'error');
  const ranked = [...done].sort((a, b) => {
    const e = (b.metrics.edge ?? -1) - (a.metrics.edge ?? -1);
    if (e !== 0) return e;
    return (b.metrics.balancedEdge ?? -1) - (a.metrics.balancedEdge ?? -1);
  });
  return {
    ranked: ranked.map((r) => ({ trade: r.trade, compare: r.compare, model: r.model, ...r.metrics })),
    failed: failed.map((r) => ({ trade: r.trade, compare: r.compare, model: r.model, error: r.error })),
    positiveEdge: ranked.filter((r) => r.metrics.edge > 0).length,
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
  } = params || {};

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
  const doc = {
    id: `screen-${stamp}`,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: '',
    params: { dormantPct, startMonth, endMonth, featureSet, compareSymbol, models },
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
    doc.status = 'done';
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

module.exports = { startBatch, getBatch, listBatches, batchRunning, summarize, DEFAULT_PAIRS };
