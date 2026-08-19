#!/usr/bin/env python3
"""mx_executor.py -- the PILOT-F1 order executor. Runs ON the Mexico box.

Protocol: PILOT-F1.md (general-classifier branch), committed before this file
existed. Read that first; this header only covers mechanics.

DESIGN RULES (from PILOT-F1.md sections 4 and 7):
  * Deterministic. No AI anywhere. This program validates a signed-shape
    intent file mechanically and places orders, or it does nothing.
  * Pure stdlib. Nothing to install on the box.
  * Append-only journal. Every intent, order, ack, fill, fee, reconcile,
    halt and error is one JSON line in ~/pilot/journal.jsonl. State is
    DERIVED by replaying the journal, never stored separately -- a state
    file that can disagree with the journal is two sources of truth.
  * The executor owns sizing. Intents carry direction, never quantity; the
    clip is a constant here. A compromised or buggy intent can therefore
    change WHICH way a $10 position points, but never how big it is.
  * Fail halted. Anything unexpected halts NEW ENTRIES and journals why.
    Scheduled exits still run: halting exits converts a software doubt
    into unmanaged market exposure (PILOT-F1.md section 4).

MODES
  run     timer entry point: reconcile -> due exits -> fresh intents -> snapshot
  dust    one $10 buy->sell round trip, plumbing test (needs LIVE=1 AND --yes)
  status  print derived state from the journal, read-only
  dry is not a mode: LIVE=0 in the env file makes every mode log instead of
  send. The deploy ships LIVE=0; flipping to 1 is a deliberate manual act.

ENV FILE (~/.executor-env, chmod 600, never journaled):
  BINANCE_KEY=...      BINANCE_SECRET=...
  LIVE=0               BASE=https://api.binance.com
"""

import calendar
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# ---- constants (PILOT-F1.md; change = protocol change = record restarts) ----
SYMBOL = "LTCUSDT"
BASE_ASSET = "LTC"         # what a BUY receives and a SELL delivers
QUOTE_ASSET = "USDT"       # what the wallet is funded in
CLIP_USD = 10.0            # $ notional per position; the executor owns this
QTY_STEP = 0.001           # LOT_SIZE stepSize, probed 2026-08-11
MIN_NOTIONAL = 5.0         # exchange minimum, probed 2026-08-11
HOLD_HOURS = 137           # F1 cell tHours
MAX_CONCURRENT = 6         # 137h / 24h step, derived
INTENT_MAX_AGE_S = 1800    # an intent older than 30 min is stale, never traded
# ENTRY RETRY WINDOW (owner directive, 2026-08-16). An entry that failed used to
# get whatever ticks fitted inside INTENT_MAX_AGE_S — three — and only for
# failures BEFORE the intent was consumed. Anything that went wrong after
# consumption (no price this run, a rejected order) forfeited the day in silence.
# The owner's rule: a failed entry may try again up to 6 times, until one hour
# past its moment, then the period is abandoned OUT LOUD.
#
# Retrying is safe because place() signs every attempt with the SAME deterministic
# client_id for that (role, chunk): a resend of an order the venue already filled
# is refused as a duplicate id, not filled twice. The one-fill invariant is also
# enforced here — entry_terminal() treats a real fill, a paper fill, an INFLIGHT
# (it MAY have filled; recovery resolves it) or a drift kill as final.
ENTRY_RETRY_WINDOW_S = 3600  # attempts allowed for one hour after the entry moment
ENTRY_MAX_ATTEMPTS = 6       # six 10-minute ticks, then ENTRY_GAVE_UP
CLOCK_DRIFT_LIMIT_MS = 5000 # box OS clock this far from exchange time -> loud
ARM_MAX_AGE_S = 1800       # dead-man: ARM must be re-stamped by the control plane
                           # within 30 min (sync runs ~every 5 min) or the box
                           # self-disarms — a fail-safe kill on control-plane loss
RECV_WINDOW = 10000
# CATASTROPHIC-ONLY backstop, NOT a trade filter (owner 2026-08-12). The training
# / forward book entered UNCONDITIONALLY at the entry candle's open — it never
# skipped a trade because the market moved a few % between the decision price and
# the fill — so the live test must not either, or it diverges from the model it is
# measuring. This kept only as a sanity guard against a genuinely BROKEN price (a
# stale/garbage decision_price, or a flash-crash-tier event): 20% is far outside any
# normal LTC hourly move, so it never filters a real trade, only an insane one. The
# fill_deviation is still RECORDED on every ENTRY_FILL regardless — that measurement
# is the pilot's job and is untouched.
FILL_DEV_LIMIT = 0.20      # kill only a CATASTROPHIC (>20%) decision-vs-fill gap
REJECT_LIMIT = 3           # kill: 3 consecutive rejects (GUESSED)
LOSS_LIMIT_USD = 50.0      # kill: cumulative pilot loss (GUESSED)
# Isolation guard (independent review 2026-08-12, BLOCKER 1). This box holds ONE
# isolated-margin sub-account key (F1's) and every setup trades the SAME LTCUSDT
# wallet + borrow pool. A REAL schema-2 order would therefore land on F1's own
# wallet — re-coupling the rails through shared reconcile-halt and shared
# short-close sizing, which a single wallet cannot rail-split. Until per-setup
# sub-account key routing exists (open gap G8), schema-2 is PAPER-ONLY on the F1
# box: a setup the allowlist marks 'live' is booked as paper here (safe, still
# measures) and the unsupported-live request is logged loudly. Flip to True ONLY
# in the same change that lands per-setup key routing AND a box-wide real-exposure
# ceiling across both rails (review N1/N2).
S2_LIVE_ROUTING = False
FIXED_STOP_PCT_DEFAULT = 0.0  # hard per-order stop as a fraction of entry price.
                           # 0 = NO stop until the full-history sweep provides one.
                           # Owner (2026-08-11): every live order must carry a fixed
                           # protective stop tuned so no money-making entry is lost.
                           # The runtime value comes from FIXED_STOP_PCT in the env
                           # (set at deploy from the sweep) so it is tunable without
                           # a code change; this constant is only the fail-safe
                           # fallback when the env is silent.
MARGIN_FLOOR_DEFAULT = 0.0 # halt entries when the isolated wallet's margin level
                           # (collateral / debt) falls to or below this. 0 = NO
                           # floor, which is the state until the OWNER sets one.
                           # This engine borrows to short, so margin level is its
                           # distance to a forced liquidation, and until 2026-08-19
                           # nothing in the system read it, journaled it or gated
                           # on it. The number is the owner's to choose and arrives
                           # via MARGIN_FLOOR in the env, exactly like the stop —
                           # a threshold that stops trading is not mine to invent.
RECONCILE_TOL = QTY_STEP   # 1 lot step of drift tolerated while positions are open
# when FLAT, un-sellable sub-min-notional base (short-close buffer dust the
# exchange won't let us sell) is tolerated up to MIN_NOTIONAL/price*1.2, computed
# live in do_run — the sweep clears anything sellable (finding 19 + the live
# 2026-08-11 sub-notional reject deadlock).
MAX_SHORT_INTEREST_FRAC = 0.05  # exchange borrow legitimately exceeds the nominal
                           # by accrued interest; tolerate an excess up to 5% of
                           # nominal. 137h interest is ~0.1–0.5%, so 5% is generous
                           # headroom (re-review: a tighter 2% could false-halt at a
                           # high margin rate) yet far below a real discrepancy — an
                           # extra borrowed position would be ~100%+ of nominal.
                           # NOTE: this flat frac is a fallback CEILING only; the
                           # live cap below is DERIVED per-leg from rate x age.
MAX_BORROW_RATE_HR = 0.0005  # GUESSED-conservative hourly isolated-margin borrow
                           # rate ceiling. Real LTC isolated is ~0.01-0.02%/hr, so
                           # 0.05%/hr is 2.5-5x generous. The reconcile interest cap
                           # is DERIVED from this x each open short's AGE, so a young
                           # short tolerates little excess (catching an over-borrow
                           # early) while a full 137h hold tolerates ~6.8% — more
                           # honest than a flat frac that is identical at hour 1 and
                           # hour 137. Age is clamped to 2x HOLD so a clock glitch
                           # cannot inflate the cap without bound.
FEE_RATE_EST = 0.001       # ~0.1% taker fee, used only to keep a RECOVERED exit's
                           # P&L from overstating (the crash lost the real fee)
RESIDUAL_REPAY_TOL_FRAC = 0.05  # a short close's AUTO_REPAY must reduce the borrow
                           # by at least (1-this) x the leg's nominal; a legit repay
                           # clears ~100%+ (buffer covers the fee), so 5% slack
                           # absorbs fee/rounding while still catching a repay that
                           # barely moved the debt. GUESSED, generous side.

HOME = os.path.expanduser("~")
PILOT = os.path.join(HOME, "pilot")
JOURNAL = os.path.join(PILOT, "journal.jsonl")
INTENTS = os.path.join(PILOT, "intents")
HALT = os.path.join(PILOT, "HALT")
# Per-box allowlist for schema-2 (generalized) intents: setup_id -> limits.
# Carried by the control plane like fixed-stop; FAIL-CLOSED — no file means
# every schema-2 intent is refused, so a box trades only setups it was
# explicitly told to serve (IMPLEMENTATION-PLAN 3.1 defense in depth).
SETUPS_ALLOW = os.path.join(PILOT, "setups-allow.json")
# ARM is the owner's MASTER SWITCH. No new position opens unless this file is
# present (owner pressed START on the live screen). It is the inverse of HALT:
# HALT is an emergency stop, ARM is "the engine is running because I said so".
# Absent by default, so a fresh box, a redeploy, or a wiped disk all come up
# STOPPED. Like HALT, ARM never blocks a scheduled EXIT -- stopping the engine
# means "open nothing new", never "abandon an open position".
ARM = os.path.join(PILOT, "ARM")
# arm-authentication state (findings 12/15). The baseline records the last arm
# nonce the box has seen, so arming is edge-triggered on a NEW nonce and a stale
# request replayed after a disk wipe cannot silently re-arm.
ARM_BASELINE = os.path.join(PILOT, "arm-baseline.json")
# unhalt-authentication state (2026-08-18). Clearing a halt REMOVES a safety
# brake, so unlike DISARM it is authenticated exactly like ARM: signed, fresh
# and non-replayable. Its own baseline file, deliberately NOT the arm baseline —
# an unhalt must never be able to perturb arm's watermark.
UNHALT_BASELINE = os.path.join(PILOT, "unhalt-baseline.json")
ARM_REQUEST_FRESH_S = 900  # a genuine START's request utc must be within this;
                           # an older request is a stale replay and is refused
ARM_CLOCK_SKEW_S = 120     # tolerance for a request utc slightly AHEAD of the box
                           # clock (host skew); beyond this a future-dated arm is
                           # refused so it cannot ratchet the watermark forward
ENVFILE = os.path.join(HOME, ".executor-env")


# ---- journal ----------------------------------------------------------------
def jlog(event, **kw):
    """One JSON line, append-only, fsync'd. The journal IS the record."""
    rec = {"ts": round(time.time(), 3),
           "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "event": event}
    rec.update(kw)
    os.makedirs(PILOT, exist_ok=True)
    with open(JOURNAL, "a") as f:
        f.write(json.dumps(rec, separators=(",", ":")) + "\n")
        f.flush()
        os.fsync(f.fileno())
    return rec


def journal_events():
    if not os.path.exists(JOURNAL):
        return []
    out = []
    with open(JOURNAL) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                # a torn write at the tail is possible after a crash; keep
                # going but say so -- silence here would hide corruption
                out.append({"event": "JOURNAL_TORN_LINE", "raw": line[:120]})
    return out


# ---- derived state (replay, single source of truth) -------------------------
def pos_key(e):
    """Position key: schema-1 events (no setup_id) keep the ORIGINAL key
    (chunk_start alone) so every historical journal replays byte-identically;
    schema-2 events key on (setup_id, chunk_start) so two setups can hold the
    same period without colliding."""
    sid = e.get("setup_id")
    return e["chunk_start"] if sid is None else f"{sid}|{e['chunk_start']}"


def derive(events):
    """Replay the journal into current state. Positions are keyed by
    chunk_start (schema-1) or setup_id|chunk_start (schema-2) so one period
    per setup can never open twice. PAPER positions replay into their own
    book: they hold no exchange assets, so reconcile and the mark-to-market
    kill must never see them."""
    pos = {}            # key -> position dict (REAL money)
    paper = {}          # key -> position dict (paper twin, no orders)
    # R1 rail isolation: the reject-kill and realized are SPLIT by rail so a
    # schema-2 fault never trips F1's box-wide kills. consecutive_rejects and
    # realized_s1 count SCHEMA-1 (F1) ONLY — identical to the old single counters
    # whenever no schema-2 event exists. Schema-2 rejects/realized are tracked
    # per-setup (rejects2 / realized2) and drive per-setup halts, never the box.
    consecutive_rejects = 0   # SCHEMA-1 (F1) reject-kill counter
    rejects2 = {}             # setup_id -> consecutive schema-2 rejects
    realized = 0.0            # ALL real realized (screen/aggregate)
    realized_s1 = 0.0         # SCHEMA-1 realized only (F1's loss kill)
    realized2 = {}            # setup_id -> schema-2 realized
    paper_realized = 0.0
    dust_done = False
    shortdust_done = False

    def _reset_rejects(sid):
        nonlocal consecutive_rejects
        if sid is None:
            consecutive_rejects = 0
        else:
            rejects2[sid] = 0

    for e in events:
        ev = e.get("event")
        if ev == "ENTRY_FILL":
            pos[pos_key(e)] = {
                "chunk_start": e["chunk_start"], "side": e["side"],
                "qty": e["qty"], "entry_price": e["price"],
                "entry_ts": e["ts"], "exit_due_ts": e["exit_due_ts"],
                # the entry fee (USDT-valued). For a SHORT it was charged in USDT
                # separately from the borrow, so the exit must subtract it from
                # P&L (finding 17); for a LONG it was charged in LTC and is already
                # embedded in the fee-shrunk qty, so it is NOT subtracted again.
                "entry_fee": e.get("fee_quote", 0.0),
                # schema-2 riders (None on schema-1 positions -> globals apply)
                "setup_id": e.get("setup_id"),
                "hold_hours": e.get("hold_hours"),
                "stop_pct": e.get("stop_pct"),
            }
            _reset_rejects(e.get("setup_id"))
        elif ev == "EXIT_FILL":
            p = pos.pop(pos_key(e), None)
            sid = e.get("setup_id")
            if p:
                realized += e.get("pnl", 0.0)
                if sid is None:
                    realized_s1 += e.get("pnl", 0.0)
                else:
                    realized2[sid] = realized2.get(sid, 0.0) + e.get("pnl", 0.0)
            _reset_rejects(sid)
        elif ev == "PAPER_ENTRY_FILL":
            paper[pos_key(e)] = {
                "chunk_start": e["chunk_start"], "side": e["side"],
                "qty": e["qty"], "entry_price": e["price"],
                "entry_ts": e["ts"], "exit_due_ts": e["exit_due_ts"],
                "setup_id": e.get("setup_id"),
                "hold_hours": e.get("hold_hours"),
                "stop_pct": e.get("stop_pct"),
            }
        elif ev == "PAPER_EXIT_FILL":
            p = paper.pop(pos_key(e), None)
            if p:
                paper_realized += e.get("pnl", 0.0)
        elif ev == "ORDER_REJECT":
            # only ENTRY/EXIT rejects count toward the reject-kill — a failed
            # housekeeping SWEEP (e.g. sub-min-notional dust that cannot be sold)
            # is not a trading failure and must not creep the box toward a halt
            # (the live 2026-08-11 sweep-reject accumulation).
            if e.get("action") in ("ENTRY", "EXIT"):
                sid = e.get("setup_id")
                if sid is None:
                    consecutive_rejects += 1
                else:
                    rejects2[sid] = rejects2.get(sid, 0) + 1
        elif ev == "ORDER_ACK":
            # a successful order clears its OWN rail's reject streak; a schema-2
            # ACK must not clear F1's streak (the ACK-dilution defect, R1).
            _reset_rejects(e.get("setup_id"))
        elif ev == "DUST_DONE":
            dust_done = True
        elif ev == "SHORTDUST_DONE":
            shortdust_done = True
    return {"open": pos, "paper_open": paper, "consecutive_rejects": consecutive_rejects,
            "rejects2": rejects2, "realized": realized, "realized_s1": realized_s1,
            "realized2": realized2, "paper_realized": paper_realized,
            "dust_done": dust_done, "shortdust_done": shortdust_done}


def intent_seen(events, chunk_start):
    """Schema-1 dedup: counts only schema-1-origin INTENT_SEEN events (those
    without a setup_id), so a schema-2 twin seeing the same period can never
    consume the running F1 pilot's intent — the two rails stay independent
    (owner cutover decision: keep both; never both ordering for one setup)."""
    return any(e.get("event") == "INTENT_SEEN" and e.get("setup_id") is None and
               e.get("chunk_start") == chunk_start for e in events)


def intent_seen2(events, setup_id, chunk_start):
    """Schema-2 dedup: one period per SETUP."""
    return any(e.get("event") == "INTENT_SEEN" and e.get("setup_id") == setup_id and
               e.get("chunk_start") == chunk_start for e in events)


# ---- entry retry accounting (owner directive 2026-08-16) ---------------------
# The journal is the box's only durable state, so both the "is this period
# finished?" question and the attempt count are DERIVED from it. Nothing is held
# in memory across runs and a crash mid-attempt loses no accounting.

# Events that END a period. A period that reached any of these must NEVER be
# attempted again:
#   ENTRY_FILL / PAPER_ENTRY_FILL  the position exists
#   ENTRY_INFLIGHT                 the order MAY have filled — recovery resolves it
#                                  by client id; re-sending behind recovery is the
#                                  one path that could double a real position
#   KILL_PRICE_DRIFT               a deliberate refusal, not a transient failure
#   ENTRY_GAVE_UP                  the retry budget or the window is spent
_ENTRY_TERMINAL_EVENTS = ("ENTRY_FILL", "PAPER_ENTRY_FILL", "ENTRY_INFLIGHT",
                          "KILL_PRICE_DRIFT", "ENTRY_GAVE_UP")


def _same_rail(e, setup_id):
    """Schema-1 events carry no setup_id; schema-2 events carry their own. Keeps
    the two rails' accounting independent, exactly as intent_seen/intent_seen2 do."""
    return e.get("setup_id") == setup_id if setup_id is not None else e.get("setup_id") is None


def entry_terminal(events, chunk_start, setup_id=None):
    """Is this period finished — filled, in flight, killed, or given up?"""
    return any(e.get("event") in _ENTRY_TERMINAL_EVENTS and
               e.get("chunk_start") == chunk_start and _same_rail(e, setup_id)
               for e in events)


def entry_attempts(events, chunk_start, setup_id=None):
    """How many order attempts this period has already had."""
    return sum(1 for e in events
               if e.get("event") == "ENTRY_ATTEMPT" and
               e.get("chunk_start") == chunk_start and _same_rail(e, setup_id))


def _utc_str(epoch_s):
    """Epoch seconds -> the journal's UTC stamp format."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch_s))


def entry_deadline(intent):
    """Last moment an attempt may be made, in epoch seconds.

    Anchored on the intent's own entry moment (`entry_ts`, stamped by the
    producer) when present, so the window is literally 'one hour after the
    01:00 entry'. Falls back to the mint stamp for an intent produced before
    the producer carried entry_ts — never wider than the same hour from mint,
    so a legacy intent cannot gain a longer life than the rule allows."""
    base = intent.get("entry_ts")
    if not isinstance(base, (int, float)):
        base = intent.get("ts", 0)
    return base + ENTRY_RETRY_WINDOW_S


def setups_allow():
    """Read the per-box schema-2 allowlist. FAIL-CLOSED: absent or unreadable
    means {} — every schema-2 intent refused. Shape:
      { "<setup_id>": { "symbol": "LTCUSDT", "max_clip_usd": 25,
                        "max_concurrent": 6 } }
    max_concurrent defaults to ceil(hold_hours/24) at use time when absent."""
    try:
        with open(SETUPS_ALLOW) as fh:
            d = json.load(fh)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def clip_qty_usd(price, usd):
    """Arbitrary $ notional rounded DOWN to the lot step; None if under the
    exchange minimum. clip_qty() below stays byte-identical for schema-1."""
    qty = floor_step(usd / price)
    if qty * price < MIN_NOTIONAL:
        return None
    return qty


# Paper fills model the model's OWN fee assumption ($0.0125 per $10 leg =
# 0.125% of notional per leg), so a paper book is comparable to the lab's
# numbers — the fidelity question "does live match paper" then isolates
# execution, not fee-model drift.
PAPER_FEE_RATE = 0.00125


# ---- halt flag ---------------------------------------------------------------
def halted():
    return os.path.exists(HALT)


def armed():
    """Armed = the ARM file is present AND was refreshed recently. The control
    plane re-stamps it every sync (~5 min); if the VPS/tunnel dies while armed,
    the stamp goes stale and the box SELF-DISARMS (dead-man). So a STOP that
    cannot reach the box still takes effect, and any control-plane failure fails
    SAFE — no new entries open past the dead-man window (review findings 13-15).
    Exits are never gated on this."""
    if not os.path.exists(ARM):
        return False
    try:
        with open(ARM) as f:
            ts = json.load(f).get("ts", 0)
    except Exception:
        return False
    return (time.time() - ts) <= ARM_MAX_AGE_S


def arm_present():
    return os.path.exists(ARM)


def set_halt(source, reason):
    os.makedirs(PILOT, exist_ok=True)
    with open(HALT, "w") as f:
        f.write(json.dumps({"source": source, "reason": reason,
                            "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                                 time.gmtime())}))
    jlog("HALT_SET", source=source, reason=reason)


# ---- per-SETUP halt (R1: rail isolation) -------------------------------------
# The box-wide HALT above is F1's — a schema-1 fault stops the whole box, exactly
# as before. A schema-2 (generalized setup) fault must NOT stop F1: it sets a
# per-setup halt that blocks only THAT setup's new entries, never the box and
# never any other setup. Like the box halt, it gates entries only — a halted
# setup's OPEN positions still exit on schedule/stop (exits are never gated).
def setup_halt_path(setup_id):
    safe = re.sub(r"[^0-9A-Za-z_.-]", "_", str(setup_id))
    return os.path.join(PILOT, "HALT-setup-" + safe)


def setup_halted(setup_id):
    return os.path.exists(setup_halt_path(setup_id))


def set_setup_halt(setup_id, reason):
    os.makedirs(PILOT, exist_ok=True)
    with open(setup_halt_path(setup_id), "w") as f:
        f.write(json.dumps({"setup_id": setup_id, "reason": reason,
                            "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}))
    jlog("SETUP_HALT_SET", setup_id=setup_id, reason=reason)


def set_arm(on, source):
    """Owner's master switch. on=True writes/refreshes ARM with a fresh
    timestamp (the control plane calls this every sync as a keepalive); False
    removes it. Journals only on a real transition so the keepalive does not
    spam the journal, while the timestamp is always refreshed for the dead-man."""
    os.makedirs(PILOT, exist_ok=True)
    if on:
        was = armed()  # fresh-armed before this call?
        with open(ARM, "w") as f:
            f.write(json.dumps({"source": source, "ts": round(time.time(), 3),
                                "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}))
        if not was:
            jlog("ARM_SET", source=source)  # transition: off/stale -> armed
    else:
        existed = os.path.exists(ARM)
        try:
            os.remove(ARM)
        except FileNotFoundError:
            pass
        if existed:
            jlog("ARM_CLEAR", source=source)


def _read_baseline():
    try:
        with open(ARM_BASELINE) as f:
            return json.load(f)
    except Exception:
        return None


def _write_baseline(nonce, honored, watermark_utc=None):
    os.makedirs(PILOT, exist_ok=True)
    tmp = ARM_BASELINE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"nonce": nonce, "honored": bool(honored), "watermark_utc": watermark_utc,
                   "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, f)
    os.replace(tmp, ARM_BASELINE)


def _utc_age_s(utc_str, now=None):
    """Seconds since an ISO-8601 UTC timestamp; unparseable/absent reads as very
    old, so a malformed request is treated as stale (fail-safe). `now` defaults to
    the OS clock; the arm path passes EXCHANGE-synced time so a skewed box OS clock
    cannot brick a legitimate START (re-review A1). Relative comparisons
    (_utc_newer) leave it None because the reference cancels."""
    ref = time.time() if now is None else now
    try:
        base = str(utc_str).replace("Z", "").split(".")[0]
        t = time.strptime(base, "%Y-%m-%dT%H:%M:%S")
        return ref - calendar.timegm(t)
    except Exception:
        return 10 ** 9


def _utc_newer(a, b):
    """True if timestamp a is strictly more recent than b (smaller age)."""
    return _utc_age_s(a) < _utc_age_s(b)


def honor_arm_request(armed, source, nonce=None, utc=None, hmac_sig=None, now_s=None):
    """The owner's master switch WITH authentication (findings 12/15, re-review B1/B2).

    `now_s` is the reference clock for the freshness/future checks. The arm CLI
    passes EXCHANGE-synced time so a skewed box OS clock cannot silently refuse a
    legitimate START (re-review A1); it defaults to the OS clock. The monotonic
    watermark comparisons stay relative (both sides minted on the same clock) and
    are unaffected.

    DISARM is UNCONDITIONAL and handled FIRST — a kill switch must never be gated
    behind authentication (re-review B2). An unsigned or missing STOP still stops.

    ARM requires a configured PILOT_ARM_SECRET and a valid HMAC over {1,nonce,utc}
    (finding 12). Arming a live-money rig with NO secret is REFUSED, fail-safe
    (re-review B1): the nonce/freshness edge alone is not authorization to open
    trades. Arming is edge-triggered on a NEW nonce whose request is FRESH and
    strictly newer than the last honored-arm/STOP watermark, so neither a stale
    replay after a disk wipe (finding 15) nor a captured request replayed after a
    STOP (re-review C) can re-arm. A host bounce that preserves ~/pilot keeps the
    honored baseline and resumes."""
    base = _read_baseline() or {}
    wm = base.get("watermark_utc")

    if not armed:
        # UNCONDITIONAL STOP. Advance the watermark to this disarm so a captured
        # pre-STOP arm request cannot replay back in, and drop the honored flag so
        # a keepalive of the old nonce cannot silently re-arm.
        set_arm(False, source)
        # Advance the watermark to this disarm's utc, but ONLY if that utc is not
        # future-dated (re-review liveness): a clock glitch or an injected STOP with
        # a utc hours ahead would otherwise ratchet the watermark into the future
        # and BRICK every legitimate arm until wall-clock caught up. A future utc
        # (negative age) is ignored for watermarking; the STOP itself still fires.
        advance = utc and _utc_age_s(utc, now_s) >= 0 and (not wm or _utc_newer(utc, wm))
        new_wm = utc if advance else wm
        _write_baseline(base.get("nonce", "stop"), honored=False, watermark_utc=new_wm)
        return

    secret = load_env().get("PILOT_ARM_SECRET", "")
    if not secret:
        jlog("ARM_NO_SECRET", source=source,
             note="refusing to arm: no PILOT_ARM_SECRET configured on the box — "
                  "provision the shared arm secret to enable arming (fail-safe)")
        return
    expect = hmac.new(secret.encode(), f"1|{nonce}|{utc}".encode(), hashlib.sha256).hexdigest()
    if not hmac_sig or not hmac.compare_digest(expect, hmac_sig):
        jlog("ARM_HMAC_INVALID", source=source, nonce=nonce)
        return

    # keepalive of the current armed session: re-stamp the dead-man, no freshness gate
    if base.get("nonce") == nonce and base.get("honored"):
        set_arm(True, source)
        return
    # monotonic replay guard: an arm must be strictly newer than the last honored
    # arm or STOP, so a captured valid request cannot re-arm after a disarm.
    if wm and not _utc_newer(utc, wm):
        jlog("ARM_REPLAY_REJECTED", source=source, nonce=nonce, utc=utc, watermark=wm)
        return
    # a NEW nonce: arm only if the request is FRESH. A stale request (old utc, e.g.
    # replayed by the level-triggered sync after a wipe) becomes an un-honored
    # baseline and is refused until a genuine fresh START arrives. The window is
    # two-sided: a FUTURE-dated utc (age < -ARM_CLOCK_SKEW_S) is refused too, so a
    # signed arm carrying a glitched clock cannot ratchet the watermark into the
    # future and brick later legitimate arms.
    age = _utc_age_s(utc, now_s)
    if -ARM_CLOCK_SKEW_S <= age <= ARM_REQUEST_FRESH_S:
        _write_baseline(nonce, honored=True, watermark_utc=utc)
        set_arm(True, source)
    else:
        _write_baseline(nonce, honored=False, watermark_utc=wm)
        jlog("ARM_STALE_REQUEST", source=source, nonce=nonce, age_s=int(_utc_age_s(utc, now_s)),
             note="arm request outside the freshness window (stale or future) — refusing "
                  "to arm without a fresh START (finding 15 / re-review A1)")


def _read_unhalt_baseline():
    try:
        with open(UNHALT_BASELINE) as f:
            return json.load(f)
    except Exception:
        return None


def _write_unhalt_baseline(nonce, utc):
    os.makedirs(PILOT, exist_ok=True)
    tmp = UNHALT_BASELINE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"nonce": nonce, "watermark_utc": utc,
                   "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, f)
    os.replace(tmp, UNHALT_BASELINE)


def honor_unhalt_request(source, nonce, utc, hmac_sig, reason, force=False, now_s=None):
    """Clear the HALT flag, authenticated. Returns True iff the halt was cleared.

    DIRECTION MATTERS. `disarm` is a kill switch and is deliberately
    unauthenticated — an unsigned STOP must still stop. `unhalt` is its
    opposite: it REMOVES a brake, so it gets ARM's full treatment — a
    configured secret, a valid HMAC over {unhalt,nonce,utc}, a two-sided
    freshness window, and a monotonic replay guard. The failure mode is
    fail-safe in the direction that matters: anything off, the halt STAYS.

    `force` is the operator escape hatch for someone already at a shell on this
    box (pilot-unhalt.sh). It adds no attack surface — that person can
    `rm ~/pilot/HALT` directly — but it is journaled as unauthenticated so the
    record distinguishes a control-plane clear from a hand clear. Without it a
    box whose secret was never provisioned would be un-clearable except by hand,
    which is the kind of lockout that gets worked around with worse habits."""
    if not halted():
        print("not halted; nothing to clear")
        return False

    if not force:
        secret = load_env().get("PILOT_ARM_SECRET", "")
        if not secret:
            jlog("UNHALT_NO_SECRET", source=source,
                 note="refusing to clear the halt: no PILOT_ARM_SECRET on the box. "
                      "Use --force from a shell on the box if this is a hand clear.")
            print("REFUSED (no arm secret configured; halt stands)")
            return False
        expect = hmac.new(secret.encode(), f"unhalt|{nonce}|{utc}".encode(),
                          hashlib.sha256).hexdigest()
        if not hmac_sig or not hmac.compare_digest(expect, hmac_sig):
            jlog("UNHALT_HMAC_INVALID", source=source, nonce=nonce)
            print("REFUSED (bad or missing signature; halt stands)")
            return False
        base = _read_unhalt_baseline() or {}
        wm = base.get("watermark_utc")
        if base.get("nonce") == nonce or (wm and not _utc_newer(utc, wm)):
            jlog("UNHALT_REPLAY_REJECTED", source=source, nonce=nonce, utc=utc, watermark=wm)
            print("REFUSED (replayed request; halt stands)")
            return False
        age = _utc_age_s(utc, now_s)
        if not (-ARM_CLOCK_SKEW_S <= age <= ARM_REQUEST_FRESH_S):
            jlog("UNHALT_STALE_REQUEST", source=source, nonce=nonce, age_s=int(age),
                 note="unhalt request outside the freshness window (stale or future) — "
                      "a request left on disk must not clear a halt that fired later")
            print("REFUSED (stale or future-dated request; halt stands)")
            return False
        _write_unhalt_baseline(nonce, utc)

    try:
        os.remove(HALT)
    except FileNotFoundError:
        pass
    jlog("HALT_CLEAR", source=source, reason=reason or "manual clear",
         authenticated=(not force), nonce=(None if force else nonce))
    print("UNHALTED (halt flag cleared)")
    return True


# ---- Binance client (stdlib only) -------------------------------------------
class Binance:
    def __init__(self, env):
        self.key = env.get("BINANCE_KEY", "")
        self.secret = env.get("BINANCE_SECRET", "")
        self.base = env.get("BASE", "https://api.binance.com")
        self.live = env.get("LIVE", "0") == "1"
        self.offset_ms = 0

    def _http(self, method, path, params, signed):
        q = dict(params)
        if signed:
            q["timestamp"] = int(time.time() * 1000) + self.offset_ms
            q["recvWindow"] = RECV_WINDOW
            payload = urllib.parse.urlencode(q)
            sig = hmac.new(self.secret.encode(), payload.encode(),
                           hashlib.sha256).hexdigest()
            payload = payload + "&signature=" + sig
        else:
            payload = urllib.parse.urlencode(q)
        url = self.base + path + ("?" + payload if method == "GET" else "")
        data = payload.encode() if method != "GET" else None
        req = urllib.request.Request(url, data=data, method=method)
        if signed or self.key:
            req.add_header("X-MBX-APIKEY", self.key)
        if method != "GET":
            req.add_header("Content-Type", "application/x-www-form-urlencoded")
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                body = r.read().decode()
                return r.status, json.loads(body) if body else {}
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")[:400]
            try:
                return e.code, json.loads(body)
            except json.JSONDecodeError:
                return e.code, {"raw": body}
        except Exception as e:  # DNS, timeout, TLS -- journal and treat as reject
            return 0, {"transport_error": str(e)[:200]}

    def sync_clock(self):
        code, body = self._http("GET", "/api/v3/time", {}, signed=False)
        if code == 200:
            self.offset_ms = body["serverTime"] - int(time.time() * 1000)
        jlog("CLOCK_SYNC", http=code, offset_ms=self.offset_ms)
        return code == 200

    def price(self):
        code, body = self._http("GET", "/api/v3/ticker/price",
                                {"symbol": SYMBOL}, signed=False)
        return float(body["price"]) if code == 200 else None

    def margin_order(self, side, qty, side_effect, client_id=None):
        """Place an isolated-margin MARKET order. side: BUY|SELL.
        side_effect: NO_SIDE_EFFECT | MARGIN_BUY (auto-borrow) | AUTO_REPAY.
        client_id (newClientOrderId) is DETERMINISTIC per (role, chunk). Binance
        rejects a duplicate client id only while the prior order is still OPEN, so
        this alone does NOT guarantee resend-idempotency for a FILLED/closed order
        (the id can be reused once terminal). The real protection against a
        double-trade is resolve_dangling(): it queries the venue by client id and
        books/voids the prior send BEFORE any new order, so a crash-orphaned fill
        is reconciled rather than blindly re-sent (review findings 1-2)."""
        params = {"symbol": SYMBOL, "isIsolated": "TRUE", "side": side,
                  "type": "MARKET", "quantity": f"{qty:.3f}",
                  "sideEffectType": side_effect,
                  "newOrderRespType": "FULL"}
        if client_id:
            params["newClientOrderId"] = client_id
        if not self.live:
            jlog("DRYRUN_ORDER", **params)
            # fabricate a fill at last price so dry runs exercise the paths
            p = self.price() or 0.0
            return 200, {"orderId": 0, "clientOrderId": client_id or "", "status": "FILLED",
                         "dryrun": True,
                         "fills": [{"price": f"{p}", "qty": f"{qty:.3f}",
                                    "commission": "0", "commissionAsset": "USDT"}]}
        return self._http("POST", "/sapi/v1/margin/order", params, signed=True)

    def query_order(self, client_id):
        """Look up an isolated-margin order by its deterministic client id, so a
        dangling ORDER_SENT/ORDER_UNKNOWN can be resolved against the venue."""
        return self._http("GET", "/sapi/v1/margin/order",
                          {"symbol": SYMBOL, "isIsolated": "TRUE",
                           "origClientOrderId": client_id}, signed=True)

    def isolated_account(self):
        return self._http("GET", "/sapi/v1/margin/isolated/account",
                          {"symbols": SYMBOL}, signed=True)

    def free_base(self):
        """Free (sellable) base-asset balance in the isolated wallet, or None if
        unreadable. Exits read this so they sell/repay what is ACTUALLY held
        after fees, never the nominal quantity."""
        code, acct = self.isolated_account()
        if code == 200 and not acct.get("dryrun"):
            try:
                return float(acct["assets"][0]["baseAsset"]["free"])
            except (KeyError, IndexError, ValueError):
                return None
        return None

    def borrowed_base(self):
        """Base-asset debt (borrowed + accrued interest) in the isolated wallet,
        or None if unreadable. A short close must buy back enough to clear this
        AFTER the LTC buy fee, so it reads the real figure rather than assuming
        the nominal borrowed quantity."""
        code, acct = self.isolated_account()
        if code == 200 and not acct.get("dryrun"):
            try:
                b = acct["assets"][0]["baseAsset"]
                return float(b.get("borrowed", 0) or 0) + float(b.get("interest", 0) or 0)
            except (KeyError, IndexError, ValueError):
                return None
        return None


def load_env():
    env = {}
    try:
        with open(ENVFILE) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return env


def fixed_stop_pct():
    """The hard per-order stop as a POSITIVE fraction of entry price, or 0.0 if no
    stop is configured. Read live from FIXED_STOP_PCT in the env so the swept value
    can be set at deploy without a code change; a malformed or absent value falls
    back to the module default (0 = disabled), never crashes."""
    raw = load_env().get("FIXED_STOP_PCT", "")
    try:
        v = float(raw) if raw not in (None, "") else FIXED_STOP_PCT_DEFAULT
    except (TypeError, ValueError):
        return 0.0
    return v if v > 0 else 0.0


def margin_floor():
    """The owner's margin-level floor as a POSITIVE number, or 0.0 for no floor.
    Read live from MARGIN_FLOOR in the env, the same carry path as the stop, so the
    owner sets it through the interface rather than anyone editing code. Malformed
    or absent means NO floor (0) — a threshold nobody chose must never start
    braking on its own."""
    raw = load_env().get("MARGIN_FLOOR", "")
    try:
        v = float(raw) if raw not in (None, "") else MARGIN_FLOOR_DEFAULT
    except (TypeError, ValueError):
        return 0.0
    return v if v > 0 else 0.0


# ---- order helpers -----------------------------------------------------------
import math

# Buying to close a short must cover the debt AFTER the buy fee is taken in LTC,
# so it rounds UP with a small buffer. DERIVED (2026-08-11): the final short
# close is now sized from LIVE debt (borrowed_base includes accrued interest),
# so this buffer no longer has to absorb 137h of interest — it covers only the
# taker fee, observed at ~10bps (0.1%) on the long and short dust round trips.
# 0.3% = ~3x that fee, so AUTO_REPAY fully clears the loan; the tiny surplus
# becomes harmless base dust (swept when flat) rather than a residual borrow.
# The post-repay residual assertion on the final leg halts loudly if it ever
# under-repays anyway, so a wrong buffer fails safe instead of compounding.
SHORT_CLOSE_FEE_BUFFER = 0.003


def floor_step(qty):
    """Round DOWN to the lot step. Used where selling: fee-shrunk balances must
    never round UP into 'insufficient balance'."""
    return round(int(round(qty / QTY_STEP, 6)) * QTY_STEP, 3)


def ceil_step(qty):
    """Round UP to the lot step. Used where buying to repay a short: we must
    end up holding AT LEAST the borrowed amount after the LTC fee."""
    return round(math.ceil(round(qty / QTY_STEP, 6)) * QTY_STEP, 3)


def clip_qty(price):
    """$10 notional rounded DOWN to the lot step; refuse if under exchange min."""
    qty = floor_step(CLIP_USD / price)
    if qty * price < MIN_NOTIONAL:
        return None
    return qty


def fills_summary(body):
    """Weighted fill price, total qty, commission (in QUOTE terms), and the
    part of the commission charged in the BASE asset.

    WHY base_comm matters (learned from the dust trade, 2026-08-11): Binance
    takes the taker fee on a BUY out of the asset RECEIVED — LTC — so after a
    $10 buy you hold slightly LESS LTC than you bought. Selling the full bought
    quantity then fails 'insufficient balance'. The caller must sell
    filled_qty - base_comm, floored. Fee is valued in USDT so the screen's
    realized cost/leg is real regardless of which asset the fee was charged in."""
    fills = body.get("fills") or []
    if not fills:
        return None, None, 0.0, 0.0
    qty = sum(float(f["qty"]) for f in fills)
    px = sum(float(f["price"]) * float(f["qty"]) for f in fills) / qty
    fee_quote = 0.0
    base_comm = 0.0
    for f in fills:
        c = float(f.get("commission", 0) or 0)
        asset = f.get("commissionAsset")
        if asset == QUOTE_ASSET:
            fee_quote += c
        elif asset == BASE_ASSET:
            fee_quote += c * float(f["price"])
            base_comm += c
        else:
            # BNB or other: not valued here. The pilot disables BNB-fee payment
            # (PILOT-F1.md), so this branch should not fire; if it does, the fee
            # is under-counted and that is logged, not silently zero.
            jlog("FEE_ASSET_UNVALUED", asset=asset, amount=c)
    return px, qty, fee_quote, base_comm


def client_id(role, chunk_start, setup_id=None):
    """Deterministic order id per (role, chunk[, setup]): a resend is a no-op at
    the venue. <=36 chars, alphanumeric + dashes.

    Schema-1 (setup_id is None) keeps the ORIGINAL formula BYTE-FOR-BYTE, so the
    running F1 pilot's ids never change and every historical journal still
    matches on recovery. Roles without a chunk (dust, sweep) fold a coarse day
    bucket so they stay stable within a run.

    Schema-2 HASHES (setup_id, chunk_start) instead of truncating: the old
    14-char alnum bucket held exactly F1's fixed-width ISO stamp, but a
    variable-length setup id eats that budget and collapses EVERY chunk of a
    setup to one id — which silently defeats crash-recovery-by-id (an orphaned
    real fill is never resolved). The hash is unique per (setup, chunk, role),
    within the 36-char venue limit. (QC 117 / re-review R3.)"""
    if setup_id is None:
        c = re.sub(r"[^0-9A-Za-z]", "", str(chunk_start or "na"))[:14]
        return f"f1-{role}-{c}"[:36]
    h = hashlib.sha256(f"{setup_id}\x1f{chunk_start}".encode()).hexdigest()[:18]
    return f"s2-{role}-{h}"[:36]


def place(bx, action, side, qty, side_effect, ctx, cid=None):
    """Send one order and journal it. Returns (status, fill_px, fee_quote,
    filled_qty, base_comm) where status is 'filled' | 'unknown' | 'rejected'.
    'unknown' (a transport error, http 0) is NOT a reject: the order may have
    filled, so the caller must not proceed as if it did — the next run's
    recovery resolves it by client id."""
    jlog("ORDER_SENT", action=action, side=side, qty=qty,
         side_effect=side_effect, client_id=cid, live=bx.live, **ctx)
    code, body = bx.margin_order(side, qty, side_effect, cid)
    if code == 200:
        status = body.get("status")
        try:
            executed = float(body.get("executedQty", 0) or 0)
        except (TypeError, ValueError):
            executed = 0.0
        # Any 200 that EXECUTED SOME QUANTITY is a fill, not a reject — a
        # PARTIALLY_FILLED or EXPIRED market order that filled part of the clip
        # must be BOOKED (else the executed position is an orphan with no exit,
        # and a spurious reject creeps toward the kill) — re-review order-lifecycle.
        if status == "FILLED" or executed > 0 or body.get("fills"):
            px, fq, fee, base_comm = fills_summary(body)
            # a "filled" with no usable fill price (empty/malformed fills) cannot be
            # booked safely — treat as UNKNOWN so recovery resolves it, rather than
            # crash later comparing a None price (re-review order-lifecycle minor).
            if px is None:
                jlog("ORDER_UNKNOWN", action=action, http=code, client_id=cid,
                     status=status, body=json.dumps(body)[:200], **ctx)
                return "unknown", None, 0.0, 0.0, 0.0
            jlog("ORDER_ACK", action=action, http=code, client_id=cid,
                 order_id=body.get("orderId"), status=status, fill_price=px, fill_qty=fq,
                 fee_quote=fee, base_comm=base_comm, **ctx)
            return "filled", px, fee, fq, base_comm
        # accepted but nothing executed yet (NEW/PENDING) — treat as UNKNOWN so the
        # next run's recovery resolves it by client id, never a phantom or a reject.
        if status in ("NEW", "PARTIALLY_FILLED", "PENDING_NEW", "ACCEPTED"):
            jlog("ORDER_UNKNOWN", action=action, http=code, client_id=cid,
                 status=status, body=json.dumps(body)[:200], **ctx)
            return "unknown", None, 0.0, 0.0, 0.0
        # a 200 that executed nothing and is terminal (EXPIRED/REJECTED/CANCELED)
        # is a genuine no-fill.
        jlog("ORDER_REJECT", action=action, http=code, client_id=cid,
             status=status, body=json.dumps(body)[:300], **ctx)
        return "rejected", None, 0.0, 0.0, 0.0
    # AMBIGUOUS outcome (re-review B1): a transport error (code 0) OR an HTTP 5xx /
    # 429 / 418 means the order MAY have executed — Binance documents 504 as
    # explicitly unknown. Never book these as a reject (which would orphan a real
    # fill and creep the reject-kill); return UNKNOWN so recovery resolves them by
    # client id. Only an authoritative 4xx (below) is a genuine reject.
    if code == 0 or code >= 500 or code in (429, 418):
        jlog("ORDER_UNKNOWN", action=action, http=code, client_id=cid,
             body=json.dumps(body)[:200], **ctx)
        return "unknown", None, 0.0, 0.0, 0.0
    jlog("ORDER_REJECT", action=action, http=code, client_id=cid,
         body=json.dumps(body)[:300], **ctx)
    return "rejected", None, 0.0, 0.0, 0.0


TERMINAL_ORDER_EVENTS = {"ORDER_ACK", "ORDER_REJECT", "ORDER_RESOLVED", "ORDER_VOID"}


def resolve_dangling(bx):
    """Recover orders that were SENT but whose outcome was never journaled — a
    crash/reboot/timeout between the venue executing and the journal recording
    (review findings 1-2). Each is looked up by its deterministic client id; a
    confirmed fill is booked (an ENTRY gets its exit_due_ts so it WILL close),
    an order that never executed is voided, and a still-unreachable one is left
    for next run. Runs before anything else so a recovered position is present
    for exits and reconcile."""
    events = journal_events()
    sent, terminated = {}, set()
    for e in events:
        cid = e.get("client_id")
        if not cid:
            continue
        ev = e.get("event")
        if ev == "ORDER_SENT":
            sent[cid] = e
        elif ev in TERMINAL_ORDER_EVENTS:
            terminated.add(cid)
    dangling = [cid for cid in sent if cid not in terminated]
    if not dangling:
        return
    st = derive(events)
    for cid in dangling:
        s = sent[cid]
        action, chunk = s.get("action"), s.get("chunk_start")
        code, body = bx.query_order(cid)
        # AMBIGUOUS lookup (re-review B1): a transport error OR an HTTP 5xx/429/418
        # is not evidence the order never executed — DEFER and retry, never VOID (a
        # void would permanently forget a real fill). Only an authoritative 4xx
        # (e.g. -2013 not found) means the order truly never reached the venue.
        if code == 0 or code >= 500 or code in (429, 418):
            jlog("RECOVER_DEFER", client_id=cid, http=code,
                 note="venue unreachable/ambiguous; retry next run")
            continue
        if code != 200:
            jlog("ORDER_VOID", client_id=cid, action=action, chunk_start=chunk,
                 http=code, note="order not found at venue — never executed")
            continue
        status = body.get("status")
        if status in ("NEW", "PARTIALLY_FILLED", "PENDING_NEW"):
            jlog("RECOVER_DEFER", client_id=cid, status=status, note="still working")
            continue
        if status != "FILLED":
            jlog("ORDER_VOID", client_id=cid, action=action, chunk_start=chunk, status=status)
            continue
        try:
            eq = float(body["executedQty"])
            cq = float(body["cummulativeQuoteQty"])
            px = cq / eq if eq else 0.0
            ft = (body.get("updateTime") or body.get("time") or int(time.time() * 1000)) / 1000.0
        except (KeyError, ValueError, ZeroDivisionError):
            jlog("RECOVER_DEFER", client_id=cid, note="unparseable fill; retry")
            continue
        jlog("ORDER_RESOLVED", client_id=cid, action=action, chunk_start=chunk,
             fill_price=px, fill_qty=eq, status="FILLED")
        if action == "ENTRY":
            side = s.get("pos_side") or ("LONG" if s.get("side") == "BUY" else "SHORT")
            # schema-2 riders survive the crash inside the ORDER_SENT meta, so a
            # recovered generalized entry books its OWN hold/stop, not F1's.
            sid = s.get("setup_id")
            hold_h = s.get("hold_hours") if sid is not None and isinstance(s.get("hold_hours"), (int, float)) else HOLD_HOURS
            jlog("ENTRY_FILL", chunk_start=chunk, side=side, qty=eq,
                 ordered_qty=s.get("qty"), price=px, fee_quote=0.0, recovered=True,
                 decision_price=px, fill_deviation=0.0,
                 exit_due_ts=ft + hold_h * 3600,
                 **({"setup_id": sid, "hold_hours": hold_h,
                     "stop_pct": s.get("stop_pct"), "clip_usd": s.get("clip_usd")} if sid is not None else {}))
        elif action == "EXIT":
            sid = s.get("setup_id")
            p = st["open"].get(chunk if sid is None else f"{sid}|{chunk}")
            entry_price = p["entry_price"] if p else px
            side = p["side"] if p else (s.get("pos_side") or "LONG")
            qty_traded = p["qty"] if p else eq
            gross = (px - entry_price) * qty_traded
            if side == "SHORT":
                gross = -gross
            # the crash lost the real fee/interest, so book a CONSERVATIVE estimate
            # rather than the optimistic gross: an ~0.1% exit taker fee, plus the
            # recorded ENTRY-leg fee on EITHER side (re-review money-math — a long's
            # entry fee is real cost, not embedded in the qty), so a recovered
            # exit's P&L is not overstated and cannot flatter the loss kill. A
            # recovered-entry long has entry_fee=0 (the crash lost it), so this
            # safely subtracts nothing when the fee is genuinely unknown.
            fee_est = FEE_RATE_EST * px * qty_traded
            entry_fee = (p.get("entry_fee", 0.0) if p else 0.0)
            # a recovered SHORT also owes borrow interest the scheduled path books
            # from live debt (re-review money-math): the crash lost the live debt,
            # so estimate it CONSERVATIVELY (over-charge, never under) from the
            # rate ceiling x the leg's age, clamped to the full hold — so a
            # recovered short's P&L is not overstated. Age from exit_due_ts when the
            # entry record survives, else assume the full hold.
            interest_est = 0.0
            if side == "SHORT":
                hold_h2 = (p.get("hold_hours") if p and p.get("hold_hours") else HOLD_HOURS)
                if p and p.get("exit_due_ts"):
                    age_h = (time.time() - (p["exit_due_ts"] - hold_h2 * 3600)) / 3600.0
                    age_h = min(max(0.0, age_h), hold_h2)
                else:
                    age_h = hold_h2
                interest_est = MAX_BORROW_RATE_HR * age_h * px * qty_traded
            jlog("EXIT_FILL", chunk_start=chunk, side=side, qty=qty_traded,
                 price=px, fee_quote=round(fee_est, 6),
                 interest_cost=round(interest_est, 6),
                 pnl=round(gross - fee_est - entry_fee - interest_est, 4),
                 recovered=True, pnl_estimated=True,
                 **({"setup_id": sid} if sid is not None else {}))
        # dust/shortdust/sweep: ORDER_RESOLVED alone is enough (manual books)


# ---- the run mode ------------------------------------------------------------
def do_run(bx):
    events = journal_events()
    st = derive(events)
    now = time.time()

    if not bx.sync_clock():
        jlog("KILL_TRANSPORT", note="cannot reach venue for clock sync; "
             "no orders this run")
        return 1

    # Exchange-synced clock for the CROSS-HOST intent-age check (finding 3): the
    # VPS stamps the intent ts and the box checks its age, so two drifting OS
    # clocks could silently discard every intent as "stale" and stop all entries
    # with the screen still green. Basing the age check on Binance-synced time
    # removes the box's contribution; chrony on both hosts (pilot-install.sh)
    # removes the VPS's. If the box OS clock is far from exchange time, say so
    # LOUDLY so a systemic NTP failure is visible, not silent.
    now_exch = time.time() + bx.offset_ms / 1000.0
    if abs(bx.offset_ms) > CLOCK_DRIFT_LIMIT_MS:
        jlog("CLOCK_DRIFT", offset_ms=bx.offset_ms, limit_ms=CLOCK_DRIFT_LIMIT_MS,
             note="box OS clock differs from exchange by more than the limit — "
                  "check chrony/timesyncd; intent-age now uses exchange time")

    # 0a) RECOVER any order sent-but-unresolved before anything else, so a
    # crash-orphaned position is booked (with its exit_due_ts) and can close.
    resolve_dangling(bx)
    st = derive(journal_events())

    px = bx.price()  # fetched once, reused by the sweep, reconcile, and the kill

    # 0) sweep: keep free base ≈ the summed OPEN LONG holdings by flattening any
    # SELLABLE EXCESS to USDT — short-close buffer dust or an unknown long. Runs
    # whether or not the book is flat: with up to 6 concurrent 137h holds the book
    # is essentially never flat, so a flat-only sweep let dust accumulate and
    # false-HALT reconcile within a few closes (re-review B2). Sub-min-notional
    # excess cannot be sold and is left for reconcile to tolerate. Only while
    # ARMED — a STOPPED box places NO orders at all (control-plane E).
    if not halted() and armed() and px:
        fb = bx.free_base()
        long_held = sum(p["qty"] for p in st["open"].values() if p["side"] == "LONG")
        excess = (fb - long_held) if fb is not None else 0.0
        if excess >= QTY_STEP:
            sweep = floor_step(excess)
            if sweep and sweep * px >= MIN_NOTIONAL:
                jlog("DUST_SWEEP", qty=sweep, free_base=fb, long_held=round(long_held, 6))
                place(bx, "SWEEP", "SELL", sweep, "AUTO_REPAY", {})
            else:
                jlog("DUST_SUBMIN", free_base=fb, excess=round(excess, 6),
                     note="excess base below MIN_NOTIONAL; cannot sell; tolerated by reconcile")

    # 1) reconcile: exchange holdings vs journal, INTEREST-AWARE and dust-tolerant
    # (finding 19). netAsset nets out borrow+interest, so a single nominal net
    # comparison false-halts as short interest accrues, and a flat book's sub-clip
    # leftover is dust to be swept — not an orphan. Both false-halts deadlock the
    # sweep (which is gated on not-halted), so we check the two sides SEPARATELY:
    #   long side  — free base should equal the journal's long qty (+ sub-clip dust)
    #   short side — exchange debt should be the journal's short nominal PLUS bounded
    #                accrued interest (interest only ADDS; a deficit means a short
    #                vanished and still halts)
    code, acct = bx.isolated_account()
    if code == 200 and not acct.get("dryrun"):
        free_base = borrowed = None
        try:
            b = acct["assets"][0]["baseAsset"]
            free_base = float(b.get("free", 0) or 0)
            borrowed = float(b.get("borrowed", 0) or 0) + float(b.get("interest", 0) or 0)
        except (KeyError, IndexError, ValueError):
            pass
        # MARGIN FLOOR (owner, 2026-08-19). Checked here because this is where the
        # account is already in hand. Inert until the owner sets a floor: with none
        # set nothing is read, journaled as a breach, or halted, so an engine that
        # has never been given a number behaves exactly as before. When a floor IS
        # set and the level cannot be read, we halt rather than trade blind — the
        # same posture as RECONCILE_UNREADABLE below, since a brake that cannot see
        # its own input is not a brake.
        floor = margin_floor()
        if floor > 0:
            try:
                lvl = float(acct["assets"][0].get("marginLevel"))
            except (KeyError, IndexError, TypeError, ValueError):
                lvl = None
            if lvl is None:
                jlog("MARGIN_LEVEL_UNREADABLE", floor=floor)
                set_halt("executor", f"margin level unreadable with a {floor:g} floor set")
            elif lvl <= floor:
                jlog("MARGIN_FLOOR_BREACH", margin_level=lvl, floor=floor)
                set_halt("executor", f"margin level {lvl:.4f} at or below the "
                                     f"{floor:g} floor the owner set")
            else:
                jlog("MARGIN_OK", margin_level=lvl, floor=floor)

        long_qty = sum(p["qty"] for p in st["open"].values() if p["side"] == "LONG")
        short_nominal = sum(p["qty"] for p in st["open"].values() if p["side"] == "SHORT")
        flat = not st["open"]
        if free_base is None or borrowed is None:
            jlog("RECONCILE_UNREADABLE", body=json.dumps(acct)[:200])
        else:
            long_drift = abs(free_base - long_qty)
            short_excess = borrowed - short_nominal
            # DERIVED interest cap: sum over each open short of qty x rate x AGE,
            # not a flat frac of nominal. A short's legitimate excess borrow is the
            # interest it has accrued, which grows with how long it has been open —
            # so the tolerance should too. Age is derived from the stored
            # exit_due_ts (entry = exit_due - HOLD) and clamped to 2x HOLD so a
            # future-dated position or clock glitch cannot inflate the cap. Floored
            # at RECONCILE_TOL and ceiled at the flat MAX_SHORT_INTEREST_FRAC so
            # neither a zero-age nor an absurd-age leg breaks the check.
            derived_cap = 0.0
            for p_ in st["open"].values():
                if p_["side"] != "SHORT":
                    continue
                hold_h_ = p_.get("hold_hours") or HOLD_HOURS
                entry_ts = p_["exit_due_ts"] - hold_h_ * 3600
                age_s = min(max(0.0, now - entry_ts), 2 * hold_h_ * 3600)
                derived_cap += p_["qty"] * MAX_BORROW_RATE_HR * (age_s / 3600.0)
            interest_cap = min(max(RECONCILE_TOL, derived_cap),
                               max(RECONCILE_TOL, short_nominal * MAX_SHORT_INTEREST_FRAC))
            problems = []
            # long side: tolerate un-sellable sub-min-notional dust in EVERY state,
            # not just flat (re-review B2) — the sweep keeps free base ≈ open long
            # holdings by flattening any sellable excess, so what remains is always
            # sub-$5 dust the exchange won't let us sell. A real orphan (>= the $5
            # minimum) is SWEPT (flattened), so it never sits here masked. If the
            # price is unavailable this cycle the tolerance cannot be sized, so
            # DEFER rather than apply the tight tolerance and false-halt on dust.
            if not px:
                jlog("RECONCILE_DEFER", free_base=free_base,
                     reason="no price to size the dust tolerance; long-side check deferred")
            else:
                long_tol = max(RECONCILE_TOL, MIN_NOTIONAL / px * 1.2)
                if long_drift > long_tol:
                    problems.append(f"long base {free_base:.6f} vs journal {long_qty:.6f}")
            # SHORT-SIDE DUST, the mirror of the long-side rule twelve lines up.
            #
            # A MARGIN_BUY sell borrows only what the account cannot already
            # cover: if free base is sitting there, the exchange spends that
            # first and borrows the remainder. So BORROW < SOLD by exactly the
            # base that was present at entry — and the sweep guarantees whatever
            # is present is sub-MIN_NOTIONAL dust it could not sell. That is the
            # SAFE direction: we owe less than nominal, and the economic short
            # is unchanged at the sold quantity.
            #
            # The long side has tolerated exactly this dust since re-review B2.
            # The short side kept the bare one-step tolerance and nobody noticed
            # the asymmetry until it fired: on 2026-08-18 the box held
            # 0.00211675 LTC of un-sellable dust, sold 0.224, borrowed 0.221886,
            # and halted on a 2.1-step shortfall — stopping entries for six
            # hours over $0.09 of dust in the safe direction.
            #
            # Same bound, same reasoning, same DEFER when no price is available
            # to size it: a tolerance that cannot be sized must not fall back to
            # the tight one and false-halt.
            if not px:
                if short_excess < -RECONCILE_TOL:
                    jlog("RECONCILE_DEFER", borrowed=borrowed, short_nominal=round(short_nominal, 6),
                         reason="no price to size the short-side dust tolerance; shortfall check deferred")
            elif short_excess < -max(RECONCILE_TOL, MIN_NOTIONAL / px * 1.2):
                problems.append(f"borrow {borrowed:.6f} below journal shorts {short_nominal:.6f} "
                                f"by more than sub-${MIN_NOTIONAL:g} dust could explain")
            elif short_excess > interest_cap:
                problems.append(f"borrow {borrowed:.6f} exceeds shorts {short_nominal:.6f} beyond interest")
            if problems:
                jlog("RECONCILE_MISMATCH", free_base=free_base, borrowed=borrowed,
                     long_qty=round(long_qty, 6), short_nominal=round(short_nominal, 6),
                     flat=flat, problems=problems)
                set_halt("executor", "reconcile mismatch: " + "; ".join(problems))
            else:
                jlog("RECONCILE_OK", free_base=free_base, borrowed=borrowed,
                     long_qty=round(long_qty, 6), short_nominal=round(short_nominal, 6))
    elif code != 200 and bx.live:
        jlog("RECONCILE_UNREADABLE", http=code, body=json.dumps(acct)[:200])
        set_halt("executor", f"cannot read account (http {code})")

    # 2) kill: cumulative loss, MARK-TO-MARKET. Realized alone is blind to open
    # positions, so several concurrent shorts could bleed unbounded on a rally
    # and never trip the limit (review finding 16). Add the unrealized P&L of
    # every open leg at the current price so the kill sees the true drawdown.
    #
    # R1 rail isolation: F1's box-wide loss kill counts ONLY schema-1 (F1) money —
    # a schema-2 setup's drawdown must never halt F1. Schema-2 real positions get
    # their OWN per-setup mtm kill (per-setup halt), below. When no schema-2 event
    # exists, realized_s1 == realized and the schema-1 legs ARE all legs, so this
    # is byte-identical to the old box-wide kill.
    mtm = st["realized_s1"]
    s2_mtm = dict(st["realized2"])        # setup_id -> realized + open legs
    if px is not None:
        for p in st["open"].values():
            leg = (px - p["entry_price"]) * p["qty"]
            if p["side"] == "SHORT":
                leg = -leg
            sid = p.get("setup_id")
            if sid is None:
                mtm += leg
            else:
                s2_mtm[sid] = s2_mtm.get(sid, 0.0) + leg
    if mtm < -LOSS_LIMIT_USD and not halted():
        set_halt("executor", f"mark-to-market loss {mtm:.2f} "
                             f"(realized {st['realized_s1']:.2f} + open legs) beyond -{LOSS_LIMIT_USD}")
    # per-setup loss kill: a bleeding schema-2 setup halts ONLY itself
    for sid, s2 in s2_mtm.items():
        if s2 < -LOSS_LIMIT_USD and not setup_halted(sid):
            set_setup_halt(sid, f"mark-to-market loss {s2:.2f} beyond -{LOSS_LIMIT_USD}")
    jlog("PNL_MTM", realized=round(st["realized_s1"], 4), mark_to_market=round(mtm, 4),
         open_legs=sum(1 for p in st["open"].values() if p.get("setup_id") is None), price=px)

    # 3) due exits ALWAYS run, halted or not (PILOT-F1.md section 4)
    # Track how many shorts are open across the whole book so the FINAL short
    # close can clear the entire remaining debt — nominal per-leg sizing is
    # interest-blind and pools its unrepaid interest onto whoever closes last
    # (finding 18). A short that is NOT due this run keeps this count above 1,
    # so a due close never repays a still-open sibling's borrow.
    shorts_remaining = sum(1 for q in st["open"].values() if q["side"] == "SHORT")
    stop_pct = fixed_stop_pct()
    for p in sorted(st["open"].values(), key=lambda x: x["exit_due_ts"]):
        # A position exits for one of two reasons: its scheduled hold elapsed, OR
        # the market moved adversely past the hard fixed stop (owner 2026-08-11:
        # every order carries a protective stop against runaway loss). The stop is
        # a fraction of the entry price — a LONG is stopped when price falls BELOW
        # entry*(1-stop), a SHORT when price rises ABOVE entry*(1+stop). The
        # inequality is STRICT (< / >), NOT weak: the tuner sets the stop to the
        # deepest MAE any winner survived, so the binding winner sits EXACTLY on
        # entry*(1-stop). A weak <= would stop that winner out and break the tuner's
        # "preserve every winner" guarantee at marginFrac=0 (STOPMATH BUG 1,
        # 2026-08-11 e2e review); strict spares a position sitting on the boundary
        # and cuts only one that strictly breaches it. Checked at tick resolution
        # against the same market `px` the mtm kill uses; the close fills at market,
        # which may overshoot the level (recorded in FIXED_STOP).
        due = now >= p["exit_due_ts"]
        stop_hit = False
        ep = p.get("entry_price")
        # schema-2 positions carry their OWN stop (per-setup, NEXT-RELEASE 16);
        # None means the setup runs stopless regardless of the box-global env.
        # Schema-1 positions (no stop_pct key) keep the global exactly as before.
        eff_stop = p["stop_pct"] if "stop_pct" in p and p.get("setup_id") is not None else stop_pct
        if eff_stop and px is not None and ep:
            stop_hit = (px < ep * (1 - eff_stop)) if p["side"] == "LONG" \
                else (px > ep * (1 + eff_stop))
        if not (due or stop_hit):
            continue
        exit_reason = "scheduled" if due else "fixed_stop"
        if stop_hit and not due:
            adverse = ((ep - px) / ep) if p["side"] == "LONG" else ((px - ep) / ep)
            jlog("FIXED_STOP", chunk_start=p["chunk_start"], side=p["side"],
                 entry_price=ep, price=px, stop_pct=eff_stop,
                 adverse_pct=round(adverse, 5),
                 **({"setup_id": p["setup_id"]} if p.get("setup_id") else {}))
        overdue_h = (now - p["exit_due_ts"]) / 3600
        if due and overdue_h > 0.5:
            jlog("EXIT_OVERDUE", chunk_start=p["chunk_start"],
                 overdue_hours=round(overdue_h, 2),
                 # R12: carry setup_id so the generalized rail's alerter (live-alert.sh)
                 # can see/attribute a schema-2 incident, and the F1 alerter's R6 filter
                 # skips it. Absent on schema-1 -> F1 alerter handles it, unchanged.
                 **({"setup_id": p["setup_id"]} if p.get("setup_id") else {}))
        if p["side"] == "LONG":
            # Size from THIS position (p['qty']), never the wallet. Isolated
            # margin pools all longs in one balance, so selling free_base() would
            # dump every concurrent long at once. free_base is only a cap, so a
            # fee-shrunk balance still can't oversell. (Fatal bug caught by the
            # 2026-08-11 money-math review — the dust never exposed it because it
            # only ever had one position open.)
            fb = bx.free_base()
            sell_qty = floor_step(min(p["qty"], fb) if fb is not None else p["qty"])
            if not sell_qty:
                jlog("EXIT_SKIPPED", chunk_start=p["chunk_start"],
                     reason="no free base to sell")
                continue
            status, fill_px, fee, fq, _ = place(bx, "EXIT", "SELL", sell_qty, "AUTO_REPAY",
                                                {"chunk_start": p["chunk_start"],
                                                 **({"setup_id": p["setup_id"]} if p.get("setup_id") else {})},
                                                cid=client_id("exit", p["chunk_start"], p.get("setup_id")))
            qty_traded = sell_qty
        else:  # SHORT: buy back the borrow plus a small buffer for the LTC fee.
            is_last_short = (shorts_remaining <= 1)
            debt = bx.borrowed_base()
            if debt is not None:
                if debt < QTY_STEP:
                    # no loan outstanding — the short is already flat on the
                    # exchange. Buying anyway (AUTO_REPAY with nothing to repay)
                    # would open a naked LONG. Skip and let reconcile surface it.
                    jlog("EXIT_SKIPPED", chunk_start=p["chunk_start"],
                         reason="no borrow outstanding to repay")
                    continue
                if is_last_short:
                    # the ONLY open short: clear the ENTIRE remaining debt, which
                    # is this leg's nominal PLUS all interest that accrued and
                    # pooled onto the final close. Sized from LIVE debt, so it is
                    # correct regardless of the interest rate (finding 18). The
                    # buffer now covers only the ~0.1% taker fee.
                    buy_qty = ceil_step(debt * (1 + SHORT_CLOSE_FEE_BUFFER))
                else:
                    # a sibling short is still open: repay only THIS leg's share
                    # (nominal + buffer), never the whole pool, capped by debt.
                    buy_qty = min(ceil_step(p["qty"] * (1 + SHORT_CLOSE_FEE_BUFFER)),
                                  ceil_step(debt * (1 + SHORT_CLOSE_FEE_BUFFER)))
            else:
                buy_qty = ceil_step(p["qty"] * (1 + SHORT_CLOSE_FEE_BUFFER))
            status, fill_px, fee, fq, _ = place(bx, "EXIT", "BUY", buy_qty, "AUTO_REPAY",
                                                {"chunk_start": p["chunk_start"], "leg_qty": p["qty"],
                                                 **({"setup_id": p["setup_id"]} if p.get("setup_id") else {})},
                                                cid=client_id("exit", p["chunk_start"], p.get("setup_id")))
            qty_traded = p["qty"]  # economic size of the short, for P&L
        if status == "filled":
            # Book from the FILL price, NOT the loop's market `px` — `px` is the
            # single market quote used by the fixed-stop check for EVERY position
            # this run, so it must not be shadowed by an exit fill (re-review: a
            # prior exit returning None was disabling later positions' stops).
            gross = (fill_px - p["entry_price"]) * qty_traded
            if p["side"] == "SHORT":
                gross = -gross
            # cost accounting (finding 17 + re-review money-math): subtract the
            # ENTRY-leg fee on BOTH sides. It was wrong to skip it for a LONG on
            # the theory that the LTC entry fee is "already in the fee-shrunk qty":
            # the shrink lowers the exit-proceeds basis AND the entry cost basis
            # by the same amount, so it cancels out of `gross` and the entry fee
            # ends up entirely UNACCOUNTED — realized P&L (the tradeability
            # number) was overstated by one entry fee per long round-trip. A short
            # additionally carries accrued interest — the extra LTC bought beyond
            # nominal to clear the debt, valued at close, booked on the FINAL short
            # where the pooled interest lands.
            entry_fee = p.get("entry_fee", 0.0)
            interest_cost = 0.0
            if p["side"] == "SHORT":
                shorts_remaining -= 1
                # Residual assertion on EVERY short close (re-review): the
                # AUTO_REPAY must actually REDUCE the borrow by ~this leg's size. A
                # repay that silently fails, or an outsized fee eating the received
                # qty, leaves debt still accruing — that must HALT, not pass quietly.
                # (The final leg is additionally required to clear the pool to ~0.)
                resid = bx.borrowed_base()
                if debt is not None and resid is not None:
                    repaid = debt - resid
                    if repaid < p["qty"] * (1 - RESIDUAL_REPAY_TOL_FRAC):
                        set_halt("executor", f"short close for {p['chunk_start']} repaid "
                                 f"only {repaid:.6f} of leg {p['qty']:.6f} — borrow "
                                 f"{resid:.6f} still outstanding and accruing interest")
                if is_last_short and debt is not None:
                    interest_cost = max(0.0, debt - p["qty"]) * fill_px
                    if resid is not None and resid >= QTY_STEP:
                        set_halt("executor", f"short close for {p['chunk_start']} left "
                                 f"residual borrow {resid:.6f} after the final leg — "
                                 "under-repaid; borrow still accruing interest")
            jlog("EXIT_FILL", chunk_start=p["chunk_start"], side=p["side"],
                 qty=qty_traded, price=fill_px, fee_quote=fee, entry_fee=entry_fee,
                 interest_cost=round(interest_cost, 6), reason=exit_reason,
                 pnl=round(gross - fee - entry_fee - interest_cost, 4),
                 **({"setup_id": p["setup_id"]} if p.get("setup_id") else {}))
        elif status == "unknown":
            # transport error: the close MAY have filled. Do not halt or retry
            # blind — recovery resolves it by client id next run.
            jlog("EXIT_INFLIGHT", chunk_start=p["chunk_start"], side=p["side"])
        else:  # rejected
            # An exit that will not fill is serious: the position stays open and
            # exposed. Surface it immediately (halt new entries; exits keep
            # retrying next run) rather than waiting for the 3-reject kill. A
            # likely cause on tiny clips is MIN_NOTIONAL after an adverse move —
            # the position is worth under $5 and cannot be market-closed.
            # R1: a schema-2 exit reject halts only its OWN setup's new entries;
            # F1 is untouched. Its own exits keep retrying (exits are never gated).
            reason = (f"EXIT for {p['chunk_start']} ({p['side']}) did not fill — see "
                      "ORDER_REJECT; if min-notional, the position is under $5 and "
                      "needs manual handling")
            if p.get("setup_id") is not None:
                set_setup_halt(p["setup_id"], reason)
            else:
                set_halt("executor", reason)

    # 3b) PAPER exits — the paper twin follows the identical schedule/stop
    # rules, marks at the same market px, and journals PAPER_EXIT_FILL. No
    # orders, no balances; runs in EVERY arm/halt state exactly like real
    # exits so a paper book can never silently stop measuring. Fees at the
    # model's own per-leg rate (PAPER_FEE_RATE) so paper == the lab's promise.
    for p in sorted(st["paper_open"].values(), key=lambda x: x["exit_due_ts"]):
        due = now >= p["exit_due_ts"]
        stop_hit = False
        ep = p.get("entry_price")
        psp = p.get("stop_pct")
        if psp and px is not None and ep:
            stop_hit = (px < ep * (1 - psp)) if p["side"] == "LONG" \
                else (px > ep * (1 + psp))
        if not (due or stop_hit):
            continue
        if px is None:
            jlog("PAPER_EXIT_DEFERRED", chunk_start=p["chunk_start"],
                 setup_id=p.get("setup_id"), reason="no price this run")
            continue
        gross = (px - ep) * p["qty"]
        if p["side"] == "SHORT":
            gross = -gross
        fees = PAPER_FEE_RATE * p["qty"] * (ep + px)  # both legs at the model rate
        jlog("PAPER_EXIT_FILL", chunk_start=p["chunk_start"], setup_id=p.get("setup_id"),
             side=p["side"], qty=p["qty"], price=px,
             reason=("scheduled" if due else "fixed_stop"),
             pnl=round(gross - fees, 4))

    # 4) fresh intents -> new entries. REAL entries need the master switch ON and
    # no halt; PAPER entries are pure MEASUREMENT (no orders) and book in EVERY
    # arm/halt state, exactly like the paper EXITS above — so a disarmed, halted or
    # reject-killed box can never silently stop the paper books measuring (R8).
    st = derive(journal_events())  # refresh after exits
    # one status line per run so the live screen always shows current state,
    # even on a quiet day with no orders
    jlog("RUN_STATUS", armed=armed(), halted=halted(),
         open=len(st["open"]), realized=round(st["realized"], 4), live=bx.live,
         open_paper=len(st["paper_open"]),
         paper_realized=round(st["paper_realized"], 4),
         arm_secret=bool(load_env().get("PILOT_ARM_SECRET", "")),
         fixed_stop_pct=stop_pct,
         # what the BOX is actually enforcing, not what was requested — the screen
         # reports the brake in force, exactly as it does for the stop above.
         margin_floor=margin_floor())
    # real_blocked gates only the REAL rail; paper intents proceed below. The reason
    # strings and the dead-man ARM_STALE emission are unchanged from the old
    # early-returns, so a disarmed/halted F1 box behaves byte-identically (it has no
    # paper intents, and its real intents are left untouched by the light gate).
    real_blocked = False
    if not armed():
        if arm_present():
            jlog("ARM_STALE", reason="dead-man: ARM not refreshed within "
                 f"{ARM_MAX_AGE_S}s — control plane lost contact; self-disarmed")
            jlog("ENTRIES_SKIPPED", reason="master switch STALE (dead-man tripped)")
        else:
            jlog("ENTRIES_SKIPPED", reason="master switch OFF (owner has not pressed START)")
        real_blocked = True
    elif halted():
        jlog("ENTRIES_SKIPPED", reason="halt flag set")
        real_blocked = True
    elif st["consecutive_rejects"] >= REJECT_LIMIT:
        set_halt("executor", f"{st['consecutive_rejects']} consecutive rejects")
        real_blocked = True

    os.makedirs(INTENTS, exist_ok=True)
    # ONE attempt per period per run. The producer keeps re-emitting an intent for
    # up to ENTRY_FRESH_H after the entry moment (new filename each time), and the
    # box now KEEPS a failed intent for retry — so two files for the same period
    # can sit in the inbox together. Without this, both would be attempted inside a
    # single tick and the six attempts would be spent in one or two ticks instead of
    # over the hour the owner asked for. (The venue would not double-fill either
    # way: place() signs both with the same client_id.)
    attempted_this_run = set()
    for name in sorted(os.listdir(INTENTS)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(INTENTS, name)
        try:
            with open(path) as fh:
                it = json.load(fh)
        except (json.JSONDecodeError, OSError) as e:
            # BLOCKER 2 (F1 byte-identity): while the REAL rail is blocked the old
            # pre-loop early-return touched NOTHING. A parse failure here could be a
            # torn/corrupt REAL (F1) intent; setting it aside (.bad) while disarmed/
            # halted would consume a period the box must leave for a later armed run.
            # So while blocked, leave it untouched and retry next run.
            if real_blocked:
                continue
            jlog("INTENT_INVALID", file=name, error=str(e)[:100])
            # never let a file that vanished mid-run (a control-plane race between
            # listdir and rename) raise and abort the whole run — that would skip
            # F1's own scheduled exits.
            try:
                os.rename(path, path + ".bad")
            except OSError:
                pass
            continue
        # R8: when the REAL rail is blocked (disarmed / halted / reject-killed), a
        # REAL intent is LEFT UNTOUCHED for a later armed run — byte-identical to the
        # old pre-loop early-return, which validated and consumed nothing. A PAPER
        # intent proceeds (it places no order, so it measures in every state).
        # Paper-ness is read from the allowlist here, BEFORE validation, so a blocked
        # real intent gets no side effects (no .bad/.dup rename, no INTENT_* events).
        if real_blocked:
            _is2 = it.get("schema") == 2
            _allow = setups_allow().get(it.get("setup_id")) if _is2 else None
            _eff_paper = _is2 and (bool(it.get("paper"))
                                   or (isinstance(_allow, dict) and _allow.get("state") != "live"))
            # BLOCKER 1: with schema-2 paper-only on the F1 box, a would-be-real
            # schema-2 intent is effectively paper here, so it still MEASURES while
            # the real rail is blocked (R8) rather than being skipped as if real.
            if _is2 and not S2_LIVE_ROUTING:
                _eff_paper = True
            if not _eff_paper:
                continue
        # mechanical validation -- every failure is journaled and the file
        # is set aside; nothing is ever "interpreted"
        problems = []
        is2 = it.get("schema") == 2
        # R1: a per-setup-halted schema-2 setup skips its OWN entries only (never
        # F1, never other setups) — the same posture the box halt gives F1. Set
        # aside the intent (the window passes anyway); the SETUP_HALT_SET journal
        # event and the halt file flag it for owner attention.
        if is2 and isinstance(it.get("setup_id"), str) and setup_halted(it["setup_id"]):
            jlog("ENTRY_SKIPPED", chunk_start=it.get("chunk_start"), setup_id=it["setup_id"],
                 reason="setup halted")
            os.rename(path, path + ".bad")
            continue
        if it.get("schema") not in (1, 2): problems.append("schema")
        if it.get("symbol") != SYMBOL: problems.append("symbol")
        if it.get("side") not in ("LONG", "SHORT", "FLAT"): problems.append("side")
        if not isinstance(it.get("chunk_start"), str): problems.append("chunk_start")
        if not isinstance(it.get("decision_price"), (int, float)): problems.append("decision_price")
        allow_entry = None
        if is2:
            # schema-2 (generalized setups, IMPLEMENTATION-PLAN 3.1): the intent
            # carries its execution params, and the box CROSS-CHECKS them against
            # its own allowlist — a compromised control plane cannot resize a clip
            # or point a setup at a symbol this box was never told to serve.
            if not isinstance(it.get("setup_id"), str) or not it.get("setup_id"):
                problems.append("setup_id")
            if not isinstance(it.get("clip_usd"), (int, float)) or it.get("clip_usd", 0) <= 0:
                problems.append("clip_usd")
            if not isinstance(it.get("hold_hours"), (int, float)) or it.get("hold_hours", 0) <= 0:
                problems.append("hold_hours")
            if not isinstance(it.get("paper"), bool):
                problems.append("paper")
            sp = it.get("stop_pct")
            if sp is not None and (not isinstance(sp, (int, float)) or sp <= 0 or sp >= 1):
                problems.append("stop_pct")
            if not problems:
                allow_entry = setups_allow().get(it["setup_id"])
                if not isinstance(allow_entry, dict):
                    problems.append("allowlist")          # fail-closed: unknown setup
                else:
                    if allow_entry.get("symbol") != it.get("symbol"):
                        problems.append("allowlist_symbol")
                    cap = allow_entry.get("max_clip_usd")
                    if not isinstance(cap, (int, float)) or it["clip_usd"] > cap:
                        problems.append("clip_cap")
                    # R5: the allowlist bounds the hold so a tampered/buggy intent
                    # cannot hold a real position indefinitely.
                    hcap = allow_entry.get("max_hold_hours")
                    if isinstance(hcap, (int, float)) and it["hold_hours"] > hcap:
                        problems.append("hold_cap")
        # age against EXCHANGE-synced time, not the raw OS clock (finding 3).
        # The bound is the ENTRY RETRY WINDOW (owner 2026-08-16): an entry stays
        # attemptable for one hour past its moment so six 10-minute ticks can try
        # it, where before it died after 30 minutes and three. A FLAT intent places
        # no order, so it keeps the old 30-minute bound — widening it would only
        # let a stale no-op sit around longer.
        age = now_exch - it.get("ts", 0)
        if it.get("side") in ("LONG", "SHORT"):
            stale = now_exch > entry_deadline(it)
        else:
            stale = age > INTENT_MAX_AGE_S
        if stale:
            # LOUD: a systemic clock drift would otherwise discard every intent to
            # .bad and stop all entries with nothing on the screen. Emit a distinct
            # incident the alert timer emails on, instead of a silent INTENT_INVALID.
            jlog("INTENT_STALE", file=name, chunk_start=it.get("chunk_start"),
                 age_s=int(age), intent_ts=it.get("ts"),
                 now_exchange=round(now_exch, 3), offset_ms=bx.offset_ms,
                 # R12: attribute a schema-2 stale/invalid intent to its setup so the
                 # generalized rail's alerter sees it and the F1 alerter's R6 filter
                 # skips it (schema-1 keeps no setup_id -> F1 alerter, unchanged).
                 **({"setup_id": it.get("setup_id")} if is2 and it.get("setup_id") else {}))
        if problems or stale:
            jlog("INTENT_INVALID", file=name,
                 problems=problems + ([f"stale({int(age)}s)"] if stale else []),
                 **({"setup_id": it.get("setup_id")} if is2 and it.get("setup_id") else {}))
            os.rename(path, path + ".bad")
            continue
        events_now = journal_events()
        sid = it["setup_id"] if is2 else None
        # A period that FINISHED is a duplicate — filled, in flight, drift-killed or
        # given up. A period that merely STARTED (INTENT_SEEN journaled, order not
        # placed) is NOT: that is the retry the owner asked for. Before 2026-08-16
        # the dedup keyed on INTENT_SEEN alone, so one failed attempt was final.
        if entry_terminal(events_now, it["chunk_start"], sid):
            jlog("INTENT_DUPLICATE", chunk_start=it["chunk_start"], file=name,
                 **({"setup_id": it["setup_id"]} if is2 else {}))
            os.rename(path, path + ".dup")
            continue
        # A FLAT period is finished the moment it is recorded — it places no order,
        # so there is nothing to retry. Keeps the old one-shot behaviour for FLAT.
        if it["side"] == "FLAT" and (intent_seen2(events_now, sid, it["chunk_start"]) if is2
                                     else intent_seen(events_now, it["chunk_start"])):
            jlog("INTENT_DUPLICATE", chunk_start=it["chunk_start"], file=name,
                 **({"setup_id": it["setup_id"]} if is2 else {}))
            os.rename(path, path + ".dup")
            continue
        # Retry budget. Counted from ENTRY_ATTEMPT events, so it survives a crash
        # and cannot be reset by a re-shipped intent file.
        period_key = (sid, it["chunk_start"])
        if period_key in attempted_this_run:
            # a sibling file for this period was already handled this tick; leave
            # this one alone (untouched, so the next tick sees it if still needed)
            continue
        attempts = entry_attempts(events_now, it["chunk_start"], sid)
        if it["side"] != "FLAT" and attempts >= ENTRY_MAX_ATTEMPTS:
            # OUT LOUD: the period is abandoned. ENTRY_GAVE_UP is terminal, so a
            # later re-shipped intent for the same period is refused as a duplicate.
            jlog("ENTRY_GAVE_UP", chunk_start=it["chunk_start"], file=name,
                 attempts=attempts, max_attempts=ENTRY_MAX_ATTEMPTS,
                 reason="entry retry budget spent without a fill",
                 **({"setup_id": it["setup_id"]} if is2 else {}))
            os.rename(path, path + ".bad")
            continue
        # R18, now on BOTH rails (owner directive 2026-08-16). A transient failure
        # to read the price must not consume the intent and forfeit the period, so
        # the price is fetched BEFORE INTENT_SEEN and the intent file is left in
        # place for the next tick. This used to be schema-2 only: QC-132 scoped it
        # away from F1 to keep the live pilot byte-identical, and the cost of that
        # was exactly the forfeit the owner has now ruled out. QC-113 is preserved —
        # the arm gate and the finished-period check still precede this. FLAT places
        # no order and needs no price.
        pre_price = None
        if it["side"] != "FLAT":
            pre_price = bx.price()
            if pre_price is None:
                jlog("ENTRY_SKIPPED", chunk_start=it["chunk_start"],
                     reason="no price this run (transient — intent kept for retry)",
                     **({"setup_id": it["setup_id"]} if is2 else {}))
                continue
        # R5: paper-vs-real is decided by the ALLOWLIST, not the intent — a paper
        # setup can NEVER place a real order whatever its own flag says (only a
        # setup the box was told is 'live' can). A live setup honors its intent
        # (normally paper:false). eff_paper is what everything downstream uses.
        # BLOCKER 1 (isolation guard): a would-be-REAL schema-2 order is refused on
        # the F1 box (S2_LIVE_ROUTING False) — it can only share F1's one wallet, so
        # it is booked as PAPER here and the unsupported-live request logged loudly.
        if is2:
            wants_real = (not bool(it.get("paper"))) and allow_entry.get("state") == "live"
            eff_paper = (not wants_real) or (not S2_LIVE_ROUTING)
            if wants_real and not S2_LIVE_ROUTING:
                jlog("S2_LIVE_UNSUPPORTED", chunk_start=it["chunk_start"],
                     setup_id=it["setup_id"],
                     reason="schema-2 live needs per-setup sub-account routing (G8); "
                            "booked PAPER on the F1 box so no real order shares F1's wallet")
        else:
            eff_paper = False
        # INTENT_SEEN is the DECISION record — one per period, on the first attempt
        # only. A retry re-attempts the order, it does not re-decide, so a second
        # INTENT_SEEN would double the row on the screen and reset its fate.
        already_seen = (intent_seen2(events_now, sid, it["chunk_start"]) if is2
                        else intent_seen(events_now, it["chunk_start"]))
        if not already_seen:
            jlog("INTENT_SEEN", chunk_start=it["chunk_start"], side=it["side"],
                 decision_price=it["decision_price"],
                 input_hash=it.get("input_hash", ""),
                 per_member=it.get("per_member"), quorum=it.get("quorum"),
                 file=name,
                 **({"setup_id": it["setup_id"], "paper": eff_paper} if is2 else {}))
        if it["side"] == "FLAT":
            # FLAT is finished the moment it is recorded: nothing to place, nothing
            # to retry. Consume the file exactly as before.
            os.rename(path, path + ".done")
            continue
        # The intent file now stays put until the period reaches a terminal state.
        # Every path below either ends the period (and renames) or leaves the file
        # for the next tick to try again, up to ENTRY_MAX_ATTEMPTS.
        def _finish(suffix=".done"):
            try:
                os.rename(path, path + suffix)
            except OSError:
                pass
        stx = derive(journal_events())
        if is2:
            # R1 per-setup reject-kill: a schema-2 setup that has rejected
            # REJECT_LIMIT times in a row halts ONLY itself, never the box/F1.
            if stx["rejects2"].get(it["setup_id"], 0) >= REJECT_LIMIT:
                set_setup_halt(it["setup_id"],
                               f"{stx['rejects2'][it['setup_id']]} consecutive rejects")
                jlog("ENTRY_SKIPPED", chunk_start=it["chunk_start"], setup_id=it["setup_id"],
                     reason="setup reject-kill")
                _finish(".bad")   # terminal: the setup is halted, not retryable
                continue
            # per-SETUP concurrency: this setup's own open (or paper) positions
            # against its allowlisted cap; default = the schema-1 derivation
            # (hold / daily step).
            book = stx["paper_open"] if eff_paper else stx["open"]
            mine = sum(1 for p in book.values() if p.get("setup_id") == it["setup_id"])
            cap = allow_entry.get("max_concurrent")
            if not isinstance(cap, int) or cap < 1:
                cap = max(1, math.ceil(it["hold_hours"] / 24.0))
            if mine >= cap:
                jlog("ENTRY_SKIPPED", chunk_start=it["chunk_start"], setup_id=it["setup_id"],
                     reason=f"setup concurrency cap {cap}")
                _finish(".bad")   # terminal: a hold outlives the retry window
                continue
        # R2: F1's box-wide REAL-position cap (MAX_CONCURRENT = 137h/24h) counts
        # ONLY schema-1 (F1) positions and applies ONLY to F1 entries — a schema-2
        # real position must never crowd out an F1 entry the model called. Schema-2
        # real setups are bounded by their own per-setup allowlist cap (above);
        # paper positions hold nothing. When no schema-2 real position is open this
        # is byte-identical to the old box-wide cap.
        if not is2:
            s1_open = sum(1 for p in stx["open"].values() if p.get("setup_id") is None)
            if s1_open >= MAX_CONCURRENT:
                jlog("ENTRY_SKIPPED", chunk_start=it["chunk_start"],
                     reason=f"concurrency cap {MAX_CONCURRENT}")
                _finish(".bad")   # terminal: a 137h hold outlives the retry window
                continue
        # Reuse the price fetched before INTENT_SEEN (same run) so the value that
        # was present at the transient guard is the one the order uses — never
        # re-fetched into a None. Both rails, since 2026-08-16. Non-FLAT reaches here.
        price = pre_price
        if price is None:
            # Belt and braces: the guard above already `continue`d on a None price,
            # so reaching here means a code path changed. Retryable, file kept.
            jlog("ENTRY_SKIPPED", chunk_start=it["chunk_start"],
                 reason="no price")
            continue
        dev = abs(price - it["decision_price"]) / it["decision_price"]
        if is2 and eff_paper:
            # PAPER FILL (NEXT-RELEASE point 15): identical decision path, no
            # order — the fill IS the current market price, fees at the model's
            # own per-leg rate so paper matches what the lab promised. Deviation
            # recorded for fidelity; the drift kill is for real money only (a
            # paper measurement must never halt the live box).
            hold_s = int(it["hold_hours"] * 3600)
            qty2 = clip_qty_usd(price, it["clip_usd"])
            if qty2 is None:
                jlog("ENTRY_SKIPPED", chunk_start=it["chunk_start"], setup_id=it["setup_id"],
                     reason="clip under exchange minimum")
                continue
            jlog("PAPER_ENTRY_FILL", chunk_start=it["chunk_start"], setup_id=it["setup_id"],
                 side=it["side"], qty=qty2, price=price,
                 decision_price=it["decision_price"],
                 fill_deviation=round(dev, 5),
                 clip_usd=it["clip_usd"], hold_hours=it["hold_hours"],
                 stop_pct=it.get("stop_pct"),
                 exit_due_ts=now + hold_s)
            _finish()          # terminal: the paper position exists
            continue
        if dev > FILL_DEV_LIMIT:
            jlog("KILL_PRICE_DRIFT", chunk_start=it["chunk_start"],
                 decision=it["decision_price"], market=price,
                 deviation=round(dev, 5),
                 **({"setup_id": it["setup_id"]} if is2 else {}))
            _finish(".bad")    # terminal: a refusal on purpose, never retried
            if is2:
                # R1: a schema-2 drift halts only its OWN setup and moves on — F1
                # and other setups keep trading (never the box break/halt).
                set_setup_halt(it["setup_id"],
                               f"market {dev:.2%} from decision price before order")
                continue
            set_halt("executor", f"market {dev:.2%} from decision price "
                                 "before order; entries halted")
            break
        qty = clip_qty_usd(price, it["clip_usd"]) if is2 else clip_qty(price)
        if qty is None:
            # Price-dependent, so a later tick inside the window may clear it. No
            # order was attempted, so no attempt is burned; the file stays.
            jlog("ENTRY_SKIPPED", chunk_start=it["chunk_start"],
                 reason="clip under exchange minimum (transient — intent kept for retry)",
                 **({"setup_id": it["setup_id"]} if is2 else {}))
            continue
        buy_side = "BUY" if it["side"] == "LONG" else "SELL"
        side_eff = "NO_SIDE_EFFECT" if it["side"] == "LONG" else "MARGIN_BUY"
        # Journal the attempt BEFORE the order leaves the box, so a crash between
        # send and journal still spends the attempt. Over-counting an attempt costs
        # one retry; under-counting could loop an order at the venue all hour.
        attempt_no = attempts + 1
        attempted_this_run.add(period_key)
        jlog("ENTRY_ATTEMPT", chunk_start=it["chunk_start"], side=it["side"],
             attempt=attempt_no, max_attempts=ENTRY_MAX_ATTEMPTS,
             deadline_utc=_utc_str(entry_deadline(it)),
             **({"setup_id": it["setup_id"]} if is2 else {}))
        status, px, fee, fq, base_comm = place(bx, "ENTRY", buy_side, qty, side_eff,
                                               {"chunk_start": it["chunk_start"],
                                                "pos_side": it["side"],
                                                # R4: schema-2 riders ride in the ORDER_SENT meta so a
                                                # crash-recovered entry books its OWN hold/stop/clip,
                                                # never F1's 137h/stopless default (the recovery reader
                                                # in resolve_dangling already expects these keys).
                                                **({"setup_id": it["setup_id"], "hold_hours": it["hold_hours"],
                                                    "stop_pct": it.get("stop_pct"), "clip_usd": it["clip_usd"]} if is2 else {})},
                                               cid=client_id("entry", it["chunk_start"],
                                                             it["setup_id"] if is2 else None))
        if status == "unknown":
            # transport error: the entry MAY have filled. Leave it for recovery
            # (which resolves by client id and, if filled, books ENTRY_FILL with
            # the right exit_due_ts). Do NOT record a position or a reject here.
            jlog("ENTRY_INFLIGHT", chunk_start=it["chunk_start"], side=it["side"],
                 **({"setup_id": it["setup_id"]} if is2 else {}))
            # TERMINAL, and this is the important one: the order may be live at the
            # venue. Recovery resolves it by client id. Re-attempting behind recovery
            # is the single path that could double a real position, so it never runs.
            _finish()
        elif status == "filled":
            # store what the EXIT will act on, UNFLOORED so it matches the
            # exchange balance for reconcile across many concurrent positions
            # (flooring each one drifts expect below actual and false-halts —
            # review finding). The exit floors only at order time. Long: base
            # held after the LTC buy fee; short: borrowed amount to repay.
            if it["side"] == "LONG":
                held = round((fq or qty) - base_comm, 8)
            else:
                held = fq or qty
            fill_dev = abs(px - it["decision_price"]) / it["decision_price"]
            hold_s = int(it["hold_hours"] * 3600) if is2 else HOLD_HOURS * 3600
            jlog("ENTRY_FILL", chunk_start=it["chunk_start"], side=it["side"],
                 qty=held, ordered_qty=qty, price=px, fee_quote=fee,
                 decision_price=it["decision_price"],
                 fill_deviation=round(fill_dev, 5),
                 exit_due_ts=now + hold_s,
                 **({"setup_id": it["setup_id"], "hold_hours": it["hold_hours"],
                     "stop_pct": it.get("stop_pct"), "clip_usd": it["clip_usd"]} if is2 else {}))
            _finish()          # terminal: the position exists
            if fill_dev > FILL_DEV_LIMIT:
                if is2:
                    # R1: a schema-2 catastrophic fill deviation halts only its
                    # own setup, never F1.
                    set_setup_halt(it["setup_id"], f"fill deviated {fill_dev:.2%} "
                                   "from decision price")
                else:
                    set_halt("executor", f"fill deviated {fill_dev:.2%} "
                                         "from decision price")

    # 5) balance snapshot for the screen — only when the REAL rail was active, so a
    # disarmed/halted run returns here exactly as the old early-returns did (paper
    # entries above already booked; a blocked run journals no BALANCE).
    if not real_blocked:
        code, acct = bx.isolated_account()
        if code == 200 and not acct.get("dryrun"):
            try:
                a = acct["assets"][0]
                # margin_level is collateral/debt on this isolated wallet: the
                # distance to a forced liquidation, and on a borrow-to-short
                # engine the number that says how much adverse move the account
                # survives. It has ALWAYS been in this response, one field from
                # the four below, and was never recorded — so the screen could
                # not show it and the owner had to ask a session to read it over
                # ssh (owner, 2026-08-19). Recorded so it is a number they see.
                jlog("BALANCE", base_net=a["baseAsset"]["netAsset"],
                     base_free=a["baseAsset"]["free"],
                     quote_free=a["quoteAsset"]["free"],
                     quote_net=a["quoteAsset"]["netAsset"],
                     margin_level=a.get("marginLevel"))
            except (KeyError, IndexError):
                pass
    return 0


# ---- dust mode ---------------------------------------------------------------
def do_dust(bx, yes):
    """One $10 buy -> sell round trip. Plumbing only (PILOT-F1.md gate 4)."""
    st = derive(journal_events())
    if st["dust_done"]:
        print("dust trade already recorded; refusing to repeat")
        return 1
    if halted():
        print("HALT flag set; refusing")
        return 1
    if bx.live and not yes:
        print("LIVE=1 but --yes missing; refusing")
        return 1
    price = bx.price()
    if price is None:
        print("no price; aborting")
        return 1
    qty = clip_qty(price)
    if qty is None:
        print("clip under exchange minimum; aborting")
        return 1
    jlog("DUST_START", price=price, qty=qty, live=bx.live)
    ok1, px1, fee1, fq1, bc1 = place(bx, "DUST_BUY", "BUY", qty, "NO_SIDE_EFFECT", {}, cid=client_id("dustbuy", "dust"))
    if ok1 != "filled":
        jlog("DUST_ABORT", stage="buy")
        return 1
    time.sleep(2)
    # sell what we actually received: bought qty minus the LTC-denominated fee,
    # floored to the lot step. Prefer the real free balance if we can read it.
    fb = bx.free_base()
    sell_qty = floor_step(fb if fb is not None else (fq1 or qty) - bc1)
    ok2, px2, fee2, fq2, _ = place(bx, "DUST_SELL", "SELL", sell_qty, "AUTO_REPAY", {}, cid=client_id("dustsell", "dust"))
    if ok2 != "filled":
        jlog("DUST_ABORT", stage="sell",
             note="BOUGHT BUT NOT SOLD -- position open, reconcile will see it")
        return 1
    jlog("DUST_DONE", buy_price=px1, sell_price=px2, buy_qty=qty, sell_qty=sell_qty,
         fees=round(fee1 + fee2, 6),
         round_trip_cost=round(px1 * qty - px2 * sell_qty + fee1 + fee2, 6))
    return 0


# ---- short dust mode ---------------------------------------------------------
def do_shortdust(bx, yes):
    """One $10 SHORT round trip: open (SELL + auto-borrow) -> close (BUY +
    auto-repay). Proves the short path the long dust never touched, and — the
    reason it exists — that the close FULLY repays the borrow despite the LTC
    buy fee. Plumbing only; P&L void."""
    st = derive(journal_events())
    if st["shortdust_done"]:
        print("short dust already recorded; refusing to repeat")
        return 1
    if halted():
        print("HALT flag set; refusing")
        return 1
    if bx.live and not yes:
        print("LIVE=1 but --yes missing; refusing")
        return 1
    price = bx.price()
    if price is None:
        print("no price; aborting")
        return 1
    qty = clip_qty(price)
    if qty is None:
        print("clip under exchange minimum; aborting")
        return 1
    jlog("SHORTDUST_START", price=price, qty=qty, live=bx.live)
    ok1, px1, fee1, fq1, _ = place(bx, "SHORTDUST_SELL", "SELL", qty, "MARGIN_BUY", {}, cid=client_id("sdsell", "sdust"))
    if ok1 != "filled":
        jlog("SHORTDUST_ABORT", stage="open")
        return 1
    time.sleep(2)
    debt = bx.borrowed_base()
    need = debt if debt is not None else (fq1 or qty)
    buy_qty = ceil_step(max(need, qty) * (1 + SHORT_CLOSE_FEE_BUFFER))
    ok2, px2, fee2, fq2, _ = place(bx, "SHORTDUST_BUY", "BUY", buy_qty, "AUTO_REPAY", {}, cid=client_id("sdbuy", "sdust"))
    if ok2 != "filled":
        jlog("SHORTDUST_ABORT", stage="close",
             note="SOLD-SHORT BUT NOT REPAID -- borrow open, reconcile will see it")
        return 1
    resid = bx.borrowed_base()
    jlog("SHORTDUST_DONE", open_price=px1, close_price=px2, qty=qty, buy_qty=buy_qty,
         borrowed=need, residual_borrow=resid,
         fully_repaid=(resid is not None and resid < QTY_STEP),
         fees=round(fee1 + fee2, 6),
         round_trip_cost=round(px2 * buy_qty - px1 * qty + fee1 + fee2, 6))
    return 0


# ---- status ------------------------------------------------------------------
def do_status():
    st = derive(journal_events())
    print(json.dumps({
        "armed": armed(),
        "halted": halted(),
        "halt_info": open(HALT).read() if halted() else None,
        "open_positions": list(st["open"].values()),
        "realized_pnl": round(st["realized"], 4),
        "consecutive_rejects": st["consecutive_rejects"],
        "dust_done": st["dust_done"],
        "shortdust_done": st["shortdust_done"],
        "journal_lines": len(journal_events()),
    }, indent=2))
    return 0


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "status"
    env = load_env()
    bx = Binance(env)
    if mode == "run":
        return do_run(bx)
    if mode == "dust":
        return do_dust(bx, "--yes" in sys.argv)
    if mode == "shortdust":
        return do_shortdust(bx, "--yes" in sys.argv)
    if mode == "arm":
        # Judge freshness against EXCHANGE time, not the box OS clock (re-review A1):
        # sync best-effort, then hand honor_arm_request the exchange-adjusted now so
        # a skewed box clock cannot silently refuse a legitimate START. On a failed
        # sync offset_ms stays 0 → falls back to the OS clock (prior behavior).
        bx.sync_clock()
        exch_now = time.time() + bx.offset_ms / 1000.0
        honor_arm_request(True, source_arg(), arg_val("--nonce"), arg_val("--utc"),
                          arg_val("--hmac"), now_s=exch_now)
        print("arm request processed (armed iff authenticated + fresh new nonce)")
        return 0
    if mode == "disarm":
        honor_arm_request(False, source_arg(), arg_val("--nonce"), arg_val("--utc"),
                          arg_val("--hmac"))
        print("DISARMED (master switch OFF)")
        return 0
    if mode == "halt":
        # emergency stop, settable from the control plane (e.g. the VPS mirror
        # check on a MIRROR_BREAK). Blocks NEW entries; scheduled exits still run.
        set_halt(source_arg(), reason_arg() or "manual halt")
        print("HALTED (new entries stopped; scheduled exits still run)")
        return 0
    if mode == "unhalt":
        # clear the HALT flag after the cause has been examined/resolved. A halt
        # never self-clears (gates judge the instrument), so this is the explicit
        # recovery lever — e.g. after fixing the reconcile dust deadlock. The
        # owner reaches it from the Trading tab; the control plane carries the
        # SIGNED request here. See honor_unhalt_request for why this direction
        # is authenticated where disarm deliberately is not.
        honor_unhalt_request(source_arg(), arg_val("--nonce"), arg_val("--utc"),
                             arg_val("--hmac"), reason_arg(), force=("--force" in sys.argv))
        return 0
    if mode == "status":
        return do_status()
    print(f"unknown mode {mode}; use run|dust|shortdust|arm|disarm|halt|unhalt|status")
    return 2


def source_arg():
    for a in sys.argv:
        if a.startswith("--source="):
            return a.split("=", 1)[1]
    return "unknown"


def reason_arg():
    for a in sys.argv:
        if a.startswith("--reason="):
            return a.split("=", 1)[1]
    return ""


def arg_val(flag):
    """Return the value of --flag=value, or None. A placeholder '-' (used by the
    push script when a field is absent) reads as None."""
    pre = flag + "="
    for a in sys.argv:
        if a.startswith(pre):
            v = a.split("=", 1)[1]
            return None if v in ("", "-") else v
    return None


if __name__ == "__main__":
    sys.exit(main())
