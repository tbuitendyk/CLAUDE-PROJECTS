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

## Screen H1 — the hunter campaign (declared before running)

Question: does the directional hunter (class-weighted training, ±1-only
decisions, τ tuned on validation dollars) find tradable big-move edges the
argmax machinery can't see?

Protocol, declared breadth:
- Classic consensus screen, decision = directional hunter, daily-3d, all
  loaded data, 24/7, all 17 pairs, 0 null shifts, at three FIXED bands:
  **±3%, ±5%, ±8%** — three distinct hunting regimes (common swings /
  uncommon moves / tail), not tunings of one. τ self-tunes per run on
  validation paper P&L; the band menu is the declared breadth.
- **All three sweeps run regardless of interim results** — the denominator
  is fixed at 3 × 17 = 51 looks by this declaration, not by enthusiasm.
  No off-menu bands afterward; a new band is a new declaration.
- Reading gate per pair-band: net > $0 at research friction ($0.25 round
  trip) on ≥ 30 trades, with a τ that actually traded on validation
  (a zero-validation-trade τ is absence of evidence, not conviction).
  **Gate amended — see Amendment log (A1).**
- Anything clearing the gate earns a deep null (200–1000 shifts, that
  pair and band only), read against the ledger's full denominator.
  Nothing here earns belief, a book, or capital directly.

## Amendment log

- **A1 (2026-07-26) — H1 reading gate: low-frequency lane added.** The
  original gate's flat ≥ 30-trade floor was set by the session, not the
  owner, and contradicts the campaign's own premise at wide bands: a tail
  hunter that fires a handful of times a year can never reach 30 trades in
  any test window. Amended gate, per pair-band:

  Net > $0 at research friction ($0.25 round trip), with a τ that actually
  traded on validation, AND either:
  - **(a)** ≥ 30 trades in the test window, or
  - **(b)** ≥ 10 trades AND gross-per-trade ≥ $1.00 AND a trade rate of at
    least **7 trades per 365 days of test window**. The rate term makes the
    low-N lane scale with the testing timeframe — 10 signals in one year is
    a jump-on-able pattern; 10 signals in ten years is not, and lane (a)
    already covers any window long enough to accumulate 30. The $1.00
    gross-per-trade term restricts the lane to rare-but-fat signals, the
    only regime where low frequency is worth acting on.

  Timing disclosure: this amendment was written AFTER the ±3% sweep was
  read and BEFORE the ±5% and ±8% sweeps were read. It is therefore clean
  (pre-registered) for ±5% and ±8%, and post-hoc for ±3%. Any ±3%
  candidate admitted only by lane (b) — as of writing, BCHUSDT (+$38.09,
  27 trades, $1.66 gross/trade) — is flagged **admitted-after-looking**:
  its deep null is still valid evidence, but it does not get to claim it
  survived a pre-registered gate. Candidates that passed the original
  ≥ 30 gate are unaffected.
