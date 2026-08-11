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
    """Scriptable fake venue. Class attrs steer behaviour per test."""
    price = "100.00"
    reject_orders = False
    net_asset = None          # None -> mirror expectations not asserted
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
            na = "0.000" if self.net_asset is None else self.net_asset
            return self._send({"assets": [{
                "baseAsset": {"netAsset": na, "free": na},
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
            qty = params.get("quantity", "0")
            return self._send({"orderId": len(MockBinance.orders),
                               "status": "FILLED",
                               "fills": [{"price": MockBinance.price,
                                          "qty": qty,
                                          "commission": "0.01",
                                          "commissionAsset": "USDT"}]})
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
