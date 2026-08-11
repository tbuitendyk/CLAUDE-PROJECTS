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
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# ---- constants (PILOT-F1.md; change = protocol change = record restarts) ----
SYMBOL = "LTCUSDT"
CLIP_USD = 10.0            # $ notional per position; the executor owns this
QTY_STEP = 0.001           # LOT_SIZE stepSize, probed 2026-08-11
MIN_NOTIONAL = 5.0         # exchange minimum, probed 2026-08-11
HOLD_HOURS = 137           # F1 cell tHours
MAX_CONCURRENT = 6         # 137h / 24h step, derived
INTENT_MAX_AGE_S = 1800    # an intent older than 30 min is stale, never traded
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
    for e in events:
        ev = e.get("event")
        if ev == "ENTRY_FILL":
            pos[e["chunk_start"]] = {
                "chunk_start": e["chunk_start"], "side": e["side"],
                "qty": e["qty"], "entry_price": e["price"],
                "entry_ts": e["ts"], "exit_due_ts": e["exit_due_ts"],
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
    return {"open": pos, "consecutive_rejects": consecutive_rejects,
            "realized": realized, "dust_done": dust_done}


def intent_seen(events, chunk_start):
    return any(e.get("event") == "INTENT_SEEN" and
               e.get("chunk_start") == chunk_start for e in events)


# ---- halt flag ---------------------------------------------------------------
def halted():
    return os.path.exists(HALT)


def set_halt(source, reason):
    os.makedirs(PILOT, exist_ok=True)
    with open(HALT, "w") as f:
        f.write(json.dumps({"source": source, "reason": reason,
                            "utc": time.strftime("%Y-%m-%dT%H:%M:%SZ",
                                                 time.gmtime())}))
    jlog("HALT_SET", source=source, reason=reason)


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

    def margin_order(self, side, qty, side_effect):
        """Place an isolated-margin MARKET order. side: BUY|SELL.
        side_effect: NO_SIDE_EFFECT | MARGIN_BUY (auto-borrow) | AUTO_REPAY."""
        params = {"symbol": SYMBOL, "isIsolated": "TRUE", "side": side,
                  "type": "MARKET", "quantity": f"{qty:.3f}",
                  "sideEffectType": side_effect,
                  "newOrderRespType": "FULL"}
        if not self.live:
            jlog("DRYRUN_ORDER", **params)
            # fabricate a fill at last price so dry runs exercise the paths
            p = self.price() or 0.0
            return 200, {"orderId": 0, "status": "FILLED", "dryrun": True,
                         "fills": [{"price": f"{p}", "qty": f"{qty:.3f}",
                                    "commission": "0", "commissionAsset": "USDT"}]}
        return self._http("POST", "/sapi/v1/margin/order", params, signed=True)

    def isolated_account(self):
        return self._http("GET", "/sapi/v1/margin/isolated/account",
                          {"symbols": SYMBOL}, signed=True)


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
def clip_qty(price):
    """$10 notional rounded DOWN to the lot step; refuse if under exchange min."""
    qty = int((CLIP_USD / price) / QTY_STEP) * QTY_STEP
    qty = round(qty, 3)
    if qty * price < MIN_NOTIONAL:
        return None
    return qty


def fills_summary(body):
    """Weighted fill price, total qty, commission in quote terms best-effort."""
    fills = body.get("fills") or []
    if not fills:
        return None, None, 0.0
    qty = sum(float(f["qty"]) for f in fills)
    px = sum(float(f["price"]) * float(f["qty"]) for f in fills) / qty
    fee = sum(float(f.get("commission", 0)) for f in fills
              if f.get("commissionAsset") in ("USDT",))
    return px, qty, fee


def place(bx, action, side, qty, side_effect, ctx):
    """Send one order and journal the outcome. Returns (ok, fill_px, fee)."""
    jlog("ORDER_SENT", action=action, side=side, qty=qty,
         side_effect=side_effect, live=bx.live, **ctx)
    code, body = bx.margin_order(side, qty, side_effect)
    if code == 200 and body.get("status") == "FILLED":
        px, fq, fee = fills_summary(body)
        jlog("ORDER_ACK", action=action, http=code,
             order_id=body.get("orderId"), fill_price=px, fill_qty=fq,
             fee_quote=fee, **ctx)
        return True, px, fee
    jlog("ORDER_REJECT", action=action, http=code,
         body=json.dumps(body)[:300], **ctx)
    return False, None, 0.0


# ---- the run mode ------------------------------------------------------------
def do_run(bx):
    events = journal_events()
    st = derive(events)
    now = time.time()

    if not bx.sync_clock():
        jlog("KILL_TRANSPORT", note="cannot reach venue for clock sync; "
             "no orders this run")
        return 1

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

    # 2) kill: cumulative loss
    if st["realized"] < -LOSS_LIMIT_USD and not halted():
        set_halt("executor", f"cumulative loss {st['realized']:.2f} "
                             f"beyond -{LOSS_LIMIT_USD}")

    # 3) due exits ALWAYS run, halted or not (PILOT-F1.md section 4)
    for p in sorted(st["open"].values(), key=lambda x: x["exit_due_ts"]):
        if now < p["exit_due_ts"]:
            continue
        overdue_h = (now - p["exit_due_ts"]) / 3600
        if overdue_h > 0.5:
            jlog("EXIT_OVERDUE", chunk_start=p["chunk_start"],
                 overdue_hours=round(overdue_h, 2))
        side = "SELL" if p["side"] == "LONG" else "BUY"
        ok, px, fee = place(bx, "EXIT", side, p["qty"], "AUTO_REPAY",
                            {"chunk_start": p["chunk_start"]})
        if ok:
            gross = (px - p["entry_price"]) * p["qty"]
            if p["side"] == "SHORT":
                gross = -gross
            jlog("EXIT_FILL", chunk_start=p["chunk_start"], side=p["side"],
                 qty=p["qty"], price=px, fee_quote=fee,
                 pnl=round(gross - fee, 4))

    # 4) fresh intents -> new entries (skipped while halted)
    st = derive(journal_events())  # refresh after exits
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
        age = now - it.get("ts", 0)
        if age > INTENT_MAX_AGE_S: problems.append(f"stale({int(age)}s)")
        if problems:
            jlog("INTENT_INVALID", file=name, problems=problems)
            os.rename(path, path + ".bad")
            continue
        events_now = journal_events()
        if intent_seen(events_now, it["chunk_start"]):
            jlog("INTENT_DUPLICATE", chunk_start=it["chunk_start"], file=name)
            os.rename(path, path + ".dup")
            continue
        jlog("INTENT_SEEN", chunk_start=it["chunk_start"], side=it["side"],
             decision_price=it["decision_price"],
             input_hash=it.get("input_hash", ""), file=name)
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
        ok, px, fee = place(bx, "ENTRY", buy_side, qty, side_eff,
                            {"chunk_start": it["chunk_start"]})
        if ok:
            fill_dev = abs(px - it["decision_price"]) / it["decision_price"]
            jlog("ENTRY_FILL", chunk_start=it["chunk_start"], side=it["side"],
                 qty=qty, price=px, fee_quote=fee,
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
    jlog("DUST_START", price=price, qty=qty, live=bx.live)
    ok1, px1, fee1 = place(bx, "DUST_BUY", "BUY", qty, "NO_SIDE_EFFECT", {})
    if not ok1:
        jlog("DUST_ABORT", stage="buy")
        return 1
    time.sleep(2)
    ok2, px2, fee2 = place(bx, "DUST_SELL", "SELL", qty, "AUTO_REPAY", {})
    if not ok2:
        jlog("DUST_ABORT", stage="sell",
             note="BOUGHT BUT NOT SOLD -- position open, reconcile will see it")
        return 1
    jlog("DUST_DONE", buy_price=px1, sell_price=px2, qty=qty,
         fees=round(fee1 + fee2, 6),
         round_trip_cost=round((px1 - px2) * qty + fee1 + fee2, 6))
    return 0


# ---- status ------------------------------------------------------------------
def do_status():
    st = derive(journal_events())
    print(json.dumps({
        "halted": halted(),
        "halt_info": open(HALT).read() if halted() else None,
        "open_positions": list(st["open"].values()),
        "realized_pnl": round(st["realized"], 4),
        "consecutive_rejects": st["consecutive_rejects"],
        "dust_done": st["dust_done"],
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
    if mode == "status":
        return do_status()
    print(f"unknown mode {mode}; use run|dust|status")
    return 2


if __name__ == "__main__":
    sys.exit(main())
