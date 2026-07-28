#!/usr/bin/env bash
# classifier-bracketlab-top.sh -- headline reader for the newest Bracket lab
# sweep. Takes NO argument: the deploy helper installed on the box does not
# forward $3 to the script, so classifier-bracketlab-read.sh's docid@N form
# silently falls back to 50 rows and the 8k stdout cap eats the header --
# which is the part that says whether the job is even finished.
#
# Prints, in this order and well inside 8k:
#   * status / plan / perf / failures
#   * top 12 by paper P&L
#   * top 12 by vs-control delta  (the honest ranking: gross P&L is mostly
#     the asset's drift, the delta is what the model actually added)
#   * a recurrence tally over the whole board -- which gate / distance /
#     exit-hour / quorum values keep showing up, and on how many DISTINCT
#     trade assets. A knob that only wins on one asset is a fluke; one that
#     wins across many is a candidate for a declared config.
# Read-only.
set -euo pipefail
ID=$(curl -s http://127.0.0.1:8093/api/batches | python3 -c '
import json, sys
b = json.load(sys.stdin)["batches"]
ids = [x["id"] for x in b if x["id"].startswith("bracketlab-")]
print(ids[0] if ids else "")')
if [ -z "$ID" ]; then echo "no bracketlab docs"; exit 0; fi
curl -s "http://127.0.0.1:8093/api/batch/$ID" > /tmp/bl-top.json
python3 <<'EOF'
import json
from collections import Counter, defaultdict

d = json.load(open("/tmp/bl-top.json"))
p, perf, pl = d["params"], d.get("perf") or {}, d.get("plan") or {}
sizes = [k for k, v in (p.get("sizes") or {}).items() if v]
perm = [k for k, v in (p.get("permute") or {}).items() if v]
print(f"=== {d['id']}  status={d['status']}")
print(f"universe({len(p['universe'])}) sizes={sizes} permuted={perm or 'none'} "
      f"months={p['startMonth']}..{p['endMonth']} promoteK={p['promoteK']} minTrades={p['minTrades']}")
print(f"plan: {pl.get('combos')} combos x {pl.get('branches')} branches = {pl.get('units')} units")
el = (perf.get("elapsedMs") or 0) / 3600000
print(f"perf: phase={perf.get('phase')} units {perf.get('unitsDone')}/{perf.get('unitsTotal')} "
      f"rate={round(perf.get('ratePerMin') or 0, 1)}/min elapsed={el:.2f}h")
fails = d.get("failures") or []
print(f"failures: {len(fails)}" + (f"  first={fails[0]['key']}: {fails[0]['error'][:50]}" if fails else ""))

L = d.get("leaders") or []
def combo(l):
    return l["trade"] + ("+" + l["ctx1"] if l.get("ctx1") else "") + ("+" + l["ctx2"] if l.get("ctx2") else "")
def delta(l):
    if l.get("controlPnl") is None or l["gate"] == "always":
        return None
    return l["pnl"] - l["controlPnl"]
def row(i, l):
    dv = delta(l)
    return (f"{i:2d}. [{l['stage'][:4]}] {combo(l):<26s} {str(l['bandMode'])[:4]}±{l['bandPct']:.2f}% "
            f"q{l['quorum']}/{l['members']} {l['gate'][:4]} d{l['dMult']}x t{l['tHours']}h | "
            f"{l['pnl']:+8.2f} vsCtl {('%+.2f' % dv) if dv is not None else '—':>8s} "
            f"({l['wins']}/{l['trades']}t g/t {l.get('grossPerTrade') or 0:.2f})")

print(f"\n-- top 12 by P&L (board size {len(L)}) --")
for i, l in enumerate(L[:12], 1):
    print(row(i, l))

withd = [l for l in L if delta(l) is not None]
withd.sort(key=lambda l: (-delta(l), combo(l)))
print(f"\n-- top 12 by vs-control delta ({len(withd)} of {len(L)} rows have a control) --")
for i, l in enumerate(withd[:12], 1):
    print(row(i, l))

# Recurrence: for each knob value, how many distinct TRADE assets have a
# positive-delta row carrying it. Distinct assets is the number that matters;
# one asset can contribute a dozen near-duplicate rows.
pos = [l for l in withd if delta(l) > 0]
print(f"\n-- recurrence across the {len(pos)} positive-delta rows "
      f"({len(set(l['trade'] for l in pos))} distinct trade assets) --")
for knob, get in (("gate", lambda l: l["gate"]),
                  ("dMult", lambda l: f"{l['dMult']}x"),
                  ("tHours", lambda l: f"{l['tHours']}h"),
                  ("quorum", lambda l: f"{l['quorum']}/{l['members']}")):
    assets = defaultdict(set)
    rows = Counter()
    for l in pos:
        assets[get(l)].add(l["trade"])
        rows[get(l)] += 1
    order = sorted(assets, key=lambda k: (-len(assets[k]), k))
    print(f"  {knob:<7s} " + "  ".join(f"{k}={len(assets[k])}a/{rows[k]}r" for k in order[:7]))

best = defaultdict(lambda: None)
for l in pos:
    b = best[l["trade"]]
    if b is None or delta(l) > delta(b):
        best[l["trade"]] = l
print(f"\n-- best positive-delta row per trade asset --")
for t in sorted(best, key=lambda t: -delta(best[t])):
    l = best[t]
    print(f"  {t:<9s} {combo(l):<26s} {l['gate'][:4]} d{l['dMult']}x t{l['tHours']}h "
          f"q{l['quorum']}/{l['members']} | {l['pnl']:+8.2f} vsCtl {delta(l):+8.2f} ({l['trades']}t)")
EOF
