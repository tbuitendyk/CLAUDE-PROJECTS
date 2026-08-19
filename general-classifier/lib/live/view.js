// Per-setup live view + execution-fidelity derivation (IMPLEMENTATION-PLAN
// phase 6; NEXT-RELEASE points 16, 17). The generalized twin of
// lib/pilotview.js: replays the box journal into PER-SETUP state so the Live
// Trading tab renders each setup's own book — real or paper — from the record
// the executor wrote. Read-only: renders what the deterministic box did
// (independence rule). lib/pilotview.js is UNTOUCHED (F1 keeps its own view).
const fs = require('fs');
const path = require('path');

// The synced box journal (same file pilotview reads); overridable for tests.
function journalFile() {
  return process.env.GC_LIVE_JOURNAL
    || path.join(__dirname, '..', '..', 'data', 'pilot', 'journal.jsonl');
}

function readJournal(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const events = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch (_) { /* skip a torn line */ }
    }
    return { present: true, events };
  } catch (_) { return { present: false, events: [] }; }
}

function round(v, n = 4) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** n; return Math.round(v * f) / f;
}
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// Replay one setup's events (real + paper) into its book. Real and paper are
// SEPARATE ledgers — a paper book holds no exchange assets and its P&L must
// never mix with real money.
function deriveSetup(events, setupId) {
  const open = {}; const paperOpen = {};
  let realized = 0; let paperRealized = 0;
  // R16: execution fidelity measures ONE population — REAL, non-recovered fills vs
  // their decision price. A recovered fill fabricates fill_deviation=0.0 (the crash
  // lost the decision price), and a paper fill is the lab twin, not live execution;
  // pooling either into the real average flatters or muddies the number the pilot
  // exists to produce. Keep them in separate buckets.
  const closed = []; const fills = []; const paperFills = []; const legCosts = [];
  let recoveredFills = 0;
  const incidents = [];
  let markPrice = null; let markUtc = null;
  let walletBalance = null;  // {marginLevel, utc} — box-level, see the loop below
  let marginFloor = null;    // the floor the BOX is enforcing, from RUN_STATUS
  // THIS PROFILE'S OWN HALT. Its new entries are stopped; its open positions keep
  // their scheduled exits. Tracked here so the profile's screen can show it and
  // offer the way out — the halt was settable from the first day and had neither.
  let halted = false;
  let haltReason = null;

  const key = (e) => e.chunk_start;
  for (const e of events) {
    if (e.setup_id !== setupId) {
      // PNL_MTM is not per-setup but carries the marked price; capture it so a
      // setup can show unrealized P&L at the box's last mark.
      if (e.event === 'PNL_MTM' && Number.isFinite(Number(e.price)) && Number(e.price) > 0) {
        markPrice = Number(e.price); markUtc = e.utc || markUtc;
      }
      // Margin level and the floor enforcing it are BOX-level facts, like the
      // mark above: one isolated wallet backs every real setup on this box. They
      // are captured here so the setup screens can show the same liquidation
      // distance the pilot screen shows — the two must not disagree (RULE TWO).
      if (e.event === 'BALANCE' && e.margin_level != null) {
        const m = Number(e.margin_level);
        if (Number.isFinite(m)) walletBalance = { marginLevel: m, utc: e.utc || null };
      }
      if (e.event === 'RUN_STATUS' && e.margin_floor != null) {
        const f = Number(e.margin_floor);
        if (Number.isFinite(f)) marginFloor = f;
      }
      continue;
    }
    switch (e.event) {
      case 'ENTRY_FILL':
        open[key(e)] = { chunk_start: e.chunk_start, side: e.side, qty: e.qty,
          entry_price: e.price, entry_utc: e.utc, exit_due_ts: e.exit_due_ts,
          decision_price: e.decision_price, fill_deviation: e.fill_deviation, paper: false };
        // recovered fills carry a FABRICATED 0.0 deviation (the decision price was
        // lost in the crash) — count them, but keep them OUT of the real average.
        if (e.recovered) recoveredFills += 1;
        else if (typeof e.fill_deviation === 'number') fills.push(e.fill_deviation);
        if (typeof e.fee_quote === 'number') legCosts.push(e.fee_quote);
        break;
      case 'EXIT_FILL': {
        const p = open[key(e)]; delete open[key(e)];
        realized += e.pnl || 0;
        if (typeof e.fee_quote === 'number') legCosts.push(e.fee_quote);
        // entry_utc rides along so a closed row can be named by its ENTRY time
        // rather than its feature window (owner, 2026-08-19). Same field as the
        // pilot view's closed rows — the two screens must not drift (RULE TWO).
        closed.push({ chunk_start: e.chunk_start, side: e.side, pnl: e.pnl,
          entry_price: p ? p.entry_price : null, entry_utc: p ? p.entry_utc : null,
          exit_price: e.price, exit_utc: e.utc, paper: false });
        break;
      }
      case 'PAPER_ENTRY_FILL':
        paperOpen[key(e)] = { chunk_start: e.chunk_start, side: e.side, qty: e.qty,
          entry_price: e.price, entry_utc: e.utc, exit_due_ts: e.exit_due_ts,
          decision_price: e.decision_price, fill_deviation: e.fill_deviation, paper: true };
        if (typeof e.fill_deviation === 'number') paperFills.push(e.fill_deviation);
        break;
      case 'PAPER_EXIT_FILL': {
        const p = paperOpen[key(e)]; delete paperOpen[key(e)];
        paperRealized += e.pnl || 0;
        closed.push({ chunk_start: e.chunk_start, side: e.side, pnl: e.pnl,
          entry_price: p ? p.entry_price : null, entry_utc: p ? p.entry_utc : null,
          exit_price: e.price, exit_utc: e.utc, paper: true });
        break;
      }
      // THE SAME LIST THE EXECUTOR ACTUALLY WRITES. This surfaced four event
      // kinds while the executor journals a dozen with a setup_id on them, so a
      // rejected order, an order whose outcome is UNKNOWN, an overdue exit, a
      // stale or invalid intent, and a period the executor GAVE UP on all
      // showed nothing — the panel said "none — clean" while the record said
      // otherwise. lib/pilotview.js surfaces all of these for F1; only its
      // generalized twin was missing them, and an asymmetry between the two is
      // an oversight rather than a decision (the QC-122 shape, found 2026-08-18).
      case 'SETUP_HALT_SET':
        halted = true; haltReason = e.reason || null;
        incidents.push({ utc: e.utc, kind: e.event, detail: e.reason || '' });
        break;
      case 'SETUP_HALT_CLEAR':
        halted = false; haltReason = null;
        incidents.push({ utc: e.utc, kind: e.event, detail: e.reason || '' });
        break;
      case 'FIXED_STOP':
      case 'KILL_PRICE_DRIFT':
      case 'ENTRY_SKIPPED':
      case 'INTENT_DUPLICATE':
      case 'ORDER_REJECT':
      case 'ORDER_UNKNOWN':
      case 'EXIT_OVERDUE':
      case 'ENTRY_GAVE_UP':
      case 'INTENT_STALE':
      case 'INTENT_INVALID':
      case 'MIRROR_BREAK':
      case 'RECONCILE_MISMATCH':
      case 'KILL_TRANSPORT':
        incidents.push({ utc: e.utc, kind: e.event,
          detail: JSON.stringify(Object.fromEntries(Object.entries(e)
            .filter(([k]) => !['event', 'ts', 'utc', 'setup_id'].includes(k)))) });
        break;
      default: break;
    }
  }

  const openArr = Object.values(open);
  const paperArr = Object.values(paperOpen);
  const unreal = (p) => (markPrice != null && p.entry_price != null)
    ? ((markPrice - p.entry_price) * p.qty) * (p.side === 'SHORT' ? -1 : 1) : null;
  // R9: real and paper UNREALIZED are kept SEPARATE, exactly as realized already
  // is — after a paper->live transition a setup can hold both books open at once,
  // and summing them into one number mixes paper (fictional) with real money on
  // the screen. Each open row still carries its own paper flag for the table.
  const sumUnreal = (arr) => (markPrice != null
    ? round(arr.reduce((s, p) => s + (unreal(p) || 0), 0), 4) : null);
  const unrealizedPnl = sumUnreal(openArr);         // REAL positions only
  const paperUnrealizedPnl = sumUnreal(paperArr);   // PAPER positions only

  return {
    setupId,
    markPrice: round(markPrice, 4),
    markUtc,
    walletBalance,
    marginFloor,
    halted,
    haltReason,
    realizedPnl: round(realized, 4),
    paperRealizedPnl: round(paperRealized, 4),
    unrealizedPnl,
    paperUnrealizedPnl,
    openPositions: [...openArr, ...paperArr]
      .sort((a, b) => a.exit_due_ts - b.exit_due_ts)
      .map((p) => ({ ...p, markPrice: round(markPrice, 4), unrealized: round(unreal(p), 4) })),
    closedRecent: closed.slice(-20).reverse(),
    // EXECUTION FIDELITY (point 17): the numbers the pilot exists to measure,
    // per setup — is live matching what the lab promised?
    fidelity: {
      // REAL, non-recovered fills only — the live-vs-lab execution question
      fills: fills.length,
      fillDeviationAvg: round(avg(fills), 6),
      fillDeviationMax: fills.length ? round(Math.max(...fills), 6) : null,
      realizedFeePerLegAvg: round(avg(legCosts), 6),
      // kept separate so neither dilutes the real number (R16)
      recoveredFills,
      paperFills: paperFills.length,
      paperFillDeviationAvg: round(avg(paperFills), 6),
    },
    incidents: incidents.slice(-20).reverse(),
  };
}

// Full status payload for one setup: its registry record (config, state) +
// its derived book, from the synced journal.
//
// runEpochUtc (owner 2026-08-14): a re-activated channel restarts its DISPLAYED
// run from the activation instant — events before the epoch are excluded from
// the derivation here, so the screen shows this run only. The journal itself is
// append-only and keeps everything; open positions cannot be hidden by an epoch
// because activation is gated on the channel being stopped-and-done first, and
// any position opened after activation postdates the epoch by construction.
function setupStatus(setup, file = journalFile()) {
  const { present, events } = readJournal(file);
  const epoch = setup.runEpochUtc ? Date.parse(setup.runEpochUtc) : null;
  const scoped = epoch
    ? events.filter((e) => {
      const t = e.utc ? Date.parse(e.utc) : (e.ts ? e.ts * 1000 : null);
      return t == null || t >= epoch;
    })
    : events;
  const book = deriveSetup(scoped, setup.id);
  return {
    id: setup.id, name: setup.name, state: setup.state,
    tradedPair: setup.tradedPair, clipUsd: setup.clipUsd, stopPct: setup.stopPct,
    paper: setup.state === 'paper',
    journalPresent: present,
    runEpochUtc: setup.runEpochUtc || null,
    ...book,
  };
}

module.exports = { deriveSetup, setupStatus, readJournal, journalFile };
