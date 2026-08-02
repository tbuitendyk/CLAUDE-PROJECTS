# History Tuning — the design ledger (living document)

Owner + session, started 2026-08-02. This is the mechanism being worked
out BEFORE anything is built (OWNER-SPEC.md rule 2). Nothing here is a
build order yet. Serves spec point 3.

## The vision (owner, verbatim intent)

Select one item from the survivor board. If that item was
trained/tested/held on the 70/15/15 structure, the "History Tuning"
button/section below activates. The feature runs many passes through
the data, tuning (a) the relevance weighting for recent vs. old
models and (b) the frequency of re-votes for agreeing members among
the models.

## AGREED so far

- **One survivor at a time.** The probe runs on a single selected
  survivor-board row, not a fleet.
- **Activation rule.** "History Tuning" activates only for rows from
  70/15/15-structure runs AND whose gate actually uses the votes
  (directional or active). Always-gate rows are excluded (owner,
  2026-08-02): the always gate enters regardless of votes, so both
  tuning dials would act on nothing. Inactive control states the
  reason in words.
- **Nothing hides: effective training days.** Every pass reports the
  weight-adjusted amount of training data its members actually saw
  (sum of per-day age weights, expressed in days). With no age
  discount this equals calendar days; with discounting it shrinks.
  A column in the results table, always.
- **A training floor, SYSTEM-WIDE (owner, 2026-08-02).** The training
  floor = the minimum effective training days a run must have to be
  allowed to run. It applies to EVERY launch in the system, not just
  History Tuning: for undiscounted runs effective days equal calendar
  days, so it is one check at launch. Any run below the floor refuses
  loudly, stating its number — it never returns a plausible-looking
  result from starved members. The floor's first value is labeled
  GUESSED (proposed start: the effective amount of the weakest setup
  that demonstrably worked); revisited once real probe results show
  where quality degrades.
- **Age dial CLOSED (owner, 2026-08-02):** smooth per-day half-life
  discount (each training example's weight halves per half-life of
  age; nothing discarded). Candidate values: 6, 12, 24, 36 months,
  plus no-discount as control — five age settings.
- **Member retraining rides the half-life (owner, 2026-08-02):**
  members are retrained periodically as the pass walks forward, and
  the retraining interval equals the half-life setting itself
  (6-month half-life = retrain every 6 months; no-discount control =
  trained once, never retrained). Each retrain uses all history up to
  that date, discounted by the same half-life. One number drives both
  the discount curve and the retraining calendar.
- **The decision trail is recorded, fully (owner, 2026-08-02):**
  every pass writes its complete dynamic trajectory, machine-readable:
  each retrain date (with half-life and effective training days at
  that moment); each retune date, its lookback, all candidate
  combinations scored and the winner picked; and the exact periods
  each configuration was in force across test and hold. Purpose: the
  null check must replay the SAME schedule with the SAME freedoms on
  informationless votes (register 64 — machinery freedom manufactures
  apparent skill), so the overfitting granted by dynamic shopping is
  priced into the null, not ignored. No trail, no null, no claim.
- **Age discount applies to TRAINING only.** Test and hold scoring
  are never age-weighted; the dials change what members learn from,
  not how they are graded.

## AGREED — final rulings (owner, 2026-08-02)

- **Folds: three**, placed early / middle / late through history —
  105 passes total on the selected setup. One fold ranks an era;
  three rank the dials.
- **Grading:** picking happens on TEST stretches only. The winner is
  declared ONCE, on combined test performance across all three folds
  (never per fold — that would be three shopping trips). The declared
  winner is then graded on the three HOLD stretches, each touched
  exactly once.
- **Training floor first value: 180 effective days, GUESSED.**
  Arithmetic constraint that sets the ceiling: a half-life discount
  caps effective training at ~1.44 x half-life regardless of loaded
  history; the 6-month arm caps at ~262 effective days, so any floor
  above that would make the 6-month candidate structurally
  unrunnable (the money-gate disease). 180 sits under the cap and
  still catches genuinely starved runs.
- **Slice boundary: nothing survives a boundary.** Any position open
  when a test/hold stretch ends is closed at that stretch's final
  price and counted there; every stretch starts flat; no agreement
  carries across. The existing simulator's edge behavior gets
  VERIFIED at build time, not assumed — any mismatch is reported.
- **Real-time feedback (owner):** the monitoring environment provides
  constant meaningful live progress — which fold, which dial pair,
  retrains/retunes completed, effective training days, and partial
  results as they land. No silent grinding.
- **Review requirements (owner):** (1) a complete adversarial code
  review after the implementation is written, before deploy (QC 63
  practice, full scope); (2) an INDEPENDENT design review of this
  document by fresh eyes before the build order is issued.

## Status

Design COMPLETE pending the independent design review. Next artifact:
the rule-2 build-order paragraph for the owner's go, incorporating
any review findings.
