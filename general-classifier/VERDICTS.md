# Pre-registered verdicts and declared one-look screens

Written 2026-07-26, before any of the outcomes below are knowable. Git
history is the timestamp. Rules here are mechanical on purpose: the person
reading a finished book must not be the one deciding what "success" meant.

## Fee policy (recorded here because it changes how research reads)

From 2026-07-26, research screens (pair / consensus / meta-lens) price paper
trades at **$0.125 per leg ($0.25 per round trip on $100)**: Binance spot
taker 0.10% per side plus a spread/slippage allowance. The former $0.50 per
leg remains, permanently, the declared rate of the three frozen live books
(TRACKER.md, TRACKER-DOGE.md, engine book #1) — their records are untouched
and their rate never changes mid-record. Screens run before this date used
$0.50 per leg; comparisons across the boundary must be made gross, not net.

## Book 1 — DOT/AVAX weekly tracker (TRACKER.md; horizon 26 live weeks)

Thesis: the weekly Tue→Thu consensus vote carries real edge (screening:
DOT 8/8 with 0/286 null rotations, AVAX 7/8 with 0/281).

At 26 live weeks:
- **Success**: combined vote net P&L (DOT + AVAX) > $0, and at least 26 of
  the 52 pair-weeks produced a settled record (data quality floor).
- **Failure**: combined vote net P&L < $0 with both pairs individually < $0.
- **Mixed** (combined > $0 with one pair < $0, or combined < $0 with one
  pair > $0): extend once by 13 weeks, then apply the same rule with no
  further extension.

## Book 2 — DOGE daily-3d (TRACKER-DOGE.md; horizon 90 live periods)

Thesis: DOGE daily-3d predicts its own 41-hour move (vote book 0 exceedances
in ~1,072 label rotations; family-wise ≈ 8% after the pair/geometry search).
Primary rules per its protocol: vote and q7.

At 90 live periods:
- **Success**: vote net > $0 AND q7 net > $0 (both at the book's declared
  $0.50/leg stress friction).
- **Failure**: vote net < $0 AND q7 net < $0.
- **Split verdicts**: whichever rule is positive carries a WEAK pass only if
  its gross-per-trade exceeds $1.00 (i.e. it would clear stress fees with
  margin); otherwise the book fails as a whole.
- Secondary reading (no action attached): does the win-rate ordering across
  q5→q8 reproduce the backtest's 53.7/57.4/62.6/67.3 gradient?

## Book 3 — DOT daily-3d, engine book #1 (horizon 90 live periods)

Thesis: DOT's individual lenses are dead but their AGREEMENT carries signal
(1000-shift null: q6 exceed 2%, q7 1%, vote dead at 40%).

At 90 live periods:
- **Success**: q6 net > $0 AND q7 net > $0 (the two calibrated rungs).
- **Failure**: q6 net < $0.
- **Control**: the vote book is EXPECTED to be ~flat-to-negative. If the
  vote finishes clearly positive while the gates finish negative, the
  agreement thesis is wrong regardless of dollars, and the configuration is
  rejected even if a rung made money.

## What any success buys

A completed book that meets its success rule earns exactly one thing:
consideration of a small live pilot at real fees, sized to be survivable
and boring. No backtest result, however calibrated, earns that directly.
A failed book retires its configuration; re-entering the same configuration
requires new evidence (a new mechanism or new data era), not a re-run.

## Interim looks

Anyone may look at any book at any time. No action follows an interim look.
Books end at their horizons or by explicit retirement, never because an
interim number looked good or bad. (Stopping early "for time" is retirement
and closes the record as FAILURE-BY-DEFAULT unless the book was net-positive
on every primary rule at retirement.)

## Screen R1 — the recency test (declared before running)

Question: is the DOGE/DOT daily-3d signal concentrated in the recent era
(the meta-lens found DOGE's gross edge NEGATIVE on mid-history and positive
on the test era, while DOT's was thin-positive throughout)?

Protocol, one look:
- Classic consensus screen, daily-3d, pairs DOGEUSDT + DOTUSDT only,
  months **2023-01 through 2026-06** (fixed lookback, chosen before running,
  no other lookbacks will be tried), auto band, argmax, 24/7, 1000 null
  shifts.
- **Recency confirmed for a pair** if: vote-book null exceed ≤ 2% AND
  vote gross-per-trade strictly exceeds the full-history run's
  ($1.02 DOGE / $0.72-at-q5-era DOT baselines, gross basis).
- **Recency rejected** if exceed > 10% or gross-per-trade below the
  full-history figure.
- Between: inconclusive, and it stays inconclusive — no follow-up lookback
  scans. Consequence of confirmation: FUTURE books may declare a 2023+
  training window; existing books are untouched.

## Amendment log

- *(none)*
