#!/usr/bin/env bash
# classifier-replication-read.sh -- read the REPLICATION table of the newest
# bracketlab doc that has one. Arg-free (the installed claude-deploy helper
# does not forward arguments).
#
# Prints the declared cell, the two binomial readings, and then either the
# full per-combo table (small runs) or a per-trade-asset roll-up (large ones,
# e.g. 272 doubles). Rows are always ordered by TRADE ASSET, never by result:
# a table sorted by P&L invites reading the top of it as a finding.
#
# Both binomials are two-sided-ish tails under p=0.5 (P[X >= k]); with the
# reading rule fixed in advance they are the honest summary of a set of
# one-look-per-asset tests.
set -euo pipefail
python3 <<'EOF'
import json, urllib.request
from collections import defaultdict
from math import comb


def get(u):
    with urllib.request.urlopen(u, timeout=30) as r:
        return json.load(r)


ids = [b["id"] for b in get("http://127.0.0.1:8093/api/batches")["batches"]]
doc = None
for i in ids:
    d = get(f"http://127.0.0.1:8093/api/batch/{i}")
    if d.get("replication"):
        doc = d
        break
if doc is None:
    print("no bracketlab doc with a replication table")
    raise SystemExit(0)

p = doc["params"]
dec = p.get("declared") or {}
perf = doc.get("perf") or {}
q = f"{round(dec.get('quorumRatio', 0) * 100)}% of members" if dec.get("quorumRatio") else dec.get("quorum")
print(f"=== {doc['id']}  status={doc['status']}  workers={perf.get('workers')}  "
      f"{round((perf.get('elapsedMs') or 0)/60000,1)}min  fails={len(doc.get('failures') or [])}")
# A market declaration has no gate and no distance; printing "dNonex" for it
# is worse than printing nothing.
if dec.get("entry") == "market":
    print(f"declared: MARKET entry (at the open, called direction), t{dec.get('tHours')}h, quorum {q}")
else:
    print(f"declared: {dec.get('gate')} gate, d{dec.get('dMult')}x, t{dec.get('tHours')}h, quorum {q}")
cs = doc.get("callSeries") or []
if cs:
    print(f"call export: {len(cs)} unit(s), {sum(len(c.get('calls') or []) for c in cs)} periods total")
sizes = [k for k, v in (p.get("sizes") or {}).items() if v]
print(f"branch: {p['set']['geometry']} / {p['set']['band']} / {p['set']['decision']} / "
      f"{'24-5' if p['set']['weekdaysOnly'] else '24-7'} | sizes={sizes} universe={len(p['universe'])}")


def tail(k, n):
    return sum(comb(n, i) for i in range(k, n + 1)) / (2 ** n) if n else None


rep = doc["replication"]
scored = [r for r in rep if r.get("pnl") is not None]
withc = [r for r in scored if r.get("vsControl") is not None]
pos = sum(1 for r in scored if r["pnl"] > 0)
posc = sum(1 for r in withc if r["vsControl"] > 0)
print()
print(f"POSITIVE DOLLARS  {pos}/{len(scored)}   binomial p = {tail(pos, len(scored)):.4f}")
if withc:
    print(f"POSITIVE VS CTRL  {posc}/{len(withc)}   binomial p = {tail(posc, len(withc)):.4f}")
print("reading rule (fixed in advance): >=12 of 16 fresh = mechanism; 8-11 = ambiguous; <8 = retire")

combo = lambda r: r["trade"] + ("+" + r["ctx1"] if r.get("ctx1") else "") + ("+" + r["ctx2"] if r.get("ctx2") else "")

if len(rep) <= 40:
    print("\nper combo (ordered by asset, NOT by result):")
    for r in sorted(rep, key=combo):
        vs = ("%+.2f" % r["vsControl"]) if r.get("vsControl") is not None else "—"
        gpt = ("%.2f" % r["grossPerTrade"]) if r.get("grossPerTrade") is not None else "—"
        m = r.get("metrics") or {}
        acc = f"{100*m['testAcc']:.1f}%" if m.get("testAcc") is not None else "—"
        edge = f"{100*m['edge']:+.1f}%" if m.get("edge") is not None else "—"
        print(f"  {combo(r):<26s} ±{r['bandPct']:.2f}% q{r['quorum']}/{r['members']} "
              f"{r['pnl']:+9.2f}  vsCtl {vs:>9s}  acc {acc:>6s} edge {edge:>7s} "
              f"({r['wins']}/{r['trades']}t g/t {gpt}) stops={r['stops']}")
else:
    by = defaultdict(list)
    for r in scored:
        by[r["trade"]].append(r)
    print(f"\nper TRADE asset roll-up ({len(scored)} combos over {len(by)} assets), ordered by asset:")
    for t in sorted(by):
        rows = by[t]
        n = len(rows)
        pn = sum(1 for r in rows if r["pnl"] > 0)
        wc = [r for r in rows if r.get("vsControl") is not None]
        pc = sum(1 for r in wc if r["vsControl"] > 0)
        med = sorted(r["pnl"] for r in rows)[n // 2]
        medc = sorted(r["vsControl"] for r in wc)[len(wc) // 2] if wc else None
        print(f"  {t:<10s} dollars {pn:>3d}/{n:<3d}  vsCtl {pc:>3d}/{len(wc):<3d}  "
              f"median {med:+9.2f}  median vsCtl {('%+9.2f' % medc) if medc is not None else '—':>9s}")
geoms = sorted({r["geometry"] for r in scored})
if len(geoms) > 1:
    # A geometry-permuted run is one declared look PER GEOMETRY, so the only
    # honest summary is a binomial each — the pooled number above mixes five
    # separate tests and means nothing on its own.
    print(f"\nper GEOMETRY ({len(geoms)} branches — each is its own declared look, "
          f"and the pooled line above should NOT be read):")
    for gname in geoms:
        rows = [r for r in scored if r["geometry"] == gname]
        pn = sum(1 for r in rows if r["pnl"] > 0)
        tot = sum(r["pnl"] for r in rows)
        med = sorted(r["pnl"] for r in rows)[len(rows) // 2]
        print(f"  {gname:<10s} positive {pn:>3d}/{len(rows):<3d}  binomial p = {tail(pn, len(rows)):.4f}  "
              f"total {tot:+10.2f}  median {med:+9.2f}")
EOF
