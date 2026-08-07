# Post-run audit — bracketlab-20260807-154325-triples-confirm-d-ltc-corrected-null

Run D: run C re-measured on engine 1.42.0 (QC 80 per-slice null deals). Same
universe, same declared cell, same layout, same 19 seeds — the null
construction is the only thing that differs. 60 rows, 0 failures, 20.7 min.

## 1. Result against the rule stamped before launch
R1: candidate must beat ALL 19 draws (p-floor 0.05).

  ordering        real$   nullMean   nullSd      z    beat   rawReal  verdict
  LTC traded     670.85     432.54   105.80   +2.25   19/19    13.03   PASS
  BCH traded     936.98    1082.66    19.98   -7.29    0/19   301.44   fail
  XRP traded    1012.39    1066.13    50.03   -1.07    4/19   353.92   fail

CANDIDATE PASSES on the corrected instrument.

## 2. MY STATED EXPECTATION WAS WRONG — recorded as such
The launcher and the run C audit both predicted, before the numbers existed,
that the candidate would FAIL because the fix would remove the directional-lean
credit. It did not. The fix moved the candidate's null distribution exactly as
predicted in DIRECTION (mean $413.93 -> $432.54, sd $77.94 -> $105.80, i.e. the
corrected null is 36% more dispersed and harder to beat) and z fell 3.30 ->
2.25 — but not far enough to overturn the verdict. A wrong pre-registered
prediction that goes AGAINST the surviving result is worth more than a right
one; it is recorded here rather than quietly dropped.

## 3. Weaknesses hunted (7b) — one is now WORSE, and it is unexplained
- SIBLING ANOMALY PERSISTS AND DEEPENS. BCH-traded moved from z -4.04 to
  z -7.29. QC 80 was therefore NOT the explanation for the sibling pattern,
  only for part of the dispersion. An arm at -7.3 sd of its own null
  distribution is not a candidate verdict, it is a symptom.
- THE PROXIMATE CAUSE IS THE SIBLING'S NULL SPREAD, NOT ITS REAL ARM.
  BCH nulls: mean $1082.66, sd $19.98 across 19 draws. That is implausibly
  tight: the candidate's own nulls on the same window/coins spread at $105.80.
  Order-of-magnitude check: ~350 trades on a $100 book at daily-4d should give
  a total-money spread on the order of $100, not $20. Something is collapsing
  the variance of that arm's draws. UNEXPLAINED — declared open.
- MECHANISM NOT YET EXCLUDED: at quorum 1-of-8 the arm takes a position in
  nearly every period, so a shuffle may barely change WHICH periods are traded
  and only re-randomise direction. If direction is near-coin-flip every period,
  totals concentrate. That would make the null a weak opponent for ANY 1-of-8
  arm — including the candidate. This is a hypothesis, NOT a finding.
- CONSEQUENCE FOR THE PASS: the candidate's pass is on the same 1-of-8 cell,
  so if the above mechanism is real it applies to the candidate too. The pass
  is therefore held as PROVISIONAL pending the check in §5.

## 4. Money — unchanged, and still the binding constraint
Hold net $13.03 on 310 trades; fees $77.50 of $90.53 gross (85.6%);
break-even fee $0.1460/leg vs $0.125 charged (16.8% headroom); always-short
made $478.32 on the same window with no model. Statistical survival has not
moved this at all. Under the stamped rule a pass buys a fresh PERIOD test and
nothing more — it does not buy promotion, and it certainly does not buy a
Binance test trade.

## 5. Next step, declared before it runs
INTERVENING INSTRUMENT CHECK FIRST (protocol 7c — the planned step does not
proceed until the weakness is resolved): measure the null-draw dispersion as a
function of quorum on the SAME window. If 1-of-8 arms systematically produce
collapsed null spreads relative to higher quorums, then every 1-of-8 verdict
this project has issued — including run D's pass — is measured against a null
that is too easy to beat, and the fix is a quorum-aware null or a different
control entirely. Reading rule: compare null sd across quorums 1..8 for the
same coin/window; a monotone collapse toward low quorum confirms it.
Only after that: the fresh-period test on data the selection never saw
(2026-07 onward, ~6 weeks, thin by construction and to be reported as thin).

## QC register
No new entry yet — the dispersion anomaly is declared open, not diagnosed.
It becomes an entry the moment it has a named cause.
