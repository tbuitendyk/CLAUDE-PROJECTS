// TABLE 3.C: EVERY UNIT (3.230.0, owner order 2026-09-22: "we need a new
// table/view (with stored filters) called 'Table 3.C: Every unit' ... the
// point of this thing is to filter out garbage units before wasting time with
// funneling them").
//
// One row per coin and shape, worked out from that coin and shape's own board
// -- its records, the numbers the pass beside the set rebuilt for them, and
// the four things a rule has to beat on its test window. Every column here is
// a reading the owner can filter on and sort by, and the filter is stored on
// the record set so the Funnel reads it: the coin and shape box, Worth
// walking?, all units together and the rule steps see only the coins and
// shapes the filter keeps.
//
// EVERYTHING IN THIS FILE IS ARITHMETIC ON ROWS HANDED TO IT. No file, no set,
// no window: a test types a board in and reads the row out, and the builder in
// lib/stages.js hands it the real boards one at a time.
//
// WITH AND WITHOUT THE FIELD'S GATE, from what the records already hold (owner:
// "IF AVAILABLE WITHOUT RE-RUNNING SWEEP 3"). A record priced under a gate
// keeps, on its test window, the money at the rungs' sizes (which is the
// record's own test money), the same placed trades at size 1, and the blocked
// calls at size 1. Every call at size 1 with no gate is the placed trades at
// size 1 plus the blocked calls at size 1 -- the very baseline the field
// verdict reads. So both numbers come off the record, and a set priced with no
// gate reads the same figure in both columns, which is the truth about it.
const RH = require('./rankhold');
const F = require('./funnel');

const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const pct = (part, of) => (of ? (100 * part) / of : null);
const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

// ONE KEY PER COIN AND SHAPE, the same four things lib/stages.js keys on: the
// traded coin, the one or two coins it is read alongside, the chunk shape.
// Kept here as well so a worker thread can cut a fold to the kept coins and
// shapes without reaching into the service's own module.
const unitKeyOf = (u) => `${u.trade}|${u.ctx1 || ''}|${u.ctx2 || ''}|${u.geometry}`;
// and the key the four things a rule has to beat are filed under: 24/7 or
// 24/5, and the hold length, the same one lib/stages.js reads them by
const controlKeyOf = (r) => `${r && r.weekdaysOnly ? 'wk' : 'all'}|${Number(r && r.tHours)}`;
// the four a setting is held up to, the same four lib/stages.js keeps: being
// long every period, being short every period, buying the coin and going away,
// shorting it and going away
const CONTROL_KEYS = ['alwaysLong', 'alwaysShort', 'buyHold', 'shortHold'];

// HOW MANY OF THE BEST ARE READ AS A GROUP. Thirty, where the Funnel's own
// floor on settings ranked starts.
const BEST_N = 30;

// THE COLUMNS, in the order the table draws them: the field on the row, its
// kind (how it is printed), which way is good (so the sort and the filter both
// know), and the filter box that reads it. The words -- the heading, its
// hover, the box's name -- are on the page that draws them, where the closed
// word list can see them; a test holds the page's list to this one.
//   kind: money | pct | count | hold | trades | beats | countpct (a count of
//   settings with its share beside it; `count` names the count's field, and the
//   share is what the column sorts and filters on)
//   good: 'high' sorts high first and filters 'at least'; 'low' the other way
const COLUMNS = [
  { key: 'settings', kind: 'count', good: 'high', filter: 'minSettings' },
  // SETTINGS IN THE MONEY OVER THE WHOLE TEST WINDOW, a count with its share
  // (3.232.0, owner order 2026-09-23: "these ones that I specifically asked
  // for ... you didn't give me"). It was the share alone under a heading that
  // did not say what it counted.
  { key: 'inMoneyPct', kind: 'countpct', count: 'inMoneyN', good: 'high', filter: 'minInMoney' },
  { key: 'avgTest', kind: 'money', good: 'high', filter: 'minAvgTest' },
  { key: 'avgTestNoGate', kind: 'money', good: 'high', filter: 'minAvgTestNoGate' },
  { key: 'perTrade', kind: 'money', good: 'high', filter: 'minPerTrade' },
  { key: 'perTradeNoGate', kind: 'money', good: 'high', filter: 'minPerTradeNoGate' },
  { key: 'midTest', kind: 'money', good: 'high', filter: 'minMidTest' },
  { key: 'bestTest', kind: 'money', good: 'high', filter: 'minBestTest' },
  { key: 'inMoney1', kind: 'pct', good: 'high', filter: 'minInMoney1' },
  { key: 'inMoney2', kind: 'pct', good: 'high', filter: 'minInMoney2' },
  { key: 'inMoney3', kind: 'pct', good: 'high', filter: 'minInMoney3' },
  { key: 'allThreePct', kind: 'pct', good: 'high', filter: 'minAllThree' },
  // LOSING IN ALL THREE PARTS, a count with its share (3.232.0, the same order)
  { key: 'loseAllPct', kind: 'countpct', count: 'loseAllN', good: 'low', filter: 'maxLoseAll' },
  { key: 'h12', kind: 'hold', good: 'high', filter: 'minH12' },
  { key: 'h23', kind: 'hold', good: 'high', filter: 'minH23' },
  { key: 'h13', kind: 'hold', good: 'high', filter: 'minH13' },
  { key: 'h123', kind: 'hold', good: 'high', filter: 'minH123' },
  { key: 'top30Third', kind: 'money', good: 'high', filter: 'minTop30Third' },
  // BEST 30 BEAT COPIES IS GONE (3.232.0, owner order 2026-09-23: "get rid of
  // 3"). The 30 were picked on the same money they were compared with, so it
  // passed 74 of the 86 coins and shapes on the owner's set and told nothing.
  { key: 'boardBeats', kind: 'beats', good: 'high', filter: 'minBoardBeats' },
  // THE BEST OF THE FOUR, NOT ALWAYS LONG (3.232.0, owner order: "fix 4").
  // Always long alone passed every setting on a coin that fell and almost none
  // on a coin that rose.
  { key: 'beatBestPct', kind: 'pct', good: 'high', filter: 'minBeatBest' },
  { key: 'bestVsLong', kind: 'money', good: 'high', filter: 'minBestVsLong' },
  { key: 'midTrades', kind: 'trades', good: 'high', filter: 'minMidTrades' },
  { key: 'fieldBlocked', kind: 'pct', good: 'low', filter: 'maxFieldBlocked' },
  { key: 'streakBest30', kind: 'money', good: 'low', filter: 'maxStreakBest30' },
  { key: 'winsBest30', kind: 'pct', good: 'high', filter: 'minWinsBest30' },
  { key: 'chunksAPart', kind: 'count', good: 'high', filter: 'minChunksAPart' },
];
const COLUMN_KEYS = COLUMNS.map((c) => c.key);
// filter box id -> [field, kind], the shape lib/stages.js reads every table's
// filters through, so the unit table's boxes are validated and applied by the
// one definition of what a filter is
const FILTER_DEFS = {};
for (const c of COLUMNS) if (c.filter) FILTER_DEFS[c.filter] = [c.key, c.good === 'low' ? 'max' : 'min'];
const SORTS = ['set', 'name', ...COLUMN_KEYS];

// ONE COIN AND SHAPE'S ROW. `rows` are its board rows: each carries the
// record's test money (avgTest), its test trades (testTrades), the kept
// scrambled copies (noiseTest), the field's totals on the test window (field,
// or null with no gate) and, once the pass has run, the rebuilt numbers
// (pnlThirds, maxDrawdown, wins). `opts.chunksAPart` is what the run recorded
// for this unit's test window; `opts.testControls` is the unit's four things a
// rule has to beat on the test window, keyed by controlKeyOf.
function unitSummaryOf(rows, opts = {}) {
  const all = rows || [];
  const money = all.map((r) => num(r.avgTest)).filter((v) => v != null);
  const out = { settings: all.length };
  out.inMoneyN = money.filter((v) => v > 0).length;
  out.inMoneyPct = round2(pct(out.inMoneyN, money.length));
  out.avgTest = round2(mean(money));
  out.midTest = round2(median(money));
  out.bestTest = money.length ? round2(Math.max(...money)) : null;
  // WITH AND WITHOUT THE GATE, off the records. A row priced under a gate
  // carries the placed trades at size 1 and the blocked calls at size 1; a row
  // priced with no gate IS every call at size 1, so its own money stands for
  // both columns.
  let pnl = 0; let trades = 0; let pnlNo = 0; let tradesNo = 0; let gated = 0;
  const noGate = [];
  const fieldSum = { placed: 0, blockedSign: 0, blockedMin: 0, silent: 0 };
  for (const r of all) {
    const v = num(r.avgTest);
    const tr = num(r.testTrades);
    const f = r.field || null;
    if (f && num(f.at1) != null) {
      gated++;
      const bare = num(f.at1) + (num(f.blockedAt1) || 0);
      noGate.push(bare);
      pnlNo += bare; tradesNo += (num(f.trades) || 0) + (num(f.blockedN) || 0);
      if (v != null) { pnl += v; trades += (num(f.trades) ?? tr ?? 0); }
      for (const k of Object.keys(fieldSum)) fieldSum[k] += num(f[k]) || 0;
    } else if (v != null) {
      noGate.push(v);
      pnlNo += v; tradesNo += tr || 0;
      pnl += v; trades += tr || 0;
    }
  }
  out.avgTestNoGate = round2(mean(noGate));
  out.perTrade = trades > 0 ? round2(pnl / trades) : null;
  out.perTradeNoGate = tradesNo > 0 ? round2(pnlNo / tradesNo) : null;
  const calls = fieldSum.placed + fieldSum.blockedSign + fieldSum.blockedMin + fieldSum.silent;
  out.fieldBlocked = gated && calls ? round2((100 * (fieldSum.blockedSign + fieldSum.blockedMin)) / calls) : null;
  // THE KEPT SCRAMBLED COPIES, read the way the Funnel reads them: the group's
  // average real money against the same rows' average on each copy, to the cent
  const withMoney = all.filter((r) => num(r.avgTest) != null);
  const K = withMoney.length && Array.isArray(withMoney[0].noiseTest) ? withMoney[0].noiseTest.length : 0;
  const beatsOf = (list) => {
    if (!K || !list.length) return null;
    const real = mean(list.map((r) => num(r.avgTest)).filter((v) => v != null));
    let n = 0;
    for (let d = 0; d < K; d++) {
      const copy = mean(list.map((r) => num(r.noiseTest && r.noiseTest[d])).filter((v) => v != null));
      if (F.beats(real, copy)) n++;
    }
    return n;
  };
  const byMoney = withMoney.slice().sort((a, b) => (num(b.avgTest) - num(a.avgTest)) || String(a.label).localeCompare(String(b.label)));
  const best = byMoney.slice(0, BEST_N);
  out.copies = K;
  out.boardBeats = beatsOf(withMoney);
  // THE THREE PARTS, from the rebuilt numbers; every one of these is empty
  // until the pass has run, never a nought
  const hold = RH.holdOfUnit(all, opts.chunksAPart);
  const usable = all.filter((r) => Array.isArray(r.pnlThirds) && r.pnlThirds.length >= 3 && r.pnlThirds.slice(0, 3).every((v) => num(v) != null));
  const part = (i) => usable.map((r) => num(r.pnlThirds[i]));
  out.thirds = usable.length;
  out.inMoney1 = round2(pct(part(0).filter((v) => v > 0).length, usable.length));
  out.inMoney2 = round2(pct(part(1).filter((v) => v > 0).length, usable.length));
  out.inMoney3 = round2(pct(part(2).filter((v) => v > 0).length, usable.length));
  out.allThreePct = round2(pct(usable.filter((r) => r.pnlThirds.slice(0, 3).every((v) => num(v) > 0)).length, usable.length));
  const loseAll = usable.filter((r) => r.pnlThirds.slice(0, 3).every((v) => num(v) < 0)).length;
  out.loseAllN = usable.length ? loseAll : null;
  out.loseAllPct = round2(pct(loseAll, usable.length));
  const holdOf = (key) => { const x = (hold.readings || []).find((b) => b.key === key); return x && x.hold != null ? Math.round(x.hold * 1000) / 1000 : null; };
  out.h12 = holdOf('1>2'); out.h23 = holdOf('2>3'); out.h13 = holdOf('1>3'); out.h123 = holdOf('12>3');
  const by12 = usable.slice().sort((a, b) => ((num(b.pnlThirds[0]) + num(b.pnlThirds[1])) - (num(a.pnlThirds[0]) + num(a.pnlThirds[1]))) || String(a.label).localeCompare(String(b.label)));
  out.top30Third = round2(mean(by12.slice(0, BEST_N).map((r) => num(r.pnlThirds[2]))));
  // THE FOUR, at each setting's own hold length. A setting is counted as
  // beating them when its test money beats the BEST of the four -- the hardest
  // of them, the way the Funnel reads a rule against them -- so neither a coin
  // that rose nor one that fell passes by its direction alone. A setting whose
  // four are not all known is left out of the count, never passed.
  const tc = opts.testControls || null;
  let beatN = 0; let ctlN = 0; let bestVs = null;
  if (tc) {
    for (const r of withMoney) {
      const c = tc[controlKeyOf(r)];
      if (!c) continue;
      const v = num(r.avgTest);
      const four = CONTROL_KEYS.map((k) => num(c[k]));
      if (four.every((x) => x != null)) {
        ctlN++;
        if (F.beats(v, Math.max(...four))) beatN++;
      }
      const long = num(c.alwaysLong);
      if (long != null) { const vs = v - long; if (bestVs == null || vs > bestVs) bestVs = vs; }
    }
  }
  out.beatBestPct = ctlN ? round2(pct(beatN, ctlN)) : null;
  out.bestVsLong = round2(bestVs);
  out.controlled = ctlN;
  // the rest of the seven: how often it trades, the risk and the hit rate of
  // what a walk would keep
  out.midTrades = round2(median(all.map((r) => num(r.testTrades)).filter((v) => v != null)));
  out.streakBest30 = round2(median(best.map((r) => num(r.maxDrawdown)).filter((v) => v != null)));
  let wins = 0; let winTrades = 0; let winRows = 0;
  for (const r of best) {
    const w = num(r.wins); const tr = num(r.testTrades);
    if (w == null || tr == null) continue;
    wins += w; winTrades += tr; winRows++;
  }
  out.winsBest30 = winRows && winTrades > 0 ? round2(pct(wins, winTrades)) : null;
  out.chunksAPart = num(opts.chunksAPart);
  return out;
}

// THE FILTER, applied by the one rule every table uses: a box with a number in
// it hides every row whose column is below (or above) it, AND every row whose
// column is empty -- a coin and shape the pass has not reached carries no
// figure to clear a floor with, the same way Table 3.B hides a coin priced with
// no gate from a floor on the gate.
const KINDS = {
  min: (v, want) => v != null && Number.isFinite(Number(v)) && Number(v) >= Number(want),
  max: (v, want) => v != null && Number.isFinite(Number(v)) && Number(v) <= Number(want),
};
function cleanFilter(filters) {
  const clean = {};
  for (const [k, v] of Object.entries(filters || {})) {
    if (v === '' || v == null) continue;
    if (!FILTER_DEFS[k]) throw new Error(`"${k}" is not a filter on Table 3.C (${Object.keys(FILTER_DEFS).join('/')})`);
    if (!Number.isFinite(Number(v))) throw new Error(`the ${k} filter needs a number, not "${v}"`);
    clean[k] = String(v);
  }
  return clean;
}
function applyFilter(rows, filters) {
  const active = Object.entries(cleanFilter(filters)).map(([k, want]) => [FILTER_DEFS[k][0], KINDS[FILTER_DEFS[k][1]], want]);
  if (!active.length) return (rows || []).slice();
  return (rows || []).filter((r) => active.every(([field, test, want]) => test(r[field], want)));
}

// THE ORDER. One click on a column sorts it its good way first -- high first
// where high is good, low first where low is -- and a row with nothing in that
// column goes last either way; a second click turns the whole order round.
// 'set' is the order the set lists its coins and shapes in; 'name' A to Z.
function orderBy(key, flip) {
  const col = COLUMNS.find((c) => c.key === key);
  const bySet = (a, b) => a.at - b.at;
  let cmp;
  if (!col) {
    cmp = key === 'name' ? (a, b) => String(a.name).localeCompare(String(b.name)) || bySet(a, b) : bySet;
  } else {
    const empty = col.good === 'low' ? 1e15 : -1e15;
    cmp = col.good === 'low'
      ? (a, b) => ((a[key] ?? empty) - (b[key] ?? empty)) || bySet(a, b)
      : (a, b) => ((b[key] ?? empty) - (a[key] ?? empty)) || bySet(a, b);
  }
  return flip ? (a, b) => cmp(b, a) : cmp;
}

module.exports = { COLUMNS, COLUMN_KEYS, FILTER_DEFS, SORTS, BEST_N, CONTROL_KEYS, unitSummaryOf, applyFilter, cleanFilter, orderBy, unitKeyOf, controlKeyOf };
