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
    net_asset = None          # override netAsset/free; None -> use tracked balances
    base_bal = 0.0            # tracked free LTC after fills
    borrowed = 0.0            # tracked LTC debt (short open borrows, close repays)
    commission = "0.01"
    commission_asset = "USDT"
    orders = []               # captured order params

    def _send(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/v3/time"):
            return self._send({"serverTime": int(time.time() * 1000)})
        if self.path.startswith("/api/v3/ticker/price"):
            return self._send({"symbol": "LTCUSDT", "price": self.price})
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
            return self._send({"orderId": len(MockBinance.orders),
                               "status": "FILLED",
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
        MockBinance.net_asset = None
        MockBinance.base_bal = 0.0
        MockBinance.borrowed = 0.0
        MockBinance.commission = "0.01"
        MockBinance.commission_asset = "USDT"
        MockBinance.orders = []

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
        self.x.jlog("ORDER_REJECT")
        self.x.jlog("ORDER_REJECT")
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
        self.write_intent(age=self.x.INTENT_MAX_AGE_S + 5)
        self.x.do_run(self.bx())
        self.assertIn("INTENT_INVALID", self.events())
        self.assertNotIn("ENTRY_FILL", self.events())

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

    def test_price_drift_beyond_limit_halts_without_order(self):
        self.write_intent(price=90.0)  # market 100 -> 11% drift
        self.x.do_run(self.bx())
        self.assertIn("KILL_PRICE_DRIFT", self.events())
        self.assertTrue(self.x.halted())
        self.assertNotIn("ENTRY_FILL", self.events())

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

    def test_reconcile_mismatch_halts_entries(self):
        MockBinance.net_asset = "0.500"   # exchange says 0.5 LTC, journal says 0
        self.x.do_run(self.bx())
        self.assertIn("RECONCILE_MISMATCH", self.events())
        self.assertTrue(self.x.halted())

    def test_short_exit_pnl_sign(self):
        # short entered at 110, exits at 100 -> profit
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.1,
                    price=110.0, exit_due_ts=time.time() - 1)
        MockBinance.net_asset = "-0.100"
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

    def test_master_switch_off_blocks_entries(self):
        self.x.set_arm(False, "test")   # owner has not pressed START
        self.write_intent(side="LONG")
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("ENTRIES_SKIPPED", ev)
        self.assertNotIn("ENTRY_FILL", ev)
        self.assertEqual(MockBinance.orders, [])

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
