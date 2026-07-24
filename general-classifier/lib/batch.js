const fs = require('fs');
const path = require('path');
const { runAnalysis, extractMetrics } = require('./pipeline');
const { pnlFor, voteOf, superOf } = require('./paper');

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
    const doc = JSON.parse(fs.readFileSync(batchFile(id), 'utf8'));
    // The runs are the record; the summary is derived. Rebuild it on read so
    // docs saved by older versions pick up new summary fields (e.g. median
    // paper P&L) without re-running anything.
    if (doc.summary && Array.isArray(doc.runs)) {
      doc.summary = doc.kind === 'consensus' ? summarizeConsensus(doc.runs, doc.votes || null) : summarize(doc.runs);
    }
    return doc;
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
    decision = 'argmax',
    weekdaysOnly = false,
    allLoaded = false,
  } = params || {};

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
  const doc = {
    id: `screen-${stamp}`,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: '',
    params: { dormantPct, startMonth, endMonth, featureSet, compareSymbol, models, geometry, decision, weekdaysOnly, allLoaded },
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
  const rows = group.rows.map((r, i) => {
    const calls = group.preds.map((p) => p[i]);
    const vote = voteOf(calls);
    const sup = superOf(calls, SUPER_QUORUM);
    const priced = r.entry != null && r.exit != null;
    return {
      week: r.week,
      vote,
      sup,
      actual: r.actual,
      entry: r.entry,
      exit: r.exit,
      pnl: priced ? pnlFor(vote, r.entry, r.exit) : null,
      supPnl: priced ? pnlFor(sup, r.entry, r.exit) : null,
    };
  });
  const bookStats = (callKey, pnlKey) => {
    const priced = rows.filter((r) => r[pnlKey] != null);
    const trades = priced.filter((r) => r[callKey] !== 0);
    const correct = rows.filter((r) => r[callKey] === r.actual).length;
    const acc = rows.length ? correct / rows.length : null;
    return {
      pnl: priced.reduce((s, r) => s + r[pnlKey], 0),
      trades: trades.length,
      wins: trades.filter((r) => r[pnlKey] > 0).length,
      unpriced: rows.length - priced.length,
      scored: rows.length,
      acc,
      trueEdge: acc != null && group.bestConstant != null ? acc - group.bestConstant : null,
      specsInVote: group.preds.length,
    };
  };
  return { stats: bookStats('vote', 'pnl'), superStats: bookStats('sup', 'supPnl'), rows };
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
    // $100 paper book over the test window, not the luckiest one's.
    medianPaperPnl: pnls.length ? median(pnls) : null,
    positivePaper: pnls.filter((v) => v > 0).length,
  };
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
      const voteStats = vt && vt.real ? (({ rows, specPreds, super: sup, ...stats }) => stats)(vt.real) : null;
      const superStats = vt && vt.real ? vt.real.super || null : null;
      let nullVote = null;
      if (voteStats && vt.nulls) {
        const nv = Object.values(vt.nulls);
        if (nv.length) {
          nullVote = {
            shifts: nv.length,
            exceedPnl: nv.filter((s) => s.pnl >= vt.real.pnl).length / nv.length,
            exceedEdge: nv.filter((s) => (s.trueEdge ?? -Infinity) >= (vt.real.trueEdge ?? -Infinity)).length / nv.length,
            medianPnl: median(nv.map((s) => s.pnl)),
          };
          const nvS = nv.filter((s) => s.super);
          if (superStats && nvS.length) {
            nullVote.superShifts = nvS.length;
            nullVote.superExceedPnl = nvS.filter((s) => s.super.pnl >= superStats.pnl).length / nvS.length;
            nullVote.superExceedEdge = nvS.filter((s) => (s.super.trueEdge ?? -Infinity) >= (superStats.trueEdge ?? -Infinity)).length / nvS.length;
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
      return { trade, ...real, vote: voteStats, superVote: superStats, nullVote, null: nullStats };
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
    decision = 'argmax',
    dormantPct = 'auto', // manual wide bands (big-move hunter) allowed; 'auto' = classic
    weekdaysOnly = false,
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
              rows: book.rows,
              specPreds: Object.fromEntries(group.specKeys.map((k, i) => [k, group.preds[i]])),
            };
          } else {
            v.nulls[group.effectiveShift] = { ...book.stats, super: book.superStats };
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

module.exports = {
  startBatch,
  startConsensus,
  getBatch,
  listBatches,
  batchRunning,
  cancelActive,
  summarize,
  summarizeConsensus,
  voteBook,
  SUPER_QUORUM,
  DEFAULT_PAIRS,
  CONSENSUS_VIEWS,
  CONSENSUS_MODELS,
};
