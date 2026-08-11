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
CLOCK_DRIFT_LIMIT_MS = 5000 # box OS clock this far from exchange time -> loud
ARM_MAX_AGE_S = 1800       # dead-man: ARM must be re-stamped by the control plane
                           # within 30 min (sync runs ~every 5 min) or the box
                           # self-disarms — a fail-safe kill on control-plane loss
RECV_WINDOW = 10000
FILL_DEV_LIMIT = 0.010     # kill: fill >1.0% from decision price (GUESSED)
REJECT_LIMIT = 3           # kill: 3 consecutive rejects (GUESSED)
LOSS_LIMIT_USD = 50.0      # kill: cumulative pilot loss (GUESSED)
RECONCILE_TOL = QTY_STEP   # 1 lot step of drift tolerated

HOME = os.path.expanduser("~")
PILOT = os.path.join(HOME, "pilot")
JOURNAL = os.path.join(PILOT, "journal.jsonl")
INTENTS = os.path.join(PILOT, "intents")
HALT = os.path.join(PILOT, "HALT")
# ARM is the owner's MASTER SWITCH. No new position opens unless this file is
# present (owner pressed START on the live screen). It is the inverse of HALT:
# HALT is an emergency stop, ARM is "the engine is running because I said so".
# Absent by default, so a fresh box, a redeploy, or a wiped disk all come up
# STOPPED. Like HALT, ARM never blocks a scheduled EXIT -- stopping the engine
# means "open nothing new", never "abandon an open position".
ARM = os.path.join(PILOT, "ARM")
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
def derive(events):
    """Replay the journal into current state. Positions are keyed by
    chunk_start so one period can never open twice."""
    pos = {}            # chunk_start -> position dict
    consecutive_rejects = 0
    realized = 0.0
    dust_done = False
    shortdust_done = False
    for e in events:
        ev = e.get("event")
        if ev == "ENTRY_FILL":
            pos[e["chunk_start"]] = {
                "chunk_start": e["chunk_start"], "side": e["side"],
                "qty": e["qty"], "entry_price": e["price"],
                "entry_ts": e["ts"], "exit_due_ts": e["exit_due_ts"],
                # the entry fee (USDT-valued). For a SHORT it was charged in USDT
                # separately from the borrow, so the exit must subtract it from
                # P&L (finding 17); for a LONG it was charged in LTC and is already
                # embedded in the fee-shrunk qty, so it is NOT subtracted again.
                "entry_fee": e.get("fee_quote", 0.0),
            }
            consecutive_rejects = 0
        elif ev == "EXIT_FILL":
            p = pos.pop(e["chunk_start"], None)
            if p:
                realized += e.get("pnl", 0.0)
            consecutive_rejects = 0
        elif ev == "ORDER_REJECT":
            consecutive_rejects += 1
        elif ev in ("ORDER_ACK", "ENTRY_FILL", "EXIT_FILL"):
            consecutive_rejects = 0
        elif ev == "DUST_DONE":
            dust_done = True
        elif ev == "SHORTDUST_DONE":
            shortdust_done = True
    return {"open": pos, "consecutive_rejects": consecutive_rejects,
            "realized": realized, "dust_done": dust_done,
            "shortdust_done": shortdust_done}


def intent_seen(events, chunk_start):
    return any(e.get("event") == "INTENT_SEEN" and
               e.get("chunk_start") == chunk_start for e in events)


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
        client_id (newClientOrderId) is DETERMINISTIC per (role, chunk): Binance
        rejects a duplicate client id, so a resend after a crash/timeout is a
        no-op at the venue instead of a second trade (review findings 1-2)."""
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


def client_id(role, chunk_start):
    """Deterministic order id per (role, chunk): a resend is a no-op at the
    venue. <=36 chars, alphanumeric + dashes. Roles without a chunk (dust,
    sweep) fold a coarse day bucket so they stay stable within a run."""
    c = re.sub(r"[^0-9A-Za-z]", "", str(chunk_start or "na"))[:14]
    return f"f1-{role}-{c}"[:36]


def place(bx, action, side, qty, side_effect, ctx, cid=None):
    """Send one order and journal it. Returns (status, fill_px, fee_quote,
    filled_qty, base_comm) where status is 'filled' | 'unknown' | 'rejected'.
    'unknown' (a transport error, http 0) is NOT a reject: the order may have
    filled, so the caller must not proceed as if it did — the next run's
    recovery resolves it by client id."""
    jlog("ORDER_SENT", action=action, side=side, qty=qty,
         side_effect=side_effect, client_id=cid, live=bx.live, **ctx)
    code, body = bx.margin_order(side, qty, side_effect, cid)
    if code == 200 and body.get("status") == "FILLED":
        px, fq, fee, base_comm = fills_summary(body)
        jlog("ORDER_ACK", action=action, http=code, client_id=cid,
             order_id=body.get("orderId"), fill_price=px, fill_qty=fq,
             fee_quote=fee, base_comm=base_comm, **ctx)
        return "filled", px, fee, fq, base_comm
    if code == 0:
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
        if code == 0:
            jlog("RECOVER_DEFER", client_id=cid, note="venue unreachable; retry next run")
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
            jlog("ENTRY_FILL", chunk_start=chunk, side=side, qty=eq,
                 ordered_qty=s.get("qty"), price=px, fee_quote=0.0, recovered=True,
                 decision_price=px, fill_deviation=0.0,
                 exit_due_ts=ft + HOLD_HOURS * 3600)
        elif action == "EXIT":
            p = st["open"].get(chunk)
            entry_price = p["entry_price"] if p else px
            side = p["side"] if p else (s.get("pos_side") or "LONG")
            qty_traded = p["qty"] if p else eq
            gross = (px - entry_price) * qty_traded
            if side == "SHORT":
                gross = -gross
            jlog("EXIT_FILL", chunk_start=chunk, side=side, qty=qty_traded,
                 price=px, fee_quote=0.0, pnl=round(gross, 4), recovered=True)
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

    # 0) sweep: when the journal says we are FLAT, any free base is leftover
    # dust from short-close buffers. Convert whole lots back to USDT before
    # reconcile so the buffer surplus can never accumulate past the reconcile
    # tolerance and false-halt (review finding, 2026-08-11). Sub-lot remainder
    # (< one lot step) is harmless and always stays under tolerance.
    if not st["open"] and not halted():
        fb = bx.free_base()
        if fb is not None and fb >= QTY_STEP:
            sweep = floor_step(fb)
            jlog("DUST_SWEEP", qty=sweep, free_base=fb)
            place(bx, "SWEEP", "SELL", sweep, "AUTO_REPAY", {})

    # 1) reconcile: exchange net position vs journal-derived
    code, acct = bx.isolated_account()
    if code == 200 and not acct.get("dryrun"):
        try:
            a = acct["assets"][0]
            net_base = (float(a["baseAsset"]["netAsset"]))
        except (KeyError, IndexError, ValueError):
            net_base = None
        expect = sum((+p["qty"] if p["side"] == "LONG" else -p["qty"])
                     for p in st["open"].values())
        if net_base is None:
            jlog("RECONCILE_UNREADABLE", body=json.dumps(acct)[:200])
        elif abs(net_base - expect) > RECONCILE_TOL:
            jlog("RECONCILE_MISMATCH", exchange=net_base, journal=expect)
            set_halt("executor", f"reconcile mismatch {net_base} vs {expect}")
        else:
            jlog("RECONCILE_OK", exchange=net_base, journal=expect)
    elif code != 200 and bx.live:
        jlog("RECONCILE_UNREADABLE", http=code, body=json.dumps(acct)[:200])
        set_halt("executor", f"cannot read account (http {code})")

    # 2) kill: cumulative loss, MARK-TO-MARKET. Realized alone is blind to open
    # positions, so several concurrent shorts could bleed unbounded on a rally
    # and never trip the limit (review finding 16). Add the unrealized P&L of
    # every open leg at the current price so the kill sees the true drawdown.
    mtm = st["realized"]
    px_now = bx.price()
    if px_now is not None:
        for p in st["open"].values():
            leg = (px_now - p["entry_price"]) * p["qty"]
            if p["side"] == "SHORT":
                leg = -leg
            mtm += leg
    if mtm < -LOSS_LIMIT_USD and not halted():
        set_halt("executor", f"mark-to-market loss {mtm:.2f} "
                             f"(realized {st['realized']:.2f} + open legs) beyond -{LOSS_LIMIT_USD}")
    jlog("PNL_MTM", realized=round(st["realized"], 4), mark_to_market=round(mtm, 4),
         open_legs=len(st["open"]), price=px_now)

    # 3) due exits ALWAYS run, halted or not (PILOT-F1.md section 4)
    # Track how many shorts are open across the whole book so the FINAL short
    # close can clear the entire remaining debt — nominal per-leg sizing is
    # interest-blind and pools its unrepaid interest onto whoever closes last
    # (finding 18). A short that is NOT due this run keeps this count above 1,
    # so a due close never repays a still-open sibling's borrow.
    shorts_remaining = sum(1 for q in st["open"].values() if q["side"] == "SHORT")
    for p in sorted(st["open"].values(), key=lambda x: x["exit_due_ts"]):
        if now < p["exit_due_ts"]:
            continue
        overdue_h = (now - p["exit_due_ts"]) / 3600
        if overdue_h > 0.5:
            jlog("EXIT_OVERDUE", chunk_start=p["chunk_start"],
                 overdue_hours=round(overdue_h, 2))
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
            status, px, fee, fq, _ = place(bx, "EXIT", "SELL", sell_qty, "AUTO_REPAY",
                                           {"chunk_start": p["chunk_start"]},
                                           cid=client_id("exit", p["chunk_start"]))
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
            status, px, fee, fq, _ = place(bx, "EXIT", "BUY", buy_qty, "AUTO_REPAY",
                                           {"chunk_start": p["chunk_start"], "leg_qty": p["qty"]},
                                           cid=client_id("exit", p["chunk_start"]))
            qty_traded = p["qty"]  # economic size of the short, for P&L
        if status == "filled":
            gross = (px - p["entry_price"]) * qty_traded
            if p["side"] == "SHORT":
                gross = -gross
            # cost accounting (finding 17): for a SHORT subtract the entry SELL
            # fee (USDT, separate from the borrow) and accrued interest — the
            # extra LTC bought beyond nominal to clear the debt, valued at close,
            # booked on the FINAL short where the pooled interest lands. For a
            # LONG the entry fee was in LTC and is already embedded in the
            # fee-shrunk qty, so it is not subtracted again.
            entry_fee = p.get("entry_fee", 0.0) if p["side"] == "SHORT" else 0.0
            interest_cost = 0.0
            if p["side"] == "SHORT":
                shorts_remaining -= 1
                if is_last_short and debt is not None:
                    interest_cost = max(0.0, debt - p["qty"]) * px
                    resid = bx.borrowed_base()
                    if resid is not None and resid >= QTY_STEP:
                        set_halt("executor", f"short close for {p['chunk_start']} left "
                                 f"residual borrow {resid:.6f} after the final leg — "
                                 "under-repaid; borrow still accruing interest")
            jlog("EXIT_FILL", chunk_start=p["chunk_start"], side=p["side"],
                 qty=qty_traded, price=px, fee_quote=fee, entry_fee=entry_fee,
                 interest_cost=round(interest_cost, 6),
                 pnl=round(gross - fee - entry_fee - interest_cost, 4))
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
            set_halt("executor", f"EXIT for {p['chunk_start']} ({p['side']}) did "
                     "not fill — see ORDER_REJECT; if min-notional, the position "
                     "is under $5 and needs manual handling")

    # 4) fresh intents -> new entries (need the master switch ON and no halt)
    st = derive(journal_events())  # refresh after exits
    # one status line per run so the live screen always shows current state,
    # even on a quiet day with no orders
    jlog("RUN_STATUS", armed=armed(), halted=halted(),
         open=len(st["open"]), realized=round(st["realized"], 4), live=bx.live)
    if not armed():
        if arm_present():
            jlog("ARM_STALE", reason="dead-man: ARM not refreshed within "
                 f"{ARM_MAX_AGE_S}s — control plane lost contact; self-disarmed")
            jlog("ENTRIES_SKIPPED", reason="master switch STALE (dead-man tripped)")
        else:
            jlog("ENTRIES_SKIPPED", reason="master switch OFF (owner has not pressed START)")
        return 0
    if halted():
        jlog("ENTRIES_SKIPPED", reason="halt flag set")
        return 0
    if st["consecutive_rejects"] >= REJECT_LIMIT:
        set_halt("executor", f"{st['consecutive_rejects']} consecutive rejects")
        return 0

    os.makedirs(INTENTS, exist_ok=True)
    for name in sorted(os.listdir(INTENTS)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(INTENTS, name)
        try:
            with open(path) as fh:
                it = json.load(fh)
        except (json.JSONDecodeError, OSError) as e:
            jlog("INTENT_INVALID", file=name, error=str(e)[:100])
            os.rename(path, path + ".bad")
            continue
        # mechanical validation -- every failure is journaled and the file
        # is set aside; nothing is ever "interpreted"
        problems = []
        if it.get("schema") != 1: problems.append("schema")
        if it.get("symbol") != SYMBOL: problems.append("symbol")
        if it.get("side") not in ("LONG", "SHORT", "FLAT"): problems.append("side")
        if not isinstance(it.get("chunk_start"), str): problems.append("chunk_start")
        if not isinstance(it.get("decision_price"), (int, float)): problems.append("decision_price")
        # age against EXCHANGE-synced time, not the raw OS clock (finding 3)
        age = now_exch - it.get("ts", 0)
        stale = age > INTENT_MAX_AGE_S
        if stale:
            # LOUD: a systemic clock drift would otherwise discard every intent to
            # .bad and stop all entries with nothing on the screen. Emit a distinct
            # incident the alert timer emails on, instead of a silent INTENT_INVALID.
            jlog("INTENT_STALE", file=name, chunk_start=it.get("chunk_start"),
                 age_s=int(age), intent_ts=it.get("ts"),
                 now_exchange=round(now_exch, 3), offset_ms=bx.offset_ms)
        if problems or stale:
            jlog("INTENT_INVALID", file=name,
                 problems=problems + ([f"stale({int(age)}s)"] if stale else []))
            os.rename(path, path + ".bad")
            continue
        events_now = journal_events()
        if intent_seen(events_now, it["chunk_start"]):
            jlog("INTENT_DUPLICATE", chunk_start=it["chunk_start"], file=name)
            os.rename(path, path + ".dup")
            continue
        jlog("INTENT_SEEN", chunk_start=it["chunk_start"], side=it["side"],
             decision_price=it["decision_price"],
             input_hash=it.get("input_hash", ""),
             per_member=it.get("per_member"), quorum=it.get("quorum"),
             file=name)
        os.rename(path, path + ".done")
        if it["side"] == "FLAT":
            continue
        stx = derive(journal_events())
        if len(stx["open"]) >= MAX_CONCURRENT:
            jlog("ENTRY_SKIPPED", chunk_start=it["chunk_start"],
                 reason=f"concurrency cap {MAX_CONCURRENT}")
            continue
        price = bx.price()
        if price is None:
            jlog("ENTRY_SKIPPED", chunk_start=it["chunk_start"],
                 reason="no price")
            continue
        dev = abs(price - it["decision_price"]) / it["decision_price"]
        if dev > FILL_DEV_LIMIT:
            jlog("KILL_PRICE_DRIFT", chunk_start=it["chunk_start"],
                 decision=it["decision_price"], market=price,
                 deviation=round(dev, 5))
            set_halt("executor", f"market {dev:.2%} from decision price "
                                 "before order; entries halted")
            break
        qty = clip_qty(price)
        if qty is None:
            jlog("ENTRY_SKIPPED", chunk_start=it["chunk_start"],
                 reason="clip under exchange minimum")
            continue
        buy_side = "BUY" if it["side"] == "LONG" else "SELL"
        side_eff = "NO_SIDE_EFFECT" if it["side"] == "LONG" else "MARGIN_BUY"
        status, px, fee, fq, base_comm = place(bx, "ENTRY", buy_side, qty, side_eff,
                                               {"chunk_start": it["chunk_start"],
                                                "pos_side": it["side"]},
                                               cid=client_id("entry", it["chunk_start"]))
        if status == "unknown":
            # transport error: the entry MAY have filled. Leave it for recovery
            # (which resolves by client id and, if filled, books ENTRY_FILL with
            # the right exit_due_ts). Do NOT record a position or a reject here.
            jlog("ENTRY_INFLIGHT", chunk_start=it["chunk_start"], side=it["side"])
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
            jlog("ENTRY_FILL", chunk_start=it["chunk_start"], side=it["side"],
                 qty=held, ordered_qty=qty, price=px, fee_quote=fee,
                 decision_price=it["decision_price"],
                 fill_deviation=round(fill_dev, 5),
                 exit_due_ts=now + HOLD_HOURS * 3600)
            if fill_dev > FILL_DEV_LIMIT:
                set_halt("executor", f"fill deviated {fill_dev:.2%} "
                                     "from decision price")

    # 5) balance snapshot for the screen
    code, acct = bx.isolated_account()
    if code == 200 and not acct.get("dryrun"):
        try:
            a = acct["assets"][0]
            jlog("BALANCE", base_net=a["baseAsset"]["netAsset"],
                 quote_free=a["quoteAsset"]["free"],
                 quote_net=a["quoteAsset"]["netAsset"])
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
        set_arm(True, source_arg())
        print("ARMED (master switch ON)")
        return 0
    if mode == "disarm":
        set_arm(False, source_arg())
        print("DISARMED (master switch OFF)")
        return 0
    if mode == "status":
        return do_status()
    print(f"unknown mode {mode}; use run|dust|arm|disarm|status")
    return 2


def source_arg():
    for a in sys.argv:
        if a.startswith("--source="):
            return a.split("=", 1)[1]
    return "unknown"


if __name__ == "__main__":
    sys.exit(main())
