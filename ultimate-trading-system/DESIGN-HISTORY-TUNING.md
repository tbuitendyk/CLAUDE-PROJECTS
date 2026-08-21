# History Tuning — the design ledger (living document)

> **READ THIS FIRST — a historical record, not current instruction (2026-08-21).**
>
> This is how History Tuning was thought through, ruled on and built. The
> reasoning is still the reasoning behind the feature, which is why the document
> is kept.
>
> But everything it says about SCREENS is out of date. It describes the Bracket
> lab, its Help page, a Research tab and a data-management section — all of
> which were retired. History Tuning now lives in the **History** section of the
> **Construct** tab, and the calibration check it describes as a button at the
> top of the Bracket lab is in the **Verify** section.
>
> Where this document and the running system disagree about what is on screen,
> the system is right. Where they disagree about WHY something was decided, this
> document is the record.

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
- **Grading:** picking happens on TEST windows only. The winner is
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
   options vs ~7 null options — best-of-35 beats best-of-7 on chance
   alone). Fix: an independent QC-66 vote deal per grid cell and per
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
B. RULED (owner, 2026-08-03): both options, in roles. (1) Board runs
   may carry a RESERVE: layout 61/13/13/13 — the final 13% of history
   untouched by the board run, sealed for the History Tuning winner's
   binding grade. Launcher prints the reserve length in weeks and
   refuses below a minimum (GUESSED first value). (2) For survivors
   whose original run carried no reserve (all current ones), the
   History Tuning run's entire timeline ends where the original run's
   test window begins — every window clean by construction, refuse at
   launch if three splits above the training floor no longer fit; the
   binding grade is then the forward paper book. One-touch rule: a
   reserve grade is ONE VERIFICATION EVENT — the winner's grade and
   its matched null draws together, published once; nothing is ever
   re-picked from reserve results. History Tuning remains an OPTIONAL
   second step always; null-sweep-then-select on first-pass boards is
   unaffected (nulls replay their real counterpart's windows, never
   consuming extra data). ORIGINAL ISSUE (for the record): **hold
   contamination by prior selection.** The survivor was picked
   on the most recent history; late-placement holds re-grade data the
   setup already had to look good on (H1 measured this anti-predicting
   at era distance). Options: pin placements so holds fall outside the
   original run's search+holdout ranges where history allows; any hold
   that overlaps them is downgraded to instrument-reading-only, with
   the binding grade from a forward paper book. Needs the owner's yes.
C. RULED (owner, 2026-08-03): Rule 2 — don't start what can't
   finish — with PER-CELL reach purge to conserve maximum data: near
   a window edge, a candidate cell opens no new trade whose own
   worst-case lifetime (its time limit + entry offset + settlement)
   would cross the boundary. The zone is computed per cell, never a
   fixed constant (41h cell ≈ 2-3 days, 161h ≈ 7-8; the old ~10-day
   figure was the worst case only). Declared property: shorter-limit
   cells trade closer to edges — true in live use, identical for real
   and null passes. Close-at-boundary is dead: no amputated trades,
   no new simulator plumbing. ORIGINAL ISSUE (for the record):
   **window-boundary rule contradicted the simulator.** Close-at-boundary contradicts the
   simulator (it walks trades to their own horizon, boundary-blind);
   the codebase convention is purge-out (a trade whose reach crosses
   a boundary is never opened). Adopting purge-out avoids new
   simulator plumbing and matches every existing instrument — but it
   changes the owner's ruled sentence. Needs the owner's yes.
D. RULED (owner, 2026-08-03): expanding-training splits. The usable
   span (loaded history minus the original run's test+hold months per
   ruling B, or minus the sealed reserve) carves its back span into
   six equal, disjoint test/hold windows (~6 months each on today's
   data): early split trains 1-14, tests 15-20, holds 21-26; middle
   trains 1-26, tests 27-32, holds 33-38; late trains 1-38, tests
   39-44, holds 45-50. Training always = ALL history before the
   split's test window. Floors checked per arm at launch with dates
   printed; refuse on any failure. Recipe applies proportionally to
   the real span at launch. ORIGINAL ISSUE (for the record):
   **placement geometry was undefined.** Three 70/15/15 splits of
   sub-spans: the spans, anchors and overlaps are undefined and every
   retrain/floor number depends on them. A concrete proposal comes
   with the build order once A-C are ruled.

## Status

Rulings A-D all CLOSED (2026-08-03). Remaining before the build order:
declared reading rules (picking metric, split-combining rule, hold
rule, null comparison rule — each DERIVED/GUESSED), glossary update
(new terms defined, collisions settled), declared null draw counts. Next artifact after
those rulings: the rule-2 build-order paragraph (which will also carry
the declared picking metric, fold-combining rule, hold reading rule,
and null comparison rule, each labeled DERIVED or GUESSED).

## THE COMING BUILD — standing acceptance rule and manifest
## (owner, 2026-08-03)

**Acceptance rule: every component tweaked or implemented in the next
release must make sense — kill the irrelevant, propose the missing.**
No null test ships un-rebuilt, un-calibrated, or without a declared
reading rule. Design-and-audit phase until the owner orders the build;
nothing is touched front or back before that.

Manifest (each item ships with plain-language why/how/when copy on the
page, per WORKFLOW.md, which is the master text):
1. History Tuning per this ledger (rulings C and D still open).
2. Window-layout control: legacy 80/20 and 70/15/15 only; holdout
   checkbox removed; interlaced machinery purged; reserve layout
   61/13/13/13 added.
3. Below-the-board reorganization: one null-tests section (both
   tools, each naming the chance layer it prices), inspect labeled
   as microscope, general compare-two-runs tool (differences always
   listed; attributable only at exactly one difference).
4. Both null tools rebuilt on the register-66 dealt-votes
   construction; planted check for the sweep pipeline built and
   passed before either is trusted.
5. Declared reading rules printed by every null launcher: pass/fail
   sentence, draw count, resolution floor.
6. Settings visibility: window layout in the job header settings
   table; arm tags on historical twin rows; gate/entry column with
   cells matching the header format (active/breakout).
7. Vocabulary purge of all user-facing strings (retired words out),
   with a repo check keeping them out.
8. **Bracket lab help page (owner, 2026-08-03):** the lab's Help
   opens a DEDICATED page for the Bracket lab that explains everything
   thoroughly and IN ORDER: each page component shown with a graphical
   reference (an annotated visual replica of that component, callouts
   pointing at its controls, drawn in HTML/SVG so it always matches
   the shipped page), usage guidelines per component, and the PATHS
   through the interface compared side by side — what each path
   achieves and what it cannot claim (e.g., sweep-and-look = direction
   only; sweep + null boards + two reads = survivors; + History Tuning
   + replication + paper book = the full evidence chain). WORKFLOW.md
   is the master text it renders.
9. RULED OUT OF SCOPE (owner, 2026-08-03): the Research tab is left
   alone entirely — this build is the Bracket lab only.

## ADDED BY OWNER ORDER (2026-08-03, during the build)

- **Data management in the research tab's "available data on server"
  section**: specify NEW pairs for download; per-asset "Refresh To
  Latest"; "Global Refresh" across everything already downloaded; purge
  data per asset; increase/decrease the month range of available data
  per asset. Guard behavior unchanged: refuses while a job runs.

## READING RULES & DRAW COUNTS — OWNER-APPROVED (closing the Status gap)

The four reading rules (picking DERIVED, combining GUESSED, hold
GUESSED, null GUESSED-count/DERIVED-construction) and the draw counts
(200 null rounds for the per-row tool; 19 trail-replay draws, floor
1 in 20) were approved by the owner in chat on 2026-08-03 ("as long as
the declared reading rules don't restrict my choices... i'm ok with
them" + draw counts standing as proposed). Recorded here so the
contract document and the code agree (review finding 18).

## ADDED BY OWNER ORDER (2026-08-03, evening) — the planted-check button

Owner's placement and integration orders, verbatim in substance:
- The planted check becomes a BUTTON at the TOP of the Bracket lab
  interface, ABOVE the "Data on server" section, quoting the current
  release number and the gate status — PASS or FAIL or NOT CHECKED —
  with version numbers quoted.
- The fake-coin data generation integrates into the data-updating
  machinery so the fabricated pair's history always spans oldest-to-
  newest of the real loaded data (regenerated on refresh/download).
- Acknowledged consequence (owner): the check's code must be kept
  current with every release — hence the version rule: a PASS belongs
  to the engine version that earned it; a new release starts NOT
  CHECKED.
Design (agreed in chat before the go): caller-not-copy — the button
fires ONE ordinary sweep on the reserved fabricated pair
(PLANTEDUSDT) through the real front door with four null boards;
reading rules stamped at launch (G1 find+profit DERIVED, G2 beats
always-long DERIVED, G3 every null board below a quarter of the real
best — direction DERIVED, factor GUESSED); the reserved pair is
refused in every real run and by History Tuning; the null tools carry
a warning while the running engine holds no PASS. Shipped in 1.33.0.

## ADOPTED AS STANDARD PROTOCOL (owner, 2026-08-03) — twin paper books

After a History Tuning winner survives its grade, the forward paper
test runs as TWIN books: the TUNED configuration and its UNTUNED
reference, declared together, same coin, same rules window. The
forward record then answers "did tuning help" with zero lookback,
instead of assuming the reserve grade generalizes. (Owner's addition
during the roadmap consult: "why wouldn't we run another check of the
'final candidate' results after 7 to see if the history tuning is
working?")
