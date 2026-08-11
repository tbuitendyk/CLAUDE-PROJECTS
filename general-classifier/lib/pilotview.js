// pilotview.js -- turn the executor's append-only journal into the state the
// live trade screen shows. Pure and read-only: it parses journal lines and
// derives, exactly as the executor does, plus the execution-fidelity aggregates
// the pilot exists to measure (realized cost per leg vs the $0.125 model, fill
// deviation distribution). It NEVER trades and imports no engine code.
//
// The journal is produced ON the Mexico box and synced to
// data/pilot/journal.jsonl by a VPS timer. If the file is absent the pilot has
// not run yet; that is a state, not an error.
const fs = require('fs');
const path = require('path');

const JOURNAL = path.join(__dirname, '..', 'data', 'pilot', 'journal.jsonl');
const MODEL_FEE_PER_LEG = 0.125; // the assumption the pilot measures against

function readJournal(file = JOURNAL) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { present: false, events: [], mtime: null };
  }
  const events = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { events.push(JSON.parse(s)); } catch (_) { events.push({ event: 'TORN_LINE' }); }
  }
  let mtime = null;
  try { mtime = fs.statSync(file).mtimeMs; } catch (_) { /* ignore */ }
  return { present: true, events, mtime };
}

function derive(events) {
  const open = {};
  let realized = 0;
  let consecutiveRejects = 0;
  let dustDone = false;
  let armed = false;      // owner's master switch, as the box last reported it
  let halted = false;
  let armedBy = null;
  const closed = [];
  const legCosts = [];   // realized cost per leg, from fills that carry it
  const fillDeviations = [];
  const incidents = [];  // anything the screen should surface in red

  for (const e of events) {
    switch (e.event) {
      case 'ENTRY_FILL':
        open[e.chunk_start] = {
          chunk_start: e.chunk_start, side: e.side, qty: e.qty,
          entry_price: e.price, entry_utc: e.utc, exit_due_ts: e.exit_due_ts,
          decision_price: e.decision_price, fill_deviation: e.fill_deviation,
        };
        if (typeof e.fill_deviation === 'number') fillDeviations.push(e.fill_deviation);
        if (typeof e.fee_quote === 'number') legCosts.push(e.fee_quote);
        consecutiveRejects = 0;
        break;
      case 'EXIT_FILL': {
        const p = open[e.chunk_start];
        delete open[e.chunk_start];
        realized += e.pnl || 0;
        if (typeof e.fee_quote === 'number') legCosts.push(e.fee_quote);
        closed.push({ chunk_start: e.chunk_start, side: e.side, pnl: e.pnl,
          exit_price: e.price, exit_utc: e.utc,
          entry_price: p ? p.entry_price : null });
        consecutiveRejects = 0;
        break;
      }
      case 'ORDER_REJECT': consecutiveRejects += 1;
        incidents.push({ utc: e.utc, kind: 'ORDER_REJECT', detail: e.body || '' }); break;
      case 'ORDER_ACK': consecutiveRejects = 0; break;
      case 'DUST_DONE': dustDone = true; break;
      case 'RUN_STATUS': armed = !!e.armed; halted = !!e.halted; break;
      case 'ARM_SET': armed = true; armedBy = e.source || null; break;
      case 'ARM_CLEAR': armed = false; armedBy = e.source || null; break;
      case 'KILL_PRICE_DRIFT':
      case 'RECONCILE_MISMATCH':
      case 'RECONCILE_UNREADABLE':
      case 'KILL_TRANSPORT':
      case 'EXIT_OVERDUE':
      case 'MIRROR_BREAK':
      case 'HALT_SET':
        incidents.push({ utc: e.utc, kind: e.event, detail: JSON.stringify(
          Object.fromEntries(Object.entries(e)
            .filter(([k]) => !['event', 'ts', 'utc'].includes(k)))) });
        break;
      default: break;
    }
  }

  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const lastHeartbeat = [...events].reverse().find((e) =>
    ['CLOCK_SYNC', 'BALANCE', 'RECONCILE_OK'].includes(e.event));

  // the full event log the owner asked for: everything the executor did, newest
  // first, lightly flattened so the screen can print it verbatim.
  const log = events.slice(-400).reverse().map((e) => ({
    utc: e.utc || null,
    event: e.event,
    detail: Object.fromEntries(Object.entries(e)
      .filter(([k]) => !['event', 'ts', 'utc'].includes(k))),
  }));

  return {
    armed,
    halted,
    armedBy,
    openPositions: Object.values(open).sort((a, b) => a.exit_due_ts - b.exit_due_ts),
    closedRecent: closed.slice(-20).reverse(),
    realizedPnl: round(realized, 4),
    consecutiveRejects,
    dustDone,
    log,
    // the execution-fidelity numbers the pilot is FOR
    modelFeePerLeg: MODEL_FEE_PER_LEG,
    realizedFeePerLegAvg: round(avg(legCosts), 6),
    fillDeviationAvg: round(avg(fillDeviations), 6),
    fillDeviationMax: fillDeviations.length ? round(Math.max(...fillDeviations), 6) : null,
    incidents: incidents.slice(-30).reverse(),
    lastHeartbeatUtc: lastHeartbeat ? lastHeartbeat.utc : null,
    eventCount: events.length,
  };
}

function round(v, n = 4) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** n;
  return Math.round(v * f) / f;
}

// The tested configuration, for the screen to show "how this is set up". The
// MODEL half comes from forwardbook.BOOKS[F1] and dataset geometry — the exact
// same source the forward book and the live signal use, so what the owner sees
// cannot drift from what trades. The EXECUTION half (clip, concurrency, fees,
// kill limits) mirrors PILOT-F1.md; lazy-required so a torn journal read never
// needs the engine.
function config() {
  const fb = require('./forwardbook');
  const { GEOMETRIES } = require('./dataset');
  const b = fb.BOOKS.find((x) => x.id === 'F1');
  const geo = GEOMETRIES[b.branch.geometry] || {};
  return {
    id: b.id,
    note: b.note,
    model: {
      tradedPair: b.combo.trade,
      contextInputs: [b.combo.ctx1, b.combo.ctx2],
      geometry: b.branch.geometry,
      featureHours: geo.featureHours,
      stepHours: geo.stepHours,
      entryOffsetH: geo.entryOffsetH,
      holdHours: b.cell.tHours,
      decision: b.branch.decision,
      dormantBandPct: Math.abs(b.branch.band),
      committeeSize: b.members.length,
      committeeStage: b.stage,
      quorum: b.cell.quorum,
      entry: b.cell.entry,
      gate: b.cell.gate,
      trainedThrough: new Date(fb.TRAIN_THROUGH).toISOString().slice(0, 10),
    },
    execution: {
      clipUsd: 10,
      maxConcurrent: 6,
      marginMode: 'isolated (long = buy, short = borrow-and-sell)',
      modelFeePerLeg: MODEL_FEE_PER_LEG,
      killRules: {
        consecutiveRejects: 3,
        fillDeviationPct: 1.0,
        cumulativeLossUsd: 50,
      },
      note: 'execution values per PILOT-F1.md; kill thresholds are GUESSED, '
        + 'declared before any order',
    },
  };
}

function armRequest() {
  try {
    return JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'data', 'pilot', 'arm-request.json'), 'utf8'));
  } catch (e) { return null; }
}

function status(file = JOURNAL) {
  let cfg = null;
  try { cfg = config(); } catch (e) { cfg = { error: e.message }; }
  const req = armRequest();
  const { present, events, mtime } = readJournal(file);
  if (!present) {
    return { present: false, note: 'no pilot journal yet — the executor has not run or has not synced',
      preregistration: 'general-classifier/PILOT-F1.md', config: cfg, armRequest: req };
  }
  const st = derive(events);
  // "pending" when the owner's request and the box's confirmed state disagree
  const armPending = req != null && req.armed !== st.armed;
  return {
    present: true,
    preregistration: 'general-classifier/PILOT-F1.md',
    journalSyncedUtc: mtime ? new Date(mtime).toISOString() : null,
    config: cfg,
    armRequest: req,
    armPending,
    ...st,
  };
}

module.exports = { status, config, derive, readJournal, JOURNAL, MODEL_FEE_PER_LEG };
