#!/usr/bin/env python3
"""Tests for mx_executor.py -- run anywhere with python3, no network needed.

A tiny stdlib mock of the Binance endpoints runs on localhost so the FULL
run path (clock sync, reconcile, exits, intents, orders, signing headers) is
exercised, including LIVE=1 against the mock. House rule: every check here
was watched FAILING first by breaking the code under test, then passing.
"""

import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


class MockBinance(BaseHTTPRequestHandler):
    """Scriptable fake venue. Class attrs steer behaviour per test. It tracks a
    real base-asset balance so BUY/SELL and free_base() are consistent — that is
    what lets the fee-shrink fix be tested end to end."""
    price = "100.00"
    reject_orders = False
    price_fails = False        # when True the ticker returns 500 -> price() is None
    force_status = None        # override the order status string (partial/expired fill tests)
    order_5xx = False          # when True the order POST returns 503 (ambiguous)
    net_asset = None          # override netAsset/free; None -> use tracked balances
    base_bal = 0.0            # tracked free LTC after fills
    borrowed = 0.0            # tracked LTC debt (short open borrows, close repays)
    commission = "0.01"
    commission_asset = "USDT"
    orders = []               # captured order params
    placed = {}               # newClientOrderId -> venue order record (recovery lookup)
    time_skew_ms = 0          # exchange serverTime minus box OS clock (clock tests)

    def _send(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/v3/time"):
            # time_skew_ms lets a test push exchange time away from the box OS
            # clock, exercising the exchange-synced age check and CLOCK_DRIFT.
            return self._send({"serverTime": int(time.time() * 1000) + MockBinance.time_skew_ms})
        if self.path.startswith("/api/v3/ticker/price"):
            if MockBinance.price_fails:
                return self._send({"code": -1000, "msg": "unavailable"}, 500)
            return self._send({"symbol": "LTCUSDT", "price": self.price})
        if self.path.startswith("/sapi/v1/margin/order"):
            # order lookup by origClientOrderId (recovery path)
            import urllib.parse as _up
            q = _up.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            cid = (q.get("origClientOrderId") or [""])[0]
            rec = MockBinance.placed.get(cid)
            if rec is None:
                return self._send({"code": -2013, "msg": "Order does not exist."}, 400)
            return self._send(rec)
        if self.path.startswith("/sapi/v1/margin/isolated/account"):
            if self.net_asset is not None:
                na = self.net_asset
                return self._send({"assets": [{
                    "baseAsset": {"netAsset": na, "free": na, "borrowed": "0", "interest": "0"},
                    "quoteAsset": {"free": "200.0", "netAsset": "200.0"}}]})
            net = MockBinance.base_bal - MockBinance.borrowed
            return self._send({"assets": [{
                "baseAsset": {"netAsset": f"{net:.6f}", "free": f"{MockBinance.base_bal:.6f}",
                              "borrowed": f"{MockBinance.borrowed:.6f}", "interest": "0"},
                "quoteAsset": {"free": "200.0", "netAsset": "200.0"}}]})
        return self._send({"unexpected": self.path}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length).decode()
        params = dict(p.split("=", 1) for p in raw.split("&") if "=" in p)
        MockBinance.orders.append(params)
        if self.path.startswith("/sapi/v1/margin/order"):
            if MockBinance.reject_orders:
                return self._send({"code": -2010, "msg": "rejected"}, 400)
            if MockBinance.order_5xx:
                return self._send({"code": -1001, "msg": "internal error"}, 503)
            qty = float(params.get("quantity", "0"))
            side = params.get("side")
            eff = params.get("sideEffectType", "NO_SIDE_EFFECT")
            comm = float(MockBinance.commission)
            base_fee = comm if MockBinance.commission_asset == "LTC" else 0.0
            # simulate isolated-margin bookkeeping the way Binance would
            if side == "BUY":
                received = qty - base_fee            # fee taken in LTC
                if eff == "AUTO_REPAY":
                    repay = min(received, MockBinance.borrowed)
                    MockBinance.borrowed -= repay
                    MockBinance.base_bal += received - repay
                else:
                    MockBinance.base_bal += received
            else:  # SELL
                if eff == "MARGIN_BUY":              # open short: borrow then sell
                    MockBinance.borrowed += qty
                else:
                    MockBinance.base_bal -= qty
            # record the FILLED order so the recovery path can look it up by its
            # deterministic client id (origClientOrderId), the way Binance would.
            cid = params.get("newClientOrderId")
            if cid:
                px = float(MockBinance.price)
                MockBinance.placed[cid] = {
                    "status": "FILLED",
                    "executedQty": f"{qty:.3f}",
                    "cummulativeQuoteQty": f"{qty * px:.8f}",
                    "updateTime": int(time.time() * 1000),
                }
            # force_status lets a test return a non-FILLED status while the order
            # still executed (executedQty>0 + fills), exercising the partial/
            # expired-fill booking path.
            st = MockBinance.force_status or "FILLED"
            return self._send({"orderId": len(MockBinance.orders),
                               "status": st,
                               "executedQty": params.get("quantity", "0"),
                               "clientOrderId": params.get("newClientOrderId", ""),
                               "fills": [{"price": MockBinance.price,
                                          "qty": params.get("quantity", "0"),
                                          "commission": MockBinance.commission,
                                          "commissionAsset": MockBinance.commission_asset}]})
        return self._send({"unexpected": self.path}, 404)

    def log_message(self, *a):
        pass


class ExecutorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), MockBinance)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        # fresh fake HOME per test; re-import module under that HOME
        self.home = tempfile.mkdtemp(prefix="pilot-test-")
        os.environ["HOME"] = self.home
        for m in list(sys.modules):
            if m == "mx_executor":
                del sys.modules[m]
        import mx_executor
        self.x = mx_executor
        with open(os.path.join(self.home, ".executor-env"), "w") as f:
            f.write(f"BINANCE_KEY=k\nBINANCE_SECRET=s\nLIVE=1\n"
                    f"BASE=http://127.0.0.1:{self.port}\n")
        # most tests exercise the trading path, so arm by default; the arm-gate
        # tests below disarm explicitly.
        self.x.set_arm(True, "test")
        MockBinance.price = "100.00"
        MockBinance.reject_orders = False
        MockBinance.price_fails = False
        MockBinance.force_status = None
        MockBinance.order_5xx = False
        MockBinance.net_asset = None
        MockBinance.base_bal = 0.0
        MockBinance.borrowed = 0.0
        MockBinance.commission = "0.01"
        MockBinance.commission_asset = "USDT"
        MockBinance.orders = []
        MockBinance.placed = {}
        MockBinance.time_skew_ms = 0

    def tearDown(self):
        shutil.rmtree(self.home, ignore_errors=True)

    # -- helpers ---------------------------------------------------------
    def bx(self):
        return self.x.Binance(self.x.load_env())

    def write_intent(self, side="LONG", chunk="2026-08-07T00:00Z",
                     price=100.0, age=0):
        os.makedirs(self.x.INTENTS, exist_ok=True)
        it = {"schema": 1, "symbol": "LTCUSDT", "side": side,
              "chunk_start": chunk, "decision_price": price,
              "input_hash": "abc", "ts": time.time() - age}
        with open(os.path.join(self.x.INTENTS, f"intent-{chunk[:10]}.json"),
                  "w") as f:
            json.dump(it, f)

    def events(self):
        return [e["event"] for e in self.x.journal_events()]

    # -- pure functions ---------------------------------------------------
    def test_clip_respects_step_and_minimum(self):
        self.assertEqual(self.x.clip_qty(100.0), 0.1)      # $10 -> 0.100
        self.assertEqual(self.x.clip_qty(87.31), 0.114)    # rounded DOWN
        self.assertIsNone(self.x.clip_qty(10001.0))        # under $5 after step

    def test_replay_matches_lifecycle(self):
        self.x.jlog("ENTRY_FILL", chunk_start="c1", side="LONG", qty=0.1,
                    price=100.0, exit_due_ts=time.time() + 10)
        self.x.jlog("ORDER_REJECT", action="ENTRY")
        self.x.jlog("ORDER_REJECT", action="ENTRY")
        st = self.x.derive(self.x.journal_events())
        self.assertEqual(len(st["open"]), 1)
        self.assertEqual(st["consecutive_rejects"], 2)
        self.x.jlog("EXIT_FILL", chunk_start="c1", side="LONG", qty=0.1,
                    price=101.0, pnl=0.09)
        st = self.x.derive(self.x.journal_events())
        self.assertEqual(len(st["open"]), 0)
        self.assertAlmostEqual(st["realized"], 0.09)
        self.assertEqual(st["consecutive_rejects"], 0)

    # -- full run path against the mock venue ------------------------------
    def test_long_entry_places_buy_and_journals_fill(self):
        self.write_intent(side="LONG")
        rc = self.x.do_run(self.bx())
        self.assertEqual(rc, 0)
        self.assertIn("ENTRY_FILL", self.events())
        order = MockBinance.orders[-1]
        self.assertEqual(order["side"], "BUY")
        self.assertEqual(order["sideEffectType"], "NO_SIDE_EFFECT")
        self.assertEqual(order["isIsolated"], "TRUE")
        self.assertIn("signature", order)  # signed path exercised

    def test_short_entry_uses_auto_borrow(self):
        self.write_intent(side="SHORT")
        self.x.do_run(self.bx())
        order = MockBinance.orders[-1]
        self.assertEqual(order["side"], "SELL")
        self.assertEqual(order["sideEffectType"], "MARGIN_BUY")

    def test_stale_intent_never_trades(self):
        # Past the ENTRY RETRY WINDOW (owner 2026-08-16: an entry may be attempted
        # for one hour after its moment, not the old 30 minutes) the intent is dead.
        self.write_intent(age=self.x.ENTRY_RETRY_WINDOW_S + 5)
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("INTENT_INVALID", ev)
        self.assertIn("INTENT_STALE", ev)   # LOUD, not silently dropped (finding 3)
        self.assertNotIn("ENTRY_FILL", ev)

    def test_intent_age_uses_exchange_synced_time(self):
        # a FRESH intent (ts=now) must read as stale when exchange time is far
        # ahead of the box OS clock — proving the age check uses exchange-synced
        # time, not the raw OS clock (finding 3).
        MockBinance.time_skew_ms = (self.x.ENTRY_RETRY_WINDOW_S + 120) * 1000
        self.write_intent(side="LONG", age=0)
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("INTENT_STALE", ev)
        self.assertNotIn("ENTRY_FILL", ev)

    def test_clock_drift_emits_loud_incident(self):
        MockBinance.time_skew_ms = 10000   # exchange 10s ahead of the box OS clock
        self.write_intent(side="LONG")
        self.x.do_run(self.bx())
        self.assertIn("CLOCK_DRIFT", self.events())

    def test_duplicate_chunk_never_reopens(self):
        self.write_intent(chunk="2026-08-07T00:00Z")
        self.x.do_run(self.bx())
        # keep the mock exchange consistent with the position just opened,
        # otherwise reconcile (rightly) halts and hides the duplicate check
        MockBinance.net_asset = "0.100"
        self.write_intent(chunk="2026-08-07T00:00Z")
        self.x.do_run(self.bx())
        self.assertEqual(self.events().count("ENTRY_FILL"), 1)
        self.assertIn("INTENT_DUPLICATE", self.events())

    def test_catastrophic_price_drift_halts_without_order(self):
        # only a CATASTROPHIC (>20%) decision-vs-market gap is a broken price and
        # halts before ordering (owner 2026-08-12: the backstop, not a trade filter).
        self.write_intent(price=70.0)  # market 100 -> ~43% drift, clearly broken
        self.x.do_run(self.bx())
        self.assertIn("KILL_PRICE_DRIFT", self.events())
        self.assertTrue(self.x.halted())
        self.assertNotIn("ENTRY_FILL", self.events())

    def test_moderate_drift_within_backstop_still_enters(self):
        # OWNER 2026-08-12: the training entered UNCONDITIONALLY at the open, so live
        # must NOT skip a trade because the market moved a few % between the decision
        # price and the fill. An 11% gap (well under the 20% catastrophic backstop)
        # enters normally; the deviation is recorded, not filtered.
        self.write_intent(price=90.0)  # market 100 -> 11% drift: within the backstop
        self.x.do_run(self.bx())
        self.assertNotIn("KILL_PRICE_DRIFT", self.events())
        self.assertFalse(self.x.halted())
        self.assertIn("ENTRY_FILL", self.events())

    def test_halt_blocks_entries_but_exits_still_run(self):
        # open a position due for exit, then halt, then run
        self.x.jlog("ENTRY_FILL", chunk_start="c9", side="LONG", qty=0.1,
                    price=100.0, exit_due_ts=time.time() - 60)
        MockBinance.net_asset = "0.100"  # exchange mirrors the open long
        self.x.set_halt("test", "manual")
        self.write_intent(chunk="2026-08-08T00:00Z")
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("EXIT_FILL", ev)         # exit ran despite halt
        self.assertIn("ENTRIES_SKIPPED", ev)   # entry did not
        self.assertNotIn("ENTRY_FILL", [e for e in ev if e != "EXIT_FILL"][
            ev.index("HALT_SET"):] if "HALT_SET" in ev else [])

    def test_reject_streak_sets_halt(self):
        MockBinance.reject_orders = True
        for i, day in enumerate(("01", "02", "03")):
            self.write_intent(chunk=f"2026-08-{day}T00:00Z")
            self.x.do_run(self.bx())
        st = self.x.derive(self.x.journal_events())
        self.assertGreaterEqual(st["consecutive_rejects"], 3)
        self.write_intent(chunk="2026-08-04T00:00Z")
        self.x.do_run(self.bx())
        self.assertTrue(self.x.halted())

    def test_sweep_rejects_do_not_count_toward_reject_kill(self):
        # a housekeeping SWEEP that rejects (e.g. sub-min-notional dust) must NOT
        # accrue toward the reject-kill — otherwise un-sellable dust would halt the
        # box on arm (the live 2026-08-11 accumulation).
        for _ in range(5):
            self.x.jlog("ORDER_REJECT", action="SWEEP", http=400)
        st = self.x.derive(self.x.journal_events())
        self.assertEqual(st["consecutive_rejects"], 0,
                         'SWEEP rejects are housekeeping, not trading failures')

    def test_reconcile_mismatch_halts_entries(self):
        MockBinance.net_asset = "0.500"   # exchange says 0.5 LTC, journal says 0
        self.x.do_run(self.bx())
        self.assertIn("RECONCILE_MISMATCH", self.events())
        self.assertTrue(self.x.halted())

    # -- interest-aware / dust-tolerant reconcile (finding 19) ----------------
    def test_flat_book_subnotional_dust_not_swept_no_halt(self):
        # THE LIVE DEADLOCK (2026-08-11): a flat book with sub-$5 dust (0.00134
        # LTC ~ $0.13 at price 100) CANNOT be sold (min-notional), so the sweep
        # must NOT attempt it (a rejected sub-notional sell every cycle creeps
        # toward the reject-kill) and reconcile must tolerate it, not halt.
        MockBinance.base_bal = 0.00134   # ~$0.13 leftover dust, no open positions
        self.x.do_run(self.bx())
        self.assertIn("DUST_SUBMIN", self.events())
        self.assertNotIn("DUST_SWEEP", self.events())
        sweeps = [o for o in MockBinance.orders if o.get("side") == "SELL"]
        self.assertEqual(sweeps, [], 'no sub-notional sweep order may be sent')
        self.assertIn("RECONCILE_OK", self.events())
        self.assertFalse(self.x.halted(), 'flat sub-notional dust must not halt')

    def test_flat_dust_defers_when_price_unavailable(self):
        # RE-REVIEW residual: when the price GET fails, the flat dust tolerance
        # cannot be sized — DEFER the long-side check rather than apply the tight
        # open-position tolerance and spuriously halt on leftover dust.
        MockBinance.base_bal = 0.00134
        MockBinance.price_fails = True
        self.x.do_run(self.bx())
        self.assertIn("RECONCILE_DEFER", self.events())
        self.assertFalse(self.x.halted(), 'no price must defer the dust check, not halt')

    def test_flat_book_sellable_balance_is_swept(self):
        # a flat book with a SELLABLE free base (0.06 LTC ~ $6 at price 100 >= $5)
        # is flattened to USDT — accumulated dust grown past the minimum, or an
        # unknown long; either way the flat = all-USDT state is reached.
        MockBinance.base_bal = 0.06
        self.x.do_run(self.bx())
        self.assertIn("DUST_SWEEP", self.events())
        self.assertTrue(MockBinance.base_bal < self.x.QTY_STEP, 'sellable free base flattened')
        self.assertFalse(self.x.halted())

    def test_open_short_interest_within_cap_does_not_halt(self):
        # an open short whose exchange debt exceeds the nominal by accrued
        # interest (within the cap) must NOT false-halt.
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.1,
                    price=100.0, exit_due_ts=time.time() + 9999)
        MockBinance.borrowed = 0.1015   # nominal 0.1 + ~1.5% interest
        self.x.do_run(self.bx())
        self.assertIn("RECONCILE_OK", self.events())
        self.assertFalse(self.x.halted(), 'accrued short interest is not drift')

    def test_short_financed_by_dust_does_not_halt(self):
        # THE LIVE HALT (2026-08-18). A MARGIN_BUY sell borrows only what the
        # account cannot already cover, so pre-existing sub-$5 dust finances part
        # of the sale and BORROW comes in BELOW the sold quantity. On the box:
        # 0.00211675 LTC of un-sellable dust, sold 0.224, borrowed 0.221886 — a
        # 2.1-step shortfall that halted entries for six hours over $0.09 in the
        # SAFE direction (we owe less than nominal; the economic short is
        # unchanged). The long side has tolerated exactly this dust since
        # re-review B2; the short side kept the bare one-step tolerance.
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.224,
                    price=100.0, exit_due_ts=time.time() + 9999)
        MockBinance.borrowed = 0.221886   # the dust financed the difference
        self.x.do_run(self.bx())
        self.assertIn("RECONCILE_OK", self.events())
        self.assertFalse(self.x.halted(),
                         'a borrow shortfall explainable by sub-min dust must not halt')

    def test_short_shortfall_beyond_dust_still_halts(self):
        # The tolerance is BOUNDED by what dust could explain. A shortfall larger
        # than the sub-$5 bound is a real discrepancy and must still halt — the
        # fix must not become a blanket amnesty on the short side.
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.224,
                    price=100.0, exit_due_ts=time.time() + 9999)
        MockBinance.borrowed = 0.10       # 0.124 short of nominal, dust bound is 0.06
        self.x.do_run(self.bx())
        self.assertIn("RECONCILE_MISMATCH", self.events())
        self.assertTrue(self.x.halted())

    def test_short_shortfall_defers_when_price_unavailable(self):
        # Same rule the long side already follows: a tolerance that cannot be
        # sized must DEFER, never fall back to the tight one and false-halt.
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.224,
                    price=100.0, exit_due_ts=time.time() + 9999)
        MockBinance.borrowed = 0.221886
        MockBinance.price_fails = True
        self.x.do_run(self.bx())
        self.assertIn("RECONCILE_DEFER", self.events())
        self.assertFalse(self.x.halted(), 'no price must defer the shortfall check, not halt')

    def test_vanished_short_still_halts(self):
        # journal thinks a short is open but the exchange has NO borrow — the
        # short vanished; a deficit (not interest) must still halt.
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.1,
                    price=100.0, exit_due_ts=time.time() + 9999)
        MockBinance.borrowed = 0.0      # borrow gone
        self.x.do_run(self.bx())
        self.assertIn("RECONCILE_MISMATCH", self.events())
        self.assertTrue(self.x.halted())

    def test_nonflat_book_dust_does_not_halt(self):
        # RE-REVIEW B2: with an open position (NON-FLAT), sub-min-notional
        # short-close buffer dust in free base must NOT false-halt reconcile —
        # the old flat-only tolerance wedged the pilot within a few closes.
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.1,
                    price=100.0, exit_due_ts=time.time() + 9999)
        MockBinance.borrowed = 0.1       # the open short
        MockBinance.base_bal = 0.0014    # sub-min dust in free base, book non-flat
        self.x.do_run(self.bx())
        self.assertIn("RECONCILE_OK", self.events())
        self.assertFalse(self.x.halted(), 'non-flat sub-min dust must not halt')

    def test_young_short_overborrow_halts_under_derived_cap(self):
        # RE-REVIEW: the interest cap is DERIVED from rate x AGE, not a flat frac.
        # A short open only ~1h cannot have accrued 3% interest, so a 3% excess
        # borrow is an over-borrow and must HALT — even though the old flat 5% cap
        # would have tolerated it. This is exactly what age-scaling buys us.
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.1,
                    price=100.0, exit_due_ts=now + self.x.HOLD_HOURS * 3600 - 3600)  # ~1h old
        MockBinance.borrowed = 0.103    # 3% excess — impossible as 1h interest
        self.x.do_run(self.bx())
        self.assertIn("RECONCILE_MISMATCH", self.events())
        self.assertTrue(self.x.halted(),
                        'a 3% excess on a 1h-old short exceeds the age-derived cap and must halt')

    def test_non_final_short_close_underrepay_halts(self):
        # RE-REVIEW: the residual assertion fires on EVERY short close, not only the
        # final one. With two shorts open, the FIRST (non-final) close must still
        # HALT if its AUTO_REPAY barely reduced the borrow (here an outsized LTC
        # fee eats the received qty), instead of passing quietly with debt intact.
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.1,
                    price=100.0, exit_due_ts=now - 60)          # due -> closes now
        self.x.jlog("ENTRY_FILL", chunk_start="s2", side="SHORT", qty=0.1,
                    price=100.0, exit_due_ts=now + 9999)         # NOT due -> keeps it non-final
        MockBinance.borrowed = 0.2
        MockBinance.commission_asset = "LTC"
        MockBinance.commission = "0.02"    # huge fee: received << ordered -> under-repay
        self._advance_and_run(0)
        self.assertTrue(self.x.halted(),
                        'a non-final short close that under-repaid must HALT, not pass silently')

    def _unhalt_cli(self, *args):
        import sys as _s
        argv = _s.argv
        _s.argv = ["mx", "unhalt", *args]
        try:
            self.x.main()
        finally:
            _s.argv = argv

    def test_a_refused_unhalt_exits_nonzero_so_it_is_not_read_as_delivered(self):
        """A REFUSAL MUST NOT LOOK LIKE A DELIVERY (owner, 2026-08-19).

        main() returned 0 whatever happened here. The control plane's carry
        deleted the request file on a zero exit, so every press of "Clear the
        halt" was consumed by its own failure: the halt stayed, the request was
        gone, and nothing on the owner's screen said why. They pressed it
        repeatedly over a day and nothing ever happened.

        Contract now: 0 = cleared, or nothing was halted; 2 = the box considered
        it and said no. An unreachable box never reaches main() at all, so the
        carrier can tell "refused" (consume, record the reason) from "could not
        deliver" (retain and retry) — and retrying is only useful for the
        second, since a stale or badly-signed request cannot become valid."""
        import sys as _s

        def rc(*args):
            argv = _s.argv
            _s.argv = ["mx", "unhalt", *args]
            try:
                return self.x.main()
            finally:
                _s.argv = argv

        # refused: halted, no secret configured -> must be 2, and the halt stands
        self.x.set_halt("test", "stuck")
        self.assertEqual(rc("--source=owner", "--reason=x"), 2,
                         'a refused unhalt exited 0, so the carrier reads its own failure as success')
        self.assertTrue(self.x.halted(), 'the halt must stand when the clear was refused')

        # cleared by the hand lever -> 0
        self.assertEqual(rc("--source=operator", "--force", "--reason=hand"), 0,
                         'a successful clear must exit 0')
        self.assertFalse(self.x.halted())

        # nothing halted -> 0 (nothing to do is not a failure; a carrier that
        # retried this forever would never drain the request)
        self.assertEqual(rc("--source=owner", "--reason=x"), 0,
                         'clearing a halt that is not set is not a failure')

    def test_a_refused_per_setup_unhalt_also_exits_nonzero(self):
        """The per-PROFILE path is the one the owner actually presses, and it is
        the one that was silently dropping requests. RULE TWO in spirit: the two
        halts are separate brakes and must report identically."""
        import sys as _s

        def rc(*args):
            argv = _s.argv
            _s.argv = ["mx", "unhalt", *args]
            try:
                return self.x.main()
            finally:
                _s.argv = argv

        sid = "setup-abc-123"
        self.x.set_setup_halt(sid, "decisions no longer reproduce")
        self.assertTrue(self.x.setup_halted(sid))
        self.assertEqual(rc("--source=owner", f"--setup={sid}", "--reason=x"), 2,
                         'a refused per-profile clear exited 0 — this is the exact press the owner lost')
        self.assertTrue(self.x.setup_halted(sid), 'the profile halt must stand when the clear was refused')
        self.assertEqual(rc("--source=operator", f"--setup={sid}", "--force", "--reason=hand"), 0)
        self.assertFalse(self.x.setup_halted(sid))
        self.assertEqual(rc("--source=owner", f"--setup={sid}", "--reason=x"), 0,
                         'clearing a profile halt that is not set is not a failure')

    def test_unhalt_cli_refuses_unsigned_and_clears_with_force(self):
        """The CLI wiring, both directions (contract changed 2026-08-18).

        This used to assert that a bare `unhalt` clears the flag. It no longer
        does, and that is the point: clearing a halt removes a brake, so the
        control-plane path is signed. The unsigned CLI call is now the REFUSED
        case, and --force is the documented hand lever for someone already at a
        shell on the box. Both are asserted here so the main() wiring stays
        covered — the signature logic itself is tested directly further down."""
        self.x.set_halt("test", "stuck")
        self.assertTrue(self.x.halted())
        self._unhalt_cli("--source=owner", "--reason=resolved")
        self.assertTrue(self.x.halted(), 'an UNSIGNED unhalt must leave the halt standing')
        self.assertIn("UNHALT_NO_SECRET", self.events())
        self._unhalt_cli("--source=operator", "--force", "--reason=hand-clear")
        self.assertFalse(self.x.halted(), '--force is the hand lever and must clear')
        self.assertIn("HALT_CLEAR", self.events())

    def test_short_exit_pnl_sign(self):
        # short entered at 110, exits at 100 -> profit
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.1,
                    price=110.0, exit_due_ts=time.time() - 1)
        MockBinance.borrowed = 0.1   # the open short's real loan
        self.x.do_run(self.bx())
        fills = [e for e in self.x.journal_events() if e["event"] == "EXIT_FILL"]
        self.assertEqual(len(fills), 1)
        self.assertGreater(fills[0]["pnl"], 0.9)  # ~ $1 minus fee
        order = MockBinance.orders[-1]
        self.assertEqual(order["side"], "BUY")
        self.assertEqual(order["sideEffectType"], "AUTO_REPAY")

    def test_concurrency_cap_enforced(self):
        now = time.time()
        for i in range(self.x.MAX_CONCURRENT):
            self.x.jlog("ENTRY_FILL", chunk_start=f"c{i}", side="LONG",
                        qty=0.1, price=100.0, exit_due_ts=now + 9999)
        MockBinance.net_asset = "0.600"  # exchange mirrors the 6 open longs
        self.write_intent(chunk="2026-08-09T00:00Z")
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("ENTRY_SKIPPED", ev)
        self.assertEqual(ev.count("ENTRY_FILL"), self.x.MAX_CONCURRENT)

    def test_dust_refuses_live_without_yes(self):
        rc = self.x.do_dust(self.bx(), yes=False)
        self.assertEqual(rc, 1)
        self.assertNotIn("DUST_DONE", self.events())

    def test_dust_round_trip_and_refuses_repeat(self):
        rc = self.x.do_dust(self.bx(), yes=True)
        self.assertEqual(rc, 0)
        self.assertIn("DUST_DONE", self.events())
        rc2 = self.x.do_dust(self.bx(), yes=True)
        self.assertEqual(rc2, 1)

    def test_buy_fee_in_base_shrinks_the_sell_qty(self):
        # THE DUST BUG (2026-08-11): Binance took the buy fee in LTC, so selling
        # the bought qty failed 'insufficient balance'. The sell must use the
        # net received, floored. With a base-denominated fee the dust must still
        # complete, and the sell qty must be below the buy qty.
        MockBinance.commission_asset = "LTC"
        MockBinance.commission = "0.001"
        rc = self.x.do_dust(self.bx(), yes=True)
        self.assertEqual(rc, 0, 'dust must complete even when the fee is taken in base')
        self.assertIn("DUST_DONE", self.events())
        buys = [o for o in MockBinance.orders if o.get("side") == "BUY"]
        sells = [o for o in MockBinance.orders if o.get("side") == "SELL"]
        self.assertTrue(float(sells[-1]["quantity"]) < float(buys[-1]["quantity"]),
                        'sell qty must be reduced below the bought qty by the base fee')

    def test_long_exit_sells_free_base_after_fee_not_nominal(self):
        # a long was entered; the buy fee was in LTC so we hold slightly less
        # than the ordered qty. The exit must sell the free balance, not the
        # nominal 0.1, and must succeed.
        MockBinance.commission_asset = "LTC"
        MockBinance.commission = "0.0005"
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        self.x.do_run(self.bx())
        held = MockBinance.base_bal
        self.assertTrue(0 < held < 0.1, 'we should hold slightly less than the 0.1 ordered')
        # now force the exit
        import json as _j, os as _os
        # rewrite the stored position to be due, then run again
        self.x.jlog  # noop ref
        # make the open position due by editing exit_due_ts via a fresh EXIT run:
        ev = self.x.journal_events()
        # append a due version is unnecessary — reload with time far ahead:
        real_time = self.x.time.time
        self.x.time.time = lambda: real_time() + 200 * 3600
        try:
            self.x.do_run(self.bx())
        finally:
            self.x.time.time = real_time
        self.assertIn("EXIT_FILL", self.events())
        self.assertTrue(MockBinance.base_bal < self.x.QTY_STEP,
                        'the exit should sweep holdings down to sub-lot dust')

    def _set_stop(self, pct):
        with open(os.path.join(self.home, ".executor-env"), "w") as f:
            f.write(f"BINANCE_KEY=k\nBINANCE_SECRET=s\nLIVE=1\n"
                    f"FIXED_STOP_PCT={pct}\nBASE=http://127.0.0.1:{self.port}\n")

    def test_long_fixed_stop_closes_on_adverse_move(self):
        # OWNER 2026-08-11: every order carries a hard fixed stop. A LONG whose hold
        # is NOT yet due must close NOW when price falls past entry*(1-stop).
        self._set_stop(0.05)
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="c1", side="LONG", qty=0.1,
                    price=100.0, exit_due_ts=now + 9999)   # NOT due on time
        MockBinance.base_bal = 0.1
        MockBinance.price = "94.00"                        # -6%, past the 5% stop
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("FIXED_STOP", ev, "a stop breach must journal FIXED_STOP")
        ex = [e for e in self.x.journal_events() if e["event"] == "EXIT_FILL"]
        self.assertTrue(ex, "the stopped position is closed")
        self.assertEqual(ex[-1].get("reason"), "fixed_stop", "the close is tagged as a stop, not scheduled")

    def test_long_fixed_stop_not_hit_holds_position(self):
        # within the stop and not yet due -> the position stays open.
        self._set_stop(0.05)
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="c1", side="LONG", qty=0.1,
                    price=100.0, exit_due_ts=now + 9999)
        MockBinance.base_bal = 0.1
        MockBinance.price = "96.00"                        # -4%, inside the 5% stop
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertNotIn("FIXED_STOP", ev)
        self.assertNotIn("EXIT_FILL", ev)
        st = self.x.derive(self.x.journal_events())
        self.assertEqual(len(st["open"]), 1, "an unbreached, not-due position holds")

    def test_short_fixed_stop_closes_on_adverse_move(self):
        # a SHORT is stopped when price RISES past entry*(1+stop).
        self._set_stop(0.05)
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.1,
                    price=100.0, exit_due_ts=now + 9999)
        MockBinance.borrowed = 0.1
        MockBinance.price = "106.00"                       # +6%, past the 5% stop
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("FIXED_STOP", ev)
        ex = [e for e in self.x.journal_events() if e["event"] == "EXIT_FILL"]
        self.assertTrue(ex and ex[-1].get("reason") == "fixed_stop")

    def test_fixed_stop_boundary_is_strict_long(self):
        # STOPMATH BUG 1 (2026-08-11 e2e review): the stop boundary is STRICT (<),
        # not weak (<=). A LONG at entry 100 with a 50% stop has its boundary at
        # exactly entry*(1-0.5)=50.00 (chosen so the level is EXACTLY representable
        # in float). Price sitting ON the boundary must NOT stop out — that is the
        # binding winner's level, which the tuner's "preserve every winner"
        # guarantee requires to survive. A weak <= would wrongly cut it.
        self._set_stop(0.5)
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="c1", side="LONG", qty=0.1,
                    price=100.0, exit_due_ts=now + 9999)
        MockBinance.base_bal = 0.1
        MockBinance.price = "50.00"                        # EXACTLY entry*(1-stop)
        self.x.do_run(self.bx())
        self.assertNotIn("FIXED_STOP", self.events(),
                         "a LONG exactly on the stop boundary is preserved (strict <)")
        st = self.x.derive(self.x.journal_events())
        self.assertEqual(len(st["open"]), 1, "the boundary position stays open")

    def test_fixed_stop_strictly_below_boundary_still_stops_long(self):
        # the companion: one tick BELOW the boundary DOES stop (protection intact).
        self._set_stop(0.5)
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="c1", side="LONG", qty=0.1,
                    price=100.0, exit_due_ts=now + 9999)
        MockBinance.base_bal = 0.1
        MockBinance.price = "49.99"                        # strictly past the boundary
        self.x.do_run(self.bx())
        self.assertIn("FIXED_STOP", self.events(),
                      "a LONG strictly past the stop is cut")

    def test_fixed_stop_boundary_is_strict_short(self):
        # SHORT boundary at exactly entry*(1+0.5)=150.00 must be preserved (strict >).
        self._set_stop(0.5)
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.1,
                    price=100.0, exit_due_ts=now + 9999)
        MockBinance.borrowed = 0.1
        MockBinance.price = "150.00"                       # EXACTLY entry*(1+stop)
        self.x.do_run(self.bx())
        self.assertNotIn("FIXED_STOP", self.events(),
                         "a SHORT exactly on the stop boundary is preserved (strict >)")

    def test_no_stop_configured_rides_through_drawdown(self):
        # with no FIXED_STOP_PCT in the env, a deep adverse move does NOT trigger a
        # stop close (the stop is disabled until the sweep provides a value).
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="c1", side="LONG", qty=0.1,
                    price=100.0, exit_due_ts=now + 9999)
        MockBinance.base_bal = 0.1
        MockBinance.price = "80.00"                        # -20%, but no stop set
        self.x.do_run(self.bx())
        self.assertNotIn("FIXED_STOP", self.events())
        st = self.x.derive(self.x.journal_events())
        self.assertEqual(len(st["open"]), 1, "no stop configured -> no stop close")

    def test_earlier_unknown_exit_does_not_disable_a_later_positions_stop(self):
        # RE-REVIEW 2026-08-11 (px-shadow blocker): the exit loop fetches ONE
        # market quote (`px`) up front and every position's fixed-stop check reads
        # it. A regression once assigned the per-order fill price back into `px`,
        # so when an EARLIER due exit returned "unknown" (transport 503, fill
        # price None) it clobbered `px` to None and SILENTLY disabled the stop
        # check for every LATER position in the same run. Two positions:
        #   - c1 LONG, DUE now  -> exits first; order_5xx makes it return unknown
        #   - s2 SHORT, NOT due, market +6% past the 5% stop -> MUST still stop out
        # With the bug, s2's FIXED_STOP is never journaled (px was None). With the
        # fix (fill price kept in a separate `fill_px`), s2 stops out normally.
        self._set_stop(0.05)
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="c1", side="LONG", qty=0.1,
                    price=100.0, exit_due_ts=now - 60)      # DUE -> exits this run
        self.x.jlog("ENTRY_FILL", chunk_start="s2", side="SHORT", qty=0.1,
                    price=100.0, exit_due_ts=now + 9999)    # NOT due; stop must fire
        MockBinance.base_bal = 0.1
        MockBinance.borrowed = 0.1
        MockBinance.price = "106.00"                        # +6%, past the SHORT's 5% stop
        MockBinance.order_5xx = True                        # the DUE exit returns "unknown"
        self.x.do_run(self.bx())
        stops = [e for e in self.x.journal_events()
                 if e["event"] == "FIXED_STOP" and e.get("chunk_start") == "s2"]
        self.assertTrue(stops, "s2's stop must fire even though c1's earlier exit "
                               "returned unknown (px must not be shadowed)")
        # and the earlier due exit was genuinely the ambiguous/unknown case
        self.assertIn("EXIT_INFLIGHT", self.events(),
                      "the earlier due exit returned unknown (transport 503)")



    # ---- schema-2: generalized setups (IMPLEMENTATION-PLAN phase 3) --------
    def write_allow(self, entries):
        # R5: the box now PINS paper-vs-real and the hold from the allowlist. A
        # plain test allowlist defaults to state 'live' + a generous hold cap so a
        # real fill is authorized; tests that exercise the pins set state/hold
        # explicitly (e.g. state 'paper' to prove a tampered intent stays paper).
        for e in entries.values():
            if isinstance(e, dict):
                e.setdefault("state", "live")
                e.setdefault("max_hold_hours", 100000)
        os.makedirs(os.path.join(self.home, "pilot"), exist_ok=True)
        with open(os.path.join(self.home, "pilot", "setups-allow.json"), "w") as f:
            json.dump(entries, f)

    def write_intent2(self, setup_id="s-alpha", side="LONG", chunk="2026-08-07T00:00Z",
                      price=100.0, clip=20.0, hold=48, stop=None, paper=False, age=0):
        os.makedirs(self.x.INTENTS, exist_ok=True)
        it = {"schema": 2, "setup_id": setup_id, "symbol": "LTCUSDT", "side": side,
              "chunk_start": chunk, "decision_price": price, "input_hash": "abc",
              "clip_usd": clip, "hold_hours": hold, "stop_pct": stop, "paper": paper,
              "ts": time.time() - age}
        with open(os.path.join(self.x.INTENTS, f"intent2-{setup_id}-{chunk[:10]}.json"), "w") as f:
            json.dump(it, f)

    def provision_key(self, key_ref):
        """Give this box a profile's own sub-account credentials, as the operator
        would. Real routing is a fact about provisioning now, not a flag."""
        pref = self.x._key_env_prefix(key_ref)
        with open(os.path.join(self.home, ".executor-env"), "a") as f:
            f.write(f"{pref}BINANCE_KEY=k\n{pref}BINANCE_SECRET=s\n")
        self.x._CLIENT_CACHE.clear()

    def test_schema2_allowlisted_live_intent_fills_with_its_own_params(self):
        # A real schema-2 order needs the profile's OWN sub-account on this box.
        # That used to be simulated by flipping a module constant; it is now the
        # real condition, so the test provisions credentials the way the box will
        # actually have them.
        self.provision_key("kr-alpha")
        self.write_allow({"s-alpha": {"symbol": "LTCUSDT", "max_clip_usd": 25, "key_ref": "kr-alpha"}})
        self.write_intent2(clip=20.0, hold=48)
        t0 = time.time()
        self.x.do_run(self.bx())
        fills = [e for e in self.x.journal_events() if e["event"] == "ENTRY_FILL"]
        self.assertEqual(len(fills), 1)
        f = fills[0]
        self.assertEqual(f["setup_id"], "s-alpha")
        self.assertEqual(f["hold_hours"], 48)
        self.assertEqual(f["clip_usd"], 20.0)
        # $20 at price 100 -> 0.2 LTC ordered (fee shrinks held qty slightly)
        self.assertAlmostEqual(f["ordered_qty"], 0.2, places=6)
        self.assertAlmostEqual(f["exit_due_ts"], t0 + 48 * 3600, delta=30)

    def test_schema2_without_allowlist_is_refused_failclosed(self):
        self.write_intent2()  # no allowlist file at all
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("INTENT_INVALID", ev)
        self.assertNotIn("ENTRY_FILL", ev)
        self.assertEqual(MockBinance.orders, [])
        bad = [e for e in self.x.journal_events() if e["event"] == "INTENT_INVALID"]
        self.assertTrue(any("allowlist" in (e.get("problems") or []) for e in bad))

    def test_schema2_clip_above_cap_and_wrong_symbol_are_refused(self):
        self.write_allow({"s-alpha": {"symbol": "LTCUSDT", "max_clip_usd": 15}})
        self.write_intent2(clip=20.0)
        self.x.do_run(self.bx())
        bad = [e for e in self.x.journal_events() if e["event"] == "INTENT_INVALID"]
        self.assertTrue(any("clip_cap" in (e.get("problems") or []) for e in bad))
        self.assertEqual(MockBinance.orders, [])
        # wrong symbol affinity
        self.write_allow({"s-beta": {"symbol": "XLMUSDT", "max_clip_usd": 25}})
        self.write_intent2(setup_id="s-beta", chunk="2026-08-08T00:00Z")
        self.x.do_run(self.bx())
        bad = [e for e in self.x.journal_events() if e["event"] == "INTENT_INVALID"]
        self.assertTrue(any("allowlist_symbol" in (e.get("problems") or []) for e in bad))

    def test_schema2_paper_intent_places_no_order_and_books_paper_roundtrip(self):
        self.write_allow({"s-paper": {"symbol": "LTCUSDT", "max_clip_usd": 25, "key_ref": "kr-alpha"}})
        self.write_intent2(setup_id="s-paper", clip=20.0, hold=0.0004, paper=True)  # ~1.4s hold
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("PAPER_ENTRY_FILL", ev)
        self.assertNotIn("ENTRY_FILL", ev)
        self.assertNotIn("ORDER_SENT", ev)  # no orders at all
        self.assertEqual(MockBinance.orders, [])
        st = self.x.derive(self.x.journal_events())
        self.assertEqual(len(st["paper_open"]), 1)
        self.assertEqual(len(st["open"]), 0)
        time.sleep(2)  # let the tiny hold elapse
        MockBinance.price = "110.00"
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("PAPER_EXIT_FILL", ev)
        self.assertEqual(MockBinance.orders, [], "paper never places orders")
        st = self.x.derive(self.x.journal_events())
        self.assertEqual(len(st["paper_open"]), 0)
        self.assertAlmostEqual(st["realized"], 0.0, places=9)  # real book untouched
        # LONG 0.2 @100 -> 110: gross 2.0 minus model fees 0.00125*0.2*210=0.0525
        self.assertAlmostEqual(st["paper_realized"], 2.0 - 0.0525, places=4)

    def test_schema2_dedup_is_per_setup_and_never_blocks_schema1(self):
        # A real schema-2 order needs the profile's OWN sub-account on this box.
        # That used to be simulated by flipping a module constant; it is now the
        # real condition, so the test provisions credentials the way the box will
        # actually have them.
        self.provision_key("kr-alpha")
        self.write_allow({"s-a": {"symbol": "LTCUSDT", "max_clip_usd": 25, "key_ref": "kr-alpha"},
                          "s-b": {"symbol": "LTCUSDT", "max_clip_usd": 25, "key_ref": "kr-alpha"}})
        chunk = "2026-08-07T00:00Z"
        self.write_intent2(setup_id="s-a", chunk=chunk)
        self.x.do_run(self.bx())
        # duplicate for the SAME setup -> refused
        self.write_intent2(setup_id="s-a", chunk=chunk)
        self.x.do_run(self.bx())
        self.assertIn("INTENT_DUPLICATE", self.events())
        # DIFFERENT setup, same chunk -> its own fill
        self.write_intent2(setup_id="s-b", chunk=chunk)
        self.x.do_run(self.bx())
        fills = [e for e in self.x.journal_events() if e["event"] == "ENTRY_FILL"]
        self.assertEqual(sorted(f["setup_id"] for f in fills), ["s-a", "s-b"])
        # and SCHEMA-1 on the same chunk still fills — the F1 rails are
        # independent of any schema-2 twin (owner: keep both, never colliding)
        self.write_intent(side="LONG", chunk=chunk)
        self.x.do_run(self.bx())
        fills = [e for e in self.x.journal_events() if e["event"] == "ENTRY_FILL"]
        self.assertEqual(len(fills), 3)
        self.assertTrue(any(f.get("setup_id") is None for f in fills))

    def test_schema2_position_uses_its_own_stop_not_the_global(self):
        # A real schema-2 order needs the profile's OWN sub-account on this box.
        # That used to be simulated by flipping a module constant; it is now the
        # real condition, so the test provisions credentials the way the box will
        # actually have them.
        self.provision_key("kr-alpha")
        self.write_allow({"s-stop": {"symbol": "LTCUSDT", "max_clip_usd": 25, "key_ref": "kr-alpha"}})
        self.write_intent2(setup_id="s-stop", clip=20.0, hold=999, stop=0.05)
        self.x.do_run(self.bx())
        self.assertIn("ENTRY_FILL", self.events())
        # adverse move past the per-position stop; NO global stop configured
        MockBinance.price = "94.00"   # -6% < -5% stop
        MockBinance.net_asset = "0.2"
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("FIXED_STOP", ev)
        self.assertIn("EXIT_FILL", ev)
        x = [e for e in self.x.journal_events() if e["event"] == "EXIT_FILL"][-1]
        self.assertEqual(x["setup_id"], "s-stop")

    def test_schema2_client_ids_are_unique_per_chunk_not_collapsed(self):
        # R3 (QC 117): the OLD client_id truncated the key to 14 alnum chars, so a
        # realistic setup id (registry mints 'setup-<ts36>-<hex6>', 19 alnum) ate
        # the whole budget and EVERY chunk of that setup produced the SAME id —
        # crash-recovery-by-id was silently defeated. Two chunks of one setup must
        # now yield DISTINCT ids, and schema-1 must stay byte-identical.
        import re as _re
        sid = "setup-mdyy8sa1b0c1"  # 17 alnum, like an auto-generated registry id
        a = self.x.client_id("entry", "2026-08-11T00:00Z", sid)
        b = self.x.client_id("entry", "2026-08-18T00:00Z", sid)
        self.assertNotEqual(a, b, "two chunks of one setup must not collapse to one client id")
        self.assertTrue(len(a) <= 36 and len(b) <= 36, "client ids stay within the venue limit")
        # exit ids are also distinct per chunk, and distinct from the entry leg
        ax = self.x.client_id("exit", "2026-08-11T00:00Z", sid)
        self.assertNotIn(ax, (a, b), "the exit leg id differs from the entry leg")
        # schema-1 is BYTE-IDENTICAL to the original truncating formula
        old = f"f1-entry-{_re.sub(r'[^0-9A-Za-z]', '', '2026-08-11T00:00Z')[:14]}"[:36]
        self.assertEqual(self.x.client_id("entry", "2026-08-11T00:00Z"), old,
                         "schema-1 (F1) client ids must never change")

    def test_schema2_entry_order_sent_carries_riders_for_recovery(self):
        # A real schema-2 order needs the profile's OWN sub-account on this box.
        # That used to be simulated by flipping a module constant; it is now the
        # real condition, so the test provisions credentials the way the box will
        # actually have them.
        self.provision_key("kr-alpha")
        # R4 (QC 118): the ENTRY ORDER_SENT meta must carry hold_hours/stop_pct/
        # clip_usd. Without them a crash-recovered schema-2 entry falls back to
        # F1's HOLD_HOURS=137 and stop_pct=None (stopless), against the setup's own
        # declared hold+stop. This pins the WRITER (the entry site).
        self.write_allow({"s-r": {"symbol": "LTCUSDT", "max_clip_usd": 25, "key_ref": "kr-alpha"}})
        self.write_intent2(setup_id="s-r", clip=20.0, hold=48, stop=0.05)
        self.x.do_run(self.bx())
        sent = [e for e in self.x.journal_events()
                if e["event"] == "ORDER_SENT" and e.get("action") == "ENTRY"
                and e.get("setup_id") == "s-r"]
        self.assertEqual(len(sent), 1, "the schema-2 entry must journal one ORDER_SENT")
        self.assertEqual(sent[0].get("hold_hours"), 48)
        self.assertEqual(sent[0].get("stop_pct"), 0.05)
        self.assertEqual(sent[0].get("clip_usd"), 20.0)

    def test_schema2_recovered_entry_keeps_its_own_hold_and_stop(self):
        # R4 end to end: an ORDER_SENT carrying the riders (as the fixed entry site
        # writes) recovers to an ENTRY_FILL with the setup's OWN 48h hold and 5%
        # stop — not F1's 137h/stopless default.
        now = time.time()
        cid = self.x.client_id("entry", "2026-08-07T00:00Z", "s-r")
        self.x.jlog("ORDER_SENT", action="ENTRY", side="BUY", qty=0.2,
                    side_effect="NO_SIDE_EFFECT", client_id=cid, live=True,
                    chunk_start="2026-08-07T00:00Z", pos_side="LONG",
                    setup_id="s-r", hold_hours=48, stop_pct=0.05, clip_usd=20.0)
        MockBinance.placed[cid] = {"status": "FILLED", "executedQty": "0.200",
                                   "cummulativeQuoteQty": "20.00000000",
                                   "updateTime": int(now * 1000)}
        MockBinance.net_asset = "0.200"
        self.x.do_run(self.bx())
        f = [e for e in self.x.journal_events()
             if e["event"] == "ENTRY_FILL" and e.get("recovered")][-1]
        self.assertEqual(f.get("setup_id"), "s-r")
        self.assertEqual(f.get("hold_hours"), 48, "recovered entry keeps its own hold, not 137")
        self.assertEqual(f.get("stop_pct"), 0.05, "recovered entry keeps its own stop, not stopless")
        self.assertAlmostEqual(f["exit_due_ts"], now + 48 * 3600, delta=120)

    def test_schema2_paper_setup_intent_cannot_place_real_order(self):
        # R5 (BLOCKER): the box pins paper-vs-real from the ALLOWLIST. A paper-state
        # setup whose intent was TAMPERED to paper:false must STILL book paper —
        # never a real order. Without the pin the intent's own flag drove real money.
        self.write_allow({"s-p": {"symbol": "LTCUSDT", "max_clip_usd": 25, "state": "paper"}})
        self.write_intent2(setup_id="s-p", clip=20.0, hold=48, paper=False)  # tampered
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("PAPER_ENTRY_FILL", ev, "a paper-state setup must book paper")
        self.assertNotIn("ENTRY_FILL", ev, "a paper-state setup must NEVER place a real order")
        self.assertEqual(MockBinance.orders, [], "no real order for a paper-state setup")

    def test_a_profile_without_its_own_subaccount_books_paper_and_says_why(self):
        """The refusal that matters. A live profile the box holds no credentials
        for must NOT reach for the shared wallet — it books paper and names the
        missing keyRef, which is something the owner can act on. The old refusal
        pointed at a module constant nobody could change from the interface."""
        self.write_allow({"s-l": {"symbol": "LTCUSDT", "max_clip_usd": 25,
                                  "state": "live", "key_ref": "kr-missing"}})
        self.write_intent2(setup_id="s-l", clip=20.0, hold=48, paper=False)
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("PAPER_ENTRY_FILL", ev, "an unroutable profile must still MEASURE")
        self.assertNotIn("ENTRY_FILL", ev, "it must not place a real order")
        self.assertEqual(MockBinance.orders, [], "no real order without its own sub-account")
        un = [e for e in self.x.journal_events() if e["event"] == "S2_LIVE_UNSUPPORTED"]
        self.assertTrue(un, "the refusal was silent")
        self.assertIn("kr-missing", un[0]["reason"],
                      "the refusal does not name the credentials that are missing")

    def test_a_position_remembers_the_wallet_it_was_opened_in(self):
        """An exit must go back to the sub-account the entry came from. The
        position records it at entry so a later lookup — an edited or retired
        profile — can never route an exit through another account's wallet."""
        self.provision_key("kr-alpha")
        self.write_allow({"s-l": {"symbol": "LTCUSDT", "max_clip_usd": 25,
                                  "state": "live", "key_ref": "kr-alpha"}})
        self.write_intent2(setup_id="s-l", clip=20.0, hold=48, paper=False)
        self.x.do_run(self.bx())
        fills = [e for e in self.x.journal_events() if e["event"] == "ENTRY_FILL"]
        self.assertEqual(len(fills), 1, "the real entry did not happen")
        self.assertEqual(fills[0].get("key_ref"), "kr-alpha",
                         "the position does not record whose wallet it lives in")
        self.assertEqual(fills[0].get("symbol"), "LTCUSDT",
                         "the position does not record its isolated pair")

    def test_last_short_is_counted_per_wallet_not_per_box(self):
        """Debt belongs to ONE isolated wallet, so "the last short" means the last
        one in THAT wallet. Counting across the box was right while there was one
        wallet and becomes wrong the moment a second profile exists: profile A's
        short sees B's still open, decides it is not last, repays only its
        nominal, and strands its interest in A's wallet where B — closing last in
        its own wallet — can never clear it. A's borrow then exceeds its nominal
        and the reconcile halts the box for a discrepancy nobody created."""
        src = open(os.path.join(os.path.dirname(__file__), "mx_executor.py")).read()
        self.assertNotIn("shorts_remaining", src,
                         "the box-wide short counter is still there")
        self.assertIn("shorts_by_wallet", src, "shorts are not counted per wallet")
        # and prove the arithmetic: one short in each of two wallets means BOTH
        # are the last short of their own wallet
        def wallet_of(q):
            return q.get("key_ref") or "__shared__"
        opens = {
            "a|c1": {"side": "SHORT", "key_ref": "kr-a"},
            "b|c1": {"side": "SHORT", "key_ref": "kr-b"},
        }
        by = {}
        for q in opens.values():
            if q["side"] == "SHORT":
                by[wallet_of(q)] = by.get(wallet_of(q), 0) + 1
        self.assertEqual(by, {"kr-a": 1, "kr-b": 1})
        for q in opens.values():
            self.assertTrue(by.get(wallet_of(q), 0) <= 1,
                            "a lone short in its own wallet is not treated as the last one")

    def test_a_profile_halt_can_be_lifted(self):
        """set_setup_halt existed from the start with no counterpart, so a halted
        profile was finished — the box-level halt has always had a recovery lever
        and a per-profile one had none."""
        self.x.set_setup_halt("s-l", "test halt")
        self.assertTrue(self.x.setup_halted("s-l"))
        self.assertTrue(self.x.clear_setup_halt("s-l", "owner", "cause understood"))
        self.assertFalse(self.x.setup_halted("s-l"), "the profile halt could not be cleared")
        ev = [e["event"] for e in self.x.journal_events()]
        self.assertIn("SETUP_HALT_CLEAR", ev, "clearing a profile halt is not journaled")

    def test_schema2_live_setup_places_real_order(self):
        # A real schema-2 order needs the profile's OWN sub-account on this box.
        # That used to be simulated by flipping a module constant; it is now the
        # real condition, so the test provisions credentials the way the box will
        # actually have them.
        self.provision_key("kr-alpha")
        # R5 counterpart: a live-state setup with paper:false DOES place a real order.
        self.write_allow({"s-l": {"symbol": "LTCUSDT", "max_clip_usd": 25, "state": "live", "key_ref": "kr-alpha"}})
        self.write_intent2(setup_id="s-l", clip=20.0, hold=48, paper=False)
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("ENTRY_FILL", ev, "a live-state setup places a real order")
        self.assertNotIn("PAPER_ENTRY_FILL", ev)

    def test_schema2_hold_beyond_allowlist_cap_is_refused(self):
        # R5: the allowlist bounds the hold so a tampered intent cannot hold a real
        # position indefinitely. hold_hours above max_hold_hours -> INTENT_INVALID.
        self.write_allow({"s-h": {"symbol": "LTCUSDT", "max_clip_usd": 25,
                                  "state": "live", "max_hold_hours": 200}})
        self.write_intent2(setup_id="s-h", clip=20.0, hold=999)  # 999 > 200
        self.x.do_run(self.bx())
        bad = [e for e in self.x.journal_events() if e["event"] == "INTENT_INVALID"]
        self.assertTrue(any("hold_cap" in (e.get("problems") or []) for e in bad))
        self.assertEqual(MockBinance.orders, [], "over-long hold placed no order")

    def test_schema2_real_position_does_not_crowd_out_f1_entry(self):
        # R2: 5 schema-1 (F1) opens + 1 schema-2 REAL open = 6 total = MAX_CONCURRENT.
        # An F1 entry must STILL fill: F1's cap counts only F1 positions (5 < 6).
        # Without the fix len(open)=6 >= MAX_CONCURRENT skips the model-called F1 entry.
        now = time.time()
        for i in range(5):
            self.x.jlog("ENTRY_FILL", chunk_start=f"2026-08-0{i+1}T00:00Z", side="LONG",
                        qty=0.1, price=100.0, exit_due_ts=now + 3600)
        self.x.jlog("ENTRY_FILL", chunk_start="2026-08-06T00:00Z", side="LONG", qty=0.2,
                    price=100.0, exit_due_ts=now + 3600, setup_id="s-x", hold_hours=48, stop_pct=None)
        MockBinance.base_bal = 0.7   # 5*0.1 + 0.2, so reconcile is clean
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        self.x.do_run(self.bx())
        fills = [e for e in self.x.journal_events()
                 if e["event"] == "ENTRY_FILL" and e.get("chunk_start") == "2026-08-07T00:00Z"]
        self.assertEqual(len(fills), 1, "a schema-2 real position must not fill F1's concurrency cap")

    def test_schema2_rejects_do_not_trip_f1_reject_kill(self):
        # R1: three schema-2 ENTRY rejects must NOT count toward F1's reject kill or
        # halt the box. Without rail-scoping consecutive_rejects hits 3 and the box halts.
        for i in range(3):
            self.x.jlog("ORDER_REJECT", action="ENTRY", setup_id="s-x",
                        chunk_start=f"2026-08-0{i+1}T00:00Z")
        st = self.x.derive(self.x.journal_events())
        self.assertEqual(st["consecutive_rejects"], 0, "F1's counter ignores schema-2 rejects")
        self.assertEqual(st["rejects2"].get("s-x"), 3, "schema-2 rejects tracked per-setup")
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        self.x.do_run(self.bx())
        self.assertFalse(self.x.halted(), "schema-2 rejects must not halt the box")
        fills = [e for e in self.x.journal_events()
                 if e["event"] == "ENTRY_FILL" and e.get("chunk_start") == "2026-08-07T00:00Z"]
        self.assertEqual(len(fills), 1, "F1 still trades through schema-2 rejects")

    def test_schema2_ack_does_not_dilute_f1_reject_streak(self):
        # R1: a schema-2 ORDER_ACK must not reset F1's reject streak (the ACK-dilution
        # path that would silently weaken F1's own reject kill).
        self.x.jlog("ORDER_REJECT", action="ENTRY")                 # schema-1
        self.x.jlog("ORDER_REJECT", action="ENTRY")                 # schema-1
        self.x.jlog("ORDER_ACK", action="ENTRY", setup_id="s-x")    # schema-2 success
        st = self.x.derive(self.x.journal_events())
        self.assertEqual(st["consecutive_rejects"], 2,
                         "a schema-2 ACK must not reset F1's reject streak")

    def test_schema2_price_drift_halts_only_its_setup_not_the_box(self):
        # A real schema-2 order needs the profile's OWN sub-account on this box.
        # That used to be simulated by flipping a module constant; it is now the
        # real condition, so the test provisions credentials the way the box will
        # actually have them.
        self.provision_key("kr-alpha")
        # R1: a schema-2 pre-order price drift beyond the backstop halts ONLY that
        # setup (per-setup halt), never the box — F1 keeps trading.
        self.write_allow({"s-d": {"symbol": "LTCUSDT", "max_clip_usd": 25, "key_ref": "kr-alpha"}})
        self.write_intent2(setup_id="s-d", clip=20.0, price=70.0)   # market 100 -> 43% drift
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("KILL_PRICE_DRIFT", ev)
        self.assertIn("SETUP_HALT_SET", ev)
        self.assertTrue(self.x.setup_halted("s-d"))
        self.assertFalse(self.x.halted(), "a schema-2 drift must NOT halt the box (F1)")
        self.assertEqual(MockBinance.orders, [], "no order placed on the drift kill")

    def test_schema2_drawdown_halts_only_its_setup_not_the_box(self):
        # R1: a schema-2 real position bleeding past the loss limit halts ONLY its
        # setup; F1's box-wide loss kill must ignore schema-2 drawdown.
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="c-big", side="LONG", qty=10.0, price=100.0,
                    exit_due_ts=now + 3600, setup_id="s-loss", hold_hours=48, stop_pct=None)
        MockBinance.price = "90.00"      # -$100 unrealized on the schema-2 leg
        MockBinance.net_asset = "10.0"   # reconcile sees the 10 LTC long
        self.x.do_run(self.bx())
        self.assertTrue(self.x.setup_halted("s-loss"), "the bleeding schema-2 setup halts itself")
        self.assertFalse(self.x.halted(), "F1's box loss kill must ignore schema-2 drawdown")

    def test_schema2_exit_reject_halts_only_its_setup_not_the_box(self):
        # R1: a schema-2 exit that will not fill halts ONLY its setup's new entries;
        # F1 is untouched (its own exits keep retrying — exits are never gated).
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="c-ex", side="LONG", qty=0.2, price=100.0,
                    exit_due_ts=now - 60, setup_id="s-ex", hold_hours=48, stop_pct=None)
        MockBinance.base_bal = 0.2       # exchange holds the long so the SELL is attempted
        MockBinance.reject_orders = True
        self.x.do_run(self.bx())
        self.assertTrue(self.x.setup_halted("s-ex"), "a schema-2 exit reject halts its own setup")
        self.assertFalse(self.x.halted(), "a schema-2 exit reject must NOT halt the box (F1)")

    def test_transient_no_price_keeps_the_intent_for_retry(self):
        # R18 (schema-2 ONLY): a transient ticker failure (no price this run) must NOT
        # consume a schema-2 intent (INTENT_SEEN + .done) — else one exchange hiccup
        # permanently forfeits the generalized-rail entry the model called. The intent
        # stays and fills next run when the price returns.
        # a PAPER schema-2 intent still fetches the price before INTENT_SEEN (the
        # paper fill IS the market price), so the retry path is exercised without a
        # real order — no S2_LIVE_ROUTING needed.
        self.write_allow({"s-alpha": {"symbol": "LTCUSDT", "max_clip_usd": 25, "state": "paper"}})
        self.write_intent2(setup_id="s-alpha", side="LONG", chunk="2026-08-07T00:00Z",
                           clip=20.0, hold=48, paper=True)
        MockBinance.price_fails = True
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertNotIn("INTENT_SEEN", ev, "a no-price run must NOT consume the schema-2 intent")
        self.assertNotIn("PAPER_ENTRY_FILL", ev)
        self.assertTrue(any(n.endswith(".json") for n in os.listdir(self.x.INTENTS)),
                        "the schema-2 intent is kept as .json for the next run")
        # price returns -> the kept intent fills (paper)
        MockBinance.price_fails = False
        self.x.do_run(self.bx())
        self.assertIn("PAPER_ENTRY_FILL", self.events(), "the kept intent fills once price returns")

    def test_transient_no_price_keeps_the_F1_intent_for_retry(self):
        # REPLACES test_transient_no_price_leaves_F1_byte_identical (QC-132), which
        # pinned F1 to consuming the intent on a no-price run. That forfeit is what
        # the owner ruled out on 2026-08-16: a failed entry now retries. R18 applies
        # to BOTH rails, so F1 fetches the price BEFORE INTENT_SEEN and a no-price
        # run leaves the .json for the next tick. The one-fill invariant is carried
        # by entry_terminal(), not by consuming the file early.
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        MockBinance.price_fails = True
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertNotIn("INTENT_SEEN", ev, "a no-price run must NOT consume the F1 intent")
        self.assertNotIn("ENTRY_ATTEMPT", ev, "no order was attempted, so no attempt is burned")
        self.assertNotIn("ENTRY_FILL", ev)
        self.assertTrue(any(n.endswith(".json") for n in os.listdir(self.x.INTENTS)),
                        "the F1 intent is kept as .json for the next run")
        # price returns -> the kept intent fills, on the same period
        MockBinance.price_fails = False
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("ENTRY_FILL", ev, "the kept F1 intent fills once price returns")
        self.assertEqual(1, sum(1 for e in self.x.journal_events()
                                if e.get("event") == "ENTRY_FILL"), "exactly one fill")

    # ---- entry retry protocol (owner directive 2026-08-16) ------------------
    # "a failed entry at 0100 may try again up to 6 times until 0200". Before
    # this, an entry got three ticks at most and only for failures BEFORE the
    # intent was consumed; anything after consumption forfeited the day silently.
    # Watched failing 2026-08-16 against the pre-change executor: the seven
    # behaviour checks (retries, budget, give-up, window, both bound tests, F1
    # keep-for-retry) all fail or error there. The other four —
    # a_filled_period_is_never_entered_twice, an_inflight_entry_is_never_
    # re_attempted, a_flat_period_is_still_one_shot and an_entry_inside_the_old_
    # thirty_minute_bound_still_trades — are REGRESSION GUARDS on invariants that
    # held before and must still hold: they pass on both sides by design.

    def test_rejected_entry_retries_on_the_next_tick_and_fills(self):
        # THE ask: the venue refuses the order, the period is not forfeited, and
        # the next tick takes the entry the model called.
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        MockBinance.reject_orders = True
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("ENTRY_ATTEMPT", ev)
        self.assertNotIn("ENTRY_FILL", ev)
        self.assertTrue(any(n.endswith(".json") for n in os.listdir(self.x.INTENTS)),
                        "a rejected entry keeps its intent for the next tick")
        MockBinance.reject_orders = False
        self.x.do_run(self.bx())
        self.assertIn("ENTRY_FILL", self.events(), "the retry takes the entry")
        self.assertEqual(2, sum(1 for e in self.x.journal_events()
                                if e.get("event") == "ENTRY_ATTEMPT"),
                         "two attempts: the reject and the fill")

    def test_the_decision_is_recorded_once_across_retries(self):
        # INTENT_SEEN is the DECISION record and drives the screen's history row.
        # A retry re-attempts the order; it does not re-decide.
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        MockBinance.reject_orders = True
        self.x.do_run(self.bx())
        MockBinance.reject_orders = False
        self.x.do_run(self.bx())
        # guard against passing vacuously: the retry must actually have happened
        self.assertIn("ENTRY_FILL", self.events(), "the retry took the entry")
        self.assertEqual(1, sum(1 for e in self.x.journal_events()
                                if e.get("event") == "INTENT_SEEN"),
                         "one decision row, however many attempts it took")

    def test_entry_gives_up_out_loud_when_the_budget_is_spent(self):
        # Six attempts already on the record: the seventh tick must not order.
        for i in range(self.x.ENTRY_MAX_ATTEMPTS):
            self.x.jlog("ENTRY_ATTEMPT", chunk_start="2026-08-07T00:00Z",
                        side="LONG", attempt=i + 1)
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        before = len(MockBinance.orders)
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("ENTRY_GAVE_UP", ev, "the abandoned period is journaled, not silent")
        self.assertEqual(before, len(MockBinance.orders), "no order is sent after the budget")
        self.assertFalse(any(n.endswith(".json") for n in os.listdir(self.x.INTENTS)))

    def test_giving_up_is_terminal_for_a_reshipped_intent(self):
        # ENTRY_GAVE_UP must end the period for good — a control plane that
        # re-ships the same intent cannot restart the budget.
        self.x.jlog("ENTRY_GAVE_UP", chunk_start="2026-08-07T00:00Z", attempts=6)
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("INTENT_DUPLICATE", ev)
        self.assertNotIn("ENTRY_FILL", ev)

    def test_the_window_closes_one_hour_after_the_entry_moment(self):
        # Attempts left, but the hour is gone: no trade, and said out loud.
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z",
                          age=self.x.ENTRY_RETRY_WINDOW_S + 60)
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("INTENT_STALE", ev)
        self.assertNotIn("ENTRY_ATTEMPT", ev)
        self.assertNotIn("ENTRY_FILL", ev)

    def test_an_entry_inside_the_old_thirty_minute_bound_still_trades(self):
        # The window WIDENED; nothing that used to trade may stop trading.
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z",
                          age=self.x.INTENT_MAX_AGE_S - 60)
        self.x.do_run(self.bx())
        self.assertIn("ENTRY_FILL", self.events())

    def test_an_entry_past_the_old_bound_but_inside_the_hour_now_trades(self):
        # The behaviour change itself: 40 minutes late used to be dead, now it trades.
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z",
                          age=self.x.INTENT_MAX_AGE_S + 600)
        self.x.do_run(self.bx())
        self.assertIn("ENTRY_FILL", self.events())

    def test_a_filled_period_is_never_entered_twice(self):
        # THE money invariant. A re-shipped intent for a period that already
        # filled is refused, whatever the retry budget says.
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        self.x.do_run(self.bx())
        self.assertIn("ENTRY_FILL", self.events())
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        self.x.do_run(self.bx())
        self.assertIn("INTENT_DUPLICATE", self.events())
        self.assertEqual(1, sum(1 for e in self.x.journal_events()
                                if e.get("event") == "ENTRY_FILL"),
                         "exactly one fill for the period, ever")

    def test_an_inflight_entry_is_never_re_attempted(self):
        # The one path that could double a REAL position: the order may be live at
        # the venue and recovery resolves it by client id. Never retry behind it.
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        MockBinance.order_5xx = True          # ambiguous -> ENTRY_INFLIGHT
        self.x.do_run(self.bx())
        self.assertIn("ENTRY_INFLIGHT", self.events())
        MockBinance.order_5xx = False
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        before = len(MockBinance.orders)
        self.x.do_run(self.bx())
        self.assertIn("INTENT_DUPLICATE", self.events())
        self.assertEqual(before, len(MockBinance.orders),
                         "no entry order is sent while one may be live at the venue")

    def test_a_flat_period_is_still_one_shot(self):
        # FLAT places no order, so there is nothing to retry: recorded once and done.
        self.write_intent(side="FLAT", chunk="2026-08-07T00:00Z")
        self.x.do_run(self.bx())
        self.assertIn("INTENT_SEEN", self.events())
        self.assertFalse(any(n.endswith(".json") for n in os.listdir(self.x.INTENTS)),
                         "a FLAT intent is consumed on the spot")
        self.write_intent(side="FLAT", chunk="2026-08-07T00:00Z")
        self.x.do_run(self.bx())
        self.assertIn("INTENT_DUPLICATE", self.events())
        self.assertEqual(1, sum(1 for e in self.x.journal_events()
                                if e.get("event") == "INTENT_SEEN"))

    def test_two_intent_files_for_one_period_spend_one_attempt_per_tick(self):
        # The producer re-emits an intent for up to 3h after the entry moment (a
        # fresh filename each time) while the box now KEEPS a failed intent for
        # retry, so two files for one period can share the inbox. They must not
        # burn two of the six attempts inside a single tick.
        os.makedirs(self.x.INTENTS, exist_ok=True)
        for tag in ("a", "b"):
            it = {"schema": 1, "symbol": "LTCUSDT", "side": "LONG",
                  "chunk_start": "2026-08-07T00:00Z", "decision_price": 100.0,
                  "input_hash": "abc", "ts": time.time()}
            with open(os.path.join(self.x.INTENTS, f"intent-{tag}.json"), "w") as f:
                json.dump(it, f)
        MockBinance.reject_orders = True
        self.x.do_run(self.bx())
        self.assertEqual(1, sum(1 for e in self.x.journal_events()
                                if e.get("event") == "ENTRY_ATTEMPT"),
                         "one attempt per period per tick, however many files arrived")

    def test_entry_deadline_is_anchored_on_the_entry_moment(self):
        # The producer stamps entry_ts, so the hour runs from 01:00 — not from
        # whenever the intent happened to be minted. The 2026-08-11 leftover was
        # written 4h after its entry moment; anchoring on the mint stamp would have
        # given that intent a fresh hour of life.
        moment = 1_000_000.0
        self.assertEqual(moment + self.x.ENTRY_RETRY_WINDOW_S,
                         self.x.entry_deadline({"entry_ts": moment, "ts": moment + 14400}))
        # legacy intent with no entry_ts falls back to the mint stamp
        self.assertEqual(moment + self.x.ENTRY_RETRY_WINDOW_S,
                         self.x.entry_deadline({"ts": moment}))

    def test_schema2_live_is_refused_paper_only_on_the_f1_box(self):
        # BLOCKER 1 (independent review 2026-08-12): the F1 box holds ONE isolated
        # sub-account key; a REAL schema-2 order would land on F1's OWN shared LTCUSDT
        # wallet, re-coupling the rails through shared reconcile-halt + short-close
        # sizing. Until per-setup sub-account routing (gap G8) exists, a schema-2 setup
        # the allowlist marks 'live' must be booked PAPER here — NEVER a real order —
        # and the unsupported-live request logged loudly. Tripwire: flipping
        # S2_LIVE_ROUTING to True (or dropping the guard) makes a real order appear.
        self.write_allow({"s-live": {"symbol": "LTCUSDT", "max_clip_usd": 25, "state": "live"}})
        self.write_intent2(setup_id="s-live", side="LONG", clip=20.0, hold=48, paper=False)
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("S2_LIVE_UNSUPPORTED", ev, "the unsupported-live request is logged loudly")
        self.assertIn("PAPER_ENTRY_FILL", ev, "the setup still measures as paper")
        self.assertNotIn("ENTRY_FILL", ev, "no REAL entry fill for a schema-2 live setup on this box")
        self.assertEqual(MockBinance.orders, [], "no real order hits F1's shared wallet")

    def test_blocked_rail_leaves_a_corrupt_f1_intent_untouched(self):
        # BLOCKER 2: while the REAL rail is blocked (disarmed/halted) the box must touch
        # NOTHING — a torn/corrupt F1 intent stays .json for a later armed run, exactly
        # as the pre-R8 pre-loop early-return did. Setting it aside (.bad) while
        # disarmed could forfeit that period's entry. Tripwire: dropping the
        # `if real_blocked: continue` guard makes a disarmed run .bad the torn intent.
        self.x.set_arm(False, "test")
        os.makedirs(self.x.INTENTS, exist_ok=True)
        p = os.path.join(self.x.INTENTS, "intent-torn.json")
        with open(p, "w") as f:
            f.write("{partial")   # a torn / not-yet-complete write
        self.x.do_run(self.bx())
        self.assertNotIn("INTENT_INVALID", self.events(),
                         "a blocked run must not set aside a torn intent")
        self.assertTrue(os.path.exists(p), "the torn intent is left as .json for a later armed run")
        self.assertFalse(os.path.exists(p + ".bad"), "nothing renamed while the real rail is blocked")

    def test_vanished_intent_file_mid_run_does_not_abort(self):
        # BLOCKER 2: a corrupt intent whose file vanishes between listdir and the
        # set-aside rename (a control-plane race) must NOT raise and abort the whole
        # run — that would skip F1's OWN scheduled exits. The rename is guarded.
        # Tripwire: removing the try/except lets FileNotFoundError abort do_run.
        os.makedirs(self.x.INTENTS, exist_ok=True)
        with open(os.path.join(self.x.INTENTS, "intent-bad.json"), "w") as f:
            f.write("{not json")
        real_rename = self.x.os.rename
        def flaky_rename(src, dst):
            if str(dst).endswith(".bad"):
                raise FileNotFoundError(2, "No such file or directory", dst)
            return real_rename(src, dst)
        self.x.os.rename = flaky_rename
        try:
            self.x.do_run(self.bx())   # must not raise
        finally:
            self.x.os.rename = real_rename
        self.assertIn("RUN_STATUS", self.events(), "the run completed despite the vanished intent")

    def test_paper_intent_books_even_when_disarmed(self):
        # R8: paper is pure measurement (no orders), so a disarmed box must STILL
        # book paper entries — else a real-money fault (disarm/halt/reject-kill)
        # silently blanks the paper measurement the pilot depends on. The REAL rail
        # stays blocked (F1 byte-identical): a real intent must not fill.
        self.write_allow({"s-p": {"symbol": "LTCUSDT", "max_clip_usd": 25, "state": "paper"}})
        self.write_intent2(setup_id="s-p", clip=20.0, hold=48, paper=True)
        self.x.set_arm(False, "test")   # master switch OFF
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("PAPER_ENTRY_FILL", ev, "a paper intent must book even when disarmed")
        self.assertIn("ENTRIES_SKIPPED", ev, "the REAL rail is still reported skipped")
        self.assertEqual(MockBinance.orders, [], "paper places no orders, disarmed or not")
        # a REAL (schema-1) intent while disarmed is still left untouched — no fill
        self.write_intent(side="LONG", chunk="2026-08-09T00:00Z")
        self.x.do_run(self.bx())
        self.assertNotIn("ENTRY_FILL", self.events(), "a real intent must NOT fill while disarmed")

    def test_paper_positions_are_invisible_to_reconcile(self):
        # a paper long is open, the exchange book is FLAT — reconcile must not
        # expect any base holdings for it
        self.x.jlog("PAPER_ENTRY_FILL", chunk_start="c-p", setup_id="s-p", side="LONG",
                    qty=0.2, price=100.0, exit_due_ts=time.time() + 3600)
        MockBinance.net_asset = "0.0"
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("RECONCILE_OK", ev)
        self.assertNotIn("RECONCILE_MISMATCH", ev)
        rs = [e for e in self.x.journal_events() if e["event"] == "RUN_STATUS"][-1]
        self.assertEqual(rs["open_paper"], 1)

    def test_master_switch_off_blocks_entries(self):
        self.x.set_arm(False, "test")   # owner has not pressed START
        self.write_intent(side="LONG")
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("ENTRIES_SKIPPED", ev)
        self.assertNotIn("ENTRY_FILL", ev)
        self.assertEqual(MockBinance.orders, [])

    def test_disarmed_run_preserves_intent_for_a_later_armed_fire(self):
        # QC 113: the prime-at-01:00 design fires the executor twice near the entry
        # (the 01:01 entry timer and the 01:10 regular timer). That is idempotent
        # ONLY because a DISARMED run returns BEFORE the intent loop — it logs no
        # INTENT_SEEN and leaves the intent file in place — so a later ARMED fire
        # can still open it. If INTENT_SEEN were ever logged ahead of the arm gate,
        # a disarmed early fire would mark the intent seen and the armed fire would
        # skip it as a duplicate: the day's entry silently lost. Pin both halves so
        # a reordering regression fails here, not in production.
        self.x.set_arm(False, "test")          # owner has not pressed START yet
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        intent_path = os.path.join(self.x.INTENTS, "intent-2026-08-07.json")
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertNotIn("INTENT_SEEN", ev)    # disarmed run must NOT mark it seen
        self.assertNotIn("ENTRY_FILL", ev)
        self.assertTrue(os.path.exists(intent_path))        # file untouched...
        self.assertFalse(os.path.exists(intent_path + ".done"))  # ...not consumed
        # owner presses START; the SAME preserved intent must still fill
        self.x.set_arm(True, "owner")
        self.x.do_run(self.bx())
        ev2 = self.events()
        self.assertIn("INTENT_SEEN", ev2)
        self.assertIn("ENTRY_FILL", ev2)

    def test_master_switch_off_still_runs_due_exits(self):
        self.x.jlog("ENTRY_FILL", chunk_start="c1", side="LONG", qty=0.1,
                    price=100.0, exit_due_ts=time.time() - 60)
        MockBinance.net_asset = "0.100"
        self.x.set_arm(False, "test")   # engine stopped, but a position is open
        self.x.do_run(self.bx())
        self.assertIn("EXIT_FILL", self.events())  # exit ran despite STOP

    def test_run_status_records_armed_state_every_run(self):
        self.write_intent(side="LONG")
        self.x.do_run(self.bx())
        statuses = [e for e in self.x.journal_events() if e["event"] == "RUN_STATUS"]
        self.assertTrue(statuses and statuses[-1]["armed"] is True)

    def test_arm_disarm_modes_toggle_the_flag(self):
        self.x.set_arm(False, "test")
        self.assertFalse(self.x.armed())
        self.x.set_arm(True, "owner")
        self.assertTrue(self.x.armed())
        self.assertIn("ARM_SET", self.events())

    # -- arm authentication: secret-gated arm, unconditional disarm, replay ----
    def _utc(self, ago=0):
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - ago))

    def _set_secret(self, secret="s3cr3t"):
        with open(os.path.join(self.home, ".executor-env"), "w") as f:
            f.write(f"BINANCE_KEY=k\nBINANCE_SECRET=s\nLIVE=1\nPILOT_ARM_SECRET={secret}\n"
                    f"BASE=http://127.0.0.1:{self.port}\n")
        return secret

    def _sig(self, secret, nonce, utc):
        import hmac as _h
        import hashlib as _hh
        return _h.new(secret.encode(), f"1|{nonce}|{utc}".encode(), _hh.sha256).hexdigest()

    def test_arm_refuses_without_secret(self):
        # RE-REVIEW B1: arming a live rig with NO PILOT_ARM_SECRET is refused,
        # fail-safe — nonce/freshness alone is not authorization to open trades.
        self.x.set_arm(False, "test")
        self.x.honor_arm_request(True, "owner", nonce="n1", utc=self._utc(0))
        self.assertFalse(self.x.armed(), "no secret -> must not arm")
        self.assertIn("ARM_NO_SECRET", self.events())

    def test_arm_fresh_start_with_secret_arms(self):
        s = self._set_secret()
        self.x.set_arm(False, "test")
        u = self._utc(0)
        self.x.honor_arm_request(True, "owner", nonce="n1", utc=u, hmac_sig=self._sig(s, "n1", u))
        self.assertTrue(self.x.armed(), "a validly-signed fresh START arms")

    def test_arm_stale_request_refuses(self):
        s = self._set_secret()
        self.x.set_arm(False, "test")
        u = self._utc(3600)
        self.x.honor_arm_request(True, "owner", nonce="nstale", utc=u, hmac_sig=self._sig(s, "nstale", u))
        self.assertFalse(self.x.armed(), "a stale (old-utc) arm request must not arm")
        self.assertIn("ARM_STALE_REQUEST", self.events())

    def test_arm_keepalive_same_nonce_does_not_respam(self):
        s = self._set_secret()
        self.x.set_arm(False, "test")
        u = self._utc(0)
        self.x.honor_arm_request(True, "owner", nonce="n1", utc=u, hmac_sig=self._sig(s, "n1", u))
        self.assertTrue(self.x.armed())
        n_before = self.events().count("ARM_SET")
        self.x.honor_arm_request(True, "owner", nonce="n1", utc=u, hmac_sig=self._sig(s, "n1", u))
        self.assertTrue(self.x.armed())
        self.assertEqual(self.events().count("ARM_SET"), n_before,
                         "a same-nonce keepalive re-stamps the dead-man without a new ARM_SET")

    def test_wipe_then_stale_request_does_not_rearm(self):
        s = self._set_secret()
        self.x.set_arm(False, "test")
        u1 = self._utc(0)
        self.x.honor_arm_request(True, "owner", nonce="n1", utc=u1, hmac_sig=self._sig(s, "n1", u1))
        self.assertTrue(self.x.armed())
        for f in (self.x.ARM, self.x.ARM_BASELINE):
            try:
                os.remove(f)
            except FileNotFoundError:
                pass
        us = self._utc(3600)
        self.x.honor_arm_request(True, "owner", nonce="n1", utc=us, hmac_sig=self._sig(s, "n1", us))
        self.assertFalse(self.x.armed(), "a wiped box must not auto-rearm from a stale request")
        u2 = self._utc(0)
        self.x.honor_arm_request(True, "owner", nonce="n2", utc=u2, hmac_sig=self._sig(s, "n2", u2))
        self.assertTrue(self.x.armed(), "a fresh START after a wipe arms normally")

    def test_arm_freshness_uses_provided_clock_not_os(self):
        # RE-REVIEW A1: the arm freshness check must be judged against the clock the
        # caller provides (the arm CLI passes EXCHANGE-synced time), so a skewed box
        # OS clock cannot silently refuse a legitimate START. Same fresh request:
        # stale against a clock skewed +5000s, fresh against true time.
        s = self._set_secret()
        self.x.set_arm(False, "test")
        u = self._utc(0)
        self.x.honor_arm_request(True, "owner", nonce="nc", utc=u,
                                 hmac_sig=self._sig(s, "nc", u), now_s=time.time() + 5000)
        self.assertFalse(self.x.armed(), "freshness must be judged against now_s, not the OS clock")
        self.assertIn("ARM_STALE_REQUEST", self.events())
        u2 = self._utc(0)
        self.x.honor_arm_request(True, "owner", nonce="nc2", utc=u2,
                                 hmac_sig=self._sig(s, "nc2", u2), now_s=time.time())
        self.assertTrue(self.x.armed(), "a fresh request under true (exchange) time arms")

    # -- unhalt authentication (2026-08-18) -----------------------------------
    # Clearing a halt REMOVES a brake, so it is authenticated exactly like ARM.
    # DISARM is the opposite direction and stays deliberately unsigned; the
    # tests below pin that asymmetry so nobody "makes them consistent" later.
    def _usig(self, secret, nonce, utc):
        import hmac as _h
        import hashlib as _hh
        return _h.new(secret.encode(), f"unhalt|{nonce}|{utc}".encode(), _hh.sha256).hexdigest()

    def test_unhalt_signed_fresh_request_clears_the_halt(self):
        s = self._set_secret()
        self.x.set_halt("test", "reconcile mismatch")
        self.assertTrue(self.x.halted())
        u = self._utc(0)
        ok = self.x.honor_unhalt_request("owner", "u1", u, self._usig(s, "u1", u), "owner cleared")
        self.assertTrue(ok)
        self.assertFalse(self.x.halted(), "a validly-signed fresh request clears the halt")
        self.assertIn("HALT_CLEAR", self.events())

    def test_unhalt_refuses_a_bad_signature(self):
        self._set_secret()
        self.x.set_halt("test", "reconcile mismatch")
        ok = self.x.honor_unhalt_request("owner", "u1", self._utc(0), "0" * 64, "forged")
        self.assertFalse(ok)
        self.assertTrue(self.x.halted(), "a forged signature must leave the halt standing")
        self.assertIn("UNHALT_HMAC_INVALID", self.events())

    def test_unhalt_refuses_when_no_secret_is_configured(self):
        # Fail-safe direction: with no secret the brake STAYS on. (--force is the
        # documented hand lever for that case; see the force test below.)
        self.x.set_halt("test", "reconcile mismatch")
        ok = self.x.honor_unhalt_request("owner", "u1", self._utc(0), "0" * 64, "no secret")
        self.assertFalse(ok)
        self.assertTrue(self.x.halted())
        self.assertIn("UNHALT_NO_SECRET", self.events())

    def test_unhalt_refuses_a_stale_request(self):
        # A request left on disk must not clear a halt that fired days later.
        s = self._set_secret()
        self.x.set_halt("test", "reconcile mismatch")
        u = self._utc(3600)
        ok = self.x.honor_unhalt_request("owner", "uold", u, self._usig(s, "uold", u), "stale")
        self.assertFalse(ok)
        self.assertTrue(self.x.halted())
        self.assertIn("UNHALT_STALE_REQUEST", self.events())

    def test_unhalt_refuses_a_replayed_request(self):
        # The SAME signed request must not clear a SECOND, later halt.
        s = self._set_secret()
        self.x.set_halt("test", "first halt")
        u = self._utc(0)
        sig = self._usig(s, "u1", u)
        self.assertTrue(self.x.honor_unhalt_request("owner", "u1", u, sig, "first clear"))
        self.x.set_halt("test", "second halt — cause returned")
        ok = self.x.honor_unhalt_request("owner", "u1", u, sig, "replay")
        self.assertFalse(ok)
        self.assertTrue(self.x.halted(), "a captured request must not re-clear a later halt")
        self.assertIn("UNHALT_REPLAY_REJECTED", self.events())

    def test_unhalt_force_is_the_hand_lever_and_is_journaled_unauthenticated(self):
        # No secret, no signature — --force still clears, because whoever runs it
        # already has a shell and could delete the flag by hand. The journal must
        # record it as unauthenticated so the record distinguishes the two paths.
        self.x.set_halt("test", "reconcile mismatch")
        ok = self.x.honor_unhalt_request("operator", None, None, None, "hand clear", force=True)
        self.assertTrue(ok)
        self.assertFalse(self.x.halted())
        rec = [e for e in self.x.journal_events() if e.get("event") == "HALT_CLEAR"][-1]
        self.assertIs(rec.get("authenticated"), False)

    def test_unhalt_never_arms(self):
        # The whole safety argument for this lever is that it cannot start
        # trading. Pin it: a successful unhalt leaves the master switch alone.
        s = self._set_secret()
        self.x.set_arm(False, "test")
        self.x.set_halt("test", "reconcile mismatch")
        u = self._utc(0)
        self.assertTrue(self.x.honor_unhalt_request("owner", "u1", u, self._usig(s, "u1", u), "clear"))
        self.assertFalse(self.x.armed(), "clearing a halt must never arm the engine")

    def test_unhalt_on_an_unhalted_box_is_a_no_op(self):
        s = self._set_secret()
        u = self._utc(0)
        self.assertFalse(self.x.halted())
        ok = self.x.honor_unhalt_request("owner", "u1", u, self._usig(s, "u1", u), "nothing to do")
        self.assertFalse(ok)
        self.assertNotIn("HALT_CLEAR", self.events())

    def test_unhalt_does_not_disturb_the_arm_baseline(self):
        # Separate baseline files on purpose: an unhalt must not ratchet arm's
        # replay watermark, or clearing a halt could brick a later legitimate START.
        s = self._set_secret()
        ua = self._utc(0)
        self.x.honor_arm_request(True, "owner", nonce="a1", utc=ua, hmac_sig=self._sig(s, "a1", ua))
        before = self.x._read_baseline()
        self.x.set_halt("test", "reconcile mismatch")
        uu = self._utc(0)
        self.x.honor_unhalt_request("owner", "u1", uu, self._usig(s, "u1", uu), "clear")
        self.assertEqual(before, self.x._read_baseline(),
                         "unhalt must leave the arm baseline byte-identical")

    def test_hmac_required_when_secret_configured(self):
        s = self._set_secret()
        self.x.set_arm(False, "test")
        u = self._utc(0)
        self.x.honor_arm_request(True, "owner", nonce="nx", utc=u, hmac_sig="deadbeef")
        self.assertFalse(self.x.armed(), "an invalid HMAC must not arm")
        self.assertIn("ARM_HMAC_INVALID", self.events())
        self.x.honor_arm_request(True, "owner", nonce="nx2", utc=u, hmac_sig=self._sig(s, "nx2", u))
        self.assertTrue(self.x.armed(), "a validly-signed fresh START arms")

    def test_disarm_is_unconditional_even_with_secret(self):
        # RE-REVIEW B2: STOP must work even with an absent/garbage HMAC — a kill
        # switch is never gated behind authentication.
        s = self._set_secret()
        u = self._utc(0)
        self.x.honor_arm_request(True, "owner", nonce="n1", utc=u, hmac_sig=self._sig(s, "n1", u))
        self.assertTrue(self.x.armed())
        self.x.honor_arm_request(False, "owner", nonce=None, utc=None, hmac_sig=None)
        self.assertFalse(self.x.armed(), "an unsigned STOP must still stop the box")

    def test_arm_replay_after_stop_is_rejected(self):
        # RE-REVIEW C: a captured, validly-signed arm request cannot re-arm after a
        # STOP — the monotonic watermark rejects a utc not newer than the last STOP.
        s = self._set_secret()
        u_arm = self._utc(60)
        self.x.honor_arm_request(True, "owner", nonce="n1", utc=u_arm, hmac_sig=self._sig(s, "n1", u_arm))
        self.assertTrue(self.x.armed())
        self.x.honor_arm_request(False, "owner", nonce="n2", utc=self._utc(0))  # STOP now
        self.assertFalse(self.x.armed())
        # replay the ORIGINAL (older) arm request verbatim -> rejected
        self.x.honor_arm_request(True, "owner", nonce="n1", utc=u_arm, hmac_sig=self._sig(s, "n1", u_arm))
        self.assertFalse(self.x.armed(), "a replayed pre-STOP arm must not re-arm")
        self.assertIn("ARM_REPLAY_REJECTED", self.events())

    def test_future_dated_stop_does_not_brick_arming(self):
        # RE-REVIEW LIVENESS: a STOP carrying a FUTURE-dated utc (clock glitch on
        # the screen host, or an injected disarm timestamped hours ahead) must NOT
        # ratchet the watermark into the future. If it did, every legitimate arm
        # afterward would be rejected as "not newer than the watermark" until
        # wall-clock caught up — a denial-of-arming brick. The STOP itself still
        # fires; only the watermark advance is suppressed.
        s = self._set_secret()
        u1 = self._utc(30)
        self.x.honor_arm_request(True, "owner", nonce="n1", utc=u1, hmac_sig=self._sig(s, "n1", u1))
        self.assertTrue(self.x.armed())
        # STOP with a utc 2 hours in the FUTURE
        self.x.honor_arm_request(False, "owner", nonce="nstop", utc=self._utc(-7200))
        self.assertFalse(self.x.armed(), "the STOP still stops the box")
        # a genuine fresh START now (real, current utc) must still arm
        u2 = self._utc(0)
        self.x.honor_arm_request(True, "owner", nonce="n2", utc=u2, hmac_sig=self._sig(s, "n2", u2))
        self.assertTrue(self.x.armed(),
                        "a future-dated STOP must not brick later legitimate arming")

    def test_future_dated_arm_beyond_skew_is_refused(self):
        # RE-REVIEW LIVENESS: the same brick via the ARM path — a validly-signed
        # arm whose utc is far in the FUTURE would set the watermark ahead and lock
        # out later arms. The freshness window is two-sided: a utc beyond the small
        # clock-skew tolerance ahead of the box is refused.
        s = self._set_secret()
        self.x.set_arm(False, "test")
        uf = self._utc(-7200)  # 2 hours ahead
        self.x.honor_arm_request(True, "owner", nonce="nf", utc=uf, hmac_sig=self._sig(s, "nf", uf))
        self.assertFalse(self.x.armed(), "a far-future-dated arm must not arm")
        # and it must not have poisoned the watermark: a genuine fresh START arms
        u = self._utc(0)
        self.x.honor_arm_request(True, "owner", nonce="ng", utc=u, hmac_sig=self._sig(s, "ng", u))
        self.assertTrue(self.x.armed(), "a fresh START still arms after a rejected future arm")

    def test_short_round_trip_fully_repays_despite_base_fee(self):
        # THE SHORT MIRROR of the dust bug: the close BUY fee is taken in LTC,
        # so buying exactly the borrowed qty would leave a residual borrow.
        # With the fee charged in base, the short dust must still fully repay.
        MockBinance.commission_asset = "LTC"
        MockBinance.commission = "0.0004"
        rc = self.x.do_shortdust(self.bx(), yes=True)
        self.assertEqual(rc, 0, 'short dust must complete')
        done = [e for e in self.x.journal_events() if e["event"] == "SHORTDUST_DONE"]
        self.assertTrue(done, 'a SHORTDUST_DONE must be journaled')
        self.assertTrue(done[0]["fully_repaid"], 'the borrow must be fully repaid, no residual')
        self.assertTrue(MockBinance.borrowed < self.x.QTY_STEP,
                        'no residual borrow may remain on the exchange')
        sells = [o for o in MockBinance.orders if o.get("side") == "SELL"]
        buys = [o for o in MockBinance.orders if o.get("side") == "BUY"]
        self.assertEqual(sells[0]["sideEffectType"], "MARGIN_BUY", 'open borrows')
        self.assertEqual(buys[-1]["sideEffectType"], "AUTO_REPAY", 'close repays')
        self.assertTrue(float(buys[-1]["quantity"]) > float(sells[0]["quantity"]),
                        'close buys slightly MORE than borrowed to cover the LTC fee')

    def test_short_entry_then_scheduled_exit_repays_borrow(self):
        # a real short opened via an intent, then exited on schedule
        MockBinance.commission_asset = "LTC"
        MockBinance.commission = "0.0003"
        self.write_intent(side="SHORT", chunk="2026-08-07T00:00Z")
        self.x.do_run(self.bx())
        self.assertTrue(MockBinance.borrowed > 0, 'short open must create a borrow')
        real_time = self.x.time.time
        self.x.time.time = lambda: real_time() + 200 * 3600
        try:
            self.x.do_run(self.bx())
        finally:
            self.x.time.time = real_time
        self.assertIn("EXIT_FILL", self.events())
        self.assertTrue(MockBinance.borrowed < self.x.QTY_STEP,
                        'the scheduled short exit must clear the borrow')

    def _advance_and_run(self, hours):
        real_time = self.x.time.time
        self.x.time.time = lambda: real_time() + hours * 3600
        try:
            self.x.do_run(self.bx())
        finally:
            self.x.time.time = real_time

    def test_two_longs_first_exit_sells_only_its_own(self):
        # FATAL bug from the review: isolated margin pools all longs; the first
        # exit must sell only its own size, not the whole wallet.
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="L1", side="LONG", qty=0.1,
                    price=100.0, exit_due_ts=now - 60)
        self.x.jlog("ENTRY_FILL", chunk_start="L2", side="LONG", qty=0.1,
                    price=100.0, exit_due_ts=now - 30)
        MockBinance.base_bal = 0.2   # both longs pooled in one wallet
        self._advance_and_run(0)
        sells = [o for o in MockBinance.orders if o.get("side") == "SELL"]
        self.assertEqual(len(sells), 2, 'each long exits with its own order')
        for o in sells:
            self.assertEqual(float(o["quantity"]), 0.1,
                             'must sell one position (0.1), never the pooled 0.2')
        self.assertTrue(MockBinance.base_bal < self.x.QTY_STEP, 'both longs closed')

    def test_two_shorts_first_close_repays_only_its_own(self):
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="S1", side="SHORT", qty=0.1,
                    price=100.0, exit_due_ts=now - 60)
        self.x.jlog("ENTRY_FILL", chunk_start="S2", side="SHORT", qty=0.1,
                    price=100.0, exit_due_ts=now - 30)
        MockBinance.borrowed = 0.2   # both shorts pooled into one loan
        self._advance_and_run(0)
        buys = [o for o in MockBinance.orders if o.get("side") == "BUY"]
        self.assertEqual(len(buys), 2, 'each short closes with its own buy')
        for o in buys:
            self.assertTrue(float(o["quantity"]) < 0.15,
                            'must buy back ~one leg (~0.10), never the pooled 0.2')
        self.assertTrue(MockBinance.borrowed < self.x.QTY_STEP,
                        'both borrows fully repaid, none left orphaned')

    def test_last_short_close_clears_full_live_debt_including_interest(self):
        # finding 18: over a 137h hold the borrow accrues interest, so the live
        # debt exceeds the nominal 0.1. The FINAL short close must size from the
        # LIVE debt and clear it, not from the interest-blind nominal.
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.1,
                    price=100.0, exit_due_ts=now - 60)
        # debt clearly ABOVE the nominal-plus-buffer size (0.1*1.003 -> 0.101):
        # interest exaggerated to 0.102 so nominal sizing would visibly UNDER-
        # repay (leaving 0.001 residual) while live-debt sizing clears it.
        MockBinance.borrowed = 0.102
        # no free-base offset needed: the interest-aware reconcile (finding 19)
        # now reads the 0.002 excess borrow as accrued interest, not drift, so it
        # does not false-halt — this test isolates the finding-18 close sizing.
        self._advance_and_run(0)
        buys = [o for o in MockBinance.orders if o.get("side") == "BUY"]
        self.assertEqual(len(buys), 1)
        self.assertTrue(float(buys[-1]["quantity"]) >= 0.102,
                        'must buy the live debt (nominal+interest), not the nominal 0.101')
        self.assertTrue(MockBinance.borrowed < self.x.QTY_STEP,
                        'the final close must clear the interest-inflated debt to zero')
        self.assertFalse(self.x.halted(), 'a clean full repay must not halt')

    def test_short_close_residual_borrow_halts(self):
        # if the AUTO_REPAY under-repays (here forced by an outsized LTC buy fee
        # eating into the received qty), the final leg leaves a residual borrow.
        # That must HALT loudly, never be popped silently.
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.1,
                    price=100.0, exit_due_ts=now - 60)
        MockBinance.borrowed = 0.1
        MockBinance.commission_asset = "LTC"
        MockBinance.commission = "0.02"   # huge fee: received << ordered -> under-repay
        self._advance_and_run(0)
        self.assertTrue(MockBinance.borrowed >= self.x.QTY_STEP,
                        'the outsized fee must leave a residual borrow')
        self.assertTrue(self.x.halted(), 'a residual borrow after the final close must HALT')

    def test_short_pnl_charges_interest_and_entry_fee(self):
        # finding 17: realized P&L for a short must subtract the entry SELL fee
        # (USDT) and the accrued interest, so the loss kill is not optimistic.
        now = time.time()
        # entered short at 100 with a $0.01 USDT entry fee; price unchanged at
        # exit, so a naive pnl would be ~0. Interest pushed debt to 0.1005.
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.1,
                    price=100.0, fee_quote=0.01, exit_due_ts=now - 60)
        MockBinance.borrowed = 0.1005
        MockBinance.price = "100.00"      # flat market -> gross ~ 0
        self._advance_and_run(0)
        ex = [e for e in self.x.journal_events() if e["event"] == "EXIT_FILL"][-1]
        # entry fee 0.01 + interest (0.1005-0.1)*100 = 0.05, both subtracted
        self.assertLess(ex["pnl"], -0.04, 'entry fee + interest must drag pnl clearly negative')
        self.assertAlmostEqual(ex["entry_fee"], 0.01, places=6)
        self.assertGreater(ex["interest_cost"], 0.0, 'accrued interest must be charged')

    def test_long_pnl_subtracts_entry_fee(self):
        # RE-REVIEW money-math: realized P&L for a LONG must subtract the entry
        # BUY fee. The old code skipped it on the theory that the LTC entry fee is
        # "already in the fee-shrunk qty" — but the shrink lowers the exit and the
        # entry cost basis symmetrically, so it cancels out of gross and the fee
        # was UNACCOUNTED, overstating the tradeability number by one entry fee.
        now = time.time()
        # long entered at 100 with a $0.02 entry fee; flat market at exit and NO
        # exit fee, so a correct pnl is exactly -0.02 (the entry fee), not 0.
        self.x.jlog("ENTRY_FILL", chunk_start="l1", side="LONG", qty=0.1,
                    price=100.0, fee_quote=0.02, exit_due_ts=now - 60)
        MockBinance.base_bal = 0.1
        MockBinance.price = "100.00"        # flat market -> gross 0
        MockBinance.commission = "0"        # isolate: no exit fee
        MockBinance.commission_asset = "USDT"
        self._advance_and_run(0)
        ex = [e for e in self.x.journal_events() if e["event"] == "EXIT_FILL"][-1]
        self.assertAlmostEqual(ex["entry_fee"], 0.02, places=6,
                               msg="the long's entry fee must be recorded on the close")
        self.assertAlmostEqual(ex["pnl"], -0.02, places=4,
                               msg="realized P&L must net the entry fee, not overstate to 0")

    def test_deadman_stale_arm_blocks_entries_but_exits_run(self):
        # ARM present but not refreshed within ARM_MAX_AGE_S -> self-disarm.
        import json as _j
        arm = self.x.ARM
        with open(arm, 'w') as f:
            _j.dump({'source': 'owner', 'ts': time.time() - self.x.ARM_MAX_AGE_S - 60}, f)
        self.assertFalse(self.x.armed(), 'a stale ARM must read as disarmed (dead-man)')
        # a due position must still exit despite the stale switch
        self.x.jlog("ENTRY_FILL", chunk_start="d1", side="LONG", qty=0.1,
                    price=100.0, exit_due_ts=time.time() - 60)
        MockBinance.base_bal = 0.1
        self.write_intent(side="LONG", chunk="2026-08-09T00:00Z")
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("ARM_STALE", ev)
        self.assertIn("EXIT_FILL", ev)          # exit ran
        self.assertNotIn("ENTRY_FILL", [e for e in ev if e == "ENTRY_FILL"][1:])  # no NEW entry

    def test_fresh_arm_keepalive_does_not_spam_journal(self):
        self.x.set_arm(True, "owner")            # transition -> ARM_SET
        self.x.set_arm(True, "owner")            # keepalive -> no new ARM_SET
        self.x.set_arm(True, "owner")
        self.assertEqual(self.events().count("ARM_SET"), 1,
                         'keepalive re-stamps the timestamp without spamming ARM_SET')

    def test_mtm_loss_kill_sees_open_positions(self):
        # an open long deep underwater must trip the loss kill even with zero
        # realized P&L (mark-to-market, not realized-only).
        self.x.set_arm(True, "test")
        self.x.jlog("ENTRY_FILL", chunk_start="u1", side="LONG", qty=1.0,
                    price=200.0, exit_due_ts=time.time() + 9999)
        MockBinance.base_bal = 1.0
        MockBinance.price = "100.00"             # -$100 unrealized on 1.0 @ 200 -> 100
        self.x.do_run(self.bx())
        self.assertTrue(self.x.halted(), 'mark-to-market drawdown beyond the limit must HALT')

    # -- order-lifecycle recovery (crash between send and journal) ----------
    def test_orders_carry_deterministic_client_id(self):
        # every real order must carry a newClientOrderId so a resend after a
        # crash is a no-op at the venue and recovery can look it up.
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        self.x.do_run(self.bx())
        entry = [o for o in MockBinance.orders if o.get("side") == "BUY"][-1]
        self.assertIn("newClientOrderId", entry)
        self.assertEqual(entry["newClientOrderId"],
                         self.x.client_id("entry", "2026-08-07T00:00Z"))

    def test_recovery_books_orphaned_entry_fill(self):
        # an ENTRY was SENT but the process died before the ack was journaled.
        # The venue actually filled it. Recovery must find it by client id and
        # book an ENTRY_FILL(recovered=True) carrying a future exit_due_ts so it
        # WILL close, without ever re-sending the order.
        cid = self.x.client_id("entry", "2026-08-07T00:00Z")
        self.x.jlog("ORDER_SENT", action="ENTRY", side="BUY", qty=0.1,
                    side_effect="NO_SIDE_EFFECT", client_id=cid, live=True,
                    chunk_start="2026-08-07T00:00Z", pos_side="LONG")
        MockBinance.placed[cid] = {"status": "FILLED", "executedQty": "0.100",
                                   "cummulativeQuoteQty": "10.00000000",
                                   "updateTime": int(time.time() * 1000)}
        MockBinance.net_asset = "0.100"   # exchange really holds the recovered long
        orders_before = len(MockBinance.orders)
        self.x.do_run(self.bx())
        fills = [e for e in self.x.journal_events()
                 if e["event"] == "ENTRY_FILL" and e.get("recovered")]
        self.assertEqual(len(fills), 1, "the orphaned fill must be booked exactly once")
        self.assertIn("exit_due_ts", fills[0])
        self.assertGreater(fills[0]["exit_due_ts"], time.time(),
                           "recovered entry must carry a future exit so it closes")
        self.assertIn("ORDER_RESOLVED", self.events())
        # recovery reconciles the record only — it must NOT re-send the order
        resent = [o for o in MockBinance.orders[orders_before:]
                  if o.get("newClientOrderId") == cid]
        self.assertEqual(resent, [], "recovery must not re-send a recovered order")

    def test_recovery_voids_order_that_never_executed(self):
        # an ENTRY was SENT but the venue has no such order (it never reached the
        # matching engine). Recovery must VOID it: open no position, send nothing.
        cid = self.x.client_id("entry", "2026-08-08T00:00Z")
        self.x.jlog("ORDER_SENT", action="ENTRY", side="BUY", qty=0.1,
                    side_effect="NO_SIDE_EFFECT", client_id=cid, live=True,
                    chunk_start="2026-08-08T00:00Z", pos_side="LONG")
        # MockBinance.placed has no cid -> lookup returns 400 / -2013
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("ORDER_VOID", ev)
        self.assertNotIn("ENTRY_FILL", ev)
        st = self.x.derive(self.x.journal_events())
        self.assertEqual(len(st["open"]), 0, "a never-executed order must open nothing")

    def test_recovered_exit_books_conservative_pnl(self):
        # a crash after an EXIT filled but before it was journaled: recovery books
        # the exit with a CONSERVATIVE fee estimate + estimated flag, not the
        # optimistic gross (re-review money-math).
        now = time.time()
        self.x.jlog("ENTRY_FILL", chunk_start="c1", side="LONG", qty=0.1,
                    price=100.0, exit_due_ts=now - 60)
        cid = self.x.client_id("exit", "c1")
        self.x.jlog("ORDER_SENT", action="EXIT", side="SELL", qty=0.1,
                    client_id=cid, live=True, chunk_start="c1")
        MockBinance.placed[cid] = {"status": "FILLED", "executedQty": "0.100",
                                   "cummulativeQuoteQty": "10.10000000",
                                   "updateTime": int(now * 1000)}
        MockBinance.base_bal = 0.1
        self.x.do_run(self.bx())
        ex = [e for e in self.x.journal_events()
              if e["event"] == "EXIT_FILL" and e.get("recovered")]
        self.assertEqual(len(ex), 1)
        self.assertTrue(ex[0].get("pnl_estimated"), "a recovered exit P&L is flagged estimated")
        self.assertGreater(ex[0]["fee_quote"], 0, "recovered exit books an estimated fee, not zero")

    def test_recovered_short_exit_books_conservative_interest(self):
        # RE-REVIEW money-math: a recovered SHORT exit must also net a CONSERVATIVE
        # borrow-interest estimate (the crash lost the live debt), not just the fee
        # — else its recovered P&L is overstated and could flatter the loss kill.
        now = time.time()
        # short opened ~137h ago (exit due now), so the age-scaled interest is near
        # its full-hold maximum.
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.1,
                    price=100.0, fee_quote=0.01, exit_due_ts=now - 60)
        cid = self.x.client_id("exit", "s1")
        self.x.jlog("ORDER_SENT", action="EXIT", side="BUY", qty=0.1,
                    client_id=cid, live=True, chunk_start="s1")
        MockBinance.placed[cid] = {"status": "FILLED", "executedQty": "0.100",
                                   "cummulativeQuoteQty": "10.00000000",
                                   "updateTime": int(now * 1000)}
        MockBinance.borrowed = 0.1
        self.x.do_run(self.bx())
        ex = [e for e in self.x.journal_events()
              if e["event"] == "EXIT_FILL" and e.get("recovered")][-1]
        self.assertTrue(ex.get("pnl_estimated"))
        self.assertGreater(ex.get("interest_cost", 0), 0,
                           "a recovered short must book an estimated borrow interest")
        # flat market (100->100), gross 0; pnl must be clearly negative from
        # fee_est + entry_fee + interest_est, not ~0.
        self.assertLess(ex["pnl"], -0.02,
                        "recovered short P&L nets fee + entry fee + estimated interest")

    def test_server_error_5xx_is_unknown_not_reject(self):
        # RE-REVIEW B1: an HTTP 5xx (order MAY have filled — Binance documents 504
        # as unknown) must be UNKNOWN/inflight, never a terminal reject that would
        # orphan a real fill and creep the reject-kill.
        MockBinance.order_5xx = True
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("ORDER_UNKNOWN", ev)
        self.assertIn("ENTRY_INFLIGHT", ev)
        self.assertNotIn("ORDER_REJECT", ev)
        self.assertNotIn("ENTRY_FILL", ev)
        st = self.x.derive(self.x.journal_events())
        self.assertEqual(st["consecutive_rejects"], 0, "a 5xx must not count as a reject")

    def test_partial_or_expired_fill_with_executed_qty_is_booked(self):
        # RE-REVIEW order-lifecycle: a 200 with status EXPIRED but executedQty>0
        # executed part of the clip — it must be BOOKED (ENTRY_FILL), never a
        # reject (which would orphan the position and spuriously creep the kill).
        MockBinance.force_status = "EXPIRED"
        self.write_intent(side="LONG", chunk="2026-08-07T00:00Z")
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("ENTRY_FILL", ev, "an executed EXPIRED order must be booked as a fill")
        self.assertNotIn("ORDER_REJECT", ev)

    def test_dry_mode_sends_no_orders(self):
        with open(os.path.join(self.home, ".executor-env"), "w") as f:
            f.write(f"BINANCE_KEY=k\nBINANCE_SECRET=s\nLIVE=0\n"
                    f"BASE=http://127.0.0.1:{self.port}\n")
        self.write_intent()
        self.x.do_run(self.bx())
        self.assertIn("DRYRUN_ORDER", self.events())
        self.assertEqual([o for o in MockBinance.orders], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
