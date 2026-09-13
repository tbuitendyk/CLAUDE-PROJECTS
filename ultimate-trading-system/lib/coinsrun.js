// coinsrun.js -- THE COINS RUN: reading every chosen coin's history and writing
// what it holds (COINS.md; owner LOOP NOW! 2026-09-12).
//
// This is the plumbing. Every number it reports comes out of lib/coins.js,
// which is where the arithmetic lives and where it is tested. Nothing here
// decides anything about a coin: it loads, it measures, it writes.
//
// IT CHARACTERISES THE HISTORY, NOT OUR TREATMENT OF IT (owner order,
// 2026-09-13: "principally we are characterizing the HISTORY, not our treatment
// of the history", and "chunk shape and 24/5 are actually completely irrelevant
// here -- you need to look at the three hold types and their possible starting
// anchors only").
//
// Until now this tab made the owner pick a chunk shape and a 24/5 setting
// before it would say anything, and then reported what ONE treatment of the
// history holds while its own opening line said it reported what the history
// holds. Both were wrong to ask. A chunk shape's name is its look-back, which
// only feeds training and changes nothing about the trade; measured, the five
// shapes collapse to three holds -- 17 hours, 41 hours and 60 hours -- and
// 24/5 was never a property of the coin at all, only a rule about which start
// days we allow.
//
// So every coin is now read at all three holds, at the anchors the engine
// pins (owner: "hold the anchors as they are"): 01:00 every day for the two
// daily holds, Tuesday 03:00 for the weekly one. Fifteen possible starts a
// week, and no treatment left for the owner to choose before they can look.
//
// THE TRADES ARE THE SWEEP'S OWN TRADES. They come from buildComboChunks, the
// same function a stage 1 launch builds them with, so a reading here lines up
// trade for trade with the runs it is vetting for. Building them another way
// would be a second definition of what a trade is.
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
const { holdTypes } = require('./dataset');
// through the module, so a test can stand in for the cache (see lib/stages.js)
const defaultCoins = (...a) => require('./dataset').defaultCoins(...a);

const DIR = path.join(__dirname, '..', 'data', 'coins');
// THE RECORD SHAPE. It moves whenever what is written changes, so a reading
// taken under an older shape is NAMED on the screen rather than drawn as
// though it were current (RULE NINE). 4 (3.122.0): one record per coin, no
// longer one per coin and chunk shape, and it carries a reading per HOLD
// instead of a reading of whichever treatment was chosen. A shape-3 record
// describes one treatment and has no way to say which hold it was, so it
// cannot be drawn in this table at all.
//
// AND IT CLOSES A COLLISION. A shape-3 record was keyed by coin and chunk shape
// only -- 24/5 was not in the key -- so reading a coin with it on overwrote the
// reading taken with it off, same file, last press wins, with nothing but the
// line under the row to say which one survived.
const RECORD_V = 4;

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
  // how many times a coin's own periods are shuffled to work out whether either
  // untuned number can say anything about it at this much history (COINS.md
  // section 11). A precision setting, not a threshold -- there is no line to
  // set. More shuffles only ever widen the range the shuffles cover, so
  // raising this can turn a can tell into a cannot tell and never back.
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
// ONE FILE PER COIN. It was one per coin and chunk shape, which is how a
// treatment ended up in the name of a thing that is meant to describe a coin.
const recordFile = (coin) => path.join(DIR, `${String(coin).toUpperCase()}.json`);

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

// THE RECORD EVERY COIN GETS, read or not. `holds` carries one entry per hold
// the engine's shapes offer; an entry is either the reading or a sentence
// saying why there is none. `why` at the top is for a coin that could not get
// as far as a reading at all.
function blankRecord(coin, params, why) {
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
    params,
    holds: {},
  };
}

// ONE HOLD, ON PRICES ALREADY LOADED. Everything the tab reports about a coin
// is reported once per hold, because a hold is the only thing about our
// treatment that changes what trades the history actually offered.
function readOneHold(coin, hold, map, params, onNote = () => {}) {
  const bracket = require('./bracket');
  onNote(`${coin}: ${hold.hours}-hour trades`);
  // WEEKDAYS ARE NOT FILTERED, and that is the anchors being held where they
  // are (owner, 2026-09-13). 24/5 is a rule about which start days we allow
  // ourselves, not something the coin's history has an opinion about.
  const built = bracket.buildComboChunks({ trade: map }, hold.geometry, false);
  const { prices, moves } = seriesOf(built.chunks);
  const first = built.chunks.find((c) => c.c1 != null);
  const last = [...built.chunks].reverse().find((c) => c.c1 != null);
  const out = {
    hold: { key: hold.key, hours: hold.hours, every: hold.every, at: hold.at, startsPerWeek: hold.startsPerWeek },
    periods: prices.length,
    read: prices.length > 0,
    why: prices.length ? null : `${coin} offers no complete ${hold.hours}-hour trades from the prices cached on this box`,
    span: { fromTs: first ? first.startTs : null, toTs: last ? last.startTs : null },
    traditional: prices.length
      ? coins.traditionalReading(moves, { driftParts: params.driftParts, shuffles: params.shuffles })
      : null,
    readings: {},
  };
  for (const layout of layouts()) {
    if (!prices.length) { out.readings[layout] = { layout, why: out.why }; continue; }
    try {
      out.readings[layout] = coins.coinReading(prices, moves, {
        layout,
        target: params.target, from: params.from, to: params.to, step: params.step,
        cap: params.cap,
      });
    } catch (err) {
      // NOT A REFUSAL OF THE COIN. The arithmetic could not be done for this one
      // window layout -- too few trades for its split to leave every stretch
      // with something in it, most likely -- so that is what the record says,
      // and every other layout, every other hold and the two untuned numbers
      // are still there.
      out.readings[layout] = { layout, why: String(err.message || err) };
    }
  }
  return out;
}

async function readOneCoin(coin, params, onNote = () => {}) {
  const pipeline = require('./pipeline');
  const { toHourlyMap, forwardFill } = require('./dataset');
  const kept = {
    target: params.target, from: params.from, to: params.to, step: params.step,
    cap: params.cap, driftParts: params.driftParts, shuffles: params.shuffles,
  };

  onNote(`${coin}: reading its cached prices`);
  const loaded = await pipeline.loadSymbolAll(coin, (m) => onNote(`${coin}: ${m}`));
  if (!loaded.rows.length) {
    return blankRecord(coin, kept, `${coin} has no cached prices on this box — download them on Data first`);
  }
  // forwardFill HANDS BACK A WRAPPER and the filled prices are inside it. The
  // first version passed the wrapper straight on as the price map, so every
  // coin threw on the first trade built and the tab read nothing at all, ever.
  // Nineteen tests were green and not one of them loaded this file.
  const map = forwardFill(toHourlyMap(loaded.rows)).map;

  const rec = {
    v: RECORD_V,
    coin: String(coin).toUpperCase(),
    read: false,
    why: null,
    // THE PROVENANCE (COINS.md section 12). A score cannot be read honestly
    // without knowing which span and which parameter values produced it, so
    // both are on the record and both are drawn beside the reading. The span
    // belongs to each hold, because the holds do not start or end together.
    provenance: {
      release: require('../package.json').version,
      capturedAt: new Date().toISOString(),
      cachedMonths: loaded.cachedMonthCount,
      candles: loaded.rows.length,
    },
    params: kept,
    holds: {},
  };
  for (const hold of holdTypes()) {
    rec.holds[hold.key] = readOneHold(coin, hold, map, params, onNote);
  }
  rec.read = Object.values(rec.holds).some((h) => h.read);
  if (!rec.read) rec.why = `${coin} offers no complete trades at any hold from the prices cached on this box`;
  return rec;
}

// ---- the run -----------------------------------------------------------------

let run = null;

function normalise(body = {}) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  const list = String(body.coins || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const p = {
    coins: list.length ? [...new Set(list)] : defaultCoins(),
    target: Math.max(1, Math.floor(num(body.target, DEFAULTS.target))),
    from: num(body.from, DEFAULTS.from),
    to: num(body.to, DEFAULTS.to),
    step: num(body.step, DEFAULTS.step),
    cap: num(body.cap, DEFAULTS.cap),
    driftParts: Math.max(2, Math.floor(num(body.driftParts, DEFAULTS.driftParts))),
    shuffles: Math.max(2, Math.floor(num(body.shuffles, DEFAULTS.shuffles))),
  };
  // A BLANK BOX ON A BOX WITH NOTHING DOWNLOADED IS NO COINS, and saying so is
  // better than starting a run that reads nothing (owner order, 2026-09-13).
  if (!p.coins.length) throw new Error('no coins are downloaded on this box — download some on Data first, or type the ones you want');
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
      fs.writeFileSync(recordFile(coin), `${JSON.stringify(rec)}\n`);
      if (rec.read) run.wrote.push(coin); else run.couldNotRead.push({ coin, why: rec.why });
    } catch (err) {
      // A COIN THAT THREW ON THE WAY IN STILL GETS A RECORD, so the screen shows
      // it with its reason instead of leaving it out. The first version kept
      // the reason in memory only, on the latest press: read seventeen coins,
      // two fail, press again for one, and the two were gone with nothing said.
      const rec = blankRecord(coin, {
        target: p.target, from: p.from, to: p.to, step: p.step,
        cap: p.cap, driftParts: p.driftParts, shuffles: p.shuffles,
      }, String(err.message || err));
      try { fs.writeFileSync(recordFile(coin), `${JSON.stringify(rec)}\n`); } catch (_) { /* the disk said no; the run carries on */ }
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

function readRecord(coin) {
  try { return JSON.parse(fs.readFileSync(recordFile(coin), 'utf8')); } catch (_) { return null; }
}

// EVERY RECORD ON THE BOX. There is no chunk shape to select by any more: one
// record per coin, carrying every hold. Ordered by the caller's choice, which
// is a control on the screen and never decided here (RULE FIVE).
//
// A FILE THAT CANNOT BE READ IS NAMED, NEVER DROPPED. The first version skipped
// both an unparseable file and a record written under an older shape, in
// silence -- so a release bump made the owner's readings disappear from the
// screen with nothing saying where they went, and the screen then said nothing
// had ever been read. That is the RULE NINE hole: what is on disk either says
// what it is in today's words or it is migrated, and either way the reader
// says which.
function coinsRecords() {
  ensureDir();
  const rows = [];
  const unreadable = [];
  let files = [];
  try { files = fs.readdirSync(DIR); } catch (_) { files = []; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    // THE NAME OFF THE FILE IS ONLY A FALL-BACK. A record that parses says its
    // own coin; a file written under the old one-per-chunk-shape name still
    // has to be NAMED on the screen rather than skipped, so it is read the same
    // way as any other and refused on its shape.
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
    holds: holdTypes(),
    // what a blank coin box means, as a count, so the label can say it without
    // the number being typed anywhere
    downloaded: defaultCoins().length,
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
  seriesOf, readOneCoin, readOneHold, blankRecord, normalise,
  coinsRunStart, coinsRunStatus, coinsRunStop, coinsRecords, readRecord,
  recordFile,
};
