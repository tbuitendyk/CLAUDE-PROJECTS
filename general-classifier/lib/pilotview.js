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
  const decisions = {};  // chunk_start -> the committee's call, votes and fate

  for (const e of events) {
    switch (e.event) {
      case 'INTENT_SEEN':
        decisions[e.chunk_start] = {
          chunk_start: e.chunk_start, utc: e.utc, side: e.side,
          votes: e.per_member || null, quorum: e.quorum ?? null,
          decision_price: e.decision_price ?? null,
          input_hash: e.input_hash || null,
          fate: e.side === 'FLAT' ? 'flat — no trade' : 'seen',
        };
        break;
      case 'ENTRY_SKIPPED':
        if (decisions[e.chunk_start]) decisions[e.chunk_start].fate = `skipped: ${e.reason}`;
        break;
      case 'ENTRY_FILL':
        if (decisions[e.chunk_start]) decisions[e.chunk_start].fate = 'filled';
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
      case 'INTENT_STALE':
      case 'CLOCK_DRIFT':
      case 'ARM_STALE':
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
    decisions: Object.values(decisions)
      .sort((a, b) => String(b.chunk_start).localeCompare(String(a.chunk_start)))
      .slice(0, 30),
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

// The decision anatomy the owner asked to SEE on the page: how the models are
// structured, how the votes fire, what the entry algorithm is, and exactly how
// the comparison assets enter the equation. Everything here is READ from the
// live engine modules (features.js, bracket.js, forwardbook.js) — no prose-only
// claims that could drift from the code that actually decides.
function anatomy() {
  const fb = require('./forwardbook');
  const { GEOMETRIES } = require('./dataset');
  const feats = require('./features');
  const bracketLib = require('./bracket');
  const b = fb.BOOKS.find((x) => x.id === 'F1');
  const geo = GEOMETRIES[b.branch.geometry];
  const nDays = geo.featureHours / 24;
  const names = feats.featureNamesFor(nDays);      // trade+comp layout (one context pair)
  const cv = bracketLib.comboViews(b.combo.size, nDays);
  const bandPct = Math.abs(b.branch.band);

  // Per-view feature counts, straight from the engine's index arrays.
  const views = {};
  for (const [k, idx] of Object.entries(cv.views)) views[k] = idx ? idx.length : null;

  const crossNames = names.filter((n) => n.startsWith('rel_') || n === 'ret_correlation');
  const perAssetNames = names.filter((n) => n.startsWith('trade_')).map((n) => n.slice('trade_'.length));

  return {
    pipeline: [
      `1. INPUTS — every day at 00:00 UTC a new decision window opens: the last ${geo.featureHours}h of hourly candles for ${b.combo.trade} (the traded pair) and the two comparison assets ${b.combo.ctx1} and ${b.combo.ctx2}.`,
      `2. FEATURES — each asset's ${geo.featureHours}h window is compressed to ${nDays + 12} numbers (daily returns, total return, hourly volatility, volume shift, trend slope/acceleration, max drawdown/run-up, range, last-24h and last-6h returns, day-volume dispersion). The comparison assets then enter a SECOND way: 4 cross features per pair — relative total return, relative last-24h return, relative volume (log ratio), and the hour-by-hour return correlation between ${b.combo.trade} and the comparison asset. Total vector: ${cv.featureCount} numbers. The comparison assets are never traded — they exist only inside this vector.`,
      `3. MEMBERS VOTE — ${b.members.length} independent models (committee below), each seeing a different SLICE of those ${cv.featureCount} numbers, each trained once on data through ${new Date(fb.TRAIN_THROUGH).toISOString().slice(0, 10)} and frozen. Each is a pure-JS ${b.members[0].model === 'logreg' ? 'softmax logistic regression' : 'model'} classifying the window as UP / DOWN / ASIDE, where ASIDE means "the coming move looks smaller than the ${bandPct}% dormant band". Decision rule '${b.branch.decision}': the member votes whichever class has the highest probability.`,
      `4. COMMITTEE — votes are tallied. Ties between UP and DOWN mean stand aside. Otherwise the majority side wins if it has at least ${b.cell.quorum} vote(s) (quorum ${b.cell.quorum}-of-${b.members.length}); with quorum 1, any un-tied majority fires.`,
      `5. ENTRY — '${b.cell.entry}' algorithm with a '${b.cell.gate}' gate: a market order in the called direction at the hourly OPEN of window start +${geo.entryOffsetH}h (~01:00 UTC). No rails, no breakout wait — the call IS the trade. Long = buy; short = borrow-and-sell on isolated margin.`,
      `6. EXIT — a market order exactly ${b.cell.tHours}h after entry (~18:00 UTC, ${(b.cell.tHours / 24).toFixed(1)} days later). No stop, no trail, no target: the tested cell is a pure time exit, so the hold length is the only exit knob.`,
    ],
    committee: b.members.map((m) => ({
      model: m.model === 'logreg' ? 'softmax logistic regression (lib/logreg.js, pure JS)' : m.model,
      view: m.view,
      featuresSeen: views[m.view],
      viewMeaning: {
        full: 'everything — all price, volume and cross features',
        prices: 'price action only — volume features removed',
        volume: 'volume behaviour only',
        cross: 'only the comparisons against the context assets',
      }[m.view] || m.view,
    })),
    features: {
      totalVector: cv.featureCount,
      perAsset: nDays + 12,
      perAssetNames,
      crossPerPair: crossNames.length,
      crossNames,
      note: `layout: ${b.combo.trade} block + ${b.combo.ctx1} block + ${b.combo.trade}×${b.combo.ctx1} cross + ${b.combo.ctx2} block + ${b.combo.trade}×${b.combo.ctx2} cross`,
    },
    voting: {
      quorum: b.cell.quorum,
      members: b.members.length,
      rule: `count UP votes vs DOWN votes; a tie stands aside; otherwise the majority wins when it has >= ${b.cell.quorum} vote(s)`,
      dormantBandPct: bandPct,
      labelRule: `a training window is labelled UP/DOWN only when the following move exceeds ±${bandPct}%; smaller moves are ASIDE — that is what teaches members to sit out`,
    },
  };
}

function status(file = JOURNAL) {
  let cfg = null;
  try { cfg = config(); } catch (e) { cfg = { error: e.message }; }
  let anat = null;
  try { anat = anatomy(); } catch (e) { anat = { error: e.message }; }
  const req = armRequest();
  const { present, events, mtime } = readJournal(file);
  if (!present) {
    return { present: false, note: 'no pilot journal yet — the executor has not run or has not synced',
      preregistration: 'general-classifier/PILOT-F1.md', config: cfg, anatomy: anat, armRequest: req };
  }
  const st = derive(events);
  // "pending" when the owner's request and the box's confirmed state disagree
  const armPending = req != null && req.armed !== st.armed;
  return {
    present: true,
    preregistration: 'general-classifier/PILOT-F1.md',
    journalSyncedUtc: mtime ? new Date(mtime).toISOString() : null,
    config: cfg,
    anatomy: anat,
    armRequest: req,
    armPending,
    ...st,
  };
}

module.exports = { status, config, anatomy, derive, readJournal, JOURNAL, MODEL_FEE_PER_LEG };
