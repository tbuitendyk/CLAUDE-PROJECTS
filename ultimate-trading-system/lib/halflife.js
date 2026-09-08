// halflife.js -- THE HISTORY HALF-LIFE RUN: the same records retrained with
// recent history weighted more (3.94.0, AGEDIAL-DESIGN.md, owner design of
// 2026-09-08: "4.h IS the same 199 records retrained").
//
// A Stage 4 record set's settings are kept exactly as they are. Only the
// forecasts behind them are retrained, once per half-life the owner ticked,
// with each training chunk's weight halving every H days of age, multiplied
// into whatever weighing the set was trained under. Then the same records
// are priced again on the stretch the retraining never touched: the Reserve
// for a 61/13/13/13 set, the Held window for a 70/15/15 set.
//
// WHAT IS HERE is the arithmetic and the one worker task: the retrain layout
// by the set's layout, the age weight, the members retrained, and the reading
// of the finished table (best per row, wins, averages). Running it -- the
// pricing through the stage 3 task, the record on the set, the file beside
// it -- is lib/stages.js's, because it owns every door.
//
// NO AI anywhere in this path: deterministic arithmetic over candles.
const bracketLib = require('./bracket');
const sw = require('./stagework');
const H = require('./history');

// the half-lives the owner may tick, in months; a month is the mean month
const HALF_LIVES_MONTHS = [12, 18, 24, 30, 36, 48];
const DAYS_PER_MONTH = 30.4375;
const daysOfMonths = (months) => Math.round(Number(months) * DAYS_PER_MONTH);
const keyOf = (months) => `h${months}`;
const NONE = 'none';   // the unweighted, not-retrained column, always last

// THE RETRAIN LAYOUT BY THE SET'S OWN (owner design): a 61/13/13/13 set
// retrains on the first 72% and tests on the next 15%, the Reserve untouched;
// a 70/15/15 set retrains on the same 70% and tests on the same 15%, the Held
// window untouched. The layout names are the engine's (unitChunks); the
// screen says the shares.
function retrainLayoutOf(windowLayout) {
  if (windowLayout === 'reserve61') return { layout: 'retrain72', judge: 'reserve', judgeWord: 'Reserve', train: 72, test: 15, untouched: 13 };
  if (windowLayout === 'split70') return { layout: 'split70', judge: 'hold', judgeWord: 'Held', train: 70, test: 15, untouched: 15 };
  throw new Error(`no half-life run for a set built on the '${windowLayout || 'unknown'}' layout — it needs 61/13/13/13 or 70/15/15`);
}

// THE WEIGHT: 0.5 ^ (age / H), age being the days from a training chunk's
// start to the last training chunk's start, multiplied into the set's own
// training weights (money weights and cap, or none). effectiveDays is the
// sum of the age weights alone: how much training the members actually saw.
function halfLifeWeights(p, trainChunks, fee, halfLifeDays) {
  const base = sw.weightsFor(p, trainChunks, fee);
  const endTs = trainChunks.length ? trainChunks[trainChunks.length - 1].startTs : 0;
  const { weights: age, effectiveDays } = H.ageWeights(trainChunks.map((c) => ({ endTs: c.startTs })), endTs, halfLifeDays);
  const weights = age.map((a, i) => a * (base ? base[i] : 1));
  return { weights, effectiveDays, weighedByMoney: !!base };
}

// TASK: one unit's members retrained at one half-life (worker-safe). The
// members and their views are the stage 2 record's specs; the chunks are the
// retrain layout's; the votes on the test slice (and the held-back slice for
// 70/15/15) come back with each member's saved model and probe votes, in the
// shape the stage 3 task reads.
async function hlTrainTask(task) {
  const { combo, geometry, specs, fee, halfLifeMonths } = task;
  const halfLifeDays = daysOfMonths(halfLifeMonths);
  const pin = task.pin && typeof task.pin === 'string' ? require('./pin').pinnedFilesOf({ detailFile: task.pin }) : null;
  const p = { ...task.params, pinnedFiles: pin };
  const { geo, split, windows } = await sw.unitChunks(combo, geometry, p);
  const { trainChunks, testChunks, holdChunks } = split;
  const { weights, effectiveDays, weighedByMoney } = halfLifeWeights(p, trainChunks, fee, halfLifeDays);
  // A STARVED HALF-LIFE IS REFUSED FOR ITS COLUMN, in the floor's own words,
  // and the other columns still run.
  const floor = H.floorRefusal(effectiveDays, `half-life ${halfLifeMonths} months`);
  if (floor) return { halfLifeMonths, halfLifeDays, effectiveDays, refused: floor };
  const views = bracketLib.comboViews(combo.size, geo.featureHours / 24).views;
  const predictChunks = holdChunks.length ? [...testChunks, ...holdChunks] : testChunks;
  const members = [];
  for (const spec of specs) {
    const viewIdx = views[spec.view];
    if (!viewIdx) throw new Error(`no view called '${spec.view}' on this unit`);
    // eslint-disable-next-line no-await-in-loop
    const m = await sw.trainProbMember({ model: spec.model, viewIdx, trainChunks, predictChunks, weights });
    members.push({ spec: { model: spec.model, view: spec.view }, saved: m.saved, picked: m.picked, tauProbs: m.tauProbs, probs: m.probs });
  }
  return {
    halfLifeMonths, halfLifeDays, effectiveDays, weighedByMoney, refused: null,
    trainedBandPct: split.bandPct, windows,
    counts: { train: trainChunks.length, test: testChunks.length, hold: holdChunks.length },
    ts: { test: testChunks.map((c) => c.startTs), hold: holdChunks.map((c) => c.startTs) },
    members,
  };
}

// THE TABLE, READ: one row per record, a money column per half-life from
// shortest to longest and the unweighted column last. The best of a row is
// green: a half-life wins only when it beats the unweighted money by at least
// a cent (the Funnel's own rule); a tie goes to the unweighted side; among
// half-lives that tie, the shorter one. A column a half-life was refused on,
// or a record with no figure in a column, is not in the running there.
const cents = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
function bestOf(money, columns) {
  const none = cents(money[NONE]);
  let best = null;
  for (const c of columns) {
    if (c.key === NONE) continue;
    const v = cents(money[c.key]);
    if (v == null) continue;
    if (best == null || v > best.v) best = { key: c.key, v };
  }
  if (!best) return none == null ? null : NONE;
  if (none == null) return best.key;
  return best.v >= none + 1 ? best.key : NONE;
}
function readTable(rows, columns) {
  const wins = {};
  const sums = {};
  const counts = {};
  for (const c of columns) { wins[c.key] = 0; sums[c.key] = 0; counts[c.key] = 0; }
  const out = rows.map((r) => {
    const best = bestOf(r.money || {}, columns);
    if (best) wins[best]++;
    for (const c of columns) {
      const v = (r.money || {})[c.key];
      if (v != null && Number.isFinite(Number(v))) { sums[c.key] += Number(v); counts[c.key]++; }
    }
    return { ...r, best };
  });
  const averages = {};
  for (const c of columns) averages[c.key] = counts[c.key] ? sums[c.key] / counts[c.key] : null;
  return { rows: out, wins, averages, counts };
}

module.exports = {
  HALF_LIVES_MONTHS, DAYS_PER_MONTH, NONE, daysOfMonths, keyOf,
  retrainLayoutOf, halfLifeWeights, hlTrainTask, bestOf, readTable, cents,
};
