#!/usr/bin/env bash
# Compact status of the generalized paper books (data/books/), with a
# per-rule cross-tab that separates money-wins from class-correct calls —
# the two are different, and the difference is exactly what the accuracy
# column measures. Read-only; 8k-stdout safe.
set -euo pipefail

curl -s http://127.0.0.1:8093/api/books | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(f"declared books all-time: {d[\"declaredCount\"]}")
for b in d["books"]:
    c = b["config"]
    print(f"\nbook #{b.get(\"bookNumber\")} {c[\"pair\"]} {c[\"geometry\"]} status={b[\"status\"]} "
          f"band=±{(b.get(\"bandPct\") or 0):.2f}% verdict={b.get(\"horizonDone\")}/{c[\"horizonPeriods\"]}")
    per = b["periods"]
    settled = [p for p in per if p["status"] == "settled" and not p.get("postHorizon")]
    live = [p for p in per if p.get("live")]
    print(f" periods={len(per)} settled={len(settled)} live={len(live)}")
    for rule in c["rules"]:
        s = b["rules"][rule]
        traded = [p for p in settled if p["calls"][rule] != 0]
        callok = sum(1 for p in traded if p["calls"][rule] == p["actual"])
        winNotCorrect = sum(1 for p in traded if p["pnl"] and p["pnl"][rule] > 0 and p["calls"][rule] != p["actual"])
        aside = [p for p in settled if p["calls"][rule] == 0]
        aside0 = sum(1 for p in aside if p["actual"] == 0)
        print(f" {rule}: trades={s[\"trades\"]} wins={s[\"wins\"]} pnl={s[\"pnl\"]:+.2f} | "
              f"acc={s[\"correct\"]}/{s[\"scored\"]} = tradedCorrect {callok}/{len(traded)} + asideCorrect {aside0}/{len(aside)} | "
              f"wins-with-wrong-class={winNotCorrect}")
'
