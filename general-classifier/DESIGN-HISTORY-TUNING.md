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
- **Age discount applies to TRAINING only.** Test and hold scoring
  are never age-weighted; the dials change what members learn from,
  not how they are graded.

## PROPOSED, not yet accepted
- **Retune cadence (replaces 're-vote'; owner's level-2 framing,
  2026-08-02):** the 5-variable combination (agreement level, gate,
  entry method, tripwire/target distance, time limit) stays in force
  R calendar weeks, then is retuned on recent data. Candidate R:
  4, 8, 12 weeks, plus never-retuned-within-the-pass as control.
  The lookback scoring each retune's candidates = a whole-number
  multiple m of R (owner; the integer m still to be chosen).
- **Grading protocol:** all passes are picked on the TEST 15% only;
  the results table is test-slice numbers. A separate "confirm
  winner" action runs the single chosen dial pair ONCE on the hold
  15% and stamps that as the grade. The hold is touched exactly once
  and never shopped on.
- **Search shape:** full grid as the FIND pass (~4 age × 4 re-vote =
  16 passes on the one setup), declared direction-finding per the
  wide-to-find rule; the confirm step is the narrow phase.

## OPEN — must be settled before any build order

1. Owner's answers to the age-dial form and re-vote meaning (above).
2. **The deepest fork — "recent vs old MODELS":** when the age
   discount is active, are members still trained ONCE at the 70%
   boundary (one model per member, old days discounted)? Or does the
   owner mean literally recent and old MODELS — members re-trained
   periodically as time advances, with vote influence weighted by
   model age? The two mechanisms are different machines; the words
   so far fit both.
3. The floor's starting value and exactly which historical setup
   anchors it.
4. Edge rules at slice boundaries when a K-day agreement is in force
   as a slice ends (position forced closed? carried?). Must match
   whatever the existing simulator already does, stated explicitly.
5. Cost statement: the launcher must show pass count x estimated
   minutes before anything fires.
