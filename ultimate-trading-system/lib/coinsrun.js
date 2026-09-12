// coinsrun.js -- THE COINS RUN: reading every chosen coin's history and writing
// what it holds (COINS.md; owner LOOP NOW! 2026-09-12).
//
// This is the plumbing. Every number it reports comes out of lib/coins.js,
// which is where the arithmetic lives and where it is tested. Nothing here
// decides anything about a coin: it loads, it measures, it writes.
//
// THE PERIODS ARE THE SWEEP'S OWN PERIODS. The chunks come from
// buildComboChunks, the same function a stage 1 launch builds them with, so a
// reading on this tab lines up period for period with the run it is vetting
// for. Building them another way here would be a second definition of what a
// period is.
const fs = require('fs');
const path = require('path');
const coins = require('./coins');
const { GEOMETRIES } = require('./dataset');

const DIR = path.join(__dirname, '..', 'data', 'coins');
const RECORD_V = 1;

// THE DEFAULTS ARE STARTING VALUES, NOT LIMITS. Every one of them is a control
// on the screen (RULE FIVE); these are only what the boxes are filled with
// before the owner changes them.
const DEFAULTS = Object.freeze({
  target: 6,
  from: 1,
  to: 30,
  step: 0.5,
  cap: 20,
  driftParts: 8,
});
const LAYOUTS = Object.freeze(['reserve61', 'split70']);

function ensureDir() { try { fs.mkdirSync(DIR, { recursive: true }); } catch (_) { /* already there */ } }
const recordFile = (coin, geometry) => path.join(DIR, `${String(coin).toUpperCase()}__${geometry}.json`);

// ---- one coin ----------------------------------------------------------------

// PRICES AND MOVES COME OFF THE SAME CHUNK. c1 is the price a trade would open
// at, which makes the price series land on period boundaries with nothing
// rounded; diffPct is the move from that open to the close of the same trade
// window, which is what the period's label is made from. So the weight reads
// the period's own outcome and nothing beyond it.
function seriesOf(chunks) {
  const prices = [];
  const moves = [];
  for (const c of chunks) {
    if (c.c1 == null || c.diffPct == null) continue;
    prices.push(c.c1);
    moves.push(c.diffPct);
  }
  return { prices, moves };
}

async function readOneCoin(coin, params, onNote = () => {}) {
  const geometry = params.geometry;
  if (!GEOMETRIES[geometry]) throw new Error(`unknown chunk shape '${geometry}'`);
  const pipeline = require('./pipeline');
  const { toHourlyMap, forwardFill } = require('./dataset');
  const bracket = require('./bracket');

  onNote(`${coin}: reading its cached prices`);
  const loaded = await pipeline.loadSymbolAll(coin, (m) => onNote(`${coin}: ${m}`));
  if (!loaded.rows.length) throw new Error(`${coin} has no cached prices on this box — download them on Data first`);
  const map = forwardFill(toHourlyMap(loaded.rows));

  onNote(`${coin}: building ${geometry} periods`);
  const built = bracket.buildComboChunks({ trade: map }, geometry, false);
  const { prices, moves } = seriesOf(built.chunks);
  if (prices.length < 40) throw new Error(`${coin} gives only ${prices.length} periods at ${geometry} — too few to read anything from`);

  const readings = {};
  for (const layout of LAYOUTS) {
    onNote(`${coin}: reading it as ${layout}`);
    readings[layout] = coins.coinReading(prices, moves, {
      layout,
      target: params.target, from: params.from, to: params.to, step: params.step,
      cap: params.cap, driftParts: params.driftParts,
    });
  }

  const first = built.chunks.find((c) => c.c1 != null);
  const last = [...built.chunks].reverse().find((c) => c.c1 != null);
  return {
    v: RECORD_V,
    coin: String(coin).toUpperCase(),
    geometry,
    periods: prices.length,
    // THE PROVENANCE (COINS.md section 12). A score cannot be read honestly
    // without knowing which span and which parameter values produced it, and a
    // coin whose history has since grown must read as STALE rather than
    // quietly wrong -- which is what the span and the release are for.
    provenance: {
      release: require('../package.json').version,
      capturedAt: new Date().toISOString(),
      fromTs: first ? first.startTs : null,
      toTs: last ? last.startTs : null,
      cachedMonths: loaded.cachedMonthCount,
      candles: loaded.rows.length,
    },
    params: {
      target: params.target, from: params.from, to: params.to, step: params.step,
      cap: params.cap, driftParts: params.driftParts,
    },
    readings,
  };
}

// ---- the run -----------------------------------------------------------------

let run = null;   // { coins, done, of, note, error, finishedAt, started }

function normalise(body = {}) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const list = String(body.coins || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const p = {
    coins: list.length ? [...new Set(list)] : require('./dataset').DEFAULT_PAIRS.slice(),
    geometry: String(body.geometry || 'daily-4d'),
    target: Math.max(1, Math.floor(num(body.target, DEFAULTS.target))),
    from: num(body.from, DEFAULTS.from),
    to: num(body.to, DEFAULTS.to),
    step: num(body.step, DEFAULTS.step),
    cap: num(body.cap, DEFAULTS.cap),
    driftParts: Math.max(2, Math.floor(num(body.driftParts, DEFAULTS.driftParts))),
  };
  if (!GEOMETRIES[p.geometry]) throw new Error(`unknown chunk shape '${p.geometry}'`);
  if (p.to <= p.from) throw new Error(`the percentage range must run upwards — ${p.from}% to ${p.to}% does not`);
  if (p.cap <= 1) throw new Error(`the weight ceiling must be above 1 — ${p.cap} cannot leave the average weight at 1`);
  return p;
}

function busyWhy() {
  const stages = require('./stages');
  if (run && !run.finishedAt && !run.error) return 'a Coins reading is already running — one at a time';
  if (typeof stages.stageBusy === 'function') {
    const b = stages.stageBusy();
    if (b) return `${b} — the reading waits for the box to be free`;
  }
  return null;
}

async function runAll(p) {
  ensureDir();
  for (const coin of p.coins) {
    if (run && run.stop) { run.note = 'stopped'; break; }
    try {
      const rec = await readOneCoin(coin, p, (m) => { if (run) run.note = m; });
      fs.writeFileSync(recordFile(coin, p.geometry), `${JSON.stringify(rec)}\n`);
      run.wrote.push(coin);
    } catch (err) {
      // A COIN THAT CANNOT BE READ IS RECORDED AND THE RUN CARRIES ON. One coin
      // with no cached prices must not cost the other sixteen their reading.
      run.refused.push({ coin, why: String(err.message || err) });
    }
    run.done++;
  }
  run.finishedAt = new Date().toISOString();
  run.note = null;
}

function coinsRunStart(body = {}) {
  const why = busyWhy();
  if (why) throw new Error(why);
  const p = normalise(body);
  run = {
    started: new Date().toISOString(), params: p, of: p.coins.length, done: 0,
    wrote: [], refused: [], note: 'starting', error: null, finishedAt: null, stop: false,
  };
  runAll(p).catch((err) => { run.error = String(err.message || err); run.finishedAt = new Date().toISOString(); });
  return { started: true, of: p.coins.length, params: p };
}

function coinsRunStatus() {
  if (!run) return { running: false, started: null, done: 0, of: 0, wrote: [], refused: [], note: null, error: null, finishedAt: null };
  return {
    running: !run.finishedAt && !run.error,
    started: run.started, done: run.done, of: run.of,
    wrote: run.wrote.slice(), refused: run.refused.slice(),
    note: run.note, error: run.error, finishedAt: run.finishedAt, params: run.params,
  };
}

function coinsRunStop() {
  if (!run || run.finishedAt) return { stopping: false, why: 'nothing is running' };
  run.stop = true;
  return { stopping: true };
}

// ---- reading the records back -------------------------------------------------

function readRecord(coin, geometry) {
  try { return JSON.parse(fs.readFileSync(recordFile(coin, geometry), 'utf8')); } catch (_) { return null; }
}

// EVERY RECORD ON THE BOX FOR ONE CHUNK SHAPE. Ordered by the caller's choice,
// which is a control on the screen and never decided here (RULE FIVE).
function coinsRecords(query = {}) {
  ensureDir();
  const geometry = String(query.geometry || 'daily-4d');
  const rows = [];
  let files = [];
  try { files = fs.readdirSync(DIR); } catch (_) { files = []; }
  for (const f of files) {
    if (!f.endsWith(`__${geometry}.json`)) continue;
    let rec = null;
    try { rec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
    if (!rec || rec.v !== RECORD_V) continue;
    rows.push(rec);
  }
  rows.sort((a, b) => String(a.coin).localeCompare(String(b.coin)));
  return { geometry, records: rows, defaults: DEFAULTS, layouts: LAYOUTS.slice() };
}

module.exports = {
  DEFAULTS, LAYOUTS, RECORD_V,
  seriesOf, readOneCoin, normalise,
  coinsRunStart, coinsRunStatus, coinsRunStop, coinsRecords, readRecord,
  recordFile,
};
