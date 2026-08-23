// Per-setup live view + execution-fidelity derivation (IMPLEMENTATION-PLAN
// phase 6; NEXT-RELEASE points 16, 17). Replays the box journal into
// PER-SETUP state so the Trade tab renders each setup's own book — real or
// paper — from the record the executor wrote. Read-only: renders what the deterministic box did
// (independence rule). Box-level facts — armed, halted, wallet — belong to
// lib/boxview.js; this module is only ever about one profile's book.
const fs = require('fs');
const path = require('path');

// The synced box journal; overridable for tests.
function journalFile() {
  return process.env.GC_LIVE_JOURNAL
    || path.join(__dirname, '..', '..', 'data', 'pilot', 'journal.jsonl');
}

// A TORN LINE IS COUNTED, NOT SWALLOWED (found 2026-08-21).
//
// A crash while writing leaves a line cut in half. This used to skip it in
// silence, so every total built afterwards — money made, money lost, how many
// trades — was confidently wrong and looked exactly like a correct answer. And
// a journal with nothing readable in it at all reported PRESENT with no events,
// which on screen is indistinguishable from a book that has never traded.
//
// `dropped` is how many lines could not be read. Any screen showing a figure
// from this journal must say so when it is above zero: the difference between
// "there is nothing here" and "some of it could not be read" is the difference
// between a fact and a guess.
function readJournal(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const events = [];
    let dropped = 0;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch (_) { dropped += 1; }
    }
    return { present: true, events, dropped, unterminated: raw.length > 0 && !raw.endsWith('\n') };
  } catch (_) { return { present: false, events: [], dropped: 0, unterminated: false }; }
}

function round(v, n = 4) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** n; return Math.round(v * f) / f;
}
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// Replay one setup's events (real + paper) into its book. Real and paper are
// SEPARATE ledgers — a paper book holds no exchange assets and its P&L must
// never mix with real money.
function deriveSetup(events, setupId, extraDecisions = []) {
  const open = {}; const paperOpen = {};
  let realized = 0; let paperRealized = 0;
  // R16: execution fidelity measures ONE population — REAL, non-recovered fills vs
  // their decision price. A recovered fill fabricates fill_deviation=0.0 (the crash
  // lost the decision price), and a paper fill is the lab twin, not live execution;
  // pooling either into the real average flatters or muddies the number the pilot
  // exists to produce. Keep them in separate buckets.
  const closed = []; const fills = []; const paperFills = []; const legCosts = [];
  // Stored figures that could not be read as numbers. Never silently skipped:
  // every money total below is computed without them, so the screen has to be
  // able to say how many were left out.
  const unreadable = [];
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
  // THE DECISION HISTORY — one row per decision day. The profile view returned
  // none at all, so a profile's screen could show its positions and its money
  // but never WHAT IT DECIDED or why, which is the record the whole engine
  // exists to produce. Keyed by chunk_start so a re-ship within a period is one
  // row, not two.
  const decisions = {};

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
        if (decisions[e.chunk_start]) decisions[e.chunk_start].fate = 'filled';
        open[key(e)] = { chunk_start: e.chunk_start, side: e.side,
          // A quantity or price that is not a real number reaches the screen as
          // "no value" rather than as the word Infinity in a money column. The
          // paper side below got this first and this one was missed — and my
          // check said it was fine, because JSON.stringify turns Infinity into
          // null and I was reading the printed JSON.
          qty: Number.isFinite(e.qty) ? e.qty : null,
          qtyUnreadable: e.qty != null && !Number.isFinite(e.qty) ? String(e.qty) : null,
          entry_price: Number.isFinite(e.price) ? e.price : null,
          entry_utc: e.utc, exit_due_ts: e.exit_due_ts,
          decision_price: e.decision_price, fill_deviation: e.fill_deviation, paper: false,
          // WHICH WALLET this position exits through. The box records it at
          // entry and routes the exit by it; the view dropped it, so a
          // diagnostic reading these rows reported every position as being on
          // the shared account — including ones the box knows are not.
          key_ref: e.key_ref || null, symbol: e.symbol || null };
        // recovered fills carry a FABRICATED 0.0 deviation (the decision price was
        // lost in the crash) — count them, but keep them OUT of the real average.
        if (e.recovered) recoveredFills += 1;
        else if (typeof e.fill_deviation === 'number') fills.push(e.fill_deviation);
        if (typeof e.fee_quote === 'number') legCosts.push(e.fee_quote);
        break;
      case 'EXIT_FILL': {
        const p = open[key(e)]; delete open[key(e)];
        // A STORED FIGURE THAT IS NOT A NUMBER IS NOT ADDED TO THE TOTAL
        // (2026-08-21). `realized += e.pnl || 0` turned the whole running total
        // into TEXT the moment one event carried a profit written as a string —
        // two $10 books came out as "1010" — and an Infinity made the total
        // infinite. Both then reached the screen as money. What cannot be read
        // is counted separately and said out loud, because a total that quietly
        // skipped an entry is worse than one that admits it.
        if (Number.isFinite(e.pnl)) realized += e.pnl;
        else if (e.pnl != null) unreadable.push({ chunk_start: e.chunk_start, field: 'pnl', value: String(e.pnl) });
        if (typeof e.fee_quote === 'number') legCosts.push(e.fee_quote);
        // entry_utc rides along so a closed row can be named by its ENTRY time
        // rather than its feature window (owner, 2026-08-19). Same field as the
        // pilot view's closed rows — the two screens must not drift (RULE TWO).
        closed.push({ chunk_start: e.chunk_start, side: e.side,
          pnl: Number.isFinite(e.pnl) ? e.pnl : null,
          pnlUnreadable: e.pnl != null && !Number.isFinite(e.pnl) ? String(e.pnl) : null,
          entry_price: p ? p.entry_price : null, entry_utc: p ? p.entry_utc : null,
          exit_price: e.price, exit_utc: e.utc, paper: false });
        break;
      }
      case 'PAPER_ENTRY_FILL':
        paperOpen[key(e)] = { chunk_start: e.chunk_start, side: e.side,
          // A quantity or price that is not a real number reaches the screen as
          // "no value" rather than as the word Infinity in a money column.
          qty: Number.isFinite(e.qty) ? e.qty : null,
          qtyUnreadable: e.qty != null && !Number.isFinite(e.qty) ? String(e.qty) : null,
          entry_price: Number.isFinite(e.price) ? e.price : null, entry_utc: e.utc, exit_due_ts: e.exit_due_ts,
          decision_price: e.decision_price, fill_deviation: e.fill_deviation, paper: true };
        if (typeof e.fill_deviation === 'number') paperFills.push(e.fill_deviation);
        break;
      case 'PAPER_EXIT_FILL': {
        const p = paperOpen[key(e)]; delete paperOpen[key(e)];
        // Identical to the real side above, deliberately (RULE TWO): the paper
        // book is the control arm, and a total computed differently on the two
        // sides makes the comparison worthless.
        if (Number.isFinite(e.pnl)) paperRealized += e.pnl;
        else if (e.pnl != null) unreadable.push({ chunk_start: e.chunk_start, field: 'pnl', value: String(e.pnl), paper: true });
        closed.push({ chunk_start: e.chunk_start, side: e.side,
          pnl: Number.isFinite(e.pnl) ? e.pnl : null,
          pnlUnreadable: e.pnl != null && !Number.isFinite(e.pnl) ? String(e.pnl) : null,
          entry_price: p ? p.entry_price : null, entry_utc: p ? p.entry_utc : null,
          exit_price: e.price, exit_utc: e.utc, paper: true });
        break;
      }
      // THE SAME LIST THE EXECUTOR ACTUALLY WRITES. This surfaced four event
      // kinds while the executor journals a dozen with a setup_id on them, so a
      // rejected order, an order whose outcome is UNKNOWN, an overdue exit, a
      // stale or invalid intent, and a period the executor GAVE UP on all
      // showed nothing — the panel said "none — clean" while the record said
      // otherwise. All of these are surfaced here; the generalized twin
      // generalized twin was missing them, and an asymmetry between the two is
      // an oversight rather than a decision (the QC-122 shape, found 2026-08-18).
      case 'INTENT_SEEN':
        decisions[e.chunk_start] = {
          chunk_start: e.chunk_start, utc: e.utc, side: e.side,
          votes: e.per_member || null, quorum: e.quorum ?? null,
          decision_price: e.decision_price ?? null,
          input_hash: e.input_hash || null,
          fate: e.side === 'FLAT' ? 'flat — no trade' : 'seen',
        };
        break;
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
    // Newest first, and merged with the profile's own decision LOG so days the
    // committee stood down appear too: a FLAT call ships no intent, so the
    // journal alone would show only the days that traded and the screen would
    // read as though nothing was decided in between.
    decisions: (() => {
      const merged = { ...decisions };
      for (const d of (extraDecisions || [])) {
        if (!d || !d.chunk_start || merged[d.chunk_start]) continue;
        merged[d.chunk_start] = {
          chunk_start: d.chunk_start, utc: d.produced_utc || null, side: d.side,
          votes: d.per_member || null, quorum: d.quorum ?? null,
          decision_price: d.decision_price ?? null, input_hash: d.input_hash || null,
          fate: d.side === 'FLAT' ? 'stand down' : 'recorded',
        };
      }
      return Object.values(merged)
        .sort((a, b) => String(b.chunk_start).localeCompare(String(a.chunk_start)))
        .slice(0, 30);
    })(),
    // How many stored figures could not be read as numbers. Every money total
    // here was computed without them.
    unreadableFigures: unreadable.length,
    unreadableDetail: unreadable.slice(0, 20),
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
// ---- "what happens next", per profile --------------------------------------
// The countdown panel used to exist only on the hardcoded config's screen and
// went with it. It is the thing an operator actually reads — what the engine
// will do, why, and when — so it is rebuilt here driven by the PROFILE'S OWN
// geometry rather than the constants the old screen carried. A profile on a
// different geometry gets its own hours, not somebody else's.
//
// Pure over (state, setup, nowMs) so it is unit-testable and the page can
// live-count the returned absolute UTC stamps.
function nextActivity(st, setup, nowMs, tickMinuteUtc = 8) {
  const iso = (t) => new Date(t).toISOString();
  const cfg = setup.configSnapshot || {};
  let geo = {};
  try { geo = (require('../dataset').GEOMETRIES || {})[(cfg.branch || {}).geometry] || {}; }
  catch (_) { geo = {}; }
  const entryOffH = geo.entryOffsetH || 0;
  const holdH = (cfg.cell && cfg.cell.tHours) || 0;
  // A daily geometry acts at (window close + 1h); the acting HOUR is the offset
  // past midnight once whole days are removed. Derived, never assumed.
  const entryHourUtc = entryOffH % 24;
  const closeHourUtc = (entryHourUtc + 23) % 24;   // one clear hour before entry

  const d = new Date(nowMs);
  const at = (h) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, 0, 0, 0);
  let nextEntry = at(entryHourUtc); if (nextEntry <= nowMs) nextEntry += 864e5;
  let nextEval = at(closeHourUtc);  if (nextEval <= nowMs) nextEval += 864e5;
  let nextTick = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
    d.getUTCHours(), tickMinuteUtc, 0, 0);
  if (nextTick <= nowMs) nextTick += 36e5;

  const opens = (st.openPositions || []).filter((p) => p && p.exit_due_ts && !p.paper);
  const items = [];

  // The recompute is first because it is what happens soonest and most often.
  items.push({ what: 'Recompute this profile against fresh candles', whenUtc: iso(nextTick),
    why: `runs hourly at :${String(tickMinuteUtc).padStart(2, '0')} UTC; it can only OPEN a position at the entry window below.` });

  if (st.state === 'stopped' || st.state === 'retired') {
    items.push({ what: 'Open a new position', whenUtc: null,
      why: `this profile is ${st.state} — nothing opens. Open positions still exit on schedule.` });
  } else if (st.halted) {
    items.push({ what: 'Open a new position', whenUtc: null,
      why: 'this profile is HALTED — new entries are blocked; open positions still exit on schedule.' });
  } else {
    items.push({ what: 'Evaluate the next entry (LONG / SHORT / FLAT)', whenUtc: iso(nextEval),
      why: `the committee decides when its ${geo.featureHours || '?'}h feature window closes at ${String(closeHourUtc).padStart(2, '0')}:00 UTC; `
        + `the entry then opens a $${st.clipUsd} clip at ${String(entryHourUtc).padStart(2, '0')}:00 UTC only if the call is not FLAT.` });
  }

  // EVERY scheduled exit, soonest first — not just the next one. A panel that
  // answers "what happens next" must not hide half of what happens next.
  for (const p of opens.slice().sort((a, b) => a.exit_due_ts - b.exit_due_ts)) {
    const opened = p.entry_utc ? String(p.entry_utc).slice(0, 16).replace('T', ' ')
      : `${String(p.chunk_start).slice(0, 16)} (window start — no fill time recorded)`;
    items.push({ what: `Close the ${p.side} position opened ${opened}`,
      whenUtc: iso(p.exit_due_ts * 1000),
      why: `its ${holdH}h hold elapses; scheduled exits run whether the profile is running or stopped.` });
  }

  return {
    serverUtc: iso(nowMs), entryHourUtc, holdHours: holdH,
    nextEvalUtc: iso(nextEval), nextEntryUtc: iso(nextEntry),
    nextExitUtc: opens.length ? iso(Math.min(...opens.map((p) => p.exit_due_ts)) * 1000) : null,
    openPositions: opens.length, items,
  };
}

// The UTC moment a decision ACTS: its feature window start plus the geometry's
// entry offset. Null on an unusable stamp OR an unstated offset — the old
// version fell back to one config's 97h, so a caller that could not supply an
// offset silently got that config's timing stamped onto someone else's rows.
// A missing offset is now a missing answer, which renders as "—".
function decisionEntryUtc(chunkStartIso, entryOffsetH) {
  const t = Date.parse(chunkStartIso);
  if (!Number.isFinite(t) || !Number.isFinite(entryOffsetH)) return null;
  return new Date(t + entryOffsetH * 3600000).toISOString();
}

function setupStatus(setup, file = journalFile()) {
  const { present, events, dropped, unterminated } = readJournal(file);
  const epoch = setup.runEpochUtc ? Date.parse(setup.runEpochUtc) : null;
  const scoped = epoch
    ? events.filter((e) => {
      const t = e.utc ? Date.parse(e.utc) : (e.ts ? e.ts * 1000 : null);
      return t == null || t >= epoch;
    })
    : events;
  // The profile's own decision LOG supplies the days that stood down — a FLAT
  // call ships no intent, so the journal records nothing for it and the history
  // would silently skip every day the committee decided not to trade.
  let logged = [];
  try { logged = require('./mirror').loadDecisions(setup.id); } catch (_) { logged = []; }
  const book = deriveSetup(scoped, setup.id, logged);
  // WHEN EACH DECISION ACTS. A decision is keyed on the START of its feature
  // window but acts entryOffsetH later — four days and an hour apart on this
  // geometry. Dating a row by the window makes a current record read as days
  // dead, which is exactly how the owner was told there were "no decisions for
  // the past 4 decision days" when every day had one. The offset comes from the
  // profile's OWN geometry, never a constant.
  let offH = 0;
  try {
    const { GEOMETRIES } = require('../dataset');
    const g = GEOMETRIES[((setup.configSnapshot || {}).branch || {}).geometry];
    offH = (g && g.entryOffsetH) || 0;
  } catch (_) { offH = 0; }
  book.decisions = (book.decisions || []).map((d) => ({
    ...d, entry_utc: decisionEntryUtc(d.chunk_start, offH),
  }));
  const out = {
    id: setup.id, name: setup.name, state: setup.state,
    tradedPair: setup.tradedPair, clipUsd: setup.clipUsd, stopPct: setup.stopPct,
    // WHAT THIS PROFILE PRICES AT, beside what it actually paid. The realized
    // figure arrives from the box in DOLLARS a leg (the venue quotes it on the
    // fill), and the modelled one is a fraction of the position, so the screen
    // needs both to put them in the same units — which is the comparison the
    // whole live-versus-lab question turns on.
    feePerLeg: require('./setups').setupFee(setup),
    feeInherited: require('./setups').feeIsInherited(setup),
    paper: setup.state === 'paper',
    journalPresent: present,
    // HOW MUCH OF THE RECORD COULD NOT BE READ. Every money figure below is
    // computed from what survived, so this must ride out with them: a total
    // built on a journal that lost lines is not the same kind of thing as a
    // total built on a whole one, and the screen has to be able to say so.
    journalDropped: dropped,
    journalUnterminated: unterminated,
    runEpochUtc: setup.runEpochUtc || null,
    ...book,
  };
  out.liveStatus = nextActivity(out, setup, Date.now());
  return out;
}

module.exports = { deriveSetup, setupStatus, readJournal, journalFile, nextActivity, decisionEntryUtc };
