# The age dial on the three-stage engine — design, before any build

Written 2026-09-08 inside the owner's loop (VERIFY-DESIGN.md section 8, decision
10: "History Tuning with the age dial: rebuilt for the three-stage engine as a
new instrument with its own pair of calibration exams, its own design document
first, after (a) to (d)"). Nothing here is built. Every number below is
labelled DERIVED (it follows from something already measured or declared) or
GUESSED (a starting point the owner may move), and section 9 lists what the
owner has to decide before a build order.

## Summary

- **The question the dial answers.** Does a member that leans on recent
  history — each training day's weight halving every H days of age — forecast
  better than one that weighs every day the same, on the same coins, the same
  shapes, the same held-back windows, under the same rule? One number, H,
  declared before launch; never shopped.
- **What exists today cannot answer it for a stage set.** The panel on History
  headed "Age dial (HT v2) — one declared half-life vs the reference, paired
  folds" trains the OLDER engine's committee on the row selected on Boards and
  walks ~20 paired folds. A stage setting was never trained that way, so the
  instrument cannot run on it as it was measured. The owner's decision keeps
  that panel; this is a second instrument beside it.
- **The shape of the new instrument.** Two chains, not two arms of one walk:
  the reference chain the owner already has (a finished stage 1, its stage 2,
  its stage 3, and a Stage 4 record set whose rule is the declared rule), and
  a dial chain launched from the same setup with one addition, the half-life.
  The pair is read on the held-back window, one delta per coin-and-shape unit,
  the same rule applied to both, through the verdict's own arithmetic (the
  sign-flip null and the concentration rule the older instrument already
  declares). Every read of the held-back window is a stamped look.
- **Its own two exams, on fabricated coins, before it may touch a real chain:**
  exam A, several late-rule coins (the plant switches on only in the last
  third), where the dial MUST find an advantage; exam B, several coins with
  the plant on the whole span, where it MUST NOT. Both under the current
  release line, both refusals in the ordinary launcher.
- **Second digit** when built: new behaviour, a new control on Sweep's stage
  1, a new record kind; nothing on disk stops being readable.

## 1. What the owner asked for, and what carries over

The owner's original intent (DESIGN-HISTORY-TUNING.md, "The vision"): tune
"(a) the relevance weighting for recent vs. old models and (b) the frequency of
re-votes for agreeing members". The agreed points that still bind, in the
owner's words where they were rulings:

- **Age dial CLOSED (2026-08-02):** a smooth per-day half-life discount; each
  training example's weight halves per half-life of age; nothing discarded.
- **Age discount applies to TRAINING only.** Test and held-back scoring are
  never age-weighted; the dial changes what members learn from, not how they
  are graded.
- **Nothing hides: effective training days.** Every run reports the weight-
  adjusted amount of training data its members actually saw. A column,
  always.
- **A training floor, system-wide.** Any run below the floor refuses loudly,
  stating its number. First value 180 effective days, GUESSED (lib/history.js
  already holds it and the refusal words).
- **One comparison, declared before it fires.** Reference against ONE
  half-life; the verdict fires on every run, pass or fail; the sum can never be
  carried by one piece of the evidence.
- **Entrance exams on the current engine version.** A known advantage must be
  found and a known non-advantage must not be.

What does NOT carry over, and why:

- **The retune dial (b)** re-picked the older engine's five-variable cell every
  R weeks. The stage engine has no such walk: stage 1 trains once on the
  training slice, stage 3 prices every setting from the kept votes, and a
  deployment retrains at its own training instant on the live path. There is
  no schedule to tune. Out of scope here; if the owner wants a walking retrain
  on the stage engine it is a separate instrument with its own document.
- **Retraining every half-life as the walk moves forward** goes with it, for
  the same reason.
- **~20 paired folds.** The older instrument re-trains per fold, which is cheap
  for one cell. A fold of the stage engine is a whole chain — stage 1, 2 and 3
  — and stage 3 on the owner's box is hours. Section 4 says where the pairs
  come from instead.

## 2. What the stage engine does with a training day today

Read out of `lib/stagework.js` and the Sweep screen:

- Stage 1 trains every member once on the training slice of each unit
  (`s1UnitTask`: `trainProbMember` with a `weights` array per training chunk,
  or none). Stage 2 reuses the stage 1 members untouched and trains the boost
  members the same way. Stage 3 trains nothing.
- The launch already carries one way of weighing training days: the tick on
  Sweep's stage 1 section "weigh each trade by the money it was worth" and the
  box beside it "the most one trade may count for" (`trainOn`, `weightCap`;
  3.69.0). Off, every trade is one lesson. On, a trade is weighed by the money
  its decision could have made or lost, capped. What a unit was actually
  trained under is written on its record (`trainedOn`), and the choice carries
  to stage 2 by itself.
- The training slice ends where the test slice begins; the seal (the unread
  13%) is cut away before anything trains. The date ranges every stage used
  are stored on every record (3.85.0).

So the dial has a place to live already: one more factor multiplied into the
same `weights` array, written onto the same `trainedOn` record, carried to
stage 2 the same way. Nothing about the test slice, the held-back slice, the
seal, the votes or stage 3 changes.

## 3. The dial, as it would be coded

- **One number, H, in days**, declared on the stage 1 launch. The weight of a
  training chunk is `0.5 ^ (age / H)`, age being the days from the chunk's
  start to the end of the unit's training slice (the same boundary the split
  already records). No H, or H empty, is the reference: every day weighs 1.
  This is `ageWeight` in `lib/history.js`, unchanged, applied at the stage 1
  boundary instead of a fold's.
- **It multiplies into what is already there.** Direction only: the age weight
  alone. Weighed by money: money weight times age weight, then the cap as
  today. One `weights` array reaches `trainProbMember`; the fitting does not
  know which factors made it.
- **Effective training days**, the sum of the age weights over the training
  chunks, is worked out per unit and written on the record beside `trainedOn`,
  and the launch REFUSES a unit whose effective days fall below the floor
  (180, GUESSED; `floorRefusal` in `lib/history.js` says the words). A launch
  refused on one unit is refused whole, in words that name the unit and its
  number, before anything trains.
- **Carried to stage 2 by itself**, as `trainOn` is; stage 2's boost members
  train under the same H. A stage 2 launched from a stage 1 set reads H off
  the parent and cannot be given another.
- **Never on the test or held-back slice, never on the seal.** The votes on
  the test and held-back chunks are cast by the members as trained; nothing
  downstream is weighed.
- **The choices offered:** 12, 24 and 36 months as the older instrument
  offers them (`HALF_LIVES` in `lib/httwo.js`; 6 months was excluded there
  because its effective days sit at the floor on this project's history), plus
  a box for a number of days the owner types (RULE FIVE: what the owner may
  choose from is theirs, not a list in the code). The mathematical ceiling on
  effective days for a half-life is H / ln 2 ≈ 1.44 H whatever history is
  loaded, and the launch prints it beside the floor so the owner can see when
  a short H cannot clear the floor at all.

## 4. The pair, and where the deltas come from

- **The reference chain** is one the owner already has: a finished stage 1
  set (H empty), its stage 2, its stage 3, and a Stage 4 record set cut from
  that stage 3 whose rule is the DECLARED rule. The instrument reads the rule
  off that set (its dials, ranges and limits, the same sentence the Funnel
  prints) and never re-walks it.
- **The dial chain** is launched by the instrument from the reference stage
  1's own saved parameters — the same coins, companions, shapes, months,
  window layout, null set, fee, training choices — with H added; then stage
  2 from it with the reference stage 2's parameters; then stage 3 from that
  with the reference stage 3's declared block. Three launches, each the same
  door the owner presses, each refusing what those doors refuse.
- **One delta per coin-and-shape unit.** On each unit the stage 3 set holds,
  the declared rule is applied to the unit's board on the reference chain and
  on the dial chain — the same walk "read the other units" makes on the
  Funnel and V6 makes on Verify — and the rule's mean held-back money per
  setting is read on each. The delta is dial minus reference, same unit, same
  rule, same held-back chunks, same fee. A unit where the rule keeps nothing
  on either chain is SILENT: disclosed, never invented, excluded from the
  statistic. A unit with survivors on one chain only is a delta against zero
  trades and is printed as such with a mark.
- **Why units and not settings.** The survivors of one unit share one coin,
  one window and the same deals; they are not independent draws (decision 1
  in VERIFY-DESIGN.md section 8 says exactly this of the 199). A sign-flip
  test over 199 deltas of one coin would count one piece of evidence 199
  times. Units are the honest count: with the owner's universe of nine coins
  on two shapes, up to 18.
- **Why the held-back window and not the test window.** The rule was chosen on
  the test window; a delta read there flatters whichever arm the rule happens
  to fit. The held-back window was sealed until Verify; reading it here is a
  look, stamped on BOTH Stage 4 sets (the reference set the owner cut, and
  the dial set the instrument cuts), counted on Verify's looks line. The test
  window's delta is printed too, marked information only.
- **The unread window is never touched.** It is the reserve grade's alone.

## 5. The reading rules, declared before any number

- **R1 (DERIVED).** The statistic is the SUM of per-unit paired deltas of the
  rule's mean held-back money per setting, dial minus reference. The count of
  positive units is descriptive, never the verdict.
- **R2 (DERIVED, fires on every run).** The null is the sign-flip randomisation
  of the per-unit deltas (10,000 resamples, seeded from the run id; the same
  `signFlipP` the older instrument uses). p = (resamples with sum ≥ observed
  + 1) / (resamples + 1). PASS needs p ≤ 0.05 AND R3.
- **R3 (DERIVED).** Concentration: the largest single positive unit delta over
  the total positive sum, printed with every verdict. A sum carried more than
  50% by one unit is CARRIED-BY-ONE-UNIT and cannot pass.
- **R4 (GUESSED).** Fewer than 8 usable units is INSUFFICIENT UNITS: no claim
  either way. Sign-flip over 8 units has a smallest attainable p of 1/256;
  below 8 the test cannot reach 0.05 at all, which is why the number is where
  it is.
- **R5 (DERIVED).** The instrument touches no real chain until, under the
  current release line (same first digit), exam A has PASSED and exam B has
  NOT passed. The launcher refuses, in words, like the planted gate and the
  stage-engine check.
- **R6 (DERIVED).** Every unit of every arm cleared the training floor, or the
  launch refused before anything trained.
- **R7 (DERIVED).** No unit failed on either chain and the rule replays its own
  survivors on both Stage 4 sets, or the verdict is NO VERDICT, not FAIL.
- **What PASS means and does not mean.** PASS: on these coins and shapes, under
  this rule, members trained with this H made more held-back money than
  members that weighed every day the same, beyond what flipping the signs of
  the unit deltas hands a random arm. It does not choose H (one H per run;
  several runs are several looks, each stamped), does not change any set, and
  says nothing about the rule's own worth: that is Verify's verdict, not this
  one's.

## 6. The two exams, on fabricated coins

The stage-engine check (`lib/stagegate.js`) already fabricates two reserved
coins with the planted check's generator and runs the whole chain on them in
about a minute per pair on a one-year span. The exams reuse that, with more
coins, because the verdict needs units:

- **Exam A — the dial MUST find it.** N late-rule coins (GUESSED N = 12): the
  same generator with the rule silent for the first two thirds of the span and
  on for the last third (`generateFabricated(span, symbol, seed,
  ruleOnFrac = 2/3)`), each with its own seed and a reserved name that never
  enters a real run. A member weighing every day the same learns two thirds
  noise; a member leaning on recent days learns the rule. Reference chain and
  dial chain at H = the declared exam half-life, the declared rule cut on the
  reference, the verdict read. PASS required.
- **Exam B — the dial MUST NOT find anything.** N coins with the plant on the
  whole span (`ruleOnFrac = 0`, the stationary pair the check already uses):
  every era carries the rule equally, so leaning on recent days can only
  starve the fit. NOT PASS required. A PASS here means the instrument invents
  advantages, and the real launcher stays refused.
- **The span.** The stage-engine check runs on 2024 alone, and the loop's
  four-year diagnosis (VERIFY-DESIGN.md step 2) showed a one-year span starves
  stage 1 on the daily shape; lengthening that span is parked for the owner.
  Exam A needs a span long enough that the last third clears the training
  floor on its own at the exam's H: at H = 365 days the ceiling is 527
  effective days, so a span of at least three years (GUESSED) — declared on
  the exam, printed with its record.
- **Recorded** per release in the exam's own directory, beside the stage-engine
  check's records, never beside the old sweep's. PASS belongs to the exact
  release; a new release reads NOT CHECKED.
- **Cost.** Two chains of N coins per exam, two exams: on the check's timing,
  a few minutes each on the box, started and polled, refusing while anything
  heavy is going, and deleting every set it made so nothing of it is ever on
  Boards.

## 7. Where it lives on the screens

Nothing below is a screen word until it is deployed and the word list is
regenerated; every label is proposed.

- **Sweep, stage 1 section:** one box beside "the most one trade may count
  for": the half-life, in days, empty for none (proposed label: "half-life
  days (empty = none)"), with the floor and the ceiling printed beside it as
  the launch works them out. The stage 2 section shows the parent's H and
  cannot change it.
- **Boards:** the record's `trainedOn` line says the half-life and the
  effective days, the way it says money or direction today.
- **History, a second panel beside "Age dial (HT v2) — one declared half-life
  vs the reference, paired folds"** (proposed heading: "The age dial on the
  three-stage engine"): the reference Stage 4 record set from the server's
  list (its chain, its rule sentence, the verdict that stood); the half-life
  choice (12/24/36 months, or typed); the two exam presses and their status
  under this release; the launch press, refused in words without the exams,
  while anything heavy is going, or when any unit would fall below the floor;
  the runs newest first, each with its per-unit table (unit, reference $,
  dial $, delta, effective days on each arm, silent or marked) and its verdict
  sentences; and the look stamped on both sets.
- **Verify:** the looks line counts the dial's reads of the held-back window
  on the reference set, as it counts the ride and Tune's reads.
- **Help** entries for every control.

## 8. Build order, digits, tests, cost

1. **The dial in stage 1 and 2** (`lib/stagework.js`, `lib/stages.js`
   launches, the Sweep box, `trainedOn`): second digit. Tests: a unit trained
   at H gives weights `0.5^(age/H)` times the money weights; H empty is byte-
   identical to today (the suite's fabricated chain reprices to the cent); the
   floor refuses a unit by name before anything trains; stage 2 reads H off
   its parent and refuses another.
2. **The pair and the verdict** (a new record kind, the two chain launches,
   the per-unit read through the V6 walk, `signFlipP`): second digit. Tests:
   the statistic on a hand-made table; R3 and R4 refuse as declared; a silent
   unit is disclosed and excluded; the look is stamped on both sets; the rule
   is read off the reference set and never re-walked.
3. **The exams** (`lib/stagegate.js` beside the check, the History presses):
   second digit. Tests: exam A passes and exam B does not on the fabricated
   coins at the declared span (this is the calibration; if it does not hold
   the instrument is not offered, and the loop reports which side failed and
   by how much); records per release; the launcher refuses without them.
4. **Guards** aimed at the tests that read each line (RULE EIGHT); the word
   lists after deploy.

Each step its own commit, its own release number, its own `GO NOW!` or a
`LOOP NOW!` over this document once section 9 is answered.

## 9. What the owner has to decide before a build order

1. **The unit of pairing: one delta per coin-and-shape unit** (recommended,
   section 4), or per setting with the dependence acknowledged.
2. **The dial chain's stage 3 block: the reference's whole declared block**
   (recommended: the same walk on both, nothing chosen twice), or only the
   settings inside the rule's ranges, which is cheaper by the share the rule
   keeps.
3. **The half-lives offered:** 12, 24, 36 months plus a typed number of days
   (recommended), or the three alone.
4. **Exam coin count and span:** N = 12 late-rule coins and 12 stationary
   coins on a three-year span (GUESSED), or other numbers.
5. **The floor:** 180 effective days, GUESSED, as the older instrument has it.
6. **R4's minimum:** 8 usable units, GUESSED.
7. **Whether the older panel stays beside the new one.** The owner's decision
   said the age dial is not retired; this document keeps it for old runs and
   adds the new panel. Retiring it later is a separate decision.
8. **Whether a PASS may ever change a launch default.** This document says no:
   a PASS is evidence on a record; the owner chooses H on the next launch by
   hand, every time.
