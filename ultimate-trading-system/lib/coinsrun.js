// coinsrun.js -- THE COINS RUN: reading every chosen coin's history, writing
// the window moves it offers, and serving them back under the sit-out band
// (COINS.md Part one; owner LOOP NOW! 2026-09-13).
//
// This is the plumbing. Every number it reports comes out of lib/coins.js,
// which is where the arithmetic lives and where it is tested. Nothing here
// decides anything about a coin: it loads, it measures, it writes, it serves.
//
// WHAT A RECORD HOLDS: per coin, per chunk shape, the moment every decision's
// window starts and how far price moved across that window to the open of its
// trade. Those are facts about the history and they are what a read costs
// (five shapes of chunks built per coin). The sit-out band is NOT on the
// record: it is applied when the screen asks, so tuning it recolours every bar
// at once without reading a candle again. That is the owner's "a way to tune
// the sit out band", and it is why the band is not a reason to press Read.
//
// THE BAND HAS ONE HOME. It lives in data/settings.json beside the other
// settings that describe how this installation is run, and Sweep's dual member
// voting mode -- when it is built -- reads the same key, so the picture on
// Coins and the training on Sweep can never disagree about it (owner: "just
// do it once in one place, like good code design").
//
// AND NOTHING HERE REFUSES A COIN (owner, 2026-09-12: "We're not even blocking
// coins with this anyways. We're only reporting."). Every chosen coin gets a
// record on disk, whether it could be read or not, and a record that could not
// be read says why in a sentence.
const fs = require('fs');
const path = require('path');
const coins = require('./coins');
// through the module, so a test can stand in for the cache (see lib/stages.js)
const defaultCoins = (...a) => require('./dataset').defaultCoins(...a);

const DIR = path.join(__dirname, '..', 'data', 'coins');
const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');
const BAND_KEY = 'coins_sit_out_band';

// THE RECORD SHAPE. It moves whenever what is written changes, so a reading
// taken under an older shape is NAMED on the screen rather than drawn as
// though it were current (RULE NINE; owner, 2026-09-13: "Just code it right
// for this time" -- no migration, the reader says which shape a file is and
// asks for the coin to be read again). 6 (3.124.0): the window move per
// decision per chunk shape. Shapes 1 to 5 held stretches, fall-back
// percentages, per-hold readings and two untuned numbers, none of which the
// design carries any more, so none of them can be drawn here.
const RECORD_V = 6;

// THE DEFAULT IS A STARTING VALUE, NOT A LIMIT. The band is a control on the
// screen (RULE FIVE); this is only what it reads before the owner sets it. 50
// means: sit out when the window moved less than half what this coin
// typically moves over that window.
const DEFAULTS = Object.freeze({ band: 50 });

// THE WINDOW LAYOUTS ARE READ FROM THE SAME LIST THE DROPDOWNS ARE DRAWN FROM,
// never typed here. Typed, they would be a second copy: add a layout to the
// vocabulary and the screen would mark the bars with it while every count for
// it came back empty.
//
// SERVED FEWEST-PARTS FIRST, so the screen can put the three-part division
// above every bar and the sealed four-part one below it (owner: "seventy
// fifteen fifteen on top ... shaded bars underneath ... sixty one, thirteen,
// thirteen, thirteen") without typing either key. Derived from the engine's
// own split of a hundred decisions; a third layout tomorrow lands in order.
function layouts() {
  const v = require('./vocabulary').vocabulary();
  const keys = (v.windowLayout || []).map((o) => String(o.value));
  const partsOf = (k) => { try { return coins.partsFor(100, k).length; } catch (_) { return Number.MAX_SAFE_INTEGER; } };
  return keys.map((k, i) => ({ k, i, n: partsOf(k) })).sort((a, b) => a.n - b.n || a.i - b.i).map((x) => x.k);
}

function ensureDir() { try { fs.mkdirSync(DIR, { recursive: true }); } catch (_) { /* already there */ } }
// ONE FILE PER COIN, named for the coin. The record says its own coin too, and
// the reader believes the record.
const recordFile = (coin) => path.join(DIR, `${String(coin).toUpperCase()}.json`);

// ---- the sit-out band: one number, one home -----------------------------------

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch (_) { return {}; }
}
function sitOutBand() {
  const v = Number(readSettings()[BAND_KEY]);
  return Number.isFinite(v) && v >= 0 ? v : DEFAULTS.band;
}
function setSitOutBand(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) throw new Error(`the sit-out band must be a number of zero or more — not ${value}`);
  const settings = readSettings();
  settings[BAND_KEY] = v;
  try { fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true }); } catch (_) { /* already there */ }
  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 1));
  fs.renameSync(tmp, SETTINGS_FILE);
  return { band: v };
}

// ---- one coin ----------------------------------------------------------------

// THE RECORD EVERY COIN GETS, read or not. `shapes` carries one entry per
// chunk shape the engine offers; an entry is either the moves or a sentence
// saying why there are none. `why` at the top is for a coin that could not get
// as far as a reading at all.
function blankRecord(coin, why) {
  return {
    v: RECORD_V,
    coin: String(coin).toUpperCase(),
    read: false,
    why,
    provenance: {
      release: require('../package.json').version,
      capturedAt: new Date().toISOString(),
      cachedMonths: null, candles: 0,
    },
    shapes: {},
  };
}

async function readOneCoin(coin, onNote = () => {}) {
  const pipeline = require('./pipeline');
  const { toHourlyMap, forwardFill } = require('./dataset');

  onNote(`${coin}: reading its cached prices`);
  const loaded = await pipeline.loadSymbolAll(coin, (m) => onNote(`${coin}: ${m}`));
  if (!loaded.rows.length) {
    return blankRecord(coin, `${coin} has no cached prices on this box — download them on Data first`);
  }
  // forwardFill HANDS BACK A WRAPPER and the filled prices are inside it. The
  // first version of this file passed the wrapper straight on as the price
  // map, so every coin threw on the first decision built and the tab read
  // nothing at all, ever. Nineteen tests were green and not one of them loaded
  // this file. That is why tests/test-coinsrun.js goes through this function
  // with candles in and a record out.
  const map = forwardFill(toHourlyMap(loaded.rows)).map;

  const rec = {
    v: RECORD_V,
    coin: String(coin).toUpperCase(),
    read: false,
    why: null,
    // THE PROVENANCE. A reading cannot be read honestly without knowing which
    // span produced it and when, so both are on the record and both are
    // printed beside the bars. A coin whose history has since grown reads as
    // behind rather than quietly wrong.
    provenance: {
      release: require('../package.json').version,
      capturedAt: new Date().toISOString(),
      cachedMonths: loaded.cachedMonthCount,
      candles: loaded.rows.length,
    },
    shapes: {},
  };
  for (const s of coins.shapes()) {
    onNote(`${coin}: ${s.label}`);
    try {
      const wm = coins.windowMoves(map, s.key);
      rec.shapes[s.key] = wm.periods
        ? { periods: wm.periods, span: wm.span, skipped: wm.skipped, ts: wm.ts, move: wm.move }
        : { periods: 0, why: `${coin} offers no complete ${s.label} decisions from the prices cached on this box` };
    } catch (err) {
      // NOT A REFUSAL OF THE COIN. One shape could not be built -- too few
      // candles for its window, most likely -- so that is what the record
      // says, and every other shape is still there.
      rec.shapes[s.key] = { periods: 0, why: String(err.message || err) };
    }
  }
  rec.read = Object.values(rec.shapes).some((s) => s.periods > 0);
  if (!rec.read) rec.why = `${coin} offers no complete decisions at any chunk shape from the prices cached on this box`;
  return rec;
}

// ---- the run -----------------------------------------------------------------

let run = null;

function normalise(body = {}) {
  const list = String(body.coins || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const p = { coins: list.length ? [...new Set(list)] : defaultCoins() };
  // A BLANK BOX ON A BOX WITH NOTHING DOWNLOADED IS NO COINS, and saying so is
  // better than starting a run that reads nothing (owner order, 2026-09-13).
  if (!p.coins.length) throw new Error('no coins are downloaded on this box — download some on Data first, or type the ones you want');
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
      const rec = await readOneCoin(coin, (m) => { if (run) run.note = m; });
      fs.writeFileSync(recordFile(coin), `${JSON.stringify(rec)}\n`);
      if (rec.read) run.wrote.push(coin); else run.couldNotRead.push({ coin, why: rec.why });
    } catch (err) {
      // A COIN THAT THREW ON THE WAY IN STILL GETS A RECORD, so the screen shows
      // it with its reason instead of leaving it out.
      const rec = blankRecord(coin, String(err.message || err));
      try { fs.writeFileSync(recordFile(coin), `${JSON.stringify(rec)}\n`); } catch (_) { /* the disk said no; the run carries on */ }
      run.couldNotRead.push({ coin, why: rec.why });
    }
    run.done++;
  }
  // STOPPED IS NOT FINISHED, and the screen has to be able to tell them apart.
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

function readRecord(coin) {
  try { return JSON.parse(fs.readFileSync(recordFile(coin), 'utf8')); } catch (_) { return null; }
}

// EVERY RECORD ON THE BOX, SUMMED UP UNDER THE BAND AS IT IS NOW. One record
// per coin, five bars each.
//
// A FILE THAT CANNOT BE READ IS NAMED, NEVER DROPPED. Skipping an unparseable
// file or a record written under an older shape in silence is how a release
// bump once made the owner's readings disappear from the screen with nothing
// saying where they went. What is on disk either says what it is in today's
// words or the reader says which shape it is and asks for the coin again.
function coinsRecords() {
  ensureDir();
  const band = sitOutBand();
  const lays = layouts();
  const rows = [];
  const unreadable = [];
  let files = [];
  try { files = fs.readdirSync(DIR); } catch (_) { files = []; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const coin = f.slice(0, f.length - '.json'.length).split('__')[0];
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
    const shapesOut = {};
    for (const s of coins.shapes()) {
      const sr = rec.shapes && rec.shapes[s.key];
      if (!sr || !(sr.periods > 0)) { shapesOut[s.key] = { periods: 0, why: (sr && sr.why) || `${rec.coin} was not read at ${s.label}` }; continue; }
      shapesOut[s.key] = coins.shapeSummary(sr, band, lays);
    }
    rows.push({ coin: rec.coin, read: rec.read, why: rec.why, provenance: rec.provenance, shapes: shapesOut });
  }
  rows.sort((a, b) => String(a.coin).localeCompare(String(b.coin)));
  unreadable.sort((a, b) => String(a.coin).localeCompare(String(b.coin)));
  return {
    shapes: coins.shapes(),
    layouts: lays,
    band: { value: band, default: DEFAULTS.band, home: 'data/settings.json' },
    // what a blank coin box means, as a count, so the label can say it without
    // the number being typed anywhere
    downloaded: defaultCoins().length,
    records: rows,
    unreadable,
    recordVersion: RECORD_V,
  };
}

module.exports = {
  RECORD_V, DEFAULTS, BAND_KEY, layouts, recordFile,
  sitOutBand, setSitOutBand,
  readOneCoin, normalise, busyWhy,
  coinsRunStart, coinsRunStatus, coinsRunStop,
  readRecord, coinsRecords,
};
