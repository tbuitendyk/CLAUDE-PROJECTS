# Live tracker — pre-registered protocol

Committed BEFORE the first live week. No mid-stream changes: if anything
here is altered after the first live prediction, the record restarts.

## What is frozen

- **Pairs:** DOTUSDT and AVAXUSDT, each vs BTCUSDT. Chosen because they were
  the only pairs to pass the consensus screen (8/8 and 7/8 specs positive)
  with a 0-of-10 label-shift null exceed rate (screens of 2026-07-22).
- **Models:** per pair, the full consensus grid — 4 feature views (full /
  prices / volume / cross) x 2 models (logreg / boosted trees) — trained
  once on all labelable chunks whose Tue/Thu label windows completed before
  **2026-07-01** (the end of the data era every prior screen used), with the
  adaptive band calibrated on that same training window. Weights persist in
  `data/tracker/`; they are never retrained during the test.
- **Headline signal:** majority vote of the 8 specs; any tie (including
  top-count ties involving 0) means stand aside.

## Paper-trade mechanics

- $100 notional per order. Vote +1 = long, -1 = short, 0 = no trade.
- Market orders at the TIME midpoint of each window: entry = Tuesday 03:00
  UTC hourly open; exit = Thursday 15:00 UTC hourly open.
- Friction: $0.50 per leg, $1.00 per round trip.
- Each of the 8 specs also runs its own $100 book, for method comparison.

## Provenance rules

*(Amended 2026-07-23, BEFORE any live week existed — see Amendment log.)*

- A prediction is **LIVE** if it was computed from the frozen weights on
  data ending the chunk's final Monday 23:59 UTC and **recorded before the
  outcome window opens (Thursday 12:00 UTC of its week)**. The anti-peeking
  guarantee is determinism, not the wall clock: a prediction is a pure
  function of the committed frozen weights and Binance's published candles,
  so its value is verifiable by recomputation regardless of when it was
  written down — provided it is written down before the outcome exists.
- Everything recorded after its Thursday 12:00 — the seed backfill from
  2026-07-01 to tracker start, and weeks caught up after long downtime — is
  flagged **SEEDED** and reported separately.
- Paper pricing is unchanged (entry Tue 03:00 open, exit Thu 15:00 open).
- Data: Binance public bulk portal (monthly + daily zips) plus its keyless
  REST data mirror when reachable. No other sources; no AI anywhere in the
  loop.

## Amendment log

- **2026-07-23** (zero live weeks recorded at the time): LIVE originally
  required recording before the Tue 03:00 entry. A reachability probe from
  the VPS that day showed Binance's REST mirrors are no longer available
  from its location (api.binance.vision: DNS NXDOMAIN; api.binance.com:
  HTTP 451 geo-block), leaving only the bulk portal, whose daily zips for a
  given Monday publish on Tuesday — usually after 03:00 UTC. Under the
  original clock rule nearly every week would have been flagged seeded
  forever. LIVE was redefined as above (recorded before the outcome window
  opens, determinism as the guarantee). No other rule changed.

## Evaluation

- **Horizon: 26 LIVE weeks per pair from the first live prediction.**
  Scored in full at the end, whatever it says. Seeded weeks are reported
  alongside but do not count toward the pre-registered verdict.
- Metrics, per pair, on live weeks only: vote-book P&L after fees; vote
  accuracy vs the realized class; directional hit rate. Pass = vote-book
  P&L > 0 AND accuracy above the best-constant baseline of those same
  weeks. Anything else = fail, published as such.
- No optional stopping, no mid-stream tweaks, no selective reporting:
  both pairs are scored and reported regardless of results.
