# Loop record — Coins rebuilt to the 2026-09-13 design

Owner: *"build and deploy it, making sure to root out all that useless stuff
that opus wrote already that's completely against my overall design. FIX THE
BAD VERSION, REMOVING ALL THAT OBSOLETE STUFF, IMPLEMENT THE NEW VERSION,
INCLUDING DEPLOY. LOOP NOW!"* — 2026-09-13, after approving COINS.md Part one.

**What the loop covers**: delete the 2026-09-12 Coins code, build the Coins
tab to COINS.md Part one sections 1 to 4, deploy it, capture the served record
and regenerate the word lists. **What it does not cover**: Sweep's dual member
voting mode (Part one section 5). Parked, section E, with the reason.

Every non-obvious choice is one line in section B. Every change that reached
the environment is in section F.

## A. The success rules, written before the numbers existed

The tests in `tests/test-coins.js` and `tests/test-coinsrun.js` check these
and nothing else. A rule here that a test does not check is a hole; a test
that checks something not here is a rule that was not pre-registered.

- **C1.1** Five shapes, one per entry in the engine's own geometry table, in
  its order, each named as Sweep's `chunk shape` dropdown names it, each
  carrying its own window length in hours and when a decision opens. Four
  daily, one weekly. Nothing typed.
- **C1.2** The window move of a decision is the price change from the OPEN of
  the first candle of its window to the price its trade opens at, as a
  percentage of the first. The decisions are exactly the chunks
  `buildComboChunks` builds for that shape, in order. The trade's opening
  price is the chunk's own `c1`: the entry candle's open on the daily shapes,
  the engine's six-hour Tuesday average on `Weekly 8-day`. Never the first
  candle's close.
- **C1.3** Nothing after a decision's open moves its reading: change every
  candle after decision k's entry and decisions 0..k read identically.
- **C1.4** A first price that is not a base for a return (zero or below)
  costs that one decision, is counted as skipped, and moves no other.
- **C2.1** The yardstick is the median of the window moves ignoring direction
  (odd count: the middle; even: the average of the two middles; none: null).
  The band is a percentage of it. Reading: rising if move > threshold,
  falling if move < −threshold, sit out otherwise. Band 0 sits out only a
  move of exactly nothing; a huge band sits everything out; a negative or
  non-numeric band is refused.
- **C3.1** The parts under each layout are `bracketwork.splitBounds` and
  `reserveChunks` applied as the engine applies them, tiling 0..n−1 with no
  gap; a count too small to divide says why rather than dividing; no share
  (0.13, 0.15, 0.61, 0.70, 0.74, 0.85) is typed into `lib/coins.js` as a
  value in any spelling.
- **C3.2** Per part: how many read rising, falling, sit out, and how many
  colour changes strictly inside the part. A change on the boundary between
  two parts belongs to neither, so the parts' changes never exceed the bar's.
- **C4.1** The served summary of one bar carries: one character per decision,
  the first moment and the hours since the one before for the rest, the moves
  to two places, the largest rise and fall, the median, the threshold, the
  whole-bar counts, and the counts per part under each layout — and summing
  up never rewrites the record it was made from.
- **R1** Candles in, a record out, at every shape, with nothing asked for; the
  record names the release; no `holds`, `params`, `readings`, `traditional`.
- **R2** A coin with no prices gets a record that says so.
- **R3** Every coin a run touched is on disk afterwards, read or not; the run
  refuses a second start while running; the served list carries the read
  coin summed up under every layout and the unread one with its reason.
- **R4** Stopped is told apart from finished: `stopped` true, `stoppedAt` the
  count done, and a second stop says there is nothing to stop.
- **R5** A file under an older record shape, or one that will not parse, is
  named in `unreadable` with both shapes, never drawn and never dropped.
- **R6** The band has one home (`data/settings.json`, key
  `coins_sit_out_band`): setting it keeps every other setting in that file;
  reading records back applies the value as it is now; the record on disk is
  byte-identical before and after; the reply says the home and the default.
- **R7** An unset or damaged band reads as the default.
- **R8** The layouts the reader divides by are the vocabulary's, never typed.
- **R9** A blank coin box is every real coin downloaded; a typed list is
  upper-cased and de-duplicated; a blank box on an empty box is refused with
  a sentence.
- **UI** (`tests/ui-coins.js`, pressed in a browser): three controls and no
  other; every word of the old design off the screen; two read coins draw
  ten bars named as Sweep names the shapes, each painted at the panel's width
  in all three colours; train/test/held above and train/test/held/reserve
  below every bar, sized as shares summing to 100%; both layouts named as
  Sweep names them; three number lines a bar; the hover names the day, the
  move and the reading; a band change posts once and redraws; the coin box
  survives a redraw; Read sends the coins and nothing else; while running the
  read button and coin box are off and the band is not; Stop's answer is
  shown; a stopped run reads as stopped; no page error.

## B. Decisions taken inside the loop

- **The record on disk holds the window moves; the band is applied at draw.**
  Part one section 6 said "nothing on disk". A read costs five chunk builds
  per coin (half a second on four years here; the box has eighteen coins of
  up to eight), and the owner asked for "a way to tune the sit out band".
  Storing the moves — facts about the history — and colouring them under the
  band when the screen asks means a band change recolours every bar at once
  and reads no candle again. COINS.md Part one is amended to say so.
- **The yardstick is the median window move ignoring direction**, per shape,
  per coin — the recommendation in Part one section 3, now built. It is one
  function, `medianAbsMove`, and nowhere else.
- **Band default 50.** A starting value for a control, nothing more.
- **The band's home is `data/settings.json`**, beside the other settings that
  describe how this installation is run, written the way `lib/compute.js`
  and `lib/throttle.js` write theirs (temp file, then rename). Key
  `coins_sit_out_band`. Sweep reads the same key when its mode is built.
- **Record shape 6**, no migration (owner, 2026-09-13: "Just code it right
  for this time"). The reader names a shape it cannot draw and asks for the
  coin again.
- **The bars are painted on a light track.** Black on this page's dark ground
  is invisible; the track is the same in both themes so the three colours
  read the same everywhere.
- **The served summary is compact and gzipped.** Moments as hours since the
  one before, moves to two places, one character per decision, and the
  records route gzips when the browser accepts it. Eighteen coins of eight
  years is a quarter of a million decisions in one reply.
- **While a reading runs the screen polls the status only**, and redraws the
  bars when a coin finishes. Fetching every decision of every bar twice a
  second to learn nothing changed is not information.
- **One provenance line per coin** — when read, release, candles, and months
  cached since — kept from the old screen because a reading that does not
  say what it was read from cannot be read honestly. Not a column.
- **`holdTypes` and `DAY_NAMES` deleted from `lib/dataset.js`**: nothing but
  the old Coins run called them.
- **`trainingWeights` deleted with the rest of the old engine.** Part one
  finding 3 said it could be reused for Sweep's mode; it lives in git history
  and comes back with that build, not as dead code waiting for it (RULE TEN).
- **Weekly 8-day's trade price is the engine's own six-hour average.** Found
  by C1.2 failing on the first run: the test expected the entry candle's open
  on every shape, and the weekly chunk's `c1` is `meanOHLC` of the Tuesday
  window. The reading uses the chunk's `c1` on purpose — that is what the
  sweep would book — and the test now pins it.
- **The band box is left live while a reading runs.** It is not part of a
  reading, so disabling it would say the opposite of the truth.
- **Deploy is a fast-forward push of this branch to `ultimate-trading-system`**,
  because that is the only branch the box's `deploy-uts.sh` deploys from, and
  the owner's `LOOP NOW!` named the deploy. No force, no rewrite.

## C. What was deleted

From `lib/coins.js`: the fall-back walk (`typeStretches`), the percentage
search (`searchFallback`), cutting at boundaries, the median stub rule, the
turns count, the split of time, the layout widths, the most one-sided stretch,
the drift, the shuffle and the can-tell reading, the traditional reading, the
training weight, and the per-coin reading that assembled them. From
`lib/coinsrun.js`: the reading per hold, seven typed defaults, the parameter
normalising for them, `rareSideWeighting`. From `lib/dataset.js`: `holdTypes`
and `DAY_NAMES`. From the Coins screen: the walk, `fall-back %`, `changes of
direction`, `changes of direction wanted`, `try from, %`, `try to, %`, `step,
%`, `weight ceiling`, `drift parts`, `shuffles`, `window layout`, `order by`,
`most one-sided stretch`, `drift`, `cannot tell`, the row per trade length, the
per-part stretch lines, the weight summary. From the Help tab: every entry for
those. From the tests: `tests/test-coins.js`, `tests/test-coinsrun.js` and
`tests/ui-coins.js` rewritten whole; twenty-one mutation guards aimed at the
old lines replaced by fifteen aimed at the new.

## D. What was built

- `lib/coins.js` — `shapes`, `windowMoves`, `medianAbsMove`,
  `readingsUnderBand`, `partsFor`, `layoutParts`, `countIn`, `shapeSummary`.
- `lib/coinsrun.js` — record shape 6, the band's home, the run, the reader.
- `server.js` — `POST /api/coins/band`; `/api/coins/records` gzipped.
- `public/construct.js` — the Coins screen: three controls, five bars a coin,
  the two divisions, the numbers, the hover, the band set on change.
- `public/construct.html` — the bar and division styles.
- `public/help-content.js` — the Coins entries.
- Release 3.124.0 (second digit: controls go, a control arrives).

## E. Parked

- **Sweep's dual member voting mode** (Part one section 5). Part one calls
  it "the boundary, not the whole"; how two sets of `members` are trained,
  masked, weighted, voted and copy-checked lives in
  `TREND-TRAINING-DESIGN.md` and in Part two findings 4 to 6, with open items
  the owner has not settled (whether the engine should balance a rare answer;
  the copy check measuring likeness over silent moments; the bar as a share of
  all members). Building it unattended would be guessing on each. The band is
  stored in one home so that build reads the same number.

## F. What reached the environment

- **Commit e593fb7** — COINS.md Part one written (document only), pushed to
  `claude/uts-build-out-7f2lmv`.
- **Commit 8643e3e** — the build, 3.124.0. `npm test` green (883 tests);
  `tests/ui-coins.js` green in a real browser; fifteen mutation guards each
  caught by its own test. Pushed to `claude/uts-build-out-7f2lmv` and
  fast-forwarded onto `ultimate-trading-system`, the branch `deploy-uts.sh`
  deploys from. No force, no rewrite.
- **Before deploying**: `uts-box-busy.sh` on the box answered `busy: none`,
  so the restart interrupted no run.
- **Deploy**: `deploy-uts.sh` through the deploy-control service, 06:20 UTC.
  The box fetched `8b2faee..8643e3e`, synced the files, installed
  dependencies, restarted the service, and its own health check answered OK.
  The previous generation was confirmed still active. The candle cache was
  left alone.
- **Served record**: `uts-served-fingerprint.sh` reports the box serving
  8643e3e; `SERVED.json` written from its output; `node tests/sweep-words.js
  --write` regenerated `SCREEN-WORDS.md` from that commit (10 tabs, 814
  control labels, 90 options); `test-sweepwords.js` and `test-help.js` green.

## G. After the loop — 3.125.0, on a `GO NOW!` (2026-09-13)

Not part of the loop; recorded here so the day's deploys are in one place.
The owner, after seeing 3.124.0: shade the `test` box in the `70/15/15`
strip; a start date in every box; and the gap, which they asked for after
asking what a good general metric for aptness to dual member voting would be.
COINS.md Part one section 4 carries the design.

- **Record shape 7**: the trade's own outcome (`diffPct`, the chunk's move
  from open to close) beside every decision. A shape-6 file is named and
  read again — the owner's "code it right for this time" holds.
- **The gap is one function**, `gapIn`, over any stretch of the bar: rising
  minus falling, as a share that went up and as an average move; sit-out
  decisions in neither side; thin side and run length beside it.
- **One table per bar** replaced the three number lines: the whole bar, then
  every part under each layout, fifteen named columns. Hover on each heading
  says what the column is.
- **The hover on a bar** now ends with how that decision's trade went.
- **A defect found by the owner, NOT fixed, outside this batch**: a file
  from record shape 3 is named `COIN__shape.json`, so a re-read writes
  `COIN.json` beside it and the notice "read the coin again to replace it"
  stays. Fixing it deletes a file on the box when the coin is read; that
  waits for the owner's word.
- **Deployed 06:45 UTC**: `uts-box-busy.sh` answered `busy: none`; `deploy-uts.sh`
  fetched `8643e3e..a90bd8a`, restarted the service, health check OK. The box
  serves a90bd8a; `SERVED.json` and `SCREEN-WORDS.md` regenerated from it
  (809 control labels, 90 options); `test-sweepwords.js` and `test-help.js`
  green. Commit a90bd8a is on `claude/uts-build-out-7f2lmv` and fast-forwarded
  onto `ultimate-trading-system`.
