// boxview.js -- the state of the MACHINE, derived from the executor's journal.
//
// This is what one box is doing: is it armed, is it halted and why, what its
// wallet holds, how close it is to a liquidation, what protective stop and
// margin floor it is enforcing, and when it last spoke. It says nothing about
// any profile — every profile reports its own book, decisions and positions
// through /api/live/setups/:id/status.
//
// It replaces lib/pilotview.js, which mixed the two: box facts and ONE
// hardcoded config's book, decisions, anatomy and geometry, in one payload from
// one module. That mixing is why the machine's own controls — start, stop,
// clear the halt — lived on a screen only that config could reach, and why
// retiring the config threatened to take the owner's master switch with it.
//
// Read-only and pure over the journal. It never trades and imports no engine.
const fs = require('fs');
const path = require('path');

const JOURNAL = path.join(__dirname, '..', 'data', 'pilot', 'journal.jsonl');

function readJournal(file = JOURNAL) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const events = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch (_) { /* skip a torn line */ }
    }
    let mtime = null;
    try { mtime = fs.statSync(file).mtime.toISOString(); } catch (_) { /* ignore */ }
    return { present: true, events, mtime };
  } catch (_) { return { present: false, events: [], mtime: null }; }
}

// Replay the journal for the box-level facts only.
function derive(events) {
  const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
  let armed = false; let armedBy = null;
  let halted = false; let haltReason = null;
  let fixedStopPct = null; let marginFloor = null;
  let walletBalance = null; let lastHeartbeatUtc = null;

  for (const e of events) {
    switch (e.event) {
      case 'RUN_STATUS':
        armed = !!e.armed; halted = !!e.halted;
        lastHeartbeatUtc = e.utc || lastHeartbeatUtc;
        if (e.fixed_stop_pct != null) fixedStopPct = e.fixed_stop_pct;
        // 0 is a real state — no floor set — not a missing reading.
        if (e.margin_floor != null) marginFloor = e.margin_floor;
        break;
      case 'ARM_SET': armed = true; armedBy = e.source || null; break;
      case 'ARM_CLEAR': armed = false; armedBy = e.source || null; break;
      case 'HALT_SET': halted = true; haltReason = e.reason || null; break;
      case 'HALT_CLEAR': halted = false; haltReason = null; break;
      case 'BALANCE':
        walletBalance = {
          utc: e.utc || null,
          usdtFree: n(e.quote_free), usdtNet: n(e.quote_net),
          ltcFree: n(e.base_free), ltcNet: n(e.base_net),
          // collateral / debt: the distance to a forced liquidation
          marginLevel: n(e.margin_level),
        };
        break;
      default:
        if (e.utc) lastHeartbeatUtc = lastHeartbeatUtc || null;
        break;
    }
  }
  return { armed, armedBy, halted, haltReason, fixedStopPct, marginFloor, walletBalance, lastHeartbeatUtc };
}

function armRequest() {
  try {
    return JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'data', 'pilot', 'arm-request.json'), 'utf8'));
  } catch (_) { return null; }
}

function status(file = JOURNAL) {
  const { present, events, mtime } = readJournal(file);
  const req = armRequest();
  if (!present) {
    return { present: false, note: 'no box journal yet — the executor has not run or has not synced', armRequest: req };
  }
  const st = derive(events);
  return {
    present: true,
    ...st,
    armRequest: req,
    // the owner pressed something the box has not collected yet
    armPending: req != null && !!req.armed !== st.armed,
    journalSyncedUtc: mtime,
  };
}

module.exports = { status, derive, readJournal, armRequest, JOURNAL };
