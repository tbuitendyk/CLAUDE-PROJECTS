#!/usr/bin/env bash
# classifier-forwardbooks-read.sh -- READ-ONLY: the forward books' out-of-
# sample record, read through the rules pre-registered in
# reports/FORWARD-BOOKS.md before any forward number existed.
# Trade count is printed FIRST on every book (R3): below the 30-trade floor the
# numbers are shown and NO verdict is claimed.
set -uo pipefail
curl -sS --max-time 900 http://127.0.0.1:8093/api/forwardbooks | python3 -c '
import sys, json, datetime
d = json.load(sys.stdin)
if "error" in d:
    print("ERROR:", d["error"]); sys.exit(0)
f = lambda t: datetime.datetime.utcfromtimestamp(t/1000).strftime("%Y-%m-%d") if t else "n/a"
print("FORWARD BOOKS — out-of-sample money, per $100 book")
print("pre-registration:", d["preregistration"])
print("members trained once on data through", f(d["trainThrough"]), "| scored from", f(d["scoreFrom"]),
      "| no verdict below", d["verdictFloorTrades"], "trades")
for b in d["books"]:
    print()
    print("== %s (%s): %s+%s+%s %s %s" % (b["id"], b["note"], b["combo"]["trade"], b["combo"]["ctx1"],
          b["combo"]["ctx2"], b["branch"]["geometry"], b["branch"]["decision"]))
    c = b["cell"]
    print("   frozen cell: %d-of-%d, %s entry, %s gate, t%dh, band %.2f%%" % (
          c["quorum"], len(b.get("members", [])) or 0, c["entry"], c["gate"], c["tHours"], b["bandPct"]))
    if b.get("pending"):
        print("   PENDING:", b["pending"]); continue
    print("   TRADES: %d over %d forward periods (%s .. %s)" % (b["trades"], b["periods"],
          f(b["firstPeriodTs"]), f(b["lastPeriodTs"])))
    if b.get("thinness"): print("   THIN:", b["thinness"])
    be = b["breakEvenPerLeg"]; hr = b["feeHeadroomPct"]
    print("   R1 forward net money : $%.2f   (wins %s)" % (b["net"], b.get("wins")))
    print("   R2 cost realism      : break-even $%s/leg, headroom %s   [fee charged $%.3f]" % (
          ("%.4f" % be) if be is not None else "n/a", ("%.1f%%" % hr) if hr is not None else "n/a", b["fee"]))
    print("   R5 no-skill controls : always-long $%s | always-short $%s" % (
          ("%.2f" % b["alwaysLong"]) if b["alwaysLong"] is not None else "n/a",
          ("%.2f" % b["alwaysShort"]) if b["alwaysShort"] is not None else "n/a"))
    bt = b["backtest"]
    print("   for contrast, the SPENT backtest that selected it: net $%.2f over %d trades, break-even $%.4f/leg"
          % (bt["net"], bt["trades"], bt["breakEvenPerLeg"]))
'
