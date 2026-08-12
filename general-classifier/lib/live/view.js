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
  const closed = []; const fills = []; const legCosts = [];
  const incidents = [];
  let markPrice = null; let markUtc = null;

  const key = (e) => e.chunk_start;
  for (const e of events) {
    if (e.setup_id !== setupId) {
      // PNL_MTM is not per-setup but carries the marked price; capture it so a
      // setup can show unrealized P&L at the box's last mark.
      if (e.event === 'PNL_MTM' && Number.isFinite(Number(e.price)) && Number(e.price) > 0) {
        markPrice = Number(e.price); markUtc = e.utc || markUtc;
      }
      continue;
    }
    switch (e.event) {
      case 'ENTRY_FILL':
        open[key(e)] = { chunk_start: e.chunk_start, side: e.side, qty: e.qty,
          entry_price: e.price, entry_utc: e.utc, exit_due_ts: e.exit_due_ts,
          decision_price: e.decision_price, fill_deviation: e.fill_deviation, paper: false };
        if (typeof e.fill_deviation === 'number') fills.push(e.fill_deviation);
        if (typeof e.fee_quote === 'number') legCosts.push(e.fee_quote);
        break;
      case 'EXIT_FILL': {
        const p = open[key(e)]; delete open[key(e)];
        realized += e.pnl || 0;
        if (typeof e.fee_quote === 'number') legCosts.push(e.fee_quote);
        closed.push({ chunk_start: e.chunk_start, side: e.side, pnl: e.pnl,
          entry_price: p ? p.entry_price : null, exit_price: e.price, exit_utc: e.utc, paper: false });
        break;
      }
      case 'PAPER_ENTRY_FILL':
        paperOpen[key(e)] = { chunk_start: e.chunk_start, side: e.side, qty: e.qty,
          entry_price: e.price, entry_utc: e.utc, exit_due_ts: e.exit_due_ts,
          decision_price: e.decision_price, fill_deviation: e.fill_deviation, paper: true };
        if (typeof e.fill_deviation === 'number') fills.push(e.fill_deviation);
        break;
      case 'PAPER_EXIT_FILL': {
        const p = paperOpen[key(e)]; delete paperOpen[key(e)];
        paperRealized += e.pnl || 0;
        closed.push({ chunk_start: e.chunk_start, side: e.side, pnl: e.pnl,
          entry_price: p ? p.entry_price : null, exit_price: e.price, exit_utc: e.utc, paper: true });
        break;
      }
      case 'FIXED_STOP':
      case 'KILL_PRICE_DRIFT':
      case 'ENTRY_SKIPPED':
      case 'INTENT_DUPLICATE':
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
      fills: fills.length,
      fillDeviationAvg: round(avg(fills), 6),
      fillDeviationMax: fills.length ? round(Math.max(...fills), 6) : null,
      realizedFeePerLegAvg: round(avg(legCosts), 6),
    },
    incidents: incidents.slice(-20).reverse(),
  };
}

// Full status payload for one setup: its registry record (config, state) +
// its derived book, from the synced journal.
function setupStatus(setup, file = journalFile()) {
  const { present, events } = readJournal(file);
  const book = deriveSetup(events, setup.id);
  return {
    id: setup.id, name: setup.name, state: setup.state,
    tradedPair: setup.tradedPair, clipUsd: setup.clipUsd, stopPct: setup.stopPct,
    paper: setup.state === 'paper',
    journalPresent: present,
    ...book,
  };
}

module.exports = { deriveSetup, setupStatus, readJournal, journalFile };
