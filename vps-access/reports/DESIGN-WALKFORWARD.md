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

## Held fixed at first, named (search-shape rule)
Committee = the 6 members as they stand; execution grid as it stands;
singles only; trailing stops off. One knob at a time after the baseline.

## Cost expectation
Each fold retrains 6 members per setup: ~30 folds x 170 setups ~ 15x an
L14-scale run ~ 5-6 hours of box time for the full stacked sweep; a
single-asset pilot ~20 minutes. Calibration on planted data runs locally
first and costs nothing on the box.

## Order of work when unblocked
1. Planted-data calibration of the harness (local, QC 56)  2. single-asset
pilot on the box  3. full stacked sweep  4. H1b scramble floors  5. read
against rules declared in the launcher, as ever.
