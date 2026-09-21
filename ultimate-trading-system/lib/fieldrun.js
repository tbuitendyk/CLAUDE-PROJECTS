// fieldrun.js -- BUILDING THE DECISION FIELD ON THE BOX (FIELD-DESIGN.md
// section E; owner LOOP NOW! 2026-09-21). The run, its status for the screen,
// its stop, and the opening of a saved field -- the same four doors the walk
// has (lib/coinsrun.js, coinsWalkStart and friends), because the owner learns
// one shape of long job on Coins and not two.
//
// ONE TASK PER COIN AND CHUNK SHAPE on the worker pool. Each task carries its
// own decisions, outcomes and look-back moves, worked out here from the
// candles with the same windowMoves the walk and stage 3 read, so the field
// and the trades it will gate are lined up on the same instants. Shapes that
// hold for the same time are one field (oneShapePerForwardTime, as the walk),
// and the pair records which shapes it stands for.
//
// THE WINDOW IS HELD TO THE TRAIN STRETCH (owner, point 9 and the cap of
// 2026-09-21): a number of days is refused above the system maximum -- the
// train stretch of the shortest history on the box under 61/13/13/13 -- and
// `each coin's own` gives every pair its own train stretch instead.
const fs = require('fs');

let fieldRun = null;
const DAY_MS = 86400000;

// what this file has going, named for stageBusy() through coinsOwnBusy()
function fieldOwnBusy() {
  if (fieldRun && fieldRun.running) return 'the field build is going';
  return null;
}

// ---- the cap: the train stretch, in days, of every read coin -------------------
//
// A coin's train stretch is read off its own daily record: the decisions the
// 61/13/13/13 layout puts in train, from the first decision's instant to the
// last train decision's. The system maximum is the shortest of them. Nothing
// here is typed: the share comes from the layout's own split.
function trainDaysOf(shapeRec) {
  if (!shapeRec || !shapeRec.periods || !Array.isArray(shapeRec.ts) || shapeRec.ts.length < 2) return null;
  const coins = require('./coins');
  const lp = coins.layoutParts(shapeRec.periods, 'reserve61');
  if (!lp || !lp.parts) return null;
  const tr = lp.parts.find((q) => q.name === 'train');
  if (!tr) return null;
  const ts = shapeRec.ts;
  const from = ts[0]; const to = ts[Math.min(ts.length - 1, tr.to)];
  const days = Math.floor((to - from) / DAY_MS);
  return days > 0 ? { days, firstTs: from, decisions: tr.to - tr.from + 1 } : null;
}
// the daily shape a coin's cap is read from: the shortest step, first found
function capShapeKey() {
  const coins = require('./coins');
  const { GEOMETRIES } = require('./dataset');
  const keys = coins.shapes().map((s) => s.key);
  return keys.slice().sort((a, b) => (GEOMETRIES[a].stepHours - GEOMETRIES[b].stepHours) || (GEOMETRIES[a].featureHours - GEOMETRIES[b].featureHours))[0];
}
function capOf(records) {
  const shapeKey = capShapeKey();
  let best = null;
  const perCoin = {};
  for (const rec of records || []) {
    if (!rec || !rec.read || !rec.shapes) continue;
    const sr = rec.shapes[shapeKey];
    const got = trainDaysOf(sr);
    if (!got) continue;
    perCoin[rec.coin] = got;
    if (!best || got.days < best.days) best = { days: got.days, coin: rec.coin, firstTs: got.firstTs };
  }
  return { shape: shapeKey, share: 'train under 61/13/13/13', system: best, perCoin };
}

// ---- the tasks: one per coin and shape, with everything the worker needs ---------
async function loadMap(coin) {
  const pipeline = require('./pipeline');
  const { toHourlyMap, forwardFill } = require('./dataset');
  const loaded = await pipeline.loadSymbolAll(coin, () => {});
  if (!loaded.rows.length) throw new Error('no cached prices on this box');
  return forwardFill(toHourlyMap(loaded.rows)).map;
}
function inputFor(map, geometry, lookbackHours, opts = {}) {
  const windowLib = require('./windowmove');
  const { GEOMETRIES } = require('./dataset');
  const geo = GEOMETRIES[geometry];
  const wm = windowLib.windowMoves(map, geometry, lookbackHours, { keepUnclosed: !!(opts && opts.keepUnclosed) });
  const decisionTs = wm.ts.map((startTs) => windowLib.decisionAt(map, startTs, geo).ts);
  const closeTs = wm.ts.map((startTs) => startTs + geo.exitOffsetH * 3600000);
  const moves = {};
  for (const h of lookbackHours) moves[String(h)] = wm.moves[String(h)];
  return { decisionTs, closeTs, out: wm.out, moves, decisions: wm.periods };
}

// the pairs a launch names: every read coin (or the ones typed), and either
// one chunk shape or every one that holds for a different time
function pairsFor(records, opts) {
  const scan = require('./coinscan');
  const coinsLib = require('./coins');
  const { GEOMETRIES } = require('./dataset');
  const only = Array.isArray(opts.only) && opts.only.length ? new Set(opts.only.map((c) => String(c).toUpperCase())) : null;
  const coins = (records || []).filter((r) => r && r.read && (!only || only.has(String(r.coin).toUpperCase()))).map((r) => String(r.coin).toUpperCase());
  const collapse = scan.oneShapePerForwardTime(GEOMETRIES);
  let shapes;
  if (opts.everyShape) {
    shapes = collapse.map((c) => ({ geometry: c.walks, standsFor: c.standsFor }));
  } else {
    const g = String(opts.geometry || '');
    if (!coinsLib.shapes().some((s) => s.key === g)) throw new Error(`${JSON.stringify(g)} is not a chunk shape on this box`);
    shapes = [{ geometry: g, standsFor: [] }];
  }
  const out = [];
  for (const coin of coins) for (const s of shapes) out.push({ coin, geometry: s.geometry, standsFor: s.standsFor, key: require('./fieldset').pairKey(coin, s.geometry) });
  return { pairs: out, collapse, coins, missing: only ? [...only].filter((c) => !coins.includes(c)) : [] };
}

// ---- the four doors ------------------------------------------------------------
function fieldStatus() {
  const fset = require('./fieldset');
  let cpu = { busy: null, cores: null };
  try { cpu = require('./stages').cpuLoad(); } catch (_) { /* a nicety */ }
  const fresh = () => ({
    fields: (() => { try { return fset.listFields(); } catch (_) { return []; } })(),
    unfinishedFields: (() => { try { return fset.unfinishedFields(); } catch (_) { return []; } })(),
    nextName: (() => { try { return fset.nextName(); } catch (_) { return ''; } })(),
    cap: (() => { try { return capOf(require('./coinsrun').scanRecords().records); } catch (_) { return null; } })(),
  });
  const r = fieldRun;
  if (!r) {
    return { running: false, none: true, done: 0, of: 0, cpu, error: null, asked: null, startedAt: null, finishedAt: null, stopping: false, workers: null, saved: null, saveError: null, unfinished: null, pairs: null, ...fresh() };
  }
  const f = fresh();
  return {
    running: !!r.running, none: false, done: r.done, of: r.of, cpu,
    filling: r.filling || null, error: r.error, asked: r.asked,
    startedAt: r.startedAt, finishedAt: r.finishedAt, stopping: !!r.stop, workers: r.workers,
    saved: r.saved || null, saveError: r.saveError || null,
    keeping: r.id || null, carriedOn: r.carriedOn || 0, unfinished: r.unfinished || null,
    // the pairs landed so far, briefly -- the grid and the series stay on disk
    pairs: r.running ? null : r.pairs.map((p) => fset.pairBrief(p)),
    collapse: r.collapse || null, capUsed: r.cap || null,
    ...f,
    unfinishedFields: r.running ? f.unfinishedFields.filter((u) => u.id !== r.id) : f.unfinishedFields,
  };
}

function fieldStop() {
  if (!fieldRun || !fieldRun.running) return { stopping: false, why: 'nothing is building' };
  fieldRun.stop = true;
  if (fieldRun.pool) { try { fieldRun.pool.abort(); } catch (_) { /* already down */ } }
  return { stopping: true };
}

// opening one puts it where a fresh build would be, so the screen reads it
// through the one path
function fieldOpen(id) {
  const fset = require('./fieldset');
  const doc = fset.readField(id);
  if (!doc) throw new Error(`there is no field ${JSON.stringify(String(id))} on this box`);
  fieldRun = {
    running: false, done: (doc.pairs || []).length, of: (doc.pairs || []).length, pairs: doc.pairs || [],
    error: null, asked: doc.asked, startedAt: doc.startedAt, finishedAt: doc.finishedAt, stop: false,
    workers: 0, pool: null, collapse: doc.collapse, cap: doc.cap,
    saved: { id: doc.id, name: doc.name, pairs: (doc.pairs || []).length, opened: true },
  };
  return { id: doc.id, name: doc.name, pairs: (doc.pairs || []).length };
}

// one pair in full: the grid, the yardsticks, today's readings and the series
function fieldPair(id, key) {
  const fset = require('./fieldset');
  const doc = fset.readField(id);
  if (!doc) throw new Error(`there is no field ${JSON.stringify(String(id))} on this box`);
  const p = (doc.pairs || []).find((x) => x.key === String(key));
  if (!p) throw new Error(`${JSON.stringify(String(key))} is not a pair of ${doc.id}`);
  return { id: doc.id, name: doc.name, dials: doc.dials, pair: p };
}

// THE DIALS AS THE SCREEN SENDS THEM, checked in words before anything runs.
// The window is either a number of days, held to the cap, or `each coin's own`.
function dialsFrom(opts, cap) {
  const F = require('./field');
  const eachOwn = opts.windowEachOwn === true;
  const base = {
    windowDays: eachOwn ? (cap.system ? cap.system.days : 1) : opts.windowDays,
    halfLifeDays: opts.halfLifeDays, floor: opts.floor,
    bands: opts.bands, lookbackHours: (Array.isArray(opts.lookbackDays) ? opts.lookbackDays : String(opts.lookbackDays || '').split(/[\s,]+/)).map((d) => (d === '' ? null : Number(d) * 24)).filter((x) => x != null),
    evidenceCap: opts.evidenceCap, leastEvidence: opts.leastEvidence, copies: opts.copies,
  };
  const checked = F.checkDials(base);
  if (!eachOwn) {
    if (!cap.system) throw new Error('no coin has been read, so the system maximum for the window is not known — press Read these coins first');
    if (checked.windowDays > cap.system.days) {
      throw new Error(`window, days is ${checked.windowDays} and the most this box allows is ${cap.system.days} — the train stretch of ${cap.system.coin}, whose history starts ${new Date(cap.system.firstTs).toISOString().slice(0, 10)}. Type ${cap.system.days} or less, or tick each coin's own`);
    }
  }
  return { ...checked, lookbackDays: checked.lookbackHours.map((h) => h / 24), windowEachOwn: eachOwn };
}

function fieldStart(opts = {}) {
  if (fieldRun && fieldRun.running) return { started: false, why: 'a field is already building -- stop it or wait for it' };
  {
    const b = require('./stages').stageBusy();
    if (b) return { started: false, why: `${b} — the field build waits for the box to be free` };
  }
  const fset = require('./fieldset');
  const coinsrun = require('./coinsrun');
  const { createPool, configuredSize } = require('./pool');
  const size = configuredSize();
  const records = coinsrun.scanRecords().records;
  const cap = capOf(records);
  let dials;
  try { dials = dialsFrom(opts, cap); } catch (err) { return { started: false, why: err.message }; }
  let listed;
  try { listed = pairsFor(records, opts); } catch (err) { return { started: false, why: err.message }; }
  if (!listed.pairs.length) {
    return { started: false, why: listed.missing.length ? `none of ${listed.missing.join(', ')} has been read on this screen` : 'no coin has been read on this screen yet — press Read these coins first' };
  }
  const carryOn = opts && opts.carryOn ? String(opts.carryOn) : null;
  const already = carryOn ? fset.partKeys(carryOn) : new Set();
  if (carryOn && !already.size && !fset.readPart(carryOn)) {
    return { started: false, why: `there is nothing saved under ${JSON.stringify(carryOn)} to carry on from` };
  }
  const id = carryOn || fset.nextId();
  const run = {
    running: true, done: already.size, of: listed.pairs.length,
    pairs: carryOn ? (fset.readPart(carryOn) || { pairs: [] }).pairs : [],
    error: null, asked: opts, startedAt: Date.now(), finishedAt: null, stop: false,
    workers: size, pool: null, id, carriedOn: carryOn ? already.size : 0, filling: null,
    collapse: listed.collapse, cap: { ...cap.system, share: cap.share, shape: cap.shape, eachOwn: dials.windowEachOwn },
    saved: null, saveError: null, unfinished: null,
  };
  fieldRun = run;
  (async () => {
    let pool = null;
    try {
      const tasks = already.size ? listed.pairs.filter((p) => !already.has(p.key)) : listed.pairs;
      if (!carryOn) {
        fset.startPart(id, {
          name: (opts && opts.name) || null, startedAt: run.startedAt, of: listed.pairs.length,
          asked: opts, dials, cap: run.cap, collapse: listed.collapse, release: require('../package.json').version,
        });
      }
      if (!tasks.length) {
        if (carryOn) run.saved = fset.sealPart(id, { finishedAt: Date.now(), name: opts && opts.name });
        return;
      }
      pool = createPool();
      run.pool = pool;
      // the candles of the coin in hand, kept only while its shapes are dispatched
      const maps = new Map();
      const mapOf = async (coin) => {
        if (!maps.has(coin)) {
          run.filling = `${coin}: reading its candles`;
          maps.set(coin, await loadMap(coin));
          for (const k of [...maps.keys()]) if (maps.size > 2 && k !== coin) maps.delete(k);
          run.filling = null;
        }
        return maps.get(coin);
      };
      let next = 0;
      const lane = async () => {
        for (;;) {
          if (run.stop) return;
          const i = next++;
          if (i >= tasks.length) return;
          const t = tasks[i];
          let rec;
          try {
            const map = await mapOf(t.coin);
            // TO THE LAST FULL DAY ON FILE (owner order, 2026-09-21: "when i
            // use the build the field function and open a grid i want to see
            // today's decision if i've got the data fresh to today"). The
            // decisions whose chunk has not closed yet are days of the field
            // too -- read, never added to a point -- so the last day is the
            // latest decision the candles reach, not the last one that closed.
            const input = inputFor(map, t.geometry, dials.lookbackHours, { keepUnclosed: true });
            const own = cap.perCoin[t.coin] || null;
            const windowDays = dials.windowEachOwn ? (own ? own.days : dials.windowDays) : dials.windowDays;
            const got = await pool.run('coinField', { input, dials: { ...dials, windowDays, seedText: t.key } });
            rec = {
              key: t.key, coin: t.coin, geometry: t.geometry, standsFor: t.standsFor,
              decisions: input.decisions, firstTs: input.decisionTs[0] ?? null, lastTs: input.decisionTs[input.decisionTs.length - 1] ?? null,
              windowDays, capDays: own ? own.days : null,
              ...got,
            };
          } catch (err) {
            if (run.stop) return;
            rec = { key: t.key, coin: t.coin, geometry: t.geometry, standsFor: t.standsFor, error: String(err && err.message ? err.message : err) };
          }
          run.pairs.push(rec);
          try { fset.appendPart(id, [rec]); } catch (err) { run.saveError = String(err && err.message ? err.message : err); }
          run.done++;
        }
      };
      await Promise.all(Array.from({ length: Math.max(1, size) }, () => lane()));
    } catch (err) {
      if (!run.stop) run.error = String(err && err.message ? err.message : err);
    } finally {
      run.filling = null;
      try { if (pool) pool.abort(); } catch (_) { /* down */ }
      run.pool = null;
      run.running = false;
      run.finishedAt = Date.now();
      if (!run.stop && !run.error && run.done >= run.of && run.of > 0) {
        try { run.saved = fset.sealPart(id, { finishedAt: run.finishedAt, name: run.asked && run.asked.name }); }
        catch (err) { run.saveError = String(err && err.message ? err.message : err); }
      } else if (run.pairs.length) {
        run.unfinished = { id, pairs: run.pairs.length, of: run.of };
      }
    }
  })();
  return { started: true, of: listed.pairs.length, workers: size, missing: listed.missing };
}

module.exports = { fieldStart, fieldStatus, fieldStop, fieldOpen, fieldPair, fieldOwnBusy, capOf, trainDaysOf, dialsFrom, pairsFor, inputFor };
