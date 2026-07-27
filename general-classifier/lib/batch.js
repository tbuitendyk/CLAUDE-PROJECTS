const fs = require('fs');
const path = require('path');
const { runAnalysis, extractMetrics } = require('./pipeline');
const { runMetaLens, extractMetaMetrics } = require('./metalens');
const { pnlAt, REAL_FEE_PER_LEG, voteOf, superOf } = require('./paper');

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
      if (doc.nullTest && doc.nullTest.status === 'running') doc.nullTest.status = 'interrupted';
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
    // $100 paper book over the test window, not the luckiest one's.
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
  if (batchRunning()) throw new Error(`batch ${activeBatch.id} is already running`);
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
  const nShifts = Math.min(1000, Math.max(0, Math.floor(Number(nullShifts) || 0)));

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
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
  if (batchRunning()) throw new Error(`batch ${activeBatch.id} is already running`);
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

  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
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
    doc.selection.members = members;
    doc.selection.rungs = [];
    doc.nullTest = null;
    const periods = doc.perms[pair].periods;
    const callArrays = members.map((m) => valid[m].calls);
    const fee = doc.params.feePerLeg ?? REAL_FEE_PER_LEG;
    const rows = [];
    for (let k = 1; k <= members.length; k++) rows.push(permQuorumBook(periods, callArrays, k, fee));
    rows.sort((a, b) => b.pnl - a.pnl);
    doc.quorums = { pair, members, rows, computedAt: new Date().toISOString() };
  }
  if (patch.rungs !== undefined) {
    if (!doc.quorums) throw new Error('compute the quorum table first (pick members)');
    const n = doc.selection.members.length;
    const rungs = [...new Set(patch.rungs.map(Number))].filter((k) => Number.isInteger(k) && k >= 1 && k <= n);
    if (!rungs.length) throw new Error('pick at least one quorum rung');
    doc.selection.rungs = rungs.sort((a, b) => a - b);
    doc.nullTest = null;
  }
  saveBatch(doc);
  return doc;
}

// Stage 6: null-calibrate the FROZEN selection. Retrains only the selected
// members per label rotation and scores only the selected rungs.
function startPermNull(id, shifts) {
  if (batchRunning()) throw new Error(`batch ${activeBatch.id} is already running`);
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
  doc.runs = doc.runs.filter((r) => !r.shift); // a re-fire replaces any older null runs
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
const { toHourlyMap, forwardFill, scoreDiff, balancedBandPct, GEOMETRIES: GEOS } = require('./dataset');
const { loadSymbol, loadSymbolAll, monthList, deriveShift, MIN_CHUNKS, interlacedPurge } = require('./pipeline');

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
const unitKey = (c, b) => `${c.trade}|${c.ctx1 || ''}|${c.ctx2 || ''}|${b.geometry}|${b.decision}|${b.band}|${b.weekdaysOnly ? '24-5' : '24-7'}`;

function bracketPerfTick(doc) {
  const perf = doc.perf;
  const elapsed = Date.now() - new Date(doc.startedAt).getTime();
  perf.elapsedMs = elapsed;
  perf.ratePerMin = perf.runsDone ? (perf.runsDone / elapsed) * 60_000 : null;
  perf.secPerTraining = perf.runsDone ? elapsed / perf.runsDone / 1000 : null;
  perf.etaMs = perf.runsDone ? (elapsed / perf.runsDone) * (perf.runsTotal - perf.runsDone) : null;
}

function pushLeader(doc, row) {
  doc.leaders.push(row);
  doc.leaders.sort((a, b) => b.pnl - a.pnl);
  if (doc.leaders.length > (doc.params.detailK || 50)) doc.leaders.length = doc.params.detailK || 50;
}

// One unit end-to-end: build the combo dataset for a branch, train members,
// vote, sweep the execution menu, return the best cell (or null) plus the
// pieces the promoted stage / null replay need. memberSpec chooses slim
// (logreg over views, full window) or full grid (both models × 2 windows).
async function runBracketUnit(doc, combo, branch, stage, getMap, onRun) {
  const geo = GEOS[branch.geometry];
  const nDays = geo.featureHours / 24;
  const maps = {
    trade: await getMap(combo.trade),
    ctx1: combo.ctx1 ? await getMap(combo.ctx1) : null,
    ctx2: combo.ctx2 ? await getMap(combo.ctx2) : null,
  };
  const { chunks } = bracketLib.buildComboChunks(maps, branch.geometry, branch.weekdaysOnly);
  if (chunks.length < MIN_CHUNKS) throw new Error(`only ${chunks.length} labelable chunks`);
  const nTest = Math.max(2, Math.round(chunks.length * 0.2));
  const trainChunks = chunks.slice(0, chunks.length - nTest);
  const testChunks = chunks.slice(chunks.length - nTest);
  const bandPct = branch.band === 'auto' ? balancedBandPct(trainChunks.map((c) => c.diffPct)) : Math.abs(branch.band);
  for (const c of chunks) c.label = scoreDiff(c.diffPct / 100, bandPct / 100);
  const views = bracketLib.comboViews(combo.size, nDays).views;
  const specs = [];
  for (const v of slimViewsFor(combo.size)) {
    if (stage === 'slim') specs.push({ model: 'logreg', view: v, regime: 'full' });
    else for (const model of ['logreg', 'boost']) for (const regime of ['full', 'interlaced']) specs.push({ model, view: v, regime });
  }
  const memberCalls = [];
  for (const spec of specs) {
    if (doc.cancelRequested) throw new Error('cancelled');
    const fit = spec.regime === 'interlaced' ? interlacedPurge(trainChunks, geo) : trainChunks;
    const { calls } = await bracketLib.trainMember({
      model: spec.model,
      viewIdx: views[spec.view],
      trainChunks: fit,
      testChunks,
      decision: branch.decision,
      tradeMap: maps.trade,
      geo,
    });
    memberCalls.push(calls);
    onRun(`${combo.trade}${combo.ctx1 ? '+' + combo.ctx1 : ''}${combo.ctx2 ? '+' + combo.ctx2 : ''}/${branch.geometry}/${spec.regime}/${spec.view}/${spec.model}`);
  }
  // committee streams: majority vote (slim) plus, at the promoted stage,
  // every quorum rung over the full member set — all swept mechanically
  const fee = doc.params.feePerLeg;
  const streams = [];
  const vote = testChunks.map((_, i) => permQuorumCall(memberCalls, i, 1));
  streams.push({ quorum: 1, calls: vote });
  if (stage === 'promoted') {
    for (let k = 2; k <= memberCalls.length; k++) streams.push({ quorum: k, calls: testChunks.map((_, i) => permQuorumCall(memberCalls, i, k)) });
  }
  let best = null;
  for (const s of streams) {
    const cell = bracketLib.bestCell(bracketLib.execSweep(testChunks, s.calls, maps.trade, geo, bandPct, fee), doc.params.minTrades);
    if (cell && (!best || cell.pnl > best.pnl)) best = { ...cell, quorum: s.quorum, members: memberCalls.length };
  }
  return { best, bandPct, testPeriods: testChunks.length, chunks, testChunks, trainChunks, memberCalls, maps, geo };
}

function startBracketLab(params) {
  if (batchRunning()) throw new Error(`batch ${activeBatch.id} is already running`);
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
    promoteK: Math.min(100, Math.max(1, Number(params.promoteK) || 25)),
    minTrades: Math.max(1, Number(params.minTrades) || 10),
    detailK: 50,
    feePerLeg: REAL_FEE_PER_LEG,
    dMults: bracketLib.D_MULTS,
    tHours: bracketLib.T_HOURS,
    gates: bracketLib.GATES,
  };
  if (!p.sizes.singles && !p.sizes.doubles && !p.sizes.triples) throw new Error('tick at least one combo size');
  const { branches, combos } = expandBracketPlan(p);
  const units = [];
  for (const b of branches) for (const c of combos) units.push({ c, b });
  const slimRuns = units.reduce((s, u) => s + slimViewsFor(u.c.size).length, 0);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
  const doc = {
    id: `bracketlab-${stamp}`,
    kind: 'bracketlab',
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    progress: '',
    params: p,
    plan: { branches: branches.length, combos: combos.length, units: units.length, slimRuns, promoteRuns: null },
    perf: { phase: 'slim', unitsDone: 0, unitsTotal: units.length, runsDone: 0, runsTotal: slimRuns, ratePerMin: null, secPerTraining: null, elapsedMs: 0, etaMs: null },
    leaders: [],
    failures: [],
    selection: null,
    nullTest: null,
    runs: [], // kept empty by design: at permutation scale, counters + leaders ARE the record
  };
  activeBatch = doc;
  saveBatch(doc);

  // Symbol maps are branch-independent; a small LRU keeps memory bounded on
  // full-universe sweeps while giving near-perfect hit rates on sorted units.
  const mapCache = new Map();
  const getMap = async (sym) => {
    if (mapCache.has(sym)) {
      const v = mapCache.get(sym);
      mapCache.delete(sym);
      mapCache.set(sym, v);
      return v;
    }
    const loaded = p.allLoaded ? await loadSymbolAll(sym, () => {}) : await loadSymbol(sym, monthList(p.startMonth, p.endMonth), () => {});
    if (!loaded.rows.length) throw new Error(`no data for ${sym}`);
    const filled = forwardFill(toHourlyMap(loaded.rows)).map;
    mapCache.set(sym, filled);
    if (mapCache.size > 8) mapCache.delete(mapCache.keys().next().value);
    return filled;
  };

  (async () => {
    for (const { c, b } of units) {
      if (doc.cancelRequested) break;
      const key = unitKey(c, b);
      try {
        const res = await runBracketUnit(doc, c, b, 'slim', getMap, (tag) => {
          doc.perf.runsDone++;
          doc.progress = `slim ${doc.perf.unitsDone + 1}/${units.length}: ${tag}`;
          bracketPerfTick(doc);
        });
        if (res.best) {
          pushLeader(doc, {
            key,
            stage: 'slim',
            trade: c.trade,
            ctx1: c.ctx1,
            ctx2: c.ctx2,
            size: c.size,
            geometry: b.geometry,
            decision: b.decision,
            bandMode: b.band,
            bandPct: res.bandPct,
            weekdaysOnly: b.weekdaysOnly,
            testPeriods: res.testPeriods,
            ...res.best,
          });
        }
      } catch (err) {
        if (doc.failures.length < 200) doc.failures.push({ key, error: err.message || String(err) });
      }
      doc.perf.unitsDone++;
      bracketPerfTick(doc);
      saveBatch(doc);
    }
    // ---- promotion: top-K slim survivors re-run on the full member grid ----
    if (!doc.cancelRequested) {
      const promote = doc.leaders.filter((l) => l.stage === 'slim').slice(0, p.promoteK);
      doc.plan.promoteRuns = promote.reduce((s, l) => s + slimViewsFor(l.size).length * 4, 0);
      doc.perf.runsTotal += doc.plan.promoteRuns;
      doc.perf.phase = 'promote';
      let i = 0;
      for (const l of promote) {
        if (doc.cancelRequested) break;
        i++;
        const c = { trade: l.trade, ctx1: l.ctx1, ctx2: l.ctx2, size: l.size };
        const b = { geometry: l.geometry, decision: l.decision, band: l.bandMode, weekdaysOnly: l.weekdaysOnly };
        try {
          const res = await runBracketUnit(doc, c, b, 'promoted', getMap, (tag) => {
            doc.perf.runsDone++;
            doc.progress = `promote ${i}/${promote.length}: ${tag}`;
            bracketPerfTick(doc);
          });
          if (res.best) pushLeader(doc, { ...l, stage: 'promoted', ...res.best });
        } catch (err) {
          if (doc.failures.length < 200) doc.failures.push({ key: l.key + '|promote', error: err.message || String(err) });
        }
        bracketPerfTick(doc);
        saveBatch(doc);
      }
    }
    doc.status = doc.cancelRequested ? 'cancelled' : 'done';
    doc.perf.phase = 'done';
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

// Stage-2 selection: pin one leader row (by its key + stage) for the null.
function bracketSelect(id, patch) {
  const doc = getBatch(id);
  if (!doc || doc.kind !== 'bracketlab') throw new Error('unknown bracket-lab run');
  if (doc.status === 'running') throw new Error('sweep is still running');
  const row = doc.leaders.find((l) => l.key === patch.key && l.stage === (patch.stage || 'promoted'));
  if (!row) throw new Error('unknown leader row (promoted rows are the null candidates)');
  doc.selection = row;
  doc.nullTest = null;
  saveBatch(doc);
  return doc;
}

// Null replay for the selected survivor: per rotation, retrain the unit's
// full member grid on rotated labels and give the null EVERY freedom the
// real machine had downstream of the combo — the whole execution menu and
// all quorum rungs, best cell taken by the same declared rule. Also scores
// the selected config's own cell for the conditional reading. Live tables.
function startBracketNull(id, shifts) {
  if (batchRunning()) throw new Error(`batch ${activeBatch.id} is already running`);
  const doc = getBatch(id);
  if (!doc || doc.kind !== 'bracketlab') throw new Error('unknown bracket-lab run');
  const sel = doc.selection;
  if (!sel) throw new Error('select a promoted leader row first');
  const nShifts = Math.min(1000, Math.max(1, Math.floor(Number(shifts) || 0)));
  const p = doc.params;
  doc.status = 'running';
  doc.cancelRequested = false;
  doc.perf.phase = 'null';
  doc.perf.runsTotal += nShifts * slimViewsFor(sel.size).length * 4;
  doc.nullTest = { status: 'running', requestedShifts: nShifts, startedAt: new Date().toISOString(), real: { pnl: sel.pnl, trades: sel.trades }, samples: {}, shifts: 0, exceedSearch: null, exceedSame: null, medianBestPnl: null, medianSamePnl: null };
  activeBatch = doc;
  saveBatch(doc);

  const mapCache = new Map();
  const getMap = async (sym) => {
    if (mapCache.has(sym)) return mapCache.get(sym);
    const loaded = p.allLoaded ? await loadSymbolAll(sym, () => {}) : await loadSymbol(sym, monthList(p.startMonth, p.endMonth), () => {});
    const filled = forwardFill(toHourlyMap(loaded.rows)).map;
    mapCache.set(sym, filled);
    return filled;
  };
  const c = { trade: sel.trade, ctx1: sel.ctx1, ctx2: sel.ctx2, size: sel.size };
  const b = { geometry: sel.geometry, decision: sel.decision, band: sel.bandMode, weekdaysOnly: sel.weekdaysOnly };

  (async () => {
    for (let s = 1; s <= nShifts; s++) {
      if (doc.cancelRequested) break;
      try {
        // rotate the label side across chunks (pipeline semantics), then
        // re-run the ENTIRE downstream machine on the rotated world
        const geo = GEOS[b.geometry];
        const maps = { trade: await getMap(c.trade), ctx1: c.ctx1 ? await getMap(c.ctx1) : null, ctx2: c.ctx2 ? await getMap(c.ctx2) : null };
        const { chunks } = bracketLib.buildComboChunks(maps, b.geometry, b.weekdaysOnly);
        const rot = deriveShift(chunks.length, s / (nShifts + 1));
        const src = chunks.map((ch) => ch.diffPct);
        for (let i = 0; i < chunks.length; i++) chunks[i].diffPct = src[(i + rot) % chunks.length];
        const nTest = Math.max(2, Math.round(chunks.length * 0.2));
        const trainChunks = chunks.slice(0, chunks.length - nTest);
        const testChunks = chunks.slice(chunks.length - nTest);
        const bandPct = b.band === 'auto' ? balancedBandPct(trainChunks.map((ch) => ch.diffPct)) : Math.abs(b.band);
        for (const ch of chunks) ch.label = scoreDiff(ch.diffPct / 100, bandPct / 100);
        const views = bracketLib.comboViews(c.size, geo.featureHours / 24).views;
        const memberCalls = [];
        for (const v of slimViewsFor(c.size)) {
          for (const model of ['logreg', 'boost']) {
            for (const regime of ['full', 'interlaced']) {
              if (doc.cancelRequested) throw new Error('cancelled');
              const fit = regime === 'interlaced' ? interlacedPurge(trainChunks, geo) : trainChunks;
              const { calls } = await bracketLib.trainMember({ model, viewIdx: views[v], trainChunks: fit, testChunks, decision: b.decision, tradeMap: maps.trade, geo });
              memberCalls.push(calls);
              doc.perf.runsDone++;
              doc.progress = `null ${s}/${nShifts}: ${v}/${model}/${regime}`;
              bracketPerfTick(doc);
            }
          }
        }
        let bestOfMenu = null;
        let sameCell = null;
        for (let k = 1; k <= memberCalls.length; k++) {
          const stream = testChunks.map((_, i) => permQuorumCall(memberCalls, i, k));
          const rows = bracketLib.execSweep(testChunks, stream, maps.trade, geo, bandPct, p.feePerLeg);
          const cell = bracketLib.bestCell(rows, p.minTrades);
          if (cell && (!bestOfMenu || cell.pnl > bestOfMenu.pnl)) bestOfMenu = cell;
          if (k === sel.quorum) {
            const same = rows.find((r) => r.gate === sel.gate && r.dMult === sel.dMult && r.tHours === sel.tHours);
            if (same) sameCell = same;
          }
        }
        doc.nullTest.samples[rot] = { best: bestOfMenu ? bestOfMenu.pnl : -Infinity, same: sameCell ? sameCell.pnl : null, sameTrades: sameCell ? sameCell.trades : null };
        const vals = Object.values(doc.nullTest.samples);
        doc.nullTest.shifts = vals.length;
        doc.nullTest.exceedSearch = vals.filter((x) => x.best >= sel.pnl).length / vals.length;
        const sames = vals.filter((x) => x.same != null);
        doc.nullTest.exceedSame = sames.length ? sames.filter((x) => x.same >= sel.pnl).length / sames.length : null;
        doc.nullTest.medianBestPnl = median(vals.map((x) => (x.best === -Infinity ? 0 : x.best)));
        doc.nullTest.medianSamePnl = sames.length ? median(sames.map((x) => x.same)) : null;
      } catch (err) {
        if (doc.failures.length < 200) doc.failures.push({ key: `null-shift-${s}`, error: err.message || String(err) });
      }
      saveBatch(doc);
    }
    doc.nullTest.status = doc.cancelRequested ? 'cancelled' : 'done';
    doc.nullTest.finishedAt = new Date().toISOString();
    doc.status = doc.cancelRequested ? 'cancelled' : 'done';
    doc.perf.phase = 'done';
    doc.progress = '';
    saveBatch(doc);
  })().catch((err) => {
    doc.nullTest = { ...(doc.nullTest || {}), status: 'error', error: err.message || String(err) };
    doc.status = 'error';
    doc.error = err.message || String(err);
    saveBatch(doc);
  });
  return { started: true, shifts: nShifts };
}

module.exports = {
  startBatch,
  startConsensus,
  startMetalens,
  startPermScreen,
  startBracketLab,
  bracketSelect,
  startBracketNull,
  expandBracketPlan,
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
