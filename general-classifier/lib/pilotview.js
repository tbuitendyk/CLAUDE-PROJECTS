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
// THE MODEL FEE IS A RATE, NOT A DOLLAR AMOUNT. lib/paper.js quotes the lab's
// assumption as "$0.125 per leg AT $100 SIZE" — 0.125% of notional. The pilot
// trades a $10 clip, so publishing the $100 figure next to the fee actually paid
// on $10 compared two different things and made live execution look about ten
// times cheaper than modelled. It is not: 0.125% modelled against ~0.100%
// realized (owner, 2026-08-18: "the modelling is against $100 clips").
const PILOT_CLIP_USD = 10;               // F1's declared clip (PILOT-F1.md)
const { REAL_FEE_PER_LEG: MODEL_FEE_AT_100 } = require('./paper');  // ONE constant, not a copy that can drift
const MODEL_FEE_RATE = MODEL_FEE_AT_100 / 100;         // 0.00125 = 0.125% per leg
const MODEL_FEE_PER_LEG = MODEL_FEE_RATE * PILOT_CLIP_USD;  // the like-for-like figure

// F1 frozen geometry (daily-4d), for the "what happens next" status. A daily chunk
// starts at 00:00 UTC (dataset.js dailyStarts = ceil(ts/DAY)*DAY) and its entry
// hour is start + entryOffsetH(97) = 01:00 UTC — so the committee evaluates a NEW
// entry once per day at 01:00 UTC, and a taken position is held tHours(137) before
// its scheduled exit. Frozen: do not change (TRACKER.md locks F1 after week one).
const F1_ENTRY_HOUR_UTC = 1;
const F1_HOLD_HOURS = 137;
const F1_PAIRS = ['LTCUSDT', 'XRPUSDT', 'BCHUSDT']; // F1 combo: trade + two context pairs
// A decision is KEYED on the start of its 96h feature window but ACTS 97h later
// (window 96h + 1h), so the two stamps are four days and an hour apart. Dating a
// row by chunk_start makes a current record read four days dead — the owner asked
// on 2026-08-16 why the live rail had "no decisions for the past 4 decision days"
// when in fact every day since arming was recorded. Rows carry entry_utc and the
// screen dates them by THAT; chunk_start stays as the window it was built from.
const F1_ENTRY_OFFSET_H = 97; // fallback only — the live value comes from config()
// Staleness is measured from the CLOSE of the newest candle, not its open-time
// stamp. Candles are stamped by open time and only CLOSED candles are cached, so a
// just-finalized candle is stamped a full hour earlier — measuring from the stamp
// would read "1h stale" the instant it lands. The data is complete through ts+1h;
// within an hour of that is normal (the next hour has not closed yet + a little
// publish/tick lag), so flag only past 2h behind the close.
const DATA_STALE_HOURS = 2;

// Per-pair data freshness for the screen, so the owner can see the trigger inputs
// are current before arming. `throughUtc` is the hour the data is COMPLETE through
// (candle close = stamp + 1h); `closedAgeHours` is how long since that close. Pure
// over supplied (symbol, ts) pairs + a clock, so it is unit-testable.
function dataFreshness(pairsWithTs, nowMs) {
  return pairsWithTs.map(({ symbol, ts }) => {
    const throughMs = ts != null ? ts + 3600000 : null;
    const closedAgeHours = throughMs != null ? (nowMs - throughMs) / 3600000 : null;
    return {
      symbol,
      newestCandleUtc: ts != null ? new Date(ts).toISOString() : null,
      throughUtc: throughMs != null ? new Date(throughMs).toISOString() : null,
      closedAgeHours: closedAgeHours != null ? Math.round(closedAgeHours * 100) / 100 : null,
      stale: closedAgeHours == null || closedAgeHours > DATA_STALE_HOURS,
    };
  });
}

// Build the human-readable "current status / next actions" the screen shows: what
// the system will do next, why, and when (absolute UTC; the page live-counts down).
// Pure over the derived state + a supplied clock, so it is unit-testable.
function liveStatus(st, nowMs) {
  const iso = (t) => new Date(t).toISOString();
  const d = new Date(nowMs);
  // next daily ENTRY (execution): the next 01:00:00 UTC strictly after now.
  let nextEntry = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), F1_ENTRY_HOUR_UTC, 0, 0, 0);
  if (nextEntry <= nowMs) nextEntry += 24 * 3600000;
  // next EVALUATION: the committee decides the call when the 96h feature window
  // CLOSES, at 00:00 UTC — one clear hour BEFORE the entry fires (entryOffsetH 97
  // = window 96h + 1h). So the "evaluate" countdown targets window-close (00:00),
  // not the entry time; the entry is a separate, later moment. Derived from the
  // entry hour so the two stay locked together (owner 2026-08-12 timing fix).
  const WINDOW_CLOSE_HOUR_UTC = F1_ENTRY_HOUR_UTC - 1; // 00:00 UTC
  // the VPS hourly tick fires at :05 (pilot-tick.timer OnCalendar *:05:00 UTC)
  const TICK_MINUTE_UTC = 5;
  let nextEval = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), WINDOW_CLOSE_HOUR_UTC, 0, 0, 0);
  if (nextEval <= nowMs) nextEval += 24 * 3600000;

  const opens = (st.openPositions || []).filter((p) => p && p.exit_due_ts);
  const openLong = opens.filter((p) => p.side === 'LONG').length;
  const openShort = opens.filter((p) => p.side === 'SHORT').length;
  const nextExitPos = opens.slice().sort((a, b) => a.exit_due_ts - b.exit_due_ts)[0] || null;
  const armed = !!st.armed;
  const halted = !!st.halted;
  const haltReason = st.haltReason || null;

  const items = [];
  // 0) THE HOURLY RECOMPUTE, FIRST AND WITH A CLOCK (owner, 2026-08-19).
  // It was last in the list and had no time on it, which read as an aside. It is
  // the thing that happens soonest and most often, so it belongs at the top of
  // "what happens next" with its own countdown like everything else here.
  // The VPS tick runs hourly at :05 UTC (pilot-tick.timer), so the next one is
  // the next :05 — not "in an hour" from whenever the page was opened.
  let nextTick = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), TICK_MINUTE_UTC, 0, 0);
  if (nextTick <= nowMs) nextTick += 3600000;
  items.push({ what: 'Recompute the live signal against fresh candles', whenUtc: iso(nextTick),
    why: `runs hourly at :${String(TICK_MINUTE_UTC).padStart(2, '0')} UTC; it can only OPEN a position at the daily entry window below (it re-checks and ships nothing otherwise).` });
  // 1) the next ENTRY (gated by arm/halt)
  if (!armed) {
    items.push({ what: 'Open a new position', whenUtc: null,
      why: `engine is STOPPED — nothing opens until you press START. When running, the committee evaluates a new entry daily at 0${F1_ENTRY_HOUR_UTC}:00 UTC.` });
  } else if (halted) {
    items.push({ what: 'Open a new position', whenUtc: null,
      why: 'HALT is set — new entries are blocked; open positions still exit on schedule.' });
  } else {
    items.push({ what: 'Evaluate the next entry (LONG / SHORT / FLAT)', whenUtc: iso(nextEval),
      why: `the frozen committee decides the next daily position when its 96h feature window closes at 0${WINDOW_CLOSE_HOUR_UTC}:00 UTC; the entry then opens a $10 clip one hour later at 0${F1_ENTRY_HOUR_UTC}:00 UTC only if the call is not FLAT.` });
  }
  // 2) EVERY scheduled EXIT, soonest first (runs armed OR stopped).
  // This listed only the FIRST one (owner, 2026-08-19: "should have ALSO the
  // other short position just opened beneath it"). With more than one position
  // open, the panel silently omitted the rest — a screen that answers "what
  // happens next" must not hide half of what happens next.
  //
  // And it said "opened <chunk_start>", which is the FEATURE WINDOW's chunk, not
  // when the trade opened. The owner's 2026-08-18 01:00 entry read as
  // 2026-08-14 00:00. entry_ts is the actual fill instant and is what the line
  // now shows; chunk_start stays available on the record for anyone tracing the
  // decision back to its window.
  for (const pos of opens.slice().sort((a, b) => a.exit_due_ts - b.exit_due_ts)) {
    const openedMs = Number.isFinite(pos.entry_ts) ? pos.entry_ts * 1000 : null;
    const opened = openedMs ? iso(openedMs).slice(0, 16).replace('T', ' ')
      : `${String(pos.chunk_start).slice(0, 16)} (window start — no fill time recorded)`;
    items.push({ what: `Close the ${pos.side} position opened ${opened}`,
      whenUtc: iso(pos.exit_due_ts * 1000),
      why: `its ${F1_HOLD_HOURS}h hold elapses; scheduled exits run whether the engine is armed or stopped.` });
  }

  return {
    serverUtc: iso(nowMs),
    entryHourUtc: F1_ENTRY_HOUR_UTC,
    holdHours: F1_HOLD_HOURS,
    nextEvalUtc: iso(nextEval),
    nextEntryUtc: iso(nextEntry),
    nextExitUtc: nextExitPos ? iso(nextExitPos.exit_due_ts * 1000) : null,
    openPositions: opens.length,
    openLong,
    openShort,
    armed,
    halted,
    haltReason,
    items,
  };
}

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

function derive(events, extra = {}) {
  const open = {};
  let realized = 0;
  let consecutiveRejects = 0;
  let dustDone = false;
  let armed = false;      // owner's master switch, as the box last reported it
  let halted = false;
  // The REASON, not just the fact. The screen offers a "clear the halt" control
  // now, and clearing one without seeing why it fired is exactly the mistake the
  // no-self-clear rule exists to prevent — so the reason travels with the flag.
  let haltReason = null;
  let armedBy = null;
  let fixedStopPct = null; // the hard per-order stop the box is applying (RUN_STATUS)
  const closed = [];
  const legCosts = [];   // realized cost per leg, from fills that carry it
  const fillDeviations = [];
  const incidents = [];  // anything the screen should surface in red
  const decisions = {};  // chunk_start -> the committee's call, votes and fate
  let walletBalance = null; // latest isolated-wallet snapshot (USDT + LTC), per run
  let markPrice = null;     // LTC price the executor last marked the book at (PNL_MTM)
  let markToMarket = null;  // realized + unrealized open legs, from PNL_MTM
  let markUtc = null;       // when that mark was taken

  for (const e of events) {
    // R6: the F1 screen shows the F1 (schema-1) pilot ONLY. Schema-2 (generalized
    // setup) trade events carry a setup_id and share this one journal; skip them so
    // a paper/live setup can never overwrite an F1 row, fold its P&L into F1's
    // realized, or perturb F1's reject/at-risk state. Box-level events (RUN_STATUS,
    // PNL_MTM, BALANCE, ARM_*) carry no setup_id and are still processed. This is
    // byte-identical to today whenever no schema-2 event exists.
    if (e.setup_id != null) continue;
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
      case 'BALANCE': {
        // the isolated-wallet snapshot the executor takes at the end of EVERY run
        // (~10 min cadence). The screen shows the LATEST one with its timestamp, so
        // the balances are "as of the last run", never presented as real-time.
        const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
        walletBalance = {
          utc: e.utc || null,
          usdtFree: n(e.quote_free), usdtNet: n(e.quote_net),
          ltcFree: n(e.base_free), ltcNet: n(e.base_net),
        };
        break;
      }
      case 'PNL_MTM': {
        // the executor marks the whole book to market every run and journals the
        // LTC price it used + the mark-to-market total. The screen shows that price
        // and the per-position unrealized P&L "as of last run" — no live tick, no
        // network in the display path (independence rule §4).
        const x = Number(e.price); if (Number.isFinite(x) && x > 0) markPrice = x;
        const m = Number(e.mark_to_market); if (Number.isFinite(m)) markToMarket = m;
        markUtc = e.utc || markUtc;
        break;
      }
      case 'RUN_STATUS':
        armed = !!e.armed; halted = !!e.halted;
        if (e.fixed_stop_pct != null) fixedStopPct = e.fixed_stop_pct;
        break;
      case 'ARM_SET': armed = true; armedBy = e.source || null; break;
      case 'ARM_CLEAR': armed = false; armedBy = e.source || null; break;
      // reflect a halt the instant it is journaled, not a cycle later at the next
      // RUN_STATUS — a mid-run KILL/HALT otherwise lags the banner (re-review).
      case 'HALT_CLEAR': halted = false; haltReason = null; break;
      case 'KILL_PRICE_DRIFT':
      case 'RECONCILE_MISMATCH':
      case 'RECONCILE_UNREADABLE':
      case 'KILL_TRANSPORT':
      case 'EXIT_OVERDUE':
      case 'FIXED_STOP':
      case 'MIRROR_BREAK':
      // the entry retry protocol's loud endings (owner 2026-08-16): a period the
      // box abandoned after spending its six attempts is a MISSED TRADE and must
      // never be a silent line in the log.
      case 'ENTRY_GAVE_UP':
      case 'INTENT_STALE':
      case 'CLOCK_DRIFT':
      case 'ARM_STALE':
      // arm REFUSAL events (re-review A1/A4): when the owner presses START but the
      // box refuses it — stale/future request, replay after STOP, no secret, or a
      // bad HMAC — the screen would otherwise sit at "arm pending" forever with no
      // reason. Surface each as an incident so a silently-refused arm is visible.
      case 'ARM_STALE_REQUEST':
      case 'ARM_REPLAY_REJECTED':
      case 'ARM_NO_SECRET':
      case 'ARM_HMAC_INVALID':
      case 'HALT_SET':
        if (e.event === 'HALT_SET') { halted = true; haltReason = e.reason || null; }  // reflect the halt at once
        incidents.push({ utc: e.utc, kind: e.event, detail: JSON.stringify(
          Object.fromEntries(Object.entries(e)
            .filter(([k]) => !['event', 'ts', 'utc'].includes(k)))) });
        break;
      default: break;
    }
  }

  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  // A live heartbeat must prove the loop ran PAST the due-exit step. CLOCK_SYNC
  // fires before any account call, and RECONCILE_OK fires at step 1 — BEFORE due
  // exits (step 3). A box that reconciles then dies in the exit loop keeps
  // re-emitting RECONCILE_OK while scheduled exits never fire, reading falsely
  // green. RUN_STATUS is journaled every run right AFTER the exit loop, so it
  // certifies exits completed; BALANCE is the end-of-loop snapshot. Kept
  // byte-identical to pilot-alert.sh (re-review liveness).
  const lastHeartbeat = [...events].reverse().find((e) =>
    ['RUN_STATUS', 'BALANCE'].includes(e.event));

  // the full event log the owner asked for: everything the executor did, newest
  // first, lightly flattened so the screen can print it verbatim.
  const log = events.slice(-400).reverse().map((e) => ({
    utc: e.utc || null,
    event: e.event,
    detail: Object.fromEntries(Object.entries(e)
      .filter(([k]) => !['event', 'ts', 'utc'].includes(k))),
  }));

  // LTC position aggregates (owner 2026-08-12): the net LTC the subaccount is
  // carrying across ALL open positions, as soon as an order opens. A LONG HOLDS
  // its LTC (counts +qty); a SHORT sold borrowed LTC and OWES it (counts -qty), so
  // netLtc = sum(long qty) - sum(short qty). longLtc / shortLtc are the two side
  // totals. Position-derived (from the fills in this journal), which is distinct
  // from the exchange wallet snapshot (walletBalance.ltcNet) — the two should
  // track and can be eyeballed against each other on screen.
  const openArr = Object.values(open);
  const sumQty = (side) => openArr
    .filter((p) => p.side === side)
    .reduce((s, p) => s + (Number(p.qty) || 0), 0);
  const longLtc = sumQty('LONG');
  const shortLtc = sumQty('SHORT');
  const ltcPosition = {
    netLtc: round(longLtc - shortLtc, 8),
    longLtc: round(longLtc, 8),
    shortLtc: round(shortLtc, 8),
    longCount: openArr.filter((p) => p.side === 'LONG').length,
    shortCount: openArr.filter((p) => p.side === 'SHORT').length,
  };

  // per-position unrealized P&L (+/- $) at the last marked LTC price, and the book
  // total. A LONG gains as price rises, a SHORT as it falls — the same sign the
  // executor's mark-to-market kill uses. Null until a price has been marked.
  const unrealizedFor = (p) => (markPrice != null && p.entry_price != null && p.qty != null)
    ? ((markPrice - p.entry_price) * p.qty) * (p.side === 'SHORT' ? -1 : 1)
    : null;
  const unrealizedPnl = markPrice != null
    ? round(openArr.reduce((s, p) => s + (unrealizedFor(p) || 0), 0), 4)
    : null;

  return {
    armed,
    halted,
    haltReason,
    armedBy,
    fixedStopPct,
    ltcPosition,     // {netLtc,longLtc,shortLtc,longCount,shortCount} from open fills
    markPrice: round(markPrice, 4),      // LTC price the executor last marked (as of last run)
    markToMarket: round(markToMarket, 4),
    markUtc,
    unrealizedPnl,   // total open-position unrealized P&L ($) at markPrice
    openPositions: openArr.slice().sort((a, b) => a.exit_due_ts - b.exit_due_ts).map((p) => ({
      ...p,
      markPrice: round(markPrice, 4),
      unrealized: unrealizedFor(p) != null ? round(unrealizedFor(p), 4) : null,
    })),
    closedRecent: closed.slice(-20).reverse(),
    walletBalance,   // {usdtFree,usdtNet,ltcFree,ltcNet,utc} as of the last run
    realizedPnl: round(realized, 4),
    consecutiveRejects,
    dustDone,
    log,
    // Daily history: the box journal only ever carries decisions that SHIPPED an
    // intent (FLAT ships nothing — pilot-produce.js), so stand-down days are
    // merged in from the VPS-side stand-down records (owner 2026-08-13). Journal
    // entries always win on a key collision — the journal is the record.
    decisions: (() => {
      const merged = { ...decisions };
      for (const sd of (extra.standDowns || [])) {
        if (!sd || !sd.chunk_start || merged[sd.chunk_start]) continue;
        merged[sd.chunk_start] = {
          chunk_start: sd.chunk_start, utc: sd.produced_utc || null, side: 'FLAT',
          votes: sd.per_member || null, quorum: sd.quorum ?? null,
          decision_price: sd.decision_price ?? null, input_hash: sd.input_hash || null,
          fate: 'stand down',
        };
      }
      return Object.values(merged)
        .sort((a, b) => String(b.chunk_start).localeCompare(String(a.chunk_start)))
        .slice(0, 30);
    })(),
    // the execution-fidelity numbers the pilot is FOR
    modelFeePerLeg: MODEL_FEE_PER_LEG,
    modelFeeRate: MODEL_FEE_RATE,
    clipUsd: PILOT_CLIP_USD,
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
      clipUsd: PILOT_CLIP_USD,
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

// Pure: the UTC moment a chunk's decision ACTS — its scheduled entry, which is
// window start + entryOffsetH. Returns null on an unusable stamp so a malformed
// record renders as "—" rather than throwing or silently falling back to the
// window start (falling back is the very confusion this exists to end).
function decisionEntryUtc(chunkStartIso, entryOffsetH) {
  const t = Date.parse(chunkStartIso);
  if (!Number.isFinite(t)) return null;
  const off = Number.isFinite(entryOffsetH) ? entryOffsetH : F1_ENTRY_OFFSET_H;
  return new Date(t + off * 3600000).toISOString();
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
  // stand-down records live on the VPS (data/pilot/standdowns), written by the
  // producer for FLAT calls and by the one-shot backfiller; tolerant load.
  let standDowns = [];
  try { standDowns = require('./pilotmirror').loadStandDowns(); } catch (_) { standDowns = []; }
  const st = derive(events, { standDowns });
  // Date every decision row by the moment it ACTS, not by the feature window it
  // was built from (see F1_ENTRY_OFFSET_H). derive() stays keyed on chunk_start —
  // that is the journal's key and must not move — so the acting stamp is added
  // here, where the frozen geometry is in hand.
  const entryOffsetH = (cfg && cfg.model && Number.isFinite(cfg.model.entryOffsetH))
    ? cfg.model.entryOffsetH : F1_ENTRY_OFFSET_H;
  st.decisions = (st.decisions || []).map((d) => ({
    ...d, entry_utc: decisionEntryUtc(d.chunk_start, entryOffsetH),
  }));
  // "pending" when the owner's request and the box's confirmed state disagree
  const armPending = req != null && req.armed !== st.armed;
  // mirror check verdict (findings 26/7): the VPS recompute writes mirror.json;
  // a break means a live decision no longer reproduces against fresh data.
  let mirror = null;
  try { mirror = require('./pilotmirror').readMirror(); } catch (_) { mirror = null; }
  // the protective-stop tuner's latest result (determined value + provenance), so
  // the screen can show the swept stop alongside what the box is actually applying.
  let stopSweep = null;
  try {
    stopSweep = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'pilot', 'stop-sweep.json'), 'utf8'));
  } catch (_) { stopSweep = null; }
  // stop-carry error (CONTROL BUG 4): the VPS sync writes this when fixed-stop.json
  // is present but unreadable/off-shape — it then leaves the box stop UNTOUCHED
  // rather than clearing it. Surface it in red so a corrupt risk-file is visible,
  // not silent. Cleared automatically on the next healthy carry.
  let stopCarryError = null;
  try {
    stopCarryError = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'pilot', 'stop-carry-error.json'), 'utf8'));
  } catch (_) { stopCarryError = null; }
  // decision preview (owner 2026-08-12): the PLAN for the upcoming entry, written by
  // the producer once the feature window closes (~1h before entry). Display-only.
  let previewDecision = null;
  try {
    previewDecision = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'pilot', 'preview.json'), 'utf8'));
  } catch (_) { previewDecision = null; }
  return {
    present: true,
    preregistration: 'general-classifier/PILOT-F1.md',
    journalSyncedUtc: mtime ? new Date(mtime).toISOString() : null,
    config: cfg,
    anatomy: anat,
    armRequest: req,
    armPending,
    mirror,
    stopSweep,
    stopCarryError,
    previewDecision,
    ...st,
    liveStatus: liveStatus(st, Date.now()),
    dataFreshness: (() => {
      // newest cached candle per F1 pair, so the screen shows the trigger inputs
      // are current. Lazy-require binance so derive() stays dependency-free.
      try {
        const binance = require('./binance');
        return dataFreshness(F1_PAIRS.map((s) => ({ symbol: s, ts: binance.newestCandleTs(s) })), Date.now());
      } catch (_) { return []; }
    })(),
  };
}

module.exports = { status, config, anatomy, derive, liveStatus, dataFreshness, decisionEntryUtc, readJournal, JOURNAL, MODEL_FEE_PER_LEG, MODEL_FEE_RATE, PILOT_CLIP_USD };
