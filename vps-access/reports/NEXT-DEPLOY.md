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

## 3. Also outstanding, lower priority

- The symbol cache (`getMap`) keys on symbol alone and returns a cached range
  on a hit, **ignoring the requested date range**. Per-job worker pools mean
  real jobs appear unaffected, but any single process that loads one range then
  requests another silently gets the first. It broke a diagnostic on 2026-07-30
  and should not be left as a trap.
- `dMults` / `tHours` / `gates` / `entries` are library constants, unreachable
  from a launcher — the same fault class as the fee, which is now settable.
