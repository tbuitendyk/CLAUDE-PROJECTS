#!/usr/bin/env bash
# classifier-edge-read.sh -- read the EDGE screen off a bracketlab doc.
#
# WHICH DOC. By default the newest one carrying an edge census. To read an
# OLDER run, put its id in vps-access/reports/EDGE-JOB and commit it -- the
# same pattern outbox/NEXT uses, and for the same reason: the installed
# claude-deploy helper does not forward arguments to the script, so a job id
# cannot arrive over the wire. Selecting the newest run silently was fine
# while there was only one; with a run history it meant older cycles could not
# be re-read at all, and their numbers were simply lost.
#
# Reports holdout edge at the edge-selected quorum rung, grouped by chunk shape
# and decision mode. States plainly how much of the run it can actually see:
# the leaderboard is money-ranked and capped, so if a screen's units did not
# all reach it, this is a P&L-selected sample and says so rather than
# pretending to be a census.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export SELFILE="$HERE/reports/EDGE-JOB"
python3 <<'EOF'
import json, urllib.request
from collections import defaultdict
from math import comb

def get(u):
    with urllib.request.urlopen(u, timeout=30) as r:
        return json.load(r)

B = "http://127.0.0.1:8093"
import os
SELFILE = os.environ.get("SELFILE", "")
want = ""
if SELFILE:
    try:
        # Comment lines allowed so the file can explain itself in place.
        for line in open(SELFILE):
            line = line.strip()
            if line and not line.startswith("#"):
                want = line
                break
    except Exception:
        want = ""

ids = [b["id"] for b in get(f"{B}/api/batches")["batches"] if b["id"].startswith("bracketlab-")]
doc = None
if want:
    if want not in ids:
        print(f"requested job {want!r} is not in the batch list.")
        print("known bracketlab ids (newest first):")
        for i in ids[:15]:
            print("  ", i)
        raise SystemExit(1)
    doc = get(f"{B}/api/batch/{want}")
    if not doc.get("edgeCensus"):
        print(f"job {want} carries no edge CENSUS — it was not run with edgeScreen,")
        print("so there is nothing here that is not selected on P&L.")
        raise SystemExit(1)
    print(f"(reading {want}, pinned by reports/EDGE-JOB)")
else:
    for i in ids:
        d = get(f"{B}/api/batch/{i}")
        if d.get("edgeCensus"):
            doc = d
            break
if doc is None:
    print("no doc carries an edge CENSUS. A screen read off the money-ranked")
    print("leaderboard selects on edge and is not evidence — re-run with edgeScreen.")
    raise SystemExit(0)

p, perf = doc["params"], doc.get("perf") or {}
plan = doc.get("plan") or {}
rows = doc.get("edgeCensus") or []
print(f"=== {doc['id']} status={doc['status']} {round((perf.get('elapsedMs') or 0)/60000,1)}min")
print(f"planned units: {plan.get('units')}   CENSUS rows: {len(rows)}")
# Prove the null's construction from the DOC, not from the launcher that was
# supposed to set it. A dropped parameter once invalidated a whole conclusion
# here (trailing/holdout never reached the sweep), so the scope the run
# actually used is read back rather than assumed.
scope_p = p.get("labelShiftScope") or "series"
scopes_seen = sorted({r.get("shiftScope") for r in rows if r.get("shiftScope")})
print(f"null construction: labelShiftScope={scope_p}"
      + (f"   census rows report: {','.join(scopes_seen)}" if scopes_seen else "   (rows predate scope tagging)"))
if scopes_seen and any(x != scope_p for x in scopes_seen):
    print("  WARNING: the doc's setting and the rows disagree — do not read this run.")
if plan.get("units") and len(rows) < plan["units"]:
    print(f"note: {plan['units'] - len(rows)} unit(s) produced no census row (failed or too few chunks)")
print()

def tail(k, n):
    return sum(comb(n, i) for i in range(k, n + 1)) / (2 ** n) if n else None

# Multi-rotation runs carry a shiftFrac per row: report each draw separately,
# because the whole point is the spread.
draws = sorted({r.get("shiftFrac") for r in rows if r.get("shiftFrac") is not None})

# ---- MANDATORY QC, printed every time ------------------------------------
# These checks are in the TOOL, not in anyone's discipline. Every one of them
# exists because a real defect got past a human read of this same table:
#   * the draw spread     -> job -2303's null ranged 14.7%-91.2% and was
#                            nearly reported as a market result
#   * the silent units    -> units whose committee never makes a directional
#                            call score edge on their flat calls alone. They
#                            cannot win or lose money, they are counted as
#                            wins, and rotation produces ~6x more of them
#                            (2.4% real vs ~15% rotated), so the two
#                            populations are not comparable
# The rule is: this block prints unconditionally, before any comparison.
def silent_rate(g):
    known = [r for r in g if r.get("holdDirCalls") is not None]
    if not known:
        return None, 0, 0
    mute = [r for r in known if r["holdDirCalls"] == 0]
    return len(mute) / len(known), len(mute), len(known)

def shares(g):
    """all-units and active-only positive-edge share."""
    have = [r for r in g if r.get("holdEdge") is not None]
    if not have:
        return None
    pos = [r for r in have if r["holdEdge"] > 0]
    act = [r for r in have if r.get("holdDirCalls") is None or r["holdDirCalls"] > 0]
    apos = [r for r in act if r["holdEdge"] > 0]
    return {
        "n": len(have), "pos": len(pos), "share": len(pos) / len(have),
        "an": len(act), "apos": len(apos),
        "ashare": (len(apos) / len(act)) if act else None,
        "med": sorted(r["holdEdge"] for r in have)[len(have) // 2],
    }

allsr, allmute, allknown = silent_rate(rows)
if allsr is not None:
    print(f"PARTICIPATION: {allmute}/{allknown} units ({100*allsr:.1f}%) never made a "
          f"directional call in the holdout.")
    mute_pos = [r for r in rows if r.get("holdDirCalls") == 0 and (r.get("holdEdge") or 0) > 0]
    if allmute:
        print(f"  of those, {len(mute_pos)} ({100*len(mute_pos)/allmute:.1f}%) are still counted as "
              f"edge > 0 on their flat calls alone.")
    if allsr > 0.05:
        print("  WARNING: above 5%. The headcount below is diluted by units that")
        print("    cannot trade. Compare against the REAL run's silent rate before")
        print("    reading any margin -- job -2211 sits at 2.4%, so a rotated run")
        print("    near 15% is NOT the same population of units.")
    print()

if draws:
    print("TABLE 1 — THE FAKE-DATA TEST (the null distribution)")
    print("What it measures: the answers were deliberately slid out of line with")
    print("  the questions, so there is nothing left to predict. Each row is one")
    print("  such scramble. It shows how often the machine STILL looks like it is")
    print("  winning. That is the score luck alone earns, and any real result has")
    print("  to beat it. All rows should look alike; if they do not, the test")
    print("  itself is broken.")
    print(f"Scope: {len(draws)} scramble(s), {len(rows)} test setups in total.")
    print()
    print("  KEY   shift   = how far the answers were slid (a fraction of the series)")
    print("        n       = test setups in this scramble (1 setup = 1 coin x 1 time-")
    print("                  window shape x 1 decision mode)")
    print("        edge>0  = setups that beat their own do-nothing baseline")
    print("        share   = the same, as a percentage — THIS is the null score")
    print("        active  = share counting only setups that actually placed a trade")
    print("        mute    = setups whose models never called a direction at all")
    print("        med hold= typical margin over baseline, in accuracy points (NOT money)")
    print()
    print(f"{'shift':>7s} {'n':>4s} {'hold edge>0':>13s} {'share':>7s} {'active':>8s} {'mute':>6s} {'med hold':>9s}")
    tot = []
    atot = []
    for d in draws:
        g = [r for r in rows if r.get("shiftFrac") == d]
        st = shares(g)
        if not st:
            continue
        sr, _, _ = silent_rate(g)
        tot.append(st["share"])
        if st["ashare"] is not None:
            atot.append(st["ashare"])
        ash = f"{100*st['ashare']:.1f}%" if st["ashare"] is not None else "-"
        srs = f"{100*sr:.1f}%" if sr is not None else "-"
        print(f"{d:>7.3f} {st['n']:>4d} {st['pos']:>6d}/{st['n']:<6d} {100*st['share']:>6.1f}% "
              f"{ash:>8s} {srs:>6s} {100*st['med']:>8.2f}%")
    if tot:
        lo, hi = min(tot), max(tot)
        mean = sum(tot) / len(tot)
        spread = hi - lo
        print(f"\nnull share (all units): mean {100*mean:.1f}%  range {100*lo:.1f}%-{100*hi:.1f}%"
              f"  spread {100*spread:.1f} pts")
        if atot:
            print(f"null share (active only): mean {100*sum(atot)/len(atot):.1f}%  "
                  f"range {100*min(atot):.1f}%-{100*max(atot):.1f}%")
        # THE SANITY GATE, pre-registered before job -0041 was fired.
        if spread > 0.15:
            print()
            print("  *** GATE FAILED: the draws span more than 15 points. ***")
            print("  These are not draws of one statistic. The construction is still")
            print("  wrong. DO NOT read the comparison below -- go back to the")
            print("  instrument. (Baseline drift and silent-unit rate are the two")
            print("  known causes; both are printed above.)")
        else:
            print("\n  gate passed: draws agree within 15 points, so they can be")
            print("  compared against the real run.")
            # PRIMARY = active-only. Silent units never place a trade, so they
            # cannot express tradeable direction and do not belong in a score
            # meant to detect it. Corrected 2026-07-29 after the owner pointed
            # out that keeping a measure already shown to be broken, purely
            # because it was declared first, is stubbornness rather than rigour.
            # The correction moved BOTH arms down (null 54.1->50.8, real
            # 57.6->56.6), which is the check that it is not a cherry-pick.
            # All-units stays printed beside it for continuity with old boards.
            print(f"  real run (job -2211): 56.6% ACTIVE-ONLY [primary]  /  57.6% all-units [legacy]")
            if atot:
                amax = max(atot)
                print(f"  -> PRIMARY (active-only): {'ABOVE every draw' if 0.566 > amax else 'INSIDE the null spread'}"
                      f"   top draw {100*amax:.1f}%, margin {100*(0.566-amax):+.1f} pts")
                n = len(atot)
                print(f"     rank-based p floor with {n} draw(s): {1/(n+1):.3f}"
                      f"  ({'CANNOT reach 0.05 — run more draws' if 1/(n+1) > 0.05 else 'can reach 0.05'})")
            print(f"  -> legacy (all-units):    {'ABOVE every draw' if 0.576 > hi else 'INSIDE the null spread'}")
    print()

groups = defaultdict(list)
for r in rows:
    groups[(r["geometry"], r["decision"])].append(r)

# The column formerly labelled "p" is NOT a significance test. It assumes the
# units are independent draws; they are 17 coins that move together across 5
# overlapping chunk shapes. Scrambled data — with nothing to predict — scored
# pooled p = 0.0047 and 0.0036 on one group. Naming it "p" invited exactly the
# reading it cannot support, so it is renamed to what it actually is: a naive
# coin-flip tail probability, kept only for continuity with older boards.
print("TABLE 2 — RESULTS BROKEN OUT BY SETUP TYPE")
print("What it measures: the same win-rate as Table 1, but split by the shape of")
print("  the time window and by how the models turn probabilities into a call.")
print("  Read THIS rather than the pooled line at the bottom: pooling mixes")
print("  window shapes and coins that all move together.")
print()
print("  KEY   geometry  = time-window shape. daily-Nd steps forward one day and")
print("                    looks back N days, so daily-1d..4d OVERLAP heavily.")
print("                    weekly-8d steps once a week.")
print("        decision  = argmax: always call the most likely of down/flat/up.")
print("                    directional: only call up/down when confident, else")
print("                    stand aside.")
print("        n         = test setups in this group")
print("        edge>0    = setups beating their own do-nothing baseline")
print("        naive*    = see footnote — NOT a significance score")
print("        med hold  = typical margin over baseline on the HELD-BACK data")
print("                    (accuracy points, not money). This is the evidence.")
print("        med search= same on the data used to pick settings. Always")
print("                    flattering, never evidence.")
print()
print(f"{'geometry':<11s} {'decision':<12s} {'n':>3s} {'hold edge>0':>13s} {'naive*':>7s} {'med hold':>9s} {'med search':>11s}")
for k in sorted(groups):
    g = [r for r in groups[k] if r.get("holdEdge") is not None]
    if not g:
        print(f"{k[0]:<11s} {k[1]:<12s} {len(groups[k]):>3d}   no holdout")
        continue
    pos = sum(1 for r in g if r["holdEdge"] > 0)
    med = sorted(r["holdEdge"] for r in g)[len(g) // 2]
    meds = sorted(r["searchEdge"] for r in g)[len(g) // 2]
    print(f"{k[0]:<11s} {k[1]:<12s} {len(g):>3d} {pos:>6d}/{len(g):<6d} {tail(pos, len(g)):>7.4f} "
          f"{100*med:>8.2f}% {100*meds:>10.2f}%")

allg = [r for r in rows if r.get("holdEdge") is not None]
if allg:
    pos = sum(1 for r in allg if r["holdEdge"] > 0)
    med = sorted(r["holdEdge"] for r in allg)[len(allg) // 2]
    print()
    print(f"POOLED holdout edge > 0: {pos}/{len(allg)}   naive* = {tail(pos, len(allg)):.4f}   median {100*med:+.2f}%")
    print()
    print("  * NOT a p-value and NOT evidence. It assumes independent units.")
    print("    Scrambled data scored naive* = 0.0047 pooled. The ONLY valid")
    print("    comparison is against the measured null above.")
    print()
    print("Only the HOLDOUT column is evidence. Search-window edge is what the rung")
    print("was chosen on, so it is selected-for by construction. The pooled line mixes")
    print("chunk shapes and decision modes and correlated assets — read the groups.")
    best = max(groups, key=lambda k: sum(1 for r in groups[k] if (r.get("holdEdge") or 0) > 0) / max(1, len(groups[k])))
    print(f"strongest group: {best[0]}/{best[1]} — a LEAD needing its own declared test, not a result.")
EOF
