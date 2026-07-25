# DOGE daily-3d live paper book — pre-registered protocol

Written **before** the book records its first period. This document is the
commitment; the numbers are whatever they turn out to be.

This is a **second, independent** book. The DOT/AVAX weekly tracker
(`TRACKER.md`, `lib/tracker.js`, `data/tracker/state.json`) is frozen and is
not touched by anything here. The two share only the paper-trade primitives in
`lib/paper.js`, so a dollar means the same thing in both.

## What is being tested

The consensus screen found, on DOGEUSDT at the daily-3d geometry:

- 6 of 8 specs with positive true edge; median true edge +0.6%
- a majority-vote paper book of **+$6.26** on 319 trades
- **0 exceedances across ~1,072 distinct circular label rotations** (872 in one
  screen, 200 in another) for the vote book's dollars
- an **agreement gradient**: as the number of specs required to agree rises,
  win rate climbs monotonically 53.7% → 57.4% → 62.6% → 67.3%, and gross per
  trade rises $1.07 → $1.29 → $1.76 → $1.72

Two claims follow, and this book exists to test them forward:

1. **The edge is real** — DOGE daily-3d predicts its own 41-hour move better
   than chance, and the effect survives label-shift calibration.
2. **Conviction tracks edge** — periods where more specs agree are periods
   where the call is more often right.

Claim 2 is the interesting one and the backtest cannot settle it, because the
best-looking rung (7 of 8) was identified *after* seeing the table.

## Honest limits of the backtest that motivated this

- **Search tax.** DOGE daily-3d emerged from roughly 50–85 pair × geometry
  looks. The vote book's standalone p is under 0.1%; family-wise it is nearer
  **8%**. This is the best-supported result the project has produced and it is
  not the same as p < 1%.
- **The nulls cannot rank the books.** Vote and 6-of-8 both scored 0
  exceedances; nothing in the calibration says which rule is better.
- **7 of 8 has no null at all.** The 200-shift screen stored nulls before the
  quorum ladder existed, so the rung with the best dollars is the rung with no
  noise floor.
- **Friction is deliberately punitive.** $0.50 per leg is roughly 5× Binance
  spot taker. Results should be read as edge net of a worst-case toll.
- **Capital.** A new signal each day against a 41-hour hold means up to two
  concurrent positions. The book's implied capital is ~$200–300, not $100.

## Mechanics (frozen)

- **Pair:** DOGEUSDT, compared against BTCUSDT.
- **Geometry:** `daily-3d`. A chunk is 72 hours of hourly candles, stepping one
  calendar day, so a new prediction exists every day.
- **Entry:** chunk start + 73h (01:00 UTC the day after the chunk closes),
  hourly candle **open**.
- **Exit:** chunk start + 114h (18:00 UTC the following day), hourly candle
  **open**. A 41-hour hold.
- **Band:** the adaptive band — 33rd percentile of |entry→exit move| computed
  on training chunks **only** — frozen at initialization and never recomputed.
- **Models:** the 8-spec grid (feature views full / prices / volume / cross ×
  logreg / boost), trained once on every chunk whose outcome completed before
  the cutoff **2026-07-01**, then frozen. Weights live on disk. They are never
  retrained, and no data from 2026-07 onward influenced them.
- **Economics:** $100 notional per order, $0.50 friction per leg ($1.00 round
  trip). +1 long, −1 short, 0 no trade. P&L sums; no compounding, no sizing.

## Books — all five declared in advance, all five reported

| book | rule |
|---|---|
| `vote` | majority of the 8 specs; **any** tie stands aside |
| `q5` | trade only when ≥5 of 8 specs call the same direction |
| `q6` | ≥6 of 8 — the rung pre-registered in the backtest |
| `q7` | ≥7 of 8 — the rung with the best backtest dollars |
| `q8` | unanimous |

Quorums are **absolute counts**, not pluralities: 5 up against 3 down does not
clear a quorum of 6.

Reporting every rung is what keeps this free of selection bias. Nothing is
chosen after the fact, so no multiplicity correction is owed, and the forward
gradient can be compared directly against the backtest gradient above. Each of
the 8 individual specs also keeps its own book for reference.

**No rung will be promoted to "the" rule on the basis of live results.** If the
gradient persists, that is the finding. If it inverts, that is the finding.

## Provenance

A period is **LIVE** if its prediction was recorded before its outcome could be
known — before the exit candle at +114h. Anything recorded later (the backfill
from cutoff to initialization, or periods missed while the service was down) is
labeled **unseen**: still data the frozen models never trained on, reported
alongside but not counted toward the live verdict.

The guarantee is determinism — frozen weights plus published candles mean
anyone can recompute any prediction — with the record required to exist before
the result does.

**Known infrastructure caveat, stated up front:** the entry candle at +73h
typically precedes the arrival of the bulk-portal data the prediction is
computed from (api.binance.vision is DNS-dead and api.binance.com returns HTTP
451 from this VPS, so only lagging daily zips are available). Entry-time
execution is therefore an **assumption of the paper book**, not something this
infrastructure can prove. The exit-based LIVE rule is honest about what is
verifiable; the entry price is taken from the published candle.

## Evaluation

- **Horizon:** 90 live periods, or 2026-12-31, whichever comes first.
- **Primary reading:** the vote and q7 books' net P&L, and whether win rate
  still rises monotonically across q5 → q8.
- **Secondary:** per-spec books, accuracy against the frozen band.
- Interim numbers are visible at all times and mean nothing until the horizon.
  Stopping early because a number looks good is the failure mode this document
  exists to prevent.

## Amendment log

Nothing may be altered after the first live period. If a change proves
unavoidable, the live record **restarts** and the reason is written here.

- *(none yet)*
