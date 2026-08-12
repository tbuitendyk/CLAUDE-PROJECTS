#!/usr/bin/env bash
# pilot-screen-check.sh -- READ-ONLY: print the pilot screen's key live fields
# from the deployed classifier (net LTC, current price + unrealized P&L, and the
# evaluate/entry timing), so a deploy can be confirmed against the real journal.
set -uo pipefail
curl -sS -m 10 http://127.0.0.1:8093/api/pilot | python3 -c '
import sys, json
d = json.load(sys.stdin)
lp = d.get("ltcPosition") or {}
print("netLtc     :", lp.get("netLtc"), "| long", lp.get("longLtc"), "("+str(lp.get("longCount"))+")",
      "| short", lp.get("shortLtc"), "("+str(lp.get("shortCount"))+")")
print("markPrice  :", d.get("markPrice"), "| unrealizedPnl:", d.get("unrealizedPnl"),
      "| markUtc:", d.get("markUtc"))
ls = d.get("liveStatus") or {}
print("nextEvalUtc:", ls.get("nextEvalUtc"), "(committee decides at window close 00:00)")
print("nextEntryUtc:", ls.get("nextEntryUtc"), "(entry/execution 01:00)")
for p in (d.get("openPositions") or []):
    print("  open:", p.get("side"), "qty", p.get("qty"), "entry", p.get("entry_price"),
          "mark", p.get("markPrice"), "unreal $", p.get("unrealized"))
'
echo "(read-only)"
