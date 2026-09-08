# The History half-life run — the agreed design, and the loop record

Rewritten 2026-09-08 to the owner's spoken design (this session, one question at
a time). The first draft of this file (same day, earlier) planned a paired,
re-walked chain; the owner corrected it: **"4.h IS the same 199 records
retrained."** Everything below is that. Built under the owner's `LOOP NOW!`
of 2026-09-08 ~04:05 UTC; **no deploy inside the loop** — the owner is running
S3 #1c on the box and said to hold the deploy.

## 1. The agreed design, in the owner's words where they were rulings

- **Operation, by the set's window layout.** On History, for a Stage 4 record
  set whose verdict PASSED on Verify:
  - 61/13/13/13 sets: weighted-to-recent train on the first 72% of history,
    test on the next 15%; the last 13% (Reserve) stays untouched.
  - 70/15/15 sets: weighted-to-recent train on the same first 70%, test on the
    same 15%; the last 15% (Held) stays untouched.
- **"4.h IS the same 199 records retrained."** The set's settings are kept
  exactly; only the forecasts behind them are retrained, and the same records
  are priced again with the new forecasts on the same coin.
- **The half-lives: tick boxes, 12 / 18 / 24 / 30 / 36 / 48 months.** One press
  retrains once per ticked value, both kinds of forecast (the straight-line
  members and the boosted members), keeping every other training choice the
  set was made with (weigh by money, its cap, the fee) and only adding the
  recency weight.
- **The display: one table.** One row per record; a money column per
  half-life from shortest to longest; the unweighted, not-retrained money in
  the final column; all priced in one pass on the same untouched stretch
  (Reserve for 61/13/13/13, Held for 70/15/15); the best of each row
  highlighted green; under the table, how many rows each column won and each
  column's average.
- **Looks:** "it doesn't matter how many looks at reserve — we're going forward
  to greenlighting records at this point and the data integrity is already
  assured." Every press still counts and prints its look number; the count is
  information, never a gate.
- **Standing:** "don't worry about Verify verdicts at this point — we've
  already got a pass on Verify — all subsequent data processing does not
  affect greenlighting eligibility." A derived set stands on its source's
  PASS.
- **The 4.h build button.** From the table, one press builds the "4.h" set:
  every row whose green cell sits under a half-life column, each record
  carrying the half-life that won on that row; rows where the unweighted
  column won are left out. "Better" is better by at least a cent; a tie goes
  to the unweighted side. The set can carry different half-lives on different
  records. It goes forward on Tune and Greenlight; the half-life travels with
  the record into the capture, the greenlight and the live path.
- **"Run the reserve grade on this set" stays exactly as it is** for
  61/13/13/13 sets, beside the new run: the whole set, unweighted and not
  retrained, against the Reserve.
- **The 80/20 window layout goes** from stage 1, with its code. "There are no
  sets with 80/20."
- **The two fabricated-coin exams of the older instrument are not required**
  before the new run may run on a real set (owner, on being told what they
  were: dropped).
- **The older "Age dial (HT v2)" panel stays** for the older engine's runs.
- **Added while the loop was being granted:** the planted check and its two
  sections move to a new tab under Setup called Version, after Compute; the
  NOT CHECKED marker takes the owner there.

## 2. The mechanism, as it will be coded

- **The retrain layout.** For a 61/13/13/13 set, a layout of its own inside
  the engine (internal name `retrain72`, never offered on Sweep): cut the final
  13% as the sealed layout does, then train on the first 72% of all history
  and test on the next 15%, with no held-back slice. For a 70/15/15 set the
  set's own layout, unchanged. The training slice's labels come from the new
  training slice's own balanced band, as any training does; the records are
  PRICED at the unit's original band, so every setting's trade shape is the
  one the set was cut on.
- **The weight.** For each ticked half-life H (months × 30.4375 days), each
  training chunk's weight is `0.5 ^ (age / H)`, age being the days from the
  chunk's start to the last training chunk's start (`ageWeight` in
  lib/history.js, unchanged). It multiplies into the set's own training
  weights (money weights and cap, or none). The effective training days (the
  sum of the age weights) are recorded per half-life; a half-life whose
  effective days fall below the floor in lib/history.js (180, GUESSED) is
  REFUSED for that column, in words, and the other columns still run.
- **The forecasts.** The stage 2 record's members, both kinds, retrained with
  `trainProbMember` exactly as stage 1 and stage 2 train them, predicting the
  test slice (and the held-back slice for 70/15/15). Each member's tau comes
  from its probe votes on the training slice's last quarter, as stage 3 tunes
  it. The retrained members (saved models, votes, probe votes) are kept in a
  file beside the set, per run and per half-life, so a 4.h record is captured
  and forecast later from them and nothing is trained twice.
- **The pricing.** The set's survivors priced through the stage 3 unit task
  (`s3UnitTask`) with no scrambled copies: for 61/13/13/13 with the unread
  window in the held-back window's place (`task.unread`, the retrained saved
  models forecasting it, the reserve grade's own path); for 70/15/15 on the
  held-back slice. The unweighted column is priced in the SAME pass by the same
  task from the set's original votes and models, on the same chunks (for
  70/15/15 it must equal the record's stored held-back money to the cent, and a
  test holds it to that).
- **The record.** On the set: `halflife`, newest first, each run with its
  half-lives, its judge window and stretch, its columns, its rows (each
  record's money per column and which column won), refusals, wins and
  averages, the look number. Beside the set: `<id>-halflife-<run>.json.gz`
  with the retrained members per half-life.
- **The 4.h set.** A Stage 4 record set document like any cut (`newFunnelSet`)
  with `derived: { kind: 'halflife', from, run }`, the same unit and parent,
  the source's rule and check, and survivors `{ si, label, halfLife, money }`.
  Named by the owner in a box beside the button. Listed on Tune and Greenlight
  with its source named; not on Verify, History or the Funnel; refused in words
  by Verify's press and History's two presses. Its gate is its source's PASS.
- **Where the half-life travels.** The capture (Tune) reads a derived
  record's retrained members from the run file for its half-life and captures
  on the retrain layout's slices (held-back entries are empty for 61/13/13/13:
  that layout has none). A greenlight from a derived set carries
  `training.halfLife` (days) on its frozen configuration; the shared
  vocabulary accepts it; the live path multiplies the same age weight into its
  training; the anatomy panel and the Trade rows say it on both Paper Books
  and Live Trading through the one drawing path.
- **Cost.** Per half-life, one unit's members trained once (seconds to a
  minute each on the box) and 199 settings priced without copies (seconds).
  Six half-lives: minutes. Started and polled, progress by half-life; refuses
  while anything heavy is going.

## 3. The steps, with their releases, tests and guards (pre-registered)

**H1 — 3.93.0: the 80/20 layout removed.** `lib/vocabulary.js` loses the
option; `startStage1` refuses `legacy80` in words; `unitChunks` always keeps a
held-back slice. The old engine (lib/batch.js) keeps reading its own records.
Test: `theEightyTwentyLayoutIsGoneFromStageOne` (tests/test-stages.js). Guard:
the refusal.

**H2 — 3.94.0: the half-life run.** `unitChunks` gains `retrain72`;
`lib/stagework.js` gains the retrain task (`hlUnitTask`: members retrained per
half-life with the age weight, priced through `s3UnitTask`); `lib/stages.js`
the run (dry, start, status), the record and the file; `server.js` three
routes; History's panel; help. Tests (tests/test-halflife.js):
`theRetrainLayoutTrainsOnSeventyTwoAndTestsOnFifteenLeavingTheReserveWhereItWas`,
`theAgeWeightMultipliesIntoTheSetsOwnWeightsAndAStarvedHalfLifeIsRefusedInWords`,
`theRunPricesEveryColumnOnOneStretchAndTheUnweightedColumnIsTheRecordsOwn`
(fabricated chain: the unweighted column equals the reserve grade's money to
the cent on the same chunks; every survivor a row; green strictly by a cent;
wins and averages), `theTableAndThePressAreOnHistoryWithTheirRoutes`.
Guards: the age weight, the cent, the one-stretch check.

**H3 — 3.95.0: the 4.h set.** `lib/stages.js` builds the derived set; the
doors; `lib/live/greenlight.js` and `lib/live/configschema.js` carry
`training.halfLife`; `lib/live/stagesignal.js` applies it; `lib/live/anatomy.js`
and `public/trade.html` say it; Tune's capture reads the run file. Tests:
`theBuildKeepsOnlyRowsAHalfLifeWonAndEachRecordCarriesIts`,
`aDerivedSetStandsOnItsSourceAndIsRefusedWhereItsOwnNumbersWouldMislead`,
`theHalfLifeTravelsIntoTheCaptureTheGreenlightAndTheLivePath` (the capture's
entries recount from the retrained calls; the configuration validates;
the live path's weights carry the age factor; both Trade branches print it).
Guards: the strict cent, the source gate, the live weight.

**H4 — 3.96.0: the Version tab.** `public/setup.html` gains the tab; the
planted panel and the stage-engine check panel move there whole, with their
followers, self-contained; `public/construct.js` loses them and the badge
opens Setup on Version; help entries move with them. Tests re-aimed:
tests/test-stagegate.js `theScreenOffersTheCheckBesideThePlantedOne` (now on
Setup), tests/test-stages.js's planted-button scan, tests/test-funnelverify.js's
help list; new `theTwoChecksLiveOnSetupsVersionTabAndTheBadgeGoesThere`.

**No deploy in this loop.** Each release is committed and pushed on both
branches; the deploy chain waits for the owner's word.

## 4. Loop record

- **H1 (3.93.0), 2026-09-08 ~04:20 UTC.** The 80/20 layout is gone from stage 1: the box on Sweep, the launch (refused by name), the chunk split. The older engine keeps its own name for its own records. Test `theEightyTwentyLayoutIsGoneFromStageOne`; one guard. Decision 84. **Caught by the whole suite, not by the narrow files:** the split's return still named the variable the removal deleted, so every stage 1 launch failed with "holdout is not defined"; the three chain files saw it, the four narrow files could not. Fixed and the chain files re-run before the commit.
- **H2 (3.94.0), 2026-09-08 ~07:25 UTC.** Built as declared: the retrain layout, the age weight into the set's own weights, the members retrained per half-life on the workers, the same settings priced through the stage 3 task at the unit's original band beside the unweighted column in one pass, the table with its green cells and the rows won and averages under it, the retrained members kept beside the set, the panel and help on History, the reserve grade untouched. **Both chain tests passed on their first run**: on a 61/13/13/13 set the unweighted column is the reserve grade's money to the cent on the same stretch; on a 70/15/15 set it is the stage 3 record's own held-back money to the cent. Three guards. Decision 85. Two files of this step (the module and its test file) landed a commit early, unwired, through a too-wide add on H1's commit; recorded, not rewritten.
- **H3 (3.95.0), 2026-09-08 ~07:05 UTC.** Built as declared: the name box and the build press under the newest table on History; the set holds only the rows a half-life won, each record carrying its half-life and both moneys; it stands on its source's PASS and is refused by the verdict, the reserve grade, another half-life run and the Funnel's own list, while Tune and Greenlight take it named by its source; Tune's capture retrains nothing and reads each record's saved members from the run file, on the retrain layout; a greenlight from it carries the half-life in days and months, the shared vocabulary accepts that only on a stage-engine configuration, the live path multiplies the same age weight into its training through the one definition, and the anatomy and both Trade branches say it. **The chain test passed on its first run**: the captured test entries reprice the table's own test money at the record's half-life to the cent. **One pre-registered test name was not written as its own test**: the derived set's standing and refusals (`aDerivedSetStandsOnItsSourceAndIsRefusedWhereItsOwnNumbersWouldMislead`) are asserted inside the build test on the same fabricated chain, one chain instead of two; recorded here rather than left as a name the file does not hold. **The whole suite found one thing the narrow files could not**: a source scan in the stage-engine check's tests pinned the exact text of the Funnel picker's filter, which this step widened to leave a half-life set out; re-aimed with its reason. Three guards, run after H4 with the rest. Decision 86.
