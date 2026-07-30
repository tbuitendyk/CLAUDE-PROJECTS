# Queued for the next deploy

Nothing here is live yet. Listed in the order it should go out.

## 1. Record the execution settings behind every money figure — DONE, awaiting deploy

Committed to `general-classifier`. The census stored what each setup made but
not which settings made it, so an odd figure could not be traced. Now records
entry style, gate, stop distance, hold time, trail/arm multipliers, vote
threshold, and the within-bar ambiguity count. Test fails if money is recorded
without them.

Owner, 2026-07-30: "add proper recording of the execution settings EVERY time."

## 2. Persist the fitted models — NOT BUILT, needs design

Owner, 2026-07-30: **"fitted models that predict properly is essentially the
product ... of course they must be persisted."**

Current state: the search engine (`lib/bracket.js`) returns only the
predictions and the winning settings. All 2,040 fitted models per run are
discarded. Eleven cycles have thrown away everything they found.

The capability exists but in the wrong module: `lib/books.js` serialises a full
model — weights, scaling numbers, tightness, confidence threshold for the
weighted-sum type; trees, priors and rounds for the stack-of-rules type — and
can reload and predict from a saved one. It is what the frozen paper trackers
run on. It has never been connected to the search path.

Consequences to design around:

- **Size.** 2,040 models per run, and boosted trees are not small. Needs a
  storage decision, not just a JSON dump into the run document.
- **What to save.** Saving all 2,040 every run is probably wasteful; saving
  only the winners reintroduces selection. Likely answer: save all models for a
  *declared* configuration, and predictions only for a broad search.
- **The saving grace.** The sweep is deterministic (verified in L7 — a re-run
  matched to every digit), so nothing found so far is permanently lost. L9's
  models can be regenerated exactly by re-running its settings.

Until this exists, the platform cannot test a frozen model on new data, which
is the test that actually matters — and is why cycle 11 answered the wrong
question.

## 3. Show the HELD-BACK numbers on the board — NOT BUILT

Owner, 2026-07-30: "well of course show the holdback data ... that's what the
whole point is."

Every column on the bracket-lab board — net P&L, accuracy, edge, gross per
trade, stops — is computed on the SETTINGS-CHOOSING window, the same stretch
each row was selected on. `bracketwork.js:323` scores accuracy against
`testLabels`, and `:289` sweeps on `testChunks`. The held-back figures already
exist (`best.holdout`, `:355`) and are simply not displayed.

So the board's headline number is selected-on-itself, unlabelled, and has been
read as a result for eleven cycles.

### Layout spec (owner, 2026-07-30)

Both sets shown. Held-back gets the full treatment because it is what matters;
the tuning-window set is compressed to make room.

    [ ] #  setup  execution ‖ TUNED ON SETTINGS WINDOW ‖ HELD-BACK — what matters
                            ‖ P&L      acc    W/T   st ‖ net P&L  acc   edge  W/T · g/t  stops
                            ‖ vs ctl   edge   g/t      ‖
                            ‖    (small, light)        ‖        (full size)

- Settings-window block: pairs stacked two-deep in one field each, in the small
  light style already used for the sub-lines under `setup` and `execution`.
  Net P&L over vs-control in one column; accuracy over edge in one column;
  wins/trades over gross-per-trade in one column. **Stops kept on this side
  too** (owner, 2026-07-30) — small, single line.
- Held-back block: all of net P&L, accuracy, edge, wins/trades, gross-per-trade
  and stops, at normal size.
- Group headers over each block so which window a number came from is
  unmissable rather than inferred from a tooltip.
- **A vertical divider between the two blocks** (owner, 2026-07-30) — a real
  ruled border, carried down every row and through the header, not just a gap.
  It has to survive the row striping.
- Table may go WIDER if needed. **No horizontal scrollbar** — owner's standing
  requirement, so column count and widths get checked against the narrowest
  viewport before this ships.
- Drop the `vs control*` asterisk footnote from the held-back block: there the
  comparison IS meaningful, because the cell was chosen before that window was
  scored. Keep the warning on the settings-window side only.

### Also

Also rename the variables. `testChunks` is the window we SHOP on and
`holdChunks` is the genuinely held-back one, so "test" in this codebase means
the opposite of what it normally implies. That name sits under every number on
the board and is a standing trap for whoever reads it next.

## 4. Store BOTH windows' figures for EVERY setup, uncapped — NOT BUILT

Owner, 2026-07-30: "save all those numbers of course. time is more valuable
than storage."

**Decouple storage from display.** The leaderboard is capped at 50 rows and
sorted by profit, so it discards the worst performers — precisely the ones
worth investigating. Cycle 11's four XRP disasters could not be traced because
their execution settings existed only on a board that excluded them.

The census holds all 170 setups and is never sorted by outcome. It should
therefore carry EVERYTHING, for every setup:

Already stored: held-back P&L, trades, wins, gross-per-trade, accuracy, edge,
directional hits/calls, the baseline it was scored against, always-long and
buy-and-hold controls, and (new) the execution settings + within-bar ambiguity.

Still missing — currently only on the capped leaderboard:
- settings-window net P&L, trades, wins, gross-per-trade, stops
- settings-window vs-control
- held-back stops as its own field

Add those so both windows are fully recorded for all 170. Display can stay
capped; storage must not be.

Rule going forward: **anything the board displays must first exist in the
census.** A number that can be seen but not retrieved is a number that cannot
be checked later.

## 5. Also outstanding, lower priority

- The symbol cache (`getMap`) keys on symbol alone and returns a cached range
  on a hit, **ignoring the requested date range**. Per-job worker pools mean
  real jobs appear unaffected, but any single process that loads one range then
  requests another silently gets the first. It broke a diagnostic on 2026-07-30
  and should not be left as a trap.
- `dMults` / `tHours` / `gates` / `entries` are library constants, unreachable
  from a launcher — the same fault class as the fee, which is now settable.
