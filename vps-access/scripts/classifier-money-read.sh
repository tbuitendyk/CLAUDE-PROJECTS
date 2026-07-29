#!/usr/bin/env bash
# classifier-money-read.sh -- the MONEY question, read the same way the
# accuracy question was: against a measured null, never against intuition.
#
# Accuracy scores a wrong call identically whether the market went nowhere or
# hard the other way. Money does not. A system can be right more often than
# noise and still lose, if its mistakes are larger than its wins — so this is
# a separate question with its own census and its own null.
#
# Every figure here is out-of-sample by construction: the setup was chosen on
# the SEARCH window and scored once on the held-back slice. Recorded for every
# unit, never money-ranked — reading money off a money-ranked leaderboard is
# the selection fault that invalidated job -2158.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SELFILE="$HERE/reports/EDGE-JOB"
python3 <<'EOF'
import json, urllib.request, os
from statistics import median

def get(u):
    with urllib.request.urlopen(u, timeout=30) as r:
        return json.load(r)

B = "http://127.0.0.1:8093"
want = ""
try:
    for line in open(os.environ.get("SELFILE", "")):
        line = line.strip()
        if line and not line.startswith("#"):
            want = line; break
except Exception:
    pass
ids = [b["id"] for b in get(f"{B}/api/batches")["batches"] if b["id"].startswith("bracketlab-")]
doc = None
if want:
    doc = get(f"{B}/api/batch/{want}")
else:
    for i in ids:
        d = get(f"{B}/api/batch/{i}")
        if d.get("edgeCensus"):
            doc = d; break
rows = (doc or {}).get("edgeCensus") or []
if not rows:
    print("no census rows"); raise SystemExit(0)

priced = [r for r in rows if r.get("holdPnl") is not None]
print(f"=== {doc['id']}  status={doc['status']}  census rows: {len(rows)}")
print(f"rows carrying MONEY: {len(priced)}")
if not priced:
    print()
    print("This run predates the money census, so it records prediction only.")
    print("Nothing below can be computed. Re-run with the current build.")
    raise SystemExit(0)

print()
print("TABLE 1 — NET MONEY ON THE HELD-BACK SLICE")
print("What it measures: total dollars the census made or lost on data no")
print("  search ever touched, after fees. Each scramble is a world with")
print("  nothing to predict, so it shows what luck alone pays.")
print()
print("  KEY  shift    = which scramble (blank = real market data)")
print("       n        = priced setups")
print("       net $    = total dollars across those setups, after fees")
print("       median $ = the typical single setup's dollars")
print("       win%     = share of setups that ended in profit")
print("       vs hold  = net $ minus what simply buying and holding made")
print()
print(f"{'shift':>7s} {'n':>5s} {'net $':>12s} {'median $':>10s} {'win%':>7s} {'vs hold $':>12s}")

def block(g):
    net = sum(r["holdPnl"] for r in g)
    med = median(r["holdPnl"] for r in g)
    win = sum(1 for r in g if r["holdPnl"] > 0) / len(g)
    bh = [r["holdBuyHold"] for r in g if r.get("holdBuyHold") is not None]
    vs = (net - sum(bh)) if bh else None
    return net, med, win, vs

draws = sorted({r.get("shiftFrac") for r in priced if r.get("shiftFrac") is not None})
nets = []
for d in draws:
    g = [r for r in priced if r.get("shiftFrac") == d]
    net, med, win, vs = block(g)
    nets.append(net)
    print(f"{d:>7.3f} {len(g):>5d} {net:>12,.2f} {med:>10,.2f} {100*win:>6.1f}% {('' if vs is None else format(vs, ',.2f')):>12s}")

real = [r for r in priced if r.get("shiftFrac") is None]
if real:
    net, med, win, vs = block(real)
    print(f"{'REAL':>7s} {len(real):>5d} {net:>12,.2f} {med:>10,.2f} {100*win:>6.1f}% {('' if vs is None else format(vs, ',.2f')):>12s}")

if nets:
    lo, hi = min(nets), max(nets)
    mid = median(nets)
    spread = hi - lo
    mag = abs(mid) if mid else 1.0
    print()
    print(f"scramble net $: median {mid:,.2f}  range {lo:,.2f} to {hi:,.2f}  spread {spread:,.2f}")
    # GATE, declared in the cycle 8 launcher before firing.
    if spread > 2 * mag:
        print()
        print("  *** GATE FAILED: the scrambles disagree with each other by more")
        print("  than twice the typical magnitude. The money measure is as")
        print("  unstable as the headcount was. DO NOT read a comparison. ***")
    else:
        print("  gate passed: the scrambles agree closely enough to compare against.")
    # ---- POOLED PER-TRADE MONEY --------------------------------------------
    # Summing 170 unit totals throws away the per-trade data and inherits the
    # variance of a handful of large trades — the identical fault as QC 24,
    # where a unit-level headcount discarded 20,000 decisions and overstated
    # an effect threefold. The better-conditioned statistic pools across every
    # TRADE, exactly as directional accuracy pools across every decision.
    #
    # Declared here BEFORE any real arm exists, so it cannot have been chosen
    # to flatter a result — the real census carrying money has not been run.
    def per_trade(g):
        tr = sum(r["holdTrades"] or 0 for r in g)
        return (sum(r["holdPnl"] for r in g) / tr, tr) if tr else (None, 0)
    print()
    print("TABLE 2 — MONEY PER TRADE (better conditioned than the totals above)")
    print("What it measures: the same money, divided by the number of trades that")
    print("  produced it. Totals are dominated by a few large trades; this pools")
    print("  across every trade, so it is far less noisy.")
    print()
    print("  KEY  $/trade = net dollars per trade after fees, pooled")
    print("       trades  = how many trades that average is over")
    print()
    pts = []
    for d in draws:
        g = [r for r in priced if r.get("shiftFrac") == d]
        v, tr = per_trade(g)
        if v is None: continue
        pts.append(v)
        print(f"  shift {d:.3f}: {v:>8.4f} $/trade  over {tr:,} trades")
    if pts:
        plo, phi, pmid = min(pts), max(pts), median(pts)
        pspread = phi - plo
        print(f"\n  scramble $/trade: median {pmid:.4f}  range {plo:.4f} to {phi:.4f}"
              f"  spread {pspread:.4f}")
        pmag = abs(pmid) if pmid else 1.0
        print(f"  spread-to-magnitude ratio: {pspread/pmag:.2f}"
              f"  ({'STABLE' if pspread <= 2*pmag else 'still unstable'})")
    if real:
        v, tr = per_trade(real)
        if v is not None:
            print(f"\n  REAL: {v:.4f} $/trade over {tr:,} trades")
            if pts:
                print(f"  beats {sum(1 for x in pts if v > x)} of {len(pts)} scrambles")
    if real:
        rnet = sum(r["holdPnl"] for r in real)
        above = sum(1 for x in nets if rnet > x)
        print()
        print(f"  real net ${rnet:,.2f} beats {above} of {len(nets)} scrambles")
        print(f"  rank-based p floor with {len(nets)} draw(s): {1/(len(nets)+1):.3f}")
    else:
        print()
        print("  NO REAL ARM IN THIS DOC — the scrambles alone say what luck pays,")
        print("  but there is nothing to compare against. Run the real census on")
        print("  the current build before reading any verdict.")
EOF
