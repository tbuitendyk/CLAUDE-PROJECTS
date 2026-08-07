# Forward books — pre-registration (2026-08-07, BEFORE any forward number exists)

## Why this document exists
The three setups below cleared the declared money screen on the held-back
window of discovery board bracketlab-20260805-193433-real. That window is
SPENT as evidence for them: they were selected BY their held-back money, and
one of them (the leader) had already been seen and set aside before the screen
was written. No backtest on that window can rehabilitate them.

The only untainted evidence available is data no run has touched. This file
freezes exactly what will be scored, from when, and how it will be read —
committed before a single forward number exists, so the record cannot be
re-picked afterwards. Same protection as TRACKER.md.

**No forward number existed when this file was committed.** Verify from git:
this commit precedes any forward-scoring code or result.

## Frozen specifications
Engine at freeze time: 1.43.0. Fee assumption: $0.125/leg (REAL_FEE_PER_LEG),
notional $100 per book. Geometry, band and decision are part of the freeze.
Committee specs are `specsFor(3, stage)` and are listed in full so the freeze
does not depend on that function staying put.

### Book F1 — the money leader
- combo: LTCUSDT (traded) + XRPUSDT + BCHUSDT (context)
- geometry daily-4d | decision argmax | band 1.69% | 24/7
- committee: SLIM, 4 members —
  logreg/full, logreg/prices, logreg/volume, logreg/cross
- cell: quorum 1 of 4 | entry market | gate directional | dMult null | tHours 137 | no trailing
- backtest figures being tested (held-back, spent): net $158.32, 224 trades,
  127 wins (56.7%), break-even fee $0.4784/leg, 282.7% headroom

### Book F2
- combo: XLMUSDT (traded) + DOTUSDT + TRXUSDT (context)
- geometry daily-4d | decision directional | band 1.61% | 24/7
- committee: SLIM, 4 members (as F1's list)
- cell: quorum 1 of 4 | entry breakout | gate active | dMult 1.5 | tHours 161 | no trailing
- backtest figures (spent): net $40.96, 240 trades, 85 wins, break-even
  $0.2103/leg, 68.3% headroom

### Book F3 — the 8-member sibling of F2, kept deliberately
- combo: XLMUSDT (traded) + DOTUSDT + TRXUSDT (context)
- geometry daily-4d | decision directional | band 1.61% | 24/7
- committee: PROMOTED, 8 members —
  logreg/full, boost/full, logreg/prices, boost/prices,
  logreg/volume, boost/volume, logreg/cross, boost/cross
- cell: quorum 1 of 8 | entry breakout | gate active | dMult 1.5 | tHours 161 | no trailing
- backtest figures (spent): net $30.81, 242 trades, 85 wins, break-even
  $0.1887/leg, 50.9% headroom
- WHY KEPT: F2 and F3 are the same combo, geometry and cell differing only in
  committee size. Running both turns a nuisance into a free one-variable
  experiment on whether the 4-member or 8-member committee travels better.

## Training freeze
Members are trained ONCE on data ending 2026-06-30 — the last date any of the
selecting runs could see — and are never retrained. A book that retrains has
stopped being a forward test of the thing that was selected.

## Scoring window
From 2026-07-01 00:00 UTC forward. Nothing before that date is ever counted,
including the window the setups were selected on.

## Reading rules, declared now
- R1 (the only verdict that counts): net money after fees, per book, on
  forward data only. Reported per book, never pooled across books, and never
  pooled with backtest money.
- R2 (cost realism): break-even fee per leg recomputed on forward trades. A
  book whose forward break-even falls below $0.125 has failed on cost even if
  its net is positive by luck.
- R3 (THINNESS IS REPORTED, NOT HIDDEN): daily-4d with 137-161h holds yields
  roughly 9 periods and 5-6 trades in the first five weeks. Every report states
  the trade count first. NO VERDICT of any kind is claimed below 30 forward
  trades per book. That floor is GUESSED, not derived — it is a stop on
  premature reading, not a significance threshold.
- R4 (no re-picking): the three books above are the complete set. No book is
  added, dropped, re-specified or re-based later. If a book looks bad it stays
  in the record; if the engine changes, the books restart and the old record is
  reported as ended, not amended.
- R5 (the comparison that matters): every report shows, beside each book,
  always-long and always-short over the same forward window. A book that
  cannot beat a coin flip on direction is not a candidate no matter what its
  net is.

## Expectation, on the record before the numbers exist
I expect F1's forward net to be far below the $158.32 that got it selected,
because that figure is a selected maximum over 50 scored setups on a spent
window. I would consider it genuinely promising if it merely stays positive
after fees with break-even above $0.125. I have no directional expectation for
F2 vs F3.

## What this does NOT authorise
Nothing here is a Binance trade. These are paper books. A real test trade needs
the owner's explicit word at that time, on the evidence as it then stands.
