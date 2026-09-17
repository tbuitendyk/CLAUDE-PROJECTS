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
const signal = require('./coinsignal');
// through the module, so a test can stand in for the cache (see lib/stages.js)
const defaultCoins = (...a) => require('./dataset').defaultCoins(...a);

const DIR = path.join(__dirname, '..', 'data', 'coins');
const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');
const BAND_KEY = 'coins_sit_out_band';
// THE TICK'S HOME (owner GO NOW! 2026-09-14): true when every shape is drawn
// at its own sweet spot -- the band inside its plateau that keeps the most
// edge per decision -- and the typed band applies only where no band beats
// chance. Same file as the band, one key beside it.
const AUTO_KEY = 'coins_band_auto';
// THE PASSERS (owner GO NOW! 2026-09-14). A coin and shape passes when the
// link-cut check found a plateau at least as strong as the real one in at
// most `bar` of the deals. The bar is the owner's number, one key beside the
// band; the rows the owner has un-ticked are a list of "COIN|shape" beside
// it, so a new passer is ticked until somebody un-ticks it. Sweep's own tick
// reads the ticked passers as the units of a launch.
const PASS_BAR_KEY = 'coins_pass_bar';
const PASS_OFF_KEY = 'coins_passers_off';
// THE LOOK-BACKS A READING STORES, in hours, the owner's to change (RULE
// FIVE). Stored at read time because they are measured from candles, so
// changing them means reading the coins again -- which is why they live beside
// the band rather than on Walk it forward, where a change would silently mean
// nothing until the next read. One day, two, three, four, a week, two weeks,
// three weeks.
const LOOKBACKS_KEY = 'coins_lookbacks';

// THE RECORD SHAPE. It moves whenever what is written changes, so a reading
// taken under an older shape is NAMED on the screen rather than drawn as
// though it were current (RULE NINE; owner, 2026-09-13: "Just code it right
// for this time" -- no migration, the reader says which shape a file is and
// asks for the coin to be read again). 6 (3.124.0): the window move per
// decision per chunk shape. 7 (3.125.0): and the trade's own outcome beside
// it, which the gap is read against; a shape-6 record has no outcomes, so it
// cannot be drawn. Shapes 1 to 5 held stretches, fall-back percentages,
// per-hold readings and two untuned numbers, none of which the design carries
// any more.
// 8 (3.127.0): beside each shape's moves, the instrument's own check -- how
// often the signal analysis finds a plateau when the link between window and
// outcome is cut by dealing the outcomes into another order (S7 of
// LOOP-2026-09-14-SIGNAL.md). It is worked out once, when the coin is read,
// because it costs fifty analyses per shape and would not survive a draw; it
// depends on no band. A shape-7 record has no such check and is read again.
// 9 (3.159.0): the reading now ends at the OPEN OF THE FIRST CANDLE OF THE
// FILL, not at the fill price itself, and every record carries a move per
// look-back beside the shape's own. Both change what is stored, so a record
// written under 8 is refused by name and read again -- two minutes for the
// whole box, and RULE NINE rather than a reader that asks which era a file
// is from.
const RECORD_V = 9;
// how many deals the check makes per shape; one home
const LINK_CUT_TRIALS = 50;

// THE DEFAULT IS A STARTING VALUE, NOT A LIMIT. The band is a control on the
// screen (RULE FIVE); this is only what it reads before the owner sets it. 50
// means: sit out when the window moved less than half what this coin
// typically moves over that window.
const DEFAULTS = Object.freeze({ band: 50, passBar: 2, lookbacks: [24, 48, 72, 96, 168, 336, 504] });

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
function bandAuto() {
  return readSettings()[AUTO_KEY] === true;
}
function passBar() {
  const v = Number(readSettings()[PASS_BAR_KEY]);
  return Number.isInteger(v) && v >= 0 && v <= LINK_CUT_TRIALS ? v : DEFAULTS.passBar;
}
function setPassBar(value) {
  const v = Number(value);
  if (!Number.isInteger(v) || v < 0 || v > LINK_CUT_TRIALS) throw new Error(`the bar is a whole number from 0 to ${LINK_CUT_TRIALS} — not ${JSON.stringify(value)}`);
  const settings = readSettings();
  settings[PASS_BAR_KEY] = v;
  writeSettings(settings);
  return { bar: v };
}
function lookbacks() {
  const a = readSettings()[LOOKBACKS_KEY];
  const list = Array.isArray(a) ? a.map(Number).filter((h) => Number.isFinite(h) && h > 0 && h <= 8760) : null;
  return list && list.length ? [...new Set(list)].sort((x, y) => x - y) : DEFAULTS.lookbacks.slice();
}
function setLookbacks(value) {
  const list = (Array.isArray(value) ? value : String(value == null ? '' : value).split(','))
    .map((x) => Number(String(x).trim())).filter((h) => Number.isFinite(h));
  if (!list.length) throw new Error('give at least one look-back, in hours');
  for (const h of list) {
    if (!Number.isInteger(h) || h <= 0 || h > 8760) throw new Error(`a look-back is a whole number of hours from 1 to 8760 — not ${JSON.stringify(h)}`);
  }
  const settings = readSettings();
  settings[LOOKBACKS_KEY] = [...new Set(list)].sort((x, y) => x - y);
  writeSettings(settings);
  return { lookbacks: settings[LOOKBACKS_KEY], note: 'read the coins again for this to reach the records' };
}
function passersOff() {
  const a = readSettings()[PASS_OFF_KEY];
  return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [];
}
const passerKey = (coin, geometry) => `${String(coin).toUpperCase()}|${geometry}`;
function setPasserTicked(coin, geometry, ticked) {
  const c = String(coin || '').trim().toUpperCase();
  if (!c) throw new Error('which coin?');
  if (!coins.shapes().some((s) => s.key === geometry)) throw new Error(`${JSON.stringify(geometry)} is not a chunk shape`);
  if (typeof ticked !== 'boolean') throw new Error(`a row is ticked or not — not ${JSON.stringify(ticked)}`);
  const off = new Set(passersOff());
  if (ticked) off.delete(passerKey(c, geometry)); else off.add(passerKey(c, geometry));
  const settings = readSettings();
  settings[PASS_OFF_KEY] = [...off].sort();
  writeSettings(settings);
  return { coin: c, geometry, ticked };
}
function setBandAuto(value) {
  if (typeof value !== 'boolean') throw new Error(`the tick is on or off — not ${JSON.stringify(value)}`);
  const settings = readSettings();
  settings[AUTO_KEY] = value;
  writeSettings(settings);
  return { auto: value };
}
function writeSettings(settings) {
  try { fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true }); } catch (_) { /* already there */ }
  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 1));
  fs.renameSync(tmp, SETTINGS_FILE);
}
function setSitOutBand(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) throw new Error(`the sit-out band must be a number of zero or more — not ${value}`);
  const settings = readSettings();
  settings[BAND_KEY] = v;
  writeSettings(settings);
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
      const wm = coins.windowMoves(map, s.key, lookbacks());
      rec.shapes[s.key] = wm.periods
        ? { periods: wm.periods, span: wm.span, skipped: wm.skipped, ts: wm.ts, move: wm.move, out: wm.out, moves: wm.moves }
        : { periods: 0, why: `${coin} offers no complete ${s.label} decisions from the prices cached on this box` };
      if (wm.periods) {
        onNote(`${coin}: ${s.label} — checking the signal reading against itself`);
        // control is handed back between deals so the service keeps answering
        // while a coin is read (B16 of LOOP-2026-09-14-SIGNAL.md)
        rec.shapes[s.key].linkCut = await signal.plateauFalseAlarmsYielding(rec.shapes[s.key], s.key, layouts(), DEFAULTS.band, LINK_CUT_TRIALS);
      }
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

// A READ REPLACES EVERY OLDER FILE FOR THAT COIN (owner order, 2026-09-13:
// "the code should never leave old data lying around"). Record shape 3 wrote
// one file per coin and chunk shape, named COIN__shape.json, so a re-read that
// only wrote COIN.json left the old file beside it, still named on the screen
// as one this release cannot draw, with a sentence promising a re-read would
// replace it. It replaces it now: after the new record lands, every other
// file in the folder that belongs to this coin -- by its name, or by the coin
// its contents say -- goes.
function coinOfFile(f) {
  const byName = f.slice(0, f.length - '.json'.length).split('__')[0].toUpperCase();
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (rec && typeof rec.coin === 'string' && rec.coin) return rec.coin.toUpperCase();
  } catch (_) { /* unreadable: the name is all there is */ }
  return byName;
}
function removeOlderFilesFor(coin) {
  const keep = path.basename(recordFile(coin));
  const removed = [];
  let files = [];
  try { files = fs.readdirSync(DIR); } catch (_) { return removed; }
  for (const f of files) {
    if (!f.endsWith('.json') || f === keep) continue;
    if (coinOfFile(f) !== String(coin).toUpperCase()) continue;
    try { fs.unlinkSync(path.join(DIR, f)); removed.push(f); } catch (_) { /* the disk said no; it stays named on the screen */ }
  }
  return removed;
}

async function runAll(p) {
  ensureDir();
  for (const coin of p.coins) {
    if (run && run.stop) break;
    try {
      const rec = await readOneCoin(coin, (m) => { if (run) run.note = m; });
      fs.writeFileSync(recordFile(coin), `${JSON.stringify(rec)}\n`);
      run.replaced.push(...removeOlderFilesFor(coin));
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
    wrote: [], couldNotRead: [], replaced: [], note: 'starting', error: null, finishedAt: null,
    stop: false, stoppedAt: null,
  };
  runAll(p).catch((err) => { run.error = String(err.message || err); run.finishedAt = new Date().toISOString(); });
  return { started: true, of: p.coins.length, params: p };
}

function coinsRunStatus() {
  if (!run) {
    return {
      running: false, started: null, done: 0, of: 0, wrote: [], couldNotRead: [], replaced: [],
      note: null, error: null, finishedAt: null, stopped: false, stoppedAt: null, params: null,
    };
  }
  return {
    running: !run.finishedAt && !run.error,
    started: run.started, done: run.done, of: run.of,
    wrote: run.wrote.slice(), couldNotRead: run.couldNotRead.slice(), replaced: run.replaced.slice(),
    note: run.note, error: run.error, finishedAt: run.finishedAt,
    stopped: !!run.stop, stoppedAt: run.stoppedAt, params: run.params,
  };
}

function coinsRunStop() {
  if (!run || run.finishedAt) return { stopping: false, why: 'nothing is running to stop' };
  run.stop = true;
  return { stopping: true };
}

// THE PASSERS, MEMOISED. The stage 3 cost line asks on every box change and
// a full records reply costs seconds; the passers only change when a record
// file or the settings file does, so the reply is kept until one of them
// moves (names and mtimes compared, nothing assumed).
let passersMemo = null;
function passersStamp() {
  const parts = [];
  try { parts.push(`settings:${fs.statSync(SETTINGS_FILE).mtimeMs}`); } catch (_) { parts.push('settings:none'); }
  try {
    for (const f of fs.readdirSync(DIR).sort()) {
      if (!f.endsWith('.json')) continue;
      try { parts.push(`${f}:${fs.statSync(path.join(DIR, f)).mtimeMs}`); } catch (_) { parts.push(`${f}:gone`); }
    }
  } catch (_) { parts.push('dir:none'); }
  return parts.join('|');
}
function passersCached() {
  const stamp = passersStamp();
  if (passersMemo && passersMemo.stamp === stamp) return passersMemo.rows;
  const rows = coinsRecords().passers.rows;
  passersMemo = { stamp, rows };
  return rows;
}

// THE TICKED PASSERS AS UNITS OF A LAUNCH: what Sweep's own tick runs.
function passingUnits() {
  return passersCached().filter((r) => r.ticked).map((r) => ({ coin: r.coin, geometry: r.geometry }));
}
// THE LEAN EACH PASSER CARRIES, keyed by coin and shape: what stage 3's
// confirm dial prices with (COINS.md section 11). Listed at the bar, ticked
// or not: the tick says what Sweep RUNS, the lean is a fact about the coin.
function passerLeans() {
  const out = {};
  for (const r of passersCached()) {
    if (!r.lean || !(r.lean.rising || r.lean.falling)) continue;
    out[`${r.coin}|${r.geometry}`] = { band: r.band, yardstick: r.yardstick ?? null, rising: r.lean.rising || 0, falling: r.lean.falling || 0 };
  }
  return out;
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
function scanRecords() {
  ensureDir();
  const records = [];
  const unreadable = [];
  let files = [];
  try { files = fs.readdirSync(DIR); } catch (_) { files = []; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const coin = f.slice(0, f.length - '.json'.length).split('__')[0];
    let rec = null;
    try { rec = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (err) {
      unreadable.push({ coin, file: f, why: `this file could not be read back: ${String(err.message || err)} — read the coin again, or remove it below` });
      continue;
    }
    if (!rec || typeof rec !== 'object') {
      unreadable.push({ coin, file: f, why: 'this file holds nothing a reading could be taken from — read the coin again, or remove it below' });
      continue;
    }
    if (rec.v !== RECORD_V) {
      unreadable.push({
        coin, file: f,
        why: `this reading was written under record shape ${rec.v == null ? '(none)' : rec.v} and this release reads shape ${RECORD_V} — read the coin again, or remove it below`,
        release: rec.provenance ? rec.provenance.release : null,
        capturedAt: rec.provenance ? rec.provenance.capturedAt : null,
      });
      continue;
    }
    records.push(rec);
  }
  return { records, unreadable };
}

// THE CLEANUP THE OWNER CAN REACH (owner order, 2026-09-13: "there has to be a
// cleanup mechanism that the user can reach"). It removes exactly the files
// the screen names as ones this release cannot draw -- found again here, at
// the moment of the press, never taken from the page -- and nothing else. A
// record this release CAN draw is never touched by it.
function coinsCleanup() {
  if (run && !run.finishedAt && !run.error) throw new Error('a Coins reading is running — wait for it to finish before removing files');
  const { unreadable } = scanRecords();
  const removed = [];
  const failed = [];
  for (const u of unreadable) {
    try { fs.unlinkSync(path.join(DIR, u.file)); removed.push(u.file); } catch (err) { failed.push({ file: u.file, why: String(err.message || err) }); }
  }
  return { removed, failed };
}

// about how many decisions a month a shape offers: one a day, or one a week
const DECISIONS_A_MONTH = Object.freeze({ day: 365.25 / 12, week: 365.25 / 12 / 7 });

// EVERY LOOK-BACK EVERY READ RECORD CARRIES, so the screen offers what exists
// rather than what is set.
function lookbacksInRecords(records) {
  const seen = new Set();
  for (const rec of records || []) {
    if (!rec || !rec.read || !rec.shapes) continue;
    for (const sr of Object.values(rec.shapes)) {
      for (const k of Object.keys((sr && sr.moves) || {})) { const h = Number(k); if (Number.isFinite(h)) seen.add(h); }
    }
  }
  return [...seen].sort((a, b) => a - b);
}
function coinsRecords() {
  const band = sitOutBand();
  const auto = bandAuto();
  const bar = passBar();
  const off = new Set(passersOff());
  const lays = layouts();
  const rows = [];
  const passers = [];
  const { records, unreadable } = scanRecords();
  for (const rec of records) {
    const shapesOut = {};
    for (const s of coins.shapes()) {
      const sr = rec.shapes && rec.shapes[s.key];
      if (!sr || !(sr.periods > 0)) { shapesOut[s.key] = { periods: 0, why: (sr && sr.why) || `${rec.coin} was not read at ${s.label}` }; continue; }
      // THE SIGNAL READING, on the same press (S9): the band sweep, the
      // plateau, the sweet spot and the traits, worked out from the record's
      // moves and outcomes at every band of the grid. The check with the link
      // cut (S7) was made when the coin was read and rides on the record; it
      // is copied beside the reading here.
      const sig = signal.signalSummary(sr, s.key, lays, band);
      sig.linkCut = signal.linkCutWorth(sig.plateau, sr.linkCut);
      // EACH SHAPE AT ITS OWN SWEET SPOT when the tick is on: the bars, the
      // numbers and the line's own reading are all taken at that band; where
      // no band beats chance the typed band applies, and the shape says which.
      const useBand = auto && sig.sweetSpot ? sig.sweetSpot.band : band;
      if (useBand !== band) sig.atCurrent = signal.atBand(sr, s.key, lays, useBand) || sig.atCurrent;
      shapesOut[s.key] = coins.shapeSummary(sr, useBand, lays);
      shapesOut[s.key].signal = sig;
      shapesOut[s.key].band = { value: useBand, source: useBand !== band || (auto && sig.sweetSpot) ? 'sweet spot' : 'typed' };
      // A PASSER: a plateau the check matched in at most `bar` of the deals.
      // Its numbers are read at its own sweet spot whatever the box holds.
      const lc = sig.linkCut;
      if (sig.plateau && sig.sweetSpot && lc && lc.asStrong != null && lc.asStrong <= bar) {
        const spot = sig.sweep.find((p) => p.band === sig.sweetSpot.band) || {};
        const at = signal.atBand(sr, s.key, lays, sig.sweetSpot.band);
        passers.push({
          coin: rec.coin, geometry: s.key, shape: s.label,
          check: { asStrong: lc.asStrong, trials: lc.trials },
          band: sig.sweetSpot.band, called: spot.called == null ? null : spot.called,
          // the median window move the band is a share of, so stage 3 reads
          // this coin's windows at the same yardstick Coins did (3.130.0)
          yardstick: coins.medianAbsMove(sr.move),
          edge: spot.edge == null ? null : spot.edge, perDecision: spot.perDecision == null ? null : spot.perDecision,
          ratio: spot.ratio == null ? null : spot.ratio, judged: spot.judged == null ? null : spot.judged,
          lean: at && at.lean ? { rising: at.lean.rising, falling: at.lean.falling } : null,
          traits: sig.traits ? [sig.traits.direction, sig.traits.holding, sig.traits.carrier].filter(Boolean) : [],
          tradesAMonth: spot.called == null ? null : DECISIONS_A_MONTH[s.every === 'week' ? 'week' : 'day'] * spot.called,
          ticked: !off.has(passerKey(rec.coin, s.key)),
        });
      }
    }
    rows.push({ coin: rec.coin, read: rec.read, why: rec.why, provenance: rec.provenance, shapes: shapesOut });
  }
  rows.sort((a, b) => String(a.coin).localeCompare(String(b.coin)));
  unreadable.sort((a, b) => String(a.coin).localeCompare(String(b.coin)));
  // the passers in the order of their check, then their coin, then the shapes' order
  const shapeOrder = coins.shapes().map((s) => s.key);
  passers.sort((a, b) => a.check.asStrong - b.check.asStrong || String(a.coin).localeCompare(String(b.coin)) || shapeOrder.indexOf(a.geometry) - shapeOrder.indexOf(b.geometry));
  return {
    shapes: coins.shapes(),
    layouts: lays,
    band: { value: band, default: DEFAULTS.band, home: 'data/settings.json', auto },
    // WHAT IS SET AGAINST WHAT THE RECORDS ACTUALLY CARRY. A look-back changed
    // since the last read is in `value` and not in `inRecords`, and the screen
    // says so rather than offering a walk that would silently find nothing.
    lookbacks: { value: lookbacks(), default: DEFAULTS.lookbacks, inRecords: lookbacksInRecords(records) },
    // WHICH SHAPES A FIXED LOOK-BACK ACTUALLY WALKS, and which ones stand down
    // because they are the same trade held for the same time. Read off
    // GEOMETRIES so a shape added or changed tomorrow reads correctly with
    // nobody remembering to update a list (RULE FIVE: the screen says it).
    collapse: require('./coinscan').oneShapePerForwardTime(require('./dataset').GEOMETRIES),
    passers: { bar, default: DEFAULTS.passBar, trials: LINK_CUT_TRIALS, rows: passers },
    // what a blank coin box means, as a count, so the label can say it without
    // the number being typed anywhere
    downloaded: defaultCoins().length,
    records: rows,
    unreadable,
    recordVersion: RECORD_V,
  };
}

// WALKING EVERY COIN AND SHAPE FORWARD (3.157.0; a background run across every
// worker, 3.158.0). The screen asks; this hands the walker the records off
// disk, the shapes' own step rates, each unit's sweet spot so the searched band
// can be put beside bands that were not searched for, and where train ends on
// the sealed layout so "learned once" means learned on train. It filters
// nothing: the passing test answers a different question and is not consulted.
//
// IT RUNS IN THE BACKGROUND AND ACROSS EVERY WORKER (owner, 2026-09-17: "you've
// only got it set to use one CPU. That's no good"). Four hundred and fifty
// independent walks that share nothing is exactly what the pool is for, and a
// press that holds the request open for twenty seconds tells the screen
// nothing while it waits -- so the press starts a run, the screen polls it, and
// leaving the tab and coming back finds it still going with its count intact.
let walkRun = null;

function walkPieces(opts) {
  const signal = require('./coinsignal');
  const { records } = scanRecords();
  const lays = layouts();
  const band = sitOutBand();
  const sweetSpots = {};
  const fixedUpTo = {};
  for (const rec of records) {
    if (!rec || !rec.read) continue;
    for (const s of coins.shapes()) {
      const sr = rec.shapes && rec.shapes[s.key];
      if (!sr || !sr.periods) continue;
      const key = `${rec.coin}|${s.key}`;
      const lp = coins.layoutParts(sr.periods, 'reserve61');
      if (lp.parts) { const tr = lp.parts.find((q) => q.name === 'train'); if (tr) fixedUpTo[key] = tr.to + 1; }
      if (opts.sweetSpot === false) continue;
      try {
        const sig = signal.signalSummary(sr, s.key, lays, band);
        if (sig && sig.sweetSpot && sig.sweetSpot.band != null) sweetSpots[key] = sig.sweetSpot.band;
      } catch (_) { /* a shape with nothing to read carries no sweet spot */ }
    }
  }
  return { records, sweetSpots: opts.sweetSpot === false ? null : sweetSpots, fixedUpTo };
}

function coinsWalkStatus() {
  let cpu = { busy: null, cores: null };
  try { cpu = require('./stages').cpuLoad(); } catch (_) { /* the reading is a nicety, never a reason to fail */ }
  const r = walkRun;
  if (!r) return { running: false, none: true, done: 0, of: 0, cpu, error: null, rows: null, asked: null, finishedAt: null, stopping: false, shapes: null, workers: null };
  return {
    running: !!r.running, none: false, done: r.done, of: r.of, cpu,
    error: r.error, rows: r.running ? null : r.rows, asked: r.asked,
    startedAt: r.startedAt, finishedAt: r.finishedAt, stopping: !!r.stop,
    shapes: r.shapes, workers: r.workers,
    collapse: require('./coinscan').oneShapePerForwardTime(require('./dataset').GEOMETRIES),
  };
}

// THE CHOICE, PUT TO THE TEST (3.161.0). Read only -- it re-reads the walk
// already in hand and re-prices nothing, so it costs a fraction of a second on
// eight thousand rows and can be asked again with a different cut.
function coinsWalkSplit(opts = {}) {
  const r = walkRun;
  if (!r || r.running || !Array.isArray(r.rows) || !r.rows.length) {
    return { none: true, why: 'no finished walk is in hand -- press Walk it forward first' };
  }
  const scan = require('./coinscan');
  return { none: false, ...scan.chooseThenRead(r.rows, opts), asked: r.asked, shapes: r.shapes };
}

function coinsWalkStop() {
  if (!walkRun || !walkRun.running) return { stopping: false, why: 'nothing is walking' };
  walkRun.stop = true;
  if (walkRun.pool) { try { walkRun.pool.abort(); } catch (_) { /* already down */ } }
  return { stopping: true };
}

function coinsWalkStart(opts = {}) {
  if (walkRun && walkRun.running) return { started: false, why: 'a walk is already running -- stop it or wait for it' };
  const scan = require('./coinscan');
  const { GEOMETRIES } = require('./dataset');
  const { createPool, configuredSize } = require('./pool');
  const { records, sweetSpots, fixedUpTo } = walkPieces(opts);
  const tasks = scan.walkTasksFor(records, GEOMETRIES, { ...opts, sweetSpots, fixedUpTo });
  const shapes = coins.shapes().map((s) => ({ key: s.key, label: s.label }));
  if (!tasks.length) {
    walkRun = { running: false, done: 0, of: 0, rows: [], error: null, asked: opts, startedAt: Date.now(), finishedAt: Date.now(), stop: false, shapes, workers: 0, pool: null };
    return { started: true, of: 0 };
  }
  const size = configuredSize();
  const pool = createPool();
  walkRun = { running: true, done: 0, of: tasks.length, rows: [], error: null, asked: opts, startedAt: Date.now(), finishedAt: null, stop: false, shapes, workers: size, pool };
  const run = walkRun;
  (async () => {
    try {
      // AS MANY IN FLIGHT AS THERE ARE WORKERS, and the next one starts the
      // moment any of them lands -- a fixed batch would idle every worker that
      // finished early waiting for the slowest of its batch.
      let next = 0;
      const lane = async () => {
        for (;;) {
          if (run.stop) return;
          const i = next++;
          if (i >= tasks.length) return;
          const t = tasks[i];
          const got = await pool.run('coinWalk', t.payload);
          run.rows.push(scan.rowOf(t, got));
          run.done++;
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, size) }, () => lane()));
    } catch (err) {
      if (!run.stop) run.error = String(err && err.message ? err.message : err);
    } finally {
      try { pool.abort(); } catch (_) { /* already down */ }
      run.pool = null;
      run.running = false;
      run.finishedAt = Date.now();
    }
  })();
  return { started: true, of: tasks.length, workers: size };
}

module.exports = {
  RECORD_V, DEFAULTS, BAND_KEY, AUTO_KEY, PASS_BAR_KEY, PASS_OFF_KEY, LINK_CUT_TRIALS, layouts, recordFile,
  sitOutBand, setSitOutBand, bandAuto, setBandAuto,
  passBar, setPassBar, passersOff, setPasserTicked, passingUnits, passersCached, passerLeans,
  LOOKBACKS_KEY, lookbacks, setLookbacks,
  readOneCoin, normalise, busyWhy, removeOlderFilesFor,
  coinsRunStart, coinsRunStatus, coinsRunStop,
  readRecord, scanRecords, coinsRecords, coinsCleanup,
  coinsWalkStart, coinsWalkStatus, coinsWalkStop, coinsWalkSplit,
};
