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
// period is. That claim was FALSE in the first version, which pinned the
// weekday filter off while it is a per-run sweep setting: with it on the same
// coin gives 104 periods at the four-day shape against 725 with it off, so the
// reading was about a different series from the run it was vetting. It is a
// control now, like everything else here (RULE FIVE).
//
// AND NOTHING HERE REFUSES A COIN (COINS.md section 8; owner, 2026-09-12: "We're
// not even blocking coins with this anyways. We're only reporting."). The first
// version threw on a coin with fewer than forty periods and threw on a coin with
// no cached prices, and a thrown coin vanished from the screen with its reason
// held in memory until the next press wiped it. Every chosen coin gets a record
// on disk now, whether it could be read or not, and a record that could not be
// read says why in a sentence.
const fs = require('fs');
const path = require('path');
const coins = require('./coins');
const { GEOMETRIES } = require('./dataset');

const DIR = path.join(__dirname, '..', 'data', 'coins');
const RECORD_V = 2;

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
  weekdaysOnly: false,
  // how many times a coin's own periods are shuffled to work out whether either
  // untuned number can say anything about it at this much history (COINS.md
  // section 11). A precision setting, not a threshold -- there is no line to
  // set, and more shuffles only sharpen the same answer.
  shuffles: 200,
});

// THE WINDOW LAYOUTS ARE READ FROM THE SAME LIST THE DROPDOWNS ARE DRAWN FROM,
// never typed here. Typed, they were a second copy: add a layout to the
// vocabulary and the screen would offer it while every cell for it came back
// empty, because the reading had never been taken.
function layouts() {
  const v = require('./vocabulary').vocabulary();
  return (v.windowLayout || []).map((o) => String(o.value));
}

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

// THE RECORD EVERY COIN GETS, read or not. `readings` carries one entry per
// window layout; an entry is either the reading or a sentence saying why there
// is none. `why` at the top is for a coin that could not get as far as a
// reading at all.
function blankRecord(coin, geometry, params, why) {
  return {
    v: RECORD_V,
    coin: String(coin).toUpperCase(),
    geometry,
    periods: 0,
    read: false,
    why,
    provenance: {
      release: require('../package.json').version,
      capturedAt: new Date().toISOString(),
      fromTs: null, toTs: null, cachedMonths: null, candles: 0,
    },
    params,
    traditional: null,
    readings: {},
  };
}

async function readOneCoin(coin, params, onNote = () => {}) {
  const geometry = params.geometry;
  if (!GEOMETRIES[geometry]) throw new Error(`unknown chunk shape '${geometry}'`);
  const pipeline = require('./pipeline');
  const { toHourlyMap, forwardFill } = require('./dataset');
  const bracket = require('./bracket');
  const kept = {
    target: params.target, from: params.from, to: params.to, step: params.step,
    cap: params.cap, driftParts: params.driftParts, weekdaysOnly: !!params.weekdaysOnly,
    shuffles: params.shuffles,
  };

  onNote(`${coin}: reading its cached prices`);
  const loaded = await pipeline.loadSymbolAll(coin, (m) => onNote(`${coin}: ${m}`));
  if (!loaded.rows.length) {
    return blankRecord(coin, geometry, kept, `${coin} has no cached prices on this box — download them on Data first`);
  }
  // forwardFill HANDS BACK A WRAPPER and the filled prices are inside it. The
  // first version passed the wrapper straight on as the price map, so every
  // coin threw on the first period built and the tab read nothing at all,
  // ever. Nineteen tests were green and not one of them loaded this file.
  const map = forwardFill(toHourlyMap(loaded.rows)).map;

  onNote(`${coin}: building ${geometry} periods`);
  const built = bracket.buildComboChunks({ trade: map }, geometry, !!params.weekdaysOnly);
  const { prices, moves } = seriesOf(built.chunks);
  const first = built.chunks.find((c) => c.c1 != null);
  const last = [...built.chunks].reverse().find((c) => c.c1 != null);

  const rec = {
    v: RECORD_V,
    coin: String(coin).toUpperCase(),
    geometry,
    periods: prices.length,
    read: prices.length > 0,
    why: prices.length ? null : `${coin} gives no complete ${geometry} periods from the prices cached on this box`,
    // THE PROVENANCE (COINS.md section 12). A score cannot be read honestly
    // without knowing which span and which parameter values produced it, so
    // both are on the record and both are drawn beside the reading.
    provenance: {
      release: require('../package.json').version,
      capturedAt: new Date().toISOString(),
      fromTs: first ? first.startTs : null,
      toTs: last ? last.startTs : null,
      cachedMonths: loaded.cachedMonthCount,
      candles: loaded.rows.length,
    },
    params: kept,
    // ONE PER COIN, NOT ONE PER LAYOUT (COINS.md section 11). It was inside the
    // per-layout reading before, so every record carried two byte-identical
    // copies of it.
    traditional: prices.length ? coins.traditionalReading(moves, { driftParts: params.driftParts, shuffles: params.shuffles }) : null,
    readings: {},
  };

  for (const layout of layouts()) {
    if (!prices.length) { rec.readings[layout] = { layout, why: rec.why }; continue; }
    onNote(`${coin}: reading it as ${layout}`);
    try {
      rec.readings[layout] = coins.coinReading(prices, moves, {
        layout,
        target: params.target, from: params.from, to: params.to, step: params.step,
        cap: params.cap,
      });
    } catch (err) {
      // NOT A REFUSAL OF THE COIN. The arithmetic could not be done for this one
      // layout -- too few periods for its split to leave every stretch with
      // something in it, most likely -- so that is what the record says, and
      // every other layout and the traditional score are still there.
      rec.readings[layout] = { layout, why: String(err.message || err) };
    }
  }
  return rec;
}

// ---- the run -----------------------------------------------------------------

let run = null;

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
    shuffles: Math.max(2, Math.floor(num(body.shuffles, DEFAULTS.shuffles))),
    weekdaysOnly: body.weekdaysOnly === true || String(body.weekdaysOnly) === 'true',
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
    if (run && run.stop) break;
    try {
      const rec = await readOneCoin(coin, p, (m) => { if (run) run.note = m; });
      fs.writeFileSync(recordFile(coin, p.geometry), `${JSON.stringify(rec)}\n`);
      if (rec.read) run.wrote.push(coin); else run.couldNotRead.push({ coin, why: rec.why });
    } catch (err) {
      // A COIN THAT THREW ON THE WAY IN STILL GETS A RECORD, so the screen shows
      // it with its reason instead of leaving it out. The first version kept
      // the reason in memory only, on the latest press: read seventeen coins,
      // two fail, press again for one, and the two were gone with nothing said.
      const rec = blankRecord(coin, p.geometry, {
        target: p.target, from: p.from, to: p.to, step: p.step,
        cap: p.cap, driftParts: p.driftParts, weekdaysOnly: !!p.weekdaysOnly, shuffles: p.shuffles,
      }, String(err.message || err));
      try { fs.writeFileSync(recordFile(coin, p.geometry), `${JSON.stringify(rec)}\n`); } catch (_) { /* the disk said no; the run carries on */ }
      run.couldNotRead.push({ coin, why: rec.why });
    }
    run.done++;
  }
  // STOPPED IS NOT FINISHED, and the screen has to be able to tell them apart.
  // The first version set the note to 'stopped' and then wiped it on the next
  // line, and never put the stop flag in the status -- so a run halted at coin
  // 4 of 17 read word for word like a completed 4-coin run.
  run.stoppedAt = run.stop ? run.done : null;
  run.finishedAt = new Date().toISOString();
  run.note = null;
}

function coinsRunStart(body = {}) {
  const why = busyWhy();
  if (why) throw new Error(why);
  const p = normalise(body);
  run = {
    started: new Date().toISOString(), params: p, of: p.coins.length, done: 0,
    wrote: [], couldNotRead: [], note: 'starting', error: null, finishedAt: null,
    stop: false, stoppedAt: null,
  };
  runAll(p).catch((err) => { run.error = String(err.message || err); run.finishedAt = new Date().toISOString(); });
  return { started: true, of: p.coins.length, params: p };
}

function coinsRunStatus() {
  if (!run) {
    return {
      running: false, started: null, done: 0, of: 0, wrote: [], couldNotRead: [],
      note: null, error: null, finishedAt: null, stopped: false, stoppedAt: null, params: null,
    };
  }
  return {
    running: !run.finishedAt && !run.error,
    started: run.started, done: run.done, of: run.of,
    wrote: run.wrote.slice(), couldNotRead: run.couldNotRead.slice(),
    note: run.note, error: run.error, finishedAt: run.finishedAt,
    stopped: !!run.stop, stoppedAt: run.stoppedAt, params: run.params,
  };
}

function coinsRunStop() {
  if (!run || run.finishedAt) return { stopping: false, why: 'nothing is running to stop' };
  run.stop = true;
  return { stopping: true };
}

// ---- reading the records back -------------------------------------------------

function readRecord(coin, geometry) {
  try { return JSON.parse(fs.readFileSync(recordFile(coin, geometry), 'utf8')); } catch (_) { return null; }
}

// EVERY RECORD ON THE BOX FOR ONE CHUNK SHAPE. Ordered by the caller's choice,
// which is a control on the screen and never decided here (RULE FIVE).
//
// A FILE THAT CANNOT BE READ IS NAMED, NEVER DROPPED. The first version skipped
// both an unparseable file and a record written under an older shape, in
// silence -- so a release bump made the owner's readings disappear from the
// screen with nothing saying where they went, and the screen then said nothing
// had ever been read. That is the RULE NINE hole: what is on disk either says
// what it is in today's words or it is migrated, and either way the reader
// says which.
function coinsRecords(query = {}) {
  ensureDir();
  const geometry = String(query.geometry || 'daily-4d');
  const rows = [];
  const unreadable = [];
  let files = [];
  try { files = fs.readdirSync(DIR); } catch (_) { files = []; }
  for (const f of files) {
    if (!f.endsWith(`__${geometry}.json`)) continue;
    const coin = f.slice(0, f.length - `__${geometry}.json`.length);
    let rec = null;
    try { rec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (err) {
      unreadable.push({ coin, file: f, why: `this file could not be read back: ${String(err.message || err)} — read the coin again to replace it` });
      continue;
    }
    if (!rec || typeof rec !== 'object') {
      unreadable.push({ coin, file: f, why: 'this file holds nothing a reading could be taken from — read the coin again to replace it' });
      continue;
    }
    if (rec.v !== RECORD_V) {
      unreadable.push({
        coin, file: f,
        why: `this reading was written under record shape ${rec.v == null ? '(none)' : rec.v} and this release reads shape ${RECORD_V} — read the coin again to replace it`,
        release: rec.provenance ? rec.provenance.release : null,
        capturedAt: rec.provenance ? rec.provenance.capturedAt : null,
      });
      continue;
    }
    rows.push(rec);
  }
  rows.sort((a, b) => String(a.coin).localeCompare(String(b.coin)));
  unreadable.sort((a, b) => String(a.coin).localeCompare(String(b.coin)));
  // NO LEVEL A THIN SIDE HAS TO CLEAR, because there is no weighting for it to
  // be rescued by. 3.119.0 served one, worked out from the class ceiling in
  // `lib/bracket.js`, and the Coins screen printed it as 1.7%. That ceiling is
  // inside `trainMember`, which the three-stage engine does not call: it trains
  // through `trainProbMember`, which passes the money weights and no class
  // weights at all. The figure was true of code the owner never runs.
  //
  // WHAT THE SCREEN SAYS INSTEAD is the plainer and more useful fact: a thin
  // side gets no help whatever, at any thinness. That is a reason to read the
  // split of time, which is what this tab is for.
  return {
    geometry,
    records: rows,
    unreadable,
    defaults: DEFAULTS,
    layouts: layouts(),
    recordVersion: RECORD_V,
    rareSideWeighting: false,
  };
}

module.exports = {
  DEFAULTS, RECORD_V, layouts,
  seriesOf, readOneCoin, blankRecord, normalise,
  coinsRunStart, coinsRunStatus, coinsRunStop, coinsRecords, readRecord,
  recordFile,
};
