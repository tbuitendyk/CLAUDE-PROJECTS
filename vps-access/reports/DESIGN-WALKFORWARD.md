# The stacked walk-forward design (retool blueprint, 2026-07-31)

Owner's direction: Ln loops on hold; replace single-draw holdout verdicts
(QC 57) with a design that stacks train/test/hold sets through the entire
history. Parameters below are DERIVED from the H1a decay curves where
possible and labeled GUESSED where not. NOTHING HERE IS BUILT until the
owner has reviewed this document.

## The fold
For fold k at calendar time t_k:
  TRAIN  history up to t_k, weighted toward the trailing 1-2 years
         [DERIVED: member skill half-life ~1y]
  TEST   the next slice after t_k: members vote, the assembly (agreement
         level + execution cell) is picked HERE, fresh, per fold
  HOLD   the slice after that: the picked assembly scored ONCE
Then step forward by DELTA and repeat, marching to the present.

## Derived parameters
  slice length   8 weeks test, 8 weeks hold  [DERIVED loosely: assembly
                 transfer is strong only at <6mo gaps; slices must sit
                 well inside that. Whole weeks preserve weekday mix.]
  DELTA (step)   8 weeks  [DERIVED: re-pick well inside the months-scale
                 assembly half-life; also gives non-overlapping hold
                 slices tiling all of history]
  folds          ~2,000 days of history yields roughly 30 folds per coin;
                 every era contributes hold slices by construction
  train window   all history to t_k with 2x weight on the trailing 104
                 weeks [GUESSED weighting shape; the 1-2y scale is derived,
                 the factor 2 is not — a one-knob experiment later]

## What the design buys
- Placement noise averaged away: the verdict is a DISTRIBUTION over ~30
  hold slices spanning every era, not one draw (kills the QC 57 failure
  mode by construction).
- Re-voting built in: each fold re-picks the assembly on recent data —
  the owner's re-vote hypothesis is the design's spine.
- Decay handled, not wished away: nothing is ever trusted beyond the
  horizon its half-life supports.

## Guard rails carried over
- Count invariant: every fold's test and hold slices have identical
  potential trade days across coins and folds (whole-week slices).
- Purge: train never shares candles with test/hold; test picks never see
  hold (the existing execution-horizon purge arithmetic reused).
- QC 56: the harness is calibrated on planted data BEFORE any real read —
  including the rotating-view plant (H1d): member-level signal whose best
  view rotates every ~100 days; the walk-forward must harvest it, a
  frozen assembly must not.
- H1e: null runs replay the ENTIRE per-fold re-picking recipe on
  scrambled labels — the recipe's freedom priced into its floor.
- Reporting: per-fold results with cross-fold spread; per-asset
  concentration beside any aggregate (QC 47/57); gross beside net
  (QC 37); vs-always-long per hold slice (QC 54 — slices are contiguous,
  so the control is valid again).

## Per-coin pre-calibration (owner, 2026-07-31 — essential piece)
The pooled half-lives above are 17-coin averages; coins' regime clocks
almost certainly differ. So the design carries a CALIBRATION STAGE:

- **The calibration ledger.** Per coin, a stored artifact holding its two
  decay curves (member skill vs gap, assembly skill vs gap) computed from
  its block-scored skill series — exactly the data the instrument already
  produces, formalized. The fold harness extends it as it marches.
- **Shrinkage, declared.** A single coin has ~1/17 of the pooled evidence,
  so its calibration is a BLEND: start at the population curve, move
  toward the coin's own curve as its evidence accumulates, blend weight
  set by data volume. [Blend form GUESSED initially; it is a knob.] This
  is the guard against calibration becoming a new shopping layer.
- **No peeking.** At fold k, a coin's calibration uses only blocks that end
  before t_k. Calibration is part of the recipe; null runs replay it
  (H1e extends to the calibration step).
- **What personalizes vs what stays uniform.** The fold grid — slice
  lengths and step — stays UNIFORM across coins, preserving the identical
  potential-trade-day invariant and cross-coin comparability. What the
  ledger drives per coin: (a) the training window's recency weighting
  (that coin's member half-life), (b) the assembly picker's trust
  lookback (that coin's assembly half-life). Bootstrap: population
  defaults until a coin's ledger clears a declared minimum-evidence
  threshold [threshold GUESSED; declared in the launcher when set].

## Held fixed at first, named (search-shape rule)
Committee = the 6 members as they stand; execution grid as it stands;
singles only; trailing stops off. One knob at a time after the baseline.

## Cost expectation
Each fold retrains 6 members per setup: ~30 folds x 170 setups ~ 15x an
L14-scale run ~ 5-6 hours of box time for the full stacked sweep; a
single-asset pilot ~20 minutes. Calibration on planted data runs locally
first and costs nothing on the box.

## Order of work when unblocked
1. Planted-data calibration of the harness — including a two-coin plant
   with DIFFERENT built-in half-lives, which the per-coin calibration
   stage must recover distinctly (QC 56)  2. single-asset pilot on the box
3. full stacked sweep  4. H1b scramble floors  5. read against rules
declared in the launcher, as ever.
