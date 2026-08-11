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
            return self._send({"orderId": len(MockBinance.orders),
                               "status": "FILLED",
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
        self.write_intent(age=self.x.INTENT_MAX_AGE_S + 5)
        self.x.do_run(self.bx())
        ev = self.events()
        self.assertIn("INTENT_INVALID", ev)
        self.assertIn("INTENT_STALE", ev)   # LOUD, not silently dropped (finding 3)
        self.assertNotIn("ENTRY_FILL", ev)

    def test_intent_age_uses_exchange_synced_time(self):
        # a FRESH intent (ts=now) must read as stale when exchange time is far
        # ahead of the box OS clock — proving the age check uses exchange-synced
        # time, not the raw OS clock (finding 3).
        MockBinance.time_skew_ms = (self.x.INTENT_MAX_AGE_S + 120) * 1000
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

    def test_vanished_short_still_halts(self):
        # journal thinks a short is open but the exchange has NO borrow — the
        # short vanished; a deficit (not interest) must still halt.
        self.x.jlog("ENTRY_FILL", chunk_start="s1", side="SHORT", qty=0.1,
                    price=100.0, exit_due_ts=time.time() + 9999)
        MockBinance.borrowed = 0.0      # borrow gone
        self.x.do_run(self.bx())
        self.assertIn("RECONCILE_MISMATCH", self.events())
        self.assertTrue(self.x.halted())

    def test_unhalt_clears_the_halt(self):
        self.x.set_halt("test", "stuck")
        self.assertTrue(self.x.halted())
        import sys as _s
        argv = _s.argv
        _s.argv = ["mx", "unhalt", "--source=owner", "--reason=resolved"]
        try:
            self.x.main()
        finally:
            _s.argv = argv
        self.assertFalse(self.x.halted(), 'unhalt must clear the halt flag')
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
