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

- **Retune dial CLOSED (owner, 2026-08-02) — restored after an edit
  wiped it (caught by the independent design review):** the 5-variable
  combination (agreement level, gate, entry method, tripwire/target
  distance, time limit) stays in force R calendar weeks, then ALL FIVE
  are re-picked on recent data ("that's the point of the exercise").
  Candidates: R = 4, 8, 12 weeks, plus never-retuned as control.
  Lookback per retune = m x R, with m auto-permuted over {1, 2}.
  Combination settings: 3 R x 2 m + 1 never-control = 7; with the
  5 age settings the grid is 35 passes per fold, 105 across 3 folds.

- **Folds: three**, placed early / middle / late through history —
  105 passes total on the selected setup. One fold ranks an era;
  three rank the dials.
- **Grading:** picking happens on TEST stretches only. The winner is
  declared ONCE, on combined test performance across all three folds
  (never per fold — that would be three shopping trips). The declared
  winner is then graded on the three HOLD windows, each touched
  exactly once.
- **Training floor first value: 180 effective days, GUESSED.**
  Arithmetic constraint that sets the ceiling: a half-life discount
  caps effective training at ~1.44 x half-life regardless of loaded
  history; the 6-month arm caps at ~262 effective days, so any floor
  above that would make the 6-month candidate structurally
  unrunnable (the money-gate disease). 180 sits under the cap and
  still catches genuinely starved runs.
- **Window boundary: nothing survives a boundary.** Any position open
  when a test/hold window ends is closed at that stretch's final
  price and counted there; every window starts flat; no agreement
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

## Independent design review (2026-08-02) — outcome

Three independent reviewers (overfitting, mechanism, purpose lenses)
returned ~30 findings. The design is NOT complete. Full reports in the
session record; the substance:

### ADOPTED as instrument-honesty fixes (no owner ruling changed)

1. **Purge at every boundary** (QC 58 class): every train/test, test/
   hold, retrain cutoff and lookback edge is purged by the execution
   reach (the walkforward reachMs arithmetic, ~10-11 days for the
   daily shapes). The legacy 70/15/15 splitter purges nothing — the
   probe must not inherit that.
2. **Retunes score only stored out-of-sample calls**, on the walk
   clock, never by re-predicting history the members trained on; the
   lookback ends one reach before the retune date.
3. **The null is rebuilt per cell**: informationless votes are
   untrained, so the age axis would collapse in a naive null (35 real
   options vs ~7 null options — best-of-35 beats best-of-7 on pure
   luck). Fix: an independent QC-66 vote deal per grid cell and per
   retrain segment; the null inherits DATES AND LOOKBACKS ONLY and
   picks its own winners at every retune and at the grid pick. Null
   draw count N declared before launch (resolution floor 1/(N+1));
   planted-signal gate before any real read.
4. **Retune menu restricted to vote-using gates** (a retune must not
   move the pass onto the always gate mid-walk).
5. **Undefined retune states defined**: the cell in force before the
   first retune (and for never-retune arms) = the survivor row's
   declared cell; if no candidate clears the trade floor at a retune,
   the incumbent cell stays until the next retune; the trade floor
   scales with lookback length.
6. **Floor semantics**: clearance for all passes computed from
   calendar arithmetic AT LAUNCH; an arm that fails any placement is
   dropped from ALL placements (never 2-fold vs 3-fold comparisons);
   the floor applies to each pass's initial training.
7. **Disjointness asserted at launch**: every hold window disjoint
   from every test window of every placement, printed with dates.
8. **Reference arm named and run first**: no-discount x never-retune
   is the untuned baseline through the same three placements —
   without it "did tuning beat not tuning" has no answer.
9. **m is a named, GUESSED launcher parameter**; per-placement
   effective training days reported, and the reading must rank
   performance against effective days before crediting recency.
10. **Trailing stays out of the retune menu** (held fixed on purpose,
    named in the launcher, revisit date set) — the re-picked
    variables are exactly the five the owner ruled: agreement level,
    gate, entry method, tripwire/target distance, time limit.
11. **Per-coin family pre-registered**: every probe run is reported;
    "k of N coins" is judged against the pooled null; no coin quoted
    alone. A winner here is a candidate for replication, never a
    finding from one measurement.
12. **Plumbing noted for the build**: per-example age weights must be
    threaded through tuneAndTrain/boost/tau (only trainSoftmax takes
    them today); a walking-retrain orchestrator is new code;
    lambda-ladder validation weighting must be stated.
13. **Glossary duties**: stretch/slice replaced by window in this doc;
    'retune' is the one term (re-vote retired); History Tuning, pass,
    placement, reference arm to be defined in the glossary before the
    build order.

### NEEDS OWNER RULING

A. RULED (owner, 2026-08-03): retrains are anchored to the DATA
   CALENDAR, not the walk — a milestone every half-life counted from
   the start of loaded history (60 months at H=12: retrains at months
   13, 25, 37, 49), regardless of where test/hold windows fall. At
   each milestone the 6 members are retrained fresh on all history so
   far with the half-life discount; old members are discarded (the
   snapshot-blending variant was considered and set aside — it would
   change the committee's voting arithmetic). Every H arm now
   genuinely retrains; the walk-length objection is void. ORIGINAL
   ISSUE (for the record): **the retrain coupling was structurally
   broken for long half-lives.**
   A ~10.8-month test window cannot contain a 12/24/36-month retrain
   interval: H=24/36 arms never retrain at all (their retrain calendar
   is identical to the control's), H=12 first retrains inside hold.
   And the no-discount control is the ONLY arm that never absorbs new
   data, so "discount beat control" would be unattributable between
   weighting and retraining (two changes at once). Options:
   (a) decouple: a small retrain-cadence menu that fits the walk;
   (b) keep the coupling, relabel H>=12 arms "discount-only", and add
   ONE arm — no discount + periodic retrain — so the retrain effect
   is attributable. Session recommendation: (b).
B. **Hold contamination by prior selection.** The survivor was picked
   on the most recent history; late-placement holds re-grade data the
   setup already had to look good on (H1 measured this anti-predicting
   at era distance). Options: pin placements so holds fall outside the
   original run's search+holdout ranges where history allows; any hold
   that overlaps them is downgraded to instrument-reading-only, with
   the binding grade from a forward paper book. Needs the owner's yes.
C. **Window-boundary rule.** Close-at-boundary contradicts the
   simulator (it walks trades to their own horizon, boundary-blind);
   the codebase convention is purge-out (a trade whose reach crosses
   a boundary is never opened). Adopting purge-out avoids new
   simulator plumbing and matches every existing instrument — but it
   changes the owner's ruled sentence. Needs the owner's yes.
D. **Placement geometry must be pinned.** Three 70/15/15 splits of
   sub-spans: the spans, anchors and overlaps are undefined and every
   retrain/floor number depends on them. A concrete proposal comes
   with the build order once A-C are ruled.

## Status

Design NOT complete: open on rulings A-D above. Next artifact after
those rulings: the rule-2 build-order paragraph (which will also carry
the declared picking metric, fold-combining rule, hold reading rule,
and null comparison rule, each labeled DERIVED or GUESSED).
